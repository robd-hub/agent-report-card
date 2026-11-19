/**
 * GET /api/badge?agent=<id>&style=flat|pill|card&theme=dark|light
 *
 * The live badge. Generated from the published grade, cached for five
 * minutes, and the SVG itself links to that agent's report. Only served on
 * Vercel. GitHub Pages serves the same drawing as a file at /badge/<id>.svg,
 * rebuilt whenever a grade is published. A path ending in .svg would be
 * served as that file, so the generator lives here, under /api/badge.
 */
import { badgeCardSvg, badgePillSvg, badgeSvg } from "@/lib/badge";
import { latestRun, loadAgents, loadReport } from "@/lib/data";
import { LIVE_API, siteBase } from "@/lib/lookup";
import { CACHE_BADGE, CORS, LIMITS, options, rateGate } from "@/server/http";
import type { GradingRun } from "@/lib/types";

function svgFor(run: GradingRun | null, style: "flat" | "pill" | "card", theme: "dark" | "light", href: string): string {
  if (style === "pill") return badgePillSvg(run, theme, href);
  if (style === "card") return badgeCardSvg(run, theme, href);
  return badgeSvg(run, href);
}

export function GET(request: Request): Response {
  const gate = rateGate(request, "badge", LIMITS.badge);
  if (!gate.ok) return gate.response;
  const url = new URL(request.url);
  const id = (url.searchParams.get("agent") ?? "").toLowerCase().replace(/\.svg$/, "");
  const styleParam = url.searchParams.get("style");
  const themeParam = url.searchParams.get("theme");
  const style = styleParam === "pill" || styleParam === "card" ? styleParam : "flat";
  const theme = themeParam === "light" ? "light" : "dark";
  const headers = { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": CACHE_BADGE, ...CORS, ...gate.headers };
  if (!/^[a-z0-9-]+$/.test(id)) return new Response(badgeSvg(null), { status: 404, headers });
  const agent = loadAgents().find((a) => a.id === id);
  if (!agent) return new Response(svgFor(null, style, theme, `${LIVE_API}/for-agents/`), { status: 200, headers });
  const report = `${siteBase()}/agents/${agent.id}/`;
  return new Response(svgFor(latestRun(loadReport(agent.id)), style, theme, report), { status: 200, headers });
}

export function OPTIONS(): Response {
  return options();
}
