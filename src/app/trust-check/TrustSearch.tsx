"use client";
import { useMemo, useState } from "react";
import { findTrust, type TrustRecord } from "@/lib/trust";

const ADVICE: Record<TrustRecord["advice"], { label: string; chip: string }> = {
  rely: { label: "Safe to rely on", chip: "chip-ok" },
  check: { label: "Use, but check answers", chip: "chip-warn" },
  avoid: { label: "Don't rely on it", chip: "chip-bad" },
  unknown: { label: "Not graded yet", chip: "" },
};

/** Search box: type an agent's name, marketplace number or link, or https address, see its Trust Check. */
export function TrustSearch({ records }: { records: TrustRecord[] }) {
  const [q, setQ] = useState("");
  const sorted = useMemo(() => [...records].sort((a, b) => a.agent.name.localeCompare(b.agent.name)), [records]);
  const found = q.trim() ? findTrust(q, records) : null;
  const stale = found?.freshUntil ? new Date(found.freshUntil).getTime() < Date.now() : false;

  return (
    <div className="panel">
      <div className="panel-label">Check an agent</div>
      <input
        className="trust-input"
        list="trust-agents"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Agent name, OpenServ marketplace number or link, or https address"
        aria-label="Agent to check"
      />
      <datalist id="trust-agents">
        {sorted.map((r) => <option key={r.agent.id} value={r.agent.name} />)}
      </datalist>

      {q.trim() && !found && (
        <p className="muted">
          No grade for that agent yet, so we can't vouch for it. <a href="../#get-graded">Ask its builder to get it graded</a>.
        </p>
      )}

      {found && (
        <div className="trust-result">
          <div className="trust-head">
            <strong>{found.agent.name}</strong>
            <span className={`chip ${ADVICE[found.advice].chip}`}>{ADVICE[found.advice].label}</span>
            {found.honesty && <span className={`chip ${found.honesty === "passed" ? "chip-ok" : found.honesty === "failed" ? "chip-bad" : ""}`}>Honesty {found.honesty}</span>}
            {stale && <span className="chip chip-warn">Out of date</span>}
            {found.selfGraded && <span className="chip chip-self">Our own agent</span>}
          </div>
          <p>{found.verdict}</p>
          {found.testedAt && <p className="muted small">Tested {found.testedAt.slice(0, 10)}. Current until {found.freshUntil!.slice(0, 10)}.</p>}
          <p><a href={found.report}>Full report →</a></p>
        </div>
      )}
    </div>
  );
}
