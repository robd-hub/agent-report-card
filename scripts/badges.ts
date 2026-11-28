// Writes the badge files for every agent to public/badge/ before the site is built:
//   <id>.svg                 the original flat badge
//   <id>-pill-dark.svg / -pill-light.svg
//   <id>-card-dark.svg / -card-light.svg
//   <id>.json                data for the "match my site" widget (public/badge.js)
import fs from "node:fs";
import path from "node:path";
import { badgeCardSvg, badgeJson, badgePillSvg, badgeSvg } from "../src/lib/badge";
import { latestRun, loadAgents, loadReport } from "../src/lib/data";
import { lookupIndex } from "../src/lib/lookup";
import { bestAnswer, CATEGORIES, trustRecord } from "../src/lib/trust";
import { ccdFacts, loadCcd } from "../src/lib/concordium";
import { SITE_URL } from "../src/lib/links";

const dir = path.join(process.cwd(), "public", "badge");
const site = (process.env.SITE_URL || SITE_URL).replace(/\/$/, "");
fs.mkdirSync(dir, { recursive: true });
for (const agent of loadAgents()) {
  const run = latestRun(loadReport(agent.id));
  const report = `${site}/agents/${agent.id}/`;
  const out = (name: string, body: string) => fs.writeFileSync(path.join(dir, name), body);
  out(`${agent.id}.svg`, badgeSvg(run, report));
  for (const theme of ["dark", "light"] as const) {
    out(`${agent.id}-pill-${theme}.svg`, badgePillSvg(run, theme, report));
    out(`${agent.id}-card-${theme}.svg`, badgeCardSvg(run, theme, report));
  }
  out(`${agent.id}.json`, JSON.stringify(badgeJson(agent, run, report)) + "\n");
}
// Trust Check files (src/lib/trust.ts): one per agent, plus an index of all of them.
const trustDir = path.join(process.cwd(), "public", "trust");
fs.mkdirSync(trustDir, { recursive: true });
const records = (() => { const ccd = loadCcd(); return loadAgents().map((agent) => { const runs = loadReport(agent.id).runs; return trustRecord(agent, runs, site, ccdFacts(agent.id, runs, ccd)); }); })();
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
// Pre-hire lookup files (src/lib/lookup.ts): one per agent, plus an index with aliases.
const lookupDir = path.join(process.cwd(), "public", "lookup");
fs.mkdirSync(lookupDir, { recursive: true });
const lookup = lookupIndex(loadAgents(), (id) => loadReport(id).runs, site, Date.now(), loadCcd());
for (const r of lookup.agents) {
  if (!r.agent) continue;
  fs.writeFileSync(path.join(lookupDir, `${r.agent.id}.json`), JSON.stringify(r, null, 2) + "\n");
}
fs.writeFileSync(path.join(lookupDir, "index.json"), JSON.stringify(lookup, null, 2) + "\n");
console.log(`Wrote lookup files for ${lookup.agents.length} agents to public/lookup/`);
