import assert from "node:assert/strict";
import test from "node:test";
import { anchorFor, ccdFacts, lastAnchorFor, reportHash, type CcdData } from "../src/lib/concordium";
import { answerLookup, howToGetGraded, lookupIndex, queryKeys } from "../src/lib/lookup";
import { findTrust, trustRecord } from "../src/lib/trust";
import type { AgentConfig, GradingRun } from "../src/lib/types";

const SITE = "https://robd-hub.github.io/agent-report-card";
const NOW = Date.parse("2026-11-21T00:00:00.000Z");
const BADGE = "JyP9YGLug2S48Zqp7H82e";

const agent: AgentConfig = { id: "demo", name: "Demo Agent", description: "Answers.", adapter: "http-json", endpoint: "https://demo.example/api", concordiumBadge: BADGE, tasks: [] } as unknown as AgentConfig;
const run: GradingRun = { date: "2026-11-18T00:00:00.000Z", tasks: [], score: 98, grade: "A", provisional: false, summary: "Fine." } as unknown as GradingRun;

const anchor = (r: GradingRun, tx: string) => ({ runDate: r.date, grade: r.grade, score: r.score, reportHash: reportHash(r), badge: BADGE, tx, anchoredAt: "2026-11-18T01:00:00.000Z" });
const ccd = (anchors: ReturnType<typeof anchor>[]): CcdData => ({
  anchors: { demo: anchors },
  badges: { demo: { badge: BADGE, tokenId: 1256, verified: true, checkedAt: "2026-11-18T01:00:00.000Z" } },
});

test("a badge or a check-badge link finds the agent", () => {
  const index = lookupIndex([agent], () => [run], SITE, NOW, ccd([anchor(run, "a".repeat(64))]));
  for (const q of [BADGE, `https://agent-registry-mcp.concordium.com/v1/check-badge/${BADGE}`]) {
    const r = answerLookup(q, index);
    assert.equal(r.status, "graded", q);
    assert.equal(r.agent?.id, "demo");
    assert.equal(r.concordium?.registryAgentId, 1256);
    assert.equal(r.concordium?.badgeVerified, true);
    assert.equal(r.concordium?.gradeOnChain?.fingerprintMatches, true);
    assert.match(r.concordium!.gradeOnChain!.explorerUrl, /ccdexplorer\.io\/testnet\/transaction\/a{64}$/);
  }
  assert.equal(answerLookup("Demo Agent", index).agent?.id, "demo");
  assert.ok(queryKeys(BADGE).includes(`badge:${BADGE}`));
});

test("an edited run doesn't count as on-chain until it is written again", () => {
  const old = anchor(run, "b".repeat(64));
  const edited = { ...run, summary: "Fine, with prompts filled in." } as GradingRun;
  const data = ccd([old]);
  assert.equal(anchorFor("demo", edited, data), null);
  assert.equal(lastAnchorFor("demo", edited, data)?.tx, old.tx);
  const r = lookupIndex([agent], () => [edited], SITE, NOW, data).agents[0];
  assert.equal(r.concordium?.gradeOnChain?.fingerprintMatches, false);
  // The trust record only shows a record that matches.
  assert.equal(trustRecord(agent, [edited], SITE, ccdFacts("demo", [edited], data)).concordium?.gradeOnChain, undefined);
  const fresh = anchor(edited, "c".repeat(64));
  data.anchors.demo.push(fresh);
  assert.equal(anchorFor("demo", edited, data)?.tx, fresh.tx);
  assert.equal(trustRecord(agent, [edited], SITE, ccdFacts("demo", [edited], data)).concordium?.gradeOnChain?.tx, fresh.tx);
});

test("trust check finds an agent by badge", () => {
  const rec = trustRecord(agent, [run], SITE, ccdFacts("demo", [run], ccd([anchor(run, "d".repeat(64))])));
  assert.equal(findTrust(BADGE, [rec])?.agent.id, "demo");
  assert.equal(rec.concordium?.registryAgentId, 1256);
});

test("how to get graded lists CCD and the badge offer", () => {
  const g = howToGetGraded();
  assert.equal(g.concordium.priceCcd, 10);
  assert.equal(g.concordium.regradeCcd, 5);
  assert.match(g.concordium.freeForBadges, /free/);
});

