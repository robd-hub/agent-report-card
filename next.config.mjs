/**
 * On Vercel the site also runs a small server, for the pay-by-API endpoint
 * (src/server/grade.ts, whose route file scripts/prepare-server.ts writes only
 * there), so the GitHub Pages build stays plain static files.
 */
const onVercel = Boolean(process.env.VERCEL);

/**
 * Elsewhere the site is exported as plain static files (the `out/` folder), so it can be hosted
 * for free on GitHub Pages. BASE_PATH is set by the publish workflow to "/agent-report-card"
 * because GitHub Pages serves the site from https://<owner>.github.io/agent-report-card/.
 *
 * trailingSlash keeps report pages at /agents/<id>/ and leaves /badge/<id>.svg
 * alone. On Vercel that setting also 308s every other URL onto the slashed
 * form, before a route runs. MCP clients often do not follow a 308 on POST, so
 * the Vercel server turns the built-in redirect off. scripts/prepare-server.ts
 * writes src/middleware.ts there, which puts the redirect back for every path
 * except /api/mcp, /api/lookup, /api/agents and /api/badge. The static export
 * has no runtime redirect, and it cannot ship middleware.
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  ...(onVercel ? { skipTrailingSlashRedirect: true } : { output: "export" }),
  trailingSlash: true,
  // The server routes read the grades from data/ at request time.
  outputFileTracingIncludes: {
    "/api/grade": ["./data/**/*"],
    "/api/trust": ["./data/**/*"],
    "/api/best": ["./data/**/*"],
    "/api/lookup": ["./data/**/*"],
    "/api/agents": ["./data/**/*"],
    "/api/mcp": ["./data/**/*"],
    "/api/badge": ["./data/**/*"],
    "/openserv/[[...path]]": ["./data/**/*"],
  },
  basePath: process.env.BASE_PATH || "",
  env: {
    NEXT_PUBLIC_BASE_PATH: process.env.BASE_PATH || "",
    NEXT_PUBLIC_SITE_URL: process.env.SITE_URL || "",
    // Stripe Payment Links for paying by card. The card option only shows when set.
    NEXT_PUBLIC_CARD_LINK: process.env.CARD_PAYMENT_LINK || "",
    NEXT_PUBLIC_CARD_LINK_REGRADE: process.env.CARD_PAYMENT_LINK_REGRADE || "",
  },
};
export default nextConfig;
