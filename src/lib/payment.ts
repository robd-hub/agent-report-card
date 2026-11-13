/**
 * Checks that a grade request was paid: a USDC transfer on Base, to our
 * address, of at least the price, recent, and not already used for another
 * request. Reads the public Base chain over JSON-RPC, so no key is needed.
 */
import fs from "node:fs";
import path from "node:path";
import { PAY_ADDRESS } from "./links";

/** Circle's native USDC on Base. */
export const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
/** keccak256("Transfer(address,address,uint256)") */
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
/** A payment must be no older than this when the request is checked. */
export const MAX_PAYMENT_AGE_DAYS = 14;

const PAYMENTS_FILE = path.join(process.cwd(), "data", "payments.json");

export interface PaymentRecord {
  tx: string;
  issue: number;
  agentId: string;
  amountUsd: number;
  from: string;
  date: string;
}

export function loadPayments(): PaymentRecord[] {
  if (!fs.existsSync(PAYMENTS_FILE)) return [];
  return JSON.parse(fs.readFileSync(PAYMENTS_FILE, "utf8")) as PaymentRecord[];
}

export function savePayment(record: PaymentRecord): void {
  const all = loadPayments();
  all.push(record);
  fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(all, null, 2) + "\n");
}

/** Pulls a transaction hash out of whatever the requester pasted (a hash or a Basescan link). */
export function findTxHash(text: string): string | null {
  const m = text.match(/0x[0-9a-fA-F]{64}/);
  return m ? m[0].toLowerCase() : null;
}

export type PaymentCheck =
  | { ok: true; amountUsd: number; from: string; paidAt: Date }
  | { ok: false; reason: string };

interface Log {
  address: string;
  topics: string[];
  data: string;
}
interface Receipt {
  status: string;
  blockNumber: string;
  logs: Log[];
}

type Rpc = (method: string, params: unknown[]) => Promise<unknown>;

export function baseRpc(url = process.env.BASE_RPC_URL || "https://mainnet.base.org"): Rpc {
  return async (method, params) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!res.ok) throw new Error(`Base RPC returned ${res.status}`);
    const body = (await res.json()) as { result?: unknown; error?: { message: string } };
    if (body.error) throw new Error(`Base RPC error: ${body.error.message}`);
    return body.result;
  };
}

const topicAddress = (topic: string) => "0x" + topic.slice(-40).toLowerCase();

/** Verifies the payment. `minUsd` is the price for this request. */
export async function checkPayment(tx: string, minUsd: number, rpc: Rpc = baseRpc(), now = new Date()): Promise<PaymentCheck> {
  const used = loadPayments().find((p) => p.tx === tx);
  if (used) return { ok: false, reason: `This payment was already used for request #${used.issue}.` };

  const receipt = (await rpc("eth_getTransactionReceipt", [tx])) as Receipt | null;
  if (!receipt) return { ok: false, reason: "That transaction wasn't found on Base. Check it's a Base transaction (not Ethereum) and that it has confirmed." };
  if (receipt.status !== "0x1") return { ok: false, reason: "That transaction failed on Base, so no USDC was sent." };

  const to = PAY_ADDRESS.toLowerCase();
  const transfers = receipt.logs.filter(
    (l) => l.address.toLowerCase() === USDC_BASE && l.topics[0]?.toLowerCase() === TRANSFER_TOPIC && l.topics[2] && topicAddress(l.topics[2]) === to,
  );
  if (transfers.length === 0) return { ok: false, reason: `That transaction doesn't send USDC on Base to ${PAY_ADDRESS}.` };

  // USDC has 6 decimals.
  const micro = transfers.reduce((sum, l) => sum + BigInt(l.data), 0n);
  const amountUsd = Number(micro) / 1e6;
  if (amountUsd + 1e-9 < minUsd) return { ok: false, reason: `That transaction sent ${amountUsd} USDC, but this request costs ${minUsd} USDC.` };

  const block = (await rpc("eth_getBlockByNumber", [receipt.blockNumber, false])) as { timestamp: string } | null;
  if (!block) return { ok: false, reason: "Couldn't read the block for that transaction. Please try again later." };
  const paidAt = new Date(Number(BigInt(block.timestamp)) * 1000);
  const ageDays = (now.getTime() - paidAt.getTime()) / 86_400_000;
  if (ageDays > MAX_PAYMENT_AGE_DAYS) return { ok: false, reason: `That payment is more than ${MAX_PAYMENT_AGE_DAYS} days old. Please send a new one.` };

  return { ok: true, amountUsd, from: topicAddress(transfers[0].topics[1]), paidAt };
}
