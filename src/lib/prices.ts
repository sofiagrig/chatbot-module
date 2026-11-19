// Price-list parsing and totals. Pure functions (no server imports) for unit tests.

export type PriceRow = { sku: string; description: string; price: number; notes: string | null };

export type ParseResult = {
  rows: PriceRow[];
  /** Problems found, each with the Excel row number. Saving is refused while any exist. */
  errors: { row: number; code: "missing_sku" | "missing_description" | "bad_price" | "duplicate_sku"; value?: string }[];
  /** True when the code (SKU), description and price columns could not be identified. */
  noHeader: boolean;
};

type Column = "sku" | "description" | "price" | "group" | "notes";

const HEADER: Record<Column, RegExp> = {
  sku: /^(מק["'״׳]?\s*ט(\s*פריט)?|מקט|sku|קוד(\s*(טיפול|פריט))?)$/i,
  description: /^(תי?אור(\s*(טיפול|פריט))?|שם\s*(ה)?טיפול|טיפול|description)$/i,
  price: /^(מחיר(\s*(פריט|לפני מע["״]?מ|כולל מע["״]?מ))?|תעריף|price)(\s*\(.*\))?$/i,
  group: /^(קבוצה|קטגוריה|תחום|group|category)$/i,
  notes: /^(הערות?|notes?)$/i,
};

const clean = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();

/** "1,811.70 ₪" → 1811.7; returns null for anything that is not a plain amount. */
export function parsePrice(value: unknown): number | null {
  // Excel often stores 769.8 as 769.8000000000001; prices keep two decimals.
  const round = (n: number) => Math.round(n * 100) / 100;
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? round(value) : null;
  const text = clean(value).replace(/[₪$,\s]|ש["״]?ח/g, "");
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  return round(Number(text));
}

/** A header row is one where at least two cells name known columns (code, description, ...). */
function findHeader(matrix: unknown[][]): { index: number; cols: Partial<Record<Column, number>> } | null {
  for (let r = 0; r < Math.min(matrix.length, 15); r++) {
    const cells = (matrix[r] ?? []).map(clean);
    const cols: Partial<Record<Column, number>> = {};
    for (const key of Object.keys(HEADER) as Column[]) {
      const i = cells.findIndex((c) => HEADER[key].test(c));
      if (i >= 0) cols[key] = i;
    }
    if (Object.keys(cols).length >= 2) return { index: r, cols };
  }
  return null;
}

/**
 * Fills in columns the header did not name (or all of them, when there is no header) from the
 * data itself: the price is the right-most column that is almost always a number; the
 * description is the text column with the longest values; the code is the short text column
 * whose values are (almost) all different; a short text column that repeats is the group.
 */
function inferColumns(rows: unknown[][], known: Partial<Record<Column, number>>): Partial<Record<Column, number>> {
  const cols = { ...known };
  const sample = rows.filter((r) => r && r.some((c) => clean(c) !== "")).slice(0, 100);
  if (sample.length === 0) return cols;
  const width = Math.max(...sample.map((r) => r.length));
  const taken = () => new Set(Object.values(cols));
  const stats = Array.from({ length: width }, (_, c) => {
    const values = sample.map((r) => clean(r[c])).filter(Boolean);
    const numeric = values.filter((v) => parsePrice(v) !== null).length;
    return {
      c,
      filled: values.length / sample.length,
      numeric: values.length ? numeric / values.length : 0,
      avgLength: values.length ? values.reduce((n, v) => n + v.length, 0) / values.length : 0,
      unique: values.length ? new Set(values).size / values.length : 0,
    };
  });
  if (cols.price === undefined) {
    const candidates = stats.filter((s) => !taken().has(s.c) && s.filled >= 0.8 && s.numeric >= 0.9);
    if (candidates.length) cols.price = candidates[candidates.length - 1].c;
  }
  const text = () => stats.filter((s) => !taken().has(s.c) && s.filled >= 0.8 && s.numeric < 0.5);
  if (cols.description === undefined) {
    const longest = [...text()].sort((a, b) => b.avgLength - a.avgLength)[0];
    if (longest) cols.description = longest.c;
  }
  if (cols.sku === undefined) {
    const codes = text()
      .filter((s) => s.unique >= 0.9 && s.avgLength <= 20)
      .sort((a, b) => b.unique - a.unique || a.avgLength - b.avgLength);
    if (codes[0]) cols.sku = codes[0].c;
  }
  if (cols.group === undefined) {
    const group = text()
      .filter((s) => s.unique < 0.9 && s.avgLength <= 30)
      .sort((a, b) => a.unique - b.unique)[0];
    if (group) cols.group = group.c;
  }
  return cols;
}

/**
 * Reads a sheet given as rows of cell values (first row = Excel row 1). Works with a header row
 * (within the first 15 rows) or without one, and takes every following row that has any value.
 * A group/category column, if any, is kept with the row's notes (it helps the search).
 */
export function parsePriceMatrix(matrix: unknown[][]): ParseResult {
  const header = findHeader(matrix);
  const start = header ? header.index + 1 : 0;
  const cols = inferColumns(matrix.slice(start), header?.cols ?? {});
  if (cols.sku === undefined || cols.description === undefined || cols.price === undefined) {
    return { rows: [], errors: [], noHeader: true };
  }

  const rows: PriceRow[] = [];
  const errors: ParseResult["errors"] = [];
  const seen = new Set<string>();
  for (let r = start; r < matrix.length; r++) {
    const cells = matrix[r];
    if (!cells || cells.every((c) => clean(c) === "")) continue;
    const excelRow = r + 1;
    const sku = clean(cells[cols.sku]);
    const description = clean(cells[cols.description]);
    const price = parsePrice(cells[cols.price]);
    const extra = [cols.group, cols.notes].filter((c): c is number => c !== undefined).map((c) => clean(cells[c]));
    const notes = extra.filter(Boolean).join(" · ") || null;
    if (!sku) errors.push({ row: excelRow, code: "missing_sku" });
    if (!description) errors.push({ row: excelRow, code: "missing_description" });
    if (price === null) errors.push({ row: excelRow, code: "bad_price", value: clean(cells[cols.price]) });
    if (sku && seen.has(sku)) errors.push({ row: excelRow, code: "duplicate_sku", value: sku });
    if (sku) seen.add(sku);
    if (sku && description && price !== null) rows.push({ sku, description, price, notes });
  }
  return { rows, errors, noHeader: false };
}

export type CalcItem = {
  sku: string;
  description: string;
  priceList: string;
  unitPrice: number;
  vatIncluded: boolean;
  quantity: number;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Totals for a set of price-list lines. Lines from lists without VAT get VAT added; lines
 * from lists that already include VAT are split back into net + VAT.
 */
export function calculateTotal(items: CalcItem[], vatRate: number) {
  const lines = items.map((i) => {
    const lineTotal = round2(i.unitPrice * i.quantity);
    return { ...i, lineTotal, lineTotalBeforeVat: round2(i.vatIncluded ? lineTotal / (1 + vatRate) : lineTotal) };
  });
  let net = 0;
  let gross = 0;
  for (const l of lines) {
    if (l.vatIncluded) {
      gross += l.lineTotal;
      net += l.lineTotal / (1 + vatRate);
    } else {
      net += l.lineTotal;
      gross += l.lineTotal * (1 + vatRate);
    }
  }
  const totalBeforeVat = round2(net);
  const total = round2(gross);
  return { lines, totalBeforeVat, vatRate, vat: round2(total - totalBeforeVat), total };
}
