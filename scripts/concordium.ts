/**
 * Concordium test-network jobs for Agent Report Card.
 *
 *   npx tsx scripts/concordium.ts card                 Write our Agent Card (public/concordium/agent-card.json)
 *   npx tsx scripts/concordium.ts pin                  Pin that card's SHA-256 to our registry entry
 *   npx tsx scripts/concordium.ts register <agentId>   Register one of OUR OWN agents (e.g. cheap-first) and pin its card
 *   npx tsx scripts/concordium.ts anchor [--all|ids]   Write final grades on-chain (skips ones already written)
 *   npx tsx scripts/concordium.ts verify <agentId>     Recompute a grade's fingerprint and compare it with the chain
 *   npx tsx scripts/concordium.ts status               Account balance and registry badge check
 *
 * Needs CONCORDIUM_TESTNET_KEY for anything that sends a transaction. `anchor`
 * does nothing unless CONCORDIUM_ENABLED=1, so the grading workflows can call
 * it every time and it only starts writing once the switch is on.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { latestRun, loadAgents, loadReport } from "../src/lib/data";
import {
  ARC_BADGE,
  ARC_CARD_URL,
  ARC_TOKEN_ID,
  CCD_ACCOUNT,
  WALLET_PROXY,
  anchorFor,
  badgeCheckUrl,
  cborText,
  ccdEnabledForBot,
  explorerTx,
  gradeRecord,
  loadCcd,
  readCborText,
  reportHash,
  saveCcd,
} from "../src/lib/concordium";
import { checkBadge, registryTool, registerData, updateContract, waitFinal } from "../src/lib/concordiumChain";
import type { AgentConfig } from "../src/lib/types";

const SITE = "https://robd-hub.github.io/agent-report-card";
const PUBLIC = path.join(process.cwd(), "public", "concordium");
const AGENTS_FILE = path.join(process.cwd(), "data", "agents.json");
const sha256 = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");

const ARC_CARD = {
  name: "Agent Report Card",
  description:
    "Independent A to F grades for AI agents. Each grade comes from real test tasks, checked by SERV Reasoning and judged by independent reviewers on Reppo. Final grades are written on the Concordium test network, so anyone can check them.",
  skills: [
    { id: "grade-lookup", name: "Grade lookup", description: "Look up the independent grade (A to F) for an AI agent, with its score, honesty check and full report.", tags: ["trust", "evaluation"] },
    { id: "trust-check", name: "Trust check", description: "Ask whether an agent is safe to hire for a job before paying it.", tags: ["trust"] },
    { id: "get-graded", name: "Get graded", description: "Request a full grade for your own agent, paid in USDC on Base or in CCD on Concordium.", tags: ["evaluation", "payments"] },
  ],
  services: {
    trustCheck: "https://agent-report-card.vercel.app/api/trust/",
    whosBest: "https://agent-report-card.vercel.app/api/best/",
    gradeRequest: "https://github.com/robd-hub/agent-report-card/issues/new?template=grade-request.yml",
    leaderboard: `${SITE}/`,
  },
};

/** Builds an A2A Agent Card with the Concordium badge, via Concordium's registry service, and saves it verbatim. */
async function writeCard(file: string, url: string, tokenId: number, info: { name: string; description: string; skills: unknown[]; services?: Record<string, string> }) {
  const out = await registryTool<{ agent_card_json: string; metadata_hash_hex: string }>("build_agent_card", {
    network: "testnet",
    name: info.name,
    description: info.description.slice(0, 2048),
    agent_uri: url,
    owner_account: CCD_ACCOUNT,
    token_id: String(tokenId),
    skills: info.skills,
    provider: { organization: "Agent Report Card", url: `${SITE}/` },
    documentation_url: "https://github.com/robd-hub/agent-report-card",
    ...(info.services ? { services: info.services } : {}),
  });
  fs.mkdirSync(PUBLIC, { recursive: true });
  fs.writeFileSync(file, out.agent_card_json);
  if (sha256(fs.readFileSync(file)) !== out.metadata_hash_hex) throw new Error("Card hash mismatch after saving");
  console.log(`Wrote ${path.relative(process.cwd(), file)} (sha256 ${out.metadata_hash_hex})`);
  return out.metadata_hash_hex;
}

/** Pins a card's hash (and URL) on an agent's registry entry. */
async function pin(tokenId: number, url: string, file: string) {
  const hash = sha256(fs.readFileSync(file));
  const p = await registryTool<{ parameter_hex: string; suggested_energy?: number }>("build_set_agent_uri", {
    network: "testnet",
    token_id: String(tokenId),
    agent_uri: url,
    metadata_hash_hex: hash,
    sender: CCD_ACCOUNT,
  });
  const tx = await updateContract("CIS-8004.setAgentURI", p.parameter_hex, BigInt(p.suggested_energy ?? 30_000));
  await waitFinal(tx);
  console.log(`Pinned card hash ${hash} on agent ${tokenId}: ${explorerTx(tx)}`);
}

/** Registers one of our own agents (never someone else's) and pins its card. */
async function registerOwn(agentId: string) {
  const agents = loadAgents();
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) throw new Error(`No agent "${agentId}" in data/agents.json`);
  if (!agent.selfGraded) throw new Error(`${agent.name} isn't one of our own agents, so we can't register it. Its owner registers it and tells us its badge.`);
  if (agent.concordiumBadge) throw new Error(`${agent.name} already has badge ${agent.concordiumBadge}`);
  const url = `${SITE}/concordium/${agent.id}.json`;
  const p = await registryTool<{ parameter_hex: string; suggested_energy?: number }>("build_register", { network: "testnet", sender: CCD_ACCOUNT, agent_uri: url });
  const tx = await updateContract("CIS-8004.register", p.parameter_hex, BigInt(p.suggested_energy ?? 30_000));
  await waitFinal(tx);
  const mine = await registryTool<{ token_id: number | string; agent_uri: string }[] | { agents?: { token_id: number | string; agent_uri: string }[] }>("agents_by_owner", { owner_account: CCD_ACCOUNT, network: "testnet" });
  const list = Array.isArray(mine) ? mine : mine.agents ?? [];
  const entry = list.filter((a) => a.agent_uri === url).sort((a, b) => Number(b.token_id) - Number(a.token_id))[0];
  if (!entry) throw new Error(`Registered (${explorerTx(tx)}) but couldn't find the new token yet; run again later`);
  const tokenId = Number(entry.token_id);
  const info = await registryTool<{ token_address: string }>("agent_of", { network: "testnet", token_id: String(tokenId) });
  const file = path.join(PUBLIC, `${agent.id}.json`);
  await writeCard(file, url, tokenId, {
    name: agent.name,
    description: agent.description,
    skills: [{ id: "answer", name: "Answer", description: agent.description, tags: ["answers"] }],
    ...(agent.endpoint ? { services: { endpoint: agent.endpoint } } : {}),
  });
  await pin(tokenId, url, file);
  agent.concordiumBadge = info.token_address;
  fs.writeFileSync(AGENTS_FILE, JSON.stringify(agents, null, 2) + "\n");
  console.log(`${agent.name} is agent ${tokenId}, badge ${info.token_address} (registered ${explorerTx(tx)})`);
}

/** Writes each agent's latest final grade on-chain, if it isn't already. */
async function anchor(ids: string[]) {
  if (!ccdEnabledForBot()) {
    console.log("Concordium is switched off (CONCORDIUM_ENABLED isn't 1), so no grades were written on-chain.");
    return;
  }
  const agents = loadAgents();
  const picked: AgentConfig[] = ids.includes("--all") || ids.length === 0 ? agents : agents.filter((a) => ids.includes(a.id));
  const data = loadCcd();
  let written = 0;
  for (const agent of picked) {
    const run = latestRun(loadReport(agent.id));
    if (!run || run.provisional || !run.grade) continue;
    if (anchorFor(agent.id, run, data)) continue;
    let badge: string | undefined;
    if (agent.concordiumBadge) {
      try {
        const status = await checkBadge(agent.concordiumBadge);
        data.badges[agent.id] = status;
        if (status.tokenId !== undefined) badge = agent.concordiumBadge;
      } catch (e) {
        console.error(`Couldn't check ${agent.name}'s badge: ${(e as Error).message}`);
      }
    }
    const record = gradeRecord(agent.id, run, badge);
    try {
      const tx = await registerData(cborText(record));
      await waitFinal(tx);
      (data.anchors[agent.id] ??= []).push({
        runDate: run.date,
        grade: run.grade,
        score: run.score,
        reportHash: reportHash(run),
        ...(badge ? { badge } : {}),
        tx,
        anchoredAt: new Date().toISOString(),
      });
      saveCcd(data);
      written++;
      console.log(`${agent.name}: ${run.grade} (${run.score}) written on-chain: ${explorerTx(tx)}`);
    } catch (e) {
      // Never fail a grade because the chain is slow; the next run retries.
      console.error(`${agent.name}: couldn't write the grade on-chain: ${(e as Error).message}`);
    }
  }
  console.log(`Wrote ${written} grade${written === 1 ? "" : "s"} on-chain.`);
}

/** Shows that a published grade matches what's on-chain. */
async function verify(agentId: string) {
  const report = loadReport(agentId);
  const data = loadCcd();
  for (const a of data.anchors[agentId] ?? []) {
    const run = report.runs.find((r) => r.date === a.runDate);
    const local = run ? reportHash(run) : "(run missing)";
    const res = await fetch(`${WALLET_PROXY}/v0/submissionStatus/${a.tx}`);
    const s = (await res.json()) as { status: string; outcome?: string; registeredData?: string };
    const onChain = s.registeredData ? readCborText(Buffer.from(s.registeredData, "hex")) : null;
    const chainHash = onChain ? (JSON.parse(onChain) as { h?: string }).h : undefined;
    console.log(`${a.runDate.slice(0, 10)} ${a.grade} ${a.score}: ${s.status}/${s.outcome}`);
    console.log(`  on-chain record: ${onChain ?? "(not readable from the proxy; see the explorer)"}`);
    console.log(`  fingerprint now: ${local} ${chainHash ? (chainHash === local ? "MATCHES the chain" : "DOES NOT MATCH the chain") : ""}`);
    console.log(`  ${explorerTx(a.tx)}`);
  }
}

async function status() {
  const bal = (await (await fetch(`${WALLET_PROXY}/v1/accBalance/${CCD_ACCOUNT}`)).json()) as { finalizedBalance?: { accountAmount?: string } };
  console.log(`Account ${CCD_ACCOUNT}: ${Number(bal.finalizedBalance?.accountAmount ?? 0) / 1e6} CCD`);
  const badge = await checkBadge(ARC_BADGE);
  console.log(`Agent Report Card: agent ${ARC_TOKEN_ID}, badge ${ARC_BADGE}, verified=${badge.verified} (${badgeCheckUrl(ARC_BADGE)})`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "card") return void (await writeCard(path.join(PUBLIC, "agent-card.json"), ARC_CARD_URL, ARC_TOKEN_ID, ARC_CARD));
  if (cmd === "pin") return pin(ARC_TOKEN_ID, ARC_CARD_URL, path.join(PUBLIC, "agent-card.json"));
  if (cmd === "register" && rest[0]) return registerOwn(rest[0]);
  if (cmd === "anchor") return anchor(rest);
  if (cmd === "verify" && rest[0]) return verify(rest[0]);
  if (cmd === "status") return status();
  console.log("Usage: npx tsx scripts/concordium.ts card | pin | register <agentId> | anchor [--all|ids] | verify <agentId> | status");
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
