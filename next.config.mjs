/**
 * The site is exported as plain static files (the `out/` folder), so it can be hosted
 * for free on GitHub Pages. BASE_PATH is set by the publish workflow to "/agent-report-card"
 * because GitHub Pages serves the site from https://<owner>.github.io/agent-report-card/.
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: process.env.BASE_PATH || "",
  env: {
    NEXT_PUBLIC_BASE_PATH: process.env.BASE_PATH || "",
    NEXT_PUBLIC_SITE_URL: process.env.SITE_URL || "",
  },
};
export default nextConfig;
