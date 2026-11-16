# Listing on OpenServ, ERC-8004 and x402 directories

How Agent Report Card (and Cheap First, which shares the setup script here)
are listed where other agents and builders look for them.

## 1. OpenServ marketplace agent

The site answers as an OpenServ agent at
`https://agent-report-card.vercel.app/openserv/` (Vercel only; see
`src/server/openserv.ts` and `src/lib/openservAgent.ts`). Its tools only read
the published grades, so it costs nothing to run:

| Tool | What it does |
| --- | --- |
| `look_up_grade` | An agent's grade, score, honesty check, summary and report link, by name, marketplace number or link |
| `list_top_agents` | The best graded agents, optionally for a topic |
| `how_to_get_graded` | What a grade tests, the price, and how to request and pay |

The trailing slash in the endpoint matters: the site adds one to every path.

Vercel settings (Production):

- `OPENSERV_API_KEY`: the agent's secret key (platform.openserv.ai > Developer > Your Agents > Agent Report Card > Create Secret Key). Needed so the agent can hand tasks back to OpenServ's runtime.
- `OPENSERV_AUTH_TOKEN` (optional): when set, only requests from OpenServ are served.

The agent (4962) and its workspace (14086) were created with
`npm run openserv -- provision arc`. To list it publicly, open the agent on
platform.openserv.ai and press **Submit for review**.

The workspace also has a paid x402 trigger, "Agent grade lookup" ($0.01).
OpenServ sends those payments to the workspace's own wallet
(`0xb5E416Eb5b03B33Bd748D524dB83F6e752c03076`), not to the site's pay address.

## 2. ERC-8004 identity on Base

The agent cards live at `public/erc8004/<name>.json`, served by GitHub Pages
(`npm run openserv -- card arc` rebuilds one). Serving them from the site
instead of IPFS means they can be updated with a commit, with no new
transaction.

To register, open
`https://robd-hub.github.io/agent-report-card/erc8004/register.html` in the
browser with MetaMask, connect, and press Register once per agent. It calls
`register(agentURI)` on the official Identity Registry
(`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`) and shows the agent number. Then
record it on OpenServ:

```bash
npm run openserv -- saved arc <txHash> <agentNumber>
```

## 3. x402 directories

`POST /api/grade/` answers a request without payment with a 402 before
checking the body, in both x402 versions: a version 1 JSON body, plus a
version 2 `PAYMENT-REQUIRED` header carrying the "bazaar" discovery extension
(the request body as a JSON Schema plus an example). It accepts payment in
either `X-PAYMENT` (v1) or `PAYMENT-SIGNATURE` (v2). `/.well-known/x402` lists
the endpoint.

- **x402scan** (x402scan.com): lists only v2 endpoints. Add
  `https://agent-report-card.vercel.app/api/grade/` with "Register This URL
  Only", or add the site and let it read `/.well-known/x402`.
- **PayAI and other facilitator catalogues**: built from the bazaar extension
  when a payment settles through the facilitator, so the endpoint appears
  after its first paid grade.
