import "server-only";
import { getDocumentProxy } from "unpdf";
import { pageMarker } from "./sections";

const HEBREW = /[֐-׿]/;

type Item = { x: number; text: string };

/**
 * Plain text of a PDF, page by page, with a "[עמוד N]" line before each page. Used for long PDFs
 * (Claude transcription is limited in length). PDF text pieces come in drawing order, so each line
 * is rebuilt from its pieces by position: right to left when the line has Hebrew.
 */
export async function pdfToText(data: Buffer): Promise<{ pages: number; text: string }> {
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const out: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const { items } = await page.getTextContent();
    const lines: { y: number; height: number; items: Item[] }[] = [];
    for (const item of items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const [, , , scaleY, x, y] = item.transform as number[];
      const height = Math.abs(scaleY) || 10;
      let line = lines.find((l) => Math.abs(l.y - y) < Math.min(l.height, height) * 0.5);
      if (!line) lines.push((line = { y, height, items: [] }));
      line.items.push({ x, text: item.str });
    }
    lines.sort((a, b) => b.y - a.y);
    const text = lines
      .map((line) => {
        const rtl = line.items.some((i) => HEBREW.test(i.text));
        line.items.sort((a, b) => (rtl ? b.x - a.x : a.x - b.x));
        return line.items
          .map((i) => i.text)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
      })
      .filter(Boolean)
      .join("\n");
    page.cleanup();
    if (text) out.push(`${pageMarker(n)}\n${text}`);
  }
  const pages = pdf.numPages;
  await pdf.cleanup();
  return { pages, text: out.join("\n\n") };
}
