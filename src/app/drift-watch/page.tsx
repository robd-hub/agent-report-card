import Link from "next/link";
import { LENGTH_CHANGE, MIN_PER_WINDOW, RECENT_DAYS } from "@/lib/drift";
import { DriftCheck } from "./DriftCheck";

export const metadata = {
  title: "Drift Watch · Agent Report Card",
  description: "Two free checks on your agent's live answers that need no judge: refusal rate and answer length per kind of task. A jump in either is nearly always something real.",
};

const API = "https://agent-report-card.vercel.app";

export default function DriftWatch() {
  return (
    <main className="prose-page">
      <p><Link href="/" className="back">← All agents</Link></p>
      <div className="kicker">For builders · Free</div>
      <h1>Drift Watch</h1>
      <p className="lead">
        A grade tells you how your agent did on our tasks. It can't see your live traffic, and no judge sits on every real answer. But two
        numbers can be watched on live traffic without judging anything, and a jump in either is nearly always something real.
      </p>

      <DriftCheck />

      <section>
        <h2>The two checks</h2>
        <div className="panel">
          <div className="panel-label">1 · Refusal rate per kind of task</div>
          <p>
            How often the agent says it can't help or doesn't know. A rise on a task it used to answer usually means a tool broke, a source
            went away or the model got more cautious. A fall can mean you fixed something, or that it has started guessing. And zero refusals
            on questions about data is its own warning, because some of those questions should get &quot;I don&apos;t know&quot;.
          </p>
        </div>
        <div className="panel">
          <div className="panel-label">2 · Average answer length per kind of task</div>
          <p>
            It barely moves for months, so a change of {Math.round(LENGTH_CHANGE * 100)}% or more is worth a look. Up and down mean different
            things. Longer is usually a tool returning more, a prompt edit or a model swap. Shorter is flagged louder, because it can be the
            model quietly cutting answers off.
          </p>
        </div>
        <p className="muted small">
          With timestamps we compare the last {RECENT_DAYS} days with everything before. Without them we compare the last third of your rows
          with the rest. We only compare a task once each side has at least {MIN_PER_WINDOW} answers, because on a quiet task a 10 point move can be two
          requests. You can change all three thresholds on the page, or send them as <code className="mono">options</code> to the endpoint. Refusals are spotted from the wording near
          the start of each answer. On the 33 graded answers to our &quot;unknowable revenue&quot; question it caught 25 of the 27 honest
          answers and none of the 6 made-up ones. If you already know which answers were refusals, send <code className="mono">refused</code>{" "}
          and we use that instead.
        </p>
      </section>

      <section>
        <h2>What to send</h2>
        <p>
          One row per answer with a <code className="mono">task</code> (or <code className="mono">type</code>,{" "}
          <code className="mono">category</code>, <code className="mono">route</code>) and the <code className="mono">answer</code> (or{" "}
          <code className="mono">output</code>, <code className="mono">response</code>). Add <code className="mono">time</code> if you have it.
          JSON lines, a JSON array or CSV all work. Don&apos;t want to share the text? Send <code className="mono">length</code> and{" "}
          <code className="mono">refused</code> instead of the answer.
        </p>
      </section>

      <section>
        <h2>From your code</h2>
        <p>The same check as a free endpoint, so you can run it from a nightly job and alert yourself when the status is <code className="mono">alert</code>:</p>
        <pre>{`POST ${API}/api/drift/
{"rows": [{"time": "2026-11-18T09:00:00Z", "task": "price-lookup", "answer": "The price is $42."}, ...],
 "options": {"minPerWindow": 30, "refusalPoints": 0.1, "lengthChange": 0.3}}   (options are optional)

→ {"status": "alert", "tasks": [{"task": "price-lookup",
     "baseline": {"n": 168, "refusalRate": 0.04, "avgLength": 28},
     "recent":   {"n": 42,  "refusalRate": 0.62, "avgLength": 28},
     "flags": [{"kind": "refusals-up", "message": "Refusals rose from 4% to 62%. ..."}]}]}`}</pre>
        <p className="muted small">Up to 20,000 rows a request. We don&apos;t keep anything you send.</p>
      </section>

      <section>
        <h2>Then get graded</h2>
        <p>
          Drift Watch tells you something changed. A <Link href="/#get-graded">regrade</Link> tells you whether the change made the agent
          better or worse, with independent judges scoring the answers.
        </p>
      </section>
    </main>
  );
}
