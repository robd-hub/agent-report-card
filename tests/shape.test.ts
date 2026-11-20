import assert from "node:assert/strict";
import test from "node:test";
import { lengthScore, opening, runShape, shapeLine, taskShape, wordCount, wordLimit } from "../src/lib/shape";
import { shapeFields } from "../scripts/auto-grade";
import { loadAgents, loadReport, latestRun } from "../src/lib/data";
import type { TaskResult } from "../src/lib/types";

const base = (output: string, extra: Partial<TaskResult> = {}): TaskResult => ({
  taskId: "t",
  prompt: "A shop sells notebooks at $3.40 each, or packs of 12 for $36. What is the cheapest way to buy 30?",
  output,
  serv: null,
  reppo: { status: "unconfigured" },
  answerKeys: ["92.40", "2 packs"],
  wordBudget: 40,
  ...extra,
});

test("the opening is the first sentence, skipping headings, and keeps prices whole", () => {
  assert.equal(opening("## Answer\n\nIt costs $92.40 in total. Here's why."), "it costs $92.40 in total.");
  assert.equal(opening("Cheapest: buy **2 packs** and 6 singles.\n\n- more"), "cheapest: buy 2 packs and 6 singles.");
});

test("an answer that leads with the key is answer first", () => {
  assert.deepEqual(taskShape(base("The total is $92.40: two packs plus six singles."))?.answerFirst, { status: "first" });
  // LaTeX and thousands commas don't hide a number.
  assert.deepEqual(taskShape(base("Total: \\(\\boxed{\\$92.40}\\)"))?.answerFirst, { status: "first" });
  assert.deepEqual(taskShape(base("Answer: 1,250 units.", { answerKeys: ["1250"] }))?.answerFirst, { status: "first" });
});

test("an answer that gets there late is buried, with how far in", () => {
  const s = taskShape(base("Great question! Buying in bulk is often cheaper, but not always. Let's look at the options. In the end it comes to $92.40."));
  assert.equal(s?.answerFirst?.status, "buried");
  assert.ok(s?.answerFirst?.status === "buried" && s.answerFirst.wordsBefore >= 15);
});

test("a number only matches the same value, not a longer one", () => {
  assert.equal(taskShape(base("It costs $192.40.", { answerKeys: ["92.40"] }))?.answerFirst?.status, "not-found");
});

test("without a key, filler openers count as a slow start", () => {
  const s = taskShape(base("Sure! I'd be happy to help with that.", { answerKeys: undefined }));
  assert.equal(s?.answerFirst?.status, "slow-start");
  assert.equal(taskShape(base("Gross margin is revenue minus cost of goods.", { answerKeys: undefined }))?.answerFirst, null);
});

test("length uses the task's own word limit when it sets one", () => {
  assert.equal(wordLimit("In under 150 words, explain proof of stake."), 150);
  assert.equal(wordLimit("Write a 50-word summary."), 50);
  assert.equal(wordLimit("Explain proof of stake."), null);
  const long = Array(160).fill("word").join(" ");
  const s = taskShape(base(long, { prompt: "In under 150 words, explain it." }));
  assert.equal(s?.length?.source, "limit");
  assert.equal(s?.length?.target, 150);
  assert.equal(s?.length?.over, false); // within 10%
});

test("length score is 100 near the target and falls to 0 at three times it", () => {
  assert.equal(lengthScore(44, 40), 100);
  assert.equal(lengthScore(120, 40), 0);
  assert.ok(lengthScore(80, 40) > 40 && lengthScore(80, 40) < 60);
  assert.equal(wordCount("**Total:** $92.40 — two packs."), 4);
});

test("a run sums up the signals and suggests fixes only for what went wrong", () => {
  const padded = Array(100).fill("context").join(" ") + " so it's $92.40.";
  const shape = runShape([base("$92.40 in total.", { taskId: "a" }), base(padded, { taskId: "b" })]);
  assert.deepEqual(shape?.answerFirst, { first: 1, checked: 2 });
  assert.deepEqual(shape?.padded, ["b"]);
  assert.equal(shape?.fixes.length, 4);
  assert.match(shapeLine(shape) ?? "", /answer first on 1 of 2 tasks/);
  assert.deepEqual(runShape([base("$92.40 in total.")])?.fixes, []);
});

test("old runs without keys or budgets show nothing, so published grades look the same", () => {
  assert.equal(runShape([base("anything", { answerKeys: undefined, wordBudget: undefined })]), null);
  const coder = loadAgents().find((a) => a.id === "coder")!;
  assert.equal(runShape(latestRun(loadReport("coder"))!.tasks, coder), null);
});

test("Cheap First's current report shows its answer shape from its task keys", () => {
  const cf = loadAgents().find((a) => a.id === "cheap-first")!;
  const shape = runShape(latestRun(loadReport("cheap-first"))!.tasks, cf);
  assert.ok(shape);
  assert.ok(shape!.answerFirst!.checked >= 2);
});

test("the task writer's answer keys and budgets are cleaned up", () => {
  assert.deepEqual(shapeFields({ answer_keys: ["$92.40", "a", 7], word_budget: "120" }), { answerKeys: ["$92.40"], wordBudget: 120 });
  assert.deepEqual(shapeFields({ answer_keys: [], word_budget: 3 }), {});
  assert.deepEqual(shapeFields({ answerKeys: "Paris" }), { answerKeys: ["Paris"] });
});
