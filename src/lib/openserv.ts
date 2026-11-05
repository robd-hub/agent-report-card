/**
 * Calls agents listed on the OpenServ marketplace.
 *
 * Marketplace agents can't be called directly. Instead we make one small
 * OpenServ workflow per agent: a webhook trigger that waits for the result,
 * feeding a single task assigned to that agent. Each test prompt is sent to
 * the webhook, and the agent's answer comes back in the response.
 *
 * The workflow is created the first time an agent is graded and its id is
 * saved in data/openserv-workflows.json, so later runs reuse it.
 *
 * Needs OPENSERV_USER_API_KEY (the OpenServ platform key). Falls back to
 * SERV_API_KEY in case one key covers both.
 */
import fs from "node:fs";
import path from "node:path";
import type { AgentConfig } from "./types";

const WORKFLOWS_FILE = path.join(process.cwd(), "data", "openserv-workflows.json");
/** How long OpenServ waits for the agent before giving up, in seconds. */
const TIMEOUT_SECONDS = 600;

type WorkflowMap = Record<string, { workflowId: number; createdAt: string }>;

function loadWorkflows(): WorkflowMap {
  if (!fs.existsSync(WORKFLOWS_FILE)) return {};
  return JSON.parse(fs.readFileSync(WORKFLOWS_FILE, "utf8")) as WorkflowMap;
}

function saveWorkflows(map: WorkflowMap): void {
  fs.writeFileSync(WORKFLOWS_FILE, JSON.stringify(map, null, 2) + "\n");
}

export function openservKey(): string | undefined {
  return process.env.OPENSERV_USER_API_KEY || process.env.SERV_API_KEY;
}

async function platformClient() {
  const key = openservKey();
  if (!key) throw new Error("OPENSERV_USER_API_KEY is not set");
  // Loaded lazily so the website build never pulls in the OpenServ client.
  const { PlatformClient } = await import("@openserv-labs/client");
  const client = new PlatformClient({ apiKey: key });
  // The client uses axios, which doesn't handle an HTTPS proxy well. When a
  // proxy is set (as in cloud sessions), tunnel through it explicitly.
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (proxy) {
    const { HttpsProxyAgent } = await import("https-proxy-agent");
    client.rawClient.defaults.proxy = false;
    client.rawClient.defaults.httpsAgent = new HttpsProxyAgent(proxy);
  }
  return client;
}

type Client = Awaited<ReturnType<typeof platformClient>>;

async function ensureWorkflow(client: Client, agent: AgentConfig): Promise<number> {
  const map = loadWorkflows();
  const existing = map[agent.id];
  if (existing) {
    await activateTriggers(client, existing.workflowId);
    return existing.workflowId;
  }

  const { triggers } = await import("@openserv-labs/client");
  const agentId = agent.marketplaceId!;
  const workflow = await client.workflows.create({
    name: `Agent Report Card: ${agent.name}`,
    goal: `Send each incoming test question to ${agent.name}, the agent assigned to this workflow, and return its full answer unchanged so the answer can be graded for the public Agent Report Card leaderboard.`,
    agentIds: [agentId],
    triggers: [
      triggers.webhook({
        name: "Test request",
        waitForCompletion: true,
        timeout: TIMEOUT_SECONDS,
        input: { prompt: { type: "string", description: "The test request to answer" } },
      }),
    ],
    tasks: [
      {
        name: "answer",
        agentId,
        description: "Answer the test request in the `prompt` field of the input. Reply with the full answer only.",
      },
    ],
  });
  await workflow.setRunning();
  await activateTriggers(client, workflow.id);
  map[agent.id] = { workflowId: workflow.id, createdAt: new Date().toISOString() };
  saveWorkflows(map);
  console.log(`  Created OpenServ workflow ${workflow.id} for ${agent.name}`);
  return workflow.id;
}

/**
 * New webhook triggers start switched off, and a switched-off webhook answers
 * straight away with an empty result instead of running the task. Switch on
 * any that are off (checked once per workflow per run of the script).
 */
const activated = new Set<number>();
async function activateTriggers(client: Client, workflowId: number): Promise<void> {
  if (activated.has(workflowId)) return;
  const list = (await client.triggers.list({ workflowId })) as Array<{ id: string; isActive?: boolean }>;
  for (const t of list) {
    if (!t.isActive) {
      await client.triggers.activate({ workflowId, id: t.id });
      console.log(`  Switched on webhook trigger for workflow ${workflowId}`);
    }
  }
  activated.add(workflowId);
}

/**
 * Pull the agent's answer out of a webhook response. The response looks like
 * { status, results: [{ workspaceExecution: { status, output: { type, value } } }] }.
 * It also carries private trigger details (including the webhook token), so
 * it is never stored or printed whole: only the answer text is kept.
 */
export function extractAnswer(response: unknown): string {
  const results = (response as { results?: unknown[] } | null)?.results;
  if (!Array.isArray(results)) return "";
  const answers: string[] = [];
  for (const r of results) {
    const exec = (r as { workspaceExecution?: { status?: string; output?: unknown } })?.workspaceExecution;
    const text = outputText(exec?.output);
    if (text.trim()) answers.push(text.trim());
  }
  return answers.join("\n\n");
}

function outputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (output && typeof output === "object") {
    const value = (output as { value?: unknown }).value;
    if (typeof value === "string") return value;
    if (value !== undefined && value !== null) return JSON.stringify(value);
  }
  return "";
}

/** True when the webhook came back without any real text from the agent. */
export function isEmptyAnswer(answer: string): boolean {
  return !answer.trim();
}

export async function runMarketplaceAgent(agent: AgentConfig, prompt: string): Promise<string> {
  if (!agent.marketplaceId) throw new Error(`Agent ${agent.id} needs a marketplaceId`);
  const client = await platformClient();
  try {
    const workflowId = await ensureWorkflow(client, agent);
    const response = await client.triggers.fireWebhook({ workflowId, input: { prompt } });
    const answer = extractAnswer(response);
    if (isEmptyAnswer(answer)) {
      const status = (response as { status?: string } | null)?.status ?? "unknown";
      throw new Error(`agent returned no answer (webhook status: ${status})`);
    }
    return answer;
  } catch (e) {
    const err = e as { response?: { status?: number; data?: unknown }; message: string };
    const detail = err.response ? `${err.response.status}: ${JSON.stringify(err.response.data)}` : err.message;
    const hint = err.response?.status === 403 && process.env.HTTPS_PROXY ? " (is api.openserv.ai on the allowed hosts list?)" : "";
    throw new Error(`OpenServ call failed for ${agent.id}: ${detail}${hint}`);
  }
}
