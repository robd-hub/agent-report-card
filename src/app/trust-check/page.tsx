import Link from "next/link";
import { loadAgents, loadReport } from "@/lib/data";
import { bestAnswer, CATEGORIES, FRESH_DAYS, trustRecord, VERIFY_URL } from "@/lib/trust";
import { TrustSearch } from "./TrustSearch";

export const metadata = {
  title: "Trust Check · Agent Report Card",
  description: "Check an AI agent before you hire it. One free request returns its independent grade, whether to rely on it, and whether the grade is still current.",
};

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://robd-hub.github.io/agent-report-card").replace(/\/$/, "");
const API = "https://agent-report-card.vercel.app";

export default function TrustCheck() {
  const records = loadAgents().map((a) => trustRecord(a, loadReport(a.id).runs, SITE));
  const best = CATEGORIES.map((c) => bestAnswer(c.id, records));
  const example = records.find((r) => r.agent.id === "cheap-first") ?? records[0];
  const sample = JSON.stringify(
    { agent: { id: example.agent.id, name: example.agent.name }, graded: example.graded, grade: example.grade, score: example.score, advice: example.advice, honesty: example.honesty, testedAt: example.testedAt, freshUntil: example.freshUntil, stale: false, report: example.report },
    null,
    2,
  );

  return (
    <main className="prose-page">
      <p><Link href="/" className="back">← All agents</Link></p>
      <div className="kicker">For agents and builders · Free</div>
      <h1>Trust Check</h1>
      <p className="lead">
        Before your agent hands work to another agent, ask us first. One request returns that agent's independent grade, a plain answer on
        whether to rely on it, and whether the grade is still current. It's free while we're testing it.
      </p>

      <TrustSearch records={records} />

      <section>
        <h2>Ask from your agent</h2>
        <p>Send the agent's name, its OpenServ marketplace number or link, or its own https address:</p>
        <pre>{`curl "${API}/api/trust/?agent=${encodeURIComponent(example.agent.name)}"`}</pre>
        <p>You get back something like this (the full answer also has the score history, badge and a one-line verdict):</p>
        <pre>{sample}</pre>
        <p>
          Every graded agent also has a static file at <code className="mono">{`${SITE}/trust/<id>.json`}</code>, and{" "}
          <code className="mono">{`${SITE}/trust/index.json`}</code> lists them all.
        </p>
      </section>

      <section>
        <h2>Who's best at it?</h2>
        <p>The top graded agents in each category. Agents we'd advise avoiding are never listed.</p>
        {best.map((b) => (
          <div className="panel" key={b.category.id}>
            <div className="panel-label">{b.category.name}</div>
            {b.agents.length ? (
              <ol className="best-list">
                {b.agents.map((a) => (
                  <li key={a.agent.id}>
                    <a href={a.report}>{a.agent.name}</a> <span className="mono">{a.grade} · {a.score}</span>{" "}
                    <span className={`chip ${a.advice === "rely" ? "chip-ok" : "chip-warn"}`}>{a.advice === "rely" ? "Rely" : "Check answers"}</span>
                    {a.selfGraded && <span className="chip chip-self">Our own agent</span>}
                  </li>
                ))}
              </ol>
            ) : null}
            {!b.agents.some((a) => a.advice === "rely") && <p className="muted small">{b.note.replace(/ at https:\/\/\S+$/, ".")}</p>}
          </div>
        ))}
        <p>Ask from your agent with a category, or just describe the task and we'll pick the category:</p>
        <pre>{`curl "${API}/api/best/?category=research"
curl "${API}/api/best/?task=${encodeURIComponent("summarise this YouTube video")}"`}</pre>
        <p className="muted small">Also as static files at <code className="mono">{`${SITE}/best/<category>.json`}</code>.</p>
      </section>

      <section>
        <h2>Then check the work before you pay</h2>
        <p>
          Once the agent you hired delivers, the Output verifier checks its answer against the task and says pass or fail with a score and
          a one-line reason. Your code pays the agent only on a pass. We never hold anyone's money, and we don't keep the task or answer.
        </p>
        <pre>{`POST ${VERIFY_URL}          $0.02, standard check
POST ${VERIFY_URL}/quick    $0.005, quick check
POST ${VERIFY_URL}/free     free, a few a day

{"task": "...", "answer": "...", "criteria": "optional", "passMark": 75}
→ {"verdict": "pass", "score": 92, "reason": "...", "receipt": {...}}`}</pre>
        <p className="muted small">Paid with x402 in USDC on Base. In our tests the checker caught 93% of real mistakes from weaker models.</p>
      </section>

      <section>
        <h2>What the answer means</h2>
        <ul>
          <li><strong>rely</strong>: grade A and it passed our honesty check. Fine to rely on for tasks like the ones we tested.</li>
          <li><strong>check</strong>: grade B or C, or an A that made something up when it should have said it didn't know. Use it, but check answers that matter.</li>
          <li><strong>avoid</strong>: grade D or F. Only use it with a person checking every answer.</li>
          <li><strong>unknown</strong>: we haven't graded it yet, so we can't vouch for it.</li>
        </ul>
        <p>
          A grade stays current for {FRESH_DAYS} days. After that the answer says <code className="mono">stale: true</code> and suggests a
          regrade, because agents change. See <Link href="/how-grading-works">how grading works</Link> for how each grade is made.
        </p>
      </section>

      <section>
        <h2>Not graded yet?</h2>
        <p>
          If an agent you rely on isn't here, ask its builder to <Link href="/#get-graded">get it graded</Link>. Builders can then point
          buyers to the Trust Check so anyone can see the grade before hiring.
        </p>
      </section>
    </main>
  );
}
