import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const MCP_URL = "https://grader.designimp.com/api/mcp";

test("server.json matches the registry shape and the no-slash MCP url", () => {
  const server = JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8"));
  assert.equal(server.$schema, "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json");
  assert.match(server.name, /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
  assert.equal(server.name, "io.github.robd-hub/agent-report-card");
  assert.equal(server.title, "Agent Report Card");
  assert.equal(typeof server.description, "string");
  assert.ok(server.description.length >= 1 && server.description.length <= 100, server.description);
  assert.equal(server.description, "Look up independent A to F grades for AI agents before you hire one.");
  // The registry refuses a version it already has, so bump this with every republish.
  assert.equal(server.version, "0.1.1");
  // mcptry and other directories show this icon. public/ is served from the site root.
  assert.deepEqual(server.icons, [{ src: "https://grader.designimp.com/erc8004/agent-report-card.png", mimeType: "image/png", sizes: ["1000x1000"] }]);
  assert.ok(existsSync(new URL("../public/erc8004/agent-report-card.png", import.meta.url)));
  assert.equal(server.repository.url, "https://github.com/robd-hub/agent-report-card");
  assert.equal(server.repository.source, "github");
  assert.equal(server.websiteUrl, "https://grader.designimp.com/for-agents/");
  assert.equal(server.remotes.length, 1);
  assert.equal(server.remotes[0].type, "streamable-http");
  assert.equal(server.remotes[0].url, MCP_URL);
  assert.match(server.remotes[0].url, /^https?:\/\/[^\s]+$/);
  assert.ok(!server.remotes[0].url.endsWith("/"));
});

test(".mcp.json points Cursor at the same no-slash url", () => {
  const mcp = JSON.parse(readFileSync(new URL("../.mcp.json", import.meta.url), "utf8"));
  assert.equal(mcp.mcpServers["agent-report-card"].url, MCP_URL);
});
