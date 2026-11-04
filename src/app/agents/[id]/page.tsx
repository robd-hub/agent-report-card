import Link from "next/link";
import { notFound } from "next/navigation";
import { latestRun, loadAgents, loadReport } from "@/lib/data";
import { Answer, GradeRing, Meter } from "../../GradeBox";

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
                {run.provisional ? "Provisional: waiting on human reviews" : "Final"}
              </span>
              <span className="muted">Graded {run.date.slice(0, 10)}</span>
            </div>
          )}
        </div>
      </section>

      {!run && <div className="panel">This agent hasn't been graded yet.</div>}
      {run && (
        <>
          <div className="panel">
            <div className="panel-label">Verdict</div>
            <p className="verdict">{run.summary || "No summary yet."}</p>
            {report.runs.length > 1 && (
              <p className="muted">History: {report.runs.map((r) => `${r.date.slice(0, 10)} ${r.grade ?? "N/A"}`).join(" → ")}</p>
            )}
          </div>

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
                  <Meter label="Human reviewers (Reppo)" value={reppoScore} tone="violet" />
                  <Meter label="SERV Reasoning check" value={t.serv?.score ?? null} />
                </div>
                {t.reppo.status === "done" && t.reppo.critiques.length > 0 && (
                  <div className="critiques">
                    <div className="panel-label">What reviewers said</div>
                    <ul>{t.reppo.critiques.map((c, j) => <li key={j}>{c}</li>)}</ul>
                  </div>
                )}
                {t.reppo.status !== "done" && (
                  <p className="muted">Human review: {t.reppo.status === "error" ? "error" : t.reppo.status}</p>
                )}
                {t.serv && <p className="muted"><b>SERV:</b> {t.serv.summary}</p>}
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
