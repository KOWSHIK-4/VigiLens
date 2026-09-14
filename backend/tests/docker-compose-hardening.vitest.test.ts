import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it, expect } from "vitest";

/**
 * Deployment hardening guard for docker-compose.yml.
 *
 * The compose stack is the production deployment path: services run with
 * NODE_ENV=production, where the backend refuses to boot on insecure or
 * missing secrets. These tests keep the compose file honest about that
 * contract, so a mis-merged deployment file fails loudly in CI rather than
 * half-starting in production.
 */

const COMPOSE_PATH = path.resolve(process.cwd(), "..", "docker-compose.yml");

const REQUIRED_SERVICES = ["postgres", "ai-service", "backend", "frontend"];

interface ComposeEnvRef {
  service: string;
  name: string;
}

function serviceFor(line: string): string | null {
  // Service declarations sit at exactly two-space indent; nested YAML keys
  // (build:, expose:, networks:, ...) are indented deeper.
  const match = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(line);
  if (!match || match[1] === "services") return null;
  return match[1];
}

async function readCompose(): Promise<string> {
  return readFile(COMPOSE_PATH, "utf8");
}

function collectEnvRefs(content: string): ComposeEnvRef[] {
  const refs: ComposeEnvRef[] = [];
  const lines = content.split(/\r?\n/);
  let service: string | null = null;
  for (const line of lines) {
    const svc = serviceFor(line);
    if (svc) {
      service = svc;
      continue;
    }
    if (!service) continue;
    const envMatch = /^\s+- ([A-Z0-9_]+)=/.exec(line);
    if (envMatch) {
      refs.push({ service, name: envMatch[1] });
    }
  }
  return refs;
}

describe("docker-compose production hardening", () => {
  it("declares every required service", async () => {
    const content = await readCompose();
    for (const svc of REQUIRED_SERVICES) {
      expect(content).toMatch(new RegExp(`^\\s*${svc}:\\s*$`, "m"));
    }
  });

  it("never references an env var without a default or required-marker fallback", async () => {
    const content = await readCompose();
    const lines = content.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      for (const ref of line.matchAll(/\$\{([A-Z0-9_]+)(?:(:-[^}]*)|(:\?[^}]*))?\}/g)) {
        if (ref[2] === undefined && ref[3] === undefined) {
          throw new Error(
            `${path.basename(COMPOSE_PATH)}:${index + 1} references bare \${${ref[1]}} ` +
              `— give it a :-default or :?required fallback so 'docker compose up' never ` +
              `silently injects an empty value`,
          );
        }
      }
    }
  });

  it("fails fast on the encryption key instead of booting into a FATAL", async () => {
    const content = await readCompose();
    expect(content).toMatch(/CAMERA_CREDENTIALS_KEY=\$\{CAMERA_CREDENTIALS_KEY:\?[^}]*\}/);
  });

  it("applies the AI stream/stats auth gate by default in the deployment", async () => {
    const content = await readCompose();
    expect(content).toMatch(/AI_STATS_REQUIRE_AUTH=\$\{AI_STATS_REQUIRE_AUTH:-true\}/);
  });

  it("gives the database and backend stop grace periods for clean drains", async () => {
    const content = await readCompose();
    const backendGrace = /backend:\s*(?:.|\n)*?stop_grace_period: (\d+)s/.exec(content);
    expect(backendGrace).not.toBeNull();
    expect(Number(backendGrace?.[1])).toBeGreaterThanOrEqual(20);

    const postgresGrace = /postgres:\s*(?:.|\n)*?stop_grace_period: (\d+)s/.exec(content);
    expect(postgresGrace).not.toBeNull();
  });

  it("never writes a real secret as an inline literal", async () => {
    const content = await readCompose();
    const secretLines = content
      .split(/\r?\n/)
      .filter((line) => /-=.*(INTERNAL_API_KEY|JWT_SECRET|CAMERA_CREDENTIALS_KEY)=/.test(line));
    // Secret values must come from an environment override, never a literal.
    for (const line of secretLines) {
      expect(line).toMatch(/=\$\{/);
    }
  });
});

describe("docker-compose service env wiring", () => {
  it("backend forwards the runtime-configurable settings", async () => {
    const content = await readCompose();
    const keys = collectEnvRefs(content)
      .filter((ref) => ref.service === "backend")
      .map((ref) => ref.name);
    for (const key of [
      "CAMERA_CREDENTIALS_KEY",
      "JWT_SECRET",
      "JWT_EXPIRES_IN",
      "LOG_LEVEL",
      "INTERNAL_API_KEY",
      "DATABASE_URL",
    ]) {
      expect(keys).toContain(key);
    }
  });

  it("ai-service forwards the boundary hardening toggle", async () => {
    const content = await readCompose();
    const keys = collectEnvRefs(content)
      .filter((ref) => ref.service === "ai-service")
      .map((ref) => ref.name);
    expect(keys).toContain("AI_STATS_REQUIRE_AUTH");
    expect(keys).toContain("BACKEND_INTERNAL_KEY");
  });
});