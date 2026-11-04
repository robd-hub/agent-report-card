import fs from "node:fs";
import path from "node:path";
import type { AgentConfig, AgentReport, GradingRun } from "./types";

const DATA = path.join(process.cwd(), "data");

export function loadAgents(): AgentConfig[] {
  return JSON.parse(fs.readFileSync(path.join(DATA, "agents.json"), "utf8")) as AgentConfig[];
}

export function loadReport(agentId: string): AgentReport {
  const file = path.join(DATA, "results", `${agentId}.json`);
  if (!fs.existsSync(file)) return { agentId, runs: [] };
  return JSON.parse(fs.readFileSync(file, "utf8")) as AgentReport;
}

export function saveReport(report: AgentReport): void {
  fs.mkdirSync(path.join(DATA, "results"), { recursive: true });
  fs.writeFileSync(path.join(DATA, "results", `${report.agentId}.json`), JSON.stringify(report, null, 2) + "\n");
}

export function latestRun(report: AgentReport): GradingRun | null {
  return report.runs.at(-1) ?? null;
}
