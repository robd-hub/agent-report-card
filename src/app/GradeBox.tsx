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
