import type { AgentConfig } from "./types";

/** The groups the leaderboard can be filtered by, in the order they're shown. */
export const CATEGORIES = [
  { id: "research", name: "Research", plural: "research agents" },
  { id: "writing", name: "Writing", plural: "writing agents" },
  { id: "crypto", name: "Crypto and markets", plural: "crypto and markets agents" },
  { id: "code-data", name: "Code and data", plural: "code and data agents" },
  { id: "assistants", name: "Assistants", plural: "assistants" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

/** Words in an agent's name or description that point to a category, checked in this order. */
const KEYWORDS: [CategoryId, RegExp][] = [
  ["crypto", /\b(crypto|token|tokenomics|solidity|smart.contract|polymarket|kalshi|hyperliquid|btc|bitcoin|defi|trading|otc|lunarcrush|betting)\b/i],
  ["code-data", /\b(code|coder|coding|json|csv|api|data analyst|sql|developer)\b/i],
  ["research", /\b(research|search|scrap\w*|tweets|youtube|news|sources)\b/i],
  ["writing", /\b(writ\w*|copy\w*|essay|whitepaper|blog|article)\b/i],
];

/**
 * An agent's category: the one set in data/agents.json, or else a best guess
 * from its name and description, so newly graded agents land somewhere sensible.
 */
export function categoryOf(agent: Pick<AgentConfig, "name" | "description" | "category">): CategoryId {
  if (agent.category && CATEGORIES.some((c) => c.id === agent.category)) return agent.category as CategoryId;
  const text = `${agent.name} ${agent.description}`;
  return KEYWORDS.find(([, re]) => re.test(text))?.[0] ?? "assistants";
}

export function categoryById(id: string) {
  return CATEGORIES.find((c) => c.id === id) ?? null;
}
