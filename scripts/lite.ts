/**
 * Try the Lite Check (src/lib/lite.ts) from the command line, and check its
 * band against the real grades before builders see it.
 *
 *   npm run lite -- <agent id from data/agents.json>
 *   npm run lite -- <https address> "<what it does>"     (add mcp: before an MCP address)
 *   npm run lite -- --all                                (every graded agent: band vs letter)
 *
 * Needs SERV_API_KEY (and OPENSERV_USER_API_KEY for marketplace agents).
 * Saves nothing. Prints the result, its tokens and the estimated cost.
 */
import { bandOfLetter, runLite, type LiteResult, type LiteTarget } from "../src/lib/lite";
import { latestRun, loadAgents, loadReport } from "../src/lib/data";
import { findEndpoint } from "../src/lib/requests";
import type { AgentConfig } from "../src/lib/types";

function targetOf(agent: AgentConfig): LiteTarget {
  return { adapter: agent.adapter, endpoint: agent.endpoint, model: agent.model, marketplaceId: agent.marketplaceId, name: agent.name, whatItDoes: agent.description };
}

function print(name: string, r: LiteResult): void {
  console.log(`\n${name}: ${r.bandLabel}${r.average !== null ? ` (average ${r.average}, not shown to builders)` : ""}${r.reason ? `: ${r.reason}` : ""}`);
  for (const c of r.checks) console.log(`  [${c.status}] ${c.label}: ${c.detail}`);
  for (const t of r.tasks) console.log(`  task ${t.label}: ${t.score ?? "-"} ${t.summary}`);
  for (const f of r.findings) console.log(`  finding (${f.from}): ${f.text}`);
  console.log(`  ${r.cost.servCalls} SERV calls, ${r.cost.inputTokens} in / ${r.cost.outputTokens} out tokens, about $${r.cost.estimatedUsd.toFixed(4)}, ${(r.ms / 1000).toFixed(1)}s`);
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error('Usage: npm run lite -- <agent id> | <https address> "<what it does>" | --all');
    process.exit(1);
  }
  if (!process.env.SERV_API_KEY) {
    console.error("SERV_API_KEY is not set, so nothing can be judged.");
    process.exit(1);
  }
  const agents = loadAgents();

  if (args[0] === "--all") {
    let agree = 0;
    let compared = 0;
    let spend = 0;
    const rows: string[] = [];
    for (const agent of agents) {
      const run = latestRun(loadReport(agent.id));
      if (!run?.grade || run.provisional) continue;
      const r = await runLite(targetOf(agent));
      print(agent.name, r);
      spend += r.cost.estimatedUsd;
      const expected = bandOfLetter(run.grade);
      if (r.band !== "couldnt-check") {
        compared++;
        if (r.band === expected) agree++;
      }
      rows.push(`${agent.name.padEnd(40)} ${run.grade}  ${expected.padEnd(7)} ${r.band.padEnd(14)} ${r.band === expected ? "agrees" : "differs"}`);
    }
    console.log(`\n${"Agent".padEnd(40)} Grade  Expected Lite`);
    for (const row of rows) console.log(row);
    console.log(`\nLite band agrees with the real grade on ${agree} of ${compared} agents it could check. Estimated spend $${spend.toFixed(2)}.`);
    return;
  }

  const agent = agents.find((a) => a.id === args[0]);
  if (agent) {
    print(agent.name, await runLite(targetOf(agent)));
    return;
  }
  const found = findEndpoint(args[0], "");
  if (!found) {
    console.error("Not an agent id or a public https address.");
    process.exit(1);
  }
  const whatItDoes = args[1] ?? "";
  if (whatItDoes.length < 10) {
    console.error('Say what the agent does as the second argument, in quotes.');
    process.exit(1);
  }
  print(found.endpoint, await runLite({ adapter: found.adapter, endpoint: found.endpoint, model: found.model, whatItDoes }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
