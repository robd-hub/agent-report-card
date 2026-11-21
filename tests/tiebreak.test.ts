import { test } from "node:test";
import assert from "node:assert/strict";
import { disagreementNote, judgeGap, taskScore } from "../src/lib/grade";
import type { TaskResult } from "../src/lib/types";

function task(reppo: number, serv: number, third?: number): TaskResult {
  return {
    taskId: "t",
    output: "answer",
    serv: { score: serv, summary: "" },
    reppo: { status: "done", evalId: "e", score: reppo, critiques: [] },
    ...(third === undefined ? {} : { tiebreak: { model: "m", score: third, summary: "", sidedWith: Math.abs(third - reppo) <= Math.abs(third - serv) ? "reppo" : "serv", date: "2026-11-21" } }),
  } as TaskResult;
}

test("a task the judges agree on keeps the 70/30 mix, even with a stray tie-break", () => {
  assert.equal(taskScore(task(80, 70)), 77);
  assert.equal(taskScore(task(80, 70, 0)), 77);
});

test("a split task without a tie-break keeps the 70/30 mix", () => {
  assert.equal(Math.round(taskScore(task(95, 18))!), 72);
});

test("a settled split task scores the middle of the three judges", () => {
  assert.equal(taskScore(task(95, 18, 20)), 20);
  assert.equal(taskScore(task(70, 18, 85)), 70);
  assert.equal(taskScore(task(60, 0, 40)), 40);
});

test("the note names the third judge and the side it took", () => {
  const t = task(95, 18, 20);
  const note = disagreementNote(judgeGap(t)!, t.tiebreak);
  assert.match(note, /third judge/);
  assert.match(note, /scored it 20, siding with the SERV check/);
  assert.match(note, /middle of the three: 20/);
});
