/**
 * Drift Watch: two cheap checks on an agent's live answers that need no judge.
 *
 * 1. Refusal rate per kind of task. A rise on a task that used to be answered
 *    usually means a tool broke, a source went away or the model got more
 *    cautious. Zero refusals on data questions is its own warning: the agent
 *    may be guessing.
 * 2. Average answer length per kind of task. It barely moves for months, so a
 *    jump is nearly always something real: a prompt edit, a model swap or a
 *    tool change.
 *
 * Both are worked out from logs the owner already has. Nothing is sent to a
 * model, so a check costs nothing. Idea from a Reddit commenter who works on an
 * LLM gateway (Nov 2026).
 *
 * Used by the /drift-watch page (in the browser, so the logs never leave the
 * owner's machine) and by POST /api/drift on Vercel.
 */

/** One logged answer. Send the text, or just its length and whether it refused. */
export interface DriftRow {
  task: string;
  answer?: string;
  length?: number;
  refused?: boolean;
  time?: number; // ms since epoch
}

export interface WindowStats {
  n: number;
  refusals: number;
  refusalRate: number; // 0..1
  avgLength: number; // characters, over answers that weren't refusals
}

export type FlagKind = "refusals-up" | "refusals-down" | "never-refuses" | "length-up" | "length-down";

export interface DriftFlag {
  kind: FlagKind;
  level: "alert" | "note";
  message: string;
}

export interface TaskDrift {
  task: string;
  baseline: WindowStats;
  recent: WindowStats;
  flags: DriftFlag[];
}

export interface DriftReport {
  version: 1;
  status: "alert" | "steady" | "not-enough-data";
  rows: number;
  split: string; // how the rows were split into baseline and recent
  tasks: TaskDrift[];
  skipped: number; // rows with no task or no answer/length
}

/** Fewest answers in each window before we compare them. */
export const MIN_PER_WINDOW = 10;
/** Refusal rate must move by at least this much (10 points), and at least double or halve. */
export const REFUSAL_POINTS = 0.1;
/** Average length must change by at least 30%. */
export const LENGTH_CHANGE = 0.3;
/** Fewest answers before "never refuses" is worth saying. */
export const NEVER_REFUSES_MIN = 30;
/** With timestamps, the recent window is the last 7 days. */
export const RECENT_DAYS = 7;

// Refusal wording, checked only near the start of the answer so a long answer
// that mentions "I can't" in passing isn't counted.
const REFUSAL_PATTERNS: RegExp[] = [
  /\bi (?:currently )?(?:do not|don't|dont) (?:know|have)\b/,
  /\b(?:found|find) no\b/,
  /\bthere (?:is|are|was|were) no (?:files?|data|publicly available|information|records?|results?|direct)\b/,
  /\bplease (?:provide|share) (?:the|specific|a|more|your)\b/,
  /\bi (?:can ?not|can't|cant|am unable to|'m unable to|m unable to|am not able to|'m not able to|couldn't|could not|won't be able to)\b/,
  /\b(?:unable to|not able to) (?:find|provide|verify|confirm|access|answer|help|determine|retrieve)\b/,
  /\b(?:is|are|was) not (?:available|publicly available|disclosed|known)\b/,
  /\bno (?:data|information|records?|results?) (?:is |are |was )?(?:available|found)\b/,
  /\b(?:couldn't|could not|did not|didn't) find\b/,
  /\bi(?:'m| am) sorry\b|\bi apologi[sz]e\b|\bas an ai\b/,
  /\bcan(?:'t|not) (?:verify|confirm|help with|assist with)\b/,
];

/** Does this answer decline or say it doesn't know? */
export function isRefusal(answer: string): boolean {
  const text = answer.trim().toLowerCase().replace(/[’‘]/g, "'");
  if (!text) return true;
  if (/^(?:unknown|n\/a|none|i don't know|no answer)\.?$/.test(text)) return true;
  const head = text.slice(0, 300);
  return REFUSAL_PATTERNS.some((p) => p.test(head));
}

const TASK_KEYS = ["task", "task_type", "taskType", "type", "category", "route", "intent", "tool"];
const ANSWER_KEYS = ["answer", "output", "response", "completion", "text", "content", "reply"];
const TIME_KEYS = ["time", "timestamp", "ts", "created_at", "createdAt", "date", "datetime"];
const LENGTH_KEYS = ["length", "chars", "answer_length", "answerLength"];
const REFUSED_KEYS = ["refused", "refusal", "is_refusal", "declined"];

function pick(o: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
  const lower = Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));
  for (const k of keys) {
    const v = lower[k.toLowerCase()];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function toTime(v: unknown): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v; // seconds or ms
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return toTime(Number(s));
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : t;
}

function toBool(v: unknown): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["true", "yes", "1", "y"].includes(s)) return true;
  if (["false", "no", "0", "n"].includes(s)) return false;
  return undefined;
}

/** Turn one parsed object into a row, or null if it has no task or nothing to measure. */
export function toRow(o: Record<string, unknown>): DriftRow | null {
  const task = pick(o, TASK_KEYS);
  if (task === undefined) return null;
  const rawAnswer = pick(o, ANSWER_KEYS);
  const answer = rawAnswer === undefined ? undefined : typeof rawAnswer === "string" ? rawAnswer : JSON.stringify(rawAnswer);
  const lengthRaw = pick(o, LENGTH_KEYS);
  const length = lengthRaw === undefined ? undefined : Number(lengthRaw);
  if (answer === undefined && (length === undefined || Number.isNaN(length))) return null;
  return {
    task: String(task).trim(),
    answer,
    length: length !== undefined && !Number.isNaN(length) ? length : undefined,
    refused: toBool(pick(o, REFUSED_KEYS)),
    time: toTime(pick(o, TIME_KEYS)),
  };
}

/** Minimal CSV reader: header row, quoted fields, "" escapes, commas or tabs. */
export function parseCsv(text: string): Record<string, string>[] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = firstLine.includes("\t") && !firstLine.includes(",") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === sep) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  const [head, ...body] = rows;
  if (!head) return [];
  const keys = head.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ""])));
}

/** Read pasted logs: a JSON array, JSON lines, or CSV with a header row. */
export function parseLogs(text: string): { rows: DriftRow[]; skipped: number } {
  const t = text.trim();
  let objects: Record<string, unknown>[] = [];
  if (!t) return { rows: [], skipped: 0 };
  if (t.startsWith("[")) {
    const arr = JSON.parse(t);
    objects = Array.isArray(arr) ? arr : [];
  } else if (t.startsWith("{")) {
    // A single object holding a list, or JSON lines.
    try {
      const one = JSON.parse(t);
      const list = one.rows ?? one.logs ?? one.data ?? one.answers;
      objects = Array.isArray(list) ? list : [one];
    } catch {
      objects = t.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
    }
  } else {
    objects = parseCsv(t);
  }
  return fromObjects(objects);
}

export function fromObjects(objects: unknown[]): { rows: DriftRow[]; skipped: number } {
  const rows: DriftRow[] = [];
  let skipped = 0;
  for (const o of objects) {
    const r = o && typeof o === "object" ? toRow(o as Record<string, unknown>) : null;
    if (r) rows.push(r);
    else skipped++;
  }
  return { rows, skipped };
}

function stats(rows: DriftRow[]): WindowStats {
  let refusals = 0;
  let total = 0;
  for (const r of rows) {
    const refused = r.refused ?? (r.answer !== undefined ? isRefusal(r.answer) : false);
    // Length is averaged over real answers only, so a wave of short refusals
    // shows up as a refusal change rather than a length change.
    if (refused) refusals++;
    else total += r.length ?? r.answer?.length ?? 0;
  }
  const n = rows.length;
  const answered = n - refusals;
  return { n, refusals, refusalRate: n ? refusals / n : 0, avgLength: answered ? Math.round(total / answered) : 0 };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function flagsFor(base: WindowStats, recent: WindowStats): DriftFlag[] {
  const flags: DriftFlag[] = [];
  const enough = base.n >= MIN_PER_WINDOW && recent.n >= MIN_PER_WINDOW;
  if (enough) {
    const up = recent.refusalRate - base.refusalRate;
    if (up >= REFUSAL_POINTS && recent.refusalRate >= base.refusalRate * 2) {
      flags.push({
        kind: "refusals-up",
        level: "alert",
        message: `Refusals rose from ${pct(base.refusalRate)} to ${pct(recent.refusalRate)}. Usually a tool broke, a source went away or the model got more cautious.`,
      });
    } else if (-up >= REFUSAL_POINTS && recent.refusalRate <= base.refusalRate / 2) {
      flags.push({
        kind: "refusals-down",
        level: "alert",
        message: `Refusals fell from ${pct(base.refusalRate)} to ${pct(recent.refusalRate)}. Good if you fixed something, worrying if the agent has started guessing.`,
      });
    }
    if (base.avgLength > 0) {
      const change = recent.avgLength / base.avgLength - 1;
      if (Math.abs(change) >= LENGTH_CHANGE) {
        flags.push({
          kind: change > 0 ? "length-up" : "length-down",
          level: "alert",
          message: `Average length went from ${base.avgLength.toLocaleString("en")} to ${recent.avgLength.toLocaleString("en")} characters (${change > 0 ? "+" : ""}${Math.round(change * 100)}%). Jumps like this are nearly always a prompt edit, a model swap or a tool change.`,
        });
      }
    }
  }
  const all = base.n + recent.n;
  if (all >= NEVER_REFUSES_MIN && base.refusals + recent.refusals === 0) {
    flags.push({
      kind: "never-refuses",
      level: "note",
      message: `No refusals in ${all} answers. Fine if every question can be answered, but if some ask for data the agent can't have, it may be guessing.`,
    });
  }
  return flags;
}

/** Split the rows into baseline and recent, then compare each kind of task. */
export function analyzeDrift(rows: DriftRow[], skipped = 0, now?: number): DriftReport {
  let baseline: DriftRow[];
  let recent: DriftRow[];
  let split: string;
  const timed = rows.length > 0 && rows.every((r) => r.time !== undefined);
  if (timed) {
    const sorted = [...rows].sort((a, b) => a.time! - b.time!);
    const end = now ?? sorted[sorted.length - 1].time!;
    const cut = end - RECENT_DAYS * 86_400_000;
    recent = sorted.filter((r) => r.time! > cut);
    baseline = sorted.filter((r) => r.time! <= cut);
    split = `Last ${RECENT_DAYS} days compared with everything before`;
    if (!baseline.length || !recent.length) {
      const mid = Math.floor(sorted.length / 2);
      baseline = sorted.slice(0, mid);
      recent = sorted.slice(mid);
      split = "Newer half compared with older half (by time)";
    }
  } else {
    const cut = Math.floor((rows.length * 2) / 3);
    baseline = rows.slice(0, cut);
    recent = rows.slice(cut);
    split = "Last third of the rows compared with the first two thirds (no timestamps, so row order is used)";
  }

  const tasks = [...new Set(rows.map((r) => r.task))].sort();
  const result: TaskDrift[] = tasks.map((task) => {
    const b = stats(baseline.filter((r) => r.task === task));
    const r = stats(recent.filter((x) => x.task === task));
    return { task, baseline: b, recent: r, flags: flagsFor(b, r) };
  });
  result.sort((a, b) => Number(b.flags.some((f) => f.level === "alert")) - Number(a.flags.some((f) => f.level === "alert")) || b.recent.n + b.baseline.n - (a.recent.n + a.baseline.n));

  const compared = result.some((t) => t.baseline.n >= MIN_PER_WINDOW && t.recent.n >= MIN_PER_WINDOW);
  const status = result.some((t) => t.flags.some((f) => f.level === "alert")) ? "alert" : compared ? "steady" : "not-enough-data";
  return { version: 1, status, rows: rows.length, split, tasks: result, skipped };
}

/** A made-up log to try the page with: a lookup tool breaks and a prompt edit makes summaries longer. */
export function sampleLogs(): string {
  const lines: string[] = [];
  const start = Date.UTC(2026, 9, 1);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let day = 0; day < 35; day++) {
    for (let i = 0; i < 6; i++) {
      const time = new Date(start + day * 86_400_000 + i * 3_600_000).toISOString();
      const late = day >= 28;
      const lookupRefuses = rand() < (late ? 0.45 : 0.05);
      lines.push(JSON.stringify({ time, task: "price-lookup", answer: lookupRefuses ? "I can't find a price for that item right now." : `The current price is $${(10 + rand() * 90).toFixed(2)}.` }));
      const words = Math.round((late ? 140 : 70) + rand() * 20);
      lines.push(JSON.stringify({ time, task: "summary", answer: "word ".repeat(words).trim() + "." }));
      lines.push(JSON.stringify({ time, task: "support-reply", answer: rand() < 0.1 ? "Sorry, I don't have access to your order history." : "Thanks for reaching out. Your refund has been sent and should arrive in 3 to 5 days." }));
    }
  }
  return lines.join("\n");
}
