import "server-only";
import type { TransactionSql } from "postgres";
import { db } from "./db";
import { calculateTotal, type CalcItem } from "./prices";
import { LARGE_DOCUMENT_CHARS, searchTerms, splitIntoSections } from "./sections";

export type DocumentSummary = {
  id: string;
  title: string;
  kind: "procedure" | "price_list" | "qa";
  topic: string;
  payer: string | null;
  vat_included: boolean | null;
  updated_at: Date;
};

export async function listDocuments(): Promise<(DocumentSummary & { uploaded_by: string; item_count: number; file_name: string | null })[]> {
  return db()`
    select d.id, d.title, d.kind, t.name as topic, d.payer, d.vat_included, d.updated_at, d.uploaded_by,
           f.file_name,
           (select count(*)::int from chatbot.price_items p where p.document_id = d.id) as item_count
    from chatbot.documents d
    join chatbot.topics t on t.id = d.topic_id
    left join chatbot.files f on f.id = d.file_id
    order by t.name, d.kind, d.title`;
}

export async function listTopics(): Promise<{ id: string; name: string }[]> {
  return db()`select id, name from chatbot.topics order by name`;
}

/**
 * Everything the bot reads on each question: the text documents, the list of long documents it
 * searches instead (with search_documents), and the list of price lists.
 */
export async function loadKnowledge() {
  const sql = db();
  const texts = await sql<(DocumentSummary & { content: string })[]>`
    select d.id, d.title, d.kind, t.name as topic, d.payer, d.vat_included, d.updated_at, d.content
    from chatbot.documents d join chatbot.topics t on t.id = d.topic_id
    where d.kind <> 'price_list' and length(d.content) <= ${LARGE_DOCUMENT_CHARS}
    order by t.name, d.title`;
  const searchable = await sql<(DocumentSummary & { sections: number; pages: number | null })[]>`
    select d.id, d.title, d.kind, t.name as topic, d.payer, d.vat_included, d.updated_at,
           count(c.idx)::int as sections, max(c.page)::int as pages
    from chatbot.documents d
    join chatbot.topics t on t.id = d.topic_id
    left join chatbot.document_chunks c on c.document_id = d.id
    where d.kind <> 'price_list' and length(d.content) > ${LARGE_DOCUMENT_CHARS}
    group by d.id, t.name
    order by t.name, d.title`;
  const priceLists = await sql<(DocumentSummary & { item_count: number })[]>`
    select d.id, d.title, d.kind, t.name as topic, d.payer, d.vat_included, d.updated_at,
           (select count(*)::int from chatbot.price_items p where p.document_id = d.id) as item_count
    from chatbot.documents d join chatbot.topics t on t.id = d.topic_id
    where d.kind = 'price_list'
    order by d.payer, d.title`;
  return { texts, searchable, priceLists };
}

/** Stores the searchable sections of a document (none when it is short enough to read whole). */
export async function replaceSections(tx: TransactionSql, documentId: string, content: string): Promise<number> {
  await tx`delete from chatbot.document_chunks where document_id = ${documentId}`;
  if (content.length <= LARGE_DOCUMENT_CHARS) return 0;
  const rows = splitIntoSections(content).map((s) => ({
    document_id: documentId,
    idx: s.idx,
    page: s.page,
    content: s.content,
  }));
  for (let i = 0; i < rows.length; i += 200) {
    await tx`insert into chatbot.document_chunks ${tx(rows.slice(i, i + 200))}`;
  }
  return rows.length;
}

export type SectionHit = { document_id: string; title: string; page: number | null; content: string };

/**
 * Sections of long documents that contain the most words of the query (each word also matched
 * without a one-letter prefix). Optionally limited to some documents.
 */
export async function searchDocuments(query: string, documentIds?: string[]): Promise<SectionHit[]> {
  const { words, groups } = searchTerms(query);
  if (words.length === 0) return [];
  const ids = documentIds?.filter((id) => /^[0-9a-f-]{36}$/i.test(id)) ?? [];
  return db()<SectionHit[]>`
    select c.document_id, d.title, c.page, c.content
    from chatbot.document_chunks c
    join chatbot.documents d on d.id = c.document_id
    cross join lateral (
      select count(distinct t.g) as hits,
             sum((length(c.content) - length(replace(lower(c.content), t.w, ''))) / length(t.w)) as occurrences
      from unnest(${words}::text[], ${groups}::int[]) as t(w, g)
      where c.content ilike '%' || t.w || '%'
    ) m
    where m.hits > 0
      and (cardinality(${ids}::uuid[]) = 0 or c.document_id = any(${ids}::uuid[]))
    order by m.hits desc, m.occurrences desc, c.document_id, c.idx
    limit 8`;
}

export async function documentsByIds(ids: string[]): Promise<{ id: string; title: string; updated_at: Date }[]> {
  if (ids.length === 0) return [];
  return db()`select id, title, updated_at from chatbot.documents where id = any(${ids}::uuid[])`;
}

export type PriceHit = {
  item_id: number;
  document_id: string;
  price_list: string;
  payer: string;
  vat_included: boolean;
  sku: string;
  description: string;
  price: number;
  notes: string | null;
  /** Maximum discount as a fraction (0.2 = 20%, 1 = may be waived); null = no discount column. */
  max_discount: number | null;
};

/**
 * Finds price-list rows by SKU or by words of the treatment name. Rows matching more of the
 * words come first. Optional payer filter (substring, e.g. "משרד הבטחון").
 */
export async function lookupPrice(query: string, payer?: string): Promise<PriceHit[]> {
  const tokens = query
    .split(/[\s,;/]+/)
    .map((w) => w.replace(/["'״׳()]/g, "").trim())
    .filter((w) => w.length >= 2)
    .slice(0, 8);
  if (tokens.length === 0) return [];
  const payerFilter = payer?.trim() ? `%${payer.trim()}%` : null;
  return db()<PriceHit[]>`
    select p.id::int as item_id, d.id as document_id, d.title as price_list, d.payer, d.vat_included,
           p.sku, p.description, p.price, p.notes, p.max_discount
    from chatbot.price_items p
    join chatbot.documents d on d.id = p.document_id
    cross join lateral (
      select count(*) as hits from unnest(${tokens}::text[]) w
      where p.description ilike '%' || w || '%' or p.notes ilike '%' || w || '%' or p.sku = w
    ) m
    where m.hits > 0
      and (${payerFilter}::text is null or d.payer ilike ${payerFilter} or d.title ilike ${payerFilter})
    order by (p.sku = any(${tokens}::text[])) desc, m.hits desc, d.payer, p.sku
    limit 25`;
}

/**
 * Totals for price-list rows the model picked (by item_id), computed here, not by the model.
 * An optional discount_rate per line must not exceed the row's maximum discount.
 */
export async function calculate(
  lines: { item_id: number; quantity: number; discount_rate?: number }[],
  vatRate: number,
) {
  const valid = lines.filter((l) => Number.isInteger(l.item_id) && Number.isFinite(l.quantity) && l.quantity > 0);
  if (valid.length === 0) return { error: "no valid lines" };
  const ids = valid.map((l) => l.item_id);
  const rows = await db()<PriceHit[]>`
    select p.id::int as item_id, d.title as price_list, d.vat_included, p.sku, p.description, p.price, p.max_discount
    from chatbot.price_items p join chatbot.documents d on d.id = p.document_id
    where p.id = any(${ids}::bigint[])`;
  const byId = new Map(rows.map((r) => [r.item_id, r]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) return { error: `unknown item_id: ${missing.join(", ")}` };
  const items: CalcItem[] = [];
  for (const l of valid) {
    const r = byId.get(l.item_id)!;
    const discountRate = l.discount_rate ?? 0;
    if (!Number.isFinite(discountRate) || discountRate < 0 || discountRate > 1) {
      return { error: `discount_rate must be between 0 and 1 (item ${r.sku})` };
    }
    if (discountRate > (r.max_discount ?? 0)) {
      return {
        error: `discount ${discountRate} is above the maximum allowed for ${r.sku} (${r.max_discount ?? "no discount defined"})`,
      };
    }
    items.push({
      sku: r.sku,
      description: r.description,
      priceList: r.price_list,
      unitPrice: r.price,
      vatIncluded: r.vat_included,
      quantity: l.quantity,
      discountRate,
    });
  }
  return calculateTotal(items, vatRate);
}

export function vatRate(): number {
  const rate = Number(process.env.VAT_RATE ?? "0.18");
  return Number.isFinite(rate) && rate >= 0 && rate < 1 ? rate : 0.18;
}
