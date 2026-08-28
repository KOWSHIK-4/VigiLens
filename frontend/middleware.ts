import { NextRequest, NextResponse } from "next/server.js";

export const config = {
  runtime: "nodejs",
};

export default function middleware(request: NextRequest): NextResponse {
  const { pathname } = new URL(request.url);

  if (pathname.startsWith("/api/") || pathname.includes(".")) {
    return NextResponse.next();
  }

  return NextResponse.rewrite(new URL("/index.html", request.url));
}