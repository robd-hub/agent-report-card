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

/** The ranked list of agents used on the home page and each category page. */
export function Board({ rows }: { rows: BoardRow[] }) {
  return (
    <div className="board">
      {rows.map(({ agent, run }, i) => (
        <Link key={agent.id} href={`/agents/${agent.id}`} className="entry">
          <span className="rank mono">{String(i + 1).padStart(2, "0")}</span>
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




