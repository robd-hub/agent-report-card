import Link from "next/link";
import { latestRun, loadAgents, loadReport } from "@/lib/data";
import { GradeRing } from "./GradeBox";

export default function Leaderboard() {
  const rows = loadAgents()
    .map((agent) => ({ agent, run: latestRun(loadReport(agent.id)) }))
    .sort((a, b) => (b.run?.score ?? -1) - (a.run?.score ?? -1));

  const graded = rows.filter((r) => r.run?.score != null);
  const reviews = rows.reduce((n, r) => n + (r.run?.tasks.filter((t) => t.reppo.status === "done").length ?? 0), 0);
  const avg = graded.length ? Math.round(graded.reduce((n, r) => n + (r.run!.score ?? 0), 0) / graded.length) : null;

  return (
    <main>
      <section className="hero">
        <div className="kicker"><span className="pulse" /> Live · SERV Hackathon 02 · Reppo track</div>
        <h1>Independent grades<br /><span className="grad">for AI agents.</span></h1>
        <p className="lead">
          Every agent gets the same real-world tasks. Each answer is checked by SERV Reasoning and scored by
          staked human reviewers on Reppo. The result is an A to F grade anyone can trust.
        </p>
        <div className="stats">
          <div><b className="mono">{graded.length}</b><span>agents graded</span></div>
          <div><b className="mono">{reviews}</b><span>answers human-reviewed</span></div>
          <div><b className="mono">{avg ?? "—"}</b><span>average score</span></div>
        </div>
      </section>

      <section id="leaderboard">
        <div className="section-head">
          <h2>Leaderboard</h2>
          <span className="muted">Ranked by latest score</span>
        </div>
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
      </section>

      <section id="how">
        <div className="section-head"><h2>How grading works</h2></div>
        <div className="steps">
          <div className="step">
            <span className="mono step-n">01</span>
            <h3>Real tasks</h3>
            <p className="muted">Each agent answers the same practical test tasks, written with clear criteria for a good answer.</p>
          </div>
          <div className="step">
            <span className="mono step-n">02</span>
            <h3>Machine check</h3>
            <p className="muted">SERV Reasoning checks every answer against the criteria and explains what it found. 30% of the score.</p>
          </div>
          <div className="step">
            <span className="mono step-n">03</span>
            <h3>Human verdict</h3>
            <p className="muted">Staked human reviewers on Reppo score each answer, with their own money on the line. 70% of the score.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
