import Link from "next/link";
import { notFound } from "next/navigation";
import { latestRun, loadAgents, loadReport } from "@/lib/data";
import { disagreement, disagreementNote, excerpt, GRADE_MEANING, honestyParts, taskScore, weakestTask } from "@/lib/grade";
import { Answer, GradeRing, Meter, Trend } from "../../GradeBox";
import { kindScores } from "@/lib/taskKinds";
import { BadgePicker } from "./BadgePicker";
import { anchorFor, badgeCheckUrl, explorerTx, loadCcd } from "@/lib/concordium";
import { taskWording } from "@/lib/types";
import { runShape, type TaskShape } from "@/lib/shape";
import { latestReply, type BuilderReply } from "@/lib/replies";
import { builderReplyUrl, REGRADE_PRICE_USD, SITE_URL } from "@/lib/links";

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
  // Absolute, so the share picture loads from the public site whichever copy built the page.
  const image = { url: `${SITE_URL}/og/${agent.id}.png`, width: 1200, height: 630, alt: `${agent.name} grade card` };
  const url = `${SITE_URL}/agents/${agent.id}/`;
  return { title, description, alternates: { canonical: url }, openGraph: { title, description, url, images: [image] }, twitter: { card: "summary_large_image", title, description, images: [image] } };
}

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = loadAgents().find((a) => a.id === id);
  if (!agent) notFound();
  const report = loadReport(agent.id);
  const run = latestRun(report);
  const honesty = run ? honestyParts(run.tasks) : [];
  const kinds = run ? kindScores(run.tasks, agent) : [];
  const weakest = run ? weakestTask(run.tasks) : null;
  const weakestPrompt = weakest ? taskWording(weakest.task, agent)?.prompt ?? weakest.task.taskId : null;
  const weakestWhy = weakest
    ? (weakest.task.reppo.status === "done" ? weakest.task.reppo.critiques[0] : undefined) ?? weakest.task.serv?.summary ?? null
    : null;
  const shape = run ? runShape(run.tasks, agent) : null;
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
            {kinds.length > 2 && (
              <>
                <div className="panel-label trend-head">By task type</div>
                <div className="kind-scores">
                  {kinds.map((k) => (
                    <div key={k.kind} className="kind-score" title={`${k.count} ${k.count === 1 ? "task" : "tasks"}`}>
                      <b className="mono">{k.score ?? "—"}</b>
                      <span>{k.label}</span>
                      <small className="muted">{k.count} {k.count === 1 ? "task" : "tasks"}</small>
                    </div>
                  ))}
                </div>
              </>
            )}
            {report.runs.length > 1 && (
              <>
                <div className="panel-label trend-head">Score history</div>
                <Trend runs={report.runs} />
                <p className="muted">History: {report.runs.map((r) => `${r.date.slice(0, 10)} ${r.grade ?? "N/A"}`).join(" → ")}</p>
              </>
            )}
          </div>

          <BuilderReplyPanel reply={latestReply(agent.id)} latestGrade={run?.date ?? null} />

          {shape && <ShapePanel shape={shape} />}

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
                  {t.tiebreak && <Meter label="Third judge (tie-breaker)" value={t.tiebreak.score} />}
                </div>
                <ShapeLine s={shape?.tasks.find((x) => x.taskId === t.taskId) ?? null} />
                {split && (
                  <p className="split-note">
                    <b>⚑ Judges disagree{t.tiebreak ? ", settled by a third judge" : ""}.</b> {disagreementNote(split, t.tiebreak)}
                    {t.tiebreak && <><br /><span className="muted"><b>Third judge:</b> {t.tiebreak.summary}</span></>}
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
        <div className="panel-label">Built this agent?</div>
        <p className="muted">Add your side to this report, for example what you&apos;ve fixed since it was graded. Fixed the weak spots? A regrade uses the same tasks, so this page shows each task before and after.</p>
        <div className="cta-actions">
          <a className="btn btn-ghost" href={builderReplyUrl(agent.id)}>Reply to this grade</a>
          <Link className="btn btn-primary" href="/request">Regrade for ${REGRADE_PRICE_USD}</Link>
        </div>
      </div>

      <div className="panel">
        <div className="panel-label">Show off this grade</div>
        <p className="muted">Paste the README snippet into GitHub. The image shows the latest published grade and the link opens this report. The styles below are for a website.</p>
        <BadgePicker agentId={agent.id} agentName={agent.name} grade={run?.grade ?? null} score={run?.score ?? null} siteUrl={process.env.NEXT_PUBLIC_SITE_URL ?? ""} basePath={process.env.NEXT_PUBLIC_BASE_PATH ?? ""} />
      </div>
    </main>
  );
}

/** The builder's published reply, if any. Plain text: React escapes it. */
function BuilderReplyPanel({ reply, latestGrade }: { reply: BuilderReply | null; latestGrade: string | null }) {
  if (!reply) return null;
  const older = reply.gradeDate && latestGrade && reply.gradeDate !== latestGrade;
  return (
    <div className="panel builder-reply">
      <div className="panel-label">From the builder</div>
      {reply.text.split("\n\n").map((para, i) => (
        <p key={i} style={{ whiteSpace: "pre-line" }}>{para}</p>
      ))}
      <p className="muted small">
        {reply.author ? `@${reply.author}, ` : ""}{reply.date.slice(0, 10)}
        {reply.gradeDate ? `, about the grade from ${reply.gradeDate.slice(0, 10)}` : ""}
        {older ? " (the agent has been regraded since)" : ""}. Written by the builder, not checked by us.{" "}
        <a href={reply.proof} rel="nofollow noopener noreferrer">Builder&apos;s link</a>
      </p>
    </div>
  );
}

/** The answer-shape signals for a run: answer first, length score, padding, and fixes. */
function ShapePanel({ shape }: { shape: NonNullable<ReturnType<typeof runShape>> }) {
  const af = shape.answerFirst;
  const lengths = shape.tasks.filter((t) => t.length);
  return (
    <div className="panel shape">
      <div className="panel-label">Answer shape</div>
      <p className="muted small">
        Does it give the answer first, and keep to a sensible length? These are simple code checks on the saved answers. They don&apos;t change the grade, so you can work on them on their own.
      </p>
      <div className="kind-scores">
        {af && (
          <div className="kind-score" title="Tasks where the direct answer is in the first sentence, out of those with a checkable answer.">
            <b className="mono">{af.first}/{af.checked}</b>
            <span>Answer first</span>
            <small className="muted">answer in the first sentence</small>
          </div>
        )}
        {shape.lengthScore !== null && (
          <div className="kind-score" title="100 when an answer is within 10% of the length a good answer needs, falling to 0 at three times that.">
            <b className="mono">{shape.lengthScore}</b>
            <span>Length score</span>
            <small className="muted">{lengths.length - shape.overCount} of {lengths.length} within length</small>
          </div>
        )}
        <div className="kind-score" title="Answers at least twice as long as a complete answer needs.">
          <b className="mono">{shape.padded.length}</b>
          <span>Padded answers</span>
          <small className="muted">twice the length needed or more</small>
        </div>
      </div>
      {shape.fixes.length > 0 ? (
        <div className="shape-fixes">
          <div className="panel-label">How to fix it</div>
          <ul>{shape.fixes.map((f) => <li key={f}>{f}</li>)}</ul>
        </div>
      ) : (
        <p className="muted small">No problems here: answers come first and stay within length.</p>
      )}
    </div>
  );
}

/** One task's answer-shape result, under its scores. */
function ShapeLine({ s }: { s: TaskShape | null }) {
  if (!s || (!s.answerFirst && !s.length)) return null;
  const a = s.answerFirst;
  const l = s.length;
  const answer =
    a?.status === "first" ? { ok: true, text: "Answer first" }
    : a?.status === "buried" ? { ok: false, text: `Answer buried: it comes after ${a.wordsBefore} words` }
    : a?.status === "slow-start" ? { ok: false, text: `Slow start: opens with "${a.opener}…"` }
    : null;
  return (
    <p className="shape-line muted small">
      {answer && <span className={answer.ok ? "ok" : "warn"}>{answer.ok ? "✓" : "⚑"} {answer.text}</span>}
      {l && (
        <span className={l.padded || l.over ? "warn" : "ok"}>
          {l.padded ? "⚑ Padded" : l.over ? "⚑ Too long" : "✓ Length"}: {l.words} words ({l.source === "limit" ? "limit" : "a good answer needs about"} {l.target})
        </span>
      )}
    </p>
  );
}
