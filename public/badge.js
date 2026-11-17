/*
 * Agent Report Card "match my site" badge.
 * It uses your page's own font and text colour, so it fits your design. Paste:
 *   <div data-arc-agent="your-agent-id"></div>
 *   <script src="https://robd-hub.github.io/agent-report-card/badge.js" async></script>
 * Options on the div:
 *   data-style="pill" or "card"   (default pill)
 *   data-accent="#ff6a3d"         colour of the grade tile (default: the grade's colour)
 *   data-radius="12"              corner rounding in px (default 999 for pill, 16 for card)
 * The grade updates by itself whenever the agent is regraded.
 */
(function () {
  var script = document.currentScript;
  var base = script && script.src ? new URL(".", script.src).href : "https://robd-hub.github.io/agent-report-card/";
  var TILE = { A: "#2ef2a4", B: "#a6f04a", C: "#ffd84a", D: "#ff9a3c", F: "#ff4d6d" };
  var cache = {};

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }
  // Dark text on light tiles, white text on dark ones.
  function ink(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return "#06080d";
    var n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#06080d" : "#ffffff";
  }
  function safeColor(c) {
    return /^#[0-9a-f]{3,8}$/i.test(c || "") ? c : null;
  }
  var LINE = "border:1px solid color-mix(in srgb,currentColor 22%,transparent);";
  var SOFT = "opacity:.7;";

  function html(d, el) {
    var style = el.getAttribute("data-style") === "card" ? "card" : "pill";
    var grade = d.grade || "–";
    var tile = safeColor(el.getAttribute("data-accent")) || TILE[grade] || "#5b6275";
    var r = parseInt(el.getAttribute("data-radius"), 10);
    var link = "display:inline-flex;align-items:center;text-decoration:none;color:inherit;font:inherit;line-height:1.2;" + LINE;
    var title = "Graded by Agent Report Card. See the full report.";
    if (style === "pill") {
      var pr = isNaN(r) ? 999 : r;
      return '<a href="' + esc(d.report) + '" title="' + title + '" style="' + link + "gap:8px;padding:3px 12px 3px 3px;border-radius:" + pr + 'px">' +
        '<span style="display:grid;place-items:center;width:1.7em;height:1.7em;border-radius:' + Math.min(pr, 999) + "px;background:" + tile + ";color:" + ink(tile) + ';font-weight:700">' + esc(grade) + "</span>" +
        '<span style="font-size:.85em;' + SOFT + '">Agent Report Card</span>' +
        '<strong style="font-size:.85em">' + (d.score == null ? "not graded" : esc(d.score) + "/100") + "</strong></a>";
    }
    var cr = isNaN(r) ? 16 : r;
    var when = d.date ? new Date(d.date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
    return '<a href="' + esc(d.report) + '" title="' + title + '" style="' + link + "gap:14px;padding:14px 18px 14px 14px;border-radius:" + cr + 'px">' +
      '<span style="display:grid;place-items:center;width:2.4em;height:2.4em;font-size:1.6em;border-radius:' + Math.max(0, cr - 4) + "px;background:" + tile + ";color:" + ink(tile) + ';font-weight:800">' + esc(grade) + "</span>" +
      '<span style="display:flex;flex-direction:column;gap:3px">' +
      '<span style="font-size:.7em;letter-spacing:.12em;text-transform:uppercase;' + SOFT + '">Independently graded</span>' +
      '<span style="font-size:1.5em;font-weight:700">' + (d.score == null ? "–" : esc(d.score)) + '<span style="font-size:.55em;font-weight:400;' + SOFT + '"> /100</span></span>' +
      '<span style="font-size:.8em">Agent Report Card' + (when ? '<span style="' + SOFT + '"> · ' + esc(when) + "</span>" : "") + "</span></span></a>";
  }

  function load(id) {
    if (!cache[id]) cache[id] = fetch(base + "badge/" + encodeURIComponent(id) + ".json").then(function (r) { if (!r.ok) throw 0; return r.json(); });
    return cache[id];
  }
  function render(el) {
    var id = el.getAttribute("data-arc-agent");
    if (!id) return;
    load(id).then(function (d) { el.innerHTML = html(d, el); }, function () {});
  }
  function all() {
    var els = document.querySelectorAll("[data-arc-agent]");
    for (var i = 0; i < els.length; i++) render(els[i]);
  }
  window.ARCBadge = { render: render };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", all); else all();
})();
