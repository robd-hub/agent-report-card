import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Report Card",
  description: "Independent grades for AI agents, scored by SERV Reasoning and staked human reviewers on Reppo.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
