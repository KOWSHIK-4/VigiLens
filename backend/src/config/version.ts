import { readFileSync } from "node:fs";
import path from "node:path";

function loadVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8"),
    ) as { version?: string };
    if (pkg.version) return pkg.version;
  } catch {
    // version stays unknown if package.json is unavailable
  }
  return "0.0.0";
}

export const appVersion = loadVersion();
