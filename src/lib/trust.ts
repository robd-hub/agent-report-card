/**
 * Trust Check: a short, machine-readable answer to "can I rely on this agent?"
 * that another agent can ask before it hands work over. Built from the same
 * published grades as the report pages, so it costs nothing to answer.
 *
 * Served three ways:
 *   - static files at /trust/<id>.json and /trust/index.json (scripts/badges.ts
 *     writes them before every build, so they work on GitHub Pages too)
 *   - GET /api/trust/?agent=<name, id, marketplace number or link, or https address>
 *     on Vercel (src/server/trust.ts), which also says if a grade is out of date
 *   - the Trust Check page (src/app/trust-check/)
 */
import { CATEGORIES, categoryById, categoryOf, type CategoryId } from "./categories";
import { GRADE_MEANING, honestyCheck, disagreement } from "./grade";
import { GRADE_PRICE_USD, GRADE_REQUEST_URL, REGRADE_PRICE_USD } from "./links";
import type { AgentConfig, Grade, GradingRun } from "./types";

/** The Output verifier: checks an agent's work before the buyer pays it. */
export const VERIFY_URL = "https://cheap-first.vercel.app/api/verify";

/** How long a grade counts as current. After this we advise a regrade. */
export const FRESH_DAYS = 60;

/**
 * What we advise a caller to do:
 *   rely   - grade A and it didn't fail the honesty check
 *   check  - B or C, or an A that failed the honesty check: use it, but check answers that matter
 *   avoid  - D or F
 *   unknown - not graded yet
 */
export type Advice = "rely" | "check" | "avoid" | "unknown";

export interface TrustRecord {
  /** Version of this format, so callers can tell if it changes. */
  version: 1;
  agent: { id: string; name: string; category?: string; marketplaceId?: number; endpoint?: string };
  graded: boolean;
  grade: Grade | null;
  score: number | null;
  advice: Advice;
  /** One plain sentence a caller can show or log. */
  verdict: string;
  /** True while Reppo's judges are still scoring some answers. */
  provisional: boolean;
  /** "passed", "failed", "pending", or null if the grade had no honesty check. */
  honesty: "passed" | "failed" | "pending" | null;
  /** Tasks where the two judges were 40+ points apart. */
  judgesDisagreed: number;
  testedAt: string | null;
  /** After this date the grade is out of date and a regrade is advised. */
  freshUntil: string | null;
  /** The last few scores, oldest first, so a caller can see a trend. */
  history: { date: string; score: number | null; grade: Grade | null }[];
  /** Made by the people who run Agent Report Card (shown so nobody is misled). */
  selfGraded: boolean;
  report: string;
  badge: string;
  /** How to get graded or regraded. */
  getGraded: { url: string; priceUsd: number };
  source: "Agent Report Card";
}

function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}

export function adviceFor(run: GradingRun | null): Advice {
  if (!run || run.grade === null) return "unknown";
  if (run.grade === "D" || run.grade === "F") return "avoid";
  if (run.grade === "A" && honestyCheck(run.tasks) !== "failed") return "rely";
  return "check";
}

export function trustRecord(agent: AgentConfig, runs: GradingRun[], site: string): TrustRecord {
  const run = runs.at(-1) ?? null;
  const graded = Boolean(run && run.grade !== null);
  const advice = adviceFor(run);
  const honesty = run ? honestyCheck(run.tasks) : null;
  let verdict: string;
  if (!graded) verdict = `${agent.name} has not been graded yet, so we can't vouch for it.`;
  else {
    verdict = `${agent.name}: grade ${run!.grade} (${run!.score}/100). ${GRADE_MEANING[run!.grade!]}`;
    if (advice === "check" && run!.grade === "A") verdict += " It failed our honesty check, so double-check facts it gives you.";
    if (run!.provisional) verdict += " The grade is provisional while human reviews finish.";
  }
  return {
    version: 1,
    // A shared model API (OpenAI-style) isn't one agent's own address, so it isn't used to match.
    agent: { id: agent.id, name: agent.name, category: categoryOf(agent), marketplaceId: agent.marketplaceId, endpoint: agent.adapter === "http-json" ? agent.endpoint : undefined },
    graded,
    grade: run?.grade ?? null,
    score: run?.score ?? null,
    advice,
    verdict,
    provisional: run?.provisional ?? false,
    honesty,
    judgesDisagreed: run ? run.tasks.filter((t) => disagreement(t)).length : 0,
    testedAt: run?.date ?? null,
    freshUntil: run ? addDays(run.date, FRESH_DAYS) : null,
    history: runs.slice(-5).map((r) => ({ date: r.date, score: r.score, grade: r.grade })),
    selfGraded: Boolean(agent.selfGraded),
    report: `${site}/agents/${agent.id}/`,
    badge: `${site}/badge/${agent.id}.svg`,
    getGraded: { url: GRADE_REQUEST_URL, priceUsd: graded ? REGRADE_PRICE_USD : GRADE_PRICE_USD },
    source: "Agent Report Card",
  };
}

/** Whether a grade is past its fresh-until date at `now`. */
export function isStale(r: TrustRecord, now = Date.now()): boolean {
  return r.freshUntil !== null && new Date(r.freshUntil).getTime() < now;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const host = (u: string) => {
  try {
    const x = new URL(u);
    return (x.host + x.pathname).replace(/\/+$/, "").toLowerCase();
  } catch {
    return null;
  }
};

/**
 * Finds the agent a caller means: an OpenServ marketplace number or link,
 * the agent's own https address, our id, or its name. Exact matches only, so
 * a Trust Check never answers for the wrong agent.
 */
export function findTrust(query: string, all: TrustRecord[]): TrustRecord | null {
  const q = query.trim();
  if (!q) return null;
  const market = q.match(/openserv\.ai\/agents\/(\d+)/)?.[1] ?? (/^\d+$/.test(q) ? q : null);
  if (market) return all.find((r) => String(r.agent.marketplaceId) === market) ?? null;
  if (/^https?:\/\//i.test(q)) {
    const h = host(q);
    return all.find((r) => r.agent.endpoint && host(r.agent.endpoint) === h) ?? null;
  }
  return all.find((r) => r.agent.id === q.toLowerCase()) ?? all.find((r) => norm(r.agent.name) === norm(q)) ?? null;
}

const ADVICE_RANK: Record<Advice, number> = { rely: 0, check: 1, avoid: 2, unknown: 3 };

/**
 * "Who's best at X?": the top graded agents in a category, best first.
 * Only agents we'd advise using (rely, then check) are listed, never avoid
 * or ungraded ones; out-of-date grades go after current ones.
 */
export function bestIn(category: CategoryId, all: TrustRecord[], limit = 3, now = Date.now()): TrustRecord[] {
  return all
    .filter((r) => r.agent.category === category && (r.advice === "rely" || r.advice === "check"))
    .sort((a, b) => Number(isStale(a, now)) - Number(isStale(b, now)) || ADVICE_RANK[a.advice] - ADVICE_RANK[b.advice] || (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);
}

/** The category a task most likely belongs to, from its wording. */
export function categoryForTask(task: string): CategoryId {
  return categoryOf({ name: "", description: task });
}

export interface BestAnswer {
  version: 1;
  category: { id: CategoryId; name: string };
  /** Set when the category was guessed from a task's wording. */
  guessedFrom?: string;
  /** Best first. Empty when no agent in the category is graded well enough. */
  agents: Pick<TrustRecord, "agent" | "grade" | "score" | "advice" | "testedAt" | "report" | "selfGraded">[];
  /** Where to check the chosen agent's work before paying it. */
  verify: string;
  note: string;
  source: "Agent Report Card";
}

export function bestAnswer(category: CategoryId, all: TrustRecord[], task?: string, limit = 3): BestAnswer {
  const top = bestIn(category, all, limit);
  const c = categoryById(category)!;
  const name = c.name;
  const hasRely = top.some((r) => r.advice === "rely");
  return {
    version: 1,
    category: { id: category, name },
    ...(task ? { guessedFrom: task.slice(0, 200) } : {}),
    agents: top.map((r) => ({ agent: r.agent, grade: r.grade, score: r.score, advice: r.advice, testedAt: r.testedAt, report: r.report, selfGraded: r.selfGraded })),
    verify: VERIFY_URL,
    note: !top.length
      ? `None of the ${c.plural} we've graded is good enough for us to recommend yet.`
      : hasRely
        ? `Best graded ${c.plural} first. Check the work before you pay it at ${VERIFY_URL}.`
        : `None of the ${c.plural} we've graded rates "rely" yet, so check answers that matter at ${VERIFY_URL}.`,
    source: "Agent Report Card",
  };
}

export { CATEGORIES };
