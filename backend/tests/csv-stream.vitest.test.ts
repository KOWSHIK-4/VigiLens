import { describe, it, expect } from "vitest";
import { csvHeaderLine, csvLine, sendCsvStream } from "../src/utils/csvStream";

/**
 * Minimal stand-in for an express Response that lets tests simulate a slow
 * socket (write() returning false) and fire drain callbacks manually.
 */
function makeResponse(blockAfterWrites = Infinity) {
  const drainListeners: Array<() => void> = [];
  const res = {
    writableEnded: false,
    chunks: [] as string[],
    writesRemaining: blockAfterWrites,
    destroyedError: null as Error | null,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      res.headers[name] = value;
    },
    write(chunk: string) {
      if (res.writableEnded) return false;
      res.chunks.push(chunk);
      res.writesRemaining -= 1;
      return res.writesRemaining >= 0;
    },
    once(_event: string, cb: () => void) {
      drainListeners.push(cb);
    },
    end() {
      res.writableEnded = true;
    },
    destroy(err?: Error) {
      res.writableEnded = true;
      res.destroyedError = err ?? new Error("destroyed");
    },
    relieve() {
      res.writesRemaining = Infinity;
      for (const cb of drainListeners.splice(0)) cb();
    },
  };
  return res;
}

async function* rows(arr: Array<Array<unknown>>): AsyncGenerator<Array<unknown>> {
  for (const r of arr) yield r;
}

describe("csvHeaderLine", () => {
  it("joins headers with commas and a trailing newline", () => {
    expect(csvHeaderLine(["ID", "Label"])).toBe("ID,Label\n");
  });
});

describe("csvLine", () => {
  it("quotes cells and neutralises formula injection", () => {
    expect(csvLine(["a", '=HYPERLINK("x","y")', "+SUM(A1:A9)"])).toBe(
      '"a","\'=HYPERLINK(""x"",""y"")","\'+SUM(A1:A9)"\n',
    );
  });

  it("escapes embedded quotes", () => {
    expect(csvLine(["say \"hi\""])).toBe("\"say \"\"hi\"\"\"\n");
  });
});

describe("sendCsvStream", () => {
  it("writes the header then each row and ends the response", async () => {
    const res = makeResponse();
    await sendCsvStream(res, ["A", "B"], rows([
      [1, 2],
      [3, 4],
    ]));
    expect(res.writableEnded).toBe(true);
    expect(res.chunks.join("")).toBe("A,B\n\"1\",\"2\"\n\"3\",\"4\"\n");
    expect(res.headers["Content-Type"]).toBe("text/csv; charset=utf-8");
  });

  it("pauses on back-pressure and resumes once the socket drains", async () => {
    const res = makeResponse(1); // the header write bounces
    const done = sendCsvStream(res, ["H"], rows([["a"], ["b"]]));

    await Promise.resolve();
    expect(res.chunks.join("")).toBe("H\n"); // paused at the first row
    expect(res.writableEnded).toBe(false);

    res.relieve();
    await done;
    expect(res.writableEnded).toBe(true);
    expect(res.chunks.join("")).toBe("H\n\"a\"\n\"b\"\n");
  });

  it("destroys the response if the iterator errors mid-stream", async () => {
    const res = makeResponse();
    await sendCsvStream(res, ["H"], (async function* () {
      yield ["ok"];
      throw new Error("boom");
    })());
    expect(res.destroyedError).not.toBeNull();
    expect(res.destroyedError?.message).toBe("boom");
  });

  it("stops writing once the response has ended", async () => {
    const res = makeResponse();
    await sendCsvStream(res, ["H"], (async function* () {
      yield ["first"];
      res.end();
      yield ["never"];
    })());
    expect(res.chunks.join("")).toBe("H\n\"first\"\n");
  });
});