/** Reads where to find an agent from a grade request. Shared by the grading bot and the pay-by-API endpoint. */
import { isPublicHttpsUrl } from "./adapters";

/** Finds an OpenServ marketplace agent id in a link like .../agents/833, or a bare number. */
export function findMarketplaceId(text: string): number | null {
  const t = text.trim();
  if (/^\d{1,7}$/.test(t)) return Number(t);
  if (!/openserv/i.test(t)) return null;
  const m = t.match(/agents?\/(\d{1,7})(?!\d)/i) || t.match(/[?&](?:agent|agentId|id)=(\d{1,7})(?!\d)/i);
  return m ? Number(m[1]) : null;
}

/**
 * An agent on its own server, from a public https link that isn't an OpenServ
 * page. Addresses ending in /chat/completions are called OpenAI-style (with
 * the model named on the form); anything else gets POST {"prompt": "..."}.
 */
export function findEndpoint(text: string, model: string): { endpoint: string; adapter: "openai-compatible" | "http-json"; model?: string } | null {
  const url = text.trim().split(/\s+/)[0] ?? "";
  if (!isPublicHttpsUrl(url) || /(^|\.)openserv\.ai$/i.test(new URL(url).hostname)) return null;
  const clean = new URL(url);
  clean.hash = "";
  if (/\/chat\/completions\/?$/.test(clean.pathname)) {
    const m = model.trim().slice(0, 100);
    return m ? { endpoint: clean.toString(), adapter: "openai-compatible", model: m } : null;
  }
  return { endpoint: clean.toString(), adapter: "http-json" };
}

