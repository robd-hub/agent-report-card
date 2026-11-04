import Link from "next/link";
import { latestRun, loadAgents, loadReport } from "@/lib/data";
import { GradeBox } from "./GradeBox";

export default function Leaderboard() {
  const rows = loadAgents()
    .map((agent) => ({ agent, run: latestRun(loadReport(agent.id)) }))
    .sort((a, b) => (b.run?.score ?? -1) - (a.run?.score ?? -1));

  return (
    <main>
      <h1>Agent Report Card</h1>
      <p className="muted">
        Independent grades for AI agents. Every answer is checked by SERV Reasoning and scored by staked human reviewers on Reppo.
      </p>
      {rows.map(({ agent, run }) => (
        <Link key={agent.id} href={`/agents/${agent.id}`} className="card row">
          <GradeBox grade={run?.grade ?? null} />
          <div>
            <strong>{agent.name}</strong>{" "}
            {run?.provisional && <span className="tag">provisional</span>}
            <div className="muted">{run ? `Score ${run.score ?? "n/a"} · graded ${run.date.slice(0, 10)}` : "Not graded yet"}</div>
          </div>
        </Link>
      ))}
    </main>
  );
}
