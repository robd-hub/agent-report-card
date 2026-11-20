"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { GRADE_REQUEST_URL } from "@/lib/links";
import { browserWallet, payUsdc, walletError } from "@/lib/wallet";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
// The GitHub Pages copy has no server, so it sends the form to the main site.
const API = BASE ? "https://grader.designimp.com" : "";

type State =
  | { kind: "idle" }
  | { kind: "busy"; message: string }
  | { kind: "opened"; request: string; existing?: boolean }
  | { kind: "error"; message: string; field?: string; fallback?: boolean };

type Reply = { status?: string; request?: string; existing?: boolean; error?: string; field?: string; priceUsd?: number };

async function send(data: Record<string, unknown>): Promise<Reply> {
  const res = await fetch(`${API}/api/request/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  return (await res.json().catch(() => ({}))) as Reply;
}

/**
 * The grade request form for USDC payers. Two ways to pay:
 *   - "Pay with my wallet": checks the form and the price with /api/request,
 *     asks the browser wallet to send the USDC on Base, then sends the request
 *     with the new transaction. No copying or pasting.
 *   - Paid already: paste the transaction and send the request.
 * Either way /api/request (src/server/request.ts) checks the payment on Base
 * before it opens the grade request.
 */
export function RequestForm() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [agent, setAgent] = useState("");
  const [hasWallet, setHasWallet] = useState(false);
  const [paidAlready, setPaidAlready] = useState(false);
  const [payment, setPayment] = useState("");
  const [paidByWallet, setPaidByWallet] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    setHasWallet(Boolean(browserWallet()));
    const p = new URLSearchParams(window.location.search).get("payment");
    if (p) {
      setPayment(p);
      setPaidAlready(true);
    }
  }, []);

  const fields = () => Object.fromEntries(new FormData(form.current!).entries());

  function show(reply: Reply, fallbackMessage: string) {
    if (reply.status === "opened" && reply.request) return setState({ kind: "opened", request: reply.request, existing: reply.existing });
    if (reply.status === "invalid") return setState({ kind: "error", message: reply.error ?? "Please check the form.", field: reply.field });
    setState({ kind: "error", message: reply.error ?? fallbackMessage, fallback: true });
  }

  /** Sends the request with a pasted transaction. */
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState({ kind: "busy", message: "Checking your payment…" });
    try {
      show(await send(fields()), "We couldn't open your request just now.");
    } catch {
      setState({ kind: "error", message: "We couldn't reach the grader just now.", fallback: true });
    }
  }

  /** Checks the form, pays from the browser wallet, then sends the request. */
  async function payWithWallet() {
    const wallet = browserWallet();
    if (!wallet || !form.current?.reportValidity()) return;
    const data = fields();
    let price: number;
    try {
      setState({ kind: "busy", message: "Checking your details…" });
      const quote = await send({ ...data, check: true });
      if (quote.status !== "ok" || !quote.priceUsd) return show(quote, "We couldn't check your details just now.");
      price = quote.priceUsd;
    } catch {
      return setState({ kind: "error", message: "We couldn't reach the grader just now, so nothing was paid.", fallback: true });
    }

    let hash: string;
    try {
      hash = await payUsdc(wallet, price, (message) => setState({ kind: "busy", message }));
    } catch (e) {
      return setState({ kind: "error", message: walletError(e) });
    }
    // From here the money has moved: keep the transaction in the form so a retry never pays twice.
    setPayment(`https://basescan.org/tx/${hash}`);
    setPaidByWallet(true);
    setPaidAlready(true);
    setState({ kind: "busy", message: "Paid. Opening your grade request…" });
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const reply = await send({ ...data, payment: hash });
        // Base's public node can lag the wallet by a few seconds.
        if (reply.status === "invalid" && /wasn't found/.test(reply.error ?? "") && attempt < 3) {
          await new Promise((r) => setTimeout(r, 4000));
          continue;
        }
        return show(reply, "Your payment went through, but we couldn't open the request yet.");
      } catch {
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
    setState({
      kind: "error",
      message: "Your payment went through, but we couldn't open the request yet. Your transaction is filled in below: press Send my request in a minute to try again (you won't pay twice).",
      fallback: true,
    });
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

  const busy = state.kind === "busy";
  const openAi = /\/chat\/completions\/?\s*$/.test(agent.trim().split(/\s+/)[0] ?? "");
  const bad = (f: string) => (state.kind === "error" && state.field === f ? "field field-bad" : "field");
  const pasting = !hasWallet || paidAlready;
  return (
    <form ref={form} className="request-form" onSubmit={submit}>
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
      {pasting && (
        <label className={bad("payment")}>
          <span>Payment transaction *</span>
          <input name="payment" required maxLength={300} placeholder="https://basescan.org/tx/0x..." value={payment} onChange={(e) => setPayment(e.target.value)} />
          <small className="muted">The Basescan link or transaction hash for your USDC payment.</small>
        </label>
      )}
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
      {busy && <p className="form-status">{state.message}</p>}
      <div className="cta-row">
        {pasting ? (
          <button className="btn btn-primary" type="submit" disabled={busy}>Send my request →</button>
        ) : (
          <button className="btn btn-primary" type="button" onClick={payWithWallet} disabled={busy}>Pay with my wallet →</button>
        )}
      </div>
      {hasWallet ? (
        <p className="muted small">
          {pasting ? (
            paidByWallet ? null : (
              <button className="linkish" type="button" onClick={() => setPaidAlready(false)} disabled={busy}>Pay with my wallet instead</button>
            )
          ) : (
            <>
              Your wallet opens on Base with the payment ($10, or $5 for a regrade) filled in. You need that much USDC on Base, plus a little ETH for the
              network fee (under a cent).{" "}
              <button className="linkish" type="button" onClick={() => setPaidAlready(true)} disabled={busy}>Already paid? Paste the transaction</button>
            </>
          )}
        </p>
      ) : (
        <p className="muted small">Have MetaMask or Coinbase Wallet? Open this page in it to pay in one step.</p>
      )}
    </form>
  );
}
