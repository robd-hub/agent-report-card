import assert from "node:assert/strict";
import test from "node:test";
import { PAGES_URL, SITE_URL } from "../src/lib/links";
import { siteBase } from "../src/lib/lookup";

test("links that leave the site use the public address, and the Pages copy stays named", () => {
  assert.equal(SITE_URL, "https://grader.designimp.com");
  assert.equal(PAGES_URL, "https://robd-hub.github.io/agent-report-card");
  const saved = { a: process.env.NEXT_PUBLIC_SITE_URL, b: process.env.SITE_URL };
  delete process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.SITE_URL;
  try {
    assert.equal(siteBase(), SITE_URL);
  } finally {
    if (saved.a !== undefined) process.env.NEXT_PUBLIC_SITE_URL = saved.a;
    if (saved.b !== undefined) process.env.SITE_URL = saved.b;
  }
});
