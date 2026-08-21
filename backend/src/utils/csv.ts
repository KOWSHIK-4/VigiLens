/**
 * Spreadsheet formula injection guard (OWASP CSV Injection).
 * Cells beginning with = + - @ tab or CR would execute as formulas when
 * the exported file is opened in Excel/LibreOffice; they get a leading
 * apostrophe so the content stays inert text.
 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  let s = String(value ?? "");
  if (FORMULA_PREFIX.test(s)) {
    s = `'${s}`;
  }
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  return [
    headers.join(","),
    ...rows.map((row) => row.map(csvCell).join(",")),
  ].join("\n");
}
