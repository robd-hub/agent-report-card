/**
 * One-off: fill in the exact prompt and criteria on runs saved before answers
 * carried their own copy. For each run it finds the commit that first saved
 * that run, reads data/agents.json as it was in that commit, and copies the
 * task's wording from there. Safe to run again: runs that already have a
 * prompt are left alone.
 *
 *   npx tsx scripts/backfill-prompts.ts
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { AgentConfig, AgentReport } from "../src/lib/types";

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
const dir = path.join("data", "results");
const agentsAt = new Map<string, AgentConfig[]>();

function agentsAtCommit(sha: string): AgentConfig[] {
  if (!agentsAt.has(sha)) agentsAt.set(sha, JSON.parse(git("show", `${sha}:data/agents.json`)));
  return agentsAt.get(sha)!;
}

let filled = 0;
let missing = 0;
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const p = path.join(dir, file);
  const report: AgentReport = JSON.parse(fs.readFileSync(p, "utf8"));
  let changed = false;
  for (const run of report.runs) {
    if (run.tasks.every((t) => t.prompt !== undefined)) continue;
    // The first commit that saved this run.
    const sha = git("log", "--format=%H", "--reverse", "-S", run.date, "--", p).split("\n")[0];
    const agent = sha ? agentsAtCommit(sha).find((a) => a.id === report.agentId) : undefined;
    for (const t of run.tasks) {
      if (t.prompt !== undefined) continue;
      const task = agent?.tasks.find((x) => x.id === t.taskId);
      if (!task) {
        missing++;
        console.log(`  ${report.agentId} ${run.date.slice(0, 10)} ${t.taskId}: no wording found`);
        continue;
      }
      t.prompt = task.prompt;
      t.criteria = task.criteria;
      filled++;
      changed = true;
    }
  }
  if (changed) {
    // Keep the key order taskId, prompt, criteria, output, ...
    for (const run of report.runs) run.tasks = run.tasks.map(({ taskId, prompt, criteria, ...rest }) => ({ taskId, prompt, criteria, ...rest }));
    fs.writeFileSync(p, JSON.stringify(report, null, 2) + "\n");
  }
}
console.log(`Filled ${filled} answers, ${missing} without a match.`);
