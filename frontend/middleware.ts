import { NextRequest, NextResponse } from "next/server.js";

const BACKEND = process.env.API_UPSTREAM_URL || "https://vigilens-api.vercel.app";

const SKIP_REQUEST_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "content-encoding",
  "transfer-encoding",
  "accept-encoding",
]);

const SKIP_RESPONSE_HEADERS = new Set(["content-encoding", "content-length", "transfer-encoding"]);

export const config = {
  runtime: "nodejs",
};

export default async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = new URL(request.url);

  if (pathname.startsWith("/api")) {
    try {
      const method = request.method;
      const body = ["GET", "HEAD"].includes(method)
        ? undefined
        : new Uint8Array(await request.arrayBuffer());

      const headers = new Headers();
      request.headers.forEach((value, key) => {
        if (SKIP_REQUEST_HEADERS.has(key.toLowerCase())) return;
        headers.set(key, value);
      });
      headers.set("x-forwarded-host", request.headers.get("host") ?? "vigilens.vercel.app");

      const upstream = await fetch(`${BACKEND}${pathname}${search}`, {
        method,
        headers,
        body,
        redirect: "manual",
      });

      const payload = new Uint8Array(await upstream.arrayBuffer());

      const responseHeaders = new Headers();
      upstream.headers.forEach((value, key) => {
        if (SKIP_RESPONSE_HEADERS.has(key.toLowerCase())) return;
        responseHeaders.set(key, value);
      });
      if (typeof upstream.headers.getSetCookie === "function") {
        for (const cookie of upstream.headers.getSetCookie()) {
          responseHeaders.append("set-cookie", cookie);
        }
      }
      responseHeaders.set("content-length", payload.length);

      return new NextResponse(payload, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    } catch {
      return NextResponse.json(
        { success: false, error: "project_proxy_unreachable" },
        { status: 502 },
      );
    }
  }

  if (pathname.includes(".")) {
    return NextResponse.next();
  }

  return NextResponse.rewrite(new URL("/index.html", request.url));
}