/**
 * POST /api/drift/   {"rows": [{"task": "...", "answer": "...", "time": "..."}]}
 *
 * Drift Watch as an endpoint: refusal rate and average answer length per kind
 * of task, recent against before, with a flag when either jumps. No model is
 * called and nothing is stored. Free. Only served on Vercel (route file written
 * by scripts/prepare-server.ts); the same check runs in the browser at /drift-watch.
 */
import { analyzeDrift, driftOptions, fromObjects, parseLogs, type DriftOptions } from "@/lib/drift";

const MAX_ROWS = 20_000;
const MAX_BYTES = 10_000_000;
const CORS: Record<string, string> = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS } });
}

export async function POST(request: Request): Promise<Response> {
  const text = await request.text();
  if (text.length > MAX_BYTES) return json({ error: "Too big. Send at most 10 MB, or send length and refused instead of the answer text." }, 413);
  let parsed: ReturnType<typeof parseLogs>;
  let options: Partial<DriftOptions> = {};
  try {
    const t = text.trim();
    if (t.startsWith("{")) {
      const body = JSON.parse(t);
      if (body.options && typeof body.options === "object") options = driftOptions(body.options);
      const list = body.rows ?? body.logs ?? body.data ?? body.answers;
      parsed = Array.isArray(list) ? fromObjects(list) : parseLogs(t);
    } else {
      parsed = parseLogs(t);
    }
  } catch (e) {
    return json({ error: `Couldn't read the body: ${(e as Error).message}. Send {"rows": [...]}, JSON lines or CSV.` }, 400);
  }
  if (!parsed.rows.length) return json({ error: 'No rows found. Each row needs a "task" and an "answer" (or "length").' }, 400);
  if (parsed.rows.length > MAX_ROWS) return json({ error: `Too many rows. Send at most ${MAX_ROWS}.` }, 413);
  return json(analyzeDrift(parsed.rows, parsed.skipped, undefined, options));
}

export function GET(): Response {
  return json({
    about: "Drift Watch: refusal rate and answer length per kind of task, recent against before. Free, no model, nothing stored.",
    usage: 'POST {"rows": [{"time": "2026-11-18T09:00:00Z", "task": "price-lookup", "answer": "..."}], "options": {"minPerWindow": 30, "refusalPoints": 0.1, "lengthChange": 0.3}}',
    page: "https://robd-hub.github.io/agent-report-card/drift-watch/",
  });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS });
}
