# Agent Report Card

Guidance for Cursor and other coding agents. When this file and the code differ, follow the code and update this file.

## What this is

Agent Report Card grades AI agents A to F, publishes a report, and offers an embeddable badge. The aim is a best-in-class grader that keeps improving and, in time, runs as a commercial product.

Rob Doughty (GitHub [robd-hub](https://github.com/robd-hub)) built it for [SERV Hackathon 02](https://www.openserv.ai/hackathon-2), Reppo track. The API and paid site is [grader.designimp.com](https://grader.designimp.com) (Vercel). The static leaderboard is [robd-hub.github.io/agent-report-card](https://robd-hub.github.io/agent-report-card/). Some cards still name `agent-report-card.vercel.app`. The X account published in the site is [@agentreportcard](https://x.com/agentreportcard) (`X_URL` in `src/lib/links.ts`, `twitter.site` in `src/app/layout.tsx`). The account is being rebranded to @robdev. Leave the handle in code as it is unless asked to change it.

## Architecture

Next.js 15 App Router (`src/app/`), React 19, TypeScript. `next.config.mjs` builds two ways:

- **GitHub Pages.** Static export (`output: "export"`) into `out/`. The publish workflow sets `BASE_PATH` to `/agent-report-card`. No server routes and no API keys in that build.
- **Vercel.** With `VERCEL` set, `scripts/prepare-server.ts` writes gitignored route files that re-export `src/server/*`, and writes `src/middleware.ts`. `skipTrailingSlashRedirect` is on. `src/lib/slashPolicy.ts` lets `/api/mcp`, `/api/lookup`, `/api/agents` and `/api/badge` answer with or without a trailing slash. Other extension-less paths gain one.

Pages: `/`, `/agents/[id]`, `/top/[category]`, `/how-grading-works`, `/for-agents`, `/trust-check`, `/drift-watch`, `/grader-test`, `/request`, `/paid`. Grading logic is `src/lib/`. HTTP handlers are `src/server/`. Edit those, not a generated `route.ts`.

## Grading

The catalogue is `data/agents.json`. `src/lib/adapters.ts` calls an agent by its `adapter`: `openserv-marketplace` (`src/lib/openserv.ts`), `openai-compatible`, `http-json` (POST `{"prompt":"..."}`), `virtuals-acp` (`src/lib/acp.ts`), or `mcp` (`src/lib/mcpClient.ts`: streamable HTTP or the older SSE transport; lists tools, lets SERV pick a read-only tool and arguments per task, up to `MAX_TOOL_CALLS`, and grades the tools' own output; `mcpTool` pins one tool). `findEndpoint` in `src/lib/requests.ts` treats an address as MCP by `looksLikeMcpUrl` or an `mcp:` prefix, and `probeMcp` checks it before payment in `/api/request` (`check`) and `/api/grade`. MCP agents get core tasks only and no standard honesty tasks. `isPublicHttpsUrl` refuses local and private addresses. Count agents and adapters from `data/agents.json`. Do not copy the README table.

`npm run grade` runs `scripts/grade.ts` (`NODE_USE_ENV_PROXY=1`):

- No flag grades every agent. `npm run grade -- <id>` grades one. `--refresh` steps the Reppo queue once. `--watch` steps it until every grade is final (20 seconds between steps). `--rebuild` recomputes the latest run from saved answers. `--disagreements` lists gaps and calls no APIs.
- An agent's tasks run side by side, with one retry after 10 seconds. A run that missed a task is not saved.
- SERV Reasoning checks each answer (`src/lib/serv.ts`, `https://inference-api.openserv.ai/v1/chat/completions`, model `SERV_MODEL` or `gpt-5.4-mini`). Reppo's evaluators score it (`src/lib/reppo.ts`, default `https://eval.reppo.xyz/api/v1`). At most `MAX_IN_FLIGHT` (5) Reppo evaluations are pending. One Reppo retry follows an error, unless the account is out of credits. With no keys, nothing is scored and no result is invented.
- `taskScore` in `src/lib/grade.ts` is `REPPO_WEIGHT` (0.7) times Reppo plus 0.3 times SERV. The run score is the mean of task scores, rounded. Letters (`letterGrade`): A from 90, B from 80, C from 70, D from 60, otherwise F. `provisional` stays true until every task has `reppo.status === "done"`.
- Both judges receive `SCORING_RULES`. A clear length or format break (more than about 10% over, or the wrong format) scores below 50. An invented fact, figure or source is a major error. With no length limit, length alone is not a penalty.
- Honesty tasks are `refuse-unknown` and `near-miss`, shown apart from the grade. `honestyCheck` fails if any of them scores under 70. Older runs may only have the first.
- `DISAGREEMENT_GAP` is 40. A gap that wide flags the task, and a third judge (`settleSplit` in `src/lib/tiebreak.ts`, model `TIEBREAK_MODEL`, default `gemini-3.1-pro-preview`) scores the saved answer into `TaskResult.tiebreak`. The task then scores the median of the three (`taskScore`). `scripts/grade.ts` does this when Reppo finishes; `npx tsx scripts/tiebreak.ts` settles older runs and recomputes their score and letter.
- Answer shape (`src/lib/shape.ts`) reports whether the answer comes first (a closing `Answer:` line counts, for work-first answers to sums), a length score, and padding. It does not change the grade. Only tasks saved with `answerKeys` or `wordBudget` are checked.
- A full new grade has `FULL_GRADE_TASKS` tasks in the mix `FULL_GRADE_MIX` (`src/lib/taskKinds.ts`). Older runs are shorter. A regrade reuses the agent's existing tasks (`scripts/auto-grade.ts`).

Each report is `data/results/<agentId>.json`: `{ agentId, runs }`, oldest first (`src/lib/types.ts`, `src/lib/data.ts`). `ARC_DATA_DIR` points scripts at another folder. The grader test uses `data/calibration` through `npx tsx scripts/calibrate.ts`.

## Lite Check (free, for Agent Parrot)

`src/lib/lite.ts` (`runLite`) is a quick, free check, not a grade: a band (`strong` from an average of `BAND_FROM.strong` 80, `mixed` from 60, else `weak`, or `couldnt-check`), a list of checks and up to two findings (things to fix; a task scoring 90 or more is never one). A failed honesty task (under 70) caps the band at `mixed`. It never calls Reppo or the tiebreak judge and saves nothing to `data/`.

- Agents that answer prompts get three tasks: one core task SERV writes for it, one from `LITE_FORMAT_POOL` and one from `LITE_HONESTY_POOL` (lite-only, never the paid grade's tasks; picked by `pickFromPool` from the address and month). Free checks: answers, https, response time, answer shape (`src/lib/shape.ts`).
- MCP servers: connect and `tools/list`, tool descriptions, input schemas, tool powers (`isSafeTool`), a bad call (a read-only tool with a required field called with `{}`), then one real call SERV picks (`nextCall`) and judges.
- Caps: `LITE_MAX_SERV_CALLS` (5: one task writer with one retry, three judges), `LITE_MAX_TOKENS` (4,000 per reply, through `servChat`'s `maxTokens`; SERV's reasoning counts towards it, and 1,000 left replies empty), `LITE_AGENT_TIMEOUT_MS` (20 seconds, one try), `LITE_MAX_ANSWER_CHARS` (8,000). The cost estimate uses SERV's reported tokens and `LITE_USD_PER_MTOK_IN` / `LITE_USD_PER_MTOK_OUT` (defaults 0.75 and 4.5 are placeholders, not SERV's price list).
- `POST /api/lite/` (`src/server/lite.ts`, Vercel only, `maxDuration` 60) needs `Authorization: Bearer <LITE_SECRET>` (16+ characters) and `SERV_API_KEY`; `LITE_ENABLED=0` switches it off. Agent Parrot does sign-in, per-agent and per-member limits and the monthly budget. OpenServ marketplace links are refused for now.
- `npm run lite -- <agent id | https address "what it does" | --all>` tries it; `--all` compares each graded agent's band with its real letter (`bandOfLetter`).

## Data on disk

Committed JSON, not a database:

| Path | Contents |
| --- | --- |
| `data/agents.json` | Agents, tasks, adapters |
| `data/results/<id>.json` | Grading runs |
| `data/replies.json` | Builders' replies on report pages (`src/lib/replies.ts`) |
| `data/payments.json` | Payments already used |
| `data/concordium.json` | On-chain grade records |
| `data/openserv-workflows.json` | Marketplace workflow ids |
| `data/acp-jobs.json` | Virtuals ACP jobs |
| `data/calibration/` | Grader-test agents and results |

`scripts/badges.ts` (also `prebuild`, and the start of `npm run dev`) writes gitignored `public/badge/`, `public/trust/`, `public/best/` and `public/lookup/` from `data/`. Prices are constants: `GRADE_PRICE_USD` and `REGRADE_PRICE_USD` in `src/lib/links.ts`, CCD prices in `src/lib/concordium.ts`. Read them. Do not retype scores from the README.

## MCP and other reads

Remote MCP is `POST /api/mcp` (`src/server/mcp.ts`, protocol logic in `src/lib/mcp.ts`). Stateless JSON-RPC, no API key, read-only. Tools: `lookup_agent_grade`, `search_graded_agents`, `how_to_get_graded`. `.mcp.json` and `server.json` point at `https://grader.designimp.com/api/mcp`. The rate limit is `LIMITS.mcp` in `src/server/http.ts` (120 a minute). The body cap is `MAX_BODY` in `src/server/mcp.ts` (100,000 bytes). A GET that asks for `text/event-stream` returns 405. The server does not hold a stream open.

Stdio, no dependencies: `node mcp/server.mjs` (package bin `agent-report-card-mcp`). It reads `https://robd-hub.github.io/agent-report-card/lookup/index.json`, or `ARC_LOOKUP_FILE` / `ARC_LOOKUP_URL`.

The same grades are also `GET /api/lookup`, `GET /api/agents`, static `/lookup/<id>.json`, Trust Check (`src/lib/trust.ts`, `GET /api/trust`, `/trust-check`), who's best (`GET /api/best`, `/top/[category]`), Drift Watch (`src/lib/drift.ts`, `POST /api/drift` on Vercel), and badges (`/badge/<id>.svg`, and on Vercel `GET /api/badge`).

OpenServ marketplace tools are separate (`src/server/openserv.ts`, Vercel only): `look_up_grade`, `list_top_agents`, `how_to_get_graded`. Setup is [OPENSERV.md](OPENSERV.md). Paid ordering is `POST /api/grade` (`src/server/grade.ts`, x402), the site form `POST /api/request` (`src/server/request.ts`), and Stripe (`src/server/card.ts`). GitHub Pages does not serve those.

## Run, test, deploy

CI uses Node 22 (`.github/workflows/ci.yml`).

```bash
npm install
cp .env.example .env   # fill keys locally; never commit this file
npm run dev            # http://localhost:3000
npm test               # tsx --test tests/*.test.ts
npm run typecheck      # tsc --noEmit
npm run build          # static Pages build
VERCEL=1 npm run build && npm run check:slash
```

`.env.example` lists `SERV_API_KEY`, `SERV_MODEL`, `REPPO_API_KEY` and `REPPO_API_URL`. Marketplace calls also use `OPENSERV_USER_API_KEY`, falling back to `SERV_API_KEY` (`openservKey` in `src/lib/openserv.ts`). GitHub, Stripe, OpenServ-agent, Concordium and Virtuals secrets live in repository or Vercel settings. `.env` is gitignored. Do not print keys.

Workflows call these scripts with `npx tsx` (or `node` for the key check). npm scripts exist where `package.json` lists them:

- `npm run auto-grade` → `scripts/auto-grade.ts` (paid-request bot; workflow `auto-grade.yml`)
- `npm run openserv` → `scripts/openserv-listing.ts`
- `npx tsx scripts/weekly-grade.ts` (`--finish` only finishes the last grade; workflow `weekly-grade.yml`)
- `npx tsx scripts/concordium.ts` (`status`, `anchor --all`, `verify <agentId>`)
- `npx tsx scripts/calibrate.ts`, `npx tsx scripts/backfill-prompts.ts`
- `npx tsx scripts/acp-seller.ts`, `npx tsx scripts/acp-test-buy.ts`
- `node scripts/acp-key-check.mjs` (prints public keys only)

There is no local deploy command. A push to `main` runs `.github/workflows/pages.yml` (test, typecheck, static build, GitHub Pages). Vercel builds the server copy for grader.designimp.com. `auto-grade.yml` grades issues labelled `grade-request`. `builder-reply.yml` publishes a "Reply to a grade" issue (label `builder-reply`) to `data/replies.json` once the maintainer adds `reply-approved` after checking the builder's link (`scripts/builder-reply.ts`). `weekly-grade.yml` regrades agents with `"schedule": "weekly"` on Mondays at 01:00 UTC. Virtuals workflows are `acp-watch.yml`, `acp-seller.yml`, `acp-test-buy.yml` and `acp-key-check.yml`. The seller and watcher stay off until the variable `ACP_WALLET_ADDRESS` is set.

## Open work

Checked 21 November 2026: GitHub had no open issues and no open pull requests, and the source has no `TODO` or `FIXME`. The repo still marks these as unfinished:

- Public OpenServ listing. The agent and workspace exist. [OPENSERV.md](OPENSERV.md) says to press Submit for review on platform.openserv.ai. The README status leaves this unchecked.
- Card payments are implemented and stay off until `CARD_PAYMENT_LINK` and `CARD_PAYMENT_LINK_REGRADE` are set (`src/lib/links.ts`). The README says to switch on test mode first (`STRIPE_ALLOW_TEST=1`). Test payments are checked and never graded.
- Concordium CCD payments and new on-chain anchors stay off until `CONCORDIUM_ENABLED` is `1` (`ccdEnabledForBot` in `src/lib/concordium.ts`). Records already in `data/concordium.json` still display. The README describes a later move to mainnet.
- Virtuals ACP selling stays off until `ACP_WALLET_ADDRESS` is set (`.github/workflows/acp-seller.yml`).

## Rules

- Take limits and figures from code constants or from files under `data/`, and say which file. Do not retype the README leaderboard or invent a count.
- Never commit secrets, `.env`, `.env.local`, or files that `scripts/prepare-server.ts` generates. Those paths are in `.gitignore`.
- British English is fine.
- Do not save a partial grade, and do not invent a score when a judge key is missing.
