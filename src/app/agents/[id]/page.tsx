import Link from "next/link";
import { notFound } from "next/navigation";
import { latestRun, loadAgents, loadReport } from "@/lib/data";
import { GradeBox } from "../../GradeBox";

export function generateStaticParams() {
  return loadAgents().map((a) => ({ id: a.id }));
}

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = loadAgents().find((a) => a.id === id);
  if (!agent) notFound();
  const report = loadReport(agent.id);
  const run = latestRun(report);

  return (
    <main>
      <p><Link href="/">← All agents</Link></p>
      <div className="row">
        <GradeBox grade={run?.grade ?? null} />
        <div>
          <h1>{agent.name}</h1>
          <div className="muted">{agent.description}</div>
        </div>
      </div>

      {!run && <p className="card">This agent hasn't been graded yet.</p>}
      {run && (
        <>
          <div className="card">
            <strong>Summary</strong> {run.provisional && <span className="tag">provisional: waiting on human reviews</span>}
            <p>{run.summary || "No summary yet."}</p>
            <div className="muted">Score {run.score ?? "n/a"} / 100 · graded {run.date.slice(0, 10)}</div>
          </div>

          {report.runs.length > 1 && (
            <div className="card">
              <strong>Grade history</strong>
              <p>{report.runs.map((r) => `${r.date.slice(0, 10)}: ${r.grade ?? "N/A"}`).join(" → ")}</p>
            </div>
          )}

          <h2>Test tasks</h2>
          {run.tasks.map((t) => {
            const task = agent.tasks.find((x) => x.id === t.taskId);
            return (
              <div key={t.taskId} className="card">
                <strong>{task?.prompt ?? t.taskId}</strong>
                <pre>{t.output}</pre>
                <div>SERV check: {t.serv ? `${t.serv.score}/100. ${t.serv.summary}` : "not run"}</div>
                <div>
                  Human reviewers (Reppo):{" "}
                  {t.reppo.status === "done"
                    ? `${t.reppo.score}/100. ${t.reppo.critiques.join(" ")}`
                    : t.reppo.status === "error"
                      ? "error"
                      : t.reppo.status}
                </div>
              </div>
            );
          })}
        </>
      )}

      <div className="card">
        <strong>Show this grade on your site</strong>
        <p>
          <img src={`${process.env.NEXT_PUBLIC_BASE_PATH}/badge/${agent.id}.svg`} alt="Agent Report Card grade" />
        </p>
        <pre>{`<img src="${process.env.NEXT_PUBLIC_SITE_URL}/badge/${agent.id}.svg" alt="Agent Report Card grade" />`}</pre>
      </div>
    </main>
  );
}
