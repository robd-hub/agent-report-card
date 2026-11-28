/**
 * Sells grades on Virtuals' Agent Commerce Protocol (ACP), with no one involved.
 *
 * Run on a schedule by .github/workflows/acp-seller.yml. Each run connects as
 * the Agent Report Card agent, catches up on its open jobs, and stops:
 *
 *   1. A new job whose request names an agent we can reach (OpenServ, a public
 *      endpoint, or a Virtuals agent with an offering we can afford to hire
 *      for test tasks) gets a budget of
 *      ACP_PRICE_USD (the offering's price). A request we can't use gets a
 *      message saying why, and no budget, so the buyer never pays.
 *   2. A funded job (the buyer's USDC is now held in escrow) is graded with
 *      scripts/auto-grade.ts, exactly like a paid GitHub request. One per run,
 *      since a grade can take several minutes.
 *   3. A graded job gets its report link submitted, which releases the escrow.
 *      If grading needed the maintainer, nothing is submitted, so the buyer is
 *      refunded when the job expires unless the maintainer finishes it first.
 *
 *   npx tsx scripts/acp-seller.ts          # all three steps
 *   npx tsx scripts/acp-seller.ts submit   # step 3 only (after the site is republished)
 *   npx tsx scripts/acp-seller.ts check    # just count jobs needing steps 1-3 (used by acp-watch.yml)
 *
 * Progress per job is kept in data/acp-jobs.json, so a job is never graded
 * twice. The buyer's request text is untrusted: it's only parsed for a link,
 * a name, a short description and a suggested task, then handed to
 * auto-grade.ts as request text, as a GitHub issue would be.
 *
 * Needs ACP_WALLET_ADDRESS, ACP_WALLET_ID and ACP_SIGNER_PRIVATE_KEY (from the
 * agent's Signers tab on app.virtuals.io), and optionally ACP_BUILDER_CODE.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { AssetToken } from "@virtuals-protocol/acp-node-v2";
import type { AcpAgent, JobSession } from "@virtuals-protocol/acp-node-v2";
import { closeAcp, connectAcp, findAcpWallet, MAX_TASK_USD, pickOffering } from "../src/lib/acp";
import { loadReport } from "../src/lib/data";
import { GRADE_PRICE_USD, SITE_URL } from "../src/lib/links";
import { loadPayments } from "../src/lib/payment";
import { findEndpoint, findMarketplaceId } from "../src/lib/requests";

const SITE = SITE_URL;
const JOBS_FILE = path.join(process.cwd(), "data", "acp-jobs.json");
const PRICE_USD = Number(process.env.ACP_PRICE_USD || GRADE_PRICE_USD);

type JobState = "budget-set" | "declined" | "graded" | "needs-attention" | "submitted";

export interface AcpJobRecord {
  ref: string;
  chainId: number;
  jobId: string;
  state: JobState;
  agentId?: string;
  updated: string;
}

export interface GradeRequest {
  link: string;
  name: string;
  about: string;
  task: string;
  model: string;
}

function loadJobs(): AcpJobRecord[] {
  if (!fs.existsSync(JOBS_FILE)) return [];
  return JSON.parse(fs.readFileSync(JOBS_FILE, "utf8")) as AcpJobRecord[];
}

function saveJob(record: Omit<AcpJobRecord, "updated">): void {
  const all = loadJobs().filter((j) => j.ref !== record.ref);
  all.push({ ...record, updated: new Date().toISOString() });
  fs.writeFileSync(JOBS_FILE, JSON.stringify(all, null, 2) + "\n");
}

export function jobRef(chainId: number, jobId: string): string {
  return `acp-${chainId}-${jobId}`;
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * Reads the buyer's requirement message. It's JSON when the offering has a
 * schema ({"agent": "...", "name": "...", "about": "...", "task": "..."}),
 * but plain text with just a link is accepted too.
 */
export function parseRequirement(content: string): GradeRequest {
  let body: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
    else if (typeof parsed === "string") body = { agent: parsed };
  } catch {
    body = { agent: content };
  }
  const first = (...keys: string[]) => keys.map((k) => body[k]).find((v) => typeof v === "string" && v.trim());
  return {
    link: clean(first("agent", "link", "url", "endpoint", "agentLink"), 500),
    name: clean(first("name", "agentName"), 80),
    about: clean(first("about", "description", "whatItDoes"), 4000),
    task: clean(first("task", "suggestedTask", "test"), 1000),
    model: clean(first("model", "modelName"), 100),
  };
}

/** True when the grader can reach the agent the request names. */
export function canGrade(req: GradeRequest): boolean {
  return Boolean(findMarketplaceId(req.link) || findEndpoint(req.link, req.model) || findAcpWallet(req.link));
}

/**
 * Why we can't take the request, or "" if we can. A Virtuals agent also needs
 * an offering cheap enough to hire it for the test tasks.
 */
async function whyNot(agent: AcpAgent, req: GradeRequest | null): Promise<string> {
  if (!req || !canGrade(req)) {
    return (
      "Sorry, the grader can't reach that agent. Send a Virtuals agent's wallet address, a link to an OpenServ marketplace agent, or a public https address that answers " +
      'a POST of {"prompt": "..."} (or an OpenAI-style /chat/completions address plus its model name).'
    );
  }
  const wallet = findMarketplaceId(req.link) || findEndpoint(req.link, req.model) ? null : findAcpWallet(req.link);
  if (!wallet) return "";
  const me = await agent.getAddress();
  if (wallet.toLowerCase() === me.toLowerCase()) return "Sorry, Agent Report Card can't grade itself.";
  const detail = await agent.getAgentByWalletAddress(wallet).catch(() => null);
  if (!detail) return `Sorry, we couldn't find a Virtuals agent at ${wallet}.`;
  if (!pickOffering(detail)) {
    return `Sorry, we test a Virtuals agent by hiring it a few times, and ${detail.name} has no public fixed-price offering at ${MAX_TASK_USD} USDC or less.`;
  }
  return "";
}

/** The request as the GitHub issue form text that auto-grade.ts reads. */
export function asIssueBody(req: GradeRequest): string {
  const field = (label: string, value: string) => `### ${label}\n\n${value || "_No response_"}`;
  return [
    field("Agent name", req.name),
    field("Where can we find it?", req.link),
    field("What does it do?", req.about),
    field("Model name (OpenAI-style endpoints only)", req.model),
    field("Tasks you'd like it tested on (optional)", req.task),
    field("Payment transaction", "Paid through Virtuals ACP escrow"),
  ].join("\n\n");
}

function requirementOf(session: JobSession): GradeRequest | null {
  const msg = session.entries.find((e) => e.kind === "message" && e.contentType === "requirement");
  return msg && msg.kind === "message" ? parseRequirement(msg.content) : null;
}

function fundedAmount(session: JobSession): number {
  for (const e of session.entries) {
    if (e.kind === "system" && e.event.type === "job.funded") return e.event.amount;
  }
  return 0;
}

function clientOf(session: JobSession): string {
  for (const e of session.entries) {
    if (e.kind === "system" && e.event.type === "job.created") return e.event.client;
  }
  return "";
}

const providerJobs = (agent: AcpAgent) => agent.sessions.filter((s) => s.roles.includes("provider"));

/** Step 3: submit the report for every graded job that's still funded. */
async function submitGraded(agent: AcpAgent): Promise<void> {
  for (const s of providerJobs(agent)) {
    const ref = jobRef(s.chainId, s.jobId);
    const rec = loadJobs().find((j) => j.ref === ref);
    if (s.status !== "funded" || rec?.state !== "graded" || !rec.agentId) continue;
    const run = loadReport(rec.agentId).runs.at(-1);
    const deliverable = JSON.stringify({
      report: `${SITE}/agents/${rec.agentId}/`,
      grade: run?.grade ?? null,
      score: run?.score ?? null,
      summary: run?.summary ?? "",
      badge: `${SITE}/badge/${rec.agentId}.svg`,
    });
    await s.submit(deliverable);
    saveJob({ ...rec, state: "submitted" });
    console.log(`Job ${ref}: report submitted.`);
  }
}

/** Steps 1 and 2. */
async function handleNew(agent: AcpAgent): Promise<void> {
  let gradedThisRun = false;
  for (const s of providerJobs(agent)) {
    const ref = jobRef(s.chainId, s.jobId);
    const rec = loadJobs().find((j) => j.ref === ref);
    const req = requirementOf(s);

    if (s.status === "open" && !rec) {
      const reason = await whyNot(agent, req);
      if (reason) {
        await s.sendMessage(`${reason} No budget was set, so nothing was charged.`, "text");
        saveJob({ ref, chainId: s.chainId, jobId: s.jobId, state: "declined" });
        console.log(`Job ${ref}: declined, no usable agent link.`);
        continue;
      }
      await s.setBudget(AssetToken.usdc(PRICE_USD, s.chainId));
      saveJob({ ref, chainId: s.chainId, jobId: s.jobId, state: "budget-set" });
      console.log(`Job ${ref}: budget set to ${PRICE_USD} USDC.`);
      continue;
    }

    if (s.status === "funded" && (!rec || rec.state === "budget-set") && req && !gradedThisRun) {
      gradedThisRun = true;
      const amount = fundedAmount(s) || PRICE_USD;
      console.log(`Job ${ref}: funded with ${amount} USDC, grading ${req.link}`);
      const outFile = path.join(process.env.RUNNER_TEMP || "/tmp", `acp-${s.jobId}.out`);
      fs.writeFileSync(outFile, "");
      try {
        execFileSync("npx", ["tsx", "scripts/auto-grade.ts"], {
          stdio: "inherit",
          env: {
            ...process.env,
            ISSUE_NUMBER: "0",
            ISSUE_BODY: asIssueBody(req),
            ISSUE_AUTHOR: "",
            FREE_GRADE: "false",
            ACP_JOB_REF: ref,
            ACP_PAID_USD: String(amount),
            ACP_CLIENT: clientOf(s),
            GITHUB_OUTPUT: outFile,
            COMMENT_FILE: path.join(process.env.RUNNER_TEMP || "/tmp", `acp-${s.jobId}.md`),
          },
        });
      } catch (e) {
        console.error(e);
      }
      const outcome = /outcome=graded/.test(fs.readFileSync(outFile, "utf8")) ? "graded" : "needs-attention";
      const agentId = loadPayments().find((p) => p.tx === ref)?.agentId;
      saveJob({ ref, chainId: s.chainId, jobId: s.jobId, state: outcome, ...(agentId ? { agentId } : {}) });
      if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `outcome=${outcome}\njob=${ref}\n`);
      console.log(`Job ${ref}: ${outcome}.`);
    }
  }
}

/**
 * Jobs a full run would act on: new requests, funded jobs not yet graded, and
 * graded jobs whose report hasn't been submitted. Used by the watcher, which
 * only starts the (heavier) seller workflow when this is above zero.
 */
export function countActionable(sessions: Pick<JobSession, "chainId" | "jobId" | "status">[], jobs: AcpJobRecord[]): number {
  return sessions.filter((s) => {
    const rec = jobs.find((j) => j.ref === jobRef(s.chainId, s.jobId));
    if (s.status === "open") return !rec;
    if (s.status === "funded") return !rec || rec.state === "budget-set" || rec.state === "graded";
    return false;
  }).length;
}

async function main() {
  const agent = await connectAcp();
  try {
    if (process.argv[2] === "check") {
      const n = countActionable(providerJobs(agent), loadJobs());
      console.log(`${n} job(s) need the seller.`);
      if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `actionable=${n}\n`);
      return;
    }
    console.log(`Connected. ${providerJobs(agent).length} active job(s) as provider.`);
    await submitGraded(agent);
    if (process.argv[2] !== "submit") await handleNew(agent);
  } finally {
    await closeAcp();
  }
}

if (process.argv[1]?.endsWith("acp-seller.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
