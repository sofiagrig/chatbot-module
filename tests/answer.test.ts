import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAnswer } from "../src/lib/answer.ts";

const id1 = "0b6c1c5e-1f7a-4f7e-9a51-3e2d7c0f1a11";
const id2 = "8f2d9e10-77aa-4c3b-8e2e-5b1f6c9d2e22";

test("reads sources and strips the marker", () => {
  const r = parseAnswer(`1. שולחים במייל.\n\n[[sources: ${id1}, ${id2.toUpperCase()}]]`);
  assert.equal(r.content, "1. שולחים במייל.");
  assert.deepEqual(r.sourceIds, [id1, id2]);
  assert.equal(r.noAnswer, false);
});

test("reads no_answer, repeatedly (no regex state between calls)", () => {
  for (let i = 0; i < 3; i++) {
    const r = parseAnswer("לא מצאתי מידע על זה בנהלים. [[no_answer]]");
    assert.equal(r.noAnswer, true);
    assert.equal(r.content, "לא מצאתי מידע על זה בנהלים.");
    assert.deepEqual(r.sourceIds, []);
  }
});

test("ignores text that is not an id", () => {
  assert.deepEqual(parseAnswer("[[sources: נוהל משרד הבטחון]]").sourceIds, []);
});
