/**
 * GET /api/trust/?agent=<name, id, OpenServ marketplace number or link, or the agent's https address>
 *
 * Trust Check: what an agent asks before it hires another agent. Returns the
 * agent's grade, our advice (rely, check, avoid or unknown), whether the grade
 * is still current, the honesty result and links to the report and badge.
 * GET /api/trust/ with no agent returns every record.
 *
 * Free for now. It only reads published grades, so each answer costs us
 * nothing. Only served on Vercel: scripts/prepare-server.ts writes the route
 * file (src/app/api/trust/route.ts) there. The same records are also static
 * files at /trust/<id>.json on both copies of the site.
 */
import { loadAgents, loadReport } from "@/lib/data";
import { GRADE_PRICE_USD, SITE_URL } from "@/lib/links";
import { findTrust, isStale, trustRecord, type TrustRecord } from "@/lib/trust";
import { ccdFacts, loadCcd } from "@/lib/concordium";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || SITE_URL).replace(/\/$/, "");

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300", ...CORS },
  });
}

function records(): TrustRecord[] {
  return (() => { const ccd = loadCcd(); return loadAgents().map((a) => { const runs = loadReport(a.id).runs; return trustRecord(a, runs, SITE, ccdFacts(a.id, runs, ccd)); }); })();
}

/** Adds what depends on today's date: whether the grade is out of date. */
function live(r: TrustRecord) {
  const stale = isStale(r);
  return { ...r, stale, ...(stale ? { verdict: `${r.verdict} This grade is more than 60 days old, so a regrade is advised.` } : {}) };
}

export function GET(request: Request): Response {
  const query = new URL(request.url).searchParams.get("agent")?.trim() ?? "";
  const all = records();
  if (!query) return json({ version: 1, agents: all.map(live) });
  const found = findTrust(query, all);
  if (found) return json(live(found));
  return json(
    {
      version: 1,
      graded: false,
      advice: "unknown",
      query,
      verdict: `No Agent Report Card grade for "${query}", so we can't vouch for it. Ask its builder to get it graded.`,
      getGraded: { url: `${SITE}/#get-graded`, priceUsd: GRADE_PRICE_USD },
      source: "Agent Report Card",
    },
    // 200, not 404: "not graded" is a normal answer an agent should read, not an error.
    200,
  );
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS });
}
