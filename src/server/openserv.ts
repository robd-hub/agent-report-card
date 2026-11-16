/**
 * Agent Report Card as an agent on the OpenServ marketplace.
 *
 * The agent's endpoint is https://<this site>/openserv. Only served on
 * Vercel: scripts/prepare-server.ts writes the route file
 * (src/app/openserv/[[...path]]/route.ts) there before the build. See
 * src/lib/openservAgent.ts for how OpenServ calls it and OPENSERV.md for setup.
 *
 * Its tools only read the published grades, so answering costs us nothing.
 */
import { after } from "next/server";
import { loadAgents, latestRun, loadReport } from "@/lib/data";
import { honestyCheck } from "@/lib/grade";
import { GRADE_PRICE_USD, GRADE_REQUEST_URL, REGRADE_PRICE_USD } from "@/lib/links";
import { handleOpenServ, type AgentSpec } from "@/lib/openservAgent";
import type { AgentConfig, GradingRun } from "@/lib/types";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://robd-hub.github.io/agent-report-card").replace(/\/$/, "");
/** The pay-by-API endpoint only runs on Vercel, so it's linked there rather than on the static site. */
const API = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://agent-report-card.vercel.app";

interface Graded {
  agent: AgentConfig;
  run: GradingRun | null;
}

function graded(): Graded[] {
  return loadAgents().map((agent) => ({ agent, run: latestRun(loadReport(agent.id)) }));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Finds agents by marketplace number, link, id or name. Best matches first. */
export function findAgents(query: string, all = graded()): Graded[] {
  const q = query.trim();
  const id = q.match(/agents\/(\d+)/)?.[1] ?? (/^\d+$/.test(q) ? q : null);
  if (id) return all.filter((g) => String(g.agent.marketplaceId) === id);
  const nq = norm(q);
  if (!nq) return [];
  const exact = all.filter((g) => norm(g.agent.name) === nq || g.agent.id === q);
  if (exact.length) return exact;
  const words = nq.split(" ");
  return all
    .map((g) => ({ g, hits: words.filter((w) => norm(g.agent.name).includes(w)).length }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 5)
    .map((x) => x.g);
}

function card(g: Graded): string {
  const link = `${SITE}/agents/${g.agent.id}/`;
  if (!g.run || g.run.grade === null) return `${g.agent.name}: not graded yet. ${link}`;
  const honesty = honestyCheck(g.run.tasks);
  return [
    `${g.agent.name}: grade ${g.run.grade} (${g.run.score}/100)${g.run.provisional ? ", provisional while human reviews finish" : ""}, graded ${g.run.date.slice(0, 10)}.`,
    honesty ? `Honesty check (says so when it can't know): ${honesty}.` : "",
    g.run.summary,
    `Full report: ${link}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export const AGENT: AgentSpec = {
  systemPrompt:
    "You are Agent Report Card, an independent grader of AI agents. Each grade comes from real test tasks, checked by SERV Reasoning and judged by independent human reviewers on Reppo. Use your tools to answer: look up an agent's grade, list the best graded agents, or explain how to get an agent graded. Only state grades the tools return, and include the report link.",
  capabilities: [
    {
      name: "look_up_grade",
      description: "Looks up the Agent Report Card grade (A to F) for an AI agent, by name, OpenServ marketplace number or marketplace link. Returns the grade, score, a short summary and a link to the full report.",
      schema: {
        type: "object",
        properties: { agent: { type: "string", description: "The agent's name, OpenServ marketplace number, or marketplace link" } },
        required: ["agent"],
      },
      async run(args) {
        const query = String(args.agent ?? "");
        const found = findAgents(query);
        if (!found.length) {
          return `No grade for "${query}" yet. See every graded agent at ${SITE}/, or get it graded ($${GRADE_PRICE_USD}): ${GRADE_REQUEST_URL}`;
        }
        return found.map(card).join("\n\n");
      },
    },
    {
      name: "list_top_agents",
      description: "Lists the best graded AI agents on Agent Report Card, highest score first, optionally only those whose name or description mentions a topic (for example research, writing, code).",
      schema: {
        type: "object",
        properties: {
          topic: { type: "string", description: "Optional topic to filter by" },
          limit: { type: "number", description: "How many to list, 1 to 20. Default 10." },
        },
      },
      async run(args) {
        const topic = norm(String(args.topic ?? ""));
        const limit = Math.min(20, Math.max(1, Number(args.limit) || 10));
        const rows = graded()
          .filter((g) => g.run && g.run.score !== null)
          .filter((g) => !topic || norm(`${g.agent.name} ${g.agent.description}`).includes(topic))
          .sort((a, b) => (b.run!.score ?? 0) - (a.run!.score ?? 0))
          .slice(0, limit);
        if (!rows.length) return `No graded agents match "${args.topic}". See them all at ${SITE}/`;
        return rows.map((g, i) => `${i + 1}. ${g.agent.name}: ${g.run!.grade} (${g.run!.score}/100). ${SITE}/agents/${g.agent.id}/`).join("\n") + `\n\nAll grades: ${SITE}/`;
      },
    },
    {
      name: "how_to_get_graded",
      description: "Explains how to get an AI agent graded by Agent Report Card: what it tests, the price and how to request and pay.",
      schema: { type: "object", properties: {} },
      async run() {
        return [
          `Agent Report Card gives an agent 5 real test tasks (including an honesty check), has SERV Reasoning check each answer and independent human reviewers on Reppo judge them, then publishes an A to F grade, a report and a badge.`,
          `Price: $${GRADE_PRICE_USD} in USDC on Base for a first grade, $${REGRADE_PRICE_USD} for a regrade.`,
          `Request one here: ${GRADE_REQUEST_URL}`,
          `Agents and scripts can also request and pay in one call with x402: POST {"agent": "<marketplace link or https address>"} to ${API}/api/grade/`,
        ].join("\n");
      },
    },
  ],
};

async function handle(request: Request, ctx: { params: Promise<{ path?: string[] }> }): Promise<Response> {
  const { path = [] } = await ctx.params;
  return handleOpenServ(request, path.join("/"), AGENT, (p) => after(() => p));
}

export const GET = handle;
export const POST = handle;
