/**
 * Virtuals Agent Commerce Protocol (ACP): our own agent's connection, used both
 * to sell grades (scripts/acp-seller.ts) and to grade agents that live on ACP.
 *
 * Grading an ACP agent means hiring it: each test task becomes one paid job on
 * the agent's cheapest offering, and its deliverable is the answer. Spending is
 * capped per task and per grading run, so a grade sold for $10 can't cost more
 * than MAX_SPEND_USD in test jobs.
 *
 * Only used in GitHub Actions, never by the website build.
 */
import { AcpAgent, AssetToken, PrivyAlchemyEvmProviderAdapter } from "@virtuals-protocol/acp-node-v2";
import type { AcpAgentDetail, AcpAgentOffering, JobRoomEntry, JobSession } from "@virtuals-protocol/acp-node-v2";
import { base } from "@account-kit/infra";

/** Most we pay an ACP agent for one test task. */
export const MAX_TASK_USD = Number(process.env.ACP_MAX_TASK_USD || 1);
/** Most we spend hiring agents in one process (one grading run). */
export const MAX_SPEND_USD = Number(process.env.ACP_MAX_SPEND_USD || 3);
/** Test tasks written for an ACP agent, before the standard refuse-unknown task. */
export const ACP_WRITTEN_TASKS = 2;
/** Longest we wait for one hired job, whatever its offering's SLA says. */
const MAX_WAIT_MS = 30 * 60_000;

/** A Virtuals agent wallet address in a bare address or a Virtuals link. */
export function findAcpWallet(text: string): `0x${string}` | null {
  const t = text.trim();
  if (/^https?:/i.test(t) && !/virtuals\.io/i.test(t)) return null;
  const m = t.match(/\b0x[0-9a-fA-F]{40}\b/);
  return m ? (m[0] as `0x${string}`) : null;
}

/** The cheapest public fixed-price offering within our per-task cap, or one named. */
export function pickOffering(detail: Pick<AcpAgentDetail, "offerings">, name = ""): AcpAgentOffering | null {
  const fits = (o: AcpAgentOffering) =>
    !o.isHidden && !o.isPrivate && !o.requiredFunds && o.priceType === "fixed" && Number.isFinite(o.priceValue) && o.priceValue >= 0 && o.priceValue <= MAX_TASK_USD;
  const usable = (detail.offerings ?? []).filter(fits);
  const named = name ? usable.find((o) => o.name.toLowerCase() === name.toLowerCase()) : undefined;
  return named ?? usable.sort((a, b) => a.priceValue - b.priceValue)[0] ?? null;
}

/**
 * The task as the offering's requirement: plain text, or, when the offering
 * has a JSON schema, the task in its first text field (other required text
 * fields get it too, so the job isn't refused).
 */
export function requirementFor(offering: Pick<AcpAgentOffering, "requirements">, prompt: string): Record<string, unknown> | string {
  const req = offering.requirements;
  if (!req || typeof req === "string") return prompt;
  const props = (req as { properties?: Record<string, { type?: string }> }).properties;
  if (!props || typeof props !== "object") return prompt;
  const textKeys = Object.entries(props)
    .filter(([, v]) => !v?.type || v.type === "string")
    .map(([k]) => k);
  if (textKeys.length === 0) return prompt;
  const required = new Set(((req as { required?: string[] }).required ?? []).filter((k) => textKeys.includes(k)));
  const out: Record<string, unknown> = { [textKeys[0]]: prompt };
  for (const k of required) out[k] = prompt;
  return out;
}

let shared: Promise<AcpAgent> | null = null;
const waiters = new Map<string, (session: JobSession, entry: JobRoomEntry) => void>();
let spentUsd = 0;

/** Connects as our own agent (once per process). */
export function connectAcp(): Promise<AcpAgent> {
  if (shared) return shared;
  shared = (async () => {
    const { ACP_WALLET_ADDRESS, ACP_WALLET_ID, ACP_SIGNER_PRIVATE_KEY, ACP_BUILDER_CODE } = process.env;
    if (!ACP_WALLET_ADDRESS || !ACP_WALLET_ID || !ACP_SIGNER_PRIVATE_KEY) {
      throw new Error("ACP_WALLET_ADDRESS, ACP_WALLET_ID and ACP_SIGNER_PRIVATE_KEY must be set");
    }
    const agent = await AcpAgent.create({
      evmProvider: await PrivyAlchemyEvmProviderAdapter.create({
        walletAddress: ACP_WALLET_ADDRESS as `0x${string}`,
        walletId: ACP_WALLET_ID,
        signerPrivateKey: ACP_SIGNER_PRIVATE_KEY,
        chains: [base],
        ...(ACP_BUILDER_CODE ? { builderCode: ACP_BUILDER_CODE } : {}),
      }),
    });
    agent.on("entry", (session, entry) => waiters.get(`${session.chainId}-${session.jobId}`)?.(session, entry));
    await agent.start();
    return agent;
  })();
  return shared;
}

export async function closeAcp(): Promise<void> {
  if (!shared) return;
  const agent = await shared.catch(() => null);
  shared = null;
  await agent?.stop();
}

export async function fetchAcpAgent(wallet: string): Promise<AcpAgentDetail | null> {
  const agent = await connectAcp();
  return agent.getAgentByWalletAddress(wallet);
}

/** Hires an ACP agent for one task and returns its deliverable. */
export async function hireForAnswer(wallet: string, offeringName: string, prompt: string): Promise<string> {
  const agent = await connectAcp();
  const detail = await agent.getAgentByWalletAddress(wallet);
  if (!detail) throw new Error(`No Virtuals agent at ${wallet}`);
  const offering = pickOffering(detail, offeringName);
  if (!offering) throw new Error(`${detail.name} has no offering at ${MAX_TASK_USD} USDC or less`);
  if (spentUsd + offering.priceValue > MAX_SPEND_USD) throw new Error(`Spending cap of ${MAX_SPEND_USD} USDC reached`);
  const me = await agent.getAddress();
  const waitMs = Math.min(MAX_WAIT_MS, Math.max(5, offering.slaMinutes || 0) * 60_000 + 5 * 60_000);

  // Register the waiter before the job exists, keyed once the id is known;
  // entries that arrive early are replayed from the session afterwards.
  let resolveDone!: (v: string) => void;
  let rejectDone!: (e: Error) => void;
  const done = new Promise<string>((res, rej) => {
    resolveDone = res;
    rejectDone = rej;
  });
  let funded = false;
  const handle = async (session: JobSession, entry: JobRoomEntry) => {
    if (entry.kind !== "system") return;
    const ev = entry.event;
    try {
      if (ev.type === "budget.set" && !funded) {
        if (ev.fundRequest) throw new Error(`${detail.name} asked for extra funds, which we don't send`);
        if (ev.amount > offering.priceValue + 1e-9 || spentUsd + ev.amount > MAX_SPEND_USD) {
          throw new Error(`${detail.name} set a budget of ${ev.amount} USDC, above the ${offering.priceValue} USDC offering price or our cap`);
        }
        funded = true;
        spentUsd += ev.amount;
        await session.fund(AssetToken.usdc(ev.amount, session.chainId));
      } else if (ev.type === "job.submitted") {
        await session.complete("Received, thank you.").catch(() => {});
        resolveDone(ev.deliverable);
      } else if (ev.type === "job.completed") {
        // Skip-evaluation style completion still carries no deliverable here;
        // the submitted event above is what we wait for.
      } else if (ev.type === "job.rejected" || ev.type === "job.expired") {
        throw new Error(`Job ${ev.type === "job.rejected" ? `rejected: ${ev.reason}` : "expired"}`);
      }
    } catch (e) {
      rejectDone(e as Error);
    }
  };

  const jobId = await agent.createJobFromOffering(base.id, offering, wallet, requirementFor(offering, prompt), { evaluatorAddress: me });
  const key = `${base.id}-${jobId}`;
  waiters.set(key, (s, e) => void handle(s, e));
  const session = agent.getSession(base.id, String(jobId));
  for (const e of session?.entries ?? []) if (session) await handle(session, e);

  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      done,
      new Promise<string>((_, rej) => {
        timer = setTimeout(() => rej(new Error(`${detail.name} didn't deliver within ${Math.round(waitMs / 60_000)} minutes`)), waitMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    waiters.delete(key);
  }
}
