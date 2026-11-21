/**
 * Settles split tasks in the latest grades: where Reppo and SERV are
 * DISAGREEMENT_GAP or more points apart, a third judge reads the saved answer
 * (src/lib/tiebreak.ts) and the task scores the middle of the three. Then each
 * changed run's score and letter are recomputed. Its written summary is kept.
 * New grades do this on their own (scripts/grade.ts); this is for older ones.
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/tiebreak.ts
 */
import { loadAgents, loadReport, saveReport } from "../src/lib/data";
import { letterGrade, runScore } from "../src/lib/grade";
import { settleSplit } from "../src/lib/tiebreak";

async function main() {
  let calls = 0;
  for (const agent of loadAgents()) {
    const report = loadReport(agent.id);
    const run = report.runs.at(-1);
    if (!run) continue;
    let changed = false;
    for (const t of run.tasks) {
      if (await settleSplit(t, agent)) {
        calls++;
        changed = true;
        console.log(`${agent.id}/${t.taskId}: third judge ${t.tiebreak!.score} (sided with ${t.tiebreak!.sidedWith})`);
      }
    }
    if (!changed) continue;
    const before = `${run.grade} ${run.score}`;
    run.score = runScore(run.tasks);
    run.grade = run.score === null ? null : letterGrade(run.score);
    saveReport(report);
    console.log(`  ${agent.name}: ${before} -> ${run.grade} ${run.score}`);
  }
  console.log(`${calls} third-judge call(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
