import type { AgentConfig, TaskResult } from "./types";

/**
 * Answer shape: does the agent put the answer first, and does it keep to a
 * sensible length? Both are plain code checks on the saved answer, so they
 * cost nothing to run and never change a task's score. They're shown on the
 * report as their own signals, so "be shorter" and "answer first" become
 * targets a builder can work on.
 *
 * Idea from a Reddit commenter on agents that ramble: make the direct answer
 * the first line and everything after it support, and if answers wander,
 * look at how much context goes in, not only at what comes out.
 *
 * Only tasks that carry an answer key or a length budget are checked. Tasks
 * written for paid grades since 20 November 2026 get both; older grades don't
 * have them and show no answer-shape section.
 */

/** How many words of the opening count as "first". */
const OPENING_WORDS = 40;

/** Words that start an answer without saying anything. */
const FILLER_OPENER =
  /^(sure|certainly|of course|absolutely|great question|good question|excellent question|what a great|happy to help|i'?d be (happy|glad)|i would be (happy|glad)|thanks for|thank you for|as an ai|okay|ok|let me|let's dive|alright)\b/i;

/** Tidy an answer for matching: plain quotes, no markdown or LaTeX marks, no thousands commas. */
export function normalise(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\\boxed\{([^}]*)\}/g, "$1")
    .replace(/\\\(|\\\)|\\\[|\\\]/g, " ")
    .replace(/\\times/g, "x")
    .replace(/\\\$/g, "$")
    .replace(/[*_`#>]+/g, " ")
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/[ \t]+/g, " ")
    .toLowerCase();
}

/** Words in an answer, ignoring markdown marks. */
export function wordCount(text: string): number {
  return (normalise(text).match(/[a-z0-9$%][^\s]*/gi) ?? []).length;
}

/**
 * The opening of an answer: its first real line (skipping blank lines and
 * headings), cut at the end of the first sentence, at most 40 words.
 */
export function opening(text: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const first = lines.find((l) => l && !/^#{1,6}\s/.test(l) && !/^[-=*_]{3,}$/.test(l)) ?? "";
  const plain = normalise(first).trim();
  // A full stop ends a sentence only when a space and a new word follow (so $92.40 stays whole).
  const end = plain.search(/[.!?](\s+|$)(?=[a-z0-9"'(]|$)/);
  const sentence = end >= 0 ? plain.slice(0, end + 1) : plain;
  return sentence.split(/\s+/).slice(0, OPENING_WORDS).join(" ");
}

/** Where a key first appears in the text, as a count of words before it, or -1. */
function findKey(text: string, key: string): number {
  const k = normalise(key).trim();
  if (!k) return -1;
  const num = k.replace(/[$%\s]/g, "");
  let index = -1;
  if (/^-?\d+(\.\d+)?$/.test(num)) {
    // A number: match the same value, so 92.4, 92.40 and $92.40 all count.
    const want = Number(num);
    const re = /-?\d+(?:\.\d+)?/g;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (Math.abs(Number(m[0]) - want) < 1e-9 && !/\d/.test(text[m.index - 1] ?? "")) {
        index = m.index;
        break;
      }
    }
  } else {
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).exec(text);
    if (m) index = m.index + m[1].length;
  }
  if (index < 0) return -1;
  return text.slice(0, index).split(/\s+/).filter(Boolean).length;
}

export type AnswerFirst =
  /** The key answer is in the opening sentence. */
  | { status: "first" }
  /** The key answer is there, but only after this many words. */
  | { status: "buried"; wordsBefore: number }
  /** No key for this task, and the answer opens with filler ("Sure! Great question..."). */
  | { status: "slow-start"; opener: string }
  /** The key answer isn't in the answer at all, so this check can't say (the judges score correctness). */
  | { status: "not-found" };

/** The word limit a task sets itself ("under 150 words", "at most 50 words"), if any. */
export function wordLimit(prompt: string): number | null {
  const patterns = [
    /\b(?:under|fewer than|less than|at most|no more than|max(?:imum)?(?: of)?|within|up to|in)\s+(\d{1,4})\s+words\b/gi,
    /\b(\d{1,4})\s+words\s+(?:or fewer|or less|max(?:imum)?)\b/gi,
    /\b(\d{1,4})-word\b/gi,
  ];
  for (const re of patterns) {
    for (const m of prompt.matchAll(re)) {
      // "three bullet points, each under 15 words" limits each item, not the whole answer, so it isn't the target.
      const before = prompt.slice(Math.max(0, m.index - 30), m.index);
      const after = prompt.slice(m.index + m[0].length, m.index + m[0].length + 20);
      if (/\b(?:each|every|per)\b[^.,;:]*$/i.test(before) || /^\s*(?:each|apiece|per\b)/i.test(after)) continue;
      return Number(m[1]);
    }
  }
  return null;
}

export interface LengthCheck {
  words: number;
  /** The word count a complete answer needs: the task's own limit if it sets one, else the budget set when the task was written. */
  target: number;
  /** "limit" when the task itself set it, "budget" when we did. */
  source: "limit" | "budget";
  /** 100 at or under 10% over the target, falling to 0 at three times it. */
  score: number;
  over: boolean;
  /** At least twice the target: the answer is padded with things nobody asked for. */
  padded: boolean;
}

export interface TaskShape {
  taskId: string;
  answerFirst: AnswerFirst | null;
  length: LengthCheck | null;
}

/** A task's answer key and length budget: its own saved copy, else the agent's current task if the wording still matches. */
function shapeFields(t: TaskResult, agent?: Pick<AgentConfig, "tasks">): { answerKeys?: string[]; wordBudget?: number; prompt?: string } {
  if (t.answerKeys || t.wordBudget) return { answerKeys: t.answerKeys, wordBudget: t.wordBudget, prompt: t.prompt };
  const task = agent?.tasks.find((x) => x.id === t.taskId);
  if (!task || (t.prompt !== undefined && t.prompt !== task.prompt)) return { prompt: t.prompt };
  return { answerKeys: task.answerKeys, wordBudget: task.wordBudget, prompt: task.prompt };
}

export function lengthScore(words: number, target: number): number {
  const r = words / target;
  if (r <= 1.1) return 100;
  if (r >= 3) return 0;
  return Math.round(100 * (3 - r) / (3 - 1.1));
}

export function taskShape(t: TaskResult, agent?: Pick<AgentConfig, "tasks">): TaskShape | null {
  const f = shapeFields(t, agent);
  if (!f.answerKeys?.length && !f.wordBudget) return null;
  const text = t.output ?? "";
  if (!text.trim()) return { taskId: t.taskId, answerFirst: null, length: null };

  let answerFirst: AnswerFirst | null = null;
  const open = opening(text);
  if (f.answerKeys?.length) {
    const body = normalise(text);
    if (f.answerKeys.some((k) => findKey(open, k) >= 0)) answerFirst = { status: "first" };
    else {
      const positions = f.answerKeys.map((k) => findKey(body, k)).filter((p) => p >= 0);
      answerFirst = positions.length ? { status: "buried", wordsBefore: Math.min(...positions) } : { status: "not-found" };
    }
  } else if (FILLER_OPENER.test(open)) {
    answerFirst = { status: "slow-start", opener: open.split(/\s+/).slice(0, 8).join(" ") };
  }

  let length: LengthCheck | null = null;
  const limit = f.prompt ? wordLimit(f.prompt) : null;
  const target = limit ?? f.wordBudget ?? null;
  if (target) {
    const words = wordCount(text);
    length = { words, target, source: limit ? "limit" : "budget", score: lengthScore(words, target), over: words > target * 1.1, padded: words >= target * 2 };
  }
  return { taskId: t.taskId, answerFirst, length };
}

export interface RunShape {
  tasks: TaskShape[];
  /** Tasks whose answer came first, out of those where it could be told. */
  answerFirst: { first: number; checked: number } | null;
  /** Average length score over tasks with a target. */
  lengthScore: number | null;
  overCount: number;
  padded: string[];
  buried: string[];
  slowStarts: string[];
  /** Plain-language fixes for the builder, for the problems this run shows. */
  fixes: string[];
}

export const FIXES = {
  answerFirst:
    'Put the answer first. Add a line like "Start with the direct answer in one sentence. Everything after it is support." to your system prompt.',
  length:
    "Set a length target. Tell the model how long a good answer is for this kind of request, and check the word count before you send it.",
  context:
    "Cap the context, not just the output. Answers that wander are often padded with retrieved text nobody asked for. Pass the top few passages, not everything you found.",
  quotes:
    "Ask for one supporting quote per claim, and drop any claim the source can't back. Padding has no quote, so it falls away.",
};

export function runShape(tasks: TaskResult[], agent?: Pick<AgentConfig, "tasks">): RunShape | null {
  const shapes = tasks.map((t) => taskShape(t, agent)).filter((s): s is TaskShape => s !== null);
  if (!shapes.length) return null;
  const told = shapes.filter((s) => s.answerFirst && s.answerFirst.status !== "not-found");
  const lengths = shapes.filter((s) => s.length).map((s) => s.length!);
  const padded = shapes.filter((s) => s.length?.padded).map((s) => s.taskId);
  const buried = shapes.filter((s) => s.answerFirst?.status === "buried").map((s) => s.taskId);
  const slowStarts = shapes.filter((s) => s.answerFirst?.status === "slow-start").map((s) => s.taskId);
  const overCount = lengths.filter((l) => l.over).length;
  const fixes: string[] = [];
  if (buried.length || slowStarts.length) fixes.push(FIXES.answerFirst);
  if (overCount) fixes.push(FIXES.length);
  if (padded.length) fixes.push(FIXES.context, FIXES.quotes);
  return {
    tasks: shapes,
    answerFirst: told.length ? { first: told.filter((s) => s.answerFirst!.status === "first").length, checked: told.length } : null,
    lengthScore: lengths.length ? Math.round(lengths.reduce((a, l) => a + l.score, 0) / lengths.length) : null,
    overCount,
    padded,
    buried,
    slowStarts,
    fixes,
  };
}

/** One line for the grade reply on GitHub, or null when the run has no answer-shape checks. */
export function shapeLine(shape: RunShape | null): string | null {
  if (!shape) return null;
  const parts: string[] = [];
  if (shape.answerFirst) parts.push(`answer first on ${shape.answerFirst.first} of ${shape.answerFirst.checked} tasks`);
  if (shape.lengthScore !== null) parts.push(`length score ${shape.lengthScore}/100`);
  if (shape.padded.length) parts.push(`padded on ${shape.padded.length} ${shape.padded.length === 1 ? "task" : "tasks"}`);
  if (!parts.length) return null;
  return `**Answer shape** (a code check, doesn't change the grade): ${parts.join(", ")}.${shape.fixes.length ? ` Tip: ${shape.fixes[0]}` : ""}`;
}
