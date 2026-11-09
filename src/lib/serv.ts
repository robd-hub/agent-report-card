/** Minimal client for the SERV Reasoning API (OpenAI-compatible chat completions). */
const SERV_URL = "https://inference-api.openserv.ai/v1/chat/completions";

export function servConfigured(): boolean {
  return Boolean(process.env.SERV_API_KEY);
}

export async function servChat(system: string, user: string, model = process.env.SERV_MODEL || "gpt-5.4-mini"): Promise<string> {
  const key = process.env.SERV_API_KEY;
  if (!key) throw new Error("SERV_API_KEY is not set");
  const request = () =>
    fetch(SERV_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        max_completion_tokens: 8000,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
  // SERV sometimes returns a brief upstream 5xx; retry a few times before giving up.
  let res = await request();
  for (let attempt = 1; attempt <= 3 && res.status >= 500; attempt++) {
    await new Promise((r) => setTimeout(r, attempt * 5000));
    res = await request();
  }
  if (!res.ok) throw new Error(`SERV Reasoning returned ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { choices: { message: { content: string } }[] };
  return body.choices[0]?.message.content ?? "";
}

/** Ask SERV Reasoning to score an answer against the task's criteria. */
export async function servCheck(prompt: string, criteria: string, output: string): Promise<{ score: number; summary: string }> {
  const system =
    "You are a strict, fair evaluator of AI agent answers. " +
    'Reply with JSON only: {"score": <integer 0-100>, "summary": "<one or two sentences>"}.';
  const user = `Task given to the agent:\n${prompt}\n\nWhat a good answer looks like:\n${criteria}\n\nThe agent's answer:\n${output.slice(0, 40_000)}`;
  const text = await servChat(system, user);
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`SERV check did not return JSON: ${text}`);
  const parsed = JSON.parse(match[0]) as { score: number; summary: string };
  return { score: Math.max(0, Math.min(100, Math.round(parsed.score))), summary: parsed.summary };
}
