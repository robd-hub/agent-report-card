/**
 * Which trailing-slash redirect to apply. Next.js, with trailingSlash on,
 * 308s every extension-less path onto the slashed form, and strips a slash
 * that was added after a file name. MCP clients often do not follow a 308
 * on POST, so four read endpoints answer on both forms.
 *
 * The patterns match the redirects Next.js itself adds in
 * load-custom-routes (the .well-known exception, a dot allowed in any
 * segment but the last, and a file only when the path ends in .ext/).
 */

export const DIRECT_API_PATHS = ["/api/mcp", "/api/lookup", "/api/agents", "/api/badge"] as const;

const DIRECT = new Set<string>(DIRECT_API_PATHS);

/** /badge/coder.svg/ and the same shape. Not /.well-known/... */
const FILE_WITH_SLASH = /^\/(?!\.well-known(?:\/.*)?)(?:[^/]+\/)*[^/]+\.\w+\/$/;

/** /agents/coder and /for-agents. Not a file, not already slashed, not /.well-known. */
const PLAIN_PATH = /^\/(?!\.well-known(?:\/.*)?)(?:[^/]+\/)*[^/.]+$/;

export type SlashDecision = "next" | "redirect-add" | "redirect-strip";

export function slashDecision(pathname: string, headerGet?: (name: string) => string | null): SlashDecision {
  const bare = (pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname).toLowerCase();
  if (DIRECT.has(bare)) return "next";
  if (FILE_WITH_SLASH.test(pathname)) {
    // Same skip as Next's built-in file redirect, for pages-router data requests.
    if (headerGet?.("x-nextjs-data")) return "next";
    return "redirect-strip";
  }
  if (PLAIN_PATH.test(pathname)) return "redirect-add";
  return "next";
}
