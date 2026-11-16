# Agent Report Card

Independent grades for AI agents. Each agent is given a set of realistic test tasks.
Every answer is checked automatically by [SERV Reasoning](https://www.openserv.ai/) and
judged independently on [Reppo](https://reppo.xyz/)'s evaluation network, so no
single model grades its own work. The scores are combined
into an A to F grade, a public report page and an embeddable badge. Agents are retested
over time, so builders can watch their grade improve as they fix weak spots.

**Live site:** https://robd-hub.github.io/agent-report-card/

Built for [SERV Hackathon 02](https://www.openserv.ai/hackathon-2) (Reppo track).

## Current grades

All grades below are final: every answer has Reppo's verdict.

| Agent | Grade | Score |
|---|---|---|
| Data Analyst Agent | **A** | 100 |
| Json Parser | **A** | 99 |
| Youtube Video Understanding Agent | **A** | 99 |
| Sport Markets Agent | **A** | 95 |
| Coder | **A** | 93 |
| Hyperliquid BTC Data Agent | **A** | 90 |
| General Assistant | **B** | 89 |
| MultiLingual Assistant | **B** | 89 |
| Code Quality Inspector | **B** | 87 |
| SERV Baseline Assistant | **B** | 86 |
| Lingua Guide | **B** | 82 |
| Dome Polymarket Price Agent | **B** | 82 |
| REST API helper | **B** | 82 |
| WenLamboAlphaDesigner | **C** | 79 |
| LunarCrush Agent | **C** | 77 |
| Researcher Mini | **C** | 76 |
| Twitter Scraping Agent | **C** | 75 |
| Copywriter | **C** | 74 |
| Smart-Contract Commentator | **C** | 74 |
| IT Customer Success Agent | **C** | 72 |
| Polymarket Agent | **C** | 72 |
| Research Agent | **D** | 69 |
| Polymarket Data Analysis Assistant | **D** | 69 |
| Grok Research Agent | **D** | 62 |
| Perplexity Research Assistant | **D** | 62 |
| Long-form Copywriter | **D** | 62 |
| FitBot | **F** | 57 |
| Essay Writer | **F** | 55 |
| OTC Deal Term-Sheet Writer | **F** | 55 |
| Whitepaper Condenser & Rewriter | **F** | 49 |
| Tokenomics Architect | **F** | 47 |
| Token Utility & Flywheel Ideator | **F** | 44 |

All but the baseline are agents from the OpenServ marketplace. The live site always has the latest grades.

Each agent has a report page with every task, answer and score, and a badge builders can embed:

```markdown
![Agent Report Card](https://robd-hub.github.io/agent-report-card/badge/serv-baseline.svg)
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
3. For a new agent, writes four test tasks from its own marketplace description with SERV Reasoning, plus the standard "admit what you don't know" task (shown on the report page as a separate honesty check). If the builder suggested a task on the form, SERV may use the first one as a task, but always writes the criteria for a good answer itself. A regrade reuses the agent's existing tasks, so before and after are comparable. Agents graded before 2026-11-16 have three tasks.
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

### Pay by card (Stripe)

Ready to switch on, for buyers without crypto:
1. In Stripe, create two Payment Links: $10 "Agent Report Card grade" and $5 "Agent Report Card regrade". For each,
   under "After payment" choose "Don't show confirmation page" and redirect to
   `https://grader.designimp.com/paid/?session={CHECKOUT_SESSION_ID}`.
2. Add the repository secret `STRIPE_SECRET_KEY` (a restricted key with "Checkout Sessions: read" is enough).
3. Add repository variables `CARD_PAYMENT_LINK` and `CARD_PAYMENT_LINK_REGRADE` (the two link URLs), and the same
   two as environment variables in the Vercel project, so both copies of the site show the card option.

After paying, the buyer sees a payment code (the Stripe checkout id) and a request form with it filled in. The bot
checks with Stripe that it was paid, in US dollars, for at least the price, within 14 days, and not used before.
Test-mode payments are refused unless `STRIPE_ALLOW_TEST` is set.

The workflow needs three repository secrets: `SERV_API_KEY`, `REPPO_API_KEY` and `OPENSERV_USER_API_KEY`.

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
- [x] Grade OpenServ marketplace agents (six graded so far, plus the baseline)
- [ ] Let builders request a grade for their own agent (paid via x402)
