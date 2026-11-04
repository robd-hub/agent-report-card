import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Report Card",
  description: "Independent grades for AI agents, scored by SERV Reasoning and staked human reviewers on Reppo.",
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
            <Link href="/#how">How it works</Link>
            <a href="https://github.com/robd-hub/agent-report-card">GitHub</a>
          </nav>
        </header>
        {children}
        <footer className="foot">
          <span>Agent Report Card</span>
          <span className="muted">Built for SERV Hackathon 02 · Graded with SERV Reasoning and Reppo</span>
        </footer>
      </body>
    </html>
  );
}
