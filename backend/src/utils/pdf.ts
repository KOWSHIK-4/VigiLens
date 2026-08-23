/**
 * Minimal, dependency-free PDF writer for report downloads.
 *
 * Produces a structurally valid PDF 1.4 document: catalog, page tree,
 * one or more pages of plain Helvetica text, font resource and a correct
 * xref table. Text is sanitized to WinAnsi-safe characters and escaped
 * per the PDF string literal rules.
 */

const LINES_PER_PAGE = 48;
const PAGE_WIDTH = 612; // US Letter, points
const PAGE_HEIGHT = 792;
const MARGIN_TOP = 742;
const LINE_HEIGHT = 14;
const LEFT_MARGIN = 48;
const FONT_SIZE_TITLE = 16;
const FONT_SIZE_BODY = 10;

function escapePdfString(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[^\x20-\x7E]/g, "?");
}

function chunk<T>(items: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    pages.push(items.slice(i, i + size));
  }
  return pages.length > 0 ? pages : [[]];
}

export function buildPdfDocument(title: string, lines: string[]): Buffer {
  const contentLines = [`Title: ${title}`, "", ...lines];
  const pageChunks = chunk(contentLines, LINES_PER_PAGE);

  const objects: string[] = [];
  // Object ids: 1 catalog, 2 pages tree, 3 font, then per page a page
  // object followed by its content-stream object.
  const firstPageObjId = 4;

  const pageObjIds: number[] = [];
  const contentObjIds: number[] = [];
  pageChunks.forEach((_, index) => {
    pageObjIds.push(firstPageObjId + index * 2);
    contentObjIds.push(firstPageObjId + index * 2 + 1);
  });

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] =
    `<< /Type /Pages /Count ${pageObjIds.length} /Kids [${pageObjIds
      .map((id) => `${id} 0 R`)
      .join(" ")}] >>`;
  objects[3] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";

  pageChunks.forEach((pageLines, index) => {
    const pageId = pageObjIds[index];
    const contentId = contentObjIds[index];

    let stream = "BT\n";
    pageLines.forEach((line, lineIndex) => {
      const fontSize = index === 0 && lineIndex === 0 ? FONT_SIZE_TITLE : FONT_SIZE_BODY;
      const y = MARGIN_TOP - lineIndex * LINE_HEIGHT;
      if (y < LINE_HEIGHT) return;
      stream += `/F1 ${fontSize} Tf\n${LEFT_MARGIN} ${y} Td\n(${escapePdfString(line)}) Tj\n`;
    });
    stream += "ET";

    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  });

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(pdf, "latin1");
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "latin1");
}
