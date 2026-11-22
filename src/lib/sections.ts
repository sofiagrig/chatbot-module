// Long documents (e.g. 66-page insurance policies) are not sent to the model in full. They are
// split into sections here, stored in chatbot.document_chunks, and searched per question.
// Pure functions (no database), so they can be unit-tested.

/** Documents longer than this are searched instead of being included in every prompt. */
export const LARGE_DOCUMENT_CHARS = 30_000;

/** Page markers written by the PDF text extraction, on a line of their own. */
export const pageMarker = (page: number) => `[עמוד ${page}]`;
const PAGE_MARKER = /^\[עמוד (\d+)\]$/;

/** A line that starts a numbered clause ("4.6.2 ...", "16. ...", "1.א. ..."): a good place to cut. */
const CLAUSE_START = /^\(?\d+(\.\d+)*\.?\)?\s|^\d+\.[א-ת]\.?\s/;

export type Section = { idx: number; page: number | null; content: string };

/**
 * Splits text into sections of about `target` characters, cutting at line boundaries (preferably
 * before a numbered clause or after a blank line). Each section repeats the last line of the one
 * before it, so a clause cut in two can still be found. Page markers set the section's page.
 */
export function splitIntoSections(text: string, target = 1600): Section[] {
  const sections: Section[] = [];
  let page: number | null = null;
  let lines: string[] = [];
  let length = 0;
  let startPage: number | null = null;

  const flush = () => {
    const content = lines.join("\n").trim();
    if (content) sections.push({ idx: sections.length, page: startPage, content });
    const last = lines.at(-1)?.trim() ?? "";
    lines = last && last.length < 300 ? [last] : [];
    length = lines.join("\n").length;
    startPage = page;
  };

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const marker = PAGE_MARKER.exec(line.trim());
    if (marker) {
      page = Number(marker[1]);
      if (length === 0 || startPage === null) startPage = page;
      continue;
    }
    const goodCut = CLAUSE_START.test(line.trim()) || line.trim() === "";
    if (length >= target || (length >= target * 0.6 && goodCut)) flush();
    if (startPage === null) startPage = page;
    if (line.trim() === "" && length === 0) continue;
    lines.push(line);
    length += line.length + 1;
  }
  flush();
  return sections;
}

// Words that appear everywhere and would only add noise to a search.
const STOP_WORDS = new Set([
  "של", "את", "על", "עם", "או", "גם", "כל", "לא", "אם", "מה", "יש", "זה", "זו", "הוא", "היא", "הם",
  "אני", "כמה", "האם", "איך", "עבור", "לגבי", "בין", "אל", "כי", "רק", "אחרי", "לפני", "the", "and",
]);
const PREFIX = /^[והבלמשכ]/;

/**
 * Search words from a question: each word, plus the word without a one-letter Hebrew prefix
 * (ה/ו/ב/ל/מ/ש/כ) for words of 4+ letters. `group` ties a variant to its word, so a word found in
 * two forms still counts once.
 */
export function searchTerms(query: string): { words: string[]; groups: number[] } {
  const words: string[] = [];
  const groups: number[] = [];
  const seen = new Set<string>();
  const tokens = query
    .split(/[\s,;:/?!.()\[\]]+/)
    .map((w) => w.replace(/["'״׳`]/g, "").trim().toLowerCase())
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  let group = 0;
  for (const token of tokens) {
    if (seen.has(token)) continue;
    const variants = [token];
    if (token.length >= 4 && PREFIX.test(token)) variants.push(token.slice(1));
    for (const v of variants) {
      if (seen.has(v)) continue;
      seen.add(v);
      words.push(v);
      groups.push(group);
    }
    group++;
    if (group >= 10) break;
  }
  return { words, groups };
}
