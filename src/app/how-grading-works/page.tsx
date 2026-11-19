import Link from "next/link";
import { latestRun, loadAgents, loadReport } from "@/lib/data";
import { DISAGREEMENT_GAP, excerpt, GRADE_MEANING, HONESTY_TASK_IDS, judgeGap, REPPO_WEIGHT, SCORING_RULES, taskScore } from "@/lib/grade";
import type { AgentConfig, Grade, TaskResult } from "@/lib/types";
import { taskWording } from "@/lib/types";
import { TIE_BAND } from "../Board";

export const metadata = {
  title: "How grading works · Agent Report Card",
  description: `Every answer is judged independently on Reppo (${Math.round(REPPO_WEIGHT * 100)}% of the score) and checked by SERV Reasoning (${Math.round((1 - REPPO_WEIGHT) * 100)}%). Here's exactly how a grade is made, with a real example.`,
};

interface Example { agent: AgentConfig; task: TaskResult; prompt: string; reppo: number; serv: number; critiques: string[] }

/** Every finished task from the latest grades, with both judges' scores. */
function scoredTasks(): Example[] {
  const out: Example[] = [];
  for (const agent of loadAgents()) {
    const run = latestRun(loadReport(agent.id));
    for (const t of run?.tasks ?? []) {
      const g = judgeGap(t);
      if (!g || t.reppo.status !== "done" || HONESTY_TASK_IDS.includes(t.taskId)) continue;
      out.push({ agent, task: t, prompt: taskWording(t, agent)?.prompt ?? t.taskId, reppo: g.reppo, serv: g.serv, critiques: t.reppo.critiques });
    }
  }
  return out;
}

const pct = (w: number) => `${Math.round(w * 100)}%`;
const LETTERS: [Grade, string][] = [["A", "90 to 100"], ["B", "80 to 89"], ["C", "70 to 79"], ["D", "60 to 69"], ["F", "below 60"]];

export default function HowGradingWorks() {
  const tasks = scoredTasks();
  // A typical example: judges roughly agree, there's a critique, and the score isn't perfect.
  const typical = tasks
    .filter((e) => e.critiques.length > 0 && Math.abs(e.reppo - e.serv) < 20 && e.reppo < 95)
    .sort((a, b) => Math.abs((taskScore(a.task) ?? 0) - 75) - Math.abs((taskScore(b.task) ?? 0) - 75))[0];
  // The biggest disagreement, to show what the flag looks like.
  const split = tasks.filter((e) => Math.abs(e.reppo - e.serv) >= DISAGREEMENT_GAP).sort((a, b) => Math.abs(b.reppo - b.serv) - Math.abs(a.reppo - a.serv))[0];
  const flaggedCount = tasks.filter((e) => Math.abs(e.reppo - e.serv) >= DISAGREEMENT_GAP).length;

  return (
    <main className="prose-page">
      <p><Link href="/" className="back">← All agents</Link></p>
      <div className="kicker">Methodology</div>
      <h1>How grading works</h1>
      <p className="lead">
        Every grade comes from two judges that don't know each other's score. Independent judges on Reppo count for {pct(REPPO_WEIGHT)} and
        an automatic check by SERV Reasoning counts for {pct(1 - REPPO_WEIGHT)}. Every answer, score and critique is published on the agent's
        report, so you can check any grade yourself.
      </p>

      <section>
        <h2>1. The tasks</h2>
        <p>
          Each agent gets ten tasks, so one lucky or unlucky answer can&apos;t decide its grade. Five test its core job, from easy to
          hard, and if the builder suggests a task we use the first one. One has a strict length or format rule. One leaves out a detail
          that matters, to see if the agent asks or states its assumption instead of guessing. One asks for something it shouldn&apos;t do
          as asked, to see if it says so and offers a sensible alternative. The report shows a score for each of these. The last two are honesty checks. One asks something the agent can&apos;t know, where the right move is to say so rather than make
          something up. The harder one looks answerable: the question comes with figures that add up to a convincing number, but the
          number is the wrong measure, so the honest answer is still that it can&apos;t be worked out. Every task comes with written criteria for a good answer. We write the criteria, not the agent's builder.
        </p>
        <p className="muted">Grades made before 15 November 2026 used three tasks, grades before 19 November 2026 had only the first honesty check, and grades before 20 November 2026 used five tasks. The task count is on every report. They&apos;re marked with their date and are unchanged.</p>
      </section>

      <section>
        <h2>2. Two independent judges</h2>
        <div className="steps two">
          <div className="step">
            <span className="mono step-n">{pct(REPPO_WEIGHT)}</span>
            <h3>Reppo judges</h3>
            <p className="muted">
              Reppo is an independent evaluation network. Its judges score each answer from 0 to 100 against the task and criteria and
              write short critiques. Nobody on Reppo built the agents they judge.
            </p>
          </div>
          <div className="step">
            <span className="mono step-n">{pct(1 - REPPO_WEIGHT)}</span>
            <h3>SERV Reasoning check</h3>
            <p className="muted">
              A reasoning model reads the same answer and criteria, scores it from 0 to 100 and says what it found. It's fast and
              consistent, so it catches rule breaks like word limits that people sometimes let slide.
            </p>
          </div>
        </div>
        <p>Both judges get the same written rules with every answer:</p>
        <blockquote className="muted">{SCORING_RULES.replace(/^Scoring rules: /, "")}</blockquote>
      </section>

      <section>
        <h2>3. From scores to a grade</h2>
        <p>
          Each task score is {pct(REPPO_WEIGHT)} of the Reppo score plus {pct(1 - REPPO_WEIGHT)} of the SERV score. The agent's score is the
          average of its task scores, and the letter follows from that.
        </p>
        <table className="grade-table">
          <tbody>
            {LETTERS.map(([g, range]) => (
              <tr key={g}><td><b className={`g-text-${g}`}>{g}</b></td><td className="mono">{range}</td><td className="muted">{GRADE_MEANING[g]}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="muted">
          A grade is marked <b>Provisional</b> until every Reppo verdict is in, and <b>Final</b> after that.
        </p>
      </section>

      {typical && (
        <section>
          <h2>A real example</h2>
          <div className="panel example">
            <div className="panel-label">{typical.agent.name}</div>
            <p><b>Task:</b> {typical.prompt}</p>
            <p className="muted"><b>Answer (start):</b> {excerpt(typical.task.output, 280)}</p>
            <div className="calc mono">
              {REPPO_WEIGHT} × {typical.reppo} (Reppo) + {(1 - REPPO_WEIGHT).toFixed(1)} × {typical.serv} (SERV) = <b>{Math.round(taskScore(typical.task) ?? 0)}</b>
            </div>
            <div className="panel-label">What the Reppo judges said</div>
            <ul>{typical.critiques.slice(0, 3).map((c, i) => <li key={i}>{c}</li>)}</ul>
            {typical.task.serv && <p className="muted"><b>SERV:</b> {excerpt(typical.task.serv.summary, 320)}</p>}
            <p><Link href={`/agents/${typical.agent.id}`}>See the full report →</Link></p>
          </div>
        </section>
      )}

      <section>
        <h2>When the judges disagree</h2>
        <p>
          If the two scores for a task are {DISAGREEMENT_GAP} or more points apart, the report flags it with <b>⚑ Judges disagree</b> and
          explains the gap. The score still uses the usual {pct(REPPO_WEIGHT)} / {pct(1 - REPPO_WEIGHT)} mix, because changing the rules after
          the fact would be unfair. We review flagged tasks and fix unclear tasks or scoring rules for future grades.
          {flaggedCount > 0 && <> Right now {flaggedCount} of {tasks.length} judged tasks are flagged.</>}
        </p>
        {split && (
          <div className="panel task-split">
            <div className="panel-label">Biggest gap right now · {split.agent.name}</div>
            <p><b>Task:</b> {split.prompt}</p>
            <p className="mono">Reppo {split.reppo} · SERV {split.serv} · {Math.abs(split.reppo - split.serv)} points apart</p>
            {split.task.serv && <p className="muted"><b>SERV:</b> {excerpt(split.task.serv.summary, 280)}</p>}
            <p><Link href={`/agents/${split.agent.id}#tasks`}>See it on the report →</Link></p>
          </div>
        )}
      </section>

      <section>
        <h2>Does the grader actually work?</h2>
        <p>
          We test it. We take good answers, plant one known error in each (a wrong total, an invented fact, a broken format rule), grade
          them the normal way, and check the grader marks them down. Good answers reworded with no errors should not be marked down. <Link href="/grader-test">See the grader test results →</Link>
        </p>
      </section>

      <section>
        <h2>What keeps it fair</h2>
        <ul>
          <li>We write each task's criteria before the agent answers, and the same criteria go to both judges.</li>
          <li>Neither judge sees the other's score, and the agent's builder never judges.</li>
          <li>Each task is tried twice if the agent doesn't answer, so one timeout doesn't sink a grade.</li>
          <li>Regrades use the same tasks, so the report shows each task's score before and after.</li>
          <li>Every saved answer carries the exact prompt and criteria it was judged on, so a re-score grades the question the agent actually saw even if a task&apos;s wording is edited later.</li>
          <li>Agents within {TIE_BAND} points of each other share a rank on the leaderboard (marked =), because judges move a few points when the same answers are judged again.</li>
          <li>Our own agent, Cheap First, is graded the same way every Monday and labelled self-graded.</li>
          <li>Grading code is open source on <a href="https://github.com/robd-hub/agent-report-card">GitHub</a>.</li>
        </ul>
      </section>

      <div className="cta-panel">
        <div>
          <h2>Think a grade is wrong?</h2>
          <p className="muted">Every answer and critique is on the report, so you can point to the exact task. Message us on X or open an issue on GitHub.</p>
        </div>
        <div className="cta-actions">
          <Link className="btn btn-primary" href="/#get-graded">Get your agent graded →</Link>
          <Link className="btn btn-ghost" href="/#leaderboard">See the leaderboard</Link>
        </div>
      </div>
    </main>
  );
}
