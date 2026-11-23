/** Reads where to find an agent from a grade request. Shared by the grading bot and the pay-by-API endpoint. */
import { isPublicHttpsUrl } from "./adapters";
import type { AgentConfig } from "./types";

/** Finds an OpenServ marketplace agent id in a link like .../agents/833, or a bare number. */
export function findMarketplaceId(text: string): number | null {
  const t = text.trim();
  if (/^\d{1,7}$/.test(t)) return Number(t);
  if (!/openserv/i.test(t)) return null;
  const m = t.match(/agents?\/(\d{1,7})(?!\d)/i) || t.match(/[?&](?:agent|agentId|id)=(\d{1,7})(?!\d)/i);
  return m ? Number(m[1]) : null;
}

/**
 * True for an address that looks like an MCP server: a path part named "mcp",
 * a path ending in /sse, or a host name starting "mcp.".
 */
export function looksLikeMcpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const parts = u.pathname.toLowerCase().split("/").filter(Boolean);
    return parts.includes("mcp") || parts.at(-1) === "sse" || /^mcp\./i.test(u.hostname);
  } catch {
    return false;
  }
}

export interface FoundEndpoint {
  endpoint: string;
  adapter: "openai-compatible" | "http-json" | "mcp";
  model?: string;
}

/**
 * An agent on its own server, from a public https link that isn't an OpenServ
 * page. Addresses ending in /chat/completions are called OpenAI-style (with
 * the model named on the form). MCP servers are found by their address
 * (looksLikeMcpUrl), or by writing "mcp:" before any address. Anything else
 * gets POST {"prompt": "..."}.
 */
export function findEndpoint(text: string, model: string): FoundEndpoint | null {
  const tagged = text.trim().match(/^mcp:\s*(\S+)/i);
  const url = tagged ? tagged[1] : (text.trim().split(/\s+/)[0] ?? "");
  if (!isPublicHttpsUrl(url) || /(^|\.)openserv\.ai$/i.test(new URL(url).hostname)) return null;
  const clean = new URL(url);
  clean.hash = "";
  if (tagged || looksLikeMcpUrl(clean.toString())) return { endpoint: clean.toString(), adapter: "mcp" };
  if (/\/chat\/completions\/?$/.test(clean.pathname)) {
    const m = model.trim().slice(0, 100);
    return m ? { endpoint: clean.toString(), adapter: "openai-compatible", model: m } : null;
  }
  return { endpoint: clean.toString(), adapter: "http-json" };
}


/**
 * When the address given is a graded agent's home page (the bare site, no path),
 * swap in the address we grade that agent on. Someone checking Cheap First will
 * usually paste https://cheap-first.vercel.app/, but the agent answers at
 * /api/ask, and the home page refuses a POST with 405. Matched by host only,
 * and only when exactly one graded agent lives on that host.
 */
export function knownEndpointFor(found: FoundEndpoint, agents: AgentConfig[]): FoundEndpoint {
  if (found.adapter !== "http-json") return found;
  let given: URL;
  try {
    given = new URL(found.endpoint);
  } catch {
    return found;
  }
  if (given.pathname.replace(/\/+$/, "") !== "" || given.search) return found;
  const host = given.hostname.toLowerCase();
  const onHost = agents.filter((a) => {
    if (!a.endpoint || !["http-json", "openai-compatible", "mcp"].includes(a.adapter)) return false;
    try {
      return new URL(a.endpoint).hostname.toLowerCase() === host;
    } catch {
      return false;
    }
  });
  if (onHost.length !== 1) return found;
  const a = onHost[0];
  return { endpoint: a.endpoint!, adapter: a.adapter as FoundEndpoint["adapter"], ...(a.model ? { model: a.model } : {}) };
}
