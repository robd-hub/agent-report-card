import { latestRun, loadReport } from "@/lib/data";

const COLORS: Record<string, string> = { A: "#1f8a4c", B: "#4f8a1f", C: "#b08900", D: "#c2620f", F: "#c0362c" };

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = latestRun(loadReport(id));
  const grade = run?.grade ?? "N/A";
  const color = COLORS[grade] ?? "#8a8a85";
  const label = run?.provisional ? "Report Card (provisional)" : "Report Card";
  const lw = label.length * 7 + 16;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + 44}" height="22" role="img" aria-label="${label}: ${grade}">
<rect width="${lw}" height="22" rx="4" fill="#33332f"/><rect x="${lw - 4}" width="48" height="22" rx="4" fill="${color}"/>
<text x="8" y="15" fill="#fff" font-family="Verdana,sans-serif" font-size="11">${label}</text>
<text x="${lw + 14}" y="15" fill="#fff" font-family="Verdana,sans-serif" font-size="12" font-weight="bold">${grade}</text></svg>`;
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" } });
}
