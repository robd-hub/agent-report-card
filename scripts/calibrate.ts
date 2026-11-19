/**
 * Runs the grader test (see src/lib/calibration.ts).
 *
 *   npx tsx scripts/calibrate.ts --answer   # the clean agent answers the tasks (normal grading run, no Reppo yet)
 *   npx tsx scripts/calibrate.ts --plant    # make the planted and reworded answer sets from data/calibration/plants.json and SERV-check them
 *   npx tsx scripts/calibrate.ts --watch    # send every answer to Reppo and wait for the verdicts
 *   npx tsx scripts/calibrate.ts --report   # print the result (no API calls)
 *
 * Cost: 10 clean + 9 planted + 9 reworded answers = 28 Reppo evaluations
 * (about 12,300 credits) plus a few cents of SERV.
 */
import { execFileSync } from "node:child_process";
import { CAUGHT_MARGIN, CLEAN_ID, loadCalibration, loadControlRun, loadPlants, PLANTED_ID, REWORDED_ID } from "../src/lib/calibration";
import { isProvisional, letterGrade, runScore } from "../src/lib/grade";
import { reppoConfigured } from "../src/lib/reppo";
import { servCheck } from "../src/lib/serv";
import type { AgentReport, TaskResult } from "../src/lib/types";

process.env.ARC_DATA_DIR = "data/calibration";

async function plant() {
  // Imported after ARC_DATA_DIR is set, so it saves into data/calibration.
  const { saveReport } = await import("../src/lib/data");
  const clean = loadControlRun(CLEAN_ID);
  if (!clean) throw new Error("Run --answer first: the clean agent has no answers yet.");
  const plants = loadPlants();
  for (const [id, field] of [[PLANTED_ID, "planted"], [REWORDED_ID, "reworded"]] as const) {
    const tasks: TaskResult[] = [];
    for (const [taskId, p] of Object.entries(plants)) {
      const source = clean.tasks.find((t) => t.taskId === taskId);
      if (!source) throw new Error(`The clean run has no answer for ${taskId}`);
      const output = p[field];
      const serv = await servCheck(source.prompt!, source.criteria!, output);
      console.log(`${id} / ${taskId}: SERV ${serv.score}`);
      tasks.push({ taskId, prompt: source.prompt, criteria: source.criteria, ...(source.kind ? { kind: source.kind } : {}), output, serv, reppo: reppoConfigured() ? { status: "queued" } : { status: "unconfigured" } });
    }
    const score = runScore(tasks);
    const report: AgentReport = { agentId: id, runs: [{ date: new Date().toISOString(), tasks, score, grade: score === null ? null : letterGrade(score), provisional: isProvisional(tasks), summary: "" }] };
    saveReport(report);
  }
}

function report() {
  const s = loadCalibration();
  const pct = (t: { hits: number; total: number }) => `${t.hits}/${t.total}`;
  console.log(`\nGrader test${s.complete ? "" : " (not finished yet)"}\n`);
  for (const set of s.sets) console.log(`${(set.grade ?? "-").padEnd(2)} ${String(set.score ?? "-").padStart(3)}  ${set.name}`);
  console.log(`\nPlanted errors caught (${CAUGHT_MARGIN}+ points below the clean answer): ${pct(s.caught.both)}  (Reppo alone ${pct(s.caught.reppo)}, SERV alone ${pct(s.caught.serv)})`);
  console.log(`False alarms on reworded answers: ${pct(s.falseAlarms.both)}  (Reppo alone ${pct(s.falseAlarms.reppo)}, SERV alone ${pct(s.falseAlarms.serv)})`);
  for (const c of s.checks) {
    const p = c.planted.both, r = c.reworded.both;
    console.log(`  ${c.taskId.padEnd(18)} clean ${String(p.clean ?? "…").padStart(3)}  planted ${String(p.other ?? "…").padStart(3)} ${c.caught === null ? "" : c.caught ? "caught" : "MISSED"}  reworded ${String(r.other ?? "…").padStart(3)} ${c.falseAlarm ? "FALSE ALARM" : ""}`);
  }
  if (s.naturalMiss) console.log(`\nThe clean model's own mistake: ${s.naturalMiss.taskId} (Reppo ${s.naturalMiss.reppo ?? "…"}, SERV ${s.naturalMiss.serv ?? "…"})`);
}

async function main() {
  const args = process.argv.slice(2);
  const grade = (extra: string[]) => execFileSync("npx", ["tsx", "scripts/grade.ts", ...extra], { stdio: "inherit", env: process.env });
  if (args.includes("--answer")) grade([CLEAN_ID]);
  if (args.includes("--plant")) await plant();
  if (args.includes("--watch")) grade(["--watch"]);
  report();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
