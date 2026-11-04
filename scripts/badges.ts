// Writes one badge image per agent to public/badge/<agent-id>.svg before the site is built.
import fs from "node:fs";
import path from "node:path";
import { badgeSvg } from "../src/lib/badge";
import { latestRun, loadAgents, loadReport } from "../src/lib/data";

const dir = path.join(process.cwd(), "public", "badge");
fs.mkdirSync(dir, { recursive: true });
for (const agent of loadAgents()) {
  fs.writeFileSync(path.join(dir, `${agent.id}.svg`), badgeSvg(latestRun(loadReport(agent.id))));
}
console.log(`Wrote ${loadAgents().length} badges to public/badge/`);
