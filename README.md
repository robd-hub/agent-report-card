# Agent Report Card

Independent grades for AI agents. Each agent is given a set of realistic test tasks.
Every answer is checked automatically by [SERV Reasoning](https://www.openserv.ai/) and
scored by staked human reviewers on [Reppo](https://reppo.xyz/). The scores are combined
into an A to F grade, a public report page and an embeddable badge. Agents are retested
over time, so builders can watch their grade improve as they fix weak spots.

Built for SERV Hackathon 02 (Reppo track).

## How grading works

1. `data/agents.json` lists the agents and their test tasks.
2. `npm run grade` sends each task to the agent, checks the answer with SERV Reasoning,
   and submits it to Reppo's Evaluation API for human review.
3. Each task's score is 70% the Reppo reviewers' score and 30% the SERV check.
   Until Reppo's reviews come back, a grade is marked **provisional**.
4. Reppo allows one pending evaluation per account, and each settles after at least
   10 minutes, so answers are queued and sent one at a time.
   `npm run grade -- --watch` keeps the queue moving until every grade is final
   (about 15 minutes per answer); `--refresh` moves it along once.
5. The website shows a leaderboard, a report per agent and a badge at `/badge/<agent-id>`.

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

## Status

- [x] Leaderboard, report pages and badge
- [x] SERV Reasoning checks and report summaries
- [x] Confirm the Reppo Evaluation API request format against Reppo's docs
- [x] Call OpenServ marketplace agents through a webhook workflow (needs `api.openserv.ai` allowed; not yet tested live)
- [ ] First live grading run
