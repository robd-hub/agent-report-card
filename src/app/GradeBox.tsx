import type { Grade } from "@/lib/types";

/** A glowing ring that fills up to the score, with the letter grade in the middle. */
export function GradeRing({ grade, score, size = 64 }: { grade: Grade | null; score: number | null; size?: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score ?? 0)) / 100;
  return (
    <div className={`ring g-${grade ?? "none"}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r={r} className="ring-track" />
        <circle
          cx="32" cy="32" r={r} className="ring-fill"
          strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 32 32)"
        />
      </svg>
      <span style={{ fontSize: size * 0.4 }}>{grade ?? "–"}</span>
    </div>
  );
}

/** A thin horizontal meter for a 0-100 score. */
export function Meter({ value, label, tone = "cyan" }: { value: number | null; label: string; tone?: "cyan" | "violet" }) {
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{label}</span>
        <span className="mono">{value ?? "—"}<small>/100</small></span>
      </div>
      <div className="meter-bar"><div className={`meter-fill ${tone}`} style={{ width: `${value ?? 0}%` }} /></div>
    </div>
  );
}

/** Shows agent answers with **bold** text rendered, keeping line breaks. */
export function Answer({ text }: { text: string }) {
  return (
    <div className="answer">
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
      )}
    </div>
  );
}

/**
 * Score over time for an agent graded more than once: one dot per grade,
 * colored by letter, with the grade lines at 60/70/80/90 for reference.
 * Provisional grades are drawn hollow.
 */
export function Trend({ runs }: { runs: { date: string; score: number | null; grade: Grade | null; provisional: boolean }[] }) {
  const pts = runs.filter((r) => r.score !== null);
  if (pts.length < 2) return null;
  const W = 640, H = 160, L = 34, R = 12, T = 12, B = 26;
  const lo = Math.max(0, Math.min(50, ...pts.map((p) => p.score! - 5)));
  const y = (s: number) => T + (1 - (s - lo) / (100 - lo)) * (H - T - B);
  const x = (i: number) => L + (pts.length === 1 ? 0 : (i / (pts.length - 1)) * (W - L - R));
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.score!).toFixed(1)}`).join(" ");
  const ticks = [60, 70, 80, 90, 100].filter((t) => t >= lo);
  const labelEvery = Math.ceil(pts.length / 6);
  return (
    <svg className="trend" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Score history: ${pts.map((p) => `${p.date.slice(0, 10)} ${p.score}`).join(", ")}`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="trend-grid" />
          <text x={L - 6} y={y(t) + 4} textAnchor="end" className="trend-label">{t}</text>
        </g>
      ))}
      <path d={path} className="trend-line" />
      {pts.map((p, i) => (
        <g key={p.date}>
          <circle cx={x(i)} cy={y(p.score!)} r={5} className={`trend-dot g-${p.grade ?? "none"} ${p.provisional ? "hollow" : ""}`}>
            <title>{`${p.date.slice(0, 10)}: ${p.grade ?? "N/A"} ${p.score}${p.provisional ? " (provisional)" : ""}`}</title>
          </circle>
          {(i % labelEvery === 0 || i === pts.length - 1) && (
            <text x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle"} className="trend-label">{p.date.slice(5, 10)}</text>
          )}
        </g>
      ))}
    </svg>
  );
}
