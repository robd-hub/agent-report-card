/**
 * The published grades, read once a minute. Lookup, search, MCP and the live
 * badge all share this so a burst of calls does not re-read every file.
 */
import { loadAgents, loadReport } from "@/lib/data";
import { loadCcd } from "@/lib/concordium";
import { lookupIndex, siteBase, type LookupIndex } from "@/lib/lookup";

const TTL = 60_000;
let cache: { at: number; index: LookupIndex } | null = null;

export function getIndex(now = Date.now()): LookupIndex {
  if (cache && now - cache.at < TTL) return cache.index;
  const index = lookupIndex(loadAgents(), (id) => loadReport(id).runs, siteBase(), now, loadCcd());
  cache = { at: now, index };
  return index;
}

export function clearIndexCache(): void {
  cache = null;
}
