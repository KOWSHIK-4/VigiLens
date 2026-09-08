import { describe, it, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_SRC = path.resolve(__dirname, "../src");
const BACKEND_ROUTES = path.resolve(BACKEND_SRC, "routes");
const FRONTEND_SRC = path.resolve(__dirname, "../../frontend/src");
const ENV_EXAMPLES = [
  path.resolve(__dirname, "../.env.example"),
  path.resolve(__dirname, "../../.env.example"),
  path.resolve(__dirname, "../../ai/.env.example"),
  path.resolve(__dirname, "../../frontend/.env.example"),
];

/** Recursively lists source files, skipping dependency and build output. */
async function walkSourceFiles(dir: string, extensions: string[]): Promise<string[]> {
  if (!dir) return [];
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkSourceFiles(full, extensions)));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

describe("console usage guard", () => {
  it("backend src never logs to the console directly", async () => {
    const files = await walkSourceFiles(BACKEND_SRC, [".ts"]);
    const offenders: string[] = [];
    for (const file of files) {
      const content = await readFile(file, "utf8");
      if (content.includes("console.log(") || content.includes("console.info(")) {
        offenders.push(path.relative(BACKEND_SRC, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("only the startup config module may emit warn/error without the logger", async () => {
    const files = await walkSourceFiles(BACKEND_SRC, [".ts"]);
    const offenders: string[] = [];
    for (const file of files) {
      const content = await readFile(file, "utf8");
      if (
        (content.includes("console.warn(") || content.includes("console.error(")) &&
        !file.endsWith(path.join("config", "index.ts")) &&
        !file.includes(`${path.sep}tests${path.sep}`)
      ) {
        offenders.push(path.relative(BACKEND_SRC, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("frontend src never logs to the console with console.log", async () => {
    const files = await walkSourceFiles(FRONTEND_SRC, [".ts", ".tsx"]);
    const offenders: string[] = [];
    for (const file of files) {
      const content = await readFile(file, "utf8");
      if (content.includes("console.log(")) {
        offenders.push(path.relative(FRONTEND_SRC, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("route authentication guard", () => {
  it("every API route group except health requires authentication", async () => {
    const routeFiles = (await readdir(BACKEND_ROUTES)).filter((f) =>
      f.endsWith(".routes.ts"),
    );
    const unguarded: string[] = [];
    for (const file of routeFiles) {
      if (file === "health.routes.ts") continue;
      const content = await readFile(path.join(BACKEND_ROUTES, file), "utf8");
      if (!content.includes("authenticate")) {
        unguarded.push(file);
      }
    }
    expect(unguarded).toEqual([]);
  });

  it("health routes stay public (liveness/probes must not require auth)", async () => {
    const content = await readFile(
      path.join(BACKEND_ROUTES, "health.routes.ts"),
      "utf8",
    );
    expect(content).not.toContain("authenticate");
  });
});

describe("env example placeholder guard", () => {
  it("secret-shaped env example values only contain placeholders", async () => {
    const placeholderMarkers = ["change_me", "dev-", "secret", "example", "your"];
    const offenders: string[] = [];
    for (const file of ENV_EXAMPLES) {
      const content = await readFile(file, "utf8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const match = /^([A-Z0-9_]+)=(.*)$/.exec(trimmed);
        if (!match) continue;
        const key = match[1];
        const value = match[2].trim();
        if (!/(SECRET|PASSWORD|KEY|TOKEN)/.test(key)) continue;
        if (/^[0-9]+$/.test(value) || value.startsWith("true") || value.startsWith("false")) {
          continue;
        }
        if (!placeholderMarkers.some((marker) => value.toLowerCase().includes(marker))) {
          offenders.push(`${path.basename(file)}: ${key}=${value}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});