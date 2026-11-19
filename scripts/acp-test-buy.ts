/**
 * Places one real test order for our own "gradeAgent" offering on Virtuals ACP,
 * from a separate buyer agent (an agent can't hire itself). Run by hand from
 * .github/workflows/acp-test-buy.yml.
 *
 * It creates the job, waits for our seller bot to set the budget (the watcher
 * starts the seller within a few minutes), checks the budget is the expected
 * price, pays it into escrow, then exits. The seller bot grades the agent on a later run and
 * submits the report, which completes the job.
 *
 *   ACP_BUYER_WALLET_ADDRESS=... ACP_BUYER_WALLET_ID=... ACP_BUYER_SIGNER_PRIVATE_KEY=... \
 *   ACP_WALLET_ADDRESS=<seller> TEST_AGENT=<link> npx tsx scripts/acp-test-buy.ts
 */
import { AcpAgent, AssetToken, PrivyAlchemyEvmProviderAdapter } from "@virtuals-protocol/acp-node-v2";
import type { JobRoomEntry, JobSession } from "@virtuals-protocol/acp-node-v2";
import { base } from "@account-kit/infra";
import { GRADE_PRICE_USD } from "../src/lib/links";

const WAIT_MS = Number(process.env.WAIT_MINUTES || 40) * 60_000;

async function main() {
  const { ACP_BUYER_WALLET_ADDRESS, ACP_BUYER_WALLET_ID, ACP_BUYER_SIGNER_PRIVATE_KEY, ACP_WALLET_ADDRESS } = process.env;
  if (!ACP_BUYER_WALLET_ADDRESS || !ACP_BUYER_WALLET_ID || !ACP_BUYER_SIGNER_PRIVATE_KEY || !ACP_WALLET_ADDRESS) {
    throw new Error("Set ACP_BUYER_WALLET_ADDRESS, ACP_BUYER_WALLET_ID, ACP_BUYER_SIGNER_PRIVATE_KEY and ACP_WALLET_ADDRESS");
  }
  const link = (process.env.TEST_AGENT || "https://platform.openserv.ai/agents/39").trim();
  const price = Number(process.env.ACP_PRICE_USD || GRADE_PRICE_USD);

  const buyer = await AcpAgent.create({
    evmProvider: await PrivyAlchemyEvmProviderAdapter.create({
      walletAddress: ACP_BUYER_WALLET_ADDRESS as `0x${string}`,
      walletId: ACP_BUYER_WALLET_ID,
      signerPrivateKey: ACP_BUYER_SIGNER_PRIVATE_KEY,
      chains: [base],
    }),
  });

  let jobKey = "";
  let resolveDone!: (msg: string) => void;
  let rejectDone!: (e: Error) => void;
  const done = new Promise<string>((res, rej) => {
    resolveDone = res;
    rejectDone = rej;
  });
  buyer.on("entry", async (session: JobSession, entry: JobRoomEntry) => {
    if (`${session.chainId}-${session.jobId}` !== jobKey) return;
    if (entry.kind === "message" && entry.contentType === "text") console.log(`Seller says: ${entry.content}`);
    if (entry.kind !== "system") return;
    const ev = entry.event;
    try {
      if (ev.type === "budget.set") {
        if (ev.amount > price + 1e-9) throw new Error(`Budget ${ev.amount} USDC is above the ${price} USDC price; not paying`);
        await session.fund(AssetToken.usdc(ev.amount, session.chainId));
        resolveDone(`Budget of ${ev.amount} USDC paid into escrow. The seller bot grades it on its next run.`);
      } else if (ev.type === "job.rejected" || ev.type === "job.expired") {
        throw new Error(`Job ${ev.type}`);
      }
    } catch (e) {
      rejectDone(e as Error);
    }
  });
  await buyer.start();

  const jobId = await buyer.createJobByOfferingName(base.id, "gradeAgent", ACP_WALLET_ADDRESS, { agent: link });
  jobKey = `${base.id}-${jobId}`;
  console.log(`Created test job ${jobKey} asking for a grade of ${link}. Waiting for the seller to set a budget...`);

  let timer: NodeJS.Timeout | undefined;
  try {
    const msg = await Promise.race([
      done,
      new Promise<string>((_, rej) => {
        timer = setTimeout(() => rej(new Error(`No budget within ${WAIT_MS / 60_000} minutes; is the seller workflow running?`)), WAIT_MS);
      }),
    ]);
    console.log(msg);
  } finally {
    clearTimeout(timer);
    await buyer.stop();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
