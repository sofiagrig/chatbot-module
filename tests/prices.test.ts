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
    { sku: "29447", description: "עקירת שן רגילה - מומחה", price: 211.7, notes: null, maxDiscount: null },
    { sku: "29448", description: "עקירת שן כירורגית - מומחה", price: 529.2, notes: "לשן", maxDiscount: null },
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

test("sheet without a header row (like the specialist basket file)", () => {
  const result = parsePriceMatrix([
    ["בדיקות", "במ", "הערכה / בדיקה תקופתית של מטופל מוכר ממוקדת בבעיה לפי דווח", 113.2],
    ["שיננית", "נא", "הטריה והסרה של פלאק ואבנית בכל הפה שיננית", 150.8],
    ["משמרת", "ע", "עקירה, שן שבקעה או שורש חשוף, שן אחת", 211.7],
    ["פריו", "המי", "המיסקציה", 557.7],
    ["פריו", "הכ", "הארכת כותרת", 775],
    ["משמרת", "עכ", "עקירה כירורגית - שן כלואה חלקית/מלא ושבקעה לחלל הפה", 1026.6],
    ["פרותטיקה", "כזרק", "כתר זירקוניה", 2328.3],
  ]);
  assert.equal(result.noHeader, false);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows.length, 7);
  assert.deepEqual(result.rows[6], { sku: "כזרק", description: "כתר זירקוניה", price: 2328.3, notes: "פרותטיקה", maxDiscount: null });
});

test("header whose price column is named after the list (like the regular basket file)", () => {
  const result = parsePriceMatrix([
    ["קבוצה", "קוד", "תאור", "סל טיפולי שיניים- רגיל"],
    ["בדיקות", "ב", "בדיקה והערכה ראשונית מפורטת ונרחבת של הפה", 64],
    ["פרותטיקה", "כח", "כתר חרסינה מאוחה למתכת לא אצילה", 1282.6],
    ["יישור שיניים", "קיבוע", "קיבוע אורתודונטי לאחר הסרת מכשור", 769.8000000000001],
  ]);
  assert.equal(result.noHeader, false);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.rows[1], { sku: "כח", description: "כתר חרסינה מאוחה למתכת לא אצילה", price: 1282.6, notes: "פרותטיקה", maxDiscount: null });
  assert.equal(result.rows[2].price, 769.8);
});

test("porcelain crown 1,282.6 including VAT splits into net + VAT", () => {
  const result = calculateTotal(
    [{ sku: "כח", description: "כתר חרסינה", priceList: "רגיל", unitPrice: 1282.6, vatIncluded: true, quantity: 1 }],
    0.18,
  );
  assert.equal(result.totalBeforeVat, 1086.95);
  assert.equal(result.vat, 195.65);
  assert.equal(result.total, 1282.6);
  assert.equal(result.lines[0].lineTotalBeforeVat, 1086.95);
});

test("clinic price list with discount columns takes the list price, not the discount", () => {
  const result = parsePriceMatrix([
    ["קבוצה", "קוד", "תאור", "מחירון 1.2025", "הגדרת רף הנחה מקסימלי", "מחירון לאחר הנחה"],
    ["בדיקות", "ב", "בדיקה והערכה ראשונית מפורטת ונרחבת של הפה", "170", "1", "0"],
    ["בדיקות", "במ", "בדיקת ראשונית רופא שיניים מומחה (אורתו / פריו / כירורג / אחר)", "490", "0.2", "392"],
    ["משמרת", "עבמ", "עקירת שן כירורגית / בינה מומחה", "2150", "0.15", "1827.5"],
    ["כשל", "כששתל", "שתל נדחה", "0", "0", "0"],
  ]);
  assert.equal(result.noHeader, false);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    result.rows.map((r) => [r.sku, r.price]),
    [["ב", 170], ["במ", 490], ["עבמ", 2150], ["כששתל", 0]],
  );
});

test("reads the maximum discount column", () => {
  const result = parsePriceMatrix([
    ["קבוצה", "קוד", "תאור", "מחירון 1.2025", "הגדרת רף הנחה מקסימלי", "מחירון לאחר הנחה"],
    ["בדיקות", "ב", "בדיקה ראשונית", "170", "1", "0"],
    ["בדיקות", "במ", "בדיקת מומחה", "490", "0.2", "392"],
    ["פריו", "עצם", "השתלת עצם", "4944", "25%", "3708"],
    ["כשל", "כששתל", "שתל נדחה", "0", "0", "0"],
    ["פריו", "רע", "שורה עם הנחה שגויה", "100", "1.5", "0"],
  ]);
  assert.deepEqual(
    result.rows.map((r) => [r.sku, r.price, r.maxDiscount]),
    [["ב", 170, 1], ["במ", 490, 0.2], ["עצם", 4944, 0.25], ["כששתל", 0, 0], ["רע", 100, null]],
  );
  assert.deepEqual(result.errors.map((e) => `${e.row}:${e.code}`), ["6:bad_discount"]);
});

test("discount applied to a VAT-inclusive price: 490 with 20% off", () => {
  const result = calculateTotal(
    [{ sku: "במ", description: "בדיקת מומחה", priceList: "מרפאה", unitPrice: 490, vatIncluded: true, quantity: 1, discountRate: 0.2 }],
    0.18,
  );
  assert.equal(result.lines[0].unitPriceAfterDiscount, 392);
  assert.equal(result.total, 392);
  assert.equal(result.totalBeforeVat, 332.2);
  assert.equal(result.vat, 59.8);
});
