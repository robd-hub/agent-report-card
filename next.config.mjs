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
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  ...(onVercel ? {} : { output: "export" }),
  trailingSlash: true,
  // The server routes read the grades from data/ at request time.
  outputFileTracingIncludes: { "/api/grade": ["./data/**/*"], "/openserv/[[...path]]": ["./data/**/*"] },
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
