import assert from "node:assert/strict";
import test from "node:test";
import { badgeCardSvg, badgePillSvg, badgeSvg } from "../src/lib/badge";
import { latestRun, loadReport } from "../src/lib/data";
import { resetRateLimits } from "../src/lib/rateLimit";
import { GET } from "../src/server/badge";
import type { GradingRun } from "../src/lib/types";

const report = "https://robd-hub.github.io/agent-report-card/agents/coder/?from=badge&x=1";

test("badge SVGs show the grade and link to the report", () => {
  const run = latestRun(loadReport("coder"));
  assert.ok(run?.grade);
  for (const svg of [badgeSvg(run, report), badgePillSvg(run, "dark", report), badgeCardSvg(run, "light", report)]) {
    assert.match(svg, new RegExp(run!.grade!));
    assert.match(svg, /href="https:\/\/robd-hub.github.io\/agent-report-card\/agents\/coder\/\?from=badge&amp;x=1"/);
    assert.match(svg, /<svg/);
  }
  const empty = badgeSvg(null, report);
  assert.match(empty, /N\/A/);
  assert.match(empty, /href=/);
});

test("the live badge route returns the latest grade as SVG", async () => {
  resetRateLimits();
  const run = latestRun(loadReport("coder")) as GradingRun;
  const res = await GET(new Request("https://grader.designimp.com/api/badge?agent=coder", { headers: { "x-real-ip": "203.0.113.70" } }));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /image\/svg\+xml/);
  assert.match(res.headers.get("cache-control") ?? "", /max-age=300/);
  const svg = await res.text();
  assert.match(svg, new RegExp(`>${run.grade} ·`));
  assert.match(svg, /\/agents\/coder\//);

  const pill = await GET(new Request("https://grader.designimp.com/api/badge?agent=coder&style=pill&theme=dark", { headers: { "x-real-ip": "203.0.113.71" } }));
  assert.match(await pill.text(), new RegExp(`>${run.grade}<`));

  const missing = await GET(new Request("https://grader.designimp.com/api/badge?agent=not-a-real-agent", { headers: { "x-real-ip": "203.0.113.72" } }));
  assert.equal(missing.status, 200);
  assert.match(await missing.text(), /N\/A/);
});
