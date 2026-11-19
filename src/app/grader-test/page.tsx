import Link from "next/link";
import { CAUGHT_MARGIN, loadCalibration, type PairScores } from "@/lib/calibration";
import { excerpt, REPPO_WEIGHT } from "@/lib/grade";

export const metadata = {
  title: "Grader test · Agent Report Card",
  description: "We planted known errors in good answers and graded them like any other agent's, to check the grader catches them without marking down answers that are fine.",
};

const show = (n: number | null) => (n === null ? "…" : String(n));
const pct = (t: { hits: number; total: number }) => (t.total ? Math.round((t.hits / t.total) * 100) : 0);
const drop = (p: PairScores) => (p.clean === null || p.other === null ? null : p.other - p.clean);

export default function GraderTest() {
  const s = loadCalibration();
  const started = s.checks.some((c) => c.planted.serv.other !== null);

  return (
    <main className="prose-page">
      <p><Link href="/how-grading-works" className="back">← How grading works</Link></p>
      <div className="kicker">Testing the grader</div>
      <h1>Does the grader catch mistakes?</h1>
      <p className="lead">
        We took good answers to ten tasks and planted exactly one known error in each: a wrong total, an invented fact, a broken format rule
        and so on. We also reworded each good answer with no errors. All three sets went through the normal grader, with the same SERV check and the same Reppo judges.
        A good grader marks the planted answers down and leaves the reworded ones alone.
      </p>

      {!started && <div className="panel">The first test run hasn&apos;t finished yet. Results will appear here when it has.</div>}

      {started && (
        <>
          {!s.complete && <div className="panel">This run is still being judged on Reppo, so these numbers can still change.</div>}
          <div className="stats">
            <div><b className="mono">{s.caught.both.hits}/{s.caught.both.total}</b><span>planted errors caught</span></div>
            <div><b className="mono">{s.falseAlarms.both.hits}/{s.falseAlarms.both.total}</b><span>false alarms on reworded answers</span></div>
            <div><b className="mono">{s.date?.slice(0, 10)}</b><span>test run</span></div>
          </div>

          <section>
            <h2>Task by task</h2>
            <p>
              An error counts as caught when the planted answer scores at least {CAUGHT_MARGIN} points below the good one. A false alarm is a
              reworded answer, with nothing wrong, that drops by as much. Scores mix the two judges {Math.round(REPPO_WEIGHT * 100)}/
              {Math.round((1 - REPPO_WEIGHT) * 100)}, as in every grade.
            </p>
            <div className="cal-list">
              {s.checks.map((c) => (
                <div key={c.taskId} className="panel cal-row">
                  <div className="cal-head">
                    <b>{c.taskId}</b>
                    {c.caught === null ? <span className="chip">Waiting</span> : c.caught ? <span className="chip chip-ok">Caught</span> : <span className="chip chip-bad">Missed</span>}
                    {c.falseAlarm && <span className="chip chip-warn">False alarm</span>}
                  </div>
                  <p className="muted small">{excerpt(c.prompt.split("\n")[0], 160)}</p>
                  <p><b>Planted error:</b> {c.error}</p>
                  <p className="mono small">
                    Good {show(c.planted.both.clean)} · Planted {show(c.planted.both.other)}
                    {drop(c.planted.both) !== null && ` (${drop(c.planted.both)})`} · Reworded {show(c.reworded.both.other)}
                    {drop(c.reworded.both) !== null && ` (${drop(c.reworded.both)! > 0 ? "+" : ""}${drop(c.reworded.both)})`}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2>Each judge on its own</h2>
            <table className="grade-table cal-table">
              <thead><tr><th></th><th>Caught</th><th>False alarms</th></tr></thead>
              <tbody>
                <tr><td>Combined grade</td><td className="mono">{s.caught.both.hits}/{s.caught.both.total} ({pct(s.caught.both)}%)</td><td className="mono">{s.falseAlarms.both.hits}/{s.falseAlarms.both.total}</td></tr>
                <tr><td>Reppo judges alone</td><td className="mono">{s.caught.reppo.hits}/{s.caught.reppo.total} ({pct(s.caught.reppo)}%)</td><td className="mono">{s.falseAlarms.reppo.hits}/{s.falseAlarms.reppo.total}</td></tr>
                <tr><td>SERV check alone</td><td className="mono">{s.caught.serv.hits}/{s.caught.serv.total} ({pct(s.caught.serv)}%)</td><td className="mono">{s.falseAlarms.serv.hits}/{s.falseAlarms.serv.total}</td></tr>
              </tbody>
            </table>
            <p className="muted">This is why every grade uses two independent judges: where one lets an error through, the other often catches it.</p>
          </section>

          {s.naturalMiss && (
            <section>
              <h2>A real mistake, not planted</h2>
              <p>
                The good answers came from the same model as our baseline agent, and it got one task wrong all by itself. The grader caught that
                too: Reppo {show(s.naturalMiss.reppo)}, SERV {show(s.naturalMiss.serv)}.
              </p>
              <div className="panel example example-bad">
                <p><b>Task:</b> {s.naturalMiss.prompt}</p>
                <p className="muted"><b>Its answer:</b> {excerpt(s.naturalMiss.output, 300)}</p>
              </div>
            </section>
          )}

          <p className="muted">
            Every answer, planted error and score is in the <a href="https://github.com/robd-hub/agent-report-card/tree/main/data/calibration">public results</a>, so you can check them.
          </p>
        </>
      )}

      <div className="cta-panel">
        <div>
          <h2>See it on a real agent</h2>
          <p className="muted">Every graded agent&apos;s report shows each answer, both scores and the judges&apos; critiques.</p>
        </div>
        <div className="cta-actions">
          <Link className="btn btn-primary" href="/#leaderboard">See the leaderboard</Link>
          <Link className="btn btn-ghost" href="/#get-graded">Get your agent graded →</Link>
        </div>
      </div>
    </main>
  );
}
