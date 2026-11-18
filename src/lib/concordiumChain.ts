/**
 * Signs and sends Concordium test-network transactions, and reads them back,
 * through the public wallet proxy (the node's gRPC port is blocked in some of
 * the places this runs). Used only by the scripts, never by the site.
 *
 * The signing key comes from CONCORDIUM_TESTNET_KEY: the account export JSON
 * from the Concordium Browser Wallet. It is never printed or written to disk.
 */
import * as sdk from "@concordium/web-sdk";
import { CCD_ACCOUNT, REGISTRY_API, REGISTRY_CONTRACT, WALLET_PROXY, type CcdBadgeStatus } from "./concordium";

interface Signer {
  address: string;
  sign: (tx: sdk.AccountTransaction) => Promise<sdk.AccountTransactionSignature>;
}

let signer: Signer | null = null;

/** Our account and its signer. Throws if the key isn't set. */
export function ccdSigner(): Signer {
  if (signer) return signer;
  const raw = process.env.CONCORDIUM_TESTNET_KEY;
  if (!raw) throw new Error("CONCORDIUM_TESTNET_KEY isn't set");
  const wallet = sdk.parseWallet(raw);
  const accountSigner = sdk.buildAccountSigner(wallet);
  signer = { address: wallet.value.address, sign: (tx) => sdk.signTransaction(tx, accountSigner) };
  return signer;
}

async function proxy<T>(pathname: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${WALLET_PROXY}${pathname}`, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`Wallet proxy ${pathname.split("/").slice(0, 3).join("/")} returned ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

/** Signs and submits one transaction. Returns its hash. */
async function send(type: sdk.AccountTransactionType, payload: sdk.AccountTransactionInput): Promise<string> {
  const me = ccdSigner();
  const { nonce } = await proxy<{ nonce: number }>(`/v0/accNonce/${me.address}`);
  const tx: sdk.AccountTransaction = {
    type,
    header: {
      sender: sdk.AccountAddress.fromBase58(me.address),
      nonce: sdk.SequenceNumber.create(nonce),
      expiry: sdk.TransactionExpiry.futureMinutes(30),
    },
    payload,
  };
  const signature = await me.sign(tx);
  const hash = sdk.getAccountTransactionHash(tx, signature);
  // The proxy takes the transaction as a bare block item, in raw bytes.
  const raw = sdk.serializeAccountTransaction(tx, signature);
  await proxy(`/v0/submitRawTransaction`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: new Uint8Array(raw) });
  return hash;
}

/** Calls a contract entrypoint, e.g. "CIS-8004.setAgentURI", with a hex parameter. */
export function updateContract(receiveName: string, parameterHex: string, energy = 30_000n): Promise<string> {
  return send(sdk.AccountTransactionType.Update, {
    amount: sdk.CcdAmount.zero(),
    address: sdk.ContractAddress.create(REGISTRY_CONTRACT.index, REGISTRY_CONTRACT.subindex),
    receiveName: sdk.ReceiveName.fromString(receiveName),
    message: sdk.Parameter.fromHexString(parameterHex),
    maxContractExecutionEnergy: sdk.Energy.create(energy),
  } as sdk.UpdateContractInput);
}

/** Writes up to 256 bytes on-chain as a data transaction. */
export function registerData(bytes: Buffer): Promise<string> {
  return send(sdk.AccountTransactionType.RegisterData, { data: new sdk.DataBlob(new Uint8Array(bytes).buffer) });
}

/** Sends CCD, e.g. a refund. `ccd` is in whole CCD. */
export function transferCcd(to: string, ccd: number): Promise<string> {
  return send(sdk.AccountTransactionType.Transfer, {
    amount: sdk.CcdAmount.fromMicroCcd(BigInt(Math.round(ccd * 1e6))),
    toAddress: sdk.AccountAddress.fromBase58(to),
  } as sdk.SimpleTransferPayload);
}

export interface CcdTxStatus {
  status: "received" | "committed" | "finalized" | "absent";
  outcome?: "success" | "reject" | "ambiguous";
  sender?: string;
  to?: string;
  /** In micro-CCD, for transfers. */
  amount?: string;
  blockHashes?: string[];
  transactionHash?: string;
  rejectReason?: unknown;
}

export const txStatus = (hash: string) => proxy<CcdTxStatus>(`/v0/submissionStatus/${hash}`);

/** Waits until a transaction is finalized (usually a few seconds). */
export async function waitFinal(hash: string, timeoutMs = 120_000): Promise<CcdTxStatus> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const s = await txStatus(hash);
    if (s.status === "finalized") {
      if (s.outcome !== "success") throw new Error(`Transaction ${hash} was rejected on-chain`);
      return s;
    }
    if (Date.now() > until) throw new Error(`Transaction ${hash} wasn't finalized within ${timeoutMs / 1000}s (status ${s.status})`);
    await new Promise((r) => setTimeout(r, 4000));
  }
}

/** When a block was made. */
export async function blockTime(blockHash: string): Promise<Date> {
  const info = await proxy<{ blockSlotTime?: string; blockReceiveTime?: string }>(`/v0/blockInfo/${blockHash}`);
  const t = info.blockSlotTime ?? info.blockReceiveTime;
  if (!t) throw new Error("Couldn't read the block time");
  return new Date(t);
}

/** Calls one tool on Concordium's public Agent Registry service (MCP over HTTP, no key). */
export async function registryTool<T = Record<string, unknown>>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${REGISTRY_API}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Agent Registry service returned ${res.status}`);
  const body = JSON.parse(text.slice(text.indexOf("{"))) as { result?: { content?: { text?: string }[]; isError?: boolean }; error?: { message: string } };
  if (body.error) throw new Error(`Agent Registry service: ${body.error.message}`);
  const out = body.result?.content?.[0]?.text ?? "null";
  if (body.result?.isError) throw new Error(`Agent Registry service: ${out.slice(0, 200)}`);
  return JSON.parse(out) as T;
}

/**
 * Looks up an agent's Concordium badge: is it in the registry, active, and
 * does the card it serves match the fingerprint pinned on-chain?
 */
export async function checkBadge(badge: string): Promise<CcdBadgeStatus> {
  const now = new Date().toISOString();
  const agent = await registryTool<{ token_id?: string | number; owner_account?: string; status?: string } | null>("agent_by_token_address", { token_address: badge, network: "testnet" });
  if (!agent) return { badge, verified: false, checkedAt: now };
  let verified = agent.status === "Active";
  if (verified) {
    try {
      const card = await registryTool<{ match?: boolean | null }>("verify_agent_card", { token_id: String(agent.token_id), network: "testnet" });
      verified = card.match === true;
    } catch {
      verified = false;
    }
  }
  return { badge, tokenId: Number(agent.token_id), verified, owner: agent.owner_account, checkedAt: now };
}

export type CcdPaymentCheck =
  | { ok: true; amountCcd: number; from: string; paidAt: Date }
  | { ok: false; reason: string };

/** Confirms a finalized CCD transfer to our account of at least `minCcd`. */
export async function checkCcdPayment(hash: string, minCcd: number, maxAgeDays: number, now = new Date()): Promise<CcdPaymentCheck> {
  let s: CcdTxStatus;
  try {
    s = await txStatus(hash);
  } catch {
    return { ok: false, reason: "That transaction wasn't found on the Concordium test network." };
  }
  if (s.status === "absent") return { ok: false, reason: "That transaction wasn't found on the Concordium test network. Check you copied the whole hash." };
  if (s.status !== "finalized") return { ok: false, reason: "That Concordium transaction hasn't finalized yet. Wait a minute, then edit this request." };
  if (s.outcome !== "success") return { ok: false, reason: "That Concordium transaction failed, so no CCD was sent." };
  if (s.to !== CCD_ACCOUNT) return { ok: false, reason: `That transaction doesn't send CCD to ${CCD_ACCOUNT}.` };
  const amountCcd = Number(BigInt(s.amount ?? "0")) / 1e6;
  if (amountCcd + 1e-9 < minCcd) return { ok: false, reason: `That transaction sent ${amountCcd} CCD, but this request costs ${minCcd} CCD.` };
  const paidAt = await blockTime(s.blockHashes![0]);
  if ((now.getTime() - paidAt.getTime()) / 86_400_000 > maxAgeDays) return { ok: false, reason: `That payment is more than ${maxAgeDays} days old. Please send a new one.` };
  return { ok: true, amountCcd, from: s.sender ?? "", paidAt };
}
