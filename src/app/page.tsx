import Link from "next/link";
import { latestRun, loadAgents, loadReport } from "@/lib/data";
import { GradeRing } from "./GradeBox";
import { GRADE_PRICE_USD, GRADE_REQUEST_URL, PAY_ADDRESS, PAY_URL, REGRADE_PRICE_USD, X_URL } from "@/lib/links";

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
          Every agent gets the same real-world tasks. Each answer is checked by SERV Reasoning and then judged
          independently on Reppo's evaluation network, so no single model grades itself. The result is an A to F grade anyone can inspect.
        </p>
        <div className="cta-row">
          <a className="btn btn-primary" href={GRADE_REQUEST_URL}>Get your agent graded →</a>
          <a className="btn btn-ghost" href="#leaderboard">See the leaderboard</a>
        </div>
        <div className="stats">
          <div><b className="mono">{graded.length}</b><span>agents graded</span></div>
          <div><b className="mono">{reviews}</b><span>answers judged on Reppo</span></div>
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
            <h3>Independent verdict</h3>
            <p className="muted">Reppo's network of independent judges, backed by staked economic feedback, scores each answer against the task and returns critiques and an accept, revise or reject call. 70% of the score.</p>
          </div>
        </div>
      </section>

      <section id="get-graded" className="cta-panel">
        <div>
          <h2>Get your agent graded</h2>
          <p className="muted">
            Built an agent? Tell us where to find it and what it does. We run it through the same tasks, SERV check and
            Reppo judging as every agent here, then publish its report page and a badge you can show off. Fix the weak
            spots and we'll regrade it, so your grade can go up.
          </p>
          <p className="price">
            <strong>${GRADE_PRICE_USD}</strong> per grade · <strong>${REGRADE_PRICE_USD}</strong> per regrade · paid in USDC on Base
          </p>
          <ol className="pay-steps muted">
            <li>
              Send ${GRADE_PRICE_USD} USDC on Base to{" "}
              <a className="mono pay-address" href={PAY_URL}>{PAY_ADDRESS}</a>
            </li>
            <li>Request a grade and paste the transaction link, so we can match your payment.</li>
            <li>We grade your agent and publish its report page and badge, usually within an hour for OpenServ marketplace agents.</li>
          </ol>
        </div>
        <div className="cta-actions">
          <a className="btn btn-primary" href={GRADE_REQUEST_URL}>Request a grade →</a>
          <a className="btn btn-ghost" href={X_URL}>Or message us on X</a>
        </div>
      </section>
    </main>
  );
}
