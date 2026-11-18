// Writes the badge files for every agent to public/badge/ before the site is built:
//   <id>.svg                 the original flat badge
//   <id>-pill-dark.svg / -pill-light.svg
//   <id>-card-dark.svg / -card-light.svg
//   <id>.json                data for the "match my site" widget (public/badge.js)
import fs from "node:fs";
import path from "node:path";
import { badgeCardSvg, badgeJson, badgePillSvg, badgeSvg } from "../src/lib/badge";
import { latestRun, loadAgents, loadReport } from "../src/lib/data";
import { bestAnswer, CATEGORIES, trustRecord } from "../src/lib/trust";

const dir = path.join(process.cwd(), "public", "badge");
const site = (process.env.SITE_URL || "https://robd-hub.github.io/agent-report-card").replace(/\/$/, "");
fs.mkdirSync(dir, { recursive: true });
for (const agent of loadAgents()) {
  const run = latestRun(loadReport(agent.id));
  const out = (name: string, body: string) => fs.writeFileSync(path.join(dir, name), body);
  out(`${agent.id}.svg`, badgeSvg(run));
  for (const theme of ["dark", "light"] as const) {
    out(`${agent.id}-pill-${theme}.svg`, badgePillSvg(run, theme));
    out(`${agent.id}-card-${theme}.svg`, badgeCardSvg(run, theme));
  }
  out(`${agent.id}.json`, JSON.stringify(badgeJson(agent, run, `${site}/agents/${agent.id}/`)) + "\n");
}
// Trust Check files (src/lib/trust.ts): one per agent, plus an index of all of them.
const trustDir = path.join(process.cwd(), "public", "trust");
fs.mkdirSync(trustDir, { recursive: true });
const records = loadAgents().map((agent) => trustRecord(agent, loadReport(agent.id).runs, site));
for (const r of records) fs.writeFileSync(path.join(trustDir, `${r.agent.id}.json`), JSON.stringify(r, null, 2) + "\n");
fs.writeFileSync(path.join(trustDir, "index.json"), JSON.stringify({ version: 1, updated: new Date().toISOString(), agents: records }) + "\n");
// "Who's best" files: the top agents per category.
const bestDir = path.join(process.cwd(), "public", "best");
fs.mkdirSync(bestDir, { recursive: true });
const best = CATEGORIES.map((c) => bestAnswer(c.id, records));
for (const b of best) fs.writeFileSync(path.join(bestDir, `${b.category.id}.json`), JSON.stringify(b, null, 2) + "\n");
fs.writeFileSync(path.join(bestDir, "index.json"), JSON.stringify({ version: 1, updated: new Date().toISOString(), categories: best }) + "\n");
console.log(`Wrote Trust Check files for ${records.length} agents to public/trust/`);
console.log(`Wrote badges for ${loadAgents().length} agents to public/badge/`);
