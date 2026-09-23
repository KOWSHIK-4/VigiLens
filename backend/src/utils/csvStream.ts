/**
 * Streaming CSV export helpers.
 *
 * The bulk CSV endpoints (detections, alerts, audit logs) used to load every
 * matching row into memory and concatenate the whole document as a string.
 * For very large ranges that is unbounded. These helpers write the header and
 * each row through an async iterator with proper back-pressure, so memory
 * stays proportional to one page of rows rather than the full result set.
 */
import type { Response } from "express";
import { csvCell } from "./csv";
import { logger } from "../config/logger";

export function csvHeaderLine(headers: string[]): string {
  return headers.join(",") + "\n";
}

export function csvLine(values: unknown[]): string {
  return values.map(csvCell).join(",") + "\n";
}

/**
 * Upper bound on rows written by a single streaming export. Keeps export
 * generation proportional to a configurable cap so a broad filter cannot
 * stream an unbounded result set; reaching the cap closes the document with
 * an explicit comment instead of silently stopping.
 */
export const MAX_EXPORT_ROWS = 100_000;

async function waitForDrain(res: Response): Promise<void> {
  await new Promise<void>((resolve) => res.once("drain", resolve));
}

/**
 * Writes a CSV document to the response in a streaming fashion.
 * The awaitable back-pressure keeps buffered data bounded on slow clients.
 * If the row iterator fails mid-stream the response is aborted.
 */
export async function sendCsvStream(
  res: Response,
  headers: string[],
  rows: AsyncIterable<unknown[]>,
  maxRows: number = MAX_EXPORT_ROWS,
): Promise<void> {
  try {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.write(csvHeaderLine(headers));
    let written = 0;
    for await (const row of rows) {
      if (res.writableEnded) return;
      if (written >= maxRows) {
        logger.warn("CSV export truncated at row cap", { maxRows });
        res.write(`# Export truncated at the first ${maxRows} rows\n`);
        res.end();
        return;
      }
      if (!res.write(csvLine(row))) {
        await waitForDrain(res);
      }
      written += 1;
    }
    res.end();
  } catch (err) {
    if (!res.writableEnded) {
      res.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  }
}