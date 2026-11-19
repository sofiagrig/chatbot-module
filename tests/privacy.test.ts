import { test } from "node:test";
import assert from "node:assert/strict";
import { detectIdentifiers, isValidIsraeliId, joinDigitGroups } from "../src/lib/privacy.ts";

test("valid Israeli IDs pass the check digit", () => {
  assert.equal(isValidIsraeliId("000000018"), true);
  assert.equal(isValidIsraeliId("123456782"), true);
  assert.equal(isValidIsraeliId("123456789"), false);
});

test("blocks ID numbers, with or without separators", () => {
  assert.deepEqual(detectIdentifiers("מה לעשות עם מטופל 123456782"), ["israeli_id"]);
  assert.deepEqual(detectIdentifiers("ת.ז 123-456-782"), ["israeli_id"]);
  assert.deepEqual(detectIdentifiers("ת.ז 123 456 782"), ["israeli_id"]);
  // 8 digits, leading zero dropped
  assert.deepEqual(detectIdentifiers("תז 12345674"), ["israeli_id"]);
});

test("blocks phone numbers", () => {
  assert.deepEqual(detectIdentifiers("הטלפון שלו 050-3912349"), ["phone"]);
  assert.deepEqual(detectIdentifiers("050 - 3912349"), ["phone"]);
  assert.deepEqual(detectIdentifiers("0503912349"), ["phone"]);
  assert.deepEqual(detectIdentifiers("03-7776777"), ["phone"]);
  assert.deepEqual(detectIdentifiers("+972 50 391 2349"), ["phone"]);
});

test("blocks long numbers such as referral numbers", () => {
  assert.deepEqual(detectIdentifiers("הפניה 260003260587"), ["long_number"]);
});

test("lets ordinary questions through", () => {
  for (const q of [
    "כמה עולה עקירה כירורגית בסל מומחה?",
    "מק\"ט 29448",
    "מה ההבדל בין 29447 29448 29449?",
    "2 עקירות בשיניים 15,16 ו-3 שיניים 15,16,17",
    "211.7X2=423.4 ועוד 3503X3=10,509",
    "הגשתי ב-1/6/26, מה עכשיו?",
    "מחיר 1,811.70 ₪ לתותבת",
    "הפניית סל 057548 או 057549",
  ]) {
    assert.deepEqual(detectIdentifiers(q), [], q);
  }
});

test("joins only digit groups that belong together", () => {
  assert.equal(joinDigitGroups("050 3912349"), "0503912349");
  assert.equal(joinDigitGroups("29447 29448"), "29447 29448");
  assert.equal(joinDigitGroups("a 1-2 b"), "a 12 b");
});
