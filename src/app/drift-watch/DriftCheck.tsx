"use client";
import { useState } from "react";
import { analyzeDrift, DEFAULT_OPTIONS, parseLogs, sampleLogs, type DriftOptions, type DriftReport, type WindowStats } from "@/lib/drift";

const STATUS: Record<DriftReport["status"], { label: string; chip: string }> = {
  alert: { label: "Something changed", chip: "chip-bad" },
  steady: { label: "Steady", chip: "chip-ok" },
  "not-enough-data": { label: "Not enough data yet", chip: "chip-warn" },
};

const pct = (x: number) => `${Math.round(x * 100)}%`;
const win = (s: WindowStats) => (s.n ? `${pct(s.refusalRate)} refused · ${s.avgLength.toLocaleString("en")} chars · ${s.n} answers` : "no answers");

/** Paste or open a log of live answers and see refusal rate and answer length per task, worked out in the browser. */
export function DriftCheck() {
  const [text, setText] = useState("");
  const [report, setReport] = useState<DriftReport | null>(null);
  const [error, setError] = useState("");
  // Thresholds as the owner types them: answers per window, refusal points, length %.
  const [minN, setMinN] = useState(String(DEFAULT_OPTIONS.minPerWindow));
  const [refPts, setRefPts] = useState(String(Math.round(DEFAULT_OPTIONS.refusalPoints * 100)));
  const [lenPct, setLenPct] = useState(String(Math.round(DEFAULT_OPTIONS.lengthChange * 100)));
  const options = (): Partial<DriftOptions> => ({ minPerWindow: Number(minN), refusalPoints: Number(refPts) / 100, lengthChange: Number(lenPct) / 100 });

  function run(input: string) {
    setError("");
    try {
      const { rows, skipped } = parseLogs(input);
      if (!rows.length) {
        setReport(null);
        setError("No rows found. Each row needs a task (or type) and an answer (or length).");
        return;
      }
      setReport(analyzeDrift(rows, skipped, undefined, options()));
    } catch (e) {
      setReport(null);
      setError(`Couldn't read that: ${(e as Error).message}`);
    }
  }

  async function openFile(file: File | undefined) {
    if (!file) return;
    const t = await file.text();
    setText(t.length > 200_000 ? t.slice(0, 200_000) + "\n…" : t);
    run(t);
  }

  return (
    <div className="panel">
      <div className="panel-label">Check your logs · runs in your browser, nothing is uploaded</div>
      <textarea
        className="trust-input drift-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'One answer per line, JSON lines, a JSON array or CSV. For example:\n{"time": "2026-11-18T09:00:00Z", "task": "price-lookup", "answer": "The price is $42."}'}
        aria-label="Your logs"
        rows={8}
        spellCheck={false}
      />
      <div className="cta-row drift-actions">
        <button className="btn btn-primary" onClick={() => run(text)} disabled={!text.trim()}>Check</button>
        <label className="btn btn-ghost">
          Open a file
          <input type="file" accept=".json,.jsonl,.ndjson,.csv,.tsv,.txt" hidden onChange={(e) => openFile(e.target.files?.[0])} />
        </label>
        <button
          className="btn btn-ghost"
          onClick={() => {
            const s = sampleLogs();
            setText(s);
            run(s);
          }}
        >
          Try an example
        </button>
      </div>
      <details className="drift-settings">
        <summary className="muted small">Thresholds</summary>
        <div className="drift-fields">
          <label>Answers needed in each window <input className="trust-input" type="number" min={1} value={minN} onChange={(e) => setMinN(e.target.value)} /></label>
          <label>Refusal change, points <input className="trust-input" type="number" min={1} max={100} value={refPts} onChange={(e) => setRefPts(e.target.value)} /></label>
          <label>Length change, % <input className="trust-input" type="number" min={1} value={lenPct} onChange={(e) => setLenPct(e.target.value)} /></label>
        </div>
        <p className="muted small">Change these and press Check again. On quiet tasks a small move can be just a couple of requests, so keep the first one at a few dozen.</p>
      </details>
      {error && <p className="muted small">{error}</p>}
      {report && (
        <div className="drift-result">
          <div className="trust-head">
            <span className={`chip ${STATUS[report.status].chip}`}>{STATUS[report.status].label}</span>
            <span className="muted small">
              {report.rows} answers{report.skipped ? `, ${report.skipped} rows skipped` : ""}. {report.split}.
            </span>
          </div>
          {report.tasks.map((t) => (
            <div className="drift-task" key={t.task}>
              <div className="drift-task-head">
                <strong>{t.task}</strong>
                {t.flags.some((f) => f.level === "urgent") ? <span className="chip chip-bad">Check now</span> : t.flags.some((f) => f.level === "alert") ? <span className="chip chip-bad">Changed</span> : t.baseline.n >= report.options.minPerWindow && t.recent.n >= report.options.minPerWindow ? <span className="chip chip-ok">Steady</span> : <span className="chip">Too few to compare</span>}
              </div>
              <div className="drift-row mono small"><span className="muted">Before</span> {win(t.baseline)}</div>
              <div className="drift-row mono small"><span className="muted">Recent</span> {win(t.recent)}</div>
              {t.flags.map((f) => (
                <p key={f.kind} className={f.level === "urgent" ? "drift-alert drift-urgent" : f.level === "alert" ? "drift-alert" : "muted small"}>{f.message}</p>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
