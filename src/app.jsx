const { useState, useMemo, useCallback } = React;

/* ============================================================================
   SCORING & LEVER MATH — SINGLE SOURCE OF TRUTH
   ----------------------------------------------------------------------------
   All scoring and roadmap economics live here in one bounded, weighted model.
   Every lever has a realistic min/max drawn from a comparable-sites benchmark
   set, so outputs stay defensible and the client cannot produce nonsense.
   Swap this function out later without touching the UI.

   The running example: a heritage coastal fort with ~200k annual visitors who
   do not stay, spend, or return. Benchmarks are the trust's comparable-sites
   set (n=14 coastal forts & heritage properties in the same tier).
   ========================================================================== */

const BENCH = {
  visitors: 200000,               // proven demand — this is the rare asset
  spendNow: 4.2,                  // £ per head today (bottom third)
  spendTop: 11.0,                 // £ per head, comparable top third (hard cap)
  dwellNow: 45,                   // minutes on site today
  dwellTop: 130,                  // minutes, comparable top third (hard cap)
  repeatNow: 8,                   // % who return within 12 months
  repeatTop: 22,                  // % comparable top third (hard cap)
};

// Each roadmap move carries a benchmark-anchored payoff CAP (max annual £ uplift
// that comparables actually support), a fixed cost, and a variable cost that
// grows with ambition. Different cost curves make the ranking REORDER as the
// ambition lever moves — that is the point of the lever.
const MOVES = [
  { id: "narrative", name: "Rebuild the narrative spine",
    blurb: "A single interpretive story the whole site tells — the root fix everything else hangs off.",
    capK: 420, cfixK: 45,  cvarK: 20,  root: true,
    benchmark: "Comparable sites with a defined interpretive lead average £9–£13 / head." },
  { id: "programming", name: "Layer programming onto the story",
    blurb: "Events, guided routes and seasonal changes that give the narrative something to do.",
    capK: 310, cfixK: 60,  cvarK: 90,
    benchmark: "Programmed sites in the set run 6–11 changing offers a year; this fort runs 1." },
  { id: "dwell", name: "Build dwell-time infrastructure",
    blurb: "Café, seating, wayfinding and shelter so a longer visit is physically possible.",
    capK: 280, cfixK: 180, cvarK: 200,
    benchmark: "Top-third sites hold visitors 110–140 min; food & beverage drives most of the gap." },
  { id: "revenue", name: "Open a second revenue line",
    blurb: "Retail and venue hire so income no longer rests on admissions alone.",
    capK: 220, cfixK: 120, cvarK: 190,
    benchmark: "In the set, admissions rarely exceed 55% of income; here it is 86%." },
  { id: "repeat", name: "Engineer reasons to return",
    blurb: "Membership and a changing programme so the visit is worth repeating.",
    capK: 180, cfixK: 40,  cvarK: 160,
    benchmark: "Repeat visitation runs 18–24% at comparable sites; here it is 8%." },
];

// ambition ∈ [0,1]. The slider STOPS at 1 = comparable top-third. Reality caps
// it there; you cannot push a projection past what comparable sites have done.
function computeModel(ambition) {
  const a = Math.max(0, Math.min(1, ambition));

  // Projected operating metrics interpolate today -> top-third comparable, capped.
  const spend  = BENCH.spendNow  + (BENCH.spendTop  - BENCH.spendNow)  * a;
  const dwell  = BENCH.dwellNow  + (BENCH.dwellTop  - BENCH.dwellNow)  * a;
  const repeat = BENCH.repeatNow + (BENCH.repeatTop - BENCH.repeatNow) * a;

  // Per-move economics. payoff is linear in ambition to its cap; cost is convex
  // (cfix + cvar*a^2) so low-fixed-cost moves win at low ambition and
  // low-variable-cost moves climb at high ambition — the ranking reorders.
  const rows = MOVES.map((m) => {
    const payoffK = m.capK * a;
    const costK   = m.cfixK + m.cvarK * a * a;
    const roi     = costK > 0 ? payoffK / costK : 0;
    return { ...m, payoffK, costK, roi };
  });

  // Rank by ROI. The root (narrative) is pinned to #1 conceptually because the
  // rest of the chain depends on it landing first — the math keeps it there too,
  // but we guard it so sequencing logic never breaks.
  const ranked = [...rows].sort((x, y) => {
    if (x.root && !y.root) return -1;
    if (y.root && !x.root) return 1;
    return y.roi - x.roi;
  });

  const totalPayoffK = rows.reduce((s, r) => s + r.payoffK, 0);
  const totalCostK   = rows.reduce((s, r) => s + r.costK, 0);
  const revNowK      = (BENCH.visitors * BENCH.spendNow) / 1000;
  const revProjK     = (BENCH.visitors * spend) / 1000;

  return { a, spend, dwell, repeat, ranked, rows, totalPayoffK, totalCostK, revNowK, revProjK };
}

// The first engagement covers the root and its first propagation only. Later
// moves are honest scoping (they depend on the story landing first), never upsell.
const FIRST_ENGAGEMENT = ["narrative", "programming"];

/* ============================================================================
   THEME — two UI directions, toggleable at the top.
   minimal  = calm / editorial: paper, serif, hairlines, whitespace, no colour.
   rich     = designed: tinted panels, sans, colour accents, soft shadows, pills.
   ========================================================================== */
function theme(mode) {
  if (mode === "rich") {
    return {
      mode: "rich",
      bg: "#eef1f4", panel: "#ffffff", panel2: "#f5f8fa",
      ink: "#10202b", muted: "#5a6b76", faint: "#8a99a2",
      line: "#dde5ea", accent: "#0f766e", accentInk: "#0b5750",
      accentBg: "#e2f2ef", warm: "#b45309", warmBg: "#fbe6d2",
      radius: 14, shadow: "0 8px 30px -14px rgba(16,32,43,.35)",
      shadowSm: "0 3px 12px -6px rgba(16,32,43,.3)",
      fontHead: "'Trebuchet MS', 'Segoe UI', system-ui, sans-serif",
      fontBody: "'Segoe UI', system-ui, -apple-system, sans-serif",
      bandColors: { low:{fg:"#9a3412",bg:"#fbe3d3"}, med:{fg:"#92700c",bg:"#f7ecc8"}, high:{fg:"#0f766e",bg:"#d7efe9"} },
      maxw: 940, hero: "linear-gradient(135deg,#0f766e 0%,#134e4a 100%)",
    };
  }
  return {
    mode: "minimal",
    bg: "#f7f5ef", panel: "#fffdf8", panel2: "#f3f0e7",
    ink: "#1b1a16", muted: "#6c675c", faint: "#9a948700",
    line: "#e2ddd0", accent: "#2a2824", accentInk: "#1b1a16",
    accentBg: "#ece8dd", warm: "#7a5a2e", warmBg: "#efe7d6",
    radius: 3, shadow: "none", shadowSm: "none",
    fontHead: "Georgia, 'Times New Roman', serif",
    fontBody: "Georgia, 'Times New Roman', serif",
    bandColors: { low:{fg:"#5a4632",bg:"transparent"}, med:{fg:"#4a463c",bg:"transparent"}, high:{fg:"#33352b",bg:"transparent"} },
    maxw: 800, hero: "none",
  };
}

/* ============================================================================
   SMALL UI PRIMITIVES
   ========================================================================== */
const merge = (...o) => Object.assign({}, ...o);

function Kicker({ t, children }) {
  return (
    <div style={{
      fontFamily: t.fontBody, fontSize: 11.5, letterSpacing: ".16em",
      textTransform: "uppercase", color: t.muted, marginBottom: 14, fontWeight: 600,
    }}>{children}</div>
  );
}

function H({ t, children, size = 30, style }) {
  return <h1 style={merge({
    fontFamily: t.fontHead, fontSize: size, lineHeight: 1.15, color: t.ink,
    margin: "0 0 16px", fontWeight: t.mode === "rich" ? 700 : 600,
    letterSpacing: t.mode === "minimal" ? "-.01em" : "0",
  }, style)}>{children}</h1>;
}

function P({ t, children, style }) {
  return <p style={merge({
    fontFamily: t.fontBody, fontSize: 16.5, lineHeight: 1.62, color: t.muted,
    margin: "0 0 14px", maxWidth: 660,
  }, style)}>{children}</p>;
}

function Band({ t, band }) {
  const c = t.bandColors[band];
  const label = { low: "LOW", med: "MEDIUM", high: "HIGH" }[band];
  if (t.mode === "minimal") {
    return <span style={{ fontFamily: t.fontBody, fontSize: 11.5, letterSpacing: ".14em",
      color: c.fg, borderBottom: `2px solid ${c.fg}`, paddingBottom: 1, fontWeight: 600 }}>{label}</span>;
  }
  return <span style={{ fontFamily: t.fontBody, fontSize: 11.5, letterSpacing: ".08em",
    color: c.fg, background: c.bg, padding: "3px 10px", borderRadius: 999, fontWeight: 700 }}>{label}</span>;
}

// Every claim points OUTWARD to comparables, never inward to a rubric.
function Bench({ t, children }) {
  return (
    <div style={{
      fontFamily: t.fontBody, fontSize: 13.5, lineHeight: 1.5, color: t.mode === "rich" ? t.accentInk : t.warm,
      background: t.mode === "rich" ? t.accentBg : "transparent",
      borderLeft: `2px solid ${t.mode === "rich" ? t.accent : t.warm}`,
      padding: t.mode === "rich" ? "10px 14px" : "2px 0 2px 14px",
      borderRadius: t.mode === "rich" ? 8 : 0, margin: "10px 0",
    }}>
      <span style={{ fontWeight: 700, letterSpacing: ".04em", fontSize: 11, textTransform: "uppercase",
        display: "block", opacity: .8, marginBottom: 3 }}>vs. comparable sites</span>
      {children}
    </div>
  );
}

function Card({ t, children, style, tone }) {
  const bg = tone === "alt" ? t.panel2 : t.panel;
  return <div style={merge({
    background: bg, border: `1px solid ${t.line}`, borderRadius: t.radius,
    boxShadow: t.shadowSm, padding: 20,
  }, style)}>{children}</div>;
}

function Stat({ t, label, value, sub, emphasise }) {
  return (
    <div style={{ padding: t.mode === "rich" ? "14px 16px" : "12px 0",
      borderTop: t.mode === "minimal" ? `1px solid ${t.line}` : "none",
      background: t.mode === "rich" ? (emphasise ? t.accentBg : t.panel2) : "transparent",
      borderRadius: t.mode === "rich" ? 10 : 0, flex: "1 1 130px", minWidth: 120 }}>
      <div style={{ fontFamily: t.fontHead, fontSize: 26, color: emphasise ? t.accent : t.ink, lineHeight: 1 }}>{value}</div>
      <div style={{ fontFamily: t.fontBody, fontSize: 12.5, color: t.muted, marginTop: 6, letterSpacing: ".02em" }}>{label}</div>
      {sub && <div style={{ fontFamily: t.fontBody, fontSize: 11.5, color: t.faint || t.muted, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function Divider({ t }) { return <div style={{ height: 1, background: t.line, margin: "22px 0" }} />; }

const money = (k) => k >= 1000 ? `£${(k/1000).toFixed(2)}M` : `£${Math.round(k)}k`;

/* ============================================================================
   THE FOUR DISCOVERY STREAMS (shared across discovery / backstage / findings)
   ========================================================================== */
const STREAMS = [
  { id: "internal", name: "Internal Capabilities", band: "med",
    finding: "The custodial and operations team is genuinely strong — the fort is well kept and safely run. But there is no interpretation or curatorial function and no commercial programming role, so nobody currently owns the visitor's story or the site's income mix.",
    benchmark: "Every top-third site in the set funds a dedicated interpretation lead. This fort does not — the capability gap is specific, not general.",
    coverage: [
      { t: "Governance & who decides", done: true },
      { t: "Team roles & skills on site", done: true },
      { t: "Curatorial / interpretation capacity", done: false },
      { t: "Commercial & programming ownership", done: false },
    ] },
  { id: "external", name: "External Opportunities", band: "high",
    finding: "Demand is emphatically not the problem. 200,000 people arrive annually with almost no marketing spend, regional tourism is up 12% over three years, and 2.3M people live within a 90-minute catchment. The market has already voted with its feet.",
    benchmark: "For raw footfall the fort sits in the TOP third of the comparable set — most sites in the tier would spend years and budgets to build the demand this one already has.",
    coverage: [
      { t: "Catchment & tourism trend", done: true },
      { t: "Competitor / adjacent offers", done: true },
      { t: "Partnership & funding routes", done: false },
      { t: "Seasonality & demand shape", done: false },
    ] },
  { id: "quant", name: "Quantitative", band: "low",
    finding: "The numbers are unambiguous. Spend is £4.20 per head against a £9–£13 comparable range; dwell time is 45 minutes against 110–140; repeat visitation is 8% against 18–24%. And 86% of income comes from a single line — admissions.",
    benchmark: "On spend, dwell and repeat the fort sits in the BOTTOM third of the set. The concentration on one revenue line is the most fragile in the whole benchmark group.",
    coverage: [
      { t: "Spend per head", done: false },
      { t: "Dwell time", done: false },
      { t: "Revenue mix & concentration", done: false },
      { t: "Repeat / return rate", done: false },
    ] },
  { id: "exp", name: "Experiential", band: "low", heaviest: true,
    finding: "The visit has no narrative spine. People walk the walls, take a photo, and leave — there is nothing to interpret the place, nothing programmed to do, and nothing that changes between visits. This is the finding that most determines whether everything else can work.",
    benchmark: "Against comparable sites the experience is bottom-third, and it is the single variable that best predicts spend, dwell and repeat across the whole set. Weight it heaviest.",
    coverage: [
      { t: "Arrival & orientation", done: true },
      { t: "The core story / interpretation", done: false },
      { t: "Things to do on site", done: false },
      { t: "Reason to stay / reason to return", done: false },
    ] },
];
// id-keyed lookup for direct access (STREAM_BY.exp, STREAM_BY[id])
const STREAM_BY = Object.fromEntries(STREAMS.map((s) => [s.id, s]));

/* ============================================================================
   THE "WHY" VISUAL — one problem propagating, THREE switchable renderings.
   revealCount controls the progressive reveal across Beat-2 screens.
   ========================================================================== */
const CHAIN = [
  { k: "narrative",   label: "Weak narrative",       note: "No story spine to the place." },
  { k: "programming", label: "Thin programming",     note: "A story with nothing to do around it." },
  { k: "revenue",     label: "One revenue line",     note: "Nothing to sell but the ticket." },
  { k: "economics",   label: "Weak economics",       note: "Low spend, short dwell, few returns." },
];

function WhyVisual({ t, mode, reveal }) {
  const n = reveal == null ? CHAIN.length : reveal;
  const shown = CHAIN.slice(0, n);
  const acc = t.mode === "rich" ? t.accent : t.ink;

  // (A) vertical connected chain
  if (mode === "chain") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", maxWidth: 460, margin: "0 auto" }}>
        {shown.map((c, i) => (
          <div key={c.k} className="fadein">
            <div style={{ border: `1px solid ${t.line}`, borderLeft: `3px solid ${acc}`,
              background: t.panel, borderRadius: t.radius, padding: "14px 16px", boxShadow: t.shadowSm }}>
              <div style={{ fontFamily: t.fontHead, fontSize: 18, color: t.ink }}>{c.label}</div>
              <div style={{ fontFamily: t.fontBody, fontSize: 13.5, color: t.muted, marginTop: 4 }}>{c.note}</div>
            </div>
            {i < shown.length - 1 && (
              <div style={{ textAlign: "center", color: acc, fontSize: 22, lineHeight: "26px" }}>↓</div>
            )}
          </div>
        ))}
      </div>
    );
  }

  // (B) propagation / flow — left to right, a pulse travelling the spread
  if (mode === "flow") {
    return (
      <div className="scrollx">
        <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 640, padding: "6px 2px" }}>
          {shown.map((c, i) => (
            <React.Fragment key={c.k}>
              <div className="fadein" style={{ flex: "1 1 0", minWidth: 130,
                background: t.mode === "rich" ? t.accentBg : t.panel,
                border: `1px solid ${t.mode === "rich" ? "transparent" : t.line}`,
                borderRadius: t.radius, padding: "14px 12px", textAlign: "center" }}>
                <div style={{ fontFamily: t.fontHead, fontSize: 15.5, color: t.ink }}>{c.label}</div>
                <div style={{ fontFamily: t.fontBody, fontSize: 12, color: t.muted, marginTop: 5, lineHeight: 1.4 }}>{c.note}</div>
              </div>
              {i < shown.length - 1 && (
                <div style={{ color: acc, fontSize: 24, flex: "0 0 auto", animation: "pulse 1.8s infinite", animationDelay: `${i*0.2}s` }}>→</div>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    );
  }

  // (C) stacked / layered — foundation (narrative) at the bottom holds it up
  const stack = [...shown].reverse();
  return (
    <div style={{ maxWidth: 460, margin: "0 auto" }}>
      {stack.map((c, i) => {
        const depth = stack.length - i; // wider toward the base
        return (
          <div key={c.k} className="fadein" style={{
            width: `${64 + depth * 9}%`, margin: "0 auto 6px",
            background: t.mode === "rich"
              ? `linear-gradient(90deg, ${t.accent}${20 + depth*12 < 16 ? "22":""}, ${t.accent})`
              : t.panel,
            color: t.mode === "rich" ? "#fff" : t.ink,
            border: t.mode === "rich" ? "none" : `1px solid ${t.line}`,
            borderRadius: t.radius, padding: "12px 16px", textAlign: "center",
            opacity: t.mode === "rich" ? 0.55 + depth * 0.1 : 1 }}>
            <div style={{ fontFamily: t.fontHead, fontSize: 15.5 }}>{c.label}</div>
            <div style={{ fontFamily: t.fontBody, fontSize: 12, opacity: .8, marginTop: 3 }}>{c.note}</div>
          </div>
        );
      })}
      <div style={{ textAlign: "center", fontFamily: t.fontBody, fontSize: 11.5,
        color: t.muted, marginTop: 6, letterSpacing: ".08em", textTransform: "uppercase" }}>
        Narrative is the foundation — everything above rests on it
      </div>
    </div>
  );
}

function WhyToggle({ t, mode, setMode }) {
  const opts = [{ k: "chain", l: "A · Chain" }, { k: "flow", l: "B · Propagation" }, { k: "stacked", l: "C · Layered" }];
  return (
    <div style={{ display: "inline-flex", gap: 4, background: t.panel2, padding: 4,
      borderRadius: t.mode === "rich" ? 999 : 3, border: `1px solid ${t.line}` }}>
      {opts.map((o) => (
        <button key={o.k} onClick={() => setMode(o.k)} style={{
          border: "none", background: mode === o.k ? (t.mode==="rich"? t.accent : t.ink) : "transparent",
          color: mode === o.k ? "#fff" : t.muted, padding: "6px 12px",
          borderRadius: t.mode === "rich" ? 999 : 2, fontSize: 12.5, fontFamily: t.fontBody,
          fontWeight: 600 }}>{o.l}</button>
      ))}
    </div>
  );
}

/* ============================================================================
   ROADMAP (Beat 4) — interactive, bounded lever
   ========================================================================== */
function AmbitionLever({ t, ambition, setAmbition, model }) {
  const pct = Math.round(ambition * 100);
  return (
    <Card t={t} tone="alt" style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontFamily: t.fontHead, fontSize: 16, color: t.ink }}>Ambition of the target</div>
        <div style={{ fontFamily: t.fontBody, fontSize: 12.5, color: t.muted }}>
          {pct < 34 ? "Steady" : pct < 67 ? "Committed" : "Full comparable target"}
        </div>
      </div>
      <input type="range" min="0" max="100" value={pct}
        onChange={(e) => setAmbition(Number(e.target.value) / 100)}
        style={{ accentColor: t.accent, margin: "14px 0 6px" }} />
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: t.fontBody, fontSize: 11.5, color: t.faint || t.muted }}>
        <span>Where it is today</span>
        <span>Comparable top third — the slider stops here</span>
      </div>
      <Divider t={t} />
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Stat t={t} label="Spend / head" value={`£${model.spend.toFixed(2)}`} sub={`today £${BENCH.spendNow.toFixed(2)}`} emphasise />
        <Stat t={t} label="Dwell (min)" value={Math.round(model.dwell)} sub={`today ${BENCH.dwellNow}`} />
        <Stat t={t} label="Repeat rate" value={`${Math.round(model.repeat)}%`} sub={`today ${BENCH.repeatNow}%`} />
        <Stat t={t} label="Projected visitor revenue" value={money(model.revProjK)} sub={`today ${money(model.revNowK)}`} emphasise />
      </div>
    </Card>
  );
}

function RoadmapList({ t, model, showEconomics }) {
  const max = Math.max(...model.ranked.map((r) => r.payoffK), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {model.ranked.map((r, i) => {
        const first = FIRST_ENGAGEMENT.includes(r.id);
        return (
          <Card key={r.id} t={t} style={{ padding: 16 }}>
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              <div style={{ fontFamily: t.fontHead, fontSize: 22, color: t.accent, width: 26, flex: "0 0 auto" }}>{i + 1}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: t.fontHead, fontSize: 17, color: t.ink }}>{r.name}</span>
                  {first
                    ? <span style={{ fontFamily: t.fontBody, fontSize: 11, fontWeight: 700, color: t.accent,
                        background: t.accentBg, padding: "2px 9px", borderRadius: 999 }}>FIRST ENGAGEMENT</span>
                    : <span style={{ fontFamily: t.fontBody, fontSize: 11, color: t.muted }}>later phase</span>}
                </div>
                <div style={{ fontFamily: t.fontBody, fontSize: 13.5, color: t.muted, margin: "5px 0 10px", lineHeight: 1.5 }}>{r.blurb}</div>
                {showEconomics && (
                  <>
                    <div style={{ height: 7, background: t.panel2, borderRadius: 999, overflow: "hidden" }}>
                      <div style={{ width: `${(r.payoffK / max) * 100}%`, height: "100%",
                        background: t.mode === "rich" ? t.hero : t.ink, transition: "width .35s ease" }} />
                    </div>
                    <div style={{ display: "flex", gap: 16, marginTop: 8, fontFamily: t.fontBody, fontSize: 12.5, color: t.muted }}>
                      <span>Payoff / yr <b style={{ color: t.ink }}>{money(r.payoffK)}</b></span>
                      <span>Cost <b style={{ color: t.ink }}>{money(r.costK)}</b></span>
                      <span>Return <b style={{ color: t.accent }}>{r.roi.toFixed(1)}×</b></span>
                    </div>
                  </>
                )}
                <div style={{ fontFamily: t.fontBody, fontSize: 12, color: t.mode==="rich"?t.accentInk:t.warm, marginTop: 8, fontStyle: t.mode==="minimal"?"italic":"normal" }}>{r.benchmark}</div>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/* ============================================================================
   SCREEN CONTENT — one entry per screen. Grouped by stage (0-4).
   Beats within Stage 4 are labelled. ctx carries all shared state.
   ========================================================================== */
function buildScreens(ctx) {
  const { t, J, setJ, ambition, setAmbition, whyMode, setWhyMode, model } = ctx;
  const S = []; // screen list
  const add = (stage, label, node) => S.push({ stage, label, node });

  /* ---------------- STAGE 1 — ENTRY ---------------- */
  add(0, "Entry · The front door", (
    <div>
      <Kicker t={t}>Stage 1 — Entry · Screen 1 of 3</Kicker>
      <H t={t}>What kind of decision are you facing?</H>
      <P t={t}>How you arrive shapes the whole engagement. Pick the door that fits — it carries through everything that follows, from the questions we ask to how we read the answers.</P>
      <div style={{ display: "grid", gap: 12, marginTop: 20 }}>
        {[
          { id: "scratch", t: "Starting from Scratch", d: "Something new and still undefined. No fixed form yet — we help you decide what it should even be before anyone commits budget." },
          { id: "reset", t: "Strategic Reset", d: "It exists but has drifted. It is not doing what it was meant to, and you need an honest read on why and what to fix." },
          { id: "growth", t: "Growth", d: "It works. Now you want to expand it responsibly — without breaking the thing that already succeeds." },
        ].map((o) => {
          const sel = J.front === o.id;
          return (
            <button key={o.id} onClick={() => setJ({ ...J, front: o.id })} style={{
              textAlign: "left", background: sel ? t.accentBg : t.panel,
              border: `1px solid ${sel ? t.accent : t.line}`, borderLeft: `3px solid ${sel ? t.accent : t.line}`,
              borderRadius: t.radius, padding: 18, boxShadow: sel ? t.shadowSm : "none" }}>
              <div style={{ fontFamily: t.fontHead, fontSize: 19, color: t.ink, marginBottom: 6 }}>{o.t}{sel ? "  ✓" : ""}</div>
              <div style={{ fontFamily: t.fontBody, fontSize: 14.5, color: t.muted, lineHeight: 1.5 }}>{o.d}</div>
            </button>
          );
        })}
      </div>
      <P t={t} style={{ marginTop: 18, fontSize: 14 }}>Preloaded example — the heritage fort — enters through <b style={{color:t.ink}}>Strategic Reset</b>: 200k visitors already arrive, but they don't stay, spend, or return.</P>
    </div>
  ));

  add(0, "Entry · Intake", (
    <div>
      <Kicker t={t}>Stage 1 — Entry · Screen 2 of 3</Kicker>
      <H t={t}>The short intake</H>
      <P t={t}>Facts only — the warm-up, not the real capture. We are not asking you to judge the project yet. We just want the shape of what exists before the discovery conversation, where the real work happens.</P>
      <Card t={t} tone="alt" style={{ marginTop: 8 }}>
        <div style={{ display: "grid", gap: 16 }}>
          {[
            ["Project name", J.pf.name],
            ["Current stage", J.pf.stage],
            ["What already exists", J.pf.exists],
            ["Budget range", J.pf.budget],
            ["Timeline", J.pf.timeline],
          ].map(([k, v]) => (
            <label key={k} style={{ display: "block" }}>
              <div style={{ fontFamily: t.fontBody, fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", color: t.muted, marginBottom: 5 }}>{k}</div>
              <input value={v} onChange={(e) => setJ({ ...J, pf: { ...J.pf, [ {"Project name":"name","Current stage":"stage","What already exists":"exists","Budget range":"budget","Timeline":"timeline"}[k] ]: e.target.value } })}
                style={{ width: "100%", padding: "10px 12px", fontFamily: t.fontBody, fontSize: 15,
                  border: `1px solid ${t.line}`, borderRadius: t.mode==="rich"?8:2, background: t.panel, color: t.ink }} />
            </label>
          ))}
          <div>
            <div style={{ fontFamily: t.fontBody, fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", color: t.muted, marginBottom: 8 }}>Documents (optional)</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {["Visitor figures.csv", "Annual accounts.pdf", "Site plan.pdf", "+ Add file"].map((f, i) => (
                <div key={f} style={{ fontFamily: t.fontBody, fontSize: 13, color: i===3?t.accent:t.muted,
                  border: `1px dashed ${t.line}`, borderRadius: t.mode==="rich"?8:2, padding: "8px 12px",
                  background: t.panel }}>{i<3?"📎 ":""}{f}</div>
              ))}
            </div>
          </div>
        </div>
      </Card>
      <P t={t} style={{ marginTop: 14, fontSize: 13.5 }}>No judgement questions here. Nothing you type is scored. This just tells us where to point the conversation.</P>
    </div>
  ));

  add(0, "Entry · What happens next", (
    <div>
      <Kicker t={t}>Stage 1 — Entry · Screen 3 of 3</Kicker>
      <H t={t}>What happens next</H>
      <P t={t}>The intake is done. It gave us the facts — but facts are not the diagnosis. The real work is a discovery conversation: an open, guided session where we learn how the place actually behaves, what its people know that isn't written down, and what the numbers only hint at.</P>
      <Card t={t} style={{ marginTop: 8 }}>
        {[
          ["An open conversation, not a form", "You talk; we steer. There is no questionnaire to fill — the value is in what surfaces when the conversation is allowed to go where it needs to."],
          ["We cover four streams", "Behind the scenes we make sure the conversation touches Internal Capabilities, External Opportunities, Quantitative reality and the Experiential visit — so nothing important is missed."],
          ["Then we go backstage", "We consolidate, score against comparable sites, and reach a considered view — before we ever present anything back to you."],
        ].map(([h, d], i) => (
          <div key={h} style={{ display: "flex", gap: 14, padding: "12px 0", borderTop: i? `1px solid ${t.line}`:"none" }}>
            <div style={{ fontFamily: t.fontHead, color: t.accent, fontSize: 20, flex:"0 0 auto", width: 22 }}>{i+1}</div>
            <div>
              <div style={{ fontFamily: t.fontHead, fontSize: 16.5, color: t.ink }}>{h}</div>
              <div style={{ fontFamily: t.fontBody, fontSize: 14, color: t.muted, marginTop: 3, lineHeight: 1.5 }}>{d}</div>
            </div>
          </div>
        ))}
      </Card>
    </div>
  ));

  /* ---------------- STAGE 2 — DISCOVERY ---------------- */
  add(1, "Discovery · Framing", (
    <div>
      <Kicker t={t}>Stage 2 — Discovery · Screen 1 of 3</Kicker>
      <H t={t}>The discovery conversation</H>
      <P t={t}>This is where the engagement earns its keep. It is a conversation, not an interrogation — usually 60–90 minutes with the people who know the place best. We are listening for the things a form could never capture: the story the site is trying to tell, the frustrations staff have stopped mentioning, the patterns in the numbers nobody has connected.</P>
      <P t={t}>What follows on the next screen is our backstage tool — the coverage checklist the presenter watches while the conversation runs, to make sure it stays complete without ever feeling like a script.</P>
      <Card t={t} tone="alt" style={{ marginTop: 8 }}>
        <div style={{ fontFamily: t.fontHead, fontSize: 16, color: t.ink, marginBottom: 6 }}>Why open, not structured?</div>
        <P t={t} style={{ marginBottom: 0, fontSize: 14.5 }}>Structured intake gets you the facts you already knew to ask for. Open conversation gets you the ones you didn't — and in a diagnosis, the unasked question is usually where the answer lives.</P>
      </Card>
    </div>
  ));

  add(1, "Discovery · Coverage checklist", (
    <div>
      <Kicker t={t}>Stage 2 — Discovery · Screen 2 of 3 · Presenter's backstage tool</Kicker>
      <H t={t}>Coverage checklist</H>
      <P t={t}>The presenter watches this live. Items tick off as they're genuinely covered — not asked, covered. It exists to stop drift: an open conversation is only valuable if it stays complete.</P>
      <Bench t={t}>You're ~40 minutes in and <b>Quantitative</b> is still untouched. That's the anti-drift signal — steer the conversation there before it runs out.</Bench>
      <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
        {Object.values(STREAMS).map((st) => {
          const done = st.coverage.filter((c) => c.done).length;
          return (
            <Card key={st.id} t={t} style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontFamily: t.fontHead, fontSize: 16.5, color: t.ink }}>{st.name}</span>
                <span style={{ fontFamily: t.fontBody, fontSize: 12.5, color: done===st.coverage.length? t.accent : t.muted, fontWeight: 600 }}>{done}/{st.coverage.length} covered</span>
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {st.coverage.map((c) => (
                  <div key={c.t} style={{ display: "flex", gap: 10, alignItems: "center",
                    fontFamily: t.fontBody, fontSize: 14, color: c.done ? t.ink : t.muted }}>
                    <span style={{ width: 18, height: 18, borderRadius: t.mode==="rich"?6:2, flex:"0 0 auto",
                      border: `1.5px solid ${c.done ? t.accent : t.line}`, background: c.done ? t.accent : "transparent",
                      color: "#fff", fontSize: 12, textAlign: "center", lineHeight: "16px" }}>{c.done ? "✓" : ""}</span>
                    <span style={{ textDecoration: c.done ? "none" : "none", opacity: c.done?1:.85 }}>{c.t}</span>
                    {!c.done && <span style={{ fontSize: 11, color: t.faint||t.muted, marginLeft: "auto" }}>not yet</span>}
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  ));

  add(1, "Discovery · Gap-fill", (
    <div>
      <Kicker t={t}>Stage 2 — Discovery · Screen 3 of 3</Kicker>
      <H t={t}>What's still thin</H>
      <P t={t}>The conversation is over. Rather than a second questionnaire, we send back a short, precise ask — only the gaps that actually matter to the diagnosis. Targeted, not exhaustive.</P>
      <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
        {[
          { s: "Quantitative", g: "We have admissions revenue but not spend-per-head or the split across secondary income.", ask: "Could you share the last 12 months of till data by category? One export is enough — we'll do the rest." },
          { s: "External Opportunities", g: "Partnership and funding routes came up but weren't mapped.", ask: "A quick list of any live or lapsed partnerships (tourism boards, schools, funders) — names and status, nothing formal." },
          { s: "Experiential", g: "We heard the visit is thin but haven't seen it through a first-timer's eyes.", ask: "Fifteen minutes of any existing visitor-journey notes or a recent mystery-visit report, if one exists." },
        ].map((r) => (
          <Card key={r.s} t={t} style={{ padding: 16 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontFamily: t.fontHead, fontSize: 15.5, color: t.ink }}>{r.s}</span>
              <Band t={t} band="low" />
            </div>
            <div style={{ fontFamily: t.fontBody, fontSize: 13.5, color: t.muted, lineHeight: 1.5 }}><b style={{color:t.ink}}>Gap:</b> {r.g}</div>
            <div style={{ fontFamily: t.fontBody, fontSize: 13.5, color: t.mode==="rich"?t.accentInk:t.ink, marginTop: 8,
              background: t.accentBg, borderRadius: t.mode==="rich"?8:2, padding: "10px 12px" }}><b>Targeted ask:</b> {r.ask}</div>
          </Card>
        ))}
      </div>
    </div>
  ));

  /* ---------------- STAGE 3 — BACKSTAGE (internal, not client-facing) ---------------- */
  const backstageWrap = (inner) => (
    <div style={{ border: `1px dashed ${t.mode==="rich"?"#b45309":t.warm}`, borderRadius: t.radius,
      background: t.mode==="rich" ? "#1c1a17" : "#22201b", padding: 22, color: "#e9e4d8" }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontFamily: t.fontBody, fontSize: 11,
        letterSpacing: ".16em", textTransform: "uppercase", color: "#e0b877", marginBottom: 16,
        border: "1px solid #6b5a3a", borderRadius: 999, padding: "4px 12px" }}>🔒 Internal — the client never sees this raw</div>
      {inner}
    </div>
  );

  add(2, "Backstage · Consolidation", backstageWrap(
    <div>
      <div style={{ fontFamily: t.fontHead, fontSize: 27, color: "#fff", marginBottom: 8 }}>Consolidation &amp; scoring</div>
      <div style={{ fontFamily: t.fontBody, fontSize: 15, color: "#c9c2b2", lineHeight: 1.6, maxWidth: 640, marginBottom: 18 }}>
        The four streams, consolidated and banded against the comparable-sites set. Bands are anchored to benchmarks, never to opinion — that's what makes them defensible when the founders decide.
      </div>
      {Object.values(STREAMS).map((st) => (
        <div key={st.id} style={{ borderTop: "1px solid #3a352b", padding: "14px 0", display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 280px" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ fontFamily: t.fontHead, fontSize: 17, color: "#fff" }}>{st.name}</span>
              {st.heaviest && <span style={{ fontSize: 10.5, letterSpacing: ".1em", color: "#e0b877", border:"1px solid #6b5a3a", padding:"2px 8px", borderRadius: 999 }}>WEIGHTED HEAVIEST</span>}
            </div>
            <div style={{ fontFamily: t.fontBody, fontSize: 13, color: "#b3ab99", marginTop: 6, lineHeight: 1.5 }}>{st.benchmark}</div>
          </div>
          <div style={{ flex: "0 0 auto", alignSelf: "center" }}>
            <span style={{ fontFamily: t.fontBody, fontSize: 12, letterSpacing:".14em",
              color: st.band==="high"?"#8fd6c6":st.band==="med"?"#e0c877":"#e6a07a", fontWeight: 700 }}>
              {st.band.toUpperCase()}
            </span>
          </div>
        </div>
      ))}
    </div>
  ));

  add(2, "Backstage · Founders' verdict", backstageWrap(
    <div>
      <div style={{ fontFamily: t.fontHead, fontSize: 27, color: "#fff", marginBottom: 8 }}>The founders' verdict</div>
      <div style={{ fontFamily: t.fontBody, fontSize: 15, color: "#c9c2b2", lineHeight: 1.6, maxWidth: 640, marginBottom: 18 }}>
        The engine <i>recommends</i>. The founders <i>decide</i>. This moment is deliberately human — the model's job is to make the recommendation defensible, not to make the call. One of four verdicts is chosen backstage and logged. The client only ever sees the reasoning that flows from it, never this label.
      </div>
      <div style={{ background: "#12110e", border: "1px solid #3a352b", borderRadius: 10, padding: 16, marginBottom: 18 }}>
        <div style={{ fontFamily: t.fontBody, fontSize: 11, letterSpacing: ".14em", color: "#8a836f", textTransform: "uppercase", marginBottom: 6 }}>Engine recommendation</div>
        <div style={{ fontFamily: t.fontHead, fontSize: 18, color: "#8fd6c6" }}>Proceed — high, with a singular fixable root</div>
        <div style={{ fontFamily: t.fontBody, fontSize: 13, color: "#b3ab99", marginTop: 6, lineHeight: 1.5 }}>
          Demand is top-third and proven; the weakness is concentrated in one propagating root (narrative), which comparables show is fixable at high return. Confidence: strong.
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
        {[
          ["Build as-is", "Rare. The thing is already right; just resource it."],
          ["Proceed", "Sound foundation, clear fix. Engage. ← founders selected"],
          ["Reshape", "Worth doing but not as scoped — redefine first."],
          ["Don't proceed", "Kindest to say no. Stated plainly, never buried."],
        ].map(([v, d], i) => (
          <div key={v} style={{ background: i===1?"#1e2c28":"#161511", border: `1px solid ${i===1?"#3f6b60":"#3a352b"}`,
            borderRadius: 10, padding: 14 }}>
            <div style={{ fontFamily: t.fontHead, fontSize: 15.5, color: i===1?"#8fd6c6":"#e9e4d8" }}>{v}</div>
            <div style={{ fontFamily: t.fontBody, fontSize: 12, color: "#a49c88", marginTop: 5, lineHeight: 1.45 }}>{d}</div>
          </div>
        ))}
      </div>
      <div style={{ fontFamily: t.fontBody, fontSize: 12, color: "#8a836f", marginTop: 16 }}>
        Logged 2026-07-09 · decided by founders · rationale attached · surfaced to client only as reasoning (Stage 4).
      </div>
    </div>
  ));

  /* ---------------- STAGE 4 — THE OUTPUT (five beats, deep) ---------------- */
  const beatTag = (n, label, sub) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
      <span style={{ fontFamily: t.fontHead, fontSize: 13, color: t.accent, fontWeight: 700 }}>Beat {n}</span>
      <span style={{ fontFamily: t.fontBody, fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase", color: t.muted }}>{label}{sub?` · ${sub}`:""}</span>
    </div>
  );

  // BEAT 1 — FINDINGS (4 screens)
  add(3, "Beat 1 · Findings — overview", (
    <div>
      {beatTag(1, "Findings", "Read-only · presenter-led")}
      <H t={t}>What the discovery surfaced</H>
      <P t={t}>Four streams, one read each. Three of them describe the commercial reality of the fort. The fourth — the experiential one — is not a peer of the other three. It is the finding that most determines whether any of the others can move, so we'll spend the most time there.</P>
      <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
        {Object.values(STREAMS).map((st) => (
          <Card key={st.id} t={t} style={{ padding: 16, borderLeft: st.heaviest? `4px solid ${t.accent}`: `1px solid ${t.line}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontFamily: t.fontHead, fontSize: 17, color: t.ink }}>
                {st.name}{st.heaviest && <span style={{ fontFamily: t.fontBody, fontSize: 11, color: t.accent, marginLeft: 10, letterSpacing:".06em" }}>— THE ONE THAT MOST DETERMINES SUCCESS</span>}
              </span>
              <Band t={t} band={st.band} />
            </div>
            <div style={{ fontFamily: t.fontBody, fontSize: 14, color: t.muted, marginTop: 8, lineHeight: 1.55 }}>{st.finding}</div>
          </Card>
        ))}
      </div>
    </div>
  ));

  add(3, "Beat 1 · The commercial findings", (
    <div>
      {beatTag(1, "Findings", "The commercial side")}
      <H t={t}>The commercial picture: strong bones, weak returns</H>
      <P t={t}>Read the three commercial streams together and a pattern appears. The demand is real and the team is capable — but almost none of that demand is converting into value, and the income rests on a single fragile line.</P>
      {["external", "internal", "quant"].map((id) => {
        const st = STREAM_BY[id];
        return (
          <Card key={id} t={t} style={{ marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontFamily: t.fontHead, fontSize: 17, color: t.ink }}>{st.name}</span><Band t={t} band={st.band} />
            </div>
            <div style={{ fontFamily: t.fontBody, fontSize: 14.5, color: t.muted, lineHeight: 1.6 }}>{st.finding}</div>
            <Bench t={t}>{st.benchmark}</Bench>
          </Card>
        );
      })}
    </div>
  ));

  add(3, "Beat 1 · The experiential finding", (
    <div>
      {beatTag(1, "Findings", "The one that matters most")}
      <H t={t}>The experiential finding, in depth</H>
      <P t={t}>Hold the commercial numbers in mind, then look at what causes them. A visitor arrives at a genuinely remarkable place — and is given nothing to make sense of it. No story, nothing programmed, nothing that rewards staying or returning.</P>
      <Card t={t} tone="alt" style={{ marginTop: 8, borderLeft: `4px solid ${t.accent}` }}>
        <div style={{ fontFamily: t.fontBody, fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: t.accent, marginBottom: 8 }}>Weighted heaviest — not one quarter of four</div>
        <div style={{ fontFamily: t.fontBody, fontSize: 16, color: t.ink, lineHeight: 1.6 }}>{STREAM_BY.exp.finding}</div>
      </Card>
      <P t={t} style={{ marginTop: 16 }}>Why does this one outweigh the others? Because across the comparable set, the experiential score is the single best predictor of spend, dwell and repeat — the three numbers the fort is failing on. Fix the commercial symptoms directly and they drift back. Fix the experience and they move on their own.</P>
      <Bench t={t}>{STREAM_BY.exp.benchmark}</Bench>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
        <Stat t={t} label="Spend / head" value="£4.20" sub="bottom third" />
        <Stat t={t} label="Dwell" value="45 min" sub="bottom third" />
        <Stat t={t} label="Repeat" value="8%" sub="bottom third" />
        <Stat t={t} label="All three trace to" value="one root" sub="the experience" emphasise />
      </div>
    </div>
  ));

  add(3, "Beat 1 · Benchmark comparison", (
    <div>
      {beatTag(1, "Findings", "The comparables")}
      <H t={t}>Where the fort sits in its set</H>
      <P t={t}>Every band above is anchored to the same comparable set — 14 coastal forts and heritage properties in the fort's tier. Here is the fort against that set, so nothing rests on our opinion. This is the last read-only findings screen; from here we move to <i>why</i>.</P>
      <div className="scrollx" style={{ marginTop: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 560, fontFamily: t.fontBody }}>
          <thead>
            <tr style={{ textAlign: "left" }}>
              {["Measure", "This fort", "Comparable set", "Position"].map((h) => (
                <th key={h} style={{ fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", color: t.muted,
                  padding: "8px 12px", borderBottom: `2px solid ${t.line}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ["Annual footfall", "200,000", "40k–210k", "Top third", "high"],
              ["Spend per head", "£4.20", "£9–£13", "Bottom third", "low"],
              ["Dwell time", "45 min", "110–140 min", "Bottom third", "low"],
              ["Repeat visitation", "8%", "18–24%", "Bottom third", "low"],
              ["Revenue lines", "1 (admissions 86%)", "3–5 balanced", "Bottom third", "low"],
              ["Interpretation lead", "None", "Standard in top third", "Gap", "low"],
            ].map((r) => (
              <tr key={r[0]}>
                <td style={{ padding: "10px 12px", borderBottom: `1px solid ${t.line}`, color: t.ink, fontSize: 14.5 }}>{r[0]}</td>
                <td style={{ padding: "10px 12px", borderBottom: `1px solid ${t.line}`, color: t.ink, fontSize: 14.5, fontWeight: 600 }}>{r[1]}</td>
                <td style={{ padding: "10px 12px", borderBottom: `1px solid ${t.line}`, color: t.muted, fontSize: 14 }}>{r[2]}</td>
                <td style={{ padding: "10px 12px", borderBottom: `1px solid ${t.line}` }}><Band t={t} band={r[4]} /> <span style={{ color: t.muted, fontSize: 13, marginLeft: 6 }}>{r[3]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <P t={t} style={{ marginTop: 14, fontSize: 14 }}>One line is top third. Five are bottom third. That is not five separate problems — as the next beat shows, it is one.</P>
    </div>
  ));

  // BEAT 2 — WHY / THE ROOT (4 screens, progressive reveal)
  const whyScreen = (n, reveal, heading, body, extra) => add(3, `Beat 2 · Why — ${n}/4`, (
    <div>
      {beatTag(2, "Why · the root", "The insight beat")}
      <H t={t}>{heading}</H>
      {body}
      <div style={{ display: "flex", justifyContent: "flex-end", margin: "6px 0 14px" }}>
        <WhyToggle t={t} mode={whyMode} setMode={setWhyMode} />
      </div>
      <Card t={t} tone="alt" style={{ padding: 22 }}>
        <WhyVisual t={t} mode={whyMode} reveal={reveal} />
      </Card>
      {extra}
    </div>
  ));

  whyScreen(1, 1, "It starts in one place",
    <P t={t}>Before we connect anything, sit with the root on its own. Everything the findings surfaced begins here: the fort has no narrative spine. There is no single story the place is trying to tell, so every downstream decision is made without one. Switch the rendering (A/B/C) to see the same idea three ways — we'll build the chain out step by step.</P>);

  whyScreen(2, 2, "A weak story starves the programming",
    <P t={t}>Add the first link. With no story to build around, programming stays thin — you can't design events, routes or seasonal moments when there's no spine to hang them on. So the site offers one thing to do: look at it. That's the first propagation, and it's not a coincidence — it's caused.</P>);

  whyScreen(3, 3, "Thin programming leaves one thing to sell",
    <P t={t}>Add the next link. If there's nothing programmed, there's nothing to sell but the ticket. No reason to open a café that people would linger in, no retail tied to a story, no venue hire built on a reputation. Income collapses onto a single line — admissions — which is exactly what the numbers showed.</P>);

  whyScreen(4, null, "One problem, wearing four disguises",
    <P t={t}>Now the whole chain. Weak narrative → thin programming → one revenue line → weak economics. The four findings were never four problems. They are one problem propagating downstream, showing up as four symptoms. That is why fixing symptoms directly never held: you were treating the disguises.</P>,
    <Bench t={t}>This exact propagation repeats across the comparable set: sites that scored low on narrative scored low on spend, dwell and repeat almost without exception. The pattern is real, not particular to this fort — which is also why the fix is known.</Bench>);

  // BEAT 3 — THE CONCLUSION (3 screens) — verdict must EMERGE, never stamped
  add(3, "Beat 3 · Conclusion — what's true", (
    <div>
      {beatTag(3, "The conclusion", "1 of 3")}
      <H t={t}>Here's what's true</H>
      <P t={t}>Start with the two facts that aren't in dispute. First: the footfall is already here. 200,000 people arrive every year with almost no marketing — that is the expensive, uncertain thing most sites spend a decade trying to build, and this fort has it.</P>
      <P t={t}>Second: the weakness is singular. We traced every failing number back to one root and watched it propagate. This isn't a site with four things wrong; it's a site with one thing wrong, wearing four disguises — and that one thing, comparables tell us, is fixable.</P>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
        <Stat t={t} label="Already have (rare)" value="200k" sub="proven annual demand" emphasise />
        <Stat t={t} label="Root causes" value="1" sub="not four" emphasise />
        <Stat t={t} label="Comparable precedent" value="14 sites" sub="the fix is known" />
      </div>
    </div>
  ));

  add(3, "Beat 3 · Conclusion — what it means", (
    <div>
      {beatTag(3, "The conclusion", "2 of 3")}
      <H t={t}>Here's what that means</H>
      <P t={t}>Put those two truths together. If the demand is already here and the weakness is a single fixable root, then the order of operations flips from how it's usually framed. You don't chase the economics. You fix the story, and the economics follow it.</P>
      <P t={t}>That is not a slogan — it's what the propagation guarantees. A stronger narrative makes real programming possible; programming opens revenue lines beyond the ticket; multiple revenue lines lift spend, dwell and repeat. The numbers you want are downstream of the one thing you can actually change.</P>
      <Card t={t} tone="alt" style={{ marginTop: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", fontFamily: t.fontHead, fontSize: 16.5, color: t.ink }}>
          <span>Fix the story</span><span style={{ color: t.accent }}>→</span>
          <span>programming becomes possible</span><span style={{ color: t.accent }}>→</span>
          <span>revenue lines open</span><span style={{ color: t.accent }}>→</span>
          <span style={{ color: t.accent }}>the economics follow</span>
        </div>
      </Card>
    </div>
  ));

  add(3, "Beat 3 · Conclusion — worth building", (
    <div>
      {beatTag(3, "The conclusion", "3 of 3")}
      <H t={t}>So — where does that leave the fort?</H>
      <P t={t}>You have the hardest, most expensive ingredient already: people, in volume, choosing to come. What's missing is a single thing — a story — and everything the fort is failing on sits downstream of it. The upside is real and the cause is known.</P>
      <P t={t}>Which means the work in front of you is narrower than it looks. You are not rebuilding the fort, re-founding the organisation, or chasing new audiences. You are giving a place that people already love a reason to stay, spend and come back. That is a focused piece of work with precedent behind it — and the roadmap on the next screens shows exactly what it involves.</P>
      <Card t={t} style={{ marginTop: 8, borderLeft: `4px solid ${t.accent}` }}>
        <div style={{ fontFamily: t.fontHead, fontSize: 18, color: t.ink, lineHeight: 1.4 }}>
          The demand is proven, the root is singular and fixable, and the fix is narrower than it first appears.
        </div>
        <div style={{ fontFamily: t.fontBody, fontSize: 13.5, color: t.muted, marginTop: 8 }}>
          You reach the conclusion yourself — the reasoning got you there. No label required.
        </div>
      </Card>
    </div>
  ));

  // BEAT 4 — THE ROADMAP (4 screens, interactive, bounded)
  add(3, "Beat 4 · Roadmap — the moves", (
    <div>
      {beatTag(4, "The roadmap", "Interactive · 1 of 4")}
      <H t={t}>What to do, in order</H>
      <P t={t}>The diagnosis is settled and does not change from here — only the path forward does. These are the moves, ranked by return, each anchored to what comparable sites actually achieved. The root comes first because everything else depends on it landing.</P>
      <RoadmapList t={t} model={model} showEconomics={true} />
    </div>
  ));

  add(3, "Beat 4 · Roadmap — the lever", (
    <div>
      {beatTag(4, "The roadmap", "Interactive · 2 of 4")}
      <H t={t}>Set the ambition — watch the path re-cost</H>
      <P t={t}>This is the one place you get to move something. Slide the ambition of the target and the roadmap live re-costs and re-orders: costs, payoffs and the running order all respond. The diagnosis above doesn't budge — only the plan to act on it does.</P>
      <AmbitionLever t={t} ambition={ambition} setAmbition={setAmbition} model={model} />
      <RoadmapList t={t} model={model} showEconomics={true} />
    </div>
  ));

  add(3, "Beat 4 · Roadmap — bounded to reality", (
    <div>
      {beatTag(4, "The roadmap", "Interactive · 3 of 4")}
      <H t={t}>Why you can't slide it into fantasy</H>
      <P t={t}>The lever is bounded on purpose. It stops exactly where the comparable evidence stops — at the top third of the set. You cannot dial spend, dwell or repeat past what real sites in this tier have actually reached, so every projection on the roadmap stays defensible in a board meeting.</P>
      <AmbitionLever t={t} ambition={ambition} setAmbition={setAmbition} model={model} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginTop: 4 }}>
        {[
          ["Spend / head", `£${model.spend.toFixed(2)}`, `hard cap £${BENCH.spendTop.toFixed(2)} — comparable top third`],
          ["Dwell time", `${Math.round(model.dwell)} min`, `hard cap ${BENCH.dwellTop} min — comparable top third`],
          ["Repeat rate", `${Math.round(model.repeat)}%`, `hard cap ${BENCH.repeatTop}% — comparable top third`],
        ].map(([l, v, c]) => (
          <Card key={l} t={t} style={{ padding: 14 }}>
            <div style={{ fontFamily: t.fontHead, fontSize: 22, color: t.accent }}>{v}</div>
            <div style={{ fontFamily: t.fontBody, fontSize: 12.5, color: t.ink, marginTop: 4 }}>{l}</div>
            <div style={{ fontFamily: t.fontBody, fontSize: 11.5, color: t.muted, marginTop: 3 }}>{c}</div>
          </Card>
        ))}
      </div>
      <Bench t={t}>The slider physically stops at 100% = the top of the comparable range. The client can explore ambition freely and still cannot produce a number the evidence won't support.</Bench>
    </div>
  ));

  add(3, "Beat 4 · Roadmap — the sequence", (
    <div>
      {beatTag(4, "The roadmap", "Interactive · 4 of 4")}
      <H t={t}>The sequence, at your chosen ambition</H>
      <P t={t}>At the ambition you've set, here is the running order and the total picture. Notice the top of the list barely moves — the root and its first propagation lead at any ambition. What changes further down is which later moves are worth their cost, and when.</P>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <Stat t={t} label="Total first-year cost" value={money(model.totalCostK)} emphasise />
        <Stat t={t} label="Total annual payoff" value={money(model.totalPayoffK)} emphasise />
        <Stat t={t} label="Projected visitor revenue" value={money(model.revProjK)} sub={`today ${money(model.revNowK)}`} />
      </div>
      <RoadmapList t={t} model={model} showEconomics={true} />
    </div>
  ));

  // BEAT 5 — WHAT'S NEXT (3 screens, emergent scoping not upsell)
  add(3, "Beat 5 · What's next — the shape", (
    <div>
      {beatTag(5, "What's next", "1 of 3")}
      <H t={t}>The roadmap is bigger than the first engagement</H>
      <P t={t}>You've now seen the full roadmap — five moves. It's worth being straight about something the ranking already implies: the first engagement does not cover all five. That isn't a limitation to apologise for. It's what honest sequencing looks like.</P>
      <P t={t}>The moves depend on each other. Several of them simply cannot succeed until the story lands and the programming proves itself. Doing them first wouldn't be ambitious — it would be building on sand.</P>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
        <Stat t={t} label="On the roadmap" value="5 moves" />
        <Stat t={t} label="First engagement" value="2 moves" sub="the root + its first propagation" emphasise />
        <Stat t={t} label="Deferred" value="3 moves" sub="honest scoping, not upsell" />
      </div>
    </div>
  ));

  add(3, "Beat 5 · What's next — first vs later", (
    <div>
      {beatTag(5, "What's next", "2 of 3")}
      <H t={t}>What we'd do first, and what sits beyond it</H>
      <P t={t}>Here's the split, stated as scoping rather than sales. The first engagement takes on the root and the move that proves it. The rest sit deliberately beyond that line — named honestly so you can see the whole picture, sequenced so each one starts only when the one before has earned it.</P>
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10, marginTop: 8 }}>
        {model.ranked.map((r) => {
          const first = FIRST_ENGAGEMENT.includes(r.id);
          return (
            <Card key={r.id} t={t} style={{ padding: 14, opacity: first?1:.9,
              borderLeft: `4px solid ${first? t.accent : t.line}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontFamily: t.fontHead, fontSize: 16, color: t.ink }}>{r.name}</span>
                <span style={{ fontFamily: t.fontBody, fontSize: 11.5, fontWeight: 700,
                  color: first? t.accent : t.muted, background: first? t.accentBg : "transparent",
                  padding: first?"3px 10px":0, borderRadius: 999 }}>
                  {first ? "FIRST ENGAGEMENT" : "SITS BEYOND WHAT WE'D DO FIRST"}
                </span>
              </div>
              <div style={{ fontFamily: t.fontBody, fontSize: 13, color: t.muted, marginTop: 6, lineHeight: 1.5 }}>
                {first ? r.blurb : `${r.blurb} — worth doing, but only once the story has landed and the programming has proven itself. We'd scope it then, not now.`}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  ));

  add(3, "Beat 5 · What's next — the close", (
    <div>
      {beatTag(5, "What's next", "3 of 3")}
      <H t={t}>Where this leaves you</H>
      <P t={t}>So the next step isn't a pitch — it emerges on its own from everything above. The diagnosis pointed to one root. The roadmap ranked the fix. The sequencing showed which part earns the right to go first. What's left is simply to start where the evidence says to start: the narrative spine, and the first programming that proves it.</P>
      <P t={t}>Everything beyond that is real, named, and waiting — but only when the fort has earned its way to it. That's the whole engagement, from first contact to a plan you could defend to your board tomorrow.</P>
      <Card t={t} tone="alt" style={{ marginTop: 8 }}>
        <div style={{ fontFamily: t.fontHead, fontSize: 17, color: t.ink, marginBottom: 6 }}>Start here</div>
        <div style={{ fontFamily: t.fontBody, fontSize: 14.5, color: t.muted, lineHeight: 1.6 }}>
          Engagement one: rebuild the narrative spine and layer the first programming onto it. Cost and payoff exactly as ranked above. Everything else is sequenced behind it, in the open — and Stage 5 is how we keep the build honest to this plan.
        </div>
      </Card>
    </div>
  ));

  /* ---------------- STAGE 5 — THE RETAINER ---------------- */
  add(4, "Retainer · Alignment readout", (
    <div>
      <Kicker t={t}>Stage 5 — The retainer · Screen 1 of 2</Kicker>
      <H t={t}>Alignment readout</H>
      <P t={t}>The diagnosis was the start, not the end. During the build, decisions accumulate — and each one either holds the defined target or nudges away from it. The retainer exists to catch drift while it's still cheap to correct. Here is the fort's target line against where its decisions actually landed over six review cycles.</P>
      <Card t={t} style={{ marginTop: 8 }}>
        <AlignmentTrail t={t} />
      </Card>
      <P t={t} style={{ marginTop: 14, fontSize: 14 }}>By cycle 4 the build had drifted — a decision to prioritise a car-park expansion over the interpretation fit-out pulled it off the narrative spine. Caught here, it's a conversation. Caught at opening, it's the whole problem, again.</P>
    </div>
  ));

  add(4, "Retainer · Stakeholder cuts", (
    <div>
      <Kicker t={t}>Stage 5 — The retainer · Screen 2 of 2</Kicker>
      <H t={t}>The same read, three ways</H>
      <P t={t}>Drift only gets corrected if each stakeholder can act on it. So the same alignment read is delivered in three framings — owner, project manager, operator. Note what it assesses: decision-to-strategy fit, never the people. Nobody is being marked; the plan is.</P>
      <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
        {[
          { r: "Owner", q: "Is the investment still tracking to the strategic outcome we agreed?",
            a: "Two of six cycles drifted; both are recoverable this quarter. The narrative-first sequence is intact, so the core thesis still holds — but the car-park decision needs revisiting before it hardens.", tone:"accent" },
          { r: "Project Manager", q: "Are the build decisions consistent with the defined target?",
            a: "Cycle 4's re-prioritisation broke sequence: capital moved to dwell infrastructure before the narrative fit-out it depends on. Re-order these two work packages and alignment returns to green.", tone:"alt" },
          { r: "Operator", q: "Does the day-to-day still match what the visitor was promised?",
            a: "Front-of-house is delivering the current offer well. The risk isn't performance — it's that the programming the team was promised to run is slipping behind the build, so there'll be a story with nothing scheduled around it.", tone:"" },
        ].map((c) => (
          <Card key={c.r} t={t} tone={c.tone==="alt"?"alt":undefined} style={{ borderLeft: c.tone==="accent"? `4px solid ${t.accent}`:undefined }}>
            <div style={{ fontFamily: t.fontBody, fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: t.muted, marginBottom: 4 }}>Delivered to · {c.r}</div>
            <div style={{ fontFamily: t.fontHead, fontSize: 16.5, color: t.ink, marginBottom: 8 }}>{c.q}</div>
            <div style={{ fontFamily: t.fontBody, fontSize: 14.5, color: t.muted, lineHeight: 1.6 }}>{c.a}</div>
          </Card>
        ))}
      </div>
      <div style={{ fontFamily: t.fontBody, fontSize: 12.5, color: t.muted, textAlign: "center", marginTop: 20 }}>
        End of the walkthrough — first contact to ongoing retainer. Toggle the UI direction at the top, or the A/B/C rendering back in Beat 2.
      </div>
    </div>
  ));

  return S;
}

// The alignment dot-trail: a defined target line and the actual decision path drifting.
function AlignmentTrail({ t }) {
  const W = 620, Hh = 220, padL = 44, padR = 20, padT = 20, padB = 34;
  const cycles = [0, 1, 2, 3, 4, 5];
  const target = 50;                          // the defined-target line (constant)
  const actual = [50, 49, 51, 47, 32, 38];    // decisions drift down at cycle 4, partial recovery
  const x = (i) => padL + (i / (cycles.length - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - v / 100) * (Hh - padT - padB);
  const acc = t.accent, warm = t.mode === "rich" ? "#b45309" : t.warm;
  const path = actual.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  return (
    <div className="scrollx">
      <svg viewBox={`0 0 ${W} ${Hh}`} style={{ width: "100%", minWidth: 520, display: "block" }}>
        {/* target line */}
        <line x1={padL} y1={y(target)} x2={W - padR} y2={y(target)} stroke={acc} strokeWidth="1.5" strokeDasharray="5 5" />
        <text x={padL} y={y(target) - 8} fill={acc} fontSize="11" fontFamily={t.fontBody}>Defined target</text>
        {/* drift band shading under actual where it falls below target */}
        <path d={`${path} L${x(actual.length-1)},${y(target)} L${x(0)},${y(target)} Z`} fill={warm} opacity="0.10" />
        {/* actual decision path */}
        <path d={path} fill="none" stroke={warm} strokeWidth="2.5" />
        {actual.map((v, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(v)} r="5" fill={Math.abs(v - target) > 8 ? warm : acc} />
            <text x={x(i)} y={Hh - 12} fill={t.muted} fontSize="11" fontFamily={t.fontBody} textAnchor="middle">C{i + 1}</text>
          </g>
        ))}
        <text x={x(4)} y={y(actual[4]) + 20} fill={warm} fontSize="11" fontFamily={t.fontBody} textAnchor="middle">drift</text>
      </svg>
      <div style={{ display: "flex", gap: 18, marginTop: 6, fontFamily: t.fontBody, fontSize: 12, color: t.muted, flexWrap: "wrap" }}>
        <span><span style={{ display:"inline-block", width:16, height:2, background:acc, verticalAlign:"middle", marginRight:6 }} />Defined target (the strategy)</span>
        <span><span style={{ display:"inline-block", width:16, height:2, background:warm, verticalAlign:"middle", marginRight:6 }} />Where decisions actually landed</span>
      </div>
    </div>
  );
}

/* ============================================================================
   SHELL — persistent progress indicator, global toggles, back/next
   ========================================================================== */
const STAGES = ["Entry", "Discovery", "Backstage", "The Output", "Retainer"];

function App() {
  const [uiMode, setUiMode] = useState("minimal");
  const [whyMode, setWhyMode] = useState("chain");
  const [idx, setIdx] = useState(0);
  const [ambition, setAmbition] = useState(0.6);
  const [J, setJ] = useState({
    front: "reset",
    pf: {
      name: "Coastal Heritage Fort",
      stage: "Operating — under review",
      exists: "Open site, 200k visitors/yr, admissions only",
      budget: "£250k–£500k",
      timeline: "12–18 months",
    },
  });

  const t = useMemo(() => theme(uiMode), [uiMode]);
  const model = useMemo(() => computeModel(ambition), [ambition]);
  const screens = useMemo(
    () => buildScreens({ t, J, setJ, ambition, setAmbition, whyMode, setWhyMode, model }),
    [t, J, ambition, whyMode, model]
  );

  const cur = screens[idx];
  const atStart = idx === 0, atEnd = idx === screens.length - 1;

  // progress: how far through each stage
  const stageOf = (i) => screens[i].stage;
  const curStage = cur.stage;
  const go = useCallback((d) => {
    setIdx((i) => Math.max(0, Math.min(screens.length - 1, i + d)));
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, [screens.length]);
  const jumpToStage = (sIdx) => {
    const first = screens.findIndex((s) => s.stage === sIdx);
    if (first >= 0) { setIdx(first); window.scrollTo({ top: 0, behavior: "smooth" }); }
  };

  // per-stage screen position for the sub-progress dots
  const stageScreens = screens.filter((s) => s.stage === curStage);
  const posInStage = stageScreens.findIndex((s) => s === cur);

  return (
    <div style={{ background: t.bg, minHeight: "100vh", fontFamily: t.fontBody, color: t.ink }}>
      {/* ---- TOP BAR: brand + global toggles ---- */}
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: t.bg,
        borderBottom: `1px solid ${t.line}`, backdropFilter: "saturate(1.2)" }}>
        <div style={{ maxWidth: t.maxw, margin: "0 auto", padding: "12px 20px",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontFamily: t.fontHead, fontSize: 19, fontWeight: 700, letterSpacing: t.mode==="minimal"?"-.01em":"0" }}>Rūya</span>
            <span style={{ fontFamily: t.fontBody, fontSize: 12, color: t.muted, letterSpacing: ".04em" }}>decision-support walkthrough · prototype</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: t.muted }}>UI:</span>
            <div style={{ display: "inline-flex", gap: 4, background: t.panel2, padding: 4, borderRadius: t.mode==="rich"?999:3, border:`1px solid ${t.line}` }}>
              {[["minimal", "Minimal"], ["rich", "Rich"]].map(([k, l]) => (
                <button key={k} onClick={() => setUiMode(k)} style={{
                  border: "none", background: uiMode === k ? (t.mode==="rich"?t.accent:t.ink) : "transparent",
                  color: uiMode === k ? "#fff" : t.muted, padding: "6px 14px", borderRadius: t.mode==="rich"?999:2,
                  fontSize: 12.5, fontWeight: 600 }}>{l}</button>
              ))}
            </div>
          </div>
        </div>

        {/* ---- PERSISTENT PROGRESS INDICATOR (five stages) ---- */}
        <div style={{ maxWidth: t.maxw, margin: "0 auto", padding: "0 20px 12px" }}>
          <div style={{ display: "flex", gap: 8 }}>
            {STAGES.map((s, i) => {
              const active = i === curStage, done = i < curStage;
              return (
                <button key={s} onClick={() => jumpToStage(i)} style={{
                  flex: 1, textAlign: "left", border: "none", background: "transparent", padding: 0 }}>
                  <div style={{ height: 4, borderRadius: 999,
                    background: active ? (t.mode==="rich"?t.accent:t.ink) : done ? (t.mode==="rich"?t.accentBg:t.line) : t.line,
                    marginBottom: 6, opacity: done?1:active?1:.7 }} />
                  <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                    <span style={{ fontSize: 11, color: active? t.ink : t.muted, fontWeight: active?700:500 }}>{i + 1}</span>
                    <span style={{ fontSize: 11.5, color: active? t.ink : t.muted, fontWeight: active?700:500,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ---- SCREEN BODY ---- */}
      <div style={{ maxWidth: t.maxw, margin: "0 auto", padding: "30px 20px 40px" }}>
        <div key={idx} className="fadein">{cur.node}</div>
      </div>

      {/* ---- BOTTOM NAV ---- */}
      <div style={{ position: "sticky", bottom: 0, background: t.bg, borderTop: `1px solid ${t.line}` }}>
        <div style={{ maxWidth: t.maxw, margin: "0 auto", padding: "12px 20px",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <button onClick={() => go(-1)} disabled={atStart} style={{
            border: `1px solid ${t.line}`, background: t.panel, color: atStart? t.line : t.ink,
            padding: "10px 18px", borderRadius: t.mode==="rich"?999:3, fontSize: 14, fontWeight: 600,
            opacity: atStart?.5:1 }}>← Back</button>

          <div style={{ textAlign: "center", minWidth: 0 }}>
            <div style={{ fontSize: 12.5, color: t.ink, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{cur.label}</div>
            <div style={{ display: "flex", gap: 4, justifyContent: "center", marginTop: 5 }}>
              {stageScreens.map((_, i) => (
                <span key={i} style={{ width: i===posInStage?16:6, height: 6, borderRadius: 999,
                  background: i===posInStage? (t.mode==="rich"?t.accent:t.ink) : t.line, transition: "width .2s" }} />
              ))}
            </div>
          </div>

          <button onClick={() => go(1)} disabled={atEnd} style={{
            border: "none", background: atEnd? t.line : (t.mode==="rich"?t.accent:t.ink), color: "#fff",
            padding: "10px 22px", borderRadius: t.mode==="rich"?999:3, fontSize: 14, fontWeight: 600,
            opacity: atEnd?.5:1 }}>{atEnd ? "End" : "Next →"}</button>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
