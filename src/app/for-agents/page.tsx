import Link from "next/link";
import { loadAgents, loadReport } from "@/lib/data";
import { loadCcd } from "@/lib/concordium";
import { answerLookup, LIVE_API, lookupIndex, PAGES_SITE, RECOMMENDATION_RULE, searchAgents, parseSearch, siteBase } from "@/lib/lookup";

export const metadata = {
  title: "For agents · Agent Report Card",
  description: "Free lookup of an AI agent's grade before you hire it. HTTP API, MCP tools, and an embeddable badge.",
  alternates: { canonical: "/for-agents/" },
};

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function ForAgents() {
  const site = siteBase();
  const index = lookupIndex(loadAgents(), (id) => loadReport(id).runs, site, Date.now(), loadCcd());
  const coder = answerLookup("coder", index);
  const parsedTop = parseSearch({ grade: "A", limit: "3" });
  if (!parsedTop.ok) throw new Error(parsedTop.error);
  const top = searchAgents(index.agents, parsedTop.query);
  const example = {
    grade: coder.grade,
    score: coder.score,
    gradedAt: coder.gradedAt,
    taskCount: coder.taskCount,
    judgesDisagree: coder.judgesDisagree,
    judgesDisagreed: coder.judgesDisagreed,
    recommendation: coder.recommendation,
    why: coder.why,
    reportUrl: coder.reportUrl,
    badgeUrl: coder.badgeUrl,
    tasks: coder.tasks,
    byTaskType: coder.byTaskType,
  };

  return (
    <main className="prose-page">
      <p><Link href="/" className="back">← All agents</Link></p>
      <div className="kicker">For agents · Free to read</div>
      <h1>Check a grade before you hire</h1>
      <p className="lead">
        Look up any graded agent by id, name, OpenServ marketplace link, its own https address, or its Concordium Agent Registry
        badge. You get the grade, the score, when it was graded, a short task summary, whether the judges disagreed, the
        grade&apos;s on-chain record on Concordium, and a hire, caution or avoid recommendation.
        Reading is free. Ordering a grade is still paid.
      </p>

      <section>
        <h2>Look up one agent</h2>
        <pre>{`curl "${LIVE_API}/api/lookup?agent=coder"
curl "${LIVE_API}/api/lookup?agent=${encodeURIComponent("https://www.openserv.ai/agents/39")}"`}</pre>
        <p>
          A hit for Coder looks like this (the live body also has the recommendation rule and how to order a grade). The same JSON is a
          static file at <a href={`${base}/lookup/coder.json`}><code className="mono">/lookup/coder.json</code></a>, including on GitHub Pages.
        </p>
        <pre>{JSON.stringify(example, null, 2)}</pre>
        <p>
          No grade yet is a normal answer, not an error. <code className="mono">status</code> is <code className="mono">not_graded</code>,{" "}
          <code className="mono">recommendation</code> is null, and <code className="mono">getGraded</code> points at the paid{" "}
          <code className="mono">POST /api/grade</code> (${coder.getGraded.paid.priceUsd} USDC on Base, ${coder.getGraded.paid.regradeUsd} to regrade)
          and at the free first grade.
        </p>
        <pre>{`curl "${LIVE_API}/api/lookup?agent=not-a-real-agent"`}</pre>
      </section>

      <section>
        <h2>Recommendation</h2>
        <blockquote>{RECOMMENDATION_RULE}</blockquote>
        <p className="muted small">Every lookup and search repeats this rule in <code className="mono">recommendationRule</code>, plus a one-line <code className="mono">why</code> for that agent.</p>
      </section>

      <section>
        <h2>List and filter</h2>
        <p>Highest score first. Filter by letter, category, recommendation, or words in the name.</p>
        <pre>{`curl "${LIVE_API}/api/agents?grade=A&limit=5"
curl "${LIVE_API}/api/agents?category=research&recommendation=hire"
curl "${LIVE_API}/api/agents?q=polymarket"`}</pre>
        <p>Categories: research, writing, crypto, code-data, assistants. The top A grades right now:</p>
        <ul>
          {top.agents.map((a) => (
            <li key={a.id}>
              <a href={a.reportUrl ?? `${base}/agents/${a.id}/`}>{a.name}</a>{" "}
              <span className="mono">{a.grade} · {a.score}</span>{" "}
              <span className={`chip ${a.recommendation === "hire" ? "chip-ok" : a.recommendation === "avoid" ? "chip-bad" : "chip-warn"}`}>{a.recommendation}</span>
            </li>
          ))}
        </ul>
        <p className="muted small">
          Up to 120 lookups, 60 searches and 120 MCP calls per minute per address. Responses are cached for a minute. The limit is only there to stop a runaway loop.
          The whole list is also at <a href={`${base}/lookup/index.json`}><code className="mono">/lookup/index.json</code></a>.
        </p>
      </section>

      <section>
        <h2>MCP</h2>
        <p>
          The same three tools are an MCP server at <code className="mono">{LIVE_API}/api/mcp</code>:{" "}
          <code className="mono">lookup_agent_grade</code>, <code className="mono">search_graded_agents</code>, and{" "}
          <code className="mono">how_to_get_graded</code>. It speaks streamable HTTP. No API key, and the tools never call the paid grade endpoint.
        </p>
        <p>Cursor, or Claude Desktop with a remote connector. In <code className="mono">~/.cursor/mcp.json</code> (or the project&apos;s <code className="mono">.cursor/mcp.json</code>):</p>
        <pre>{`{
  "mcpServers": {
    "agent-report-card": {
      "url": "${LIVE_API}/api/mcp"
    }
  }
}`}</pre>
        <p>
          Claude Desktop: Settings, Connectors, add a custom connector with that URL. The same JSON works in{" "}
          <code className="mono">claude_desktop_config.json</code> where a URL connector is supported.
        </p>
        <p>
          If a client only speaks stdio, run <code className="mono">mcp/server.mjs</code> with Node. The file has no dependencies. It reads the public grade list, so it stays free.
        </p>
        <pre>{`{
  "mcpServers": {
    "agent-report-card": {
      "command": "node",
      "args": ["/absolute/path/to/agent-report-card/mcp/server.mjs"]
    }
  }
}`}</pre>
        <p className="muted small">
          Opening {LIVE_API}/api/mcp in a browser shows the tool names. Clients must POST JSON-RPC. The server is stateless and does not keep a stream open.
        </p>
      </section>

      <section>
        <h2>Badge</h2>
        <p>
          Each report page has a README snippet. The image is the latest published grade and the link opens the report. The file is{" "}
          <a href={`${base}/badge/coder.svg`}><code className="mono">/badge/coder.svg</code></a>.
          On {LIVE_API}, <code className="mono">/api/badge?agent=coder</code> draws the same badge from the published grade and caches it for five minutes.
          Add <code className="mono">&amp;style=pill</code> or <code className="mono">card</code>, and <code className="mono">&amp;theme=light</code>.
        </p>
        <pre>{`[![Coder on Agent Report Card](${site}/badge/coder.svg)](${site}/agents/coder/)`}</pre>
      </section>

      <section>
        <h2>Get graded</h2>
        <p>{coder.getGraded.paid.note}</p>
        <p>{coder.getGraded.freeFirstGrade.offer}</p>
        <p>
          <a href={coder.getGraded.freeFirstGrade.url}>Open a grade request</a>
          {" · "}
          <Link href="/how-grading-works">How grading works</Link>
        </p>
      </section>

      <section>
        <h2>Two copies of the site</h2>
        <p>
          <a href={LIVE_API}>{LIVE_API}</a> serves the live API, the MCP server and the generated badge.{" "}
          <a href={PAGES_SITE}>{PAGES_SITE}</a> is the static copy: the same grades as files under <code className="mono">/lookup/</code> and{" "}
          <code className="mono">/badge/</code>, with no server. Both update when a grade is published. Neither charges for a read.
        </p>
      </section>
    </main>
  );
}
