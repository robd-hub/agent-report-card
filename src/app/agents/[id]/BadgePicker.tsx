"use client";
import { useEffect, useRef, useState } from "react";

type Style = "pill" | "card" | "match";
type Theme = "dark" | "light";

/** Lets a builder pick a badge that fits their own site, preview it, and copy the code. */
export function BadgePicker({ agentId, agentName, grade, score, siteUrl, basePath }: { agentId: string; agentName: string; grade: string | null; score: number | null; siteUrl: string; basePath: string }) {
  const [style, setStyle] = useState<Style>("card");
  const [format, setFormat] = useState<"html" | "markdown">("html");
  const [theme, setTheme] = useState<Theme>("dark");
  const [matchShape, setMatchShape] = useState<"pill" | "card">("card");
  const [accent, setAccent] = useState("");
  const [copied, setCopied] = useState(false);
  const widget = useRef<HTMLDivElement>(null);

  const img = (s: "pill" | "card") => `${agentId}-${s}-${theme}.svg`;
  const accentOk = /^#[0-9a-f]{6}$/i.test(accent);
  const report = `${siteUrl}/agents/${agentId}/`;
  const code =
    style === "match"
      ? `<div data-arc-agent="${agentId}" data-style="${matchShape}"${accentOk ? ` data-accent="${accent}"` : ""}></div>\n<script src="${siteUrl}/badge.js" async></script>`
      : format === "markdown"
        ? `[![Agent Report Card grade](${siteUrl}/badge/${img(style)})](${report})`
        : `<a href="${report}"><img src="${siteUrl}/badge/${img(style)}" alt="Agent Report Card grade" height="${style === "pill" ? 32 : 124}"></a>`;
  // A ready-made post: X shows the report's grade card as the link picture.
  const tweet = grade
    ? `${agentName} got ${/^[AEF]/.test(grade) ? "an" : "a"} ${grade} (${score}/100) on Agent Report Card, judged independently on @reppo and checked by SERV Reasoning. Every answer and critique is public:`
    : `${agentName} is on Agent Report Card:`;
  const shareUrl = `https://x.com/intent/post?text=${encodeURIComponent(tweet)}&url=${encodeURIComponent(report)}`;

  // Load the widget script once, then redraw the preview when an option changes.
  useEffect(() => {
    if (style !== "match" || !widget.current) return;
    const draw = () => widget.current && (window as unknown as { ARCBadge?: { render(el: Element): void } }).ARCBadge?.render(widget.current);
    if ((window as unknown as { ARCBadge?: unknown }).ARCBadge) return void draw();
    const s = document.createElement("script");
    s.src = `${basePath}/badge.js`;
    s.onload = draw;
    document.body.appendChild(s);
  }, [style, matchShape, accent, theme, basePath]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="badge-picker">
      <div className="seg" role="group" aria-label="Badge style">
        {(["card", "pill", "match"] as const).map((s) => (
          <button key={s} type="button" className={style === s ? "on" : ""} onClick={() => setStyle(s)}>
            {s === "card" ? "Card" : s === "pill" ? "Pill" : "Match my site"}
          </button>
        ))}
      </div>
      <div className="seg" role="group" aria-label="Background">
        {(["dark", "light"] as const).map((t) => (
          <button key={t} type="button" className={theme === t ? "on" : ""} onClick={() => setTheme(t)}>
            {t === "dark" ? "Dark site" : "Light site"}
          </button>
        ))}
      </div>
      {style !== "match" && (
        <div className="seg" role="group" aria-label="Where it goes">
          {(["html", "markdown"] as const).map((f) => (
            <button key={f} type="button" className={format === f ? "on" : ""} onClick={() => setFormat(f)}>
              {f === "html" ? "Website (HTML)" : "README (Markdown)"}
            </button>
          ))}
        </div>
      )}
      {style === "match" && (
        <div className="match-opts">
          <div className="seg" role="group" aria-label="Shape">
            {(["card", "pill"] as const).map((s) => (
              <button key={s} type="button" className={matchShape === s ? "on" : ""} onClick={() => setMatchShape(s)}>
                {s === "card" ? "Card" : "Pill"}
              </button>
            ))}
          </div>
          <label className="accent">
            Your brand colour
            <input type="color" value={accentOk ? accent : "#2ef2a4"} onChange={(e) => setAccent(e.target.value)} />
            {accentOk ? <button type="button" className="linkish" onClick={() => setAccent("")}>use grade colour</button> : <span className="muted">(optional)</span>}
          </label>
        </div>
      )}
      <div className={`badge-preview ${theme}`}>
        {style === "match" ? (
          <div ref={widget} key={`${matchShape}-${accent}`} data-arc-agent={agentId} data-style={matchShape} data-accent={accentOk ? accent : undefined} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`${basePath}/badge/${img(style)}`} alt="Agent Report Card grade" height={style === "pill" ? 32 : 124} />
        )}
      </div>
      <p className="muted small">
        {style === "match"
          ? "Uses your page's own font and text colour, so it fits your design. Set a brand colour for the grade tile if you like. It updates itself when the agent is regraded."
          : format === "markdown"
            ? "Paste this into your GitHub README. It always shows the latest grade and links to this report."
            : "A plain image, so it works anywhere. It always shows the latest grade."}
      </p>
      <pre>{code}</pre>
      <div className="badge-actions">
        <button type="button" className="btn btn-ghost" onClick={copy}>{copied ? "Copied" : "Copy code"}</button>
        <a className="btn btn-ghost" href={shareUrl} target="_blank" rel="noopener noreferrer">Share on X</a>
      </div>
      <p className="muted small">Sharing the report link on X, Telegram or LinkedIn shows a grade card like the one below, so every post points back here.</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="og-preview" src={`${basePath}/og/${agentId}.png`} alt={`${agentName} grade card`} width={600} height={315} />
    </div>
  );
}
