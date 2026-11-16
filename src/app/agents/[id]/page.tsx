import Link from "next/link";
import { notFound } from "next/navigation";
import { latestRun, loadAgents, loadReport } from "@/lib/data";
import { excerpt, GRADE_MEANING, honestyCheck, taskScore, weakestTask } from "@/lib/grade";
import { Answer, GradeRing, Meter, Trend } from "../../GradeBox";

export function generateStaticParams() {
  return loadAgents().map((a) => ({ id: a.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = loadAgents().find((a) => a.id === id);
  const run = agent ? latestRun(loadReport(agent.id)) : null;
  return { title: agent ? `${agent.name}: ${run?.grade ?? "not graded"} · Agent Report Card` : "Agent Report Card" };
}

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = loadAgents().find((a) => a.id === id);
  if (!agent) notFound();
  const report = loadReport(agent.id);
  const run = latestRun(report);
  const honesty = run ? honestyCheck(run.tasks) : null;
  const weakest = run ? weakestTask(run.tasks) : null;
  const weakestPrompt = weakest ? agent.tasks.find((x) => x.id === weakest.task.taskId)?.prompt ?? weakest.task.taskId : null;
  const weakestWhy = weakest
    ? (weakest.task.reppo.status === "done" ? weakest.task.reppo.critiques[0] : undefined) ?? weakest.task.serv?.summary ?? null
    : null;
  const previous = report.runs.length > 1 ? report.runs.at(-2)! : null;
  const badgeSrc = `${process.env.NEXT_PUBLIC_BASE_PATH}/badge/${agent.id}.svg`;

  return (
    <main>
      <p><Link href="/" className="back">← All agents</Link></p>

      <section className="agent-hero">
        <GradeRing grade={run?.grade ?? null} score={run?.score ?? null} size={132} />
        <div>
          <div className="kicker">Report card</div>
          <h1>{agent.name}</h1>
          <p className="muted">{agent.description}</p>
          {run && (
            <div className="agent-meta">
              <span><b className="mono">{run.score ?? "—"}</b>/100</span>
              <span className={`chip ${run.provisional ? "chip-warn" : "chip-ok"}`}>
                {run.provisional ? "Provisional: waiting on Reppo's verdict" : "Final"}
              </span>
              {honesty && (
                <span
                  className={`chip ${honesty === "passed" ? "chip-ok" : honesty === "failed" ? "chip-bad" : "chip-warn"}`}
                  title="Asked something it can't know: does it admit that, or make up an answer?"
                >
                  Honesty check: {honesty}
                </span>
              )}
              {agent.selfGraded && <span className="chip chip-self">Self-graded</span>}
              <span className="muted">Graded {run.date.slice(0, 10)} · {run.tasks.length} tasks{agent.schedule === "weekly" ? " · regraded every Monday" : ""}</span>
            </div>
          )}
        </div>
      </section>

      {agent.selfGraded && (
        <div className="panel self-graded">
          <div className="panel-label">This is our own agent</div>
          <p>{agent.selfGraded}</p>
        </div>
      )}

      {!run && <div className="panel">This agent hasn't been graded yet.{agent.schedule === "weekly" ? " Its first weekly grade runs next Monday." : ""}</div>}
      {run && (
        <>
          <div className="panel">
            <div className="panel-label">Verdict</div>
            {run.grade && (
              <p className="meaning"><b>What {run.grade === "A" || run.grade === "F" ? "an" : "a"} {run.grade} means:</b> {GRADE_MEANING[run.grade]}</p>
            )}
            <p className="verdict">{run.summary || "No summary yet."}</p>
            {report.runs.length > 1 && (
              <>
                <div className="panel-label trend-head">Score history</div>
                <Trend runs={report.runs} />
                <p className="muted">History: {report.runs.map((r) => `${r.date.slice(0, 10)} ${r.grade ?? "N/A"}`).join(" → ")}</p>
              </>
            )}
          </div>

          {weakest && (
            <div className={`panel example ${weakest.score < 70 ? "example-bad" : ""}`}>
              <div className="panel-label">{weakest.score < 70 ? "Where it fell short" : "Its weakest answer"}</div>
              <p><b>Task:</b> {weakestPrompt}</p>
              <Answer text={excerpt(weakest.task.output || "(no answer)")} />
              <p className="muted">
                <b>Task score {Math.round(weakest.score)}/100</b> (judges and SERV check combined).
                {weakestWhy && <><br /><b>Why:</b> {weakestWhy}</>}
              </p>
            </div>
          )}

          <div className="section-head"><h2>Test tasks</h2><span className="muted">{run.tasks.length} tasks</span></div>
          {run.tasks.map((t, i) => {
            const task = agent.tasks.find((x) => x.id === t.taskId);
            const reppoScore = t.reppo.status === "done" ? t.reppo.score : null;
            return (
              <div key={t.taskId} className="panel task">
                <div className="task-head">
                  <span className="mono step-n">{String(i + 1).padStart(2, "0")}</span>
                  <h3>{task?.prompt ?? t.taskId}</h3>
                </div>
                <div className="meters">
                  <Meter label="Independent judges (Reppo)" value={reppoScore} tone="violet" />
                  <Meter label="SERV Reasoning check" value={t.serv?.score ?? null} />
                </div>
                {previous && (() => {
                  const was = previous.tasks.find((p) => p.taskId === t.taskId);
                  const before = was ? taskScore(was) : null;
                  const now = taskScore(t);
                  if (before === null || now === null) return null;
                  const diff = Math.round(now) - Math.round(before);
                  return (
                    <p className={`change ${diff > 0 ? "up" : diff < 0 ? "down" : ""}`}>
                      Since the last grade ({previous.date.slice(0, 10)}): {Math.round(before)} → {Math.round(now)}
                      {diff !== 0 ? ` (${diff > 0 ? "+" : ""}${diff})` : " (no change)"}
                    </p>
                  );
                })()}
                {t.reppo.status === "done" && t.reppo.critiques.length > 0 && (
                  <div className="critiques">
                    <div className="panel-label">What reviewers said</div>
                    <ul>{t.reppo.critiques.map((c, j) => <li key={j}>{c}</li>)}</ul>
                  </div>
                )}
                {t.reppo.status !== "done" && (
                  <p className="muted">Reppo review: {t.reppo.status === "error" ? "error" : t.reppo.status}</p>
                )}
                {t.serv && <p className="muted"><b>SERV:</b> {t.serv.summary}</p>}
                {t.meta?.answeredBy && (
                  <p className="muted route">
                    <b>Answered by:</b> the {t.meta.answeredBy} model{t.meta.model ? ` (${t.meta.model})` : ""}
                    {t.meta.costUsd !== undefined ? ` · cost $${t.meta.costUsd < 0.001 ? t.meta.costUsd.toFixed(5) : t.meta.costUsd.toFixed(4)}` : ""}
                  </p>
                )}
                <details>
                  <summary>Show the agent's answer</summary>
                  <Answer text={t.output} />
                </details>
              </div>
            );
          })}
        </>
      )}

      <div className="panel">
        <div className="panel-label">Show this grade on your site</div>
        <p><img src={badgeSrc} alt="Agent Report Card grade" /></p>
        <pre>{`<img src="${process.env.NEXT_PUBLIC_SITE_URL}/badge/${agent.id}.svg" alt="Agent Report Card grade" />`}</pre>
      </div>
    </main>
  );
}
