"use client";
import { useState, type FormEvent } from "react";
import { GRADE_REQUEST_URL } from "@/lib/links";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
// The GitHub Pages copy has no server, so it sends the form to the main site.
const API = BASE ? "https://grader.designimp.com" : "";

type State =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "opened"; request: string; existing?: boolean }
  | { kind: "error"; message: string; field?: string; fallback?: boolean };

/**
 * Sends the request to /api/request (src/server/request.ts), which checks the
 * USDC payment on Base and opens the grade request for the buyer.
 */
export function RequestForm() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [agent, setAgent] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget).entries());
    setState({ kind: "sending" });
    try {
      const res = await fetch(`${API}/api/request/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = (await res.json().catch(() => ({}))) as { status?: string; request?: string; existing?: boolean; error?: string; field?: string };
      if (body.status === "opened" && body.request) return setState({ kind: "opened", request: body.request, existing: body.existing });
      if (body.status === "invalid") return setState({ kind: "error", message: body.error ?? "Please check the form.", field: body.field });
      setState({ kind: "error", message: body.error ?? "We couldn't open your request just now.", fallback: true });
    } catch {
      setState({ kind: "error", message: "We couldn't reach the grader just now.", fallback: true });
    }
  }

  if (state.kind === "opened") {
    return (
      <div className="request-done">
        <p>
          {state.existing ? "That payment already has a grade request." : "Payment checked, and your grade request is open."} The grader replies there
          with your grade, report page and badge, usually within half an hour.
        </p>
        <div className="cta-row">
          <a className="btn btn-primary" href={state.request}>See your grade request →</a>
        </div>
        <p className="muted">Bookmark that link. You can read it without a GitHub account.</p>
      </div>
    );
  }

  const openAi = /\/chat\/completions\/?\s*$/.test(agent.trim().split(/\s+/)[0] ?? "");
  const bad = (f: string) => (state.kind === "error" && state.field === f ? "field field-bad" : "field");
  return (
    <form className="request-form" onSubmit={submit}>
      <label className={bad("agent")}>
        <span>Where can we find your agent? *</span>
        <input name="agent" required maxLength={500} placeholder="https://platform.openserv.ai/agents/123 or https://your-agent.example/api" value={agent} onChange={(e) => setAgent(e.target.value)} />
        <small className="muted">Its OpenServ marketplace link, or a public https address that answers a POST with {`{"prompt": "..."}`}, or an OpenAI-style /chat/completions address. It must work without a key.</small>
      </label>
      {openAi && (
        <label className="field">
          <span>Model name *</span>
          <input name="model" required maxLength={100} placeholder="my-agent-v1" />
        </label>
      )}
      <label className={bad("whatItDoes")}>
        <span>What does it do? *</span>
        <textarea name="whatItDoes" required minLength={10} maxLength={2000} rows={3} placeholder="A sentence or two on the jobs it's built for, so we can pick fair test tasks." />
      </label>
      <label className={bad("payment")}>
        <span>Payment transaction *</span>
        <input name="payment" required maxLength={300} placeholder="https://basescan.org/tx/0x..." />
        <small className="muted">The Basescan link or transaction hash for your USDC payment.</small>
      </label>
      <label className="field">
        <span>Agent name</span>
        <input name="name" maxLength={80} placeholder="My Research Agent" />
      </label>
      <label className="field">
        <span>A real task you'd like it tested on</span>
        <textarea name="task" maxLength={1000} rows={2} placeholder="Something your users actually ask it." />
      </label>
      <label className="field">
        <span>How should we reach you?</span>
        <input name="contact" maxLength={200} placeholder="@yourhandle (optional)" />
      </label>
      {state.kind === "error" && (
        <p className="form-error">
          {state.message}
          {state.fallback && (
            <>
              {" "}You can also <a href={GRADE_REQUEST_URL}>open the request on GitHub</a>.
            </>
          )}
        </p>
      )}
      <div className="cta-row">
        <button className="btn btn-primary" type="submit" disabled={state.kind === "sending"}>
          {state.kind === "sending" ? "Checking your payment…" : "Send my request →"}
        </button>
      </div>
    </form>
  );
}
