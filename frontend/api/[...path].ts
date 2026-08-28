import type { IncomingMessage, ServerResponse } from "node:http";

const BACKEND = process.env.API_UPSTREAM_URL || "https://vigilens-api.vercel.app";

const SKIP_REQUEST_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "content-encoding",
  "transfer-encoding",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-forwarded-host",
  "x-real-ip",
  "x-vercel-forwarded-for",
]);

const SKIP_RESPONSE_HEADERS = new Set(["content-encoding", "content-length", "transfer-encoding"]);

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://proxy.local");
  const upstreamPath = url.pathname.replace(/^\/api\/?/, "");
  const target = `${BACKEND}/api/${upstreamPath}${url.search}`;
  const method = (req.method ?? "GET").toUpperCase();

  let body: Buffer | undefined;
  if (!["GET", "HEAD"].includes(method)) {
    body = await readBody(req);
  }

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined || SKIP_REQUEST_HEADERS.has(key)) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  headers.set("x-forwarded-host", req.headers.host ?? "vigilens.vercel.app");

  try {
    const upstream = await fetch(target, { method, headers, body, redirect: "manual" });
    const payload = Buffer.from(await upstream.arrayBuffer());
    res.statusCode = upstream.status;
    upstream.headers.forEach((value, key) => {
      if (SKIP_RESPONSE_HEADERS.has(key.toLowerCase())) return;
      res.setHeader(key, value);
    });
    res.setHeader("content-length", payload.length);
    res.end(payload);
  } catch {
    res.statusCode = 502;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ success: false, error: "project_proxy_unreachable" }));
  }
}