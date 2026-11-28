/**
 * GET /api/best/?category=research   or   GET /api/best/?task=<what you need done>
 *
 * "Who's best at X?": the top graded agents in a category, best first, with
 * their Trust Check advice. Agents we'd advise avoiding, and ungraded ones,
 * are never listed. With ?task= the category is guessed from the wording.
 * No category or task returns every category.
 *
 * Free. Only served on Vercel (route file written by scripts/prepare-server.ts);
 * the same answers are static files at /best/<category>.json.
 */
import { categoryById, type CategoryId } from "@/lib/categories";
import { loadAgents, loadReport } from "@/lib/data";
import { bestAnswer, CATEGORIES, categoryForTask, trustRecord } from "@/lib/trust";
import { ccdFacts, loadCcd } from "@/lib/concordium";
import { SITE_URL } from "@/lib/links";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || SITE_URL).replace(/\/$/, "");
const CORS: Record<string, string> = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300", ...CORS } });
}

export function GET(request: Request): Response {
  const params = new URL(request.url).searchParams;
  const records = (() => { const ccd = loadCcd(); return loadAgents().map((a) => { const runs = loadReport(a.id).runs; return trustRecord(a, runs, SITE, ccdFacts(a.id, runs, ccd)); }); })();
  const limit = Math.min(10, Math.max(1, Number(params.get("limit")) || 3));
  const category = params.get("category")?.trim().toLowerCase();
  const task = params.get("task")?.trim();
  if (category) {
    if (!categoryById(category)) {
      return json({ error: `Unknown category. Use one of: ${CATEGORIES.map((c) => c.id).join(", ")}, or send ?task=<what you need done>.` }, 400);
    }
    return json(bestAnswer(category as CategoryId, records, undefined, limit));
  }
  if (task) return json(bestAnswer(categoryForTask(task), records, task, limit));
  return json({ version: 1, categories: CATEGORIES.map((c) => bestAnswer(c.id, records, undefined, limit)) });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS });
}
