import assert from "node:assert/strict";
import test from "node:test";
import { loadAgents, loadReport } from "../src/lib/data";
import { GRADE_PRICE_USD, REGRADE_PRICE_USD } from "../src/lib/links";
import {
  answerLookup,
  howToGetGraded,
  lookupIndex,
  lookupRecord,
  parseSearch,
  RECOMMENDATION_RULE,
  recommend,
  searchAgents,
} from "../src/lib/lookup";
import { resetRateLimits, rateLimit } from "../src/lib/rateLimit";
import { LIMITS } from "../src/server/http";
import { GET as lookupGet } from "../src/server/lookup";
import { GET as agentsGet } from "../src/server/agents";
import type { AgentConfig, GradingRun, TaskResult } from "../src/lib/types";

const SITE = "https://robd-hub.github.io/agent-report-card";
const NOW = Date.parse("2026-11-19T12:00:00.000Z");

function task(id: string, serv: number, reppo: number): TaskResult {
  return {
    taskId: id,
    output: "answer",
    serv: { score: serv, summary: "checked" },
    reppo: { status: "done", evalId: "e", score: reppo, critiques: [] },
  };
}

function run(tasks: TaskResult[], extra: Partial<GradingRun> = {}): GradingRun {
  return {
    date: "2026-11-10T00:00:00.000Z",
    tasks,
    score: 95,
    grade: "A",
    provisional: false,
    summary: "Fine.",
    ...extra,
  };
}

function agent(partial: Partial<AgentConfig> & Pick<AgentConfig, "id" | "name">): AgentConfig {
  return { description: partial.name, adapter: "openserv-marketplace", tasks: [], ...partial };
}

const clean = [task("one", 95, 95), task("two", 95, 95), task("refuse-unknown", 95, 95)];

test("recommendation rule: hire, caution, avoid, and not graded", () => {
  assert.match(RECOMMENDATION_RULE, /hire if the latest grade is A or B/);
  assert.equal(recommend({ grade: null, honesty: null, provisional: false, judgesDisagreed: 0, scoredTasks: 0, gradedAt: null }, NOW).recommendation, null);
  assert.equal(recommend({ grade: "A", honesty: "passed", provisional: false, judgesDisagreed: 1, scoredTasks: 3, gradedAt: "2026-11-10T00:00:00.000Z" }, NOW).recommendation, "hire");
  assert.equal(recommend({ grade: "B", honesty: null, provisional: false, judgesDisagreed: 0, scoredTasks: 3, gradedAt: "2026-11-10T00:00:00.000Z" }, NOW).recommendation, "hire");
  assert.equal(recommend({ grade: "C", honesty: "passed", provisional: false, judgesDisagreed: 0, scoredTasks: 3, gradedAt: "2026-11-10T00:00:00.000Z" }, NOW).recommendation, "caution");
  assert.equal(recommend({ grade: "A", honesty: "failed", provisional: false, judgesDisagreed: 0, scoredTasks: 3, gradedAt: "2026-11-10T00:00:00.000Z" }, NOW).recommendation, "caution");
  assert.equal(recommend({ grade: "A", honesty: "passed", provisional: true, judgesDisagreed: 0, scoredTasks: 3, gradedAt: "2026-11-10T00:00:00.000Z" }, NOW).recommendation, "caution");
  assert.equal(recommend({ grade: "A", honesty: "passed", provisional: false, judgesDisagreed: 1, scoredTasks: 2, gradedAt: "2026-11-10T00:00:00.000Z" }, NOW).recommendation, "caution");
  assert.equal(recommend({ grade: "A", honesty: "passed", provisional: false, judgesDisagreed: 0, scoredTasks: 3, gradedAt: "2026-08-01T00:00:00.000Z" }, NOW).recommendation, "caution");
  assert.equal(recommend({ grade: "D", honesty: "passed", provisional: false, judgesDisagreed: 0, scoredTasks: 3, gradedAt: "2026-11-10T00:00:00.000Z" }, NOW).recommendation, "avoid");
  assert.equal(recommend({ grade: "F", honesty: "failed", provisional: true, judgesDisagreed: 2, scoredTasks: 2, gradedAt: "2026-01-01T00:00:00.000Z" }, NOW).recommendation, "avoid");
});

test("a clean A with one disagreement out of three is hire", () => {
  // The gap is on a normal task. One of three is under half, so it stays hire.
  const record = lookupRecord(agent({ id: "sample", name: "Sample" }), [run([task("one", 100, 50), task("two", 95, 95), task("refuse-unknown", 95, 95)])], SITE, NOW);
  assert.equal(record.judgesDisagreed, 1);
  assert.equal(record.recommendation, "hire");
  assert.equal(record.honesty, "passed");
  assert.equal(record.taskCount, 3);
  assert.equal(record.tasks.length, 3);
  assert.ok(record.byTaskType.length >= 1);
});

test("half the tasks flagged, or a failed honesty check, is caution", () => {
  const split = lookupRecord(agent({ id: "split", name: "Split" }), [run([task("one", 100, 50), task("refuse-unknown", 95, 95)])], SITE, NOW);
  assert.equal(split.judgesDisagree, true);
  assert.equal(split.recommendation, "caution");
  const liar = lookupRecord(agent({ id: "liar", name: "Liar" }), [run([task("one", 95, 95), task("refuse-unknown", 10, 10)])], SITE, NOW);
  assert.equal(liar.honesty, "failed");
  assert.equal(liar.recommendation, "caution");
});

test("published grades: lookup by id, name, marketplace link, and endpoint", () => {
  const index = lookupIndex(loadAgents(), (id) => loadReport(id).runs, SITE, NOW);
  const coder = answerLookup("Coder", index);
  assert.equal(coder.status, "graded");
  assert.equal(coder.agent?.id, "coder");
  assert.equal(coder.free, true);
  assert.ok(coder.grade);
  assert.equal(typeof coder.score, "number");
  assert.ok(coder.gradedAt);
  assert.equal(coder.taskCount, coder.tasks.length);
  assert.equal(coder.judgesDisagree, coder.judgesDisagreed > 0);
  assert.equal(coder.reportUrl, `${SITE}/agents/coder/`);
  assert.equal(coder.badgeUrl, `${SITE}/badge/coder.svg`);
  assert.equal(coder.liveBadgeUrl, "https://grader.designimp.com/api/badge?agent=coder");
  assert.equal(coder.recommendationRule, RECOMMENDATION_RULE);
  if (coder.grade === "D" || coder.grade === "F") assert.equal(coder.recommendation, "avoid");
  if (coder.recommendation === "hire") {
    assert.ok(coder.grade === "A" || coder.grade === "B");
    assert.notEqual(coder.honesty, "failed");
    assert.equal(coder.provisional, false);
    assert.equal(coder.stale, false);
    assert.ok(coder.judgesDisagreed * 2 < coder.scoredTasks);
  }

  assert.equal(answerLookup("https://platform.openserv.ai/agents/39", index).agent?.id, "coder");
  assert.equal(answerLookup("39", index).agent?.id, "coder");
  assert.equal(answerLookup("https://cheap-first.vercel.app/api/ask/", index).agent?.id, "cheap-first");
  assert.equal(answerLookup("Json Parser", index).agent?.id, "json-parser");
  // A shared model API is not one agent's address.
  assert.equal(answerLookup("https://inference-api.openserv.ai/v1/chat/completions", index).status, "not_graded");
});

test("an unknown agent is not graded, and the answer tells you how to order one", () => {
  const index = lookupIndex(loadAgents(), (id) => loadReport(id).runs, SITE, NOW);
  const miss = answerLookup("not-a-real-agent", index);
  assert.equal(miss.status, "not_graded");
  assert.equal(miss.graded, false);
  assert.equal(miss.recommendation, null);
  assert.equal(miss.grade, null);
  assert.equal(miss.message, 'No Agent Report Card grade for "not-a-real-agent" yet.');
  assert.match(miss.why, /haven't graded/);
  const pay = miss.getGraded.paid;
  assert.equal(pay.priceUsd, GRADE_PRICE_USD);
  assert.equal(pay.regradeUsd, REGRADE_PRICE_USD);
  assert.equal(pay.priceUsd, 10);
  assert.equal(pay.regradeUsd, 5);
  assert.equal(pay.currency, "USDC");
  assert.equal(pay.network, "Base");
  assert.equal(pay.method, "POST");
  assert.equal(pay.url, "https://grader.designimp.com/api/grade");
  assert.match(pay.note, /402/);
  assert.match(miss.getGraded.freeFirstGrade.offer, /free/i);
  assert.match(miss.getGraded.freeFirstGrade.url, /grade-request/);
  assert.equal(howToGetGraded().freeToRead, true);

  const blank = answerLookup("  ", index);
  assert.match(blank.message ?? "", /Pass agent/);
});

test("two agents with the same name are ambiguous", () => {
  const twin = (id: string) => lookupRecord(agent({ id, name: "Twin" }), [run(clean)], SITE, NOW);
  const agents = [twin("a"), twin("b")];
  const index = { agents, aliases: { "name:twin": ["a", "b"], "id:a": ["a"], "id:b": ["b"] }, howToGetGraded: howToGetGraded() };
  const hit = answerLookup("Twin", index);
  assert.equal(hit.status, "ambiguous");
  assert.equal(hit.recommendation, null);
  assert.deepEqual(hit.matches?.map((m) => m.id).sort(), ["a", "b"]);
  assert.equal(answerLookup("a", index).agent?.id, "a");
});

test("search filters by grade, category, recommendation, and words", () => {
  const index = lookupIndex(loadAgents(), (id) => loadReport(id).runs, SITE, NOW);
  const parsed = parseSearch({ grade: "A", category: "code-data", limit: "10" });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const found = searchAgents(index.agents, parsed.query);
  assert.ok(found.agents.every((a) => a.grade === "A" && a.category === "code-data"));
  assert.equal(found.free, true);
  assert.ok(found.count >= found.agents.length);
  const inCategory = parseSearch({ category: "code-data", limit: "50" });
  assert.equal(inCategory.ok, true);
  if (!inCategory.ok) return;
  assert.ok(searchAgents(index.agents, inCategory.query).agents.some((a) => a.id === "coder"));

  const avoided = parseSearch({ recommendation: "avoid", limit: "50" });
  assert.equal(avoided.ok, true);
  if (!avoided.ok) return;
  const bad = searchAgents(index.agents, avoided.query);
  assert.ok(bad.agents.length >= 1);
  assert.ok(bad.agents.every((a) => a.recommendation === "avoid" && (a.grade === "D" || a.grade === "F")));

  const named = parseSearch({ q: "polymarket data", limit: "10" });
  assert.equal(named.ok, true);
  if (!named.ok) return;
  const poly = searchAgents(index.agents, named.query);
  assert.ok(poly.agents.every((a) => /polymarket/i.test(a.name) && /data/i.test(a.name)));
  assert.equal(parseSearch({ grade: "Z" }).ok, false);
  assert.equal(parseSearch({ category: "nope" }).ok, false);
});

test("the HTTP lookup and search handlers answer, cache, and rate limit", async () => {
  resetRateLimits();
  const headers = { "x-real-ip": "203.0.113.10" };
  const hit = await lookupGet(new Request("https://grader.designimp.com/api/lookup?agent=coder", { headers }));
  assert.equal(hit.status, 200);
  assert.match(hit.headers.get("cache-control") ?? "", /max-age=60/);
  const body = await hit.json();
  assert.equal(body.agent.id, "coder");
  assert.equal(body.free, true);

  const miss = await lookupGet(new Request("https://grader.designimp.com/api/lookup?agent=not-a-real-agent", { headers }));
  assert.equal(miss.status, 200);
  assert.equal((await miss.json()).status, "not_graded");

  const tooLong = await lookupGet(new Request(`https://grader.designimp.com/api/lookup?agent=${"x".repeat(501)}`, { headers }));
  assert.equal(tooLong.status, 400);

  const list = await agentsGet(new Request("https://grader.designimp.com/api/agents?grade=A&limit=2", { headers: { "x-real-ip": "203.0.113.11" } }));
  assert.equal(list.status, 200);
  const listed = await list.json();
  assert.equal(listed.agents.length, 2);
  assert.ok(listed.agents.every((a: { grade: string }) => a.grade === "A"));

  const bad = await agentsGet(new Request("https://grader.designimp.com/api/agents?grade=Q", { headers: { "x-real-ip": "203.0.113.11" } }));
  assert.equal(bad.status, 400);

  const limitedIp = "203.0.113.99";
  for (let i = 0; i < LIMITS.lookup; i++) rateLimit(`lookup:${limitedIp}`, LIMITS.lookup, 60_000);
  const blocked = await lookupGet(new Request("https://grader.designimp.com/api/lookup?agent=coder", { headers: { "x-real-ip": limitedIp } }));
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers.get("retry-after"));
  const blockedBody = await blocked.json();
  assert.match(blockedBody.error, /free/i);
});
