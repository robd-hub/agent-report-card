import assert from "node:assert/strict";
import test from "node:test";
import { agentIdFrom, cleanReplyText, latestReply, parseReplyForm, proofLink, type BuilderReply } from "../src/lib/replies";
import { parseIssueForm } from "../scripts/auto-grade";

const ids = ["coder", "cheap-first"];
const body = (agent: string, reply: string, proof: string, regrade = "- [ ] I've fixed something and would like a $5 regrade") =>
  `### Which agent?\n\n${agent}\n\n### Your reply\n\n${reply}\n\n### How can we tell you built it?\n\n${proof}\n\n### Regrade\n\n${regrade}`;

test("agent id from a report link or the bare id", () => {
  assert.equal(agentIdFrom("https://robd-hub.github.io/agent-report-card/agents/cheap-first/", ids), "cheap-first");
  assert.equal(agentIdFrom(" Coder ", ids), "coder");
  assert.equal(agentIdFrom("someone-else", ids), null);
});

test("a good reply parses, with the regrade box", () => {
  const r = parseReplyForm(parseIssueForm(body("coder", "We fixed the length limit bug.", "see https://github.com/me/coder now", "- [X] I've fixed something and would like a $5 regrade")), ids);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.reply.agentId, "coder");
    assert.equal(r.reply.proof, "https://github.com/me/coder");
    assert.equal(r.reply.wantsRegrade, true);
  }
});

test("bad replies are refused", () => {
  assert.equal(parseReplyForm(parseIssueForm(body("nobody", "We fixed the length limit bug.", "https://x.com/me")), ids).ok, false);
  assert.equal(parseReplyForm(parseIssueForm(body("coder", "_No response_", "https://x.com/me")), ids).ok, false);
  assert.equal(parseReplyForm(parseIssueForm(body("coder", "We fixed the length limit bug.", "http://insecure.example")), ids).ok, false);
});

test("reply text is cleaned and capped", () => {
  assert.equal(cleanReplyText("a\r\n\n\n\nb\u0007"), "a\n\nb");
  assert.equal(cleanReplyText("x".repeat(900)).length, 600);
  assert.equal(proofLink("javascript:alert(1)"), "");
});

test("latest reply wins", () => {
  const r = (date: string): BuilderReply => ({ agentId: "coder", text: date, author: "a", proof: "https://a.b", gradeDate: null, date, issue: 1, wantsRegrade: false });
  assert.equal(latestReply("coder", [r("2026-11-01"), r("2026-11-20"), r("2026-11-10")])?.text, "2026-11-20");
  assert.equal(latestReply("cheap-first", [r("2026-11-01")]), null);
});
