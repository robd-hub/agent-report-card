import Link from "next/link";
import { notFound } from "next/navigation";
import { latestRun, loadAgents, loadReport } from "@/lib/data";
import { disagreement, disagreementNote, excerpt, GRADE_MEANING, honestyParts, taskScore, weakestTask } from "@/lib/grade";
import { Answer, GradeRing, Meter, Trend } from "../../GradeBox";
import { BadgePicker } from "./BadgePicker";
import { anchorFor, badgeCheckUrl, explorerTx, loadCcd } from "@/lib/concordium";
import { taskWording } from "@/lib/types";

export function generateStaticParams() {
  return loadAgents().map((a) => ({ id: a.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = loadAgents().find((a) => a.id === id);
  const run = agent ? latestRun(loadReport(agent.id)) : null;
  if (!agent) return { title: "Agent Report Card" };
  const title = `${agent.name}: ${run?.grade ?? "not graded"} · Agent Report Card`;
  const description = run?.grade
    ? `${agent.name} scored ${run.score}/100 (${run.grade}) on ${run.tasks.length} real tasks, judged independently on Reppo and checked by SERV Reasoning. See every answer and critique.`
    : `${agent.name} hasn't been graded yet.`;
  const image = { url: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/og/${agent.id}.png`, width: 1200, height: 630, alt: `${agent.name} grade card` };
  return { title, description, openGraph: { title, description, images: [image] }, twitter: { card: "summary_large_image", title, description, images: [image] } };
}

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = loadAgents().find((a) => a.id === id);
  if (!agent) notFound();
  const report = loadReport(agent.id);
  const run = latestRun(report);
  const honesty = run ? honestyParts(run.tasks) : [];
  const weakest = run ? weakestTask(run.tasks) : null;
  const weakestPrompt = weakest ? taskWording(weakest.task, agent)?.prompt ?? weakest.task.taskId : null;
  const weakestWhy = weakest
    ? (weakest.task.reppo.status === "done" ? weakest.task.reppo.critiques[0] : undefined) ?? weakest.task.serv?.summary ?? null
    : null;
  const flagged = run ? run.tasks.filter((t) => disagreement(t) !== null).length : 0;
  const previous = report.runs.length > 1 ? report.runs.at(-2)! : null;
  const ccd = loadCcd();
  const onChain = anchorFor(agent.id, run, ccd);
  const registry = agent.concordiumBadge ? ccd.badges[agent.id] ?? null : null;

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
              {honesty.map((h) => (
                <span
                  key={h.id}
                  className={`chip ${h.status === "passed" ? "chip-ok" : h.status === "failed" ? "chip-bad" : "chip-warn"}`}
                  title={h.title}
                >
                  {honesty.length > 1 ? h.label : "Honesty check"}: {h.status}
                </span>
              ))}
              {flagged > 0 && (
                <a
                  href="#tasks"
                  className="chip chip-warn"
                  title="On these tasks the Reppo judges and the SERV check scored the answer very differently. See the note on each task."
                >
                  Judges disagree on {flagged} {flagged === 1 ? "task" : "tasks"}
                </a>
              )}
              {agent.selfGraded && <span className="chip chip-self">Self-graded</span>}
              {onChain && (
                <a href={explorerTx(onChain.tx)} className="chip chip-ok" title="This grade and a fingerprint of the full report are recorded on the Concordium test network.">
                  Recorded on Concordium ↗
                </a>
              )}
              {agent.concordiumBadge && (
                <a href={badgeCheckUrl(agent.concordiumBadge)} className="chip" title="This agent is in Concordium's Agent Registry. The check shows who owns it and whether its badge is valid.">
                  Concordium registry{registry?.tokenId !== undefined ? `: agent ${registry.tokenId}` : ""} ↗
                </a>
              )}
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

          {onChain && (
            <div className="panel">
              <div className="panel-label">Checked on Concordium</div>
              <p>
                This grade ({onChain.grade}, {onChain.score}/100) was written on the Concordium test network on {onChain.anchoredAt.slice(0, 10)},
                {onChain.badge ? " against this agent's own Concordium registry entry," : ""} with a fingerprint of the full report, so it can't be quietly changed later.{" "}
                <a href={explorerTx(onChain.tx)}>See it on CCDExplorer</a>.
              </p>
              <p className="muted small">
                Fingerprint (SHA-256 of this run in the <a href={`https://github.com/robd-hub/agent-report-card/blob/main/data/results/${agent.id}.json`}>public results file</a>):{" "}
                <span className="mono">{onChain.reportHash}</span>
              </p>
            </div>
          )}

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

          <div className="section-head" id="tasks"><h2>Test tasks</h2><span className="muted">{run.tasks.length} tasks</span></div>
          {run.tasks.map((t, i) => {
            const task = taskWording(t, agent);
            const reppoScore = t.reppo.status === "done" ? t.reppo.score : null;
            const split = disagreement(t);
            return (
              <div key={t.taskId} className={`panel task ${split ? "task-split" : ""}`}>
                <div className="task-head">
                  <span className="mono step-n">{String(i + 1).padStart(2, "0")}</span>
                  <h3>{task?.prompt ?? t.taskId}</h3>
                </div>
                <div className="meters">
                  <Meter label="Independent judges (Reppo)" value={reppoScore} tone="violet" />
                  <Meter label="SERV Reasoning check" value={t.serv?.score ?? null} />
                </div>
                {split && (
                  <p className="split-note">
                    <b>⚑ Judges disagree.</b> {disagreementNote(split)}
                  </p>
                )}
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
        <div className="panel-label">Show off this grade</div>
        <p className="muted">Add a badge to your site or README, or share it on X. Every version shows the latest grade and links back to this report.</p>
        <BadgePicker agentId={agent.id} agentName={agent.name} grade={run?.grade ?? null} score={run?.score ?? null} siteUrl={process.env.NEXT_PUBLIC_SITE_URL ?? ""} basePath={process.env.NEXT_PUBLIC_BASE_PATH ?? ""} />
      </div>
    </main>
  );
}
