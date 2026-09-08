/**
 * Client-side CSV building and download helpers, kept consistent with the
 * backend `utils/csv.ts` so every export shares the quoting rules and the
 * OWASP formula-injection guard.
 *
 * Build the CSV string with `buildClientCSV`, or pass an already-fetched
 * server blob straight to `downloadBlob`.
 */

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  let s = String(value ?? "");
  if (FORMULA_PREFIX.test(s)) {
    s = `'${s}`;
  }
  return `"${s.replace(/"/g, '""')}"`;
}

export function buildClientCSV(headers: string[], rows: Array<Array<unknown>>): string {
  return [headers.join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\n");
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

export function downloadClientCSV(
  filename: string,
  headers: string[],
  rows: Array<Array<unknown>>,
): void {
  const csv = `\uFEFF${buildClientCSV(headers, rows)}`;
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), filename);
}