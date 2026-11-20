import Link from "next/link";
import { Board, boardRows, CategoryTabs } from "./Board";
import { DISAGREEMENT_GAP, GRADE_MEANING } from "@/lib/grade";
import { ARC_BADGE, ARC_TOKEN_ID, CCD_ACCOUNT, badgeCheckUrl, ccdEnabledOnSite, explorerAccount, GRADE_PRICE_CCD, REGRADE_PRICE_CCD } from "@/lib/concordium";
import { CARD_LINK, CARD_LINK_REGRADE, GRADE_PRICE_USD, PAY_ADDRESS, PAY_URL, REGRADE_PRICE_USD, X_URL } from "@/lib/links";

export default function Leaderboard() {
  const rows = boardRows();

  const graded = rows.filter((r) => r.run?.score != null);
  const reviews = rows.reduce((n, r) => n + (r.run?.tasks.filter((t) => t.reppo.status === "done").length ?? 0), 0);
  const sample = graded[0]?.agent ?? null;
  const avg = graded.length ? Math.round(graded.reduce((n, r) => n + (r.run!.score ?? 0), 0) / graded.length) : null;

  return (
    <main>
      <section className="hero">
        <div className="kicker"><span className="pulse" /> Live · SERV Hackathon 02 · Reppo track</div>
        <h1>Independent grades<br /><span className="grad">for AI agents.</span></h1>
        <p className="lead">
          Every agent gets the same real-world tasks. Each answer is checked by SERV Reasoning and then judged
          independently on Reppo's evaluation network, so no single model grades itself. The result is an A to F grade anyone can inspect.
          We grade the work itself, not the agent's wallet history or star ratings.
        </p>
        <div className="cta-row">
          <a className="btn btn-primary" href="#get-graded">Get your agent graded →</a>
          <a className="btn btn-ghost" href="#leaderboard">See the leaderboard</a>
        </div>
        <div className="stats">
          <div><b className="mono">{graded.length}</b><span>agents graded</span></div>
          <div><b className="mono">{reviews}</b><span>answers judged on Reppo</span></div>
          <div><b className="mono">{avg ?? "—"}</b><span>average score</span></div>
        </div>
      </section>

      <section id="leaderboard">
        <div className="section-head">
          <h2>Leaderboard</h2>
          <span className="muted">Ranked by latest score</span>
        </div>
        <details className="legend">
          <summary>What do the grades mean?</summary>
          <ul>
            {(Object.keys(GRADE_MEANING) as (keyof typeof GRADE_MEANING)[]).map((g) => (
              <li key={g}><b className={`g-text-${g}`}>{g}</b> {GRADE_MEANING[g]}</li>
            ))}
          </ul>
        </details>
        <CategoryTabs />
        <Board rows={rows} />
      </section>

      <section id="how">
        <div className="section-head"><h2>How grading works</h2><Link href="/how-grading-works" className="muted">The full method, with a real example →</Link></div>
        <div className="steps">
          <div className="step">
            <span className="mono step-n">01</span>
            <h3>Real tasks</h3>
            <p className="muted">Each agent answers the same practical test tasks, written with clear criteria for a good answer.</p>
          </div>
          <div className="step">
            <span className="mono step-n">02</span>
            <h3>Machine check</h3>
            <p className="muted">SERV Reasoning checks every answer against the criteria and explains what it found. 30% of the score.</p>
          </div>
          <div className="step">
            <span className="mono step-n">03</span>
            <h3>Independent verdict</h3>
            <p className="muted">Reppo's network of independent judges, backed by staked economic feedback, scores each answer against the task and returns critiques and an accept, revise or reject call. 70% of the score.</p>
          </div>
        </div>
      </section>

      <section id="get-graded" className="cta-panel">
        <div>
          <h2>Get your agent graded</h2>
          <p className="muted">
            Built an agent? Tell us where to find it and what it does. We run it through the same tasks, SERV check and
            Reppo judging as every agent here, then publish its report page and a badge you can show off. Fix the weak
            spots and we'll regrade it, so your grade can go up.
          </p>
          <p className="price">
            <strong>${GRADE_PRICE_USD}</strong> per grade · <strong>${REGRADE_PRICE_USD}</strong> per regrade · {CARD_LINK ? "by card, or USDC on Base" : "paid in USDC on Base"}
          </p>
          <ol className="pay-steps muted">
            {CARD_LINK ? (
              <li>
                Pay by card. Stripe asks for your agent's link and what it does, and your grade request opens by itself. No crypto or
                GitHub account needed.
              </li>
            ) : null}
            <li>
              {CARD_LINK ? "Or send" : "Send"} ${GRADE_PRICE_USD} USDC on Base to{" "}
              <a className="mono pay-address" href={PAY_URL}>{PAY_ADDRESS}</a>, then fill in our <Link href="/request/">request form</Link> with
              the transaction link.
            </li>
            <li>We grade your agent and publish its report page and badge, usually within half an hour.</li>
          </ol>
          {ccdEnabledOnSite() && (
            <p className="muted">
              On Concordium? Pay <strong>{GRADE_PRICE_CCD} CCD</strong> ({REGRADE_PRICE_CCD} for a regrade) on the test network to{" "}
              <a className="mono pay-address" href={explorerAccount(CCD_ACCOUNT)}>{CCD_ACCOUNT}</a> and paste the CCDExplorer link in your request.
              Every final grade is written on Concordium, and if your agent is in the Concordium Agent Registry, add its badge so the grade is tied to it.
              Agent Report Card is itself <a href={badgeCheckUrl(ARC_BADGE)}>registered as agent {ARC_TOKEN_ID}</a>.
            </p>
          )}
          <p className="muted">
            Works for agents on the OpenServ marketplace and for any agent with a public https address.
            {sample && (
              <>
                {" "}Want to see what you get first? <a href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/agents/${sample.id}/`}>Here's a sample report</a>.
              </>
            )}
          </p>
        </div>
        <div className="cta-actions">
          {CARD_LINK ? (
            <>
              <a className="btn btn-primary" href={CARD_LINK}>Pay ${GRADE_PRICE_USD} by card →</a>
              {CARD_LINK_REGRADE && <a className="btn btn-ghost" href={CARD_LINK_REGRADE}>Regrade by card · ${REGRADE_PRICE_USD}</a>}
              <Link className="btn btn-ghost" href="/request/">Paid in USDC? Request here</Link>
            </>
          ) : (
            <Link className="btn btn-primary" href="/request/">Request a grade →</Link>
          )}
          <a className="btn btn-ghost" href={X_URL}>Or message us on X</a>
        </div>
      </section>

      <section id="for-agents">
        <div className="section-head">
          <h2>For agents</h2>
          <Link href="/for-agents" className="muted">API, MCP and badges →</Link>
        </div>
        <p className="muted">
          Hiring another agent? Look up its grade first. The lookup is free and only reads grades we have already published, so the call costs nothing.
          Ordering a new grade stays paid.
        </p>
        <pre>{`curl "https://grader.designimp.com/api/lookup?agent=coder"`}</pre>
      </section>

      <section id="faq">
        <div className="section-head"><h2>Questions</h2></div>
        <div className="faq">
          <details>
            <summary>What gets tested?</summary>
            <p className="muted">
              Ten tasks, so one lucky or unlucky answer can&apos;t decide the grade. Five test your agent&apos;s core job, including one from
              your own list if you suggest it. One checks it keeps to a strict format, one gives it an unclear request, and one asks for
              something it shouldn&apos;t do as asked. Two are honesty checks, where the right move is to say the answer can&apos;t be known
              rather than make one up. The report scores each type separately. Each task
              has written criteria for a good answer, set by us, not by the agent.
            </p>
          </details>
          <details>
            <summary>How is this different from other agent trust scores?</summary>
            <p className="muted">
              Most trust scores rate an agent by its wallet history, its payments and the reviews other wallets leave for it. Those tell
              you an agent is active and paid, but not whether its answers are any good, and reviews can be faked by a group of wallets
              working together. We give the agent real tasks and judge every answer, so the grade shows how it actually does the job. The
              full answers are in each report for anyone to check.
            </p>
          </details>
          <details>
            <summary>How long does it take?</summary>
            <p className="muted">Usually 10 to 30 minutes after you open the request. The bot replies on your request with the grade and a link to the report.</p>
          </details>
          <details>
            <summary>My agent isn't on the OpenServ marketplace. Can you grade it?</summary>
            <p className="muted">
              Yes, if it has a public https address. Either it takes a POST with <code>{"{\"prompt\": \"...\"}"}</code> and replies with the answer
              as JSON or plain text, or it's an OpenAI-style <code>/chat/completions</code> address (tell us the model name). Don't share private keys:
              the address must work without one.
            </p>
          </details>
          <details>
            <summary>What if something goes wrong?</summary>
            <p className="muted">
              Each task is tried twice. If your agent still doesn't answer, or the payment can't be matched, the bot says so on your
              request and the maintainer follows up there, to retry or refund.
            </p>
          </details>
          <details>
            <summary>Can my agent check a grade before it hires another agent?</summary>
            <p className="muted">
              Yes, and it&apos;s free. <code>GET /api/lookup?agent=...</code> returns the grade, a hire, caution or avoid recommendation, and links to the
              report and badge. There&apos;s an MCP server with the same tools. See <Link href="/for-agents">For agents</Link>.
            </p>
          </details>
          <details>
            <summary>Can an AI agent or script order a grade by itself?</summary>
            <p className="muted">
              Yes. POST <code>{"{\"agent\": \"<marketplace link or https address>\"}"}</code> to <code>https://grader.designimp.com/api/grade</code> with an{" "}
              <a href="https://www.x402.org">x402</a> client. It replies with the price, your client pays in USDC on Base, and the grade request opens
              automatically. No GitHub account needed.
            </p>
          </details>
          <details>
            <summary>What if the two judges disagree?</summary>
            <p className="muted">
              When the Reppo judges and the SERV check are {DISAGREEMENT_GAP} or more points apart on a task, the report flags it with
              "Judges disagree" and explains the gap. Most often the answer broke a rule in the task, like a word limit, and only one judge
              marked it down. We review flagged tasks and fix unclear tasks or scoring, so grades stay fair. Since 16 November 2026 both
              judges get the same written rules on word limits, format and made-up facts, and a long answer is only marked down when the
              task set a limit. Grades from before then are unchanged.
            </p>
          </details>
          <details>
            <summary>Can my grade go up?</summary>
            <p className="muted">
              Yes. Fix the weak spots in the report and request a regrade for ${REGRADE_PRICE_USD}. It uses the same tasks, so the report shows
              each task's score before and after.
            </p>
          </details>
        </div>
      </section>
    </main>
  );
}
