import { test } from "node:test";
import assert from "node:assert/strict";
import { pageMarker, searchTerms, splitIntoSections } from "../src/lib/sections.ts";

test("short text is one section", () => {
  const sections = splitIntoSections("שורה אחת\nשורה שתיים");
  assert.equal(sections.length, 1);
  assert.equal(sections[0].content, "שורה אחת\nשורה שתיים");
  assert.equal(sections[0].page, null);
});

test("long text is split near the target size, with page numbers", () => {
  const clause = (n: number) => `${n}. סעיף מספר ${n} ${"מילים ".repeat(60)}`;
  const text = [pageMarker(1), clause(1), clause(2), pageMarker(2), clause(3), clause(4), clause(5)].join("\n");
  const sections = splitIntoSections(text, 700);
  assert.ok(sections.length >= 3, `expected several sections, got ${sections.length}`);
  for (const s of sections) assert.ok(s.content.length < 1400, "sections stay near the target size");
  assert.equal(sections[0].page, 1);
  assert.equal(sections.at(-1)!.page, 2);
  assert.ok(!sections.some((s) => s.content.includes("[עמוד")), "page markers are not part of the text");
  assert.deepEqual(sections.map((s) => s.idx), sections.map((_, i) => i));
  // Every clause can be found in some section.
  for (const n of [1, 2, 3, 4, 5]) assert.ok(sections.some((s) => s.content.includes(`${n}. סעיף מספר ${n}`)));
});

test("each section repeats the last line of the previous one", () => {
  const lines = Array.from({ length: 40 }, (_, i) => `שורה ${i} ${"טקסט ".repeat(10)}`);
  const sections = splitIntoSections(lines.join("\n"), 500);
  for (let i = 1; i < sections.length; i++) {
    const lastOfPrevious = sections[i - 1].content.split("\n").at(-1)!;
    assert.equal(sections[i].content.split("\n")[0], lastOfPrevious);
  }
});

test("search terms drop common words and add the word without a prefix", () => {
  const { words, groups } = searchTerms("האם יש כיסוי לכתר של חרסינה?");
  assert.deepEqual(words, ["כיסוי", "יסוי", "לכתר", "כתר", "חרסינה"]);
  assert.deepEqual(groups, [0, 0, 1, 1, 2]);
});

test("search terms ignore quotes and short words", () => {
  const { words } = searchTerms('תקופת "אכשרה" ו 5');
  assert.deepEqual(words, ["תקופת", "אכשרה"]);
});
