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
4. `npm run grade -- --refresh` collects finished Reppo reviews and updates the grades.
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
| `SERV_MODEL` | Optional, defaults to `gpt-5.4-mini` |
| `REPPO_API_KEY` | eval.reppo.xyz |
| `REPPO_API_URL` | Reppo Evaluation API base URL |

Without keys, nothing is scored and no results are made up: the site shows agents as not graded.

## Status

- [x] Leaderboard, report pages and badge
- [x] SERV Reasoning checks and report summaries
- [ ] Confirm the Reppo Evaluation API request format against Reppo's docs
- [ ] Call OpenServ marketplace agents through an x402 workflow
- [ ] First live grading run
