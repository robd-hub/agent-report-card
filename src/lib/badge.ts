import type { GradingRun } from "./types";

const COLORS: Record<string, string> = { A: "#1f8a4c", B: "#4f8a1f", C: "#b08900", D: "#c2620f", F: "#c0362c" };

/** The small "Report Card | B" badge agents can show on their own sites. */
export function badgeSvg(run: GradingRun | null): string {
  const grade = run?.grade ?? "N/A";
  const color = COLORS[grade] ?? "#8a8a85";
  const label = run?.provisional ? "Report Card (provisional)" : "Report Card";
  // The month it was graded, so a reader can tell an old grade from a fresh one.
  const when = run ? new Date(run.date).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : "";
  const value = when ? `${grade} · ${when}` : grade;
  const lw = label.length * 7 + 16;
  const vw = Math.max(44, value.length * 7 + 16);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + vw}" height="22" role="img" aria-label="${label}: ${value}">
<rect width="${lw}" height="22" rx="4" fill="#33332f"/><rect x="${lw - 4}" width="${vw + 4}" height="22" rx="4" fill="${color}"/>
<text x="8" y="15" fill="#fff" font-family="Verdana,sans-serif" font-size="11">${label}</text>
<text x="${lw + 8}" y="15" fill="#fff" font-family="Verdana,sans-serif" font-size="12" font-weight="bold">${value}</text></svg>
`;
}

/** Grade colours, matching the site. The letter sits on these in dark text. */
export const GRADE_TILE: Record<string, string> = { A: "#2ef2a4", B: "#a6f04a", C: "#ffd84a", D: "#ff9a3c", F: "#ff4d6d" };

export type BadgeTheme = "dark" | "light";
const THEMES: Record<BadgeTheme, { bg: string; line: string; fg: string; muted: string }> = {
  dark: { bg: "#0f131c", line: "#2a3142", fg: "#e8ecf6", muted: "#8b93a7" },
  light: { bg: "#ffffff", line: "#d9dde6", fg: "#12151c", muted: "#5b6275" },
};
const FONT = "-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif";

function gradedOn(run: GradingRun): string {
  return new Date(run.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** A rounded pill: grade letter on the left, score on the right. Sized for a footer or README. */
export function badgePillSvg(run: GradingRun | null, theme: BadgeTheme): string {
  const t = THEMES[theme];
  const grade = run?.grade ?? "–";
  const tile = GRADE_TILE[grade] ?? "#5b6275";
  const right = run ? `${run.score}/100` : "not graded";
  const w = 36 + 118 + right.length * 7.4 + 14;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w)}" height="32" viewBox="0 0 ${Math.round(w)} 32" role="img" aria-label="Agent Report Card: ${grade}, ${right}">
<rect x=".5" y=".5" width="${Math.round(w) - 1}" height="31" rx="16" fill="${t.bg}" stroke="${t.line}"/>
<rect x="4" y="4" width="24" height="24" rx="12" fill="${tile}"/>
<text x="16" y="21" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="700" fill="#06080d">${grade}</text>
<text x="36" y="20.5" font-family="${FONT}" font-size="12.5" fill="${t.muted}">Agent Report Card</text>
<text x="${36 + 118}" y="20.5" font-family="${FONT}" font-size="12.5" font-weight="700" fill="${t.fg}">${right}</text>
</svg>
`;
}

/** A larger card with the big letter, score and date. Made to sit in a hero or sidebar. */
export function badgeCardSvg(run: GradingRun | null, theme: BadgeTheme): string {
  const t = THEMES[theme];
  const grade = run?.grade ?? "–";
  const tile = GRADE_TILE[grade] ?? "#5b6275";
  const score = run ? String(run.score) : "–";
  const when = run ? `Graded ${gradedOn(run)}` : "Not graded yet";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="124" viewBox="0 0 300 124" role="img" aria-label="Agent Report Card grade ${grade}, ${score} out of 100">
<rect x=".5" y=".5" width="299" height="123" rx="16" fill="${t.bg}" stroke="${t.line}"/>
<text x="20" y="30" font-family="${FONT}" font-size="10.5" font-weight="700" letter-spacing="1.4" fill="${t.muted}">INDEPENDENTLY GRADED</text>
<rect x="20" y="44" width="60" height="60" rx="14" fill="${tile}"/>
<text x="50" y="88" text-anchor="middle" font-family="${FONT}" font-size="40" font-weight="800" fill="#06080d">${grade}</text>
<text x="96" y="70" font-family="${FONT}" font-size="30" font-weight="800" fill="${t.fg}">${score}<tspan font-size="14" font-weight="500" fill="${t.muted}"> /100</tspan></text>
<text x="96" y="89" font-family="${FONT}" font-size="12.5" fill="${t.fg}">Agent Report Card</text>
<text x="96" y="105" font-family="${FONT}" font-size="11" fill="${t.muted}">${when}</text>
</svg>
`;
}

/** The data the "match my site" widget (public/badge.js) reads. */
export function badgeJson(agent: { id: string; name: string }, run: GradingRun | null, reportUrl: string) {
  return { agent: agent.name, grade: run?.grade ?? null, score: run?.score ?? null, date: run?.date ?? null, provisional: run?.provisional ?? false, report: reportUrl };
}
