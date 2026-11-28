/**
 * Regrades every agent marked `"schedule": "weekly"` in data/agents.json
 * (today that is Cheap First, our own agent), then checks the result for a
 * regression. Run by .github/workflows/weekly-grade.yml every Monday.
 *
 *   npx tsx scripts/weekly-grade.ts            # grade, wait for Reppo, check
 *   npx tsx scripts/weekly-grade.ts --finish   # finish last week's grade at Reppo (after a top-up)
 *   npx tsx scripts/weekly-grade.ts --check    # only check the saved results
 *
 * Cost per agent: one Reppo evaluation (440 credits) per task, plus a few
 * cents of SERV for the checks and summary. Cheap First has 3 tasks, so
 * about 1,320 Reppo credits a week.
 *
 * Writes a GitHub issue body to ALERT_FILE when something needs a person:
 * the agent couldn't be reached, Reppo didn't finish (often: out of
 * credits), or the grade went down. Sets the "alert" Actions output.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { loadAgents, loadReport, saveReport } from "../src/lib/data";
import { SITE_URL } from "../src/lib/links";
import type { AgentConfig, GradingRun } from "../src/lib/types";

const SITE = SITE_URL;

/** A drop of this many points or more, or a lower letter, counts as a regression. */
export const DROP_POINTS = 5;

const ORDER = ["F", "D", "C", "B", "A"];

export type Check =
  | { kind: "ok"; run: GradingRun; previous: GradingRun | null }
  | { kind: "no-run" }
  | { kind: "provisional"; run: GradingRun }
  | { kind: "dropped"; run: GradingRun; previous: GradingRun };

/**
 * Compares the run made this week with the last final run before it.
 * `runsBefore` is how many runs the report had before this week's grade.
 */
export function checkRuns(runs: GradingRun[], runsBefore: number): Check {
  if (runs.length <= runsBefore) return { kind: "no-run" };
  const run = runs.at(-1)!;
  if (run.provisional || run.score === null) return { kind: "provisional", run };
  const previous = runs.slice(0, -1).filter((r) => !r.provisional && r.score !== null).at(-1) ?? null;
  if (previous && previous.score !== null) {
    const letterDown = run.grade && previous.grade && ORDER.indexOf(run.grade) < ORDER.indexOf(previous.grade);
    if (letterDown || previous.score - run.score >= DROP_POINTS) return { kind: "dropped", run, previous };
  }
  return { kind: "ok", run, previous };
}

export function describe(agent: AgentConfig, c: Check): string | null {
  const page = `${SITE}/agents/${agent.id}/`;
  switch (c.kind) {
    case "ok":
      return null;
    case "no-run":
      return `**${agent.name}: not graded this week.** At least one task couldn't run (the agent was down, too slow or returned nothing). Nothing was saved and no Reppo credits were spent. See the workflow log for the error.`;
    case "provisional":
      return (
        `**${agent.name}: grade is still provisional.** Reppo didn't finish judging every answer. ` +
        `This usually means the Reppo account is out of credits. Top up at eval.reppo.xyz, then open ` +
        `Actions > "Weekly self-grade" > Run workflow and tick "Only finish the last grade" (no new answers, no double charge). ` +
        `Reppo status per task: ${c.run.tasks.map((t) => `${t.taskId} ${t.reppo.status}`).join(", ")}. [Report card](${page})`
      );
    case "dropped": {
      const lines = c.run.tasks.map((t) => {
        const was = c.previous.tasks.find((p) => p.taskId === t.taskId);
        const now = t.reppo.status === "done" ? t.reppo.score : t.serv?.score;
        const before = was ? (was.reppo.status === "done" ? was.reppo.score : was.serv?.score) : undefined;
        const route = t.meta?.answeredBy ? ` (answered by ${t.meta.answeredBy})` : "";
        return `- ${t.taskId}: ${before ?? "—"} → ${now ?? "—"}${route}`;
      });
      return (
        `**${agent.name} dropped from ${c.previous.grade} ${c.previous.score} (${c.previous.date.slice(0, 10)}) ` +
        `to ${c.run.grade} ${c.run.score} this week.**\n\n${lines.join("\n")}\n\n` +
        `Check the answers on the [report card](${page}). If a model or prompt changed in the agent since the last grade, that is the first suspect.`
      );
    }
  }
}

function grader(args: string[]): void {
  execFileSync("npx", ["tsx", "scripts/grade.ts", ...args], { stdio: "inherit", env: process.env });
}

function setOutput(name: string, value: string): void {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  const finish = process.argv.includes("--finish");
  const agents = loadAgents().filter((a) => a.schedule === "weekly");
  if (agents.length === 0) {
    console.log("No agents are marked for weekly grading.");
    return;
  }
  const before = new Map(agents.map((a) => [a.id, loadReport(a.id).runs.length - (checkOnly || finish ? 1 : 0)]));
  if (finish) {
    // Send last week's unjudged answers to Reppo again (for example after a
    // credit top-up). Reppo only charges for evaluations that complete.
    for (const a of agents) {
      const report = loadReport(a.id);
      const run = report.runs.at(-1);
      if (!run) continue;
      for (const t of run.tasks) {
        if (t.reppo.status === "error") {
          t.reppo = { status: "queued" };
          t.reppoRetried = false;
        }
      }
      saveReport(report);
    }
    grader(["--watch", ...agents.map((a) => a.id)]);
  } else if (!checkOnly) {
    for (const a of agents) grader([a.id]);
    grader(["--watch", ...agents.map((a) => a.id)]);
  }

  const notes: string[] = [];
  for (const a of agents) {
    const c = checkRuns(loadReport(a.id).runs, before.get(a.id)!);
    const note = describe(a, c);
    console.log(`${a.name}: ${c.kind}${"run" in c ? ` (${c.run.grade} ${c.run.score})` : ""}`);
    if (note) notes.push(note);
  }
  if (notes.length) {
    const file = process.env.ALERT_FILE || "alert.md";
    fs.writeFileSync(file, `The weekly self-grade needs a look.\n\n${notes.join("\n\n")}\n`);
    setOutput("alert", "true");
  }
}

if (process.argv[1]?.endsWith("weekly-grade.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
