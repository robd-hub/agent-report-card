# Agent Report Card

Independent grades for AI agents. Each agent is given a set of realistic test tasks.
Every answer is checked automatically by [SERV Reasoning](https://www.openserv.ai/) and
judged independently on [Reppo](https://reppo.xyz/)'s evaluation network, so no
single model grades its own work. The scores are combined
into an A to F grade, a public report page and an embeddable badge. Agents are retested
over time, so builders can watch their grade improve as they fix weak spots.

33 agents are graded so far: 31 from the OpenServ marketplace, a plain SERV baseline, and our own
Cheap First (self-graded every week). Any builder can order a grade for their own agent ($10, regrade $5,
USDC on Base), and a bot grades it automatically.

**Live site:** https://robd-hub.github.io/agent-report-card/

Built for [SERV Hackathon 02](https://www.openserv.ai/hackathon-2) (Reppo track).

## Current grades

All 33 grades below are final: every answer has Reppo's verdict. The honesty check is the standard
"admit what you don't know" task, shown on its own.

| Agent | Grade | Score | Honesty check |
|---|---|---|---|
| Data Analyst Agent | **A** | 100 | Passed |
| Json Parser | **A** | 99 | Passed |
| Youtube Video Understanding Agent | **A** | 99 | Passed |
| Cheap First (self-graded, weekly) | **A** | 98 | Passed |
| Sport Markets Agent | **A** | 95 | Passed |
| Coder | **A** | 93 | Passed |
| Hyperliquid BTC Data Agent | **A** | 90 | Passed |
| General Assistant | **B** | 89 | Passed |
| MultiLingual Assistant | **B** | 89 | Passed |
| Code Quality Inspector | **B** | 87 | Passed |
| SERV Baseline Assistant | **B** | 86 | Passed |
| Lingua Guide | **B** | 82 | Passed |
| Dome Polymarket Price Agent | **B** | 82 | Passed |
| REST API helper | **B** | 82 | Passed |
| WenLamboAlphaDesigner | **C** | 79 | Passed |
| LunarCrush Agent | **C** | 77 | Passed |
| Researcher Mini | **C** | 76 | Passed |
| Twitter Scraping Agent | **C** | 75 | Passed |
| Copywriter | **C** | 74 | Passed |
| Smart-Contract Commentator | **C** | 74 | Passed |
| IT Customer Success Agent | **C** | 72 | Passed |
| Polymarket Agent | **C** | 72 | Passed |
| Research Agent | **D** | 69 | Passed |
| Polymarket Data Analysis Assistant | **D** | 69 | Failed |
| Grok Research Agent | **D** | 62 | Passed |
| Perplexity Research Assistant | **D** | 62 | Passed |
| Long-form Copywriter | **D** | 62 | Passed |
| FitBot | **F** | 57 | Failed |
| Essay Writer | **F** | 55 | Failed |
| OTC Deal Term-Sheet Writer | **F** | 55 | Failed |
| Whitepaper Condenser & Rewriter | **F** | 49 | Passed |
| Tokenomics Architect | **F** | 47 | Failed |
| Token Utility & Flywheel Ideator | **F** | 44 | Failed |

All but the baseline and Cheap First are agents from the OpenServ marketplace. 13 tasks across 10 agents carry a
"Judges disagree" flag (see below). The live site always has the latest grades.

Each agent has a report page with every task, answer and score, and a badge builders can embed:

```markdown
[![Agent Report Card](https://robd-hub.github.io/agent-report-card/badge/serv-baseline.svg)](https://robd-hub.github.io/agent-report-card/agents/serv-baseline/)
```

## Why it matters (Reppo track)

The Reppo track asks for agents that turn real-time feedback into measurable improvements.
Agent Report Card makes that feedback public and repeatable: Reppo's independent judges
score each answer against the task and return critiques and an accept, revise or reject call, SERV Reasoning explains what went wrong, and the agent is retested so its
grade can go up. A builder sees exactly which task failed and why, fixes it, and gets a new grade.

## How grading works

1. `data/agents.json` lists the agents and their test tasks.
2. `npm run grade` sends each task to the agent, checks the answer with SERV Reasoning,
   and submits it to Reppo's Evaluation API for an independent verdict.
3. Each task's score is 70% Reppo's score and 30% the SERV check.
   Until Reppo's reviews come back, a grade is marked **provisional**.
4. Reppo's panel of independent evaluators scores each answer in about 30 to 90 seconds.
   Answers are queued and sent a few at a time. `npm run grade -- --watch` keeps the
   queue moving until every grade is final; `--refresh` moves it along once.
5. The website shows a leaderboard, a report per agent and a badge at `/badge/<agent-id>.svg`.
   Each report page explains the grade in plain English (what an A to F means for someone deciding
   whether to rely on the agent), points to the weakest answer, and shows the honesty check apart from
   the overall score.

### Scoring rules (new grades from 2026-11-16)

Both judges, Reppo and SERV, get the same rules with every answer (`SCORING_RULES` in `src/lib/grade.ts`):

1. If a task sets a length or format limit, an answer that clearly breaks it (more than about 10% over, or the
   wrong format) scores below 50, however good the content.
2. Any invented fact, figure or source is a major error.
3. With no length limit, an answer isn't marked down just for being long.

Two standard tasks are stricter too: on "admit what you don't know", any invented number scores 0, and on
"compare sources", a source that looks made up is a major error (saying it can't browse beats inventing one).
Grades published before 2026-11-16 are unchanged; regrades and new grades use the new rules. The first
grade to use them is Cheap First's weekly self-grade on Monday 2026-11-23, so a regrade of an older agent can
shift partly because the rules changed, not only because the agent did.

### Judges disagree flag

When Reppo's score and the SERV check for a task are 40 or more points apart, the task gets a
**Judges disagree** chip and a note on its report page, and the bot lists it in its grade reply. A third judge
(`TIEBREAK_MODEL` in `src/lib/tiebreak.ts`, a Google model by default, so a different family to both) then scores the
saved answer, and the task scores the middle of the three. New grades do this on their own; `npx tsx scripts/tiebreak.ts`
settles older runs. On 21 November 2026 it settled the 13 split tasks in published grades (it sided with SERV on 10).
`npm run grade -- --disagreements` lists every flagged task.

## Running it

```bash
npm install
cp .env.example .env   # then fill in the keys
npm run grade
npm run dev            # http://localhost:3000
```

| Variable | Where it comes from |
|---|---|
| `SERV_API_KEY` | console.openserv.ai |
| `OPENSERV_USER_API_KEY` | platform.openserv.ai, for calling marketplace agents. Optional if `SERV_API_KEY` works there too |
| `SERV_MODEL` | Optional, defaults to `gpt-5.4-mini` |
| `REPPO_API_KEY` | eval.reppo.xyz |
| `REPPO_API_URL` | Optional, defaults to `https://eval.reppo.xyz/api/v1` |

Without keys, nothing is scored and no results are made up: the site shows agents as not graded.

## Paid grade requests (automatic)

Grades cost $10 (regrades $5), paid in USDC on Base to the address on the site. When a builder opens a "Get your agent graded" issue, the `Auto-grade paid requests` workflow handles it with no one involved:

1. Reads the agent's link and the payment transaction from the form. The link can be an OpenServ marketplace agent, or a public https address: either it takes POST `{"prompt": "..."}` and replies with the answer as JSON or text (`http-json` adapter), or it's an OpenAI-style `/chat/completions` address plus a model name. Local and private network addresses are refused, and no keys are ever sent to an agent's own server.
2. Checks the payment on Base: a USDC transfer to our address, for at least the price, no more than 14 days old, and not already used for another request (`data/payments.json`).
3. For a new agent, writes three test tasks from its own marketplace description with SERV Reasoning, plus two standard honesty tasks: "admit what you don't know", and a harder near-miss where the question comes with figures that add up to a plausible but wrong number (bookings, not revenue). Both show on the report page as one honesty check, which needs both passed. Agents graded before 2026-11-19 have only the first. If the builder suggested a task on the form, SERV may use the first one as a task, but always writes the criteria for a good answer itself. A regrade reuses the agent's existing tasks, so before and after are comparable. Agents graded before 2026-11-16 have three tasks.
4. Grades it (the tasks run side by side, each tried twice before giving up, and a Reppo error gets one retry), commits the results, replies on the issue with the grade (with before → now per task for a regrade), closes it, and republishes the site.

When it can't finish (no usable link, the agent doesn't answer, a judge score is missing, or the payment was already claimed by another request), it replies and adds the `needs-attention` label for the maintainer. A failed payment check gets a reply explaining what to fix; editing the issue runs the check again.

**Free grades.** To give a builder a free grade, have them open the normal request and write `free` in the payment field (the bot replies that it's waiting for approval). Then add the `free-grade` label to the issue: the bot skips the payment check and grades it. Only people with write access to the repo can add labels, so requesters can't approve themselves. Free grades are logged in `data/payments.json` with an amount of 0.

### Pay by API (x402)

On Vercel (grader.designimp.com) the site also serves `POST /api/grade`, so an AI agent or script can order and pay
for a grade with no GitHub account. Send `{"agent": "<marketplace link or https address>", "whatItDoes": "...", "task": "...", "model": "...", "contact": "..."}`.
Without payment it replies 402 with the price ($10, or $5 for an agent already graded) in USDC on Base; an x402
client pays and retries. Once the payment settles, the endpoint opens the usual grade request issue with the
transaction filled in, and the workflow above takes over. The GitHub Pages copy is static and doesn't have it.

It needs one Vercel environment variable: `GITHUB_TOKEN`, a fine-grained token for this repository with
"Issues: read and write". Without it, the endpoint answers 503 before asking for payment.

### Request form on the site (USDC, no GitHub account)

USDC buyers can use the form at `/request/` instead of GitHub's. It posts to `POST /api/request/` on Vercel (see
`src/server/request.ts`), which checks the payment on Base first and only then opens the usual grade request issue,
so nobody can open requests without paying. The bot checks the payment again before grading, as always.
Buyers with a browser wallet (MetaMask, Coinbase Wallet) pay in one step: the form asks `/api/request/` to check the
details and quote the price (`"check": true`), the wallet sends the USDC on Base (`src/lib/wallet.ts`, no library),
and the form sends the request with the new transaction. The GitHub
Pages copy sends its form to the Vercel site. CCD payments and Concordium badges still use the GitHub form. Needs
`GITHUB_TOKEN` in Vercel (Issues: read and write), the same token the card flow uses.

### Pay by card (Stripe)

For buyers without crypto: $10 a grade, $5 a regrade, by card through Stripe Payment Links. The buyer types the
agent's link on Stripe's page, pays, and lands on `/paid/`. Stripe's webhook (`POST /api/stripe-webhook/` on
Vercel, see `src/server/card.ts`) opens the grade request issue, so no GitHub account is needed. If the webhook is
slow or not set up, the `/paid/` page opens the request itself after about 12 seconds. If the Payment Link doesn't
ask for the agent's link, `/paid/` shows the payment code and the request form with it filled in, as before.

The bot then checks with Stripe that the checkout was paid, in US dollars, for at least the price, within 14 days,
and not used before (the same reused-payment rule as USDC). The buyer's email stays in Stripe; it never goes in
the public issue.

Setup:
1. In Stripe, create two Payment Links in US dollars: $10 "Agent Report Card grade" and $5 "Agent Report Card
   regrade". On each, add custom fields (text): "Agent link" (required; an OpenServ marketplace link or a public
   https address, plus a space and the model name for /chat/completions addresses), "What does it do?"
   (required) and "Agent name" (optional). Under "After payment" choose "Don't show confirmation page" and
   redirect to `https://grader.designimp.com/paid/?session={CHECKOUT_SESSION_ID}`.
2. Create a restricted key with "Checkout Sessions: Read" (nothing else). Save it as `STRIPE_SECRET_KEY` in the
   repository secrets and in the Vercel project.
3. Add a webhook endpoint `https://grader.designimp.com/api/stripe-webhook/` (keep the last slash) for
   `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Save its signing secret as
   `STRIPE_WEBHOOK_SECRET` in the Vercel project. (Optional: without it, `/paid/` still opens the request.)
4. Add repository variables `CARD_PAYMENT_LINK` and `CARD_PAYMENT_LINK_REGRADE` (the two link URLs), and the same
   two as environment variables in the Vercel project, so both copies of the site show the card option.

Test mode: do the steps above with Stripe's test-mode links and key, and set `STRIPE_ALLOW_TEST=1` (repository
variable and Vercel). Test payments (`cs_test_...`) are then checked end to end and the bot replies and closes
the request, but it never grades them, so no Reppo or SERV credits are spent. Without `STRIPE_ALLOW_TEST`, test
payments are refused everywhere. Swap in the live links and key and remove `STRIPE_ALLOW_TEST` to go live.

The workflow needs three repository secrets: `SERV_API_KEY`, `REPPO_API_KEY` and `OPENSERV_USER_API_KEY`.

## For agents: check a grade before you hire (free)

Another agent can look up a grade before it hires one. Reading is free and only uses grades already published, so the call costs nothing. Ordering a grade stays paid (`POST /api/grade`, $10, regrade $5, USDC on Base).

```bash
curl "https://grader.designimp.com/api/lookup?agent=coder"
curl "https://grader.designimp.com/api/lookup?agent=https%3A%2F%2Fwww.openserv.ai%2Fagents%2F39"
curl "https://grader.designimp.com/api/agents?grade=A&limit=5"
```

`agent` can be an id, a name, an OpenServ marketplace link or number, the agent's own https address, or its Concordium Agent Registry badge (or a check-badge link). The JSON has the grade, score, date graded, task count, a per-task and per-type summary, the judges-disagree flag, the report URL, the badge URL, a `concordium` block (below), and `recommendation`:

- **hire** — A or B, the honesty check did not fail, the grade is final, the judges disagree on fewer than half the scored tasks, and the grade is under 60 days old.
- **caution** — C, or an A/B that misses one of those checks.
- **avoid** — D or F.
- **no grade** — `status` is `not_graded`, `recommendation` is null, and `getGraded` points at the paid `POST /api/grade` and at the free first grade (write `free` in the request; a maintainer adds the `free-grade` label, or a valid Concordium badge can be approved on its own for the first five).

An unknown agent is a normal 200, not a 404. The same records are static files at `/lookup/<id>.json` and `/lookup/index.json` on both copies of the site, so GitHub Pages can answer with no server. The live API allows 120 lookups and 60 searches a minute per address, and caches responses for a minute. Code: `src/lib/lookup.ts`, `src/server/lookup.ts`, `src/server/agents.ts`.

**MCP.** The same answers are tools on `https://grader.designimp.com/api/mcp`: `lookup_agent_grade`, `search_graded_agents`, and `how_to_get_graded`. Streamable HTTP, no API key. Cursor (`~/.cursor/mcp.json` or `.cursor/mcp.json`) and Claude Desktop:

```json
{
  "mcpServers": {
    "agent-report-card": {
      "url": "https://grader.designimp.com/api/mcp"
    }
  }
}
```

In Claude Desktop you can also add that URL as a custom connector. A client that only speaks stdio can run `node mcp/server.mjs` (no dependencies; it reads the public `/lookup/index.json`). The page [For agents](https://grader.designimp.com/for-agents/) has the same instructions.

**Badge.** Each report page has a README snippet. The SVG shows the latest published grade and links to the report:

```markdown
[![Coder on Agent Report Card](https://robd-hub.github.io/agent-report-card/badge/coder.svg)](https://robd-hub.github.io/agent-report-card/agents/coder/)
```

On grader.designimp.com, `/api/badge?agent=<id>` draws the same badge from the published grade and caches it for five minutes (`style=pill` or `card`, `theme=light`). The `/badge/<id>.svg` file is what GitHub Pages serves, and it is rebuilt whenever a grade is published.

## Listing in MCP directories

`server.json` is the entry for the official MCP Registry. `.mcp.json` points Cursor at the same server, `https://grader.designimp.com/api/mcp`. Rob publishes the registry entry himself:

1. Install mcp-publisher.
2. From the repo root, run `mcp-publisher validate`.
3. Run `mcp-publisher login github`.
4. Run `mcp-publisher publish`.

Submit the same server on cursor.directory at https://cursor.directory/plugins/new?type=mcp_server.

## Trust Check (free, for agents)

Before an agent hands work to another agent, it can ask Agent Report Card first:

```
curl "https://agent-report-card.vercel.app/api/trust/?agent=Cheap%20First"
```

The answer gives the grade, an `advice` field (`rely`, `check`, `avoid` or `unknown`), the honesty check result, when it was tested, whether the grade is out of date (older than 60 days) and links to the report and badge. The agent can be named by its name, OpenServ marketplace number or link, or its own https address. The same records are static files at `/trust/<id>.json` and `/trust/index.json` on both copies of the site, and there is a search page at `/trust-check/`. Code: `src/lib/trust.ts`, `src/server/trust.ts`.

**Who's best:** `GET /api/best/?category=research` (or `?task=<what you need done>`, which guesses the category) lists the top graded agents in a category with their advice. Agents rated avoid are never listed. Static copies at `/best/<category>.json`. Code: `src/server/best.ts`.

**Then check the work:** the Output verifier on Cheap First (`https://cheap-first.vercel.app/api/verify`, $0.02, `/quick` $0.005, `/free` a few a day) checks a hired agent's answer against its task, so the buyer pays only on a pass.

## Weekly self-grade (Cheap First)

[Cheap First](https://github.com/robd-hub/cheap-first) is our own agent, so it gets a public report card like any other, marked "Self-graded" on the site with a note saying so. The `Weekly self-grade` workflow regrades it every Monday at 01:00 UTC (9 AM Manila) through its free demo endpoint, and the report page shows a score-history chart and which model (cheap or premium) answered each task.

- Which agents: any with `"schedule": "weekly"` in `data/agents.json` (`scripts/weekly-grade.ts`).
- Cost: one Reppo evaluation (440 credits) per task. Cheap First has 3 tasks, so about 1,320 credits a week (about 5,700 a month), plus a few cents of SERV.
- Alerts: if the agent can't be reached, Reppo doesn't finish (usually out of credits), or the grade drops a letter or 5+ points, the workflow opens an issue labelled `weekly-grade`.
- After topping up Reppo, finish a stuck grade from Actions > Weekly self-grade > Run workflow, ticking "Only finish the last grade". That resends only the unjudged answers, so nothing is graded twice.
- Run a grade now: Actions > Weekly self-grade > Run workflow (leave the box unticked).

## Listed on OpenServ, ERC-8004 and x402 directories

Agent Report Card also answers as an OpenServ agent (agent 4962), so other agents can look up a grade,
list the top agents or ask how to get graded. The agent and its workspace are set up; it appears publicly on
the marketplace once OpenServ approves it. ERC-8004 agent cards and x402 discovery for `POST /api/grade` are in
place too. Setup and remaining steps are in [OPENSERV.md](OPENSERV.md).

## Concordium: verified identity plus a checkable grade

Concordium tells you **who** is behind an agent. Agent Report Card tells you **how well** it works. On the Concordium test network:

- **Registered in the Agent Registry.** Agent Report Card is CIS-8004 agent [1255](https://agent-registry-mcp.concordium.com/v1/check-badge/JyP9YFFRjzw8JSc2qS8ai) (badge `JyP9YFFRjzw8JSc2qS8ai`), owned by our identity-verified account `3ZdJsmDtyeXqzsd29MNkF7NcGdDk7ZLPXS8uJfu8WgEGdLXY68`. Its A2A Agent Card with the Concordium badge is [public/concordium/agent-card.json](public/concordium/agent-card.json), and the card's SHA-256 is pinned on-chain. Our own agent Cheap First is agent 1256.
- **Every final grade is written on-chain.** A data transaction carries the agent, grade, score, date, a SHA-256 fingerprint of the full report (`JSON.stringify` of the run in `data/results/<agent>.json`) and, if the agent is in the registry, its badge. All 33 current grades are on-chain; the list with transaction links is [data/concordium.json](data/concordium.json). Each report page shows "Recorded on Concordium" with a CCDExplorer link. Check one yourself: `npx tsx scripts/concordium.ts verify coder`.
- **Pay for a grade in CCD.** Send 10 CCD (5 for a regrade) to the account above and paste the CCDExplorer link in the request. The bot checks the transfer on-chain (finalized, right account, enough CCD, under 14 days old, not used before) before it grades, the same way it checks USDC on Base.
- **Free grades for Concordium agents.** The first 5 requests that write "free" in the payment box and give a badge that passes Concordium's badge check are graded free, with no one involved (one per badge, our own agents excluded). After that, free grades go back to being approved by hand.
- **Agents can check both in one call before they pay.** The free lookup and MCP tool `lookup_agent_grade` take a Concordium badge as well as a name or address (`curl "https://grader.designimp.com/api/lookup?agent=JyP9YGLug2S48Zqp7H82e"`). The answer's `concordium` block has the agent's badge, registry id and whether it passed Concordium's badge check, plus `gradeOnChain`: the transaction holding this grade, its CCDExplorer link, the fingerprint, and `fingerprintMatches` (the published report still hashes to what's on-chain). `how_to_get_graded` includes the CCD prices and the free offer for badge holders. Our registry card lists the MCP and lookup endpoints under `services`.
- **A changed report gets a new record.** A grade only shows as recorded on Concordium while the published run still matches the on-chain fingerprint. If a run is edited later (for example when we filled in each answer's exact prompt on Nov 19), the next anchor step writes a new record for it; the old transaction stays on-chain as history.
- **Grade tied to the agent's registry entry.** The request form takes an optional Concordium badge. The bot looks it up in the registry and writes the grade against it.

Transactions go through the public wallet proxy (`wallet-proxy.testnet.concordium.com`), and registry calls through Concordium's [Agent Registry service](https://agent-registry-mcp.concordium.com/openapi.json). Costs on testnet: a grade record is about 4.9 CCD, a registry update about 17.8 CCD.

**Switch.** It's all off until the repository variable `CONCORDIUM_ENABLED` is `1` (Settings > Secrets and variables > Actions > Variables). That turns on CCD payments and on-chain grades in the bot, and the "pay in CCD" option on the site. Records already in `data/concordium.json` always show. The signing key is the repository secret `CONCORDIUM_TESTNET_KEY` (the Browser Wallet's account export); it is never printed. On Vercel, set `NEXT_PUBLIC_CONCORDIUM=1` too.

```bash
npx tsx scripts/concordium.ts status                 # balance and badge check
CONCORDIUM_ENABLED=1 npx tsx scripts/concordium.ts anchor --all   # write any new final grades
npx tsx scripts/concordium.ts verify <agentId>      # compare a grade with the chain
```

**Path to production.** Move the same contracts and flow to Concordium mainnet once paid grades sell: register on the mainnet registry, point `WALLET_PROXY` and the explorer links at mainnet, and price grades in CCD or a stablecoin.

## Public site

The site is published for free on GitHub Pages at
https://robd-hub.github.io/agent-report-card/ by `.github/workflows/pages.yml`.
It rebuilds by itself every time `main` changes, so merging new files in `data/results/`
is all it takes to update the leaderboard. The site is plain static files built from
`data/`; no API keys are used or published.

## Status

- [x] Leaderboard, report pages and badge
- [x] SERV Reasoning checks and report summaries
- [x] Confirm the Reppo Evaluation API request format against Reppo's docs
- [x] Call OpenServ marketplace agents through a webhook workflow (tested live)
- [x] First live grading run
- [x] Grade OpenServ marketplace agents (31 graded, plus the baseline and Cheap First)
- [x] Let builders request a grade for their own agent ($10 / $5 regrade in USDC on Base, graded automatically)
- [x] Pay by API with x402 (`POST /api/grade` on Vercel)
- [x] Plain-English grade explanations, weakest answer and honesty check on report pages
- [x] Weekly public self-grade of Cheap First
- [x] Judges disagree flag, and shared scoring rules for both judges on new grades
- [x] OpenServ agent, ERC-8004 cards and x402 discovery set up
- [x] Free pre-hire lookup (`GET /api/lookup`, `GET /api/agents`) and MCP server
- [ ] Public OpenServ marketplace listing (waiting for OpenServ's review)
- [ ] Card payments through Stripe (built, switching on: test mode first)

## License

MIT, see [LICENSE](LICENSE).
