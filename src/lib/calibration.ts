/**
 * The grader test, using planted errors.
 *
 * A clean agent (the same model as our baseline) answers ten tasks. We then
 * make two copies of its answers:
 *   - "planted": exactly one known error put into each answer (a wrong
 *     total, an invented fact, a broken format rule...),
 *   - "reworded": the same answers rewritten by hand with no errors.
 * All three sets are judged by the normal grader (SERV check and Reppo).
 * If the grader works, every planted answer scores clearly below the clean
 * one (a catch), and the reworded ones don't (no false alarm).
 *
 * Agents, the planted errors and results live in data/calibration/, apart
 * from the public leaderboard. scripts/calibrate.ts runs it.
 */
import fs from "node:fs";
import path from "node:path";
import { taskScore } from "./grade";
import type { AgentConfig, AgentReport, GradingRun, TaskResult } from "./types";

const DIR = path.join(process.cwd(), "data", "calibration");

export const CLEAN_ID = "control-clean";
export const PLANTED_ID = "control-planted";
export const REWORDED_ID = "control-reworded";

/** A planted answer counts as caught when it scores this many points below the clean answer. */
export const CAUGHT_MARGIN = 10;

export interface Plant {
  planted: string;
  /** The error we planted, in plain words. */
  error: string;
  reworded: string;
}

type Judge = "both" | "reppo" | "serv";

export interface PairScores {
  clean: number | null;
  other: number | null;
}

export interface TaskCheck {
  taskId: string;
  prompt: string;
  error: string;
  planted: Record<Judge, PairScores>;
  reworded: Record<Judge, PairScores>;
  /** Planted answer scored CAUGHT_MARGIN+ below the clean one (null until both are judged). */
  caught: boolean | null;
  /** Reworded answer scored CAUGHT_MARGIN+ below the clean one (null until both are judged). */
  falseAlarm: boolean | null;
}

export interface Tally {
  hits: number;
  total: number;
}

export interface CalibrationSummary {
  checks: TaskCheck[];
  caught: Record<Judge, Tally>;
  falseAlarms: Record<Judge, Tally>;
  /** Overall grade for each answer set. */
  sets: { id: string; name: string; score: number | null; grade: string | null }[];
  /** A real mistake the clean model made on its own, if any (lowest-scoring clean task). */
  naturalMiss: { taskId: string; prompt: string; output: string; reppo: number | null; serv: number | null } | null;
  complete: boolean;
  date: string | null;
}

function read<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function loadPlants(): Record<string, Plant> {
  return read<Record<string, Plant>>("plants.json", {});
}

export function loadControlRun(id: string): GradingRun | null {
  return read<AgentReport>(`results/${id}.json`, { agentId: id, runs: [] }).runs.at(-1) ?? null;
}

export function scoreBy(t: TaskResult | undefined, judge: Judge): number | null {
  if (!t) return null;
  if (judge === "serv") return t.serv?.score ?? null;
  if (judge === "reppo") return t.reppo.status === "done" ? t.reppo.score : null;
  const s = taskScore(t);
  // Only count the mixed score once both judges are in, so it's comparable across answers.
  return s === null || t.reppo.status !== "done" ? null : Math.round(s);
}

const below = (p: PairScores) => (p.clean === null || p.other === null ? null : p.clean - p.other >= CAUGHT_MARGIN);

export function loadCalibration(): CalibrationSummary {
  const agents = read<AgentConfig[]>("agents.json", []);
  const plants = loadPlants();
  const clean = loadControlRun(CLEAN_ID);
  const planted = loadControlRun(PLANTED_ID);
  const reworded = loadControlRun(REWORDED_ID);
  const find = (run: GradingRun | null, id: string) => run?.tasks.find((t) => t.taskId === id);
  const judges: Judge[] = ["both", "reppo", "serv"];

  const checks: TaskCheck[] = Object.entries(plants).map(([taskId, plant]) => {
    const pair = (other: GradingRun | null) =>
      Object.fromEntries(judges.map((j) => [j, { clean: scoreBy(find(clean, taskId), j), other: scoreBy(find(other, taskId), j) }])) as Record<Judge, PairScores>;
    const p = pair(planted);
    const r = pair(reworded);
    return {
      taskId,
      prompt: find(clean, taskId)?.prompt ?? agents[0]?.tasks.find((t) => t.id === taskId)?.prompt ?? taskId,
      error: plant.error,
      planted: p,
      reworded: r,
      caught: below(p.both),
      falseAlarm: below(r.both),
    };
  });

  const tally = (pick: (c: TaskCheck) => PairScores): Tally => {
    const judged = checks.map(pick).filter((p) => below(p) !== null);
    return { hits: judged.filter((p) => below(p)).length, total: judged.length };
  };

  const lowest = clean?.tasks
    .map((t) => ({ t, s: scoreBy(t, "both") ?? scoreBy(t, "serv") }))
    .filter((x) => x.s !== null && x.s < 50)
    .sort((a, b) => a.s! - b.s!)[0];

  const runs = [clean, planted, reworded];
  const runById: Record<string, GradingRun | null> = { [CLEAN_ID]: clean, [PLANTED_ID]: planted, [REWORDED_ID]: reworded };
  const dates = runs.map((r) => r?.date).filter((d): d is string => Boolean(d)).sort();
  return {
    checks,
    caught: Object.fromEntries(judges.map((j) => [j, tally((c) => c.planted[j])])) as Record<Judge, Tally>,
    falseAlarms: Object.fromEntries(judges.map((j) => [j, tally((c) => c.reworded[j])])) as Record<Judge, Tally>,
    sets: agents.map((a) => ({ id: a.id, name: a.name, score: runById[a.id]?.score ?? null, grade: runById[a.id]?.grade ?? null })),
    naturalMiss: lowest
      ? { taskId: lowest.t.taskId, prompt: lowest.t.prompt ?? lowest.t.taskId, output: lowest.t.output, reppo: scoreBy(lowest.t, "reppo"), serv: scoreBy(lowest.t, "serv") }
      : null,
    complete: runs.every((r) => r && !r.provisional),
    date: dates.at(-1) ?? null,
  };
}
