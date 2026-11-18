import Link from "next/link";
import { latestRun, loadAgents, loadReport } from "@/lib/data";
import { CATEGORIES, categoryOf, type CategoryId } from "@/lib/categories";
import type { AgentConfig, GradingRun } from "@/lib/types";
import { GradeRing } from "./GradeBox";

export interface BoardRow { agent: AgentConfig; run: GradingRun | null }

/** Every agent with its latest run, best score first, optionally only one category. */
export function boardRows(category?: CategoryId): BoardRow[] {
  return loadAgents()
    .filter((agent) => !category || categoryOf(agent) === category)
    .map((agent) => ({ agent, run: latestRun(loadReport(agent.id)) }))
    .sort((a, b) => (b.run?.score ?? -1) - (a.run?.score ?? -1));
}

/**
 * Scores this close are treated as a tie. LLM judges move a few points when the
 * same answers are judged again, so a gap this small doesn't show one agent is better.
 */
export const TIE_BAND = 3;

/**
 * Rank for each row, sharing a rank across a tie band: a band starts at the
 * first agent not yet placed and holds everyone within TIE_BAND points of it.
 * Ungraded agents get no rank.
 */
export function tieRanks(rows: BoardRow[]): { rank: number | null; tied: boolean }[] {
  const out: { rank: number | null; tied: boolean }[] = rows.map(() => ({ rank: null, tied: false }));
  let i = 0;
  while (i < rows.length) {
    const top = rows[i].run?.score;
    if (top === null || top === undefined) break;
    let j = i + 1;
    while (j < rows.length && rows[j].run?.score != null && top - rows[j].run!.score! <= TIE_BAND) j++;
    for (let k = i; k < j; k++) out[k] = { rank: i + 1, tied: j - i > 1 };
    i = j;
  }
  return out;
}

/** The ranked list of agents used on the home page and each category page. */
export function Board({ rows }: { rows: BoardRow[] }) {
  const ranks = tieRanks(rows);
  return (
    <div className="board">
      {rows.map(({ agent, run }, i) => (
        <Link key={agent.id} href={`/agents/${agent.id}`} className="entry">
          <span className="rank mono" title={ranks[i].tied ? `Tied: within ${TIE_BAND} points of each other` : undefined}>
            {ranks[i].rank === null ? "—" : `${ranks[i].tied ? "=" : ""}${String(ranks[i].rank).padStart(2, "0")}`}
          </span>
          <GradeRing grade={run?.grade ?? null} score={run?.score ?? null} />
          <div className="entry-main">
            <div className="entry-title">
              <strong>{agent.name}</strong>
              {run ? (
                <span className={`chip ${run.provisional ? "chip-warn" : "chip-ok"}`}>
                  {run.provisional ? "Provisional" : "Final"}
                </span>
              ) : (
                <span className="chip">Not graded</span>
              )}
              {agent.selfGraded && <span className="chip chip-self" title="Our own agent, graded the same way as every other">Self-graded · weekly</span>}
            </div>
            <div className="muted entry-desc">{agent.description}</div>
            <div className="entry-bar"><div className={`g-${run?.grade ?? "none"}`} style={{ width: `${run?.score ?? 0}%` }} /></div>
          </div>
          <div className="entry-score">
            <b className="mono">{run?.score ?? "—"}</b>
            <span className="muted">{run ? run.date.slice(0, 10) : ""}</span>
          </div>
          <span className="arrow">→</span>
        </Link>
      ))}
      {ranks.some((r) => r.tied) && (
        <p className="muted small board-note">
          <span className="mono">=</span> means tied. Agents within {TIE_BAND} points of each other share a rank, because judges move a few
          points when the same answers are judged again, so a gap that small doesn&apos;t show one is better.
        </p>
      )}
    </div>
  );
}

/** Links to each category's leaderboard, with how many agents are in it. */
export function CategoryTabs({ current }: { current?: CategoryId }) {
  const all = loadAgents();
  return (
    <nav className="cat-tabs" aria-label="Leaderboard by category">
      <Link href="/#leaderboard" className={current ? "" : "on"}>All <span className="mono">{all.length}</span></Link>
      {CATEGORIES.map((c) => {
        const n = all.filter((a) => categoryOf(a) === c.id).length;
        if (n === 0) return null;
        return (
          <Link key={c.id} href={`/top/${c.id}`} className={current === c.id ? "on" : ""}>
            {c.name} <span className="mono">{n}</span>
          </Link>
        );
      })}
    </nav>
  );
}




