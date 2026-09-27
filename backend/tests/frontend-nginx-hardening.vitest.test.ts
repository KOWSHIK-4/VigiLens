import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it, expect } from "vitest";

/**
 * Deployment hardening guard for frontend/nginx.conf.template.
 *
 * In the Docker topology nginx is the edge: it terminates the client
 * connection, serves the SPA, and proxies both /api/ and the public /detect/
 * surface. The backend's own helmet middleware never sees an SPA request, so
 * anything the browser enforces for the app is decided here and nowhere else.
 *
 * These tests pin that edge behavior to the same policy the Express layer
 * already declares, so the two cannot drift apart silently.
 */

const NGINX_TEMPLATE = path.resolve(
  process.cwd(),
  "..",
  "frontend",
  "nginx.conf.template",
);
const ENGINE_ROUTES = path.resolve(
  process.cwd(),
  "src",
  "routes",
  "engine.routes.ts",
);
const SECURITY_HEADERS = path.resolve(
  process.cwd(),
  "src",
  "middleware",
  "securityHeaders.ts",
);

const SIZE_UNITS: Record<string, number> = {
  "": 1,
  k: 1024,
  m: 1024 ** 2,
  g: 1024 ** 3,
};

async function readTemplate(): Promise<string> {
  return readFile(NGINX_TEMPLATE, "utf8");
}

function bytesFromNginxSize(size: string): number {
  const match = /^(\d+)([kmg]?)$/.exec(size.trim().toLowerCase());
  if (!match) throw new Error(`Unparseable nginx size: ${size}`);
  return Number(match[1]) * SIZE_UNITS[match[2]];
}

/** Returns the full text of the first `location <prefix> { ... }` block. */
function locationBlock(content: string, prefix: string): string {
  const start = content.indexOf(`location ${prefix} {`);
  if (start === -1) {
    throw new Error(`No "location ${prefix}" block in the nginx template`);
  }
  let depth = 0;
  for (let i = content.indexOf("{", start); i < content.length; i += 1) {
    if (content[i] === "{") depth += 1;
    else if (content[i] === "}") {
      depth -= 1;
      if (depth === 0) return content.slice(start, i + 1);
    }
  }
  throw new Error(`Unterminated "location ${prefix}" block`);
}

describe("nginx request body limit", () => {
  it("sets an explicit client_max_body_size rather than relying on the 1m default", async () => {
    const content = await readTemplate();
    expect(content).toMatch(/^\s*client_max_body_size\s+\d+[kmg]?\s*;/m);
  });

  it("never caps uploads below what the API's multer limit already accepts", async () => {
    const template = await readTemplate();
    const engineRoutes = await readFile(ENGINE_ROUTES, "utf8");
    const multer = /fileSize:\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)/.exec(engineRoutes);
    expect(multer).not.toBeNull();
    const apiLimit = Number(multer?.[1]) * Number(multer?.[2]) * Number(multer?.[3]);

    const nginxLimit = /client_max_body_size\s+(\d+[kmg]?)\s*;/.exec(template);
    expect(nginxLimit).not.toBeNull();
    expect(bytesFromNginxSize(nginxLimit?.[1] ?? "")).toBeGreaterThanOrEqual(apiLimit);
  });
});

describe("nginx security headers match the Express policy", () => {
  it("sends HSTS with the same parameters helmet declares", async () => {
    const template = await readTemplate();
    const securityHeaders = await readFile(SECURITY_HEADERS, "utf8");
    const maxAge = /maxAge:\s*(\d+)/.exec(securityHeaders)?.[1];
    expect(maxAge).toBeDefined();
    expect(securityHeaders).toMatch(/includeSubDomains:\s*true/);
    expect(securityHeaders).toMatch(/preload:\s*true/);

    expect(template).toContain(
      `Strict-Transport-Security "max-age=${maxAge}; includeSubDomains; preload"`,
    );
  });

  it("agrees with helmet on frameguard: deny", async () => {
    const securityHeaders = await readFile(SECURITY_HEADERS, "utf8");
    expect(securityHeaders).toMatch(/frameguard:\s*\{\s*action:\s*"deny"\s*\}/);
    expect(await readTemplate()).toMatch(/add_header X-Frame-Options DENY always;/);
  });

  it("omits the deprecated X-XSS-Protection header helmet deliberately disables", async () => {
    const securityHeaders = await readFile(SECURITY_HEADERS, "utf8");
    expect(securityHeaders).toMatch(/xssFilter:\s*false/);
    expect(await readTemplate()).not.toContain("X-XSS-Protection");
  });

  it("marks every add_header `always` so error responses stay covered", async () => {
    const content = await readTemplate();
    const directives = content
      .split(/\r?\n/)
      .filter((line) => /^\s*add_header\s/.test(line) && !/^\s*#/.test(line));
    expect(directives.length).toBeGreaterThan(0);
    const missing = directives.filter((line) => !/\balways;\s*$/.test(line));
    expect(missing).toEqual([]);
  });
});

describe("nginx location blocks never partially override the security headers", () => {
  // nginx add_header is not additive: a location that declares any add_header
  // discards the entire inherited set from the server block. So each location
  // must either declare no add_header at all, and inherit the full set, or
  // restate all of it. A partial restatement silently strips the rest.
  const SECURITY_HEADER_NAMES = [
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Strict-Transport-Security",
    "Referrer-Policy",
    "Permissions-Policy",
    "Content-Security-Policy",
  ];

  for (const prefix of ["/", "/assets/"]) {
    it(`location ${prefix} either inherits or fully restates the security headers`, async () => {
      const block = locationBlock(await readTemplate(), prefix);
      const declared = [...block.matchAll(/add_header ([A-Za-z-]+)/g)].map(
        (match) => match[1],
      );
      if (declared.length === 0) return;
      expect(declared.filter((name) => SECURITY_HEADER_NAMES.includes(name))).toEqual(
        SECURITY_HEADER_NAMES,
      );
    });
  }
});
