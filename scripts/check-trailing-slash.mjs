/**
 * After a Vercel build (`VERCEL=1 npm run build`), start the server and
 * check the slash behavior: the four read endpoints answer directly, and
 * report pages plus /badge/<id>.svg keep working.
 *
 *   npm run check:slash
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const port = Number(process.env.SLASH_CHECK_PORT || 3456);
const base = `http://127.0.0.1:${port}`;
const rpc = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function assertStatus(label, res, status) {
  if (res.status !== status) {
    fail(`${label}: expected ${status}, got ${res.status} location=${res.headers.get("location") ?? ""}`);
    return false;
  }
  return true;
}

function assertNoRedirect(label, res) {
  if (res.status === 301 || res.status === 302 || res.status === 303 || res.status === 307 || res.status === 308) {
    fail(`${label}: redirect ${res.status} to ${res.headers.get("location")}`);
    return false;
  }
  if (res.headers.get("location")) {
    fail(`${label}: unexpected location ${res.headers.get("location")}`);
    return false;
  }
  return true;
}

/** The built-in Next redirect must not still be in the manifest. Middleware does pages. */
function assertManifest() {
  const manifest = JSON.parse(readFileSync(new URL("../.next/routes-manifest.json", import.meta.url), "utf8"));
  const paths = ["/api/mcp", "/api/lookup", "/api/agents", "/api/badge", "/api/mcp/", "/api/lookup/", "/api/agents/", "/api/badge/"];
  for (const route of manifest.redirects ?? []) {
    let re;
    try {
      re = new RegExp(route.regex);
    } catch {
      continue;
    }
    for (const path of paths) {
      if (re.test(path)) fail(`routes-manifest still redirects ${path}: ${route.regex}`);
    }
  }
}

async function hit(method, path, body, accept = "*/*") {
  return fetch(base + path, {
    method,
    redirect: "manual",
    headers: {
      accept,
      "content-type": "application/json",
      "x-real-ip": "203.0.113.77",
    },
    body,
  });
}

async function waitForServer(child, logs) {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) break;
    try {
      const res = await fetch(`${base}/api/mcp/`, { redirect: "manual" });
      if (res.status) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.error(logs());
  throw new Error("next start did not come up");
}

async function main() {
  assertManifest();
  let log = "";
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, VERCEL: "1" },
  });
  const take = (chunk) => {
    log += chunk.toString();
  };
  child.stdout.on("data", take);
  child.stderr.on("data", take);
  try {
    await waitForServer(child, () => log);

    const direct = [
      ["GET", "/api/mcp", 200],
      ["GET", "/api/mcp/", 200],
      ["POST", "/api/mcp", 200, rpc, "application/json, text/event-stream"],
      ["POST", "/api/mcp/", 200, rpc, "application/json, text/event-stream"],
      ["GET", "/api/mcp", 405, undefined, "text/event-stream"],
      ["GET", "/api/mcp/", 405, undefined, "text/event-stream"],
      ["OPTIONS", "/api/mcp", 204],
      ["OPTIONS", "/api/mcp/", 204],
      ["GET", "/api/lookup?agent=Coder", 200],
      ["GET", "/api/lookup/?agent=Coder", 200],
      ["GET", "/api/agents", 200],
      ["GET", "/api/agents/", 200],
      ["GET", "/api/badge?agent=coder", 200],
      ["GET", "/api/badge/?agent=coder", 200],
    ];
    for (const [method, path, status, body, accept] of direct) {
      const res = await hit(method, path, body, accept);
      const label = `${method} ${path}`;
      if (!assertNoRedirect(label, res)) continue;
      if (!assertStatus(label, res, status)) continue;
      if (path.startsWith("/api/lookup")) {
        const json = await res.json();
        if (json.agent?.id !== "coder") fail(`${label}: expected coder, got ${JSON.stringify(json).slice(0, 200)}`);
      }
      if (path.startsWith("/api/badge")) {
        const type = res.headers.get("content-type") ?? "";
        if (!type.includes("image/svg+xml")) fail(`${label}: content-type ${type}`);
        const svg = await res.text();
        if (!svg.includes("<svg")) fail(`${label}: body is not svg`);
      }
      if (method === "POST" && path.startsWith("/api/mcp")) {
        const json = await res.json();
        const names = (json.result?.tools ?? []).map((tool) => tool.name);
        if (!names.includes("lookup_agent_grade")) fail(`${label}: tools ${names.join(",")}`);
      }
    }

    const lookupPost = await hit("POST", "/api/lookup?agent=Coder", "{}");
    assertNoRedirect("POST /api/lookup?agent=Coder", lookupPost);

    const kept = [
      ["GET", "/for-agents", 308, "/for-agents/"],
      ["GET", "/for-agents/", 200, null],
      ["GET", "/agents/coder", 308, "/agents/coder/"],
      ["GET", "/agents/coder/", 200, null],
      ["GET", "/badge/coder.svg", 200, null],
      ["GET", "/badge/coder.svg/", 308, "/badge/coder.svg"],
      ["GET", "/api/grade", 308, "/api/grade/"],
    ];
    for (const [method, path, status, locationPath] of kept) {
      const res = await hit(method, path);
      const label = `${method} ${path}`;
      if (!assertStatus(label, res, status)) continue;
      if (locationPath) {
        const location = res.headers.get("location") ?? "";
        const pathname = location.startsWith("http") ? new URL(location).pathname : location.split("?")[0];
        if (pathname !== locationPath) fail(`${label}: location ${location}`);
      } else if (res.headers.get("location")) {
        fail(`${label}: unexpected location ${res.headers.get("location")}`);
      }
      if (path === "/badge/coder.svg") {
        const type = res.headers.get("content-type") ?? "";
        if (!type.includes("image/svg+xml")) fail(`${label}: content-type ${type}`);
      }
      if (path === "/agents/coder/") {
        const html = await res.text();
        if (!html.includes("Coder")) fail(`${label}: report page did not render`);
      }
    }
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 5000);
      child.on("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  if (process.exitCode) {
    console.error(log);
    throw new Error("trailing-slash check failed");
  }
  console.log("Trailing-slash check passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
