import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { NextRequest } from "next/server";
import { DIRECT_API_PATHS, slashDecision } from "../src/lib/slashPolicy";
import { middleware } from "../src/server/slashMiddleware";

const ORIGIN = "https://grader.designimp.com";

function locationPath(res: Response): string | null {
  const location = res.headers.get("location");
  if (!location) return null;
  return new URL(location).pathname + new URL(location).search;
}

test("the four read endpoints are not redirected, with or without a slash", () => {
  for (const path of DIRECT_API_PATHS) {
    for (const pathname of [path, `${path}/`]) {
      assert.equal(slashDecision(pathname), "next", pathname);
      const res = middleware(new NextRequest(`${ORIGIN}${pathname}?agent=Coder`));
      assert.equal(res.status, 200, pathname);
      assert.equal(res.headers.get("location"), null, pathname);
    }
  }
});

test("report pages gain a slash, and a badge file does not", () => {
  const page = middleware(new NextRequest(`${ORIGIN}/agents/coder`));
  assert.equal(page.status, 308);
  assert.equal(locationPath(page), "/agents/coder/");

  const pageSlash = middleware(new NextRequest(`${ORIGIN}/agents/coder/`));
  assert.equal(pageSlash.headers.get("location"), null);

  const home = middleware(new NextRequest(`${ORIGIN}/for-agents`));
  assert.equal(locationPath(home), "/for-agents/");

  const root = middleware(new NextRequest(`${ORIGIN}/`));
  assert.equal(root.headers.get("location"), null);

  const svg = middleware(new NextRequest(`${ORIGIN}/badge/coder.svg`));
  assert.equal(svg.headers.get("location"), null);

  const svgSlash = middleware(new NextRequest(`${ORIGIN}/badge/coder.svg/`));
  assert.equal(svgSlash.status, 308);
  assert.equal(locationPath(svgSlash), "/badge/coder.svg");

  const dataReq = new NextRequest(`${ORIGIN}/badge/coder.svg/`, { headers: { "x-nextjs-data": "1" } });
  assert.equal(middleware(dataReq).headers.get("location"), null);
});

test("other API routes, including the paid grade endpoint, still gain a slash", () => {
  for (const path of ["/api/grade", "/api/trust", "/api/best", "/api/drift"]) {
    const res = middleware(new NextRequest(`${ORIGIN}${path}?x=1`));
    assert.equal(res.status, 308, path);
    assert.equal(locationPath(res), `${path}/?x=1`, path);
    assert.equal(middleware(new NextRequest(`${ORIGIN}${path}/`)).headers.get("location"), null, path);
  }
});

test(".well-known paths are left alone", () => {
  assert.equal(slashDecision("/.well-known/x402"), "next");
  assert.equal(slashDecision("/.well-known/x402/"), "next");
});

test("the Vercel config skips Next's built-in slash redirect and the static build does not", () => {
  // next.config.mjs reads VERCEL at import time, so each case is a fresh process.
  execFileSync(process.execPath, ["--input-type=module", "-e", `
    process.env.VERCEL = "1";
    const { default: config } = await import("./next.config.mjs");
    if (config.skipTrailingSlashRedirect !== true) throw new Error("vercel skip");
    if (config.output) throw new Error("vercel output " + config.output);
    if (config.trailingSlash !== true) throw new Error("vercel slash");
  `], { encoding: "utf8" });

  execFileSync(process.execPath, ["--input-type=module", "-e", `
    delete process.env.VERCEL;
    const { default: config } = await import("./next.config.mjs");
    if (config.skipTrailingSlashRedirect) throw new Error("static skip");
    if (config.output !== "export") throw new Error("static output " + config.output);
    if (config.trailingSlash !== true) throw new Error("static slash");
  `], { encoding: "utf8" });
});
