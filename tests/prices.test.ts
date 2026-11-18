import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateTotal, parsePrice, parsePriceMatrix } from "../src/lib/prices.ts";

test("parses price formats", () => {
  assert.equal(parsePrice("1,811.70 ₪"), 1811.7);
  assert.equal(parsePrice(529.2), 529.2);
  assert.equal(parsePrice("3503"), 3503);
  assert.equal(parsePrice("150 ש\"ח"), 150);
  assert.equal(parsePrice("כלול"), null);
  assert.equal(parsePrice(""), null);
  assert.equal(parsePrice(-5), null);
});

test("finds the header row and reads rows", () => {
  const result = parsePriceMatrix([
    ["מחירון סל מומחה"],
    [],
    ["מק\"ט פריט", "תאור פריט", "מחיר פריט", "הערות"],
    ["29447", "עקירת שן רגילה - מומחה", 211.7, ""],
    ["29448", "עקירת שן כירורגית - מומחה", "529.2", "לשן"],
    [null, null, null],
  ]);
  assert.equal(result.noHeader, false);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.rows, [
    { sku: "29447", description: "עקירת שן רגילה - מומחה", price: 211.7, notes: null },
    { sku: "29448", description: "עקירת שן כירורגית - מומחה", price: 529.2, notes: "לשן" },
  ]);
});

test("reports row problems with Excel row numbers", () => {
  const result = parsePriceMatrix([
    ["מקט", "תיאור", "מחיר"],
    ["1", "א", "abc"],
    ["", "ב", "10"],
    ["1", "ג", "20"],
  ]);
  assert.deepEqual(
    result.errors.map((e) => `${e.row}:${e.code}`),
    ["2:bad_price", "3:missing_sku", "4:duplicate_sku"],
  );
});

test("no header -> noHeader", () => {
  assert.equal(parsePriceMatrix([["a", "b"], ["1", "2"]]).noHeader, true);
});

test("MoD example from the procedure: 2 extractions + sinus lift on 3 teeth", () => {
  const result = calculateTotal(
    [
      { sku: "29447", description: "עקירה", priceList: "מומחה", unitPrice: 211.7, vatIncluded: false, quantity: 2 },
      { sku: "29460", description: "הרמת סינוס", priceList: "מומחה", unitPrice: 3503, vatIncluded: false, quantity: 3 },
    ],
    0.18,
  );
  assert.equal(result.totalBeforeVat, 10932.4);
  assert.equal(result.vat, 1967.83);
  assert.equal(result.total, 12900.23);
  assert.deepEqual(result.lines.map((l) => l.lineTotal), [423.4, 10509]);
});

test("prices that include VAT are split back", () => {
  const result = calculateTotal(
    [{ sku: "1", description: "x", priceList: "y", unitPrice: 118, vatIncluded: true, quantity: 1 }],
    0.18,
  );
  assert.equal(result.total, 118);
  assert.equal(result.totalBeforeVat, 100);
  assert.equal(result.vat, 18);
});
