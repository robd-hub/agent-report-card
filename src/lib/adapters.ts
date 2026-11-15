import { runMarketplaceAgent } from "./openserv";
import type { AgentConfig } from "./types";

/** Send a task to the agent under test and return its answer. */
export async function runAgent(agent: AgentConfig, prompt: string): Promise<string> {
  switch (agent.adapter) {
    case "openai-compatible":
      return runOpenAICompatible(agent, prompt);
    case "openserv-marketplace":
      return runMarketplaceAgent(agent, prompt);
  }
}

async function runOpenAICompatible(agent: AgentConfig, prompt: string): Promise<string> {
  if (!agent.endpoint || !agent.model) throw new Error(`Agent ${agent.id} needs an endpoint and model`);
  // Only send our SERV key to SERV itself, never to an agent's own server.
  const key = isServEndpoint(agent.endpoint) ? process.env.SERV_API_KEY : undefined;
  const res = await fetch(agent.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({
      model: agent.model,
      messages: [
        { role: "system", content: agent.description },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Agent ${agent.id} returned ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { choices: { message: { content: string } }[] };
  return body.choices[0]?.message.content ?? "";
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
