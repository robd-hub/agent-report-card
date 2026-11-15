import { prepareMarketplaceAgent, runMarketplaceAgent } from "./openserv";
import type { AgentConfig } from "./types";

/** Send a task to the agent under test and return its answer. */
export async function runAgent(agent: AgentConfig, prompt: string): Promise<string> {
  switch (agent.adapter) {
    case "openai-compatible":
      return runOpenAICompatible(agent, prompt);
    case "openserv-marketplace":
      return runMarketplaceAgent(agent, prompt);
    case "http-json":
      return runHttpJson(agent, prompt);
  }
}

/** One-time setup before an agent's tasks run side by side. */
export async function prepareAgent(agent: AgentConfig): Promise<void> {
  if (agent.adapter === "openserv-marketplace") await prepareMarketplaceAgent(agent);
}

/** How long an agent's own server may take to answer one task. */
const ENDPOINT_TIMEOUT_MS = 5 * 60_000;

/**
 * True for a public https address. Grading runs on GitHub's servers, but
 * still refuse local and private network addresses so a request can't point
 * the grader at anything internal.
 */
export function isPublicHttpsUrl(text: string): boolean {
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".") && !h.includes(":")) return false;
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return false;
  }
  if (h.includes(":")) return false; // IPv6 literals: not worth the risk
  return true;
}

/** Pulls the answer out of a reply: a JSON string field, or the plain text body. */
export function answerFrom(text: string): string {
  try {
    const body = JSON.parse(text) as unknown;
    if (typeof body === "string") return body;
    if (body && typeof body === "object") {
      const b = body as Record<string, unknown>;
      for (const k of ["answer", "output", "response", "text", "content", "result", "message", "reply"]) {
        const v = b[k];
        if (typeof v === "string") return v;
        if (v && typeof v === "object" && typeof (v as { content?: unknown }).content === "string") return (v as { content: string }).content;
      }
      const choice = (b.choices as { message?: { content?: unknown } }[] | undefined)?.[0]?.message?.content;
      if (typeof choice === "string") return choice;
    }
    return "";
  } catch {
    return text;
  }
}

/** An agent on its own server: POST {"prompt": "..."} and read the answer from the reply. */
async function runHttpJson(agent: AgentConfig, prompt: string): Promise<string> {
  if (!agent.endpoint || !isPublicHttpsUrl(agent.endpoint)) throw new Error(`Agent ${agent.id} needs a public https endpoint`);
  const res = await fetch(agent.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/plain" },
    body: JSON.stringify({ prompt, question: prompt, input: prompt }),
    signal: AbortSignal.timeout(ENDPOINT_TIMEOUT_MS),
    redirect: "error",
  });
  if (!res.ok) throw new Error(`Agent ${agent.id} returned ${res.status}`);
  const answer = answerFrom((await res.text()).slice(0, 200_000));
  if (!answer.trim()) throw new Error(`Agent ${agent.id} returned no answer we could read`);
  return answer;
}

async function runOpenAICompatible(agent: AgentConfig, prompt: string): Promise<string> {
  if (!agent.endpoint || !agent.model) throw new Error(`Agent ${agent.id} needs an endpoint and model`);
  // Only send our SERV key to SERV itself, never to an agent's own server.
  const key = isServEndpoint(agent.endpoint) ? process.env.SERV_API_KEY : undefined;
  if (!key && !isPublicHttpsUrl(agent.endpoint)) throw new Error(`Agent ${agent.id} needs a public https endpoint`);
  const res = await fetch(agent.endpoint, {
    signal: AbortSignal.timeout(ENDPOINT_TIMEOUT_MS),
    redirect: key ? "follow" : "error",
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({
      model: agent.model,
      // The baseline runs on SERV with its description as instructions; an
      // outside agent already has its own, so it only gets the task.
      messages: [...(key ? [{ role: "system", content: agent.description }] : []), { role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Agent ${agent.id} returned ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const answer = body.choices?.[0]?.message?.content ?? "";
  if (!answer.trim()) throw new Error(`Agent ${agent.id} returned no answer`);
  return answer;
}

/** True only for SERV's own API, the one place our SERV key may go. */
export function isServEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && u.hostname === "inference-api.openserv.ai";
  } catch {
    return false;
  }
}
