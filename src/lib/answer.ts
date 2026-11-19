// Markers the model adds at the end of an answer (see SYSTEM_RULES in claude.ts):
//   [[sources: <document id>, ...]]  documents the answer relied on
//   [[no_answer]]                     the documents do not answer the question
// Pure function for unit tests.

const SOURCES = /\[\[\s*sources?\s*:([^\]]*)\]\]/gi;
const NO_ANSWER = /\[\[\s*no[_ ]answer\s*\]\]/gi;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function parseAnswer(raw: string): { content: string; sourceIds: string[]; noAnswer: boolean } {
  const ids = new Set<string>();
  for (const match of raw.matchAll(SOURCES)) {
    for (const id of match[1].match(UUID) ?? []) ids.add(id.toLowerCase());
  }
  const noAnswer = raw.search(NO_ANSWER) >= 0;
  const content = raw.replace(SOURCES, "").replace(NO_ANSWER, "").trim();
  return { content, sourceIds: [...ids], noAnswer };
}
