/**
 * Builders' replies to their agent's grade, shown on the report page.
 *
 * A builder opens a "Reply to a grade" issue (.github/ISSUE_TEMPLATE/
 * builder-reply.yml). Nothing is published until the maintainer adds the
 * "reply-approved" label, which only people with write access can do; then
 * scripts/builder-reply.ts copies the reply into data/replies.json.
 * Replies are plain text: the page never renders them as HTML or Markdown.
 */
import fs from "node:fs";
import path from "node:path";

export interface BuilderReply {
  agentId: string;
  /** The builder's words, plain text. */
  text: string;
  /** GitHub login of whoever opened the reply issue. */
  author: string;
  /** Where the builder shows they built it (repo, site or X post). */
  proof: string;
  /** The grade it replies to (that run's date). */
  gradeDate: string | null;
  /** When it was published. */
  date: string;
  issue: number;
  /** The builder asked for a regrade after fixing something. */
  wantsRegrade: boolean;
}

export const REPLY_MAX_CHARS = 600;
const FILE = () => path.resolve(process.cwd(), process.env.ARC_DATA_DIR || "data", "replies.json");

export function loadReplies(): BuilderReply[] {
  try {
    return JSON.parse(fs.readFileSync(FILE(), "utf8")) as BuilderReply[];
  } catch {
    return [];
  }
}

export function saveReplies(replies: BuilderReply[]): void {
  fs.writeFileSync(FILE(), JSON.stringify(replies, null, 2) + "\n");
}

/** The newest published reply for an agent, if any. */
export function latestReply(agentId: string, replies = loadReplies()): BuilderReply | null {
  return replies.filter((r) => r.agentId === agentId).sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
}

/** Pulls an agent id out of what the builder typed: the id itself, or a report link. */
export function agentIdFrom(text: string, knownIds: string[]): string | null {
  const t = text.trim().toLowerCase();
  const fromLink = t.match(/\/agents\/([a-z0-9-]+)/)?.[1];
  const id = fromLink ?? t.replace(/[^a-z0-9-]/g, "");
  return knownIds.includes(id) ? id : null;
}

/** Plain text, one paragraph break at most in a row, no control characters, capped in length. */
export function cleanReplyText(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, REPLY_MAX_CHARS);
}

/** The first https link in the proof field, or "". */
export function proofLink(text: string): string {
  const m = text.match(/https:\/\/[^\s<>"')]+/);
  return m ? m[0].slice(0, 300) : "";
}

export type ParsedReply = { ok: true; reply: Omit<BuilderReply, "date" | "issue" | "author" | "gradeDate"> } | { ok: false; reason: string };

/** Checks a reply issue's form fields (from parseIssueForm). */
export function parseReplyForm(fields: Record<string, string>, knownIds: string[]): ParsedReply {
  const agentId = agentIdFrom(fields["Which agent?"] ?? "", knownIds);
  if (!agentId) return { ok: false, reason: "We couldn't match the agent. Paste the link to its report page." };
  const raw = fields["Your reply"] ?? "";
  const text = cleanReplyText(raw);
  if (text.length < 10) return { ok: false, reason: "The reply is empty or too short." };
  const proof = proofLink(fields["How can we tell you built it?"] ?? "");
  if (!proof) return { ok: false, reason: "Add a link that shows you built the agent (its repo, website or a post from its account)." };
  const wantsRegrade = /\[x\]/i.test(fields["Regrade"] ?? "");
  return { ok: true, reply: { agentId, text, proof, wantsRegrade } };
}
