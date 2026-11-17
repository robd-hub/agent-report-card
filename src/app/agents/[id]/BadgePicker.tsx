"use client";
import { useEffect, useRef, useState } from "react";

type Style = "pill" | "card" | "match";
type Theme = "dark" | "light";

/** Lets a builder pick a badge that fits their own site, preview it, and copy the code. */
export function BadgePicker({ agentId, siteUrl, basePath }: { agentId: string; siteUrl: string; basePath: string }) {
  const [style, setStyle] = useState<Style>("card");
  const [theme, setTheme] = useState<Theme>("dark");
  const [matchShape, setMatchShape] = useState<"pill" | "card">("card");
  const [accent, setAccent] = useState("");
  const [copied, setCopied] = useState(false);
  const widget = useRef<HTMLDivElement>(null);

  const img = (s: "pill" | "card") => `${agentId}-${s}-${theme}.svg`;
  const accentOk = /^#[0-9a-f]{6}$/i.test(accent);
  const code =
    style === "match"
      ? `<div data-arc-agent="${agentId}" data-style="${matchShape}"${accentOk ? ` data-accent="${accent}"` : ""}></div>\n<script src="${siteUrl}/badge.js" async></script>`
      : `<a href="${siteUrl}/agents/${agentId}/"><img src="${siteUrl}/badge/${img(style)}" alt="Agent Report Card grade" height="${style === "pill" ? 32 : 124}"></a>`;

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
          : "A plain image, so it works anywhere, including READMEs. It always shows the latest grade."}
      </p>
      <pre>{code}</pre>
      <button type="button" className="btn btn-ghost" onClick={copy}>{copied ? "Copied" : "Copy code"}</button>
    </div>
  );
}
