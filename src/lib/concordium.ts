/**
 * Concordium: who is behind an agent, next to how well it works.
 *
 *   1. Agent Report Card is registered in Concordium's Agent Registry
 *      (CIS-8004) on the test network, owned by our verified account, so it
 *      carries the "Verified by Concordium" badge.
 *   2. Every final grade is written on-chain as a small data transaction
 *      (agent, grade, score, a SHA-256 fingerprint of the full report and, when
 *      the agent has one, its own registry badge), so anyone can check it on
 *      CCDExplorer and see we didn't change it later.
 *   3. Grades can be paid in CCD as well as USDC on Base.
 *
 * Everything is behind a switch: CONCORDIUM_ENABLED=1 for the grading bot
 * (a repository variable), NEXT_PUBLIC_CONCORDIUM=1 for the site's payment
 * option. On-chain records already in data/concordium.json always show.
 *
 * This file has no chain code, so pages can import it. Signing and sending
 * live in concordiumChain.ts, used only by the scripts.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { GradingRun } from "./types";

export const CCD_NETWORK = "testnet" as const;
/** Genesis hash prefix, as used in CAIP-2 ids ("ccd:<this>"). */
export const CCD_CHAIN_ID = "ccd:4221332d34e1694168c2a0c0b3fd0f27";
export const WALLET_PROXY = "https://wallet-proxy.testnet.concordium.com";
export const REGISTRY_API = "https://agent-registry-mcp.concordium.com";
/** CIS-8004 Agent Registry contract on testnet. */
export const REGISTRY_CONTRACT = { index: 12802, subindex: 0 };

/** Rob's verified testnet account. It owns our registry entry and receives CCD payments. */
export const CCD_ACCOUNT = "3ZdJsmDtyeXqzsd29MNkF7NcGdDk7ZLPXS8uJfu8WgEGdLXY68";
/** Agent Report Card's own registry entry (token 1255, registered 2026-11-18). */
export const ARC_TOKEN_ID = 1255;
export const ARC_BADGE = "JyP9YFFRjzw8JSc2qS8ai";
export const ARC_CARD_URL = "https://robd-hub.github.io/agent-report-card/concordium/agent-card.json";

/** Prices in test CCD while we're on the test network. */
export const GRADE_PRICE_CCD = 10;
export const REGRADE_PRICE_CCD = 5;

export const ccdEnabledOnSite = () => process.env.NEXT_PUBLIC_CONCORDIUM === "1" || process.env.NEXT_PUBLIC_CONCORDIUM === "true";
export const ccdEnabledForBot = () => process.env.CONCORDIUM_ENABLED === "1" || process.env.CONCORDIUM_ENABLED === "true";

export const explorerTx = (hash: string) => `https://ccdexplorer.io/${CCD_NETWORK}/transaction/${hash}`;
export const explorerAccount = (address: string) => `https://ccdexplorer.io/${CCD_NETWORK}/account/${address}`;
export const badgeCheckUrl = (badge: string) => `${REGISTRY_API}/v1/check-badge/${badge}`;

/** One grade written on-chain. */
export interface CcdAnchor {
  /** The run's date, which identifies the run inside data/results/<agent>.json. */
  runDate: string;
  grade: string | null;
  score: number | null;
  /** SHA-256 of the run exactly as saved (see reportHash). */
  reportHash: string;
  /** The graded agent's own Concordium badge, when it has one. */
  badge?: string;
  tx: string;
  anchoredAt: string;
}

/** The graded agent's registry status, checked when its grade is written on-chain. */
export interface CcdBadgeStatus {
  badge: string;
  tokenId?: number;
  verified: boolean;
  owner?: string;
  checkedAt: string;
}

export interface CcdData {
  anchors: Record<string, CcdAnchor[]>;
  badges: Record<string, CcdBadgeStatus>;
}

const FILE = path.join(process.cwd(), "data", "concordium.json");

export function loadCcd(): CcdData {
  if (!fs.existsSync(FILE)) return { anchors: {}, badges: {} };
  const d = JSON.parse(fs.readFileSync(FILE, "utf8")) as Partial<CcdData>;
  return { anchors: d.anchors ?? {}, badges: d.badges ?? {} };
}

export function saveCcd(data: CcdData): void {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + "\n");
}

/** The on-chain record for a run, if it has one. */
export function anchorFor(agentId: string, run: GradingRun | null, data = loadCcd()): CcdAnchor | null {
  if (!run) return null;
  return data.anchors[agentId]?.find((a) => a.runDate === run.date) ?? null;
}

/**
 * Fingerprint of one grading run: SHA-256 of JSON.stringify(run), the same
 * bytes as the run inside data/results/<agent>.json with no extra spacing.
 * Anyone can recompute it from the public results file.
 */
export function reportHash(run: GradingRun): string {
  return crypto.createHash("sha256").update(JSON.stringify(run)).digest("hex");
}

/** A data transaction holds at most 256 bytes. */
export const MAX_DATA_BYTES = 256;

/**
 * The text written on-chain for a grade, kept short to fit in 256 bytes:
 *   {"p":"agentreportcard","v":1,"a":"coder","g":"A","s":93,"d":"2026-11-05","h":"<sha256>","b":"<badge>"}
 */
export function gradeRecord(agentId: string, run: GradingRun, badge?: string): string {
  const base = { p: "agentreportcard", v: 1, a: agentId, g: run.grade, s: run.score, d: run.date.slice(0, 10), h: reportHash(run) };
  let text = JSON.stringify(badge ? { ...base, b: badge } : base);
  // Agent ids are at most 60 characters, so this only trims in odd cases.
  while (Buffer.byteLength(text) + 3 > MAX_DATA_BYTES && base.a.length > 8) {
    base.a = base.a.slice(0, -1);
    text = JSON.stringify(badge ? { ...base, b: badge } : base);
  }
  return text;
}

/**
 * Wraps text as a CBOR text string, the format Concordium wallets and
 * explorers decode and show as readable text.
 */
export function cborText(text: string): Buffer {
  const body = Buffer.from(text, "utf8");
  const n = body.length;
  const head = n < 24 ? Buffer.from([0x60 + n]) : n < 256 ? Buffer.from([0x78, n]) : Buffer.from([0x79, n >> 8, n & 0xff]);
  return Buffer.concat([head, body]);
}

/** Reads back a CBOR text string written by cborText. */
export function readCborText(bytes: Buffer): string | null {
  if (!bytes.length || bytes[0] >> 5 !== 3) return null;
  const info = bytes[0] & 0x1f;
  if (info < 24) return bytes.subarray(1, 1 + info).toString("utf8");
  if (info === 24) return bytes.subarray(2, 2 + bytes[1]).toString("utf8");
  if (info === 25) return bytes.subarray(3, 3 + ((bytes[1] << 8) | bytes[2])).toString("utf8");
  return null;
}

/**
 * Finds a Concordium transaction in what a requester pasted: a CCDExplorer or
 * CCDScan link, or a bare 64-character hash. Base hashes start with 0x, so a
 * bare hash without 0x is taken to be Concordium's.
 */
export function findCcdTxHash(text: string): string | null {
  const link = text.match(/(?:ccdexplorer\.io|ccdscan\.io)[^\s]*?([0-9a-fA-F]{64})/);
  if (link) return link[1].toLowerCase();
  const bare = text.match(/(?<![0-9a-fA-Fx])([0-9a-fA-F]{64})(?![0-9a-fA-F])/);
  return bare ? bare[1].toLowerCase() : null;
}

/** A Concordium badge (base58 CIS-2 token address) in free text, e.g. from the request form. */
export function findBadge(text: string): string | null {
  const m = text.match(/(?:badge-check|check-badge|cis-2:)\/?([1-9A-HJ-NP-Za-km-z]{12,40})/) ?? text.trim().match(/^([1-9A-HJ-NP-Za-km-z]{12,40})$/);
  return m ? m[1] : null;
}
