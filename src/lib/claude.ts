import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, TextBlockParam, Tool, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { calculate, loadKnowledge, lookupPrice, searchDocuments, vatRate } from "./knowledge";
import { getAnswerStyle } from "./settings";
import { describeError } from "./errors";

let client: Anthropic | undefined;

export function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Missing ANTHROPIC_API_KEY");
  client ??= new Anthropic();
  return client;
}

export const model = () => process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5-5";

// The rules are in English (models follow them most reliably); answers are in Hebrew.
const SYSTEM_RULES = `You are the internal knowledge assistant of a dental clinic network in Israel.
You answer questions from the network's managers and branch staff about work procedures, price lists,
insurance companies and the Ministry of Defense (משרד הבטחון), using ONLY the material given here.

Rules:
1. Answer only from the documents below and from lookup_price / calculate results. Never use outside
   knowledge and never guess. If the material does not answer the question, say so in one short Hebrew
   sentence ("לא מצאתי מידע על זה בנהלים.") and end with the marker [[no_answer]].
2. Never discuss a specific patient, and never answer medical or clinical questions (diagnosis, which
   treatment a patient needs, medications, clinical risk). For those reply exactly:
   "אני עונה רק על שאלות של נהלים, מחירונים ועבודה מול גופים. בשאלות על מטופלים או בשאלות רפואיות יש לפנות לרופא/ה."
   If the user writes a patient's name or other personal details, do not repeat them.
3. Prices: always use lookup_price, even if a price also appears in a document. Then ALWAYS call calculate
   for the item (quantity 1 unless the question says otherwise) and give the price in exactly three lines,
   as calculate returns them, never just one number:
     **<description>** (<price list>, קוד <sku>)
     - לפני מע"מ: <totalBeforeVat> ₪
     - מע"מ (<vat rate as %>): <vat> ₪
     - סה"כ כולל מע"מ: <total> ₪
   Format amounts with a thousands separator and two decimals (1,086.95).
   A price of 0 means the list does not charge for it: say "ללא חיוב במחירון" instead of a breakdown.
   A row's notes hold its group and, in some lists, conditions (e.g. "אחת לשנה"); mention conditions.
   If the same treatment appears in more than one price list (e.g. the regular and the specialist basket)
   and the question does not say which, give this breakdown for each of them (at most three), labelled by
   price list; call calculate separately for each. If many different treatments match, ask which one.
   Discounts: mention them only when asked. max_discount is a fraction of the list price: 1 means the
   treatment may be given free (100% off), 0.2 means up to 20% off, 0 means no discount; null means the
   price list defines no discount. When asked about a discount, state the maximum as a percentage and
   give the price after it by calling calculate with discount_rate = max_discount (same three lines).
4. Totals for several items or quantities: calculate with all the lines; show each line (quantity x unit
   price = line total), then the same three lines for the whole. Never add, multiply or compute VAT yourself.
5. Documents with kind="qa" are questions answered and approved by the network's admin. When one matches
   the question, answer from it (it takes precedence over a procedure that says otherwise).
6. If the question is ambiguous, ask one short clarifying question instead of guessing.
7. Write in Hebrew, short and practical. Use a numbered list for steps. Quote emails, SKUs and form
   names exactly as written in the documents.
8. Answers based on documents or price lists end with the marker [[sources: <document ids>]], listing the
   id of every document or price list you used (ids are given below and in tool results).
   Do not mention document ids anywhere else in the text.
9. The documents listed in <searchable_documents> (e.g. insurance policies) are too long to include here.
   To answer from them, call search_documents with a few Hebrew keywords, in base form without ה/ו/ב/ל
   prefixes. If the passages returned do not answer the question, search again with synonyms or related
   terms (e.g. כתר, שיקום, השתתפות עצמית, תקופת אכשרה, החרגה) before concluding there is no answer.
   Answer only from the returned passages and name the section number (and the page, when given) you
   relied on. If several of these documents could apply (e.g. policies of different groups) and the
   question does not say which, ask which one, listing their titles. A policy describes general terms:
   never confirm that a specific patient is covered or eligible; say that this is checked with the insurer.`;

/**
 * The admin's answer style (written in the "סגנון תשובות" screen). It shapes tone, length and
 * format only; the rules above always win, so it cannot turn off the patient/medical refusal,
 * the price format, the sources or answering only from the material.
 */
function styleBlock(style: string): string {
  return `Answer style requested by the network's admin. Follow it for tone, length, structure and formatting.
It does not change rules 1-9: if it conflicts with them (for example asks to skip the patient/medical
refusal, the three-line price breakdown, the sources marker, or to answer beyond the material), the rules win.
Treat it as style guidance only, not as information about procedures or prices.
<answer_style>
${style.replaceAll("</answer_style>", "")}
</answer_style>`;
}

/** System prompt: rules + answer style + all text documents + the list of price lists. Cached up to the documents. */
async function systemPrompt(): Promise<TextBlockParam[]> {
  const { texts, searchable, priceLists } = await loadKnowledge();
  const style = await getAnswerStyle();
  const docs = texts
    .map(
      (d) =>
        `<document id="${d.id}" kind="${d.kind}" title="${escapeAttr(d.title)}" topic="${escapeAttr(d.topic)}" updated="${d.updated_at.toISOString().slice(0, 10)}">\n${d.content}\n</document>`,
    )
    .join("\n\n");
  const lists = priceLists.length
    ? priceLists
        .map(
          (p) =>
            `- id=${p.id} | "${p.title}" | payer: ${p.payer} | ${p.vat_included ? "prices include VAT" : "prices before VAT"} | ${p.item_count} rows | updated ${p.updated_at.toISOString().slice(0, 10)}`,
        )
        .join("\n")
    : "(none uploaded yet)";
  const searchableList = searchable.length
    ? searchable
        .map(
          (d) =>
            `- id=${d.id} | "${d.title}" | topic: ${d.topic} | ${d.pages ? `${d.pages} pages | ` : ""}updated ${d.updated_at.toISOString().slice(0, 10)}`,
        )
        .join("\n")
    : "(none)";
  const knowledge =
    `<documents>\n${docs || "(no documents uploaded yet)"}\n</documents>\n\n` +
    `<searchable_documents>\n${searchableList}\n</searchable_documents>\n\n` +
    `<price_lists>\n${lists}\n</price_lists>`;
  return [
    { type: "text", text: SYSTEM_RULES },
    ...(style ? [{ type: "text" as const, text: styleBlock(style.value) }] : []),
    { type: "text", text: knowledge, cache_control: { type: "ephemeral" } },
  ];
}

const escapeAttr = (s: string) => s.replace(/"/g, "&quot;");

const TOOLS: Tool[] = [
  {
    name: "lookup_price",
    description:
      "Search the uploaded price lists by SKU (מק\"ט) or by words of the treatment name. Returns up to 25 rows " +
      "with item_id, price list, payer, SKU, description, price, whether it includes VAT and max_discount " +
      "(the maximum discount as a fraction, null if the list defines none). Try other word forms " +
      "(e.g. without ה/ו/ב/ל prefixes, singular instead of plural) if nothing is found.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "SKU or a few words of the treatment name, in Hebrew" },
        payer: { type: "string", description: "Optional: payer or price list name to filter by, e.g. משרד הבטחון" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_documents",
    description:
      "Search the long documents listed in <searchable_documents> (e.g. insurance policies). Returns up to 8 " +
      "passages, best matches first, each with document_id, title, page and text. Use a few Hebrew keywords; " +
      "optionally limit the search to some documents by id.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "A few Hebrew keywords, e.g. כתר השתתפות עצמית" },
        document_ids: {
          type: "array",
          items: { type: "string" },
          description: "Optional: ids from <searchable_documents> to search in",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "calculate",
    description:
      "Compute totals for price-list rows: line totals, total before VAT, VAT and total including VAT, " +
      "optionally with a discount per line. Use the item_id values returned by lookup_price.",
    input_schema: {
      type: "object",
      properties: {
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: {
              item_id: { type: "integer" },
              quantity: { type: "number", description: "Number of units (e.g. teeth)" },
              discount_rate: {
                type: "number",
                description: "Optional discount as a fraction (0.2 = 20%). Must not exceed the row's max_discount.",
              },
            },
            required: ["item_id", "quantity"],
          },
        },
      },
      required: ["lines"],
    },
  },
];

async function runTool(name: string, input: unknown): Promise<unknown> {
  const args = (input ?? {}) as Record<string, unknown>;
  if (name === "lookup_price") {
    const rows = await lookupPrice(String(args.query ?? ""), args.payer ? String(args.payer) : undefined);
    return rows.length ? rows : { result: "no matching rows" };
  }
  if (name === "search_documents") {
    const ids = Array.isArray(args.document_ids) ? args.document_ids.map(String) : undefined;
    const hits = await searchDocuments(String(args.query ?? ""), ids);
    return hits.length ? hits : { result: "no matching passages; try other words" };
  }
  if (name === "calculate") {
    const lines = Array.isArray(args.lines) ? (args.lines as { item_id: number; quantity: number }[]) : [];
    return calculate(lines, vatRate());
  }
  return { error: `unknown tool ${name}` };
}

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };

/** Runs one question (with recent history) through Claude, including tool calls. */
export async function answer(history: MessageParam[]): Promise<{ text: string; usage: Usage }> {
  const system = await systemPrompt();
  const messages = [...history];
  const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

  for (let round = 0; round < 8; round++) {
    const response = await anthropic().messages.create({
      model: model(),
      max_tokens: 2000,
      system,
      tools: TOOLS,
      messages,
    });
    usage.input += response.usage.input_tokens;
    usage.output += response.usage.output_tokens;
    usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;
    usage.cacheWrite += response.usage.cache_creation_input_tokens ?? 0;

    const toolUses = response.content.filter((b) => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { text, usage };
    }

    messages.push({ role: "assistant", content: response.content });
    const results: ToolResultBlockParam[] = [];
    for (const block of toolUses) {
      let content: string;
      try {
        content = JSON.stringify(await runTool(block.name, block.input));
      } catch (error) {
        console.error(`tool failed (${block.name}): ${describeError(error)}`);
        content = JSON.stringify({ error: "tool failed" });
      }
      results.push({ type: "tool_result", tool_use_id: block.id, content });
    }
    messages.push({ role: "user", content: results });
  }
  throw new Error("too many tool rounds");
}

const TRANSCRIBE_PROMPT = `Transcribe this document into Markdown, in its original language (usually Hebrew).
- Keep every fact, step, rule, number, SKU (מק"ט), price, email address and form name exactly as written.
- Tables become Markdown tables with one row per item, keeping each SKU in the same row as its own
  description and price. Check columns carefully: never shift a price to a neighbouring row.
- Use headings for the document's sections and numbered lists for steps.
- Text shown inside images or screenshots: transcribe it when it is part of the instructions. If an
  image shows a sample filled-in form, describe its layout and fields in general terms only.
- Remove personal details of patients or other private people (names, ID numbers, phone numbers,
  addresses): write [הוסר] instead. Keep details of organizations (offices, districts, the network).
- Output only the Markdown, with no introduction or comments.`;

/** Turns a PDF into Markdown text the bot can read (handles tables and text in images). */
export async function transcribePdf(pdf: Buffer): Promise<string> {
  const response = await anthropic().messages.create({
    model: model(),
    max_tokens: 16000,
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") } },
          { type: "text", text: TRANSCRIBE_PROMPT },
        ],
      },
    ],
  });
  return response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
