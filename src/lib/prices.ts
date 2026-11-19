// Price-list parsing and totals. Pure functions (no server imports) for unit tests.

export type PriceRow = { sku: string; description: string; price: number; notes: string | null };

export type ParseResult = {
  rows: PriceRow[];
  /** Problems found, each with the Excel row number. Saving is refused while any exist. */
  errors: { row: number; code: "missing_sku" | "missing_description" | "bad_price" | "duplicate_sku"; value?: string }[];
  /** True when the header row (SKU, description, price) could not be found. */
  noHeader: boolean;
};

const HEADER = {
  sku: /^(מק["'״׳]?\s*ט(\s*פריט)?|מקט|sku|קוד(\s*טיפול)?)$/i,
  description: /^(תי?אור(\s*(טיפול|פריט))?|שם\s*טיפול|טיפול|description)$/i,
  price: /^(מחיר(\s*פריט)?|תעריף|price)(\s*\(.*\))?$/i,
  notes: /^(הערות?|notes?)$/i,
};

const clean = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();

/** "1,811.70 ₪" → 1811.7; returns null for anything that is not a plain amount. */
export function parsePrice(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  const text = clean(value).replace(/[₪$,\s]|ש["״]?ח/g, "");
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  return Number(text);
}

/**
 * Reads a sheet given as rows of cell values (first row = Excel row 1). Finds the header row
 * within the first 15 rows, then takes every following row that has any value.
 */
export function parsePriceMatrix(matrix: unknown[][]): ParseResult {
  let headerIndex = -1;
  let cols: { sku: number; description: number; price: number; notes: number } | null = null;
  for (let r = 0; r < Math.min(matrix.length, 15) && !cols; r++) {
    const cells = matrix[r].map(clean);
    const find = (re: RegExp) => cells.findIndex((c) => re.test(c));
    const sku = find(HEADER.sku);
    const description = find(HEADER.description);
    const price = find(HEADER.price);
    if (sku >= 0 && description >= 0 && price >= 0) {
      headerIndex = r;
      cols = { sku, description, price, notes: find(HEADER.notes) };
    }
  }
  if (!cols) return { rows: [], errors: [], noHeader: true };

  const rows: PriceRow[] = [];
  const errors: ParseResult["errors"] = [];
  const seen = new Set<string>();
  for (let r = headerIndex + 1; r < matrix.length; r++) {
    const cells = matrix[r];
    if (!cells || cells.every((c) => clean(c) === "")) continue;
    const excelRow = r + 1;
    const sku = clean(cells[cols.sku]);
    const description = clean(cells[cols.description]);
    const price = parsePrice(cells[cols.price]);
    const notes = cols.notes >= 0 ? clean(cells[cols.notes]) || null : null;
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
  const lines = items.map((i) => ({ ...i, lineTotal: round2(i.unitPrice * i.quantity) }));
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
