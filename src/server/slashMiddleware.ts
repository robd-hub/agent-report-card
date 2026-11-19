/**
 * Runs on Vercel only. scripts/prepare-server.ts writes src/middleware.ts,
 * which calls this. skipTrailingSlashRedirect is on for that build, so this
 * is the only trailing-slash redirect.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { slashDecision } from "@/lib/slashPolicy";

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const decision = slashDecision(pathname, (name) => request.headers.get(name));
  if (decision === "next") return NextResponse.next();
  // A plain URL, not NextURL. NextURL reformats the path from the slash it
  // saw on the way in, so it would undo the slash this redirect just set.
  const url = new URL(request.url);
  url.pathname = decision === "redirect-strip" ? pathname.replace(/\/+$/, "") || "/" : `${pathname}/`;
  return NextResponse.redirect(url, 308);
}
