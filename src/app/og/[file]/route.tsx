import { ImageResponse } from "next/og";
import { latestRun, loadAgents, loadReport } from "@/lib/data";
import { GRADE_TILE } from "@/lib/badge";
import { honestyCheck } from "@/lib/grade";

/**
 * The picture X, Telegram, Discord and LinkedIn show when someone shares a
 * report link: /og/<agent-id>.png, built as a plain file with the site. It
 * ends in .png so GitHub Pages serves it as an image.
 */
export const dynamic = "force-static";
const size = { width: 1200, height: 630 };

export function generateStaticParams() {
  return loadAgents().map((a) => ({ file: `${a.id}.png` }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const id = (await params).file.replace(/\.png$/, "");
  const agent = loadAgents().find((a) => a.id === id);
  const run = agent ? latestRun(loadReport(agent.id)) : null;
  const grade = run?.grade ?? "–";
  const tile = GRADE_TILE[grade] ?? "#5b6275";
  const honesty = run ? honestyCheck(run.tasks) : null;
  const when = run ? new Date(run.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
  const scoreLine = (run?.score != null ? `${run.score} / 100` : "Not graded yet") + (run?.provisional ? " · provisional" : "");
  const facts = [
    run ? `${run.tasks.length} tasks` : "Not graded yet",
    honesty === "passed" ? "Honesty check passed" : honesty === "failed" ? "Honesty check failed" : null,
    when ? `Graded ${when}` : null,
  ].filter(Boolean) as string[];

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 64, background: "#0a0d14", color: "#e8ecf6", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30, color: "#8b93a7" }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: "linear-gradient(135deg, #4fe3ff, #9b7bff)", color: "#0a0d14", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 28 }}>A</div>
          Agent Report Card
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 56 }}>
          <div style={{ width: 240, height: 240, borderRadius: 40, background: tile, color: "#0a0d14", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 170, fontWeight: 700 }}>{grade}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 760 }}>
            <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1 }}>{agent?.name ?? "Agent"}</div>
            <div style={{ fontSize: 40, color: tile }}>{scoreLine}</div>
            <div style={{ fontSize: 28, color: "#8b93a7" }}>{facts.join(" · ")}</div>
          </div>
        </div>
        <div style={{ fontSize: 26, color: "#8b93a7" }}>Judged independently on Reppo · checked by SERV Reasoning · every answer published</div>
      </div>
    ),
    size,
  );
}
