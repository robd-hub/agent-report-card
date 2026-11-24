/**
 * Publishes a builder's reply to their grade once the maintainer has approved
 * it (label "reply-approved", which only people with write access can add).
 * Run by .github/workflows/builder-reply.yml.
 *
 *   ISSUE_NUMBER=70 ISSUE_BODY="..." ISSUE_AUTHOR=someone npx tsx scripts/builder-reply.ts
 *
 * The issue text is untrusted: it is parsed into plain text fields and never
 * passed to a shell. Writes the reply for the issue to COMMENT_FILE.
 */
import fs from "node:fs";
import { latestRun, loadAgents, loadReport } from "../src/lib/data";
import { REGRADE_PRICE_USD } from "../src/lib/links";
import { loadReplies, parseReplyForm, saveReplies } from "../src/lib/replies";
import { parseIssueForm } from "./auto-grade";

const SITE = "https://robd-hub.github.io/agent-report-card";

function main() {
  const issue = Number(process.env.ISSUE_NUMBER);
  const body = process.env.ISSUE_BODY ?? "";
  const author = (process.env.ISSUE_AUTHOR ?? "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 39);
  const commentFile = process.env.COMMENT_FILE || "comment.md";
  const out = (text: string, outcome: string) => {
    fs.writeFileSync(commentFile, text);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `outcome=${outcome}\n`);
    console.log(outcome, "\n" + text);
  };
  if (!Number.isInteger(issue) || issue <= 0) throw new Error("ISSUE_NUMBER is missing");

  const agents = loadAgents();
  const parsed = parseReplyForm(parseIssueForm(body), agents.map((a) => a.id));
  if (!parsed.ok) return out(`We couldn't publish this reply: ${parsed.reason} Edit the issue and we'll take another look.`, "rejected");

  const { agentId } = parsed.reply;
  const agent = agents.find((a) => a.id === agentId)!;
  const replies = loadReplies().filter((r) => r.issue !== issue);
  replies.push({
    ...parsed.reply,
    author,
    gradeDate: latestRun(loadReport(agentId))?.date ?? null,
    date: new Date().toISOString(),
    issue,
  });
  saveReplies(replies);

  const regrade = parsed.reply.wantsRegrade
    ? `\n\nYou asked for a regrade. It's $${REGRADE_PRICE_USD} and uses the same tasks, so the report shows each task before and after: ${SITE}/request/`
    : "";
  out(`Thanks! Your reply is now on ${agent.name}'s report page (it shows up within a few minutes): ${SITE}/agents/${agentId}/${regrade}`, "published");
}

main();
