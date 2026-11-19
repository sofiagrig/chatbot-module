import "server-only";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { transcribePdf } from "./claude";
import { db } from "./db";
import { parsePriceMatrix, type ParseResult } from "./prices";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const CHUNK_BYTES = 3 * 1024 * 1024;

export const PROCEDURE_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
};
export const PRICE_LIST_TYPES: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export const extensionOf = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";

/** The assembled bytes of an uploaded file (null if missing or not finished). */
export async function readFile(fileId: string): Promise<{ name: string; data: Buffer } | null> {
  const [row] = await db()<{ file_name: string; data: Buffer | null }[]>`
    select file_name, data from chatbot.files where id = ${fileId}`;
  return row?.data ? { name: row.file_name, data: row.data } : null;
}

/** Extracts readable text from a procedure file. PDFs go through Claude (tables, images). */
export async function extractText(file: { name: string; data: Buffer }): Promise<string> {
  switch (extensionOf(file.name)) {
    case "pdf":
      return transcribePdf(file.data);
    case "docx": {
      const { value } = await mammoth.extractRawText({ buffer: file.data });
      return value.replace(/\n{3,}/g, "\n\n").trim();
    }
    case "txt":
    case "md":
      return file.data.toString("utf8").trim();
    default:
      throw new Error("unsupported file type");
  }
}

/** Reads the first worksheet of an Excel price list. */
export async function parsePriceFile(file: { data: Buffer }): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file.data as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { rows: [], errors: [], noHeader: true };
  const matrix: unknown[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const values: unknown[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      values[col - 1] = cellValue(cell.value);
    });
    matrix[rowNumber - 1] = values;
  });
  for (let i = 0; i < matrix.length; i++) matrix[i] ??= [];
  return parsePriceMatrix(matrix);
}

function cellValue(value: ExcelJS.CellValue): unknown {
  if (value && typeof value === "object") {
    if ("result" in value) return value.result; // formula
    if ("richText" in value) return value.richText.map((r) => r.text).join("");
    if ("text" in value) return value.text; // hyperlink
  }
  return value;
}
