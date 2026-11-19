/**
 * Runs every agent's test tasks, checks each answer with SERV Reasoning,
 * sends it to Reppo for human evaluation, and saves a grading run.
 *
 *   npm run grade                 # grade every agent
 *   npm run grade -- serv-baseline  # grade one agent
 *   npm run grade -- --refresh    # move the Reppo queue along once and stop
 *   npm run grade -- --watch      # keep moving the Reppo queue until every grade is final
 *   npm run grade -- --rebuild    # recompute the latest grade and summary from saved results
 *   npm run grade -- --disagreements  # list tasks where Reppo and SERV are far apart (no API calls)
 *
 * Reppo scores each answer in about 30-90 seconds. Answers are queued and
 * sent a few at a time, so a big batch doesn't reserve all our credits at once.
 */
import { prepareAgent, runAgent, type AgentReply } from "../src/lib/adapters";
import { DISAGREEMENT_GAP, disagreement, isProvisional, letterGrade, runScore } from "../src/lib/grade";
import { loadAgents, loadReport, saveReport } from "../src/lib/data";
import { fetchEvaluation, reppoConfigured, submitEvaluation } from "../src/lib/reppo";
import { servCheck, servChat, servConfigured } from "../src/lib/serv";
import type { AgentConfig, GradingRun, TaskResult } from "../src/lib/types";
import { taskWording } from "../src/lib/types";

/** Runs one task, trying once more if the agent errors or times out. */
async function runWithRetry(agent: AgentConfig, prompt: string): Promise<AgentReply> {
  try {
    return await runAgent(agent, prompt);
  } catch (e) {
    console.log(`  retrying after: ${(e as Error).message}`);
    await new Promise((r) => setTimeout(r, 10_000));
    return runAgent(agent, prompt);
  }
}

async function gradeAgent(agent: AgentConfig): Promise<void> {
  console.log(`\nGrading ${agent.name}`);
  // Set up anything the agent needs (such as its OpenServ workflow) once, before
  // the tasks run side by side, so parallel tasks don't each create one.
  await prepareAgent(agent);
  let failed = false;
  const tasks: TaskResult[] = await Promise.all(
    agent.tasks.map(async (task) => {
      let output = "";
      let meta: TaskResult["meta"];
      try {
        ({ answer: output, meta } = await runWithRetry(agent, task.prompt));
      } catch (e) {
        console.log(`  ${task.id}: could not run (${(e as Error).message})`);
        failed = true;
        return null as unknown as TaskResult;
      }
      const serv = servConfigured() ? await servCheck(task.prompt, task.criteria, output) : null;
      const reppo: TaskResult["reppo"] = reppoConfigured() ? { status: "queued" } : { status: "unconfigured" };
      console.log(`  ${task.id}: SERV ${serv ? serv.score : "skipped"}, Reppo ${reppo.status}`);
      return { taskId: task.id, prompt: task.prompt, criteria: task.criteria, ...(task.kind ? { kind: task.kind } : {}), output, serv, reppo, ...(meta ? { meta } : {}) };
    }),
  );
  // A grade with a missing task wouldn't be fair, so don't save a partial run.
  if (failed) return;
  const report = loadReport(agent.id);
  report.runs.push(await buildRun(agent, tasks));
  saveReport(report);
}

/** How many Reppo evaluations may be in flight at once. */
const MAX_IN_FLIGHT = 5;

/**
 * Moves the Reppo queue along: checks pending evaluations, then submits
 * queued answers until MAX_IN_FLIGHT are pending. Returns how many answers
 * are still waiting on Reppo across all agents.
 */
async function stepReppoQueue(agents: AgentConfig[]): Promise<number> {
  const reports = agents.map((a) => ({ agent: a, report: loadReport(a.id) }));
  const open = reports.flatMap(({ agent, report }) => {
    const run = report.runs.at(-1);
    if (!run) return [];
    return run.tasks.map((t) => ({ agent, report, run, t }));
  });

  // Give each answer one more try at Reppo after an error, unless we're out of credits.
  for (const item of open.filter((o) => o.t.reppo.status === "error" && !o.t.reppoRetried)) {
    if (/out of reppo credits/i.test((item.t.reppo as { message: string }).message)) continue;
    console.log(`  ${item.agent.name} / ${item.t.taskId}: retrying at Reppo after an error`);
    item.t.reppo = { status: "queued" };
    item.t.reppoRetried = true;
    saveReport(item.report);
  }

  let inFlight = 0;
  for (const item of open.filter((o) => o.t.reppo.status === "pending")) {
    const before = item.t.reppo;
    item.t.reppo = await fetchEvaluation((before as { evalId: string }).evalId);
    if (item.t.reppo.status === "pending") inFlight++;
    else {
      console.log(`  ${item.agent.name} / ${item.t.taskId}: Reppo ${item.t.reppo.status === "done" ? item.t.reppo.score + "/100" : item.t.reppo.status}`);
      const split = disagreement(item.t);
      if (split) console.log(`    ⚑ judges disagree: Reppo ${split.reppo} vs SERV ${split.serv} (${split.gap} points apart)`);
      await finish(item);
    }
  }

  for (const next of open.filter((o) => o.t.reppo.status === "queued")) {
    if (inFlight >= MAX_IN_FLIGHT) break;
    {
      // Judge the answer against the wording it was actually given.
      const task = taskWording(next.t, next.agent)!;
      const outcome = await submitEvaluation({ prompt: task.prompt, criteria: task.criteria, output: next.t.output });
      if (outcome.status === "busy") {
        console.log("  Reppo says it's busy; will retry.");
        break;
      } else {
        if (outcome.status === "pending") inFlight++;
        next.t.reppo = outcome;
        console.log(`  Sent ${next.agent.name} / ${next.t.taskId} to Reppo: ${outcome.status}${outcome.status === "error" ? ` (${outcome.message})` : ""}`);
        saveReport(next.report);
      }
    }
  }
  return open.filter((o) => o.t.reppo.status === "queued" || o.t.reppo.status === "pending").length;
}

async function finish(item: { agent: AgentConfig; report: ReturnType<typeof loadReport>; run: GradingRun }) {
  // Find the run by date: an earlier finish() in the same step may already have replaced the object.
  const idx = item.report.runs.findIndex((r) => r.date === item.run.date);
  item.report.runs[idx] = await buildRun(item.agent, item.run.tasks, item.run.date);
  saveReport(item.report);
}

async function buildRun(agent: AgentConfig, tasks: TaskResult[], date = new Date().toISOString()): Promise<GradingRun> {
  const score = runScore(tasks);
  return {
    date,
    tasks,
    score,
    grade: score === null ? null : letterGrade(score),
    provisional: isProvisional(tasks),
    summary: await writeSummary(agent, tasks),
  };
}

async function writeSummary(agent: AgentConfig, tasks: TaskResult[]): Promise<string> {
  if (!servConfigured()) return "";
  const notes = tasks
    .map((t) => {
      const critiques = t.reppo.status === "done" ? t.reppo.critiques.join("; ") : "none yet";
      return `Task ${t.taskId}: automatic check: ${t.serv?.summary ?? "n/a"}. Human critiques: ${critiques}.`;
    })
    .join("\n");
  return servChat(
    "You write short, plain-English report cards for AI agents. Two to three sentences: one strength, the biggest weakness, and what would most improve the grade.",
    `Agent: ${agent.name}\n${notes}`,
  );
}

/** Prints every task in the latest grades where the two judges are far apart, biggest gap first. */
function listDisagreements() {
  const rows: { agent: string; task: string; reppo: number; serv: number; gap: number; why: string }[] = [];
  for (const agent of loadAgents()) {
    const run = loadReport(agent.id).runs.at(-1);
    for (const t of run?.tasks ?? []) {
      const g = disagreement(t);
      if (g) rows.push({ agent: agent.id, task: t.taskId, reppo: g.reppo, serv: g.serv, gap: g.gap, why: t.serv?.summary ?? "" });
    }
  }
  rows.sort((a, b) => b.gap - a.gap);
  console.log(`${rows.length} task(s) where Reppo and SERV are ${DISAGREEMENT_GAP}+ points apart:\n`);
  for (const r of rows) console.log(`${r.agent} / ${r.task}: Reppo ${r.reppo}, SERV ${r.serv} (${r.gap} apart)\n  SERV: ${r.why}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const refresh = args.includes("--refresh");
  const watch = args.includes("--watch");
  const rebuild = args.includes("--rebuild");
  if (args.includes("--disagreements")) return listDisagreements();
  const only = args.filter((a) => !a.startsWith("--"));
  const agents = loadAgents().filter((a) => only.length === 0 || only.includes(a.id));
  if (!servConfigured()) console.log("Note: SERV_API_KEY is not set, so agents on SERV can't run and SERV checks are skipped.");
  if (!reppoConfigured()) console.log("Note: Reppo isn't configured, so grades stay provisional.");
  if (rebuild) {
    for (const agent of agents) {
      const report = loadReport(agent.id);
      const run = report.runs.at(-1);
      if (!run) continue;
      await finish({ agent, report, run });
      const after = report.runs.at(-1)!;
      console.log(`${agent.name}: ${after.grade ?? "no grade"} ${after.score ?? ""}${after.provisional ? " (provisional)" : ""}`);
    }
    return;
  }
  if (!refresh && !watch) for (const agent of agents) await gradeAgent(agent);
  if (!reppoConfigured()) return;
  // With agent ids given (as the weekly self-grade does), only move those
  // agents' answers through Reppo, so a scheduled run never spends credits on
  // anything else. With no ids, the queue covers every agent.
  const allAgents = only.length ? agents : loadAgents();
  let waiting = await stepReppoQueue(allAgents);
  console.log(`${waiting} answer(s) still waiting on Reppo.`);
  while (watch && waiting > 0) {
    await new Promise((r) => setTimeout(r, 20_000));
    waiting = await stepReppoQueue(allAgents);
    console.log(`${new Date().toISOString()}: ${waiting} answer(s) still waiting on Reppo.`);
  }
}

main()
  .then(async () => {
    // An ACP connection keeps an event stream open; close it so the run ends.
    if (loadAgents().some((a) => a.adapter === "virtuals-acp")) await (await import("../src/lib/acp")).closeAcp();
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
