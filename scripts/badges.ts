// Writes the badge files for every agent to public/badge/ before the site is built:
//   <id>.svg                 the original flat badge
//   <id>-pill-dark.svg / -pill-light.svg
//   <id>-card-dark.svg / -card-light.svg
//   <id>.json                data for the "match my site" widget (public/badge.js)
import fs from "node:fs";
import path from "node:path";
import { badgeCardSvg, badgeJson, badgePillSvg, badgeSvg } from "../src/lib/badge";
import { latestRun, loadAgents, loadReport } from "../src/lib/data";

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
console.log(`Wrote badges for ${loadAgents().length} agents to public/badge/`);
