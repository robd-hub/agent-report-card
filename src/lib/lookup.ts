/**
 * Pre-hire lookup: a free, read-only answer to "should I hire this agent?"
 * Built only from the grades already published in data/, so calling it does
 * not run a model, open a Reppo review, or move any money.
 *
 * Served as:
 *   - GET /api/lookup?agent=... and GET /api/agents on Vercel (grader.designimp.com)
 *   - static files at /lookup/<id>.json and /lookup/index.json (GitHub Pages too)
 *   - MCP tools lookup_agent_grade, search_graded_agents, how_to_get_graded
 *
 * Concordium: an agent can also be looked up by its Concordium Agent Registry
 * badge, and every answer carries the on-chain record of the grade, so a
 * caller learns who is behind the agent and that the grade wasn't changed later.
 */
import {
  anchorFor,
  ARC_BADGE,
  ARC_TOKEN_ID,
  badgeCheckUrl,
  CCD_ACCOUNT,
  CCD_CHAIN_ID,
  CCD_FREE_GRADES,
  CCD_NETWORK,
  explorerTx,
  findBadge,
  GRADE_PRICE_CCD,
  lastAnchorFor,
  REGRADE_PRICE_CCD,
  reportHash,
  type CcdData,
} from "./concordium";
import { categoryOf, categoryById, CATEGORIES, type CategoryId } from "./categories";
import { disagreement, GRADE_MEANING, honestyCheck, taskScore } from "./grade";
import { GRADE_PRICE_USD, GRADE_REQUEST_URL, PAGES_URL, REGRADE_PRICE_USD, SITE_URL } from "./links";
import { kindOf, kindScores, TASK_KINDS } from "./taskKinds";
import { FRESH_DAYS } from "./trust";
import type { AgentConfig, Grade, GradingRun, TaskResult } from "./types";

/** The Vercel deployment. GitHub Pages is static and does not serve POST /api/grade. */
export const LIVE_API = SITE_URL;

/** The static GitHub Pages copy. Old links to it keep working. */
export const PAGES_SITE = PAGES_URL;

export function siteBase(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || SITE_URL).replace(/\/$/, "");
}

/**
 * How a caller should treat the grade. The same words are in
 * RECOMMENDATION_RULE, which every response includes.
 *
 *   hire    — A or B, honesty did not fail, grade is final, judges disagree
 *             on fewer than half the scored tasks, and the grade is under
 *             60 days old.
 *   caution — C, or an A/B that misses one of the hire checks.
 *   avoid   — D or F.
 *   null    — not graded. That is not a pass.
 */
export type Recommendation = "hire" | "caution" | "avoid";

export const RECOMMENDATION_RULE =
  "hire if the latest grade is A or B, the honesty check did not fail and is not still pending, the grade is final (not provisional), the judges disagree on fewer than half of the scored tasks, and the grade is under 60 days old. " +
  "caution if the grade is C, or it would have been hire except one of those checks failed. " +
  "avoid if the grade is D or F. " +
  "No grade means no recommendation: do not treat an ungraded agent as a pass.";

export type Honesty = "passed" | "failed" | "pending" | null;

export interface TaskSummary {
  id: string;
  kind: string;
  label: string;
  /** Combined task score, 70% Reppo and 30% SERV, rounded. Null if not scored. */
  score: number | null;
  judgesDisagree: boolean;
}

export interface TaskTypeSummary {
  kind: string;
  label: string;
  score: number | null;
  count: number;
}

export interface AgentIdentity {
  id: string;
  name: string;
  description: string;
  category: string;
  marketplaceId: number | null;
  /** OpenServ marketplace page, when we know the number. */
  marketplaceUrl: string | null;
  /** The agent's own https address. A shared model API is not included. */
  endpoint: string | null;
}

/** Who is behind the agent (Concordium registry) and the grade's on-chain record. */
export interface ConcordiumInfo {
  network: typeof CCD_NETWORK;
  chainId: string;
  /** The agent's Concordium Agent Registry badge (CIS-2 token address), when it has one. */
  badge: string | null;
  registryAgentId: number | null;
  /** True when the registry entry was active and its agent card matched the on-chain hash when we last checked. */
  badgeVerified: boolean | null;
  badgeCheckedAt: string | null;
  /** Concordium's own badge check, to confirm it live. */
  badgeCheckUrl: string | null;
  /** The data transaction that holds this grade on-chain. Null if this grade isn't written on-chain yet. */
  gradeOnChain: {
    tx: string;
    explorerUrl: string;
    /** SHA-256 of the grading run as published in data/results/<agent>.json. */
    reportHash: string;
    /** True when the published run still hashes to the value written on-chain. */
    fingerprintMatches: boolean;
    recordedAt: string;
  } | null;
  /** The grader's own registry entry. */
  gradedBy: { registryAgentId: number; badge: string; badgeCheckUrl: string };
}

export interface GetGraded {
  /** Looking up a grade never charges. */
  freeToRead: true;
  paid: {
    method: "POST";
    url: string;
    priceUsd: number;
    regradeUsd: number;
    currency: "USDC";
    network: "Base";
    body: { agent: string };
    /** A person can open the same request here. */
    issueUrl: string;
    note: string;
  };
  /** Paying in CCD instead, through the grade request. */
  concordium: {
    priceCcd: number;
    regradeCcd: number;
    network: string;
    payTo: string;
    howTo: string;
    /** Agents with a valid Concordium registry badge. */
    freeForBadges: string;
  };
  /** How to ask for the first grade at no charge. */
  freeFirstGrade: { offer: string; url: string };
}

export interface LookupResponse {
  version: 1;
  free: true;
  source: "Agent Report Card";
  status: "graded" | "not_graded" | "ambiguous";
  recommendation: Recommendation | null;
  recommendationRule: string;
  why: string;
  graded: boolean;
  grade: Grade | null;
  score: number | null;
  /** When this grade was published (ISO). */
  gradedAt: string | null;
  taskCount: number;
  scoredTasks: number;
  provisional: boolean;
  /** True when gradedAt is 60 days or more before the response was built. */
  stale: boolean;
  freshUntil: string | null;
  /** True when at least one task is flagged "judges disagree". */
  judgesDisagree: boolean;
  judgesDisagreed: number;
  honesty: Honesty;
  category: string | null;
  byTaskType: TaskTypeSummary[];
  tasks: TaskSummary[];
  selfGraded: boolean;
  agent: AgentIdentity | null;
  /** Set when the query matched more than one agent. */
  matches?: { id: string; name: string; grade: Grade | null; reportUrl: string | null }[];
  reportUrl: string | null;
  /** Badge published with the site. Updated whenever the site is published. */
  badgeUrl: string | null;
  /** Same badge, generated on the Vercel deployment from the latest published grade. */
  liveBadgeUrl: string | null;
  /** Concordium registry badge and the grade's on-chain record. Null when the agent has neither. */
  concordium: ConcordiumInfo | null;
  query?: string;
  message?: string;
  getGraded: GetGraded;
}

export interface LookupIndex {
  version: 1;
  updated: string;
  source: "Agent Report Card";
  recommendationRule: string;
  howToGetGraded: GetGraded;
  /** Keys from queryKeys() to agent ids. More than one id means the key is ambiguous. */
  aliases: Record<string, string[]>;
  agents: LookupResponse[];
}

export function howToGetGraded(): GetGraded {
  return {
    freeToRead: true,
    paid: {
      method: "POST",
      url: `${LIVE_API}/api/grade`,
      priceUsd: GRADE_PRICE_USD,
      regradeUsd: REGRADE_PRICE_USD,
      currency: "USDC",
      network: "Base",
      body: { agent: "<OpenServ marketplace link, or the agent's own https address>" },
      issueUrl: GRADE_REQUEST_URL,
      note:
        "Reading a grade is free. Ordering one is paid. POST this with no payment and the endpoint replies 402 with the x402 price. Pay that in USDC on Base and retry. A regrade of an agent that already has a grade is the lower price. A person can open the same request at issueUrl. GitHub Pages does not serve this paid endpoint.",
    },
    concordium: {
      priceCcd: GRADE_PRICE_CCD,
      regradeCcd: REGRADE_PRICE_CCD,
      network: `Concordium ${CCD_NETWORK} (${CCD_CHAIN_ID})`,
      payTo: CCD_ACCOUNT,
      howTo: "Send the CCD to payTo, then open the grade request at issueUrl and paste the transaction hash or its CCDExplorer link in the payment field. The bot checks the transfer on-chain and grades the agent.",
      freeForBadges: `The first ${CCD_FREE_GRADES} agents with a valid Concordium Agent Registry badge are graded free: write "free" in the payment field and add the badge. One per badge.`,
    },
    freeFirstGrade: {
      offer:
        'The first grade can be free when a maintainer approves it. Open the grade request and write "free" in the payment field. Someone with write access to the repo then adds the free-grade label, and the bot grades the agent at no charge. The first five agents with a valid Concordium registry badge that ask this way are graded free without that label (one per badge).',
      url: GRADE_REQUEST_URL,
    },
  };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Host plus path, no trailing slash, no query. Null if it is not an http(s) URL. */
export function endpointKey(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return (u.host + u.pathname).replace(/\/+$/, "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Alias keys to try, in order. A URL is only a marketplace link or an
 * endpoint, never a name, so a long link can't accidentally match an agent.
 * Kept in step with mcp/server.mjs (the stdio server reads the published aliases).
 */
export function queryKeys(query: string): string[] {
  const q = query.trim();
  if (!q) return [];
  if (/^https?:\/\//i.test(q)) {
    const keys: string[] = [];
    // A Concordium badge-check link names the badge.
    const badge = findBadge(q);
    if (badge) keys.push(`badge:${badge}`);
    const market = q.match(/agents?\/(\d+)/i)?.[1];
    if (market) keys.push(`market:${market}`);
    const ep = endpointKey(q);
    if (ep) keys.push(`endpoint:${ep}`);
    return keys;
  }
  if (/^\d+$/.test(q)) return [`market:${q}`];
  const badge = findBadge(q);
  return [...(badge ? [`badge:${badge}`] : []), `id:${q.toLowerCase()}`, `name:${norm(q)}`];
}

export function cleanQuery(q: string): string {
  return q.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 500);
}

function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}

function kindLabel(kind: string): string {
  return TASK_KINDS.find((k) => k.kind === kind)?.label ?? kind;
}

function empty(getGraded: GetGraded): LookupResponse {
  return {
    version: 1,
    free: true,
    source: "Agent Report Card",
    status: "not_graded",
    recommendation: null,
    recommendationRule: RECOMMENDATION_RULE,
    why: "",
    graded: false,
    grade: null,
    score: null,
    gradedAt: null,
    taskCount: 0,
    scoredTasks: 0,
    provisional: false,
    stale: false,
    freshUntil: null,
    judgesDisagree: false,
    judgesDisagreed: 0,
    honesty: null,
    category: null,
    byTaskType: [],
    tasks: [],
    selfGraded: false,
    agent: null,
    reportUrl: null,
    badgeUrl: null,
    liveBadgeUrl: null,
    concordium: null,
    getGraded,
  };
}

interface Facts {
  grade: Grade | null;
  honesty: Honesty;
  provisional: boolean;
  judgesDisagreed: number;
  scoredTasks: number;
  gradedAt: string | null;
}

/** The hire / caution / avoid decision. `now` is when the answer is built. */
export function recommend(facts: Facts, now = Date.now()): { recommendation: Recommendation | null; why: string } {
  const { grade } = facts;
  if (!grade) {
    return { recommendation: null, why: "Not graded yet, so there is no recommendation. An ungraded agent is not a pass." };
  }
  if (grade === "D" || grade === "F") {
    const pending = facts.provisional ? " The grade is still provisional." : "";
    return { recommendation: "avoid", why: `Grade ${grade}: avoid. ${GRADE_MEANING[grade]}${pending}` };
  }
  const problems: string[] = [];
  if (grade === "C") problems.push("the grade is C");
  if (facts.honesty === "failed") problems.push("the honesty check failed");
  if (facts.honesty === "pending") problems.push("the honesty check is not scored yet");
  if (facts.provisional) problems.push("the grade is still provisional");
  if (facts.scoredTasks > 0 && facts.judgesDisagreed * 2 >= facts.scoredTasks) {
    problems.push(`the judges disagree on ${facts.judgesDisagreed} of ${facts.scoredTasks} scored tasks`);
  }
  const stale = facts.gradedAt !== null && new Date(facts.gradedAt).getTime() + FRESH_DAYS * 86_400_000 <= now;
  if (stale) problems.push(`the grade is more than ${FRESH_DAYS} days old`);
  if (problems.length) {
    return { recommendation: "caution", why: `Grade ${grade}, but ${problems.join(", ")}: caution.` };
  }
  const honesty = facts.honesty === "passed" ? "the honesty check passed" : "this grade had no honesty check";
  return {
    recommendation: "hire",
    why: `Grade ${grade}, ${honesty}, the grade is final, the judges disagree on ${facts.judgesDisagreed} of ${facts.scoredTasks} scored tasks, and the grade is under ${FRESH_DAYS} days old: hire.`,
  };
}

function taskLine(t: TaskResult, agent: AgentConfig): TaskSummary {
  const kind = t.kind ?? kindOf(agent.tasks.find((x) => x.id === t.taskId) ?? (t.kind ? { id: t.taskId, kind: t.kind } : undefined), t.taskId);
  const score = taskScore(t);
  return { id: t.taskId, kind, label: kindLabel(kind), score: score === null ? null : Math.round(score), judgesDisagree: disagreement(t) !== null };
}

/** The Concordium block for an agent's latest run. */
export function concordiumInfo(agent: AgentConfig, run: GradingRun | null, ccd?: CcdData): ConcordiumInfo | null {
  const anchor = ccd ? (anchorFor(agent.id, run, ccd) ?? lastAnchorFor(agent.id, run, ccd)) : null;
  const badge = agent.concordiumBadge ?? null;
  if (!badge && !anchor) return null;
  const status = ccd?.badges[agent.id];
  const known = status && status.badge === badge ? status : undefined;
  return {
    network: CCD_NETWORK,
    chainId: CCD_CHAIN_ID,
    badge,
    registryAgentId: known?.tokenId ?? null,
    badgeVerified: known ? known.verified : null,
    badgeCheckedAt: known?.checkedAt ?? null,
    badgeCheckUrl: badge ? badgeCheckUrl(badge) : null,
    gradeOnChain:
      anchor && run
        ? { tx: anchor.tx, explorerUrl: explorerTx(anchor.tx), reportHash: anchor.reportHash, fingerprintMatches: reportHash(run) === anchor.reportHash, recordedAt: anchor.anchoredAt }
        : null,
    gradedBy: { registryAgentId: ARC_TOKEN_ID, badge: ARC_BADGE, badgeCheckUrl: badgeCheckUrl(ARC_BADGE) },
  };
}

export function lookupRecord(agent: AgentConfig, runs: GradingRun[], site: string, now = Date.now(), ccd?: CcdData): LookupResponse {
  const root = site.replace(/\/$/, "");
  const run = runs.at(-1) ?? null;
  const category = categoryOf(agent);
  const identity: AgentIdentity = {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    category,
    marketplaceId: agent.marketplaceId ?? null,
    marketplaceUrl: agent.marketplaceId ? `https://www.openserv.ai/agents/${agent.marketplaceId}` : null,
    endpoint: agent.adapter === "http-json" || agent.adapter === "mcp" ? agent.endpoint ?? null : null,
  };
  const base = empty(howToGetGraded());
  const links = {
    agent: identity,
    category,
    selfGraded: Boolean(agent.selfGraded),
    reportUrl: `${root}/agents/${agent.id}/`,
    badgeUrl: `${root}/badge/${agent.id}.svg`,
    liveBadgeUrl: `${LIVE_API}/api/badge?agent=${agent.id}`,
    concordium: concordiumInfo(agent, run, ccd),
  };
  if (!run || run.grade === null) {
    const message = `${agent.name} has not been graded yet.`;
    return {
      ...base,
      ...links,
      status: "not_graded",
      message,
      why: `${message} We can't recommend an agent we haven't graded.`,
    };
  }
  const tasks = run.tasks.map((t) => taskLine(t, agent));
  const scoredTasks = tasks.filter((t) => t.score !== null).length;
  const judgesDisagreed = tasks.filter((t) => t.judgesDisagree).length;
  const honesty = honestyCheck(run.tasks);
  const gradedAt = run.date;
  const decision = recommend({ grade: run.grade, honesty, provisional: run.provisional, judgesDisagreed, scoredTasks, gradedAt }, now);
  const freshUntil = addDays(gradedAt, FRESH_DAYS);
  return {
    ...base,
    ...links,
    status: "graded",
    recommendation: decision.recommendation,
    why: decision.why,
    graded: true,
    grade: run.grade,
    score: run.score,
    gradedAt,
    taskCount: run.tasks.length,
    scoredTasks,
    provisional: run.provisional,
    stale: new Date(freshUntil).getTime() <= now,
    freshUntil,
    judgesDisagree: judgesDisagreed > 0,
    judgesDisagreed,
    honesty,
    byTaskType: kindScores(run.tasks, agent).map((k) => ({ kind: k.kind, label: k.label, score: k.score, count: k.count })),
    tasks,
  };
}

export function buildAliases(records: LookupResponse[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  const add = (key: string, id: string) => {
    const list = map[key] ?? [];
    if (!list.includes(id)) list.push(id);
    map[key] = list;
  };
  for (const r of records) {
    if (!r.agent) continue;
    add(`id:${r.agent.id}`, r.agent.id);
    add(`name:${norm(r.agent.name)}`, r.agent.id);
    if (r.concordium?.badge) add(`badge:${r.concordium.badge}`, r.agent.id);
    if (r.agent.marketplaceId !== null) add(`market:${r.agent.marketplaceId}`, r.agent.id);
    if (r.agent.endpoint) {
      const ep = endpointKey(r.agent.endpoint);
      if (ep) add(`endpoint:${ep}`, r.agent.id);
    }
  }
  return map;
}

export function lookupIndex(agents: AgentConfig[], runsOf: (id: string) => GradingRun[], site: string, now = Date.now(), ccd?: CcdData): LookupIndex {
  const records = agents.map((a) => lookupRecord(a, runsOf(a.id), site, now, ccd));
  return {
    version: 1,
    updated: new Date(now).toISOString(),
    source: "Agent Report Card",
    recommendationRule: RECOMMENDATION_RULE,
    howToGetGraded: howToGetGraded(),
    aliases: buildAliases(records),
    agents: records,
  };
}

export type Resolved =
  | { kind: "one"; record: LookupResponse }
  | { kind: "none" }
  | { kind: "ambiguous"; records: LookupResponse[] };

export function resolveQuery(query: string, records: LookupResponse[], aliases: Record<string, string[]>): Resolved {
  for (const key of queryKeys(query)) {
    const ids = aliases[key];
    if (!ids?.length) continue;
    const found = ids.map((id) => records.find((r) => r.agent?.id === id)).filter((r): r is LookupResponse => Boolean(r));
    if (found.length > 1) return { kind: "ambiguous", records: found };
    if (found.length === 1) return { kind: "one", record: found[0] };
  }
  return { kind: "none" };
}

export function answerLookup(query: string, index: Pick<LookupIndex, "agents" | "aliases" | "howToGetGraded">): LookupResponse {
  const q = cleanQuery(query);
  if (!q) {
    const message = "Pass agent as an id, a name, an OpenServ marketplace link, the agent's own https address, or its Concordium Agent Registry badge.";
    return { ...empty(index.howToGetGraded), status: "not_graded", query: q, message, why: message };
  }
  const hit = resolveQuery(q, index.agents, index.aliases);
  if (hit.kind === "one") return hit.record;
  if (hit.kind === "ambiguous") {
    const message = `More than one agent matches "${q}". Look one up by its id.`;
    return {
      ...empty(index.howToGetGraded),
      status: "ambiguous",
      query: q,
      message,
      why: message,
      matches: hit.records.map((r) => ({ id: r.agent!.id, name: r.agent!.name, grade: r.grade, reportUrl: r.reportUrl })),
    };
  }
  const message = `No Agent Report Card grade for "${q}" yet.`;
  return {
    ...empty(index.howToGetGraded),
    status: "not_graded",
    query: q,
    message,
    why: `${message} We can't recommend an agent we haven't graded.`,
  };
}

export interface SearchQuery {
  q: string;
  grades: Grade[];
  category: CategoryId | null;
  recommendation: Recommendation | null;
  limit: number;
  offset: number;
  sort: "score" | "name" | "recent";
  includeUngraded: boolean;
}

export interface SearchHit {
  id: string;
  name: string;
  category: string | null;
  grade: Grade | null;
  score: number | null;
  gradedAt: string | null;
  taskCount: number;
  judgesDisagree: boolean;
  recommendation: Recommendation | null;
  why: string;
  selfGraded: boolean;
  reportUrl: string | null;
  badgeUrl: string | null;
  liveBadgeUrl: string | null;
}

export interface SearchResponse {
  version: 1;
  free: true;
  source: "Agent Report Card";
  recommendationRule: string;
  count: number;
  limit: number;
  offset: number;
  sort: SearchQuery["sort"];
  filters: { q: string; grade: Grade[]; category: string | null; recommendation: Recommendation | null; includeUngraded: boolean };
  agents: SearchHit[];
  message?: string;
  getGraded: GetGraded;
}

const GRADES: Grade[] = ["A", "B", "C", "D", "F"];
const REC: Recommendation[] = ["hire", "caution", "avoid"];

function asText(v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string") return v;
  return "";
}

/** Reads search filters from a query string or an MCP tool call. */
export function parseSearch(input: Record<string, unknown>): { ok: true; query: SearchQuery } | { ok: false; error: string } {
  const q = cleanQuery(asText(input.q ?? input.query ?? "")).slice(0, 200);
  const gradeText = asText(input.grade);
  const grades = gradeText
    ? gradeText.split(/[,\s]+/).map((g) => g.toUpperCase()).filter(Boolean)
    : [];
  for (const g of grades) {
    if (!GRADES.includes(g as Grade)) return { ok: false, error: `Unknown grade "${g}". Use one of: ${GRADES.join(", ")}.` };
  }
  const categoryText = asText(input.category).toLowerCase();
  if (categoryText && !categoryById(categoryText)) {
    return { ok: false, error: `Unknown category "${categoryText}". Use one of: ${CATEGORIES.map((c) => c.id).join(", ")}.` };
  }
  const recText = asText(input.recommendation).toLowerCase();
  if (recText && !REC.includes(recText as Recommendation)) {
    return { ok: false, error: `Unknown recommendation "${recText}". Use one of: ${REC.join(", ")}.` };
  }
  const sortText = asText(input.sort).toLowerCase() || "score";
  if (sortText !== "score" && sortText !== "name" && sortText !== "recent") {
    return { ok: false, error: 'Unknown sort. Use "score", "name", or "recent".' };
  }
  const limitRaw = Number(asText(input.limit) || 10);
  const offsetRaw = Number(asText(input.offset) || 0);
  const limit = Math.min(50, Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 10));
  const offset = Math.min(500, Math.max(0, Number.isFinite(offsetRaw) ? Math.floor(offsetRaw) : 0));
  const graded = asText(input.graded).toLowerCase();
  return {
    ok: true,
    query: {
      q,
      grades: grades as Grade[],
      category: categoryText ? (categoryText as CategoryId) : null,
      recommendation: recText ? (recText as Recommendation) : null,
      limit,
      offset,
      sort: sortText,
      includeUngraded: graded === "all",
    },
  };
}

function matchesQ(r: LookupResponse, q: string): boolean {
  const words = norm(q).split(" ").filter(Boolean);
  if (!words.length) return true;
  const hay = norm(`${r.agent?.name ?? ""} ${r.agent?.description ?? ""} ${r.agent?.id ?? ""} ${r.category ?? ""}`);
  return words.every((w) => hay.includes(w));
}

export function searchAgents(records: LookupResponse[], query: SearchQuery): SearchResponse {
  const filtered = records.filter((r) => {
    if (!query.includeUngraded && r.status !== "graded") return false;
    if (query.grades.length && (!r.grade || !query.grades.includes(r.grade))) return false;
    if (query.category && r.category !== query.category) return false;
    if (query.recommendation && r.recommendation !== query.recommendation) return false;
    return matchesQ(r, query.q);
  });
  const sorted = [...filtered].sort((a, b) => {
    if (query.sort === "name") return (a.agent?.name ?? "").localeCompare(b.agent?.name ?? "");
    if (query.sort === "recent") return (b.gradedAt ?? "").localeCompare(a.gradedAt ?? "") || (a.agent?.name ?? "").localeCompare(b.agent?.name ?? "");
    return (b.score ?? -1) - (a.score ?? -1) || (a.agent?.name ?? "").localeCompare(b.agent?.name ?? "");
  });
  const agents: SearchHit[] = sorted.slice(query.offset, query.offset + query.limit).map((r) => ({
    id: r.agent!.id,
    name: r.agent!.name,
    category: r.category,
    grade: r.grade,
    score: r.score,
    gradedAt: r.gradedAt,
    taskCount: r.taskCount,
    judgesDisagree: r.judgesDisagree,
    recommendation: r.recommendation,
    why: r.why,
    selfGraded: r.selfGraded,
    reportUrl: r.reportUrl,
    badgeUrl: r.badgeUrl,
    liveBadgeUrl: r.liveBadgeUrl,
  }));
  return {
    version: 1,
    free: true,
    source: "Agent Report Card",
    recommendationRule: RECOMMENDATION_RULE,
    count: filtered.length,
    limit: query.limit,
    offset: query.offset,
    sort: query.sort,
    filters: {
      q: query.q,
      grade: query.grades,
      category: query.category,
      recommendation: query.recommendation,
      includeUngraded: query.includeUngraded,
    },
    agents,
    ...(agents.length ? {} : { message: "No agents match. Reading grades is free; ordering a grade is paid." }),
    getGraded: howToGetGraded(),
  };
}
