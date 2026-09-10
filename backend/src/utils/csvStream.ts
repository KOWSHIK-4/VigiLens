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

export function csvHeaderLine(headers: string[]): string {
  return headers.join(",") + "\n";
}

export function csvLine(values: unknown[]): string {
  return values.map(csvCell).join(",") + "\n";
}

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
): Promise<void> {
  try {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.write(csvHeaderLine(headers));
    for await (const row of rows) {
      if (res.writableEnded) return;
      if (!res.write(csvLine(row))) {
        await waitForDrain(res);
      }
    }
    res.end();
  } catch (err) {
    if (!res.writableEnded) {
      res.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  }
}