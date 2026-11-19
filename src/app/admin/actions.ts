"use server";

import type { TransactionSql } from "postgres";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  CHUNK_BYTES,
  extensionOf,
  extractText,
  MAX_FILE_BYTES,
  parsePriceFile,
  PRICE_LIST_TYPES,
  PROCEDURE_TYPES,
  readFile,
} from "@/lib/files";
import type { ParseResult, PriceRow } from "@/lib/prices";
import { detectIdentifiers, type PrivacyReason } from "@/lib/privacy";
import { t } from "@/i18n";
import { describeError } from "@/lib/errors";

type Purpose = "procedure" | "price_list";

// Uploads ------------------------------------------------------------------------------
// The browser sends the file in chunks (Vercel caps a request at 4.5 MB): start -> chunk... ->
// finish. Unfinished uploads and files no document points to are removed after a day.

export async function startUpload(
  fileName: string,
  size: number,
  purpose: Purpose,
): Promise<{ ok: true; fileId: string } | { ok: false; error: "badType" | "fileTooBig" }> {
  const user = await requireAdmin();
  const types = purpose === "procedure" ? PROCEDURE_TYPES : PRICE_LIST_TYPES;
  const mime = types[extensionOf(fileName)];
  if (!mime) return { ok: false, error: "badType" };
  if (!Number.isInteger(size) || size < 1 || size > MAX_FILE_BYTES) return { ok: false, error: "fileTooBig" };
  const sql = db();
  await sql`
    delete from chatbot.files f
    where f.created_at < now() - interval '1 day'
      and not exists (select 1 from chatbot.documents d where d.file_id = f.id)`;
  const [row] = await sql<{ id: string }[]>`
    insert into chatbot.files (file_name, mime_type, size_bytes, uploaded_by)
    values (${fileName.slice(0, 255)}, ${mime}, ${size}, ${user.email}) returning id`;
  return { ok: true, fileId: row.id };
}

export async function uploadChunk(form: FormData): Promise<boolean> {
  await requireAdmin();
  const fileId = String(form.get("fileId"));
  const idx = Number(form.get("idx"));
  const chunk = form.get("chunk");
  if (!(chunk instanceof Blob) || !Number.isInteger(idx) || idx < 0 || chunk.size > CHUNK_BYTES) return false;
  const data = Buffer.from(await chunk.arrayBuffer());
  const rows = await db()`
    insert into chatbot.file_chunks (file_id, idx, data)
    select id, ${idx}, ${data} from chatbot.files where id = ${fileId} and data is null
    on conflict (file_id, idx) do update set data = excluded.data
    returning idx`;
  return rows.length === 1;
}

export async function finishUpload(fileId: string): Promise<boolean> {
  await requireAdmin();
  const sql = db();
  return sql.begin(async (tx) => {
    const rows = await tx`
      update chatbot.files f set data = c.data
      from (
        select string_agg(data, ''::bytea order by idx) as data
        from chatbot.file_chunks where file_id = ${fileId}
      ) c
      where f.id = ${fileId} and f.data is null and length(c.data) = f.size_bytes
      returning f.id`;
    await tx`delete from chatbot.file_chunks where file_id = ${fileId}`;
    return rows.length === 1;
  });
}

// Reading files for the preview -------------------------------------------------------

export type ProcedurePreview =
  | { ok: true; text: string; reasons: PrivacyReason[] }
  | { ok: false; error: "extractFailed" };

export async function previewProcedure(fileId: string): Promise<ProcedurePreview> {
  await requireAdmin();
  const file = await readFile(fileId);
  if (!file) return { ok: false, error: "extractFailed" };
  try {
    const text = await extractText(file);
    if (!text) return { ok: false, error: "extractFailed" };
    return { ok: true, text, reasons: detectIdentifiers(text) };
  } catch (error) {
    console.error(`extract failed: ${describeError(error)}`);
    return { ok: false, error: "extractFailed" };
  }
}

export type PriceListPreview = { ok: true; result: ParseResult } | { ok: false; error: "extractFailed" };

export async function previewPriceList(fileId: string): Promise<PriceListPreview> {
  await requireAdmin();
  const file = await readFile(fileId);
  if (!file) return { ok: false, error: "extractFailed" };
  try {
    return { ok: true, result: await parsePriceFile(file) };
  } catch (error) {
    console.error(`price list parse failed: ${describeError(error)}`);
    return { ok: false, error: "extractFailed" };
  }
}

// Saving -------------------------------------------------------------------------------

type SaveResult = { ok: true } | { ok: false; error: "missingFields" | "failed" | "noRows" | "rowErrors" };

const cleanName = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);

async function topicId(tx: TransactionSql, name: string): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into chatbot.topics (name) values (${name})
    on conflict (name) do update set name = excluded.name
    returning id`;
  return row.id;
}

/** Creates a procedure, or replaces `documentId` in place (its old file is deleted). */
export async function saveProcedure(input: {
  documentId: string | null;
  topic: string;
  title: string;
  content: string;
  fileId: string | null;
}): Promise<SaveResult> {
  const user = await requireAdmin();
  const topic = cleanName(input.topic, 80);
  const title = cleanName(input.title, 200);
  const content = input.content.trim();
  if (!topic || !title || !content) return { ok: false, error: "missingFields" };
  try {
    await db().begin(async (tx) => {
      const topicRow = await topicId(tx, topic);
      if (input.documentId) {
        const [old] = await tx<{ file_id: string | null }[]>`
          select file_id from chatbot.documents where id = ${input.documentId} and kind <> 'price_list' for update`;
        if (!old) throw new Error("document not found");
        await tx`
          update chatbot.documents set topic_id = ${topicRow}, title = ${title}, content = ${content},
            file_id = coalesce(${input.fileId}::uuid, file_id), uploaded_by = ${user.email}, updated_at = now()
          where id = ${input.documentId}`;
        if (input.fileId && old.file_id && old.file_id !== input.fileId) {
          await tx`delete from chatbot.files where id = ${old.file_id}`;
        }
      } else {
        await tx`
          insert into chatbot.documents (topic_id, kind, title, content, file_id, uploaded_by)
          values (${topicRow}, 'procedure', ${title}, ${content}, ${input.fileId}, ${user.email})`;
      }
    });
  } catch (error) {
    console.error(`save procedure failed: ${describeError(error)}`);
    return { ok: false, error: "failed" };
  }
  revalidatePath("/admin/documents");
  return { ok: true };
}

/** Creates a price list, or replaces `documentId` with the rows of the new file. */
export async function savePriceList(input: {
  documentId: string | null;
  topic: string;
  title: string;
  payer: string;
  vatIncluded: boolean;
  fileId: string;
}): Promise<SaveResult> {
  const user = await requireAdmin();
  const topic = cleanName(input.topic, 80);
  const title = cleanName(input.title, 200);
  const payer = cleanName(input.payer, 120);
  if (!topic || !title || !payer || !input.fileId) return { ok: false, error: "missingFields" };

  // Parse again here: the rows saved are the ones in the file, not what the browser sent.
  const file = await readFile(input.fileId);
  if (!file) return { ok: false, error: "failed" };
  const parsed = await parsePriceFile(file);
  if (parsed.noHeader || parsed.errors.length) return { ok: false, error: "rowErrors" };
  if (parsed.rows.length === 0) return { ok: false, error: "noRows" };

  try {
    await db().begin(async (tx) => {
      const topicRow = await topicId(tx, topic);
      let docId = input.documentId;
      if (docId) {
        const [old] = await tx<{ file_id: string | null }[]>`
          select file_id from chatbot.documents where id = ${docId} and kind = 'price_list' for update`;
        if (!old) throw new Error("price list not found");
        await tx`
          update chatbot.documents set topic_id = ${topicRow}, title = ${title}, payer = ${payer},
            vat_included = ${input.vatIncluded}, file_id = ${input.fileId}, uploaded_by = ${user.email}, updated_at = now()
          where id = ${docId}`;
        await tx`delete from chatbot.price_items where document_id = ${docId}`;
        if (old.file_id && old.file_id !== input.fileId) await tx`delete from chatbot.files where id = ${old.file_id}`;
      } else {
        const [created] = await tx<{ id: string }[]>`
          insert into chatbot.documents (topic_id, kind, title, payer, vat_included, file_id, uploaded_by)
          values (${topicRow}, 'price_list', ${title}, ${payer}, ${input.vatIncluded}, ${input.fileId}, ${user.email})
          returning id`;
        docId = created.id;
      }
      const rows = parsed.rows.map((r: PriceRow) => ({
        document_id: docId,
        sku: r.sku,
        description: r.description,
        price: r.price,
        notes: r.notes,
        max_discount: r.maxDiscount,
      }));
      for (let i = 0; i < rows.length; i += 500) {
        await tx`insert into chatbot.price_items ${tx(rows.slice(i, i + 500), "document_id", "sku", "description", "price", "notes", "max_discount")}`;
      }
    });
  } catch (error) {
    console.error(`save price list failed: ${describeError(error)}`);
    return { ok: false, error: "failed" };
  }
  revalidatePath("/admin/documents");
  return { ok: true };
}

export async function deleteDocument(documentId: string): Promise<boolean> {
  await requireAdmin();
  const ok = await db().begin(async (tx) => {
    const [doc] = await tx<{ file_id: string | null }[]>`
      delete from chatbot.documents where id = ${documentId} returning file_id`;
    if (!doc) return false;
    if (doc.file_id) await tx`delete from chatbot.files where id = ${doc.file_id}`;
    await tx`
      delete from chatbot.topics t
      where not exists (select 1 from chatbot.documents d where d.topic_id = t.id)
        and t.owner_email is null`;
    return true;
  });
  revalidatePath("/admin/documents");
  return ok;
}

// Corrections ---------------------------------------------------------------------------
// The admin corrects an answer marked "not helpful" (or left unanswered): the question and the
// right answer become a Q&A document the bot reads from then on, and the answer leaves the
// review list.

export type CorrectionResult =
  | { ok: true }
  | { ok: false; error: "missingFields" | "failed" }
  | { ok: false; error: "pii"; reasons: PrivacyReason[] };

export async function saveCorrection(input: {
  messageId: string;
  topic: string;
  question: string;
  answer: string;
}): Promise<CorrectionResult> {
  const user = await requireAdmin();
  const topic = cleanName(input.topic, 80);
  const question = input.question.trim().slice(0, 2000);
  const answer = input.answer.trim().slice(0, 10000);
  if (!topic || !question || !answer) return { ok: false, error: "missingFields" };
  const reasons = detectIdentifiers(`${question}\n${answer}`);
  if (reasons.length) return { ok: false, error: "pii", reasons };
  const content = `${t("corrections.questionLabel")}: ${question}\n\n${t("corrections.answerLabel")}: ${answer}`;
  try {
    await db().begin(async (tx) => {
      const topicRow = await topicId(tx, topic);
      const [doc] = await tx<{ id: string }[]>`
        insert into chatbot.documents (topic_id, kind, title, content, uploaded_by)
        values (${topicRow}, 'qa', ${cleanName(question, 200)}, ${content}, ${user.email})
        returning id`;
      const updated = await tx`
        update chatbot.messages set resolved_at = now(), resolved_document_id = ${doc.id}
        where id = ${input.messageId} and role = 'assistant'
        returning id`;
      if (updated.length !== 1) throw new Error("answer not found");
    });
  } catch (error) {
    console.error(`save correction failed: ${describeError(error)}`);
    return { ok: false, error: "failed" };
  }
  revalidatePath("/admin/usage");
  revalidatePath("/admin/documents");
  return { ok: true };
}

/** Removes an answer from the review list without adding anything to the knowledge base. */
export async function dismissReview(messageId: string): Promise<boolean> {
  await requireAdmin();
  const rows = await db()`
    update chatbot.messages set resolved_at = now()
    where id = ${messageId} and role = 'assistant' and resolved_at is null
    returning id`;
  revalidatePath("/admin/usage");
  return rows.length === 1;
}
