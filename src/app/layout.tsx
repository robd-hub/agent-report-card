import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { STATUS_URL } from "@/lib/links";

/**
 * Counts where visitors come from (a ?ref= / ?from= link tag, or the referring
 * site), with no cookies. Sent to the shared counter in Cheap First's API, which
 * shows both sites at https://cheap-first.vercel.app/visits. Counts each arrival
 * on the site, not every click inside it.
 */
const VISIT_URL = "https://cheap-first.vercel.app/api/hit";
const VISIT_SCRIPT = `(function(){try{var q=new URLSearchParams(location.search),r=q.get("ref")||q.get("from")||q.get("utm_source")||"",h="";try{h=document.referrer?new URL(document.referrer).hostname:""}catch(e){}var b=JSON.stringify({s:"arc",p:location.pathname,r:r,h:h===location.hostname?"":h});if(navigator.sendBeacon)navigator.sendBeacon(${JSON.stringify(VISIT_URL)},b);else fetch(${JSON.stringify(VISIT_URL)},{method:"POST",body:b,keepalive:true,mode:"no-cors"})}catch(e){}})();`;

export const metadata: Metadata = {
  // Absolute links for the share pictures X and others show for a report link.
  // Origin only: Next adds the base path itself.
  metadataBase: new URL(new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://robd-hub.github.io").origin),
  twitter: { card: "summary_large_image", site: "@agentreportcard" },
  title: "Agent Report Card",
  description: "Independent grades for AI agents, checked by SERV Reasoning and judged independently on Reppo.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap"
        />
      </head>
      <body>
        <div className="bg" aria-hidden="true" />
        <header className="nav">
          <Link href="/" className="logo">
            <span className="logo-mark">A</span>
            <span>Agent Report Card</span>
          </Link>
          <nav>
            <Link href="/#leaderboard">Leaderboard</Link>
            <Link href="/trust-check">Trust Check</Link>
            <Link href="/for-agents">For agents</Link>
            <Link href="/drift-watch">Drift Watch</Link>
            <Link href="/how-grading-works">How grading works</Link>
            <a href="https://github.com/robd-hub/agent-report-card">GitHub</a>
            <Link href="/#get-graded" className="nav-cta">Get graded</Link>
          </nav>
        </header>
        {children}
        <footer className="foot">
          <span>Agent Report Card</span>
          <span className="muted">Built for SERV Hackathon 02 · Graded with SERV Reasoning and Reppo · <a href={STATUS_URL}>Uptime</a></span>
        </footer>
        <script dangerouslySetInnerHTML={{ __html: VISIT_SCRIPT }} />
      </body>
    </html>
  );
}
