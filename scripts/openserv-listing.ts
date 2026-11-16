/**
 * Sets up Agent Report Card and Cheap First as agents on OpenServ, and
 * prepares their ERC-8004 on-chain identities. A one-off admin tool; see
 * OPENSERV.md for the whole process.
 *
 *   npm run openserv -- provision <arc|cf>
 *       Creates (or updates) the agent on platform.openserv.ai with its
 *       endpoint, plus a workspace with a paid x402 trigger whose payments go
 *       to PAY_ADDRESS. Writes the agent's secrets to .openserv.json (git
 *       ignored); they go into the app's Vercel settings as OPENSERV_API_KEY and
 *       OPENSERV_AUTH_TOKEN. Never prints them.
 *
 *   npm run openserv -- card <arc|cf>
 *       Builds the ERC-8004 agent card (what the agent does and how to call
 *       and pay it) into public/erc8004/<name>.json, served by the site, and
 *       prints its address, which the signing page
 *       (public/erc8004/register.html) registers on Base.
 *
 *   npm run openserv -- saved <arc|cf> <txHash> <agentNumber>
 *       After Rob signs, records the registration on OpenServ so the
 *       workspace shows it.
 *
 * Needs OPENSERV_USER_API_KEY (the account key, not an agent key).
 */
import fs from "node:fs";
import { PlatformClient, provision, triggers } from "@openserv-labs/client";
import { PAY_ADDRESS } from "../src/lib/links";

interface Listing {
  agentName: string;
  workflowName: string;
  endpointUrl: string;
  description: string;
  trigger: { name: string; description: string; price: string; input: Record<string, { type: "string"; description: string }> };
  task: string;
  /** Our own x402 endpoint, listed in the card next to OpenServ's. */
  directX402: { endpoint: string; description: string };
  image: string;
  website: string;
}

const LISTINGS: Record<"arc" | "cf", Listing> = {
  arc: {
    agentName: "Agent Report Card",
    workflowName: "agent-report-card",
    // The trailing slash matters: the site adds one to every path.
    endpointUrl: "https://agent-report-card.vercel.app/openserv/",
    description:
      "Independent A to F grades for AI agents. Look up how any graded agent did (score, honesty check, strengths and weaknesses, full report), list the best graded agents for a topic, or find out how to get an agent graded. Each grade comes from real test tasks, checked by SERV Reasoning and judged by independent human reviewers on Reppo.",
    trigger: {
      name: "Agent grade lookup",
      description: "Get the independent Agent Report Card grade (A to F) for an AI agent, with its score, summary and report link. Grades come from real test tasks checked by SERV Reasoning and human reviewers on Reppo.",
      price: "0.01",
      input: { agent: { type: "string", description: "The agent's name, OpenServ marketplace number or link" } },
    },
    task: "Look up the Agent Report Card grade for the agent named in the input using the look_up_grade tool, and return what it says, including the report link.",
    directX402: {
      endpoint: "https://agent-report-card.vercel.app/api/grade/",
      description: "Request and pay for a new grade in one call ($10, or $5 for a regrade): POST {\"agent\": \"<marketplace link or https address>\"}.",
    },
    image: "https://robd-hub.github.io/agent-report-card/erc8004/agent-report-card.png",
    website: "https://robd-hub.github.io/agent-report-card/",
  },
  cf: {
    agentName: "Cheap First",
    workflowName: "cheap-first",
    // OpenServ adds a trailing slash, which only /api/openserv handles.
    endpointUrl: "https://cheap-first.vercel.app/api/openserv",
    description:
      "Answers questions and writing requests at a fraction of the usual cost. Dolphin's low-cost model answers first, SERV Reasoning checks the answer, and a premium model steps in only when the check fails. In a 143-question benchmark it cost 80% less than always using the premium model, with the same quality.",
    trigger: {
      name: "Cheap First answer",
      description: "One answer to a question or writing request: a cheap model answers, SERV Reasoning checks it, and a premium model steps in only if the check fails.",
      price: "0.01",
      input: { question: { type: "string", description: "Your question or request, up to 2,000 characters" } },
    },
    task: "Answer the question in the input using the answer_cheaply tool, and return its answer, keeping the line about who answered and what it cost.",
    directX402: {
      endpoint: "https://cheap-first.vercel.app/api/pay",
      description: "One answer for $0.005 in USDC on Base: POST {\"question\": \"...\"}. An OpenAI-compatible endpoint is at /api/v1/chat/completions.",
    },
    image: "https://robd-hub.github.io/agent-report-card/erc8004/cheap-first.png",
    website: "https://robd-hub.github.io/cheap-first/",
  },
};

const STATE = ".openserv.json";
const CHAIN_ID = 8453;

function client(): PlatformClient {
  if (!process.env.OPENSERV_USER_API_KEY) throw new Error("Set OPENSERV_USER_API_KEY (the OpenServ account key).");
  return new PlatformClient({ apiKey: process.env.OPENSERV_USER_API_KEY });
}

function workflowIdFor(l: Listing): number {
  const state = JSON.parse(fs.readFileSync(STATE, "utf8"));
  const id = state.workflows?.[l.agentName]?.[l.workflowName]?.workspaceId;
  if (!id) throw new Error(`Run "provision" first: no workspace for ${l.agentName} in ${STATE}.`);
  return id;
}

async function doProvision(l: Listing) {
  const result = await provision({
    userApiKey: process.env.OPENSERV_USER_API_KEY!,
    walletAddress: PAY_ADDRESS,
    agent: { name: l.agentName, description: l.description, endpointUrl: l.endpointUrl },
    workflow: {
      name: l.workflowName,
      goal: l.trigger.description,
      trigger: triggers.x402({ name: l.trigger.name, description: l.trigger.description, price: l.trigger.price, input: l.trigger.input }),
      task: { description: l.task },
    },
  } as Parameters<typeof provision>[0]);
  const { apiKey, authToken, ...shown } = result as unknown as Record<string, unknown>;
  console.log(JSON.stringify({ ...shown, apiKey: apiKey ? "(saved in .openserv.json)" : null, authToken: authToken ? "(saved in .openserv.json)" : null }, null, 2));
}

async function buildCard(c: PlatformClient, l: Listing, workflowId: number) {
  const [wallet, callable] = await Promise.all([c.workflows.getWallet({ id: workflowId }).catch(() => null), c.triggers.getCallableTriggers({ workflowId })]);
  const services: Record<string, unknown>[] = [];
  for (const t of callable) {
    const meta = { triggerName: t.name, ...(t.description ? { description: t.description } : {}) };
    if (t.httpEndpoint) {
      services.push({
        name: "http",
        endpoint: t.httpEndpoint,
        ...meta,
        method: "POST",
        schema: {
          $schema: "http://json-schema.org/draft-07/schema#",
          type: "object",
          required: ["buyerAddress", "payload"],
          properties: { buyerAddress: { type: "string", description: "The buyer's wallet address (e.g. 0x...) for x402 payment" }, payload: t.inputSchema ?? { type: "object" } },
        },
      });
    }
    services.push({ name: "web", endpoint: t.webEndpoint, ...meta });
  }
  services.push({ name: "http", endpoint: l.directX402.endpoint, description: l.directX402.description, method: "POST" });
  services.push({ name: "MCP", endpoint: `https://api.openserv.ai/workspaces/${workflowId}/x402/mcp`, version: "2025-06-18" });
  services.push({ name: "web", endpoint: l.website, description: "Website" });
  services.push({ name: "agentWallet", endpoint: `eip155:${CHAIN_ID}:${wallet?.address || PAY_ADDRESS}` });
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: l.agentName,
    description: l.description,
    image: l.image,
    services,
    active: true,
    x402support: true,
  };
}

async function main() {
  const [cmd, which, ...rest] = process.argv.slice(2);
  const l = LISTINGS[which as "arc" | "cf"];
  if (!l || !["provision", "card", "saved"].includes(cmd)) {
    console.error("Usage: npm run openserv -- <provision|card|saved> <arc|cf> [txHash agentNumber]");
    process.exit(1);
  }
  if (cmd === "provision") return doProvision(l);

  const c = client();
  const workflowId = workflowIdFor(l);
  const card = await buildCard(c, l, workflowId);
  const cardJson = JSON.stringify(card);
  if (cmd === "card") {
    // The card is served from this site (GitHub Pages) rather than IPFS, so it
    // can be updated with a commit and no new on-chain transaction.
    const file = `public/erc8004/${l.workflowName}.json`;
    fs.writeFileSync(file, JSON.stringify(card, null, 2) + "\n");
    console.log(JSON.stringify({ workflowId, file, agentURI: `https://robd-hub.github.io/agent-report-card/erc8004/${l.workflowName}.json` }, null, 2));
    return;
  }

  const [txHash, agentNumber] = rest;
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash ?? "") || !/^\d+$/.test(agentNumber ?? "")) throw new Error("Give the transaction hash (0x...) and the agent number the signing page showed.");
  const file = `public/erc8004/${l.workflowName}.json`;
  const saved = fs.existsSync(file) ? JSON.stringify(JSON.parse(fs.readFileSync(file, "utf8"))) : cardJson;
  const wallet = await c.workflows.getWallet({ id: workflowId }).catch(() => null);
  await c.erc8004.deploy({
    workflowId,
    erc8004AgentId: `${CHAIN_ID}:${agentNumber}`,
    stringifiedAgentCard: saved,
    latestDeploymentTransactionHash: txHash,
    latestDeploymentTimestamp: new Date(),
    ...(wallet?.address ? { walletAddress: wallet.address } : {}),
    network: "base",
    chainId: CHAIN_ID,
    rpcUrl: "https://mainnet.base.org",
  });
  console.log(`Saved. See it at https://www.8004scan.io/agents/base/${agentNumber}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
