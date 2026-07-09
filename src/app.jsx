const { useState, useMemo, useCallback } = React;

/* ============================================================================
   SCORING & LEVER MATH — SINGLE SOURCE OF TRUTH
   ----------------------------------------------------------------------------
   All scoring and route economics live here in one bounded, weighted model.
   Every lever has a realistic min/max drawn from a comparable-sites benchmark
   set, so outputs stay defensible and the client cannot produce nonsense.

   The DIAGNOSIS (findings, root, conclusion — beats 1-3) never depends on this
   function. Only the ROUTE FORWARD (beat 4) does. Swap this out later without
   touching the diagnosis screens.

   Running example: a heritage coastal fort with ~200k annual visitors who do
   not stay, spend, or return. Benchmarks are the trust's comparable-sites set
   (n=14 coastal forts & heritage properties in the same tier).
   ========================================================================== */

const BENCH = {
  visitors: 200000,               // proven demand — the rare asset
  spendNow: 4.2,  spendTop: 11.0, // £/head today vs comparable top third (cap)
  dwellNow: 45,   dwellTop: 130,  // minutes on site
  repeatNow: 8,   repeatTop: 22,  // % returning within 12 months
};

// Constraints the client can pull off the table (Beat-4 checkboxes). A move
// tagged with a removed constraint drops out and the route re-solves around it.
const OFF_TABLE = [
  { id: "staffing",   label: "We can’t touch staffing",  short: "staffing is off the table" },
  { id: "capital",    label: "No capital works",         short: "capital works are off the table" },
  { id: "membership", label: "No membership scheme",      short: "a membership scheme is off the table" },
];

// Each move: benchmark-anchored payoff CAP, a fixed + ambition-variable cost,
// dependencies (what must land first), a duration, whether it needs a closure
// window, and constraint tags. Different cost curves make the route re-order as
// ambition moves; deps + tags + budget + horizon make legs gate on and off.
const MOVES = [
  { id: "narrative", name: "Rebuild the narrative spine", root: true,
    blurb: "A single interpretive story the whole site tells — the fix everything else hangs off.",
    capK: 420, cfixK: 45, cvarK: 20, deps: [], months: 4, needsClosure: false, tags: [],
    benchmark: "Comparable sites with a defined interpretive lead average £9–£13 / head.",
    defer: "", deferShort: "" },
  { id: "programming", name: "Layer programming onto the story",
    blurb: "Events, guided routes and seasonal changes that give the narrative something to do.",
    capK: 310, cfixK: 60, cvarK: 90, deps: ["narrative"], months: 6, needsClosure: false, tags: ["staffing"],
    benchmark: "Programmed sites in the set run 6–11 changing offers a year; this fort runs 1.",
    defer: "Can’t begin until the narrative defines what there is to programme around.",
    deferShort: "After the narrative lands" },
  { id: "dwell", name: "Build dwell-time infrastructure",
    blurb: "Café, seating, wayfinding and shelter so a longer visit is physically possible.",
    capK: 280, cfixK: 180, cvarK: 200, deps: ["narrative"], months: 10, needsClosure: true, tags: ["capital"],
    benchmark: "Top-third sites hold visitors 110–140 min; food & beverage drives most of the gap.",
    defer: "Waits on the narrative: until the story says what a longer visit is for, new space is just square footage.",
    deferShort: "After the narrative lands" },
  { id: "revenue", name: "Open a second revenue line",
    blurb: "Retail and venue hire so income no longer rests on admissions alone.",
    capK: 220, cfixK: 120, cvarK: 190, deps: ["programming"], months: 8, needsClosure: false, tags: ["capital"],
    benchmark: "In the set, admissions rarely exceed 55% of income; here it is 86%.",
    defer: "Only sells once programming gives people a reason to be there worth attaching a shop or a hire to.",
    deferShort: "After programming lands" },
  { id: "repeat", name: "Engineer reasons to return",
    blurb: "Membership and a changing programme so the visit is worth repeating.",
    capK: 180, cfixK: 40, cvarK: 160, deps: ["programming"], months: 9, needsClosure: false, tags: ["staffing", "membership"],
    benchmark: "Repeat visitation runs 18–24% at comparable sites; here it is 8%.",
    defer: "A membership means nothing until there’s a changing programme to be a member of.",
    deferShort: "After programming lands" },
];
const MOVE_BY = Object.fromEntries(MOVES.map((m) => [m.id, m]));
const FIRST_ENGAGEMENT = ["narrative", "programming"]; // the root + its first propagation

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const depNames = (m) => m.deps.map((d) => MOVE_BY[d].name.toLowerCase()).join(" and ");

// levers = { ambition:0..1, horizon:months, budgetK:£k ceiling, canClose:bool, offTable:[tagId] }
function computeModel(levers) {
  const a = clamp01(levers.ambition);
  const { horizon, budgetK, canClose, offTable } = levers;

  // TARGET metrics interpolate today -> comparable top third, capped at the top.
  const target = {
    spend:  BENCH.spendNow  + (BENCH.spendTop  - BENCH.spendNow)  * a,
    dwell:  BENCH.dwellNow  + (BENCH.dwellTop  - BENCH.dwellNow)  * a,
    repeat: BENCH.repeatNow + (BENCH.repeatTop - BENCH.repeatNow) * a,
  };

  // Per-move economics. Payoff linear in ambition to its cap; cost convex
  // (cfix + cvar*a^2) so the ROI ranking re-orders as ambition changes.
  const rows = MOVES.map((m) => {
    const payoffK = m.capK * a;
    const costK = m.cfixK + m.cvarK * a * a;
    return { ...m, payoffK, costK, roi: costK > 0 ? payoffK / costK : 0 };
  });
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

  // Route order preference: root pinned first, then by ROI.
  const pref = [...rows].sort((x, y) =>
    x.root && !y.root ? -1 : y.root && !x.root ? 1 : y.roi - x.roi);

  // Greedy fix-point solve: repeatedly include the best affordable move whose
  // dependencies are already in and whose constraints allow it, until none fit.
  const included = new Set();
  const decided = {};
  let spentK = 0, months = 0;
  const blockedByTag = (m) => m.tags.find((tag) => offTable.includes(tag));
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of pref) {
      if (decided[m.id]) continue;
      if (blockedByTag(m) || (m.needsClosure && !canClose)) continue;
      if (!m.deps.every((d) => included.has(d))) continue;
      if (spentK + m.costK <= budgetK && months + m.months <= horizon) {
        included.add(m.id);
        decided[m.id] = { status: "on-route" };
        spentK += m.costK; months += m.months; changed = true; break;
      }
    }
  }
  // Reasons for everything left off the route.
  for (const m of pref) {
    if (decided[m.id]) continue;
    const tag = blockedByTag(m);
    if (tag) decided[m.id] = { status: "excluded", reason: OFF_TABLE.find((o) => o.id === tag).short };
    else if (m.needsClosure && !canClose) decided[m.id] = { status: "excluded", reason: "needs a closure window the site won’t allow" };
    else if (!m.deps.every((d) => included.has(d))) decided[m.id] = { status: "gated", reason: `unlocks after ${depNames(m)}` };
    else if (spentK + m.costK > budgetK) decided[m.id] = { status: "over-budget", reason: "beyond the budget ceiling" };
    else decided[m.id] = { status: "beyond-horizon", reason: `won’t fit inside ${horizon} months` };
  }
  const moves = rows.map((r) => ({ ...r, ...decided[r.id] }));
  const byIdOut = Object.fromEntries(moves.map((m) => [m.id, m])); // status-bearing, for the UI

  const totalPayoffAllK = rows.reduce((s, r) => s + r.payoffK, 0);
  const routePayoffK = [...included].reduce((s, id) => s + byId[id].payoffK, 0);
  const reachFrac = totalPayoffAllK > 0 ? routePayoffK / totalPayoffAllK : 0;

  // Achieved metrics = how far along the today->target line the solved route
  // actually carries you, given the constraints. Bounded by the target.
  const lerp = (now, tgt) => now + (tgt - now) * reachFrac;
  const achieved = {
    spend:  lerp(BENCH.spendNow,  target.spend),
    dwell:  lerp(BENCH.dwellNow,  target.dwell),
    repeat: lerp(BENCH.repeatNow, target.repeat),
  };

  return {
    a, target, achieved, reachFrac, moves, byId: byIdOut,
    includedIds: [...included], routeCostK: spentK, routePayoffK, routeMonths: months,
    totalPayoffAllK,
    revNowK: (BENCH.visitors * BENCH.spendNow) / 1000,
    revTargetK: (BENCH.visitors * target.spend) / 1000,
    revAchievedK: (BENCH.visitors * achieved.spend) / 1000,
    horizon, budgetK, canClose, offTable,
  };
}

/* ============================================================================
   THEME — two UI directions, toggleable at the top.
   ========================================================================== */
function theme(mode) {
  if (mode === "rich") {
    return {
      mode: "rich",
      bg: "#eef1f4", panel: "#ffffff", panel2: "#f5f8fa",
      ink: "#10202b", muted: "#5a6b76", faint: "#8a99a2",
      line: "#dde5ea", accent: "#0f766e", accentInk: "#0b5750",
      accentBg: "#e2f2ef", warm: "#b45309", warmBg: "#fbe6d2",
      radius: 14, shadow: "0 8px 30px -14px rgba(16,32,43,.35)", shadowSm: "0 3px 12px -6px rgba(16,32,43,.3)",
      fontHead: "'Trebuchet MS', 'Segoe UI', system-ui, sans-serif",
      fontBody: "'Segoe UI', system-ui, -apple-system, sans-serif",
      bandColors: { low: { fg: "#9a3412", bg: "#fbe3d3" }, med: { fg: "#92700c", bg: "#f7ecc8" }, high: { fg: "#0f766e", bg: "#d7efe9" } },
      maxw: 960, hero: "linear-gradient(135deg,#0f766e 0%,#134e4a 100%)",
    };
  }
  return {
    mode: "minimal",
    bg: "#f7f5ef", panel: "#fffdf8", panel2: "#f3f0e7",
    ink: "#1b1a16", muted: "#6c675c", faint: "#94908500",
    line: "#e2ddd0", accent: "#2a2824", accentInk: "#1b1a16",
    accentBg: "#ece8dd", warm: "#7a5a2e", warmBg: "#efe7d6",
    radius: 3, shadow: "none", shadowSm: "none",
    fontHead: "Georgia, 'Times New Roman', serif",
    fontBody: "Georgia, 'Times New Roman', serif",
    bandColors: { low: { fg: "#5a4632", bg: "transparent" }, med: { fg: "#4a463c", bg: "transparent" }, high: { fg: "#33352b", bg: "transparent" } },
    maxw: 820, hero: "none",
  };
}

/* ============================================================================
   PRIMITIVES
   ========================================================================== */
const merge = (...o) => Object.assign({}, ...o);
const money = (k) => k >= 1000 ? `£${(k / 1000).toFixed(2)}M` : `£${Math.round(k)}k`;

// Minimal inline markup: **bold** -> ink, *italic* -> em.
function RT(text, t) {
  if (text == null) return null;
  const out = []; const rx = /\*\*(.+?)\*\*|\*(.+?)\*/g; let last = 0, m, key = 0;
  while ((m = rx.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] != null) out.push(<b key={key++} style={{ color: t.ink, fontWeight: 700 }}>{m[1]}</b>);
    else out.push(<i key={key++}>{m[2]}</i>);
    last = rx.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Kicker({ t, children }) {
  return <div style={{ fontFamily: t.fontBody, fontSize: 11.5, letterSpacing: ".16em",
    textTransform: "uppercase", color: t.muted, marginBottom: 14, fontWeight: 600 }}>{children}</div>;
}
function H({ t, children, size = 30, style }) {
  return <h1 style={merge({ fontFamily: t.fontHead, fontSize: size, lineHeight: 1.15, color: t.ink,
    margin: "0 0 16px", fontWeight: t.mode === "rich" ? 700 : 600,
    letterSpacing: t.mode === "minimal" ? "-.01em" : "0" }, style)}>{children}</h1>;
}
function P({ t, children, style }) {
  return <p style={merge({ fontFamily: t.fontBody, fontSize: 16.5, lineHeight: 1.62, color: t.muted,
    margin: "0 0 14px", maxWidth: 660 }, style)}>{children}</p>;
}
function Paras({ t, items }) {
  return (items || []).map((p, i) => <P key={i} t={t}>{RT(p, t)}</P>);
}
// Density-aware prose. c/s/d are arrays of paragraph strings; standard is required.
function Body({ t, density, c, s, d }) {
  const items = density === "concise" ? (c || s) : density === "deep" ? (d || s) : s;
  return <Paras t={t} items={items} />;
}
function Band({ t, band }) {
  const c = t.bandColors[band];
  const label = { low: "LOW", med: "MEDIUM", high: "HIGH" }[band];
  if (t.mode === "minimal")
    return <span style={{ fontFamily: t.fontBody, fontSize: 11.5, letterSpacing: ".14em",
      color: c.fg, borderBottom: `2px solid ${c.fg}`, paddingBottom: 1, fontWeight: 600 }}>{label}</span>;
  return <span style={{ fontFamily: t.fontBody, fontSize: 11.5, letterSpacing: ".08em",
    color: c.fg, background: c.bg, padding: "3px 10px", borderRadius: 999, fontWeight: 700 }}>{label}</span>;
}
// Every claim points OUTWARD to comparables, never inward to a rubric.
function Bench({ t, children }) {
  return (
    <div style={{ fontFamily: t.fontBody, fontSize: 13.5, lineHeight: 1.5,
      color: t.mode === "rich" ? t.accentInk : t.warm,
      background: t.mode === "rich" ? t.accentBg : "transparent",
      borderLeft: `2px solid ${t.mode === "rich" ? t.accent : t.warm}`,
      padding: t.mode === "rich" ? "10px 14px" : "2px 0 2px 14px",
      borderRadius: t.mode === "rich" ? 8 : 0, margin: "10px 0" }}>
      <span style={{ fontWeight: 700, letterSpacing: ".04em", fontSize: 11, textTransform: "uppercase",
        display: "block", opacity: .8, marginBottom: 3 }}>vs. comparable sites</span>
      {children}
    </div>
  );
}
function Card({ t, children, style, tone }) {
  return <div style={merge({ background: tone === "alt" ? t.panel2 : t.panel,
    border: `1px solid ${t.line}`, borderRadius: t.radius, boxShadow: t.shadowSm, padding: 20 }, style)}>{children}</div>;
}
function Stat({ t, label, value, sub, emphasise }) {
  return (
    <div style={{ padding: t.mode === "rich" ? "14px 16px" : "12px 0",
      borderTop: t.mode === "minimal" ? `1px solid ${t.line}` : "none",
      background: t.mode === "rich" ? (emphasise ? t.accentBg : t.panel2) : "transparent",
      borderRadius: t.mode === "rich" ? 10 : 0, flex: "1 1 130px", minWidth: 120 }}>
      <div style={{ fontFamily: t.fontHead, fontSize: 26, color: emphasise ? t.accent : t.ink, lineHeight: 1 }}>{value}</div>
      <div style={{ fontFamily: t.fontBody, fontSize: 12.5, color: t.muted, marginTop: 6 }}>{label}</div>
      {sub && <div style={{ fontFamily: t.fontBody, fontSize: 11.5, color: t.muted, marginTop: 3, opacity: .85 }}>{sub}</div>}
    </div>
  );
}
function Divider({ t }) { return <div style={{ height: 1, background: t.line, margin: "22px 0" }} />; }
function beatTag(t, n, label, sub) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
      <span style={{ fontFamily: t.fontHead, fontSize: 13, color: t.accent, fontWeight: 700 }}>Beat {n}</span>
      <span style={{ fontFamily: t.fontBody, fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase", color: t.muted }}>{label}{sub ? ` · ${sub}` : ""}</span>
    </div>
  );
}
// Form field label
function FieldLabel({ t, children }) {
  return <div style={{ fontFamily: t.fontBody, fontSize: 12, letterSpacing: ".08em",
    textTransform: "uppercase", color: t.muted, marginBottom: 6, fontWeight: 600 }}>{children}</div>;
}
const inputStyle = (t) => ({ width: "100%", padding: "10px 12px", fontFamily: t.fontBody, fontSize: 15,
  border: `1px solid ${t.line}`, borderRadius: t.mode === "rich" ? 8 : 2, background: t.panel, color: t.ink });

/* ============================================================================
   DISCOVERY STREAMS — findings, evidence, coverage inputs.
   Ordered STRENGTH-FIRST for the findings beat (external, internal, then the
   two weaknesses). Experiential is flagged heaviest.
   ========================================================================== */
const STREAMS = [
  { id: "external", name: "External Opportunities", band: "high", strength: true,
    finding: "Demand is emphatically not the problem. 200,000 people arrive annually with almost no marketing spend, regional tourism is up 12% over three years, and 2.3M people live within a 90-minute catchment. The market has already voted with its feet.",
    means: "Demand is the asset most sites never manage to build. You are not chasing an audience — you already have one, at scale, for free.",
    benchmark: "For raw footfall the fort sits in the TOP third of the comparable set — most sites in the tier spend years and budgets building the demand this one already has.",
    evidence: ["200,000 arrivals a year on under £15k of marketing", "Regional tourism up 12% across three years", "2.3M residents within a 90-minute drive", "Coach operators already routing tours past the gates"],
    coverage: [
      { id: "catchment", label: "Catchment & tourism trend", kind: "number", unit: "residents within 90 min", value: "2,300,000" },
      { id: "adjacent", label: "Competitor / adjacent offers", kind: "text", value: "Two paid attractions within 30 min; neither heritage; no direct rival for the story." },
      { id: "partners", label: "Partnership & funding routes", kind: "text", value: "" },
      { id: "season", label: "Seasonality & demand shape", kind: "select", options: ["Strong summer peak", "Even year-round", "Event-driven", "Unknown"], value: "Strong summer peak" },
    ] },
  { id: "internal", name: "Internal Capabilities", band: "med", strength: true,
    finding: "The custodial and operations team is genuinely strong — the fort is well kept and safely run. But there is no interpretation or curatorial function and no commercial programming role, so nobody currently owns the visitor's story or the site's income mix.",
    means: "The team can run a bigger operation. The gap is two specific roles, not general capability — which is a far cheaper problem to solve than a weak team.",
    benchmark: "Every top-third site in the set funds a dedicated interpretation lead. This fort does not — the capability gap is specific, not general.",
    evidence: ["Site maintained to conservation standard", "No lost-time safety incident in three years", "Visitor-services team retains staff well", "No interpretation lead and no commercial-programming role"],
    coverage: [
      { id: "gov", label: "Governance & who decides", kind: "select", options: ["Single owner", "Trust board", "Local authority", "Mixed"], value: "Trust board" },
      { id: "roles", label: "Team roles & skills on site", kind: "multi", options: ["Operations", "Conservation", "Front of house", "Interpretation", "Commercial", "Marketing"], value: ["Operations", "Conservation", "Front of house"] },
      { id: "curator", label: "Curatorial / interpretation capacity", kind: "select", options: ["Dedicated lead", "Shared / part-time", "None"], value: "None" },
      { id: "commercial", label: "Commercial & programming ownership", kind: "select", options: ["Dedicated role", "Shared", "None"], value: "None" },
    ] },
  { id: "quant", name: "Quantitative", band: "low", strength: false,
    finding: "The numbers are unambiguous. Spend is £4.20 per head against a £9–£13 comparable range; dwell time is 45 minutes against 110–140; repeat visitation is 8% against 18–24%. And 86% of income comes from a single line — admissions.",
    means: "Every headline number is bottom-third — and all of them are conversion problems, not demand problems. The people are already here; nothing captures their time or money.",
    benchmark: "On spend, dwell and repeat the fort sits in the BOTTOM third of the set. The concentration on one revenue line is the most fragile in the whole benchmark group.",
    evidence: ["Spend £4.20 / head vs £9–£13 set range", "Dwell 45 min vs 110–140 min", "Repeat 8% vs 18–24%", "Admissions = 86% of all income"],
    coverage: [
      { id: "spend", label: "Spend per head (£)", kind: "number", unit: "£ / head", value: "4.20" },
      { id: "dwell", label: "Dwell time (min)", kind: "number", unit: "minutes", value: "45" },
      { id: "mix", label: "Admissions share of income (%)", kind: "number", unit: "% of income", value: "86" },
      { id: "return", label: "Repeat / return rate (%)", kind: "number", unit: "% within 12 mo", value: "8" },
    ] },
  { id: "exp", name: "Experiential", band: "low", strength: false, heaviest: true,
    finding: "The visit has no narrative spine. People walk the walls, take a photo, and leave — there is nothing to interpret the place, nothing programmed to do, and nothing that changes between visits. This is the finding that most determines whether everything else can work.",
    means: "This is the variable that best predicts the other three across the whole set. Fix it and spend, dwell and repeat move on their own; leave it and nothing else holds.",
    benchmark: "Against comparable sites the experience is bottom-third, and it is the single variable that best predicts spend, dwell and repeat across the set. Weight it heaviest.",
    evidence: ["No interpretive narrative anywhere on site", "One thing to do: walk the walls", "Nothing changes between one visit and the next", "No reason engineered to stay longer or come back"],
    coverage: [
      { id: "arrival", label: "Arrival & orientation", kind: "text", value: "Ticket booth, then open site. No orientation, no framing of what you’re about to see." },
      { id: "story", label: "What’s the story this place tells?", kind: "text", value: "" },
      { id: "todo", label: "Things to do on site", kind: "multi", options: ["Walk the walls", "Guided tour", "Exhibition", "Events", "Café", "Play / family"], value: ["Walk the walls"] },
      { id: "return", label: "Reason to stay / reason to return", kind: "text", value: "" },
    ] },
];
const STREAM_BY = Object.fromEntries(STREAMS.map((s) => [s.id, s]));

/* ============================================================================
   THE "WHY" VISUAL — one problem propagating. Three renderings + click-to-trace.
   ========================================================================== */
const CHAIN = [
  { k: "narrative",   label: "Weak narrative",   note: "No story spine to the place.",   from: null,                        leads: "nothing to build programming around" },
  { k: "programming", label: "Thin programming", note: "A story with nothing to do around it.", from: "the narrative being weak",   leads: "nothing to sell but the admission ticket" },
  { k: "revenue",     label: "One revenue line", note: "Nothing to sell but the ticket.", from: "programming being thin",     leads: "fragile, bottom-third economics" },
  { k: "economics",   label: "Weak economics",   note: "Low spend, short dwell, few returns.", from: "income resting on one line", leads: null },
];

function WhyVisual({ t, mode, selected, onSelect }) {
  const acc = t.mode === "rich" ? t.accent : t.ink;
  const s = selected; // index or null
  // role of node i relative to selection: self / down (it causes) / up (caused it) / null
  const role = (i) => s == null ? null : i === s ? "self" : i > s ? "down" : "up";
  const styleFor = (i) => {
    const r = role(i);
    if (r == null) return { border: t.line, bg: t.panel, op: 1, ring: false };
    if (r === "self") return { border: acc, bg: t.mode === "rich" ? t.accentBg : t.panel2, op: 1, ring: true };
    if (r === "down") return { border: acc, bg: t.panel, op: 1, ring: false };
    return { border: t.mode === "rich" ? t.warm : t.line, bg: t.panel, op: .6, ring: false }; // up
  };
  const nodeBox = (c, i, extra) => {
    const st = styleFor(i);
    return (
      <button key={c.k} onClick={() => onSelect(selected === i ? null : i)} style={merge({
        textAlign: "left", cursor: "pointer", background: st.bg,
        border: `${st.ring ? 2 : 1}px solid ${st.border}`, borderLeft: `3px solid ${st.border}`,
        borderRadius: t.radius, padding: "12px 14px", opacity: st.op, transition: "all .2s",
        boxShadow: st.ring ? t.shadowSm : "none" }, extra)}>
        <div style={{ fontFamily: t.fontHead, fontSize: 16, color: t.ink }}>{c.label}</div>
        <div style={{ fontFamily: t.fontBody, fontSize: 12.5, color: t.muted, marginTop: 3, lineHeight: 1.4 }}>{c.note}</div>
      </button>
    );
  };

  let visual;
  if (mode === "chain") {
    visual = (
      <div style={{ display: "flex", flexDirection: "column", maxWidth: 460, margin: "0 auto", gap: 0 }}>
        {CHAIN.map((c, i) => (
          <React.Fragment key={c.k}>
            {nodeBox(c, i, { width: "100%" })}
            {i < CHAIN.length - 1 && <div style={{ textAlign: "center", color: acc, fontSize: 20, lineHeight: "24px" }}>↓</div>}
          </React.Fragment>
        ))}
      </div>
    );
  } else if (mode === "flow") {
    visual = (
      <div className="scrollx">
        <div style={{ display: "flex", alignItems: "stretch", gap: 4, minWidth: 660, padding: "6px 2px" }}>
          {CHAIN.map((c, i) => (
            <React.Fragment key={c.k}>
              {nodeBox(c, i, { flex: "1 1 0", minWidth: 140, textAlign: "center" })}
              {i < CHAIN.length - 1 && <div style={{ display: "flex", alignItems: "center", color: acc, fontSize: 22 }}>→</div>}
            </React.Fragment>
          ))}
        </div>
      </div>
    );
  } else { // stacked
    visual = (
      <div style={{ maxWidth: 470, margin: "0 auto" }}>
        {[...CHAIN].map((c, idx) => idx).reverse().map((i, row) => {
          const c = CHAIN[i]; const st = styleFor(i); const depth = CHAIN.length - row;
          return (
            <button key={c.k} onClick={() => onSelect(selected === i ? null : i)} style={{
              display: "block", cursor: "pointer", width: `${62 + depth * 9}%`, margin: "0 auto 6px",
              background: st.bg, color: t.ink, border: `${st.ring ? 2 : 1}px solid ${st.border}`,
              borderRadius: t.radius, padding: "11px 16px", textAlign: "center", opacity: st.op, transition: "all .2s" }}>
              <div style={{ fontFamily: t.fontHead, fontSize: 15 }}>{c.label}</div>
              <div style={{ fontFamily: t.fontBody, fontSize: 12, color: t.muted, marginTop: 2 }}>{c.note}</div>
            </button>
          );
        })}
        <div style={{ textAlign: "center", fontFamily: t.fontBody, fontSize: 11.5, color: t.muted,
          marginTop: 4, letterSpacing: ".06em", textTransform: "uppercase" }}>Narrative is the foundation — everything above rests on it</div>
      </div>
    );
  }

  const sel = s != null ? CHAIN[s] : null;
  return (
    <div>
      {visual}
      <div style={{ marginTop: 16, minHeight: 46, textAlign: "center" }}>
        {sel ? (
          <div className="fadein" style={{ fontFamily: t.fontBody, fontSize: 13.5, color: t.muted, lineHeight: 1.5, maxWidth: 560, margin: "0 auto" }}>
            <b style={{ color: t.ink }}>{sel.label}</b>
            {sel.from && <> — caused upstream by <b style={{ color: t.ink }}>{sel.from}</b></>}
            {sel.leads && <>; it propagates downstream into <b style={{ color: t.ink }}>{sel.leads}</b>.</>}
            {!sel.leads && <>. This is where the whole chain finally shows up in the numbers.</>}
          </div>
        ) : (
          <div style={{ fontFamily: t.fontBody, fontSize: 12.5, color: t.muted, letterSpacing: ".04em" }}>
            Click any link to trace what it causes and what caused it.
          </div>
        )}
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
        <button key={o.k} onClick={() => setMode(o.k)} style={{ border: "none",
          background: mode === o.k ? (t.mode === "rich" ? t.accent : t.ink) : "transparent",
          color: mode === o.k ? "#fff" : t.muted, padding: "6px 12px",
          borderRadius: t.mode === "rich" ? 999 : 2, fontSize: 12.5, fontFamily: t.fontBody, fontWeight: 600 }}>{o.l}</button>
      ))}
    </div>
  );
}

/* ============================================================================
   BEAT 4 — ROUTE MAP + MIXED LEVERS
   ========================================================================== */
const STATUS_META = {
  "on-route":       { label: "On route",   short: "on route" },
  "gated":          { label: "Locked",     short: "locked" },
  "excluded":       { label: "Ruled out",  short: "ruled out" },
  "over-budget":    { label: "Over budget", short: "over budget" },
  "beyond-horizon": { label: "Too slow",   short: "beyond horizon" },
};
function statusColors(t, status) {
  if (status === "on-route") return { border: t.accent, bg: t.accentBg, fg: t.accentInk, dash: false };
  if (status === "gated")    return { border: t.line,   bg: t.panel2,  fg: t.muted,     dash: true };
  if (status === "excluded") return { border: t.line,   bg: t.panel2,  fg: t.faint || t.muted, dash: true };
  return { border: t.warm, bg: t.mode === "rich" ? t.warmBg : "transparent", fg: t.warm, dash: true }; // budget / horizon
}
function EndNode({ t, title, metrics, sub, accent }) {
  return (
    <div style={{ minWidth: 150, background: accent ? (t.mode === "rich" ? t.hero : t.ink) : t.panel2,
      color: accent ? "#fff" : t.ink, border: `1px solid ${accent ? "transparent" : t.line}`,
      borderRadius: t.radius, padding: "14px 16px" }}>
      <div style={{ fontFamily: t.fontBody, fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", opacity: .8 }}>{title}</div>
      <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
        {metrics.map((m) => (
          <div key={m.l}>
            <div style={{ fontFamily: t.fontHead, fontSize: 18 }}>{m.v}</div>
            <div style={{ fontFamily: t.fontBody, fontSize: 10.5, opacity: .8 }}>{m.l}</div>
          </div>
        ))}
      </div>
      {sub && <div style={{ fontFamily: t.fontBody, fontSize: 11, marginTop: 8, opacity: .85, lineHeight: 1.4 }}>{sub}</div>}
    </div>
  );
}
function RouteMoveNode({ t, m }) {
  const c = statusColors(t, m.status);
  const locked = m.status === "gated" || m.status === "excluded";
  return (
    <div style={{ minWidth: 150, maxWidth: 200, background: c.bg,
      border: `1.5px ${c.dash ? "dashed" : "solid"} ${c.border}`, borderRadius: t.radius, padding: "11px 13px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "baseline" }}>
        <span style={{ fontFamily: t.fontBody, fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase",
          color: c.fg, fontWeight: 700 }}>{locked ? "🔒 " : ""}{STATUS_META[m.status].label}</span>
        <span style={{ fontFamily: t.fontBody, fontSize: 10.5, color: t.muted }}>{m.months}mo</span>
      </div>
      <div style={{ fontFamily: t.fontHead, fontSize: 14.5, color: t.ink, marginTop: 5, lineHeight: 1.2 }}>{m.name}</div>
      {m.status === "on-route"
        ? <div style={{ fontFamily: t.fontBody, fontSize: 11.5, color: t.muted, marginTop: 5 }}>{money(m.costK)} · +{money(m.payoffK)}/yr</div>
        : <div style={{ fontFamily: t.fontBody, fontSize: 11.5, color: c.fg, marginTop: 5, lineHeight: 1.35 }}>{m.reason}</div>}
    </div>
  );
}
// The route laid out by dependency depth: Today -> narrative -> {programming,dwell} -> {revenue,repeat} -> Destination
function RouteMap({ t, model }) {
  const cols = [
    { key: "d1", ids: ["narrative"] },
    { key: "d2", ids: ["programming", "dwell"] },
    { key: "d3", ids: ["revenue", "repeat"] },
  ];
  const arrow = <div style={{ display: "flex", alignItems: "center", color: t.mode === "rich" ? t.accent : t.ink, fontSize: 22, flex: "0 0 auto" }}>→</div>;
  return (
    <div className="scrollx">
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 900, padding: "4px 2px 10px" }}>
        <EndNode t={t} title="Today" metrics={[
          { l: "spend", v: `£${BENCH.spendNow.toFixed(2)}` }, { l: "dwell", v: `${BENCH.dwellNow}m` }, { l: "repeat", v: `${BENCH.repeatNow}%` }]} />
        {arrow}
        {cols.map((col, ci) => (
          <React.Fragment key={col.key}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: "0 0 auto" }}>
              {col.ids.map((id) => <RouteMoveNode key={id} t={t} m={model.byId[id]} />)}
            </div>
            {ci < cols.length - 1 && arrow}
          </React.Fragment>
        ))}
        {arrow}
        <EndNode t={t} accent title="Destination" metrics={[
          { l: "spend", v: `£${model.achieved.spend.toFixed(2)}` },
          { l: "dwell", v: `${Math.round(model.achieved.dwell)}m` },
          { l: "repeat", v: `${Math.round(model.achieved.repeat)}%` }]}
          sub={`Reaches ${Math.round(model.reachFrac * 100)}% of the £${model.target.spend.toFixed(2)}/head target within your constraints`} />
      </div>
    </div>
  );
}
function Levers({ t, L, set }) {
  const box = { display: "flex", flexDirection: "column", gap: 6 };
  const pct = Math.round(L.ambition * 100);
  return (
    <Card t={t} tone="alt" style={{ display: "grid", gap: 18, gridTemplateColumns: "1fr", marginBottom: 18 }}>
      <div style={box}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <FieldLabel t={t}>Ambition of the target</FieldLabel>
          <span style={{ fontFamily: t.fontBody, fontSize: 12, color: t.muted }}>{pct < 34 ? "Steady" : pct < 67 ? "Committed" : "Full comparable target"}</span>
        </div>
        <input type="range" min="0" max="100" value={pct} onChange={(e) => set({ ambition: Number(e.target.value) / 100 })} style={{ accentColor: t.accent }} />
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: t.fontBody, fontSize: 11, color: t.muted }}>
          <span>Where it is today</span><span>Comparable top third — the slider stops here</span>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 14 }}>
        <div style={box}>
          <FieldLabel t={t}>Time horizon</FieldLabel>
          <select value={L.horizon} onChange={(e) => set({ horizon: Number(e.target.value) })} style={inputStyle(t)}>
            {[12, 24, 36].map((h) => <option key={h} value={h}>{h} months</option>)}
          </select>
        </div>
        <div style={box}>
          <FieldLabel t={t}>Budget ceiling (first year)</FieldLabel>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontFamily: t.fontBody, color: t.muted }}>£</span>
            <input type="number" min="50" max="1500" step="10" value={L.budgetK}
              onChange={(e) => set({ budgetK: Math.max(0, Number(e.target.value) || 0) })} style={inputStyle(t)} />
            <span style={{ fontFamily: t.fontBody, color: t.muted }}>k</span>
          </div>
        </div>
        <div style={box}>
          <FieldLabel t={t}>Appetite for disruption</FieldLabel>
          <button onClick={() => set({ canClose: !L.canClose })} style={{
            display: "flex", alignItems: "center", gap: 10, border: `1px solid ${t.line}`,
            background: t.panel, borderRadius: t.mode === "rich" ? 8 : 2, padding: "9px 12px", textAlign: "left" }}>
            <span style={{ width: 38, height: 22, borderRadius: 999, background: L.canClose ? t.accent : t.line,
              position: "relative", flex: "0 0 auto", transition: "background .2s" }}>
              <span style={{ position: "absolute", top: 2, left: L.canClose ? 18 : 2, width: 18, height: 18,
                borderRadius: 999, background: "#fff", transition: "left .2s" }} />
            </span>
            <span style={{ fontFamily: t.fontBody, fontSize: 13, color: t.ink }}>{L.canClose ? "Can close for works" : "Must stay open"}</span>
          </button>
        </div>
      </div>
      <div style={box}>
        <FieldLabel t={t}>Moves off the table</FieldLabel>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {OFF_TABLE.map((o) => {
            const on = L.offTable.includes(o.id);
            return (
              <button key={o.id} onClick={() => set({ offTable: on ? L.offTable.filter((x) => x !== o.id) : [...L.offTable, o.id] })}
                style={{ display: "flex", alignItems: "center", gap: 8, border: `1px solid ${on ? t.warm : t.line}`,
                  background: on ? (t.mode === "rich" ? t.warmBg : "transparent") : t.panel,
                  color: on ? t.warm : t.ink, borderRadius: t.mode === "rich" ? 999 : 2, padding: "7px 12px",
                  fontFamily: t.fontBody, fontSize: 13 }}>
                <span style={{ width: 16, height: 16, borderRadius: t.mode === "rich" ? 5 : 2, flex: "0 0 auto",
                  border: `1.5px solid ${on ? t.warm : t.line}`, background: on ? t.warm : "transparent",
                  color: "#fff", fontSize: 11, textAlign: "center", lineHeight: "13px" }}>{on ? "✓" : ""}</span>
                {o.label}
              </button>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

/* ============================================================================
   BEAT 1 — FINDINGS (two switchable variants, strength-first)
   ========================================================================== */
function FindingDetail({ t, st }) {
  return (
    <div className="fadein">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ fontFamily: t.fontHead, fontSize: 20, color: t.ink }}>{st.name}</span>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {st.heaviest && <span style={{ fontFamily: t.fontBody, fontSize: 10.5, color: t.accent, letterSpacing: ".06em", fontWeight: 700 }}>MOST DETERMINES SUCCESS</span>}
          <Band t={t} band={st.band} />
        </div>
      </div>
      <P t={t} style={{ fontSize: 15.5 }}>{st.finding}</P>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 8, margin: "12px 0" }}>
        {st.evidence.map((e) => (
          <div key={e} style={{ fontFamily: t.fontBody, fontSize: 13, color: t.ink, background: t.panel2,
            borderLeft: `2px solid ${t.accent}`, borderRadius: t.mode === "rich" ? 6 : 0, padding: "8px 10px", lineHeight: 1.4 }}>{e}</div>
        ))}
      </div>
      <Bench t={t}>{st.benchmark}</Bench>
      <P t={t} style={{ fontSize: 14.5, marginTop: 10 }}><b style={{ color: t.ink }}>What it means: </b>{st.means}</P>
    </div>
  );
}
function BenchmarkTable({ t }) {
  const rows = [
    ["Annual footfall", "200,000", "40k–210k", "Top third", "high"],
    ["Spend per head", "£4.20", "£9–£13", "Bottom third", "low"],
    ["Dwell time", "45 min", "110–140 min", "Bottom third", "low"],
    ["Repeat visitation", "8%", "18–24%", "Bottom third", "low"],
    ["Revenue lines", "1 (admissions 86%)", "3–5 balanced", "Bottom third", "low"],
    ["Interpretation lead", "None", "Standard in top third", "Gap", "low"],
  ];
  return (
    <div className="scrollx">
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 560, fontFamily: t.fontBody }}>
        <thead><tr style={{ textAlign: "left" }}>
          {["Measure", "This fort", "Comparable set", "Position"].map((h) => (
            <th key={h} style={{ fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", color: t.muted, padding: "8px 12px", borderBottom: `2px solid ${t.line}` }}>{h}</th>
          ))}
        </tr></thead>
        <tbody>
          {rows.map((r) => (
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
  );
}
function FindingsBeat({ t, density }) {
  const [variant, setVariant] = useState("A"); // A deep-narrative, B overview + drill-in
  const [aPage, setAPage] = useState(0);        // variant A internal paging
  const [drill, setDrill] = useState(null);     // variant B drilled finding id

  const aPages = [
    { title: "What’s already working", ids: ["external", "internal"], strength: true },
    { title: "Where it’s underperforming", ids: ["quant"], strength: false },
    { title: "The finding that matters most", ids: ["exp"], strength: false, table: true },
  ];

  const toggle = (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
      <div style={{ display: "inline-flex", gap: 4, background: t.panel2, padding: 4, borderRadius: t.mode === "rich" ? 999 : 3, border: `1px solid ${t.line}` }}>
        {[["A", "Deep narrative"], ["B", "Overview + drill-in"]].map(([k, l]) => (
          <button key={k} onClick={() => { setVariant(k); setDrill(null); }} style={{ border: "none",
            background: variant === k ? (t.mode === "rich" ? t.accent : t.ink) : "transparent",
            color: variant === k ? "#fff" : t.muted, padding: "6px 14px", borderRadius: t.mode === "rich" ? 999 : 2,
            fontSize: 12.5, fontFamily: t.fontBody, fontWeight: 600 }}>{k} · {l}</button>
        ))}
      </div>
      {variant === "A" && (
        <span style={{ fontFamily: t.fontBody, fontSize: 12, color: t.muted }}>Finding {aPage + 1} of {aPages.length}</span>
      )}
    </div>
  );

  return (
    <div>
      {beatTag(t, 1, "Findings", "Presenter-led")}
      <H t={t}>What the discovery surfaced</H>
      <Body t={t} density={density}
        c={["Four reads. We start with what’s already strong — the demand and the team — then turn to what isn’t. The experiential read carries the most weight; it decides whether the rest can move."]}
        s={["Four reads, taken in a deliberate order: what’s already strong first — the demand and the team — then the two places the fort is underperforming. The experiential finding is not a peer of the other three; it is the one that most determines whether any of them can move."]}
        d={["Four reads, taken in a deliberate order. We start with strength because it’s true and because it’s the ground everything else stands on: the demand is proven and the team is capable. Only then do we turn to the two places the fort underperforms — the numbers, and the visit itself.",
           "Hold one thing in mind as you go: these are not four equal quarters. The experiential finding is weighted heaviest, because across the comparable set it is the single variable that best predicts the other three. Read the strengths as the assets you’re building on, and the experiential read as the lever that moves everything downstream."]} />
      {toggle}

      {variant === "A" ? (
        <div>
          <div style={{ fontFamily: t.fontBody, fontSize: 11.5, letterSpacing: ".12em", textTransform: "uppercase",
            color: aPages[aPage].strength ? t.accent : t.warm, fontWeight: 700, marginBottom: 12 }}>
            {aPages[aPage].strength ? "Strength" : "Needs work"} · {aPages[aPage].title}
          </div>
          <div style={{ display: "grid", gap: 16 }}>
            {aPages[aPage].ids.map((id) => (
              <Card key={id} t={t} style={{ borderLeft: STREAM_BY[id].heaviest ? `4px solid ${t.accent}` : undefined }}>
                <FindingDetail t={t} st={STREAM_BY[id]} />
              </Card>
            ))}
          </div>
          {aPages[aPage].table && (
            <div style={{ marginTop: 16 }}>
              <P t={t} style={{ fontSize: 14 }}>All of it against the same comparable set — 14 coastal forts and heritage properties in the fort’s tier. One line is top third; five are bottom third.</P>
              <BenchmarkTable t={t} />
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18 }}>
            <button onClick={() => setAPage(Math.max(0, aPage - 1))} disabled={aPage === 0}
              style={{ border: `1px solid ${t.line}`, background: t.panel, color: aPage === 0 ? t.line : t.ink,
                padding: "8px 16px", borderRadius: t.mode === "rich" ? 999 : 3, fontFamily: t.fontBody, fontSize: 13, opacity: aPage === 0 ? .5 : 1 }}>← Previous finding</button>
            <button onClick={() => setAPage(Math.min(aPages.length - 1, aPage + 1))} disabled={aPage === aPages.length - 1}
              style={{ border: "none", background: aPage === aPages.length - 1 ? t.line : (t.mode === "rich" ? t.accent : t.ink), color: "#fff",
                padding: "8px 16px", borderRadius: t.mode === "rich" ? 999 : 3, fontFamily: t.fontBody, fontSize: 13, opacity: aPage === aPages.length - 1 ? .5 : 1 }}>Next finding →</button>
          </div>
        </div>
      ) : drill ? (
        <div>
          <button onClick={() => setDrill(null)} style={{ border: "none", background: "transparent", color: t.accent,
            fontFamily: t.fontBody, fontSize: 13, padding: 0, marginBottom: 12 }}>← All findings</button>
          <Card t={t} style={{ borderLeft: STREAM_BY[drill].heaviest ? `4px solid ${t.accent}` : undefined }}>
            <FindingDetail t={t} st={STREAM_BY[drill]} />
          </Card>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {STREAMS.map((st) => (
            <button key={st.id} onClick={() => setDrill(st.id)} style={{ textAlign: "left", background: t.panel,
              border: `1px solid ${t.line}`, borderLeft: st.heaviest ? `4px solid ${t.accent}` : `1px solid ${t.line}`,
              borderRadius: t.radius, padding: 16, boxShadow: t.shadowSm, cursor: "pointer" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontFamily: t.fontHead, fontSize: 17, color: t.ink }}>
                  {st.name}
                  <span style={{ fontFamily: t.fontBody, fontSize: 11, color: st.strength ? t.accent : t.warm, marginLeft: 10, letterSpacing: ".05em" }}>
                    {st.heaviest ? "MOST DETERMINES SUCCESS" : st.strength ? "STRENGTH" : "NEEDS WORK"}
                  </span>
                </span>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <Band t={t} band={st.band} />
                  <span style={{ color: t.accent, fontFamily: t.fontBody, fontSize: 13 }}>Open →</span>
                </div>
              </div>
              <div style={{ fontFamily: t.fontBody, fontSize: 13.5, color: t.muted, marginTop: 8, lineHeight: 1.5 }}>
                {st.finding.split(". ")[0]}.
              </div>
            </button>
          ))}
          <P t={t} style={{ fontSize: 13, marginTop: 4 }}>Open any finding for its evidence, comparables and what it means.</P>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   BEAT 2 — "You have one" reframe (2 screens) with click-to-trace
   ========================================================================== */
function ScatteredProblems({ t }) {
  const items = [
    { l: "Low spend per head", n: "£4.20 against a £9–£13 comparable range." },
    { l: "Short visits", n: "45 minutes when the set runs 110–140." },
    { l: "Few people return", n: "8% repeat against 18–24%." },
    { l: "Income on one line", n: "86% of it from admissions alone." },
  ];
  const pos = [{ top: 0, left: "4%", rot: -3 }, { top: 20, left: "52%", rot: 2 }, { top: 150, left: "12%", rot: 2.5 }, { top: 168, left: "56%", rot: -2 }];
  return (
    <div style={{ position: "relative", minHeight: 320 }}>
      {items.map((it, i) => (
        <div key={it.l} style={{ position: "absolute", top: pos[i].top, left: pos[i].left, width: 250, maxWidth: "44%",
          transform: `rotate(${pos[i].rot}deg)`, background: t.panel, border: `1px solid ${t.line}`,
          borderRadius: t.radius, boxShadow: t.shadowSm || "0 2px 6px rgba(0,0,0,.06)", padding: "13px 15px" }}>
          <div style={{ fontFamily: t.fontHead, fontSize: 16, color: t.ink }}>{it.l}</div>
          <div style={{ fontFamily: t.fontBody, fontSize: 12.5, color: t.muted, marginTop: 4, lineHeight: 1.4 }}>{it.n}</div>
        </div>
      ))}
      <div style={{ position: "absolute", bottom: 0, right: 0, fontFamily: t.fontBody, fontSize: 12.5,
        color: t.muted, fontStyle: "italic" }}>…four problems, four workstreams, four budgets. Or so it looks.</div>
    </div>
  );
}

/* ============================================================================
   ALIGNMENT TRAIL (Stage 5) — unchanged
   ========================================================================== */
function AlignmentTrail({ t }) {
  const W = 620, Hh = 220, padL = 44, padR = 20, padT = 20, padB = 34;
  const cycles = [0, 1, 2, 3, 4, 5], target = 50, actual = [50, 49, 51, 47, 32, 38];
  const x = (i) => padL + (i / (cycles.length - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - v / 100) * (Hh - padT - padB);
  const acc = t.accent, warm = t.mode === "rich" ? "#b45309" : t.warm;
  const path = actual.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  return (
    <div className="scrollx">
      <svg viewBox={`0 0 ${W} ${Hh}`} style={{ width: "100%", minWidth: 520, display: "block" }}>
        <line x1={padL} y1={y(target)} x2={W - padR} y2={y(target)} stroke={acc} strokeWidth="1.5" strokeDasharray="5 5" />
        <text x={padL} y={y(target) - 8} fill={acc} fontSize="11" fontFamily={t.fontBody}>Defined target</text>
        <path d={`${path} L${x(actual.length - 1)},${y(target)} L${x(0)},${y(target)} Z`} fill={warm} opacity="0.10" />
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
        <span><span style={{ display: "inline-block", width: 16, height: 2, background: acc, verticalAlign: "middle", marginRight: 6 }} />Defined target (the strategy)</span>
        <span><span style={{ display: "inline-block", width: 16, height: 2, background: warm, verticalAlign: "middle", marginRight: 6 }} />Where decisions actually landed</span>
      </div>
    </div>
  );
}

/* ============================================================================
   SCREEN CONTENT — one entry per screen. internal:true marks practitioner-only.
   ========================================================================== */
function buildScreens(ctx) {
  const { t, J, setJ, density, L, setL, model, whyMode, setWhyMode, traceSel, setTraceSel } = ctx;
  const S = [];
  const add = (stage, label, node, opts) => S.push({ stage, label, node, internal: !!(opts && opts.internal) });
  const setPf = (patch) => setJ({ ...J, pf: { ...J.pf, ...patch } });

  /* ---------------- STAGE 1 — ENTRY ---------------- */
  add(0, "Entry · The front door", (
    <div>
      <Kicker t={t}>Stage 1 — Entry · Screen 1 of 3</Kicker>
      <H t={t}>What kind of decision are you facing?</H>
      <Body t={t} density={density}
        c={["How you arrive sets the frame. Pick the door that fits."]}
        s={["How you arrive shapes the engagement. Pick the door that fits — it carries through everything that follows."]}
        d={["How you arrive shapes the whole engagement — the questions we ask, the benchmarks we reach for, the shape of the answer. Pick the door that fits your situation now, not the one you wish you were at. It carries through everything that follows."]} />
      <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
        {[
          { id: "scratch", ti: "Starting from Scratch", d: "Something new and still undefined. No fixed form yet — we help you decide what it should even be before anyone commits budget." },
          { id: "reset", ti: "Strategic Reset", d: "It exists but has drifted. It is not doing what it was meant to, and you need an honest read on why and what to fix." },
          { id: "growth", ti: "Growth", d: "It works. Now you want to expand it responsibly — without breaking the thing that already succeeds." },
        ].map((o) => {
          const sel = J.front === o.id;
          return (
            <button key={o.id} onClick={() => setJ({ ...J, front: o.id })} style={{ textAlign: "left",
              background: sel ? t.accentBg : t.panel, border: `1px solid ${sel ? t.accent : t.line}`,
              borderLeft: `3px solid ${sel ? t.accent : t.line}`, borderRadius: t.radius, padding: 18, boxShadow: sel ? t.shadowSm : "none" }}>
              <div style={{ fontFamily: t.fontHead, fontSize: 19, color: t.ink, marginBottom: 6 }}>{o.ti}{sel ? "  ✓" : ""}</div>
              <div style={{ fontFamily: t.fontBody, fontSize: 14.5, color: t.muted, lineHeight: 1.5 }}>{o.d}</div>
            </button>
          );
        })}
      </div>
      <P t={t} style={{ marginTop: 18, fontSize: 14 }}>Preloaded example — the heritage fort — enters through <b style={{ color: t.ink }}>Strategic Reset</b>: 200k visitors already arrive, but they don't stay, spend, or return.</P>
    </div>
  ));

  // Intake — INTERNAL, deepened
  const EXISTS = ["Brief", "Concept", "Feasibility study", "Master plan", "Operator appointed", "Brand identity", "None of these"];
  const toggleExists = (x) => {
    const cur = J.pf.exists || [];
    setPf({ exists: cur.includes(x) ? cur.filter((y) => y !== x) : [...cur.filter((y) => y !== "None of these" || x === "None of these"), x] });
  };
  add(0, "Entry · Intake", (
    <div>
      <Kicker t={t}>Stage 1 — Entry · Screen 2 of 3</Kicker>
      <H t={t}>Factual intake</H>
      <Body t={t} density={density}
        c={["Facts only — the shape of what exists before the discovery conversation. Nothing here is scored."]}
        s={["Facts only, captured before the discovery conversation. This is the shape of what exists — not a judgement of it. Nothing here is scored; it just tells us where to point the conversation."]}
        d={["Facts only, captured before the discovery conversation does the real work. This is the shape of what exists — what’s been produced, what the numbers say, what the constraints are — not a judgement of any of it. Nothing here is scored. Its only job is to tell the practitioner where to point the conversation, and to make sure the obvious ground is already covered before anyone sits down."]} />
      <Card t={t} tone="alt" style={{ display: "grid", gap: 18 }}>
        <label><FieldLabel t={t}>Project name</FieldLabel>
          <input value={J.pf.name} onChange={(e) => setPf({ name: e.target.value })} style={inputStyle(t)} /></label>

        <div>
          <FieldLabel t={t}>What already exists</FieldLabel>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {EXISTS.map((x) => {
              const on = (J.pf.exists || []).includes(x);
              return (
                <button key={x} onClick={() => toggleExists(x)} style={{ display: "flex", alignItems: "center", gap: 8,
                  border: `1px solid ${on ? t.accent : t.line}`, background: on ? t.accentBg : t.panel, color: on ? t.accentInk : t.ink,
                  borderRadius: t.mode === "rich" ? 999 : 2, padding: "7px 12px", fontFamily: t.fontBody, fontSize: 13.5 }}>
                  <span style={{ width: 16, height: 16, borderRadius: t.mode === "rich" ? 5 : 2, flex: "0 0 auto",
                    border: `1.5px solid ${on ? t.accent : t.line}`, background: on ? t.accent : "transparent",
                    color: "#fff", fontSize: 11, textAlign: "center", lineHeight: "13px" }}>{on ? "✓" : ""}</span>{x}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <FieldLabel t={t}>The numbers today</FieldLabel>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 }}>
            {[["annualVisitors", "Annual visitors"], ["revenue", "Current revenue (£/yr)"], ["spendHead", "Avg spend / head (£)"], ["staff", "Staff (FTE)"]].map(([k, lab]) => (
              <label key={k}><div style={{ fontFamily: t.fontBody, fontSize: 12, color: t.muted, marginBottom: 4 }}>{lab}</div>
                <input value={J.pf[k]} onChange={(e) => setPf({ [k]: e.target.value })} style={inputStyle(t)} /></label>
            ))}
          </div>
        </div>

        <div>
          <FieldLabel t={t}>Budget band — for the definition work, not the build</FieldLabel>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {["Under £50k", "£50k–£150k", "£150k–£500k", "£500k+"].map((b) => {
              const on = J.pf.budget === b;
              return (
                <button key={b} onClick={() => setPf({ budget: b })} style={{ border: `1px solid ${on ? t.accent : t.line}`,
                  background: on ? t.accentBg : t.panel, color: on ? t.accentInk : t.ink, borderRadius: t.mode === "rich" ? 999 : 2,
                  padding: "8px 14px", fontFamily: t.fontBody, fontSize: 13.5, fontWeight: on ? 700 : 400 }}>
                  {on ? "● " : "○ "}{b}
                </button>
              );
            })}
          </div>
          <div style={{ fontFamily: t.fontBody, fontSize: 12, color: t.muted, marginTop: 6 }}>This band scopes the diagnosis and definition engagement — capital for the build is estimated separately, later.</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
          <label><FieldLabel t={t}>Timeline</FieldLabel>
            <select value={J.pf.timeline} onChange={(e) => setPf({ timeline: e.target.value })} style={inputStyle(t)}>
              {["Exploring", "Within 6 months", "6–12 months", "12–24 months", "24 months+"].map((o) => <option key={o}>{o}</option>)}
            </select></label>
          <div><FieldLabel t={t}>Documents (optional)</FieldLabel>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {["📎 Visitor figures.csv", "📎 Accounts.pdf", "+ Add file"].map((f, i) => (
                <div key={f} style={{ fontFamily: t.fontBody, fontSize: 12.5, color: i === 2 ? t.accent : t.muted,
                  border: `1px dashed ${t.line}`, borderRadius: t.mode === "rich" ? 8 : 2, padding: "8px 10px", background: t.panel }}>{f}</div>
              ))}
            </div>
          </div>
        </div>
      </Card>
    </div>
  ), { internal: true });

  // Calendar — book the discovery meeting (client-facing). July 2026; today = 9th.
  add(0, "Entry · Book discovery", (
    <div>
      <Kicker t={t}>Stage 1 — Entry · Screen 3 of 3</Kicker>
      <H t={t}>Book the discovery conversation</H>
      <Body t={t} density={density}
        c={["Pick a time. This 60–90 minute conversation is where the diagnosis really begins."]}
        s={["Pick a time that works. The discovery conversation runs 60–90 minutes with the people who know the place best — it’s where the real diagnosis begins."]}
        d={["Pick a time that works for the people who know the place best. The discovery conversation runs 60–90 minutes and is where the diagnosis genuinely begins — everything before it is just the shape of what exists. Come with whoever holds the operational reality and the history in their heads; that’s where the useful answers live."]} />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(260px,1fr) minmax(180px,240px)", gap: 18, marginTop: 8 }} className="cal-grid">
        <Card t={t}>
          <div style={{ fontFamily: t.fontHead, fontSize: 17, color: t.ink, marginBottom: 12 }}>July 2026</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
              <div key={i} style={{ textAlign: "center", fontFamily: t.fontBody, fontSize: 11, color: t.muted, padding: "4px 0" }}>{d}</div>
            ))}
            {Array.from({ length: 3 }).map((_, i) => <div key={"b" + i} />) /* July 1 2026 = Wed (offset 3) */}
            {Array.from({ length: 31 }).map((_, i) => {
              const day = i + 1, disabled = day < 9, sel = J.booking.day === day;
              return (
                <button key={day} disabled={disabled} onClick={() => setJ({ ...J, booking: { ...J.booking, day } })} style={{
                  aspectRatio: "1", border: `1px solid ${sel ? t.accent : t.line}`, background: sel ? t.accent : disabled ? t.panel2 : t.panel,
                  color: sel ? "#fff" : disabled ? (t.faint || t.muted) : t.ink, opacity: disabled ? .4 : 1,
                  borderRadius: t.mode === "rich" ? 8 : 2, fontFamily: t.fontBody, fontSize: 13.5, cursor: disabled ? "default" : "pointer" }}>{day}</button>
              );
            })}
          </div>
        </Card>
        <Card t={t} tone="alt">
          <FieldLabel t={t}>Available times</FieldLabel>
          <div style={{ display: "grid", gap: 8 }}>
            {["09:30", "11:00", "14:00", "15:30"].map((tm) => {
              const sel = J.booking.time === tm, ok = J.booking.day != null;
              return (
                <button key={tm} disabled={!ok} onClick={() => setJ({ ...J, booking: { ...J.booking, time: tm } })} style={{
                  border: `1px solid ${sel ? t.accent : t.line}`, background: sel ? t.accentBg : t.panel, color: ok ? (sel ? t.accentInk : t.ink) : t.muted,
                  borderRadius: t.mode === "rich" ? 8 : 2, padding: "10px 12px", fontFamily: t.fontBody, fontSize: 14, opacity: ok ? 1 : .5, textAlign: "left" }}>
                  {sel ? "● " : "○ "}{tm}
                </button>
              );
            })}
          </div>
        </Card>
      </div>
      {J.booking.day && J.booking.time && (
        <Card t={t} style={{ marginTop: 14, borderLeft: `4px solid ${t.accent}` }} className="fadein">
          <div style={{ fontFamily: t.fontHead, fontSize: 16, color: t.ink }}>Discovery booked — Thursday {J.booking.day} July 2026, {J.booking.time}</div>
          <div style={{ fontFamily: t.fontBody, fontSize: 13.5, color: t.muted, marginTop: 4 }}>A calendar hold and a short list of who to bring will follow. Nothing to prepare.</div>
        </Card>
      )}
    </div>
  ));

  /* ---------------- STAGE 2 — DISCOVERY (all internal) ---------------- */
  add(1, "Discovery · Framing", (
    <div>
      <Kicker t={t}>Stage 2 — Discovery · Screen 1 of 3</Kicker>
      <H t={t}>The discovery conversation</H>
      <Body t={t} density={density}
        c={["An open conversation, not a form. We listen for what a questionnaire can’t reach — the story, the unspoken frustrations, the patterns in the numbers."]}
        s={["This is where the engagement earns its keep — an open conversation, not an interrogation, with the people who know the place best. We listen for what a form could never capture: the story the site is trying to tell, the frustrations staff have stopped mentioning, the patterns nobody has connected.",
           "The next screen is the backstage tool the practitioner runs during the conversation — a coverage checklist that keeps it complete without turning it into a script."]}
        d={["This is where the engagement earns its keep. It is a conversation, not an interrogation — usually 60–90 minutes with the people who know the place best. Structured intake gets you the facts you already knew to ask for; open conversation gets you the ones you didn’t, and in a diagnosis the unasked question is usually where the answer lives.",
           "We are listening for the things a form could never capture: the story the site is trying to tell, the frustrations staff have stopped mentioning, the patterns in the numbers nobody has connected.",
           "The next screen is the backstage tool the practitioner runs live during the conversation — a coverage checklist that captures answers as they surface and keeps the session complete without ever feeling like a script."]} />
    </div>
  ), { internal: true });

  add(1, "Discovery · Coverage checklist", (
    <div>
      <Kicker t={t}>Stage 2 — Discovery · Screen 2 of 3</Kicker>
      <H t={t}>Coverage checklist — capture live</H>
      <Body t={t} density={density}
        c={["Fill each item as it’s covered in the conversation. Empty fields are the anti-drift signal."]}
        s={["The practitioner captures answers here as the conversation covers them. An item counts as covered when it has a real answer — not when it was asked. The empty fields are the anti-drift signal: they show what still has to be steered toward."]}
        d={["The practitioner captures answers directly in the checklist as the conversation covers them, so the record is made once, live, rather than reconstructed afterwards. An item counts as covered when it holds a real answer — not when it was merely asked. The empty fields are the anti-drift signal: at a glance they show what still has to be steered toward before the session runs out."]} />
      <Bench t={t}>~40 minutes in, <b>Quantitative</b> and the <b>story</b> field are still thin — steer there before the conversation runs out.</Bench>
      <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
        {STREAMS.map((st) => {
          const filled = st.coverage.filter((c) => {
            const v = (J.capture[c.id] !== undefined ? J.capture[c.id] : c.value);
            return Array.isArray(v) ? v.length > 0 : String(v || "").trim() !== "";
          }).length;
          return (
            <Card key={st.id} t={t} style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontFamily: t.fontHead, fontSize: 16.5, color: t.ink }}>{st.name}</span>
                <span style={{ fontFamily: t.fontBody, fontSize: 12.5, color: filled === st.coverage.length ? t.accent : t.muted, fontWeight: 600 }}>{filled}/{st.coverage.length} captured</span>
              </div>
              <div style={{ display: "grid", gap: 12 }}>
                {st.coverage.map((c) => {
                  const v = J.capture[c.id] !== undefined ? J.capture[c.id] : c.value;
                  const done = Array.isArray(v) ? v.length > 0 : String(v || "").trim() !== "";
                  const setV = (nv) => setJ({ ...J, capture: { ...J.capture, [c.id]: nv } });
                  return (
                    <div key={c.id}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                        <span style={{ width: 16, height: 16, borderRadius: t.mode === "rich" ? 5 : 2, flex: "0 0 auto",
                          border: `1.5px solid ${done ? t.accent : t.line}`, background: done ? t.accent : "transparent",
                          color: "#fff", fontSize: 11, textAlign: "center", lineHeight: "13px" }}>{done ? "✓" : ""}</span>
                        <span style={{ fontFamily: t.fontBody, fontSize: 13.5, color: t.ink }}>{c.label}</span>
                        {!done && <span style={{ marginLeft: "auto", fontFamily: t.fontBody, fontSize: 11, color: t.warm }}>needs capture</span>}
                      </div>
                      {c.kind === "text" && (
                        <textarea value={v} onChange={(e) => setV(e.target.value)} rows={2} placeholder="Capture what surfaced…"
                          style={merge(inputStyle(t), { resize: "vertical", fontSize: 14, lineHeight: 1.45 })} />
                      )}
                      {c.kind === "number" && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <input value={v} onChange={(e) => setV(e.target.value)} style={merge(inputStyle(t), { maxWidth: 180 })} />
                          <span style={{ fontFamily: t.fontBody, fontSize: 12.5, color: t.muted }}>{c.unit}</span>
                        </div>
                      )}
                      {c.kind === "select" && (
                        <select value={v} onChange={(e) => setV(e.target.value)} style={merge(inputStyle(t), { maxWidth: 320 })}>
                          <option value="">—</option>
                          {c.options.map((o) => <option key={o}>{o}</option>)}
                        </select>
                      )}
                      {c.kind === "multi" && (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {c.options.map((o) => {
                            const arr = Array.isArray(v) ? v : [];
                            const on = arr.includes(o);
                            return (
                              <button key={o} onClick={() => setV(on ? arr.filter((x) => x !== o) : [...arr, o])} style={{
                                border: `1px solid ${on ? t.accent : t.line}`, background: on ? t.accentBg : t.panel, color: on ? t.accentInk : t.muted,
                                borderRadius: t.mode === "rich" ? 999 : 2, padding: "5px 10px", fontFamily: t.fontBody, fontSize: 12.5 }}>{on ? "✓ " : "+ "}{o}</button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  ), { internal: true });

  add(1, "Discovery · Gap-fill", (
    <div>
      <Kicker t={t}>Stage 2 — Discovery · Screen 3 of 3</Kicker>
      <H t={t}>What's still thin</H>
      <Body t={t} density={density}
        c={["A short, precise follow-up — only the gaps that matter to the diagnosis."]}
        s={["Rather than a second questionnaire, the practitioner sends back a short, precise ask — only the gaps that actually matter to the diagnosis. Targeted, not exhaustive."]}
        d={["The conversation surfaced most of it. Rather than a second questionnaire, the practitioner sends back a short, precise ask covering only the gaps that actually change the diagnosis — the handful of things that, if left thin, would weaken the read. Targeted, not exhaustive: every request below is one export or one document, not a form."]} />
      <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
        {[
          { s: "Quantitative", g: "We have admissions revenue but not spend-per-head or the split across secondary income.", ask: "The last 12 months of till data by category — one export is enough." },
          { s: "External Opportunities", g: "Partnership and funding routes came up but weren't mapped.", ask: "A quick list of live or lapsed partnerships (tourism boards, schools, funders) — names and status." },
          { s: "Experiential", g: "We heard the visit is thin but haven't seen it through a first-timer's eyes.", ask: "Any existing visitor-journey notes or a recent mystery-visit report, if one exists." },
        ].map((r) => (
          <Card key={r.s} t={t} style={{ padding: 16 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontFamily: t.fontHead, fontSize: 15.5, color: t.ink }}>{r.s}</span><Band t={t} band="low" />
            </div>
            <div style={{ fontFamily: t.fontBody, fontSize: 13.5, color: t.muted, lineHeight: 1.5 }}><b style={{ color: t.ink }}>Gap:</b> {r.g}</div>
            <div style={{ fontFamily: t.fontBody, fontSize: 13.5, color: t.mode === "rich" ? t.accentInk : t.ink, marginTop: 8,
              background: t.accentBg, borderRadius: t.mode === "rich" ? 8 : 2, padding: "10px 12px" }}><b>Targeted ask:</b> {r.ask}</div>
          </Card>
        ))}
      </div>
    </div>
  ), { internal: true });

  /* ---------------- STAGE 3 — BACKSTAGE (internal, kept light) ---------------- */
  const backstageWrap = (inner) => (
    <div style={{ border: `1px dashed ${t.mode === "rich" ? "#b45309" : t.warm}`, borderRadius: t.radius,
      background: "#1f1d19", padding: 22, color: "#e9e4d8" }}>{inner}</div>
  );
  add(2, "Backstage · Consolidation", backstageWrap(
    <div>
      <div style={{ fontFamily: t.fontHead, fontSize: 26, color: "#fff", marginBottom: 8 }}>Consolidation &amp; scoring</div>
      <div style={{ fontFamily: t.fontBody, fontSize: 14.5, color: "#c9c2b2", lineHeight: 1.6, maxWidth: 640, marginBottom: 18 }}>
        The four streams, banded against the comparable-sites set. Bands are anchored to benchmarks, never to opinion — that is what makes them defensible when the founders decide.
      </div>
      {STREAMS.map((st) => (
        <div key={st.id} style={{ borderTop: "1px solid #3a352b", padding: "14px 0", display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 280px" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ fontFamily: t.fontHead, fontSize: 17, color: "#fff" }}>{st.name}</span>
              {st.heaviest && <span style={{ fontSize: 10.5, letterSpacing: ".1em", color: "#e0b877", border: "1px solid #6b5a3a", padding: "2px 8px", borderRadius: 999 }}>WEIGHTED HEAVIEST</span>}
            </div>
            <div style={{ fontFamily: t.fontBody, fontSize: 13, color: "#b3ab99", marginTop: 6, lineHeight: 1.5 }}>{st.benchmark}</div>
          </div>
          <div style={{ flex: "0 0 auto", alignSelf: "center" }}>
            <span style={{ fontFamily: t.fontBody, fontSize: 12, letterSpacing: ".14em", fontWeight: 700,
              color: st.band === "high" ? "#8fd6c6" : st.band === "med" ? "#e0c877" : "#e6a07a" }}>{st.band.toUpperCase()}</span>
          </div>
        </div>
      ))}
    </div>
  ), { internal: true });

  add(2, "Backstage · Founders' verdict", backstageWrap(
    <div>
      <div style={{ fontFamily: t.fontHead, fontSize: 26, color: "#fff", marginBottom: 8 }}>The founders' verdict</div>
      <div style={{ fontFamily: t.fontBody, fontSize: 14.5, color: "#c9c2b2", lineHeight: 1.6, maxWidth: 640, marginBottom: 18 }}>
        The engine <i>recommends</i>; the founders <i>decide</i>. One of four verdicts is chosen backstage and logged. The client only ever sees the reasoning that flows from it, never this label.
      </div>
      <div style={{ background: "#12110e", border: "1px solid #3a352b", borderRadius: 10, padding: 16, marginBottom: 18 }}>
        <div style={{ fontFamily: t.fontBody, fontSize: 11, letterSpacing: ".14em", color: "#8a836f", textTransform: "uppercase", marginBottom: 6 }}>Engine recommendation</div>
        <div style={{ fontFamily: t.fontHead, fontSize: 18, color: "#8fd6c6" }}>Proceed — high, with a singular fixable root</div>
        <div style={{ fontFamily: t.fontBody, fontSize: 13, color: "#b3ab99", marginTop: 6, lineHeight: 1.5 }}>
          Demand is top-third and proven; the weakness is concentrated in one propagating root (narrative), which comparables show is fixable at high return. Confidence: strong.
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
        {[["Build as-is", "Rare. The thing is already right; just resource it."],
          ["Proceed", "Sound foundation, clear fix. Engage. ← founders selected"],
          ["Reshape", "Worth doing but not as scoped — redefine first."],
          ["Don't proceed", "Kindest to say no. Stated plainly, never buried."]].map(([v, d], i) => (
          <div key={v} style={{ background: i === 1 ? "#1e2c28" : "#161511", border: `1px solid ${i === 1 ? "#3f6b60" : "#3a352b"}`, borderRadius: 10, padding: 14 }}>
            <div style={{ fontFamily: t.fontHead, fontSize: 15.5, color: i === 1 ? "#8fd6c6" : "#e9e4d8" }}>{v}</div>
            <div style={{ fontFamily: t.fontBody, fontSize: 12, color: "#a49c88", marginTop: 5, lineHeight: 1.45 }}>{d}</div>
          </div>
        ))}
      </div>
      <div style={{ fontFamily: t.fontBody, fontSize: 12, color: "#8a836f", marginTop: 16 }}>Logged 2026-07-09 · decided by founders · rationale attached · surfaced to client only as reasoning (Stage 4).</div>
    </div>
  ), { internal: true });

  /* ---------------- STAGE 4 — THE OUTPUT ---------------- */
  // Beat 1
  add(3, "Beat 1 · Findings", <FindingsBeat t={t} density={density} />);

  // Beat 2 — screen 1: four separate problems
  add(3, "Beat 2 · Four problems", (
    <div>
      {beatTag(t, 2, "Why · the root", "1 of 2")}
      <H t={t}>You appear to have four separate problems</H>
      <Body t={t} density={density}
        c={["This is how it looks from inside: four weaknesses, each demanding its own fix."]}
        s={["This is how it reads from inside the fort: four separate weaknesses, each looking like it needs its own project, its own budget, its own owner. Held apart, they’re overwhelming — and every attempt to fix one directly has slid back."]}
        d={["This is how the situation reads from inside the fort, and it’s a fair reading of the evidence. Four separate weaknesses: spend is low, visits are short, few people return, and income leans on one line. Each looks like it needs its own project, its own budget, its own owner.",
           "Held apart like this they’re genuinely overwhelming — four fronts, none obviously first. And every attempt to fix one directly has slid back, because a symptom treated in isolation doesn’t stay fixed. Sit with the four as they actually appear before we show you what connects them."]} />
      <Card t={t} tone="alt" style={{ marginTop: 8, padding: "24px 20px" }}>
        <ScatteredProblems t={t} />
      </Card>
    </div>
  ));

  // Beat 2 — screen 2: you have one (click-to-trace)
  add(3, "Beat 2 · You have one", (
    <div>
      {beatTag(t, 2, "Why · the root", "2 of 2")}
      <H t={t}>You have one.</H>
      <Body t={t} density={density}
        c={["The four snap into a single chain: weak narrative → thin programming → one revenue line → weak economics. One problem, four symptoms."]}
        s={["The four aren’t separate. They’re one problem propagating downstream: a weak narrative starves programming, thin programming leaves one thing to sell, and one revenue line makes the economics fragile. Four symptoms, one cause."]}
        d={["The four aren’t separate problems — they’re one problem, seen at four points along its path. A weak narrative starves the programming, because you can’t design events or routes around a story that isn’t there. Thin programming leaves nothing to sell but the admission ticket. One revenue line makes the economics fragile — low spend, short dwell, few returns.",
           "That’s why fixing symptoms directly never held: you were treating the disguises, not the cause. Trace it yourself below — click any link to see what it causes downstream and what caused it upstream."]} />
      <div style={{ display: "flex", justifyContent: "flex-end", margin: "6px 0 14px" }}>
        <WhyToggle t={t} mode={whyMode} setMode={setWhyMode} />
      </div>
      <Card t={t} tone="alt" style={{ padding: 22 }}>
        <WhyVisual t={t} mode={whyMode} selected={traceSel} onSelect={setTraceSel} />
      </Card>
      <Bench t={t}>This exact propagation repeats across the comparable set: sites low on narrative scored low on spend, dwell and repeat almost without exception. The pattern is real — which is also why the fix is known.</Bench>
    </div>
  ));

  // Beat 3 — conclusion (meta line removed)
  add(3, "Beat 3 · What's true", (
    <div>
      {beatTag(t, 3, "The conclusion", "1 of 3")}
      <H t={t}>Here's what's true</H>
      <Body t={t} density={density}
        c={["The footfall is already here — 200k a year, the expensive thing most sites can’t build. And the weakness is singular: one root, not four, and comparables show it’s fixable."]}
        s={["Two facts aren’t in dispute. First: the footfall is already here — 200,000 a year with almost no marketing, the expensive, uncertain thing most sites spend a decade trying to build.",
           "Second: the weakness is singular. Every failing number traced back to one root. This isn’t a site with four things wrong; it’s a site with one thing wrong, wearing four disguises — and that one thing, comparables tell us, is fixable."]}
        d={["Two facts aren’t in dispute, and everything rests on them. First: the footfall is already here. 200,000 people arrive every year with almost no marketing — and building demand at that scale is the expensive, uncertain thing most comparable sites spend a decade and a fortune trying to achieve. This fort simply has it.",
           "Second: the weakness is singular. We traced every failing number back to one root and watched it propagate through the chain. This isn’t a site with four independent problems; it’s a site with one problem, wearing four disguises. And across fourteen comparable sites, that one thing — narrative — is the thing that has repeatedly been fixed."]} />
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
        <Stat t={t} label="Already have (rare)" value="200k" sub="proven annual demand" emphasise />
        <Stat t={t} label="Root causes" value="1" sub="not four" emphasise />
        <Stat t={t} label="Comparable precedent" value="14 sites" sub="the fix is known" />
      </div>
    </div>
  ));

  add(3, "Beat 3 · What it means", (
    <div>
      {beatTag(t, 3, "The conclusion", "2 of 3")}
      <H t={t}>Here's what that means</H>
      <Body t={t} density={density}
        c={["If the demand is here and the root is singular, the order flips: fix the story, and the economics follow it."]}
        s={["Put the two truths together and the order of operations flips. You don’t chase the economics — you fix the story, and the economics follow it.",
           "That’s not a slogan; it’s what the propagation guarantees. A stronger narrative makes real programming possible, programming opens revenue lines beyond the ticket, and those lift spend, dwell and repeat. The numbers you want are downstream of the one thing you can change."]}
        d={["Put the two truths together and the usual order of operations flips on its head. If the demand is already here and the weakness is a single fixable root, then chasing the economics directly is exactly the wrong move. You fix the story, and the economics follow it.",
           "This isn’t a motivational line — it’s what the causal chain guarantees. A stronger narrative makes real programming possible. Programming opens revenue lines beyond the admission ticket. Multiple revenue lines lift spend, dwell and repeat. Every number on the wishlist sits downstream of the one thing you can actually change first.",
           "Which also means the sequence isn’t optional. Try to open a second revenue line before the story lands and there’s nothing for it to sell; the chain only runs one way."]} />
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

  add(3, "Beat 3 · Worth building", (
    <div>
      {beatTag(t, 3, "The conclusion", "3 of 3")}
      <H t={t}>So — where does that leave the fort?</H>
      <Body t={t} density={density}
        c={["You already have the hard, expensive ingredient: people, in volume. What’s missing is a story — and the fix is narrower than it looks. You’re not rebuilding the fort; you’re giving it a spine."]}
        s={["You have the hardest, most expensive ingredient already: people, in volume, choosing to come. What’s missing is a single thing — a story — and everything the fort is failing on sits downstream of it. The upside is real and the cause is known.",
           "Which means the work is narrower than it looks. You are not rebuilding the fort, re-founding the organisation, or chasing new audiences. You are giving a place people already love a reason to stay, spend and come back — a focused piece of work with precedent behind it."]}
        d={["You have the hardest, most expensive ingredient already: people, in volume, choosing to come without being persuaded. What’s missing is a single thing — a story — and every number the fort is failing on sits downstream of it. The upside is real, the mechanism is understood, and the precedent exists across the set.",
           "Which means the work in front of you is narrower than it first appears. You are not rebuilding the fort, re-founding the organisation, or going hunting for a new audience. You are giving a place that people already love a reason to stay longer, spend more, and come back. That is a focused, sequenced piece of work — and the roadmap on the next screens shows exactly what it involves and in what order."]} />
      <Card t={t} style={{ marginTop: 8, borderLeft: `4px solid ${t.accent}` }}>
        <div style={{ fontFamily: t.fontHead, fontSize: 18, color: t.ink, lineHeight: 1.4 }}>
          The demand is proven, the root is singular and fixable, and the fix is narrower than it first appears.
        </div>
      </Card>
    </div>
  ));

  // Beat 4 — route map
  add(3, "Beat 4 · The route", (
    <div>
      {beatTag(t, 4, "The roadmap", "Interactive · 1 of 2")}
      <H t={t}>The route from here</H>
      <Body t={t} density={density}
        c={["Current position to target, as a route. Each move is a leg; legs that depend on an earlier one stay locked until it lands. Set the constraints and the route re-solves — the diagnosis above never moves."]}
        s={["Read this as a route, not a wishlist: where the fort is today, where the target sits, and the legs between. Legs that depend on an earlier one are visibly locked until it lands — you can see the ones you can’t take yet. Set the constraints and the route re-solves around them; every projection stays inside what comparables support, and the diagnosis never changes."]}
        d={["Read this as a route, not a wishlist. On the left is where the fort is today; on the right is the target you set with the ambition lever; between them are the legs that get you there. The map is dependency made spatial: legs that depend on an earlier one are visibly locked until it lands, so you can always see which moves aren’t available yet and why.",
           "Then constrain it with the real levers — time, budget, appetite for disruption, and anything genuinely off the table — and the route re-solves around them. Legs drop off when they can’t be afforded, can’t fit the horizon, or need a closure the site won’t allow. Every projection stays bounded by what comparable sites have actually achieved, and none of it touches the diagnosis above — that’s settled. Only the path forward moves."]} />
      <Levers t={t} L={L} set={(p) => setL({ ...L, ...p })} />
      <RouteMap t={t} model={model} />
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 14 }}>
        <Stat t={t} label="On the route" value={`${model.includedIds.length} of ${MOVES.length}`} sub="legs currently taken" emphasise />
        <Stat t={t} label="First-year cost" value={money(model.routeCostK)} sub={`ceiling ${money(model.budgetK)}`} />
        <Stat t={t} label="Critical path" value={`${model.routeMonths} mo`} sub={`horizon ${model.horizon} mo`} />
        <Stat t={t} label="Reaches" value={`${Math.round(model.reachFrac * 100)}%`} sub="of the target destination" emphasise />
      </div>
    </div>
  ));

  add(3, "Beat 4 · The legs", (
    <div>
      {beatTag(t, 4, "The roadmap", "Interactive · 2 of 2")}
      <H t={t}>Each leg, costed and gated</H>
      <Body t={t} density={density}
        c={["The legs in dependency order at your current constraints — what’s on route, what’s locked, and why."]}
        s={["Here is every move at the constraints you’ve set — in dependency order, each with its benchmark-anchored payoff and its current status. Adjust the levers on the previous screen and this re-solves in step. Notice the root holds first at any setting; what changes is which later legs are worth their cost, and when."]}
        d={["Here is every move at the constraints you’ve set — laid out in dependency order, each with its benchmark anchor, its economics, and its current status on the route. Adjust the levers on the previous screen and this list re-solves in step with the map. Notice that the root always holds first: the narrative leads at any ambition because everything else depends on it. What changes below it is which later legs earn their cost, which are locked behind a predecessor, and which fall outside the time, budget or disruption you’ve allowed."]} />
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {["narrative", "programming", "dwell", "revenue", "repeat"].map((id) => {
          const m = model.byId[id]; const c = statusColors(t, m.status); const max = Math.max(...MOVES.map((x) => model.byId[x.id].payoffK), 1);
          return (
            <Card key={id} t={t} style={{ padding: 16, borderLeft: `4px solid ${c.border}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
                <span style={{ fontFamily: t.fontHead, fontSize: 17, color: t.ink }}>{m.name}</span>
                <span style={{ fontFamily: t.fontBody, fontSize: 11, fontWeight: 700, color: c.fg,
                  background: m.status === "on-route" ? t.accentBg : "transparent", padding: m.status === "on-route" ? "2px 9px" : 0, borderRadius: 999 }}>
                  {m.status === "gated" || m.status === "excluded" ? "🔒 " : ""}{STATUS_META[m.status].label.toUpperCase()}
                </span>
              </div>
              <div style={{ fontFamily: t.fontBody, fontSize: 13.5, color: t.muted, margin: "5px 0 10px", lineHeight: 1.5 }}>{m.blurb}</div>
              {m.status === "on-route" ? (
                <>
                  <div style={{ height: 7, background: t.panel2, borderRadius: 999, overflow: "hidden" }}>
                    <div style={{ width: `${(m.payoffK / max) * 100}%`, height: "100%", background: t.mode === "rich" ? t.hero : t.ink, transition: "width .35s ease" }} />
                  </div>
                  <div style={{ display: "flex", gap: 16, marginTop: 8, fontFamily: t.fontBody, fontSize: 12.5, color: t.muted, flexWrap: "wrap" }}>
                    <span>Payoff / yr <b style={{ color: t.ink }}>{money(m.payoffK)}</b></span>
                    <span>Cost <b style={{ color: t.ink }}>{money(m.costK)}</b></span>
                    <span>Return <b style={{ color: t.accent }}>{m.roi.toFixed(1)}×</b></span>
                    <span>Duration <b style={{ color: t.ink }}>{m.months} mo</b></span>
                  </div>
                </>
              ) : (
                <div style={{ fontFamily: t.fontBody, fontSize: 13, color: c.fg, background: t.panel2,
                  borderRadius: t.mode === "rich" ? 8 : 0, padding: "8px 12px" }}>Off the route — {m.reason}.</div>
              )}
              <div style={{ fontFamily: t.fontBody, fontSize: 12, color: t.mode === "rich" ? t.accentInk : t.warm, marginTop: 8, fontStyle: t.mode === "minimal" ? "italic" : "normal" }}>{m.benchmark}</div>
            </Card>
          );
        })}
      </div>
    </div>
  ));

  // Beat 5 — what's next (meta stripped; dependency reasons)
  const deferred = MOVES.filter((m) => !FIRST_ENGAGEMENT.includes(m.id));
  add(3, "Beat 5 · What's next", (
    <div>
      {beatTag(t, 5, "What's next", "1 of 3")}
      <H t={t}>The route names more than the first engagement</H>
      <Body t={t} density={density}
        c={["Five moves on the route; the first engagement is two. The other three can’t start until the story lands and the programming proves itself — they depend on it."]}
        s={["The route holds five moves. The first engagement is two of them: the narrative spine and the programming that proves it. The other three aren’t skipped — they physically can’t start until the story lands and the programming is running. Their turn comes; it just comes after.",
           "That dependency is the whole reason for the order. Build them first and there’s nothing underneath them to hold."]}
        d={["The route holds five moves, and it’s worth being exact about which come first. The first engagement is two of them: rebuild the narrative spine, and layer on the programming that proves it. The remaining three are not skipped and not optional — they simply cannot begin until the story has landed and the programming is running.",
           "This is dependency, not scoping preference. A café built before the narrative is just square footage; a shop before programming has nothing to attach to; a membership before a changing programme is a card with nothing behind it. Each later move waits on a specific predecessor, and doing it early would mean building on ground that isn’t there yet."]} />
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
        <Stat t={t} label="On the route" value="5 moves" />
        <Stat t={t} label="First engagement" value="2 moves" sub="the root + its first propagation" emphasise />
        <Stat t={t} label="Deferred" value="3 moves" />
      </div>
    </div>
  ));

  add(3, "Beat 5 · First vs later", (
    <div>
      {beatTag(t, 5, "What's next", "2 of 3")}
      <H t={t}>What we'd do first, and what waits on it</H>
      <Body t={t} density={density}
        c={["The split, and the dependency behind each later move."]}
        s={["The first engagement takes the root and the move that proves it. Everything else is placed by what it depends on — each later move waits on a specific predecessor, named plainly so you can see the whole shape and the order it has to run in."]}
        d={["Here is the split in full. The first engagement takes on the root and the single move that proves it works. Everything else is placed by dependency — not by what we’d prefer to sell, but by what each move physically needs in front of it. Each later leg names the predecessor it waits on, so the whole shape is visible and the order it has to run in is obvious."]} />
      <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
        {[...FIRST_ENGAGEMENT.map((id) => MOVE_BY[id]), ...deferred].map((m) => {
          const first = FIRST_ENGAGEMENT.includes(m.id);
          return (
            <Card key={m.id} t={t} style={{ padding: 14, borderLeft: `4px solid ${first ? t.accent : t.line}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontFamily: t.fontHead, fontSize: 16, color: t.ink }}>{m.name}</span>
                <span style={{ fontFamily: t.fontBody, fontSize: 11.5, fontWeight: 700,
                  color: first ? t.accent : t.muted, background: first ? t.accentBg : "transparent",
                  padding: first ? "3px 10px" : 0, borderRadius: 999 }}>
                  {first ? "FIRST ENGAGEMENT" : m.deferShort}
                </span>
              </div>
              <div style={{ fontFamily: t.fontBody, fontSize: 13, color: t.muted, marginTop: 6, lineHeight: 1.5 }}>
                {first ? m.blurb : m.defer}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  ));

  add(3, "Beat 5 · Start here", (
    <div>
      {beatTag(t, 5, "What's next", "3 of 3")}
      <H t={t}>Where this leaves you</H>
      <Body t={t} density={density}
        c={["Start where the chain starts: the narrative spine and the first programming. The rest is real, named, and waits on this landing first."]}
        s={["The place to start is where the chain starts: the narrative spine, and the first programming that proves it. Everything beyond is real and named — it simply waits until the fort has built the thing it depends on.",
           "That’s the whole engagement, first contact to a plan you could take to your board tomorrow."]}
        d={["The place to start is the place the whole chain starts: the narrative spine, and the first programming that proves it can carry weight. Cost and payoff exactly as the route showed them. Everything beyond that is real, named, and sequenced in the open — each move simply waits until the fort has built the thing it depends on.",
           "That is the whole engagement, from first contact to a plan you could take to your board tomorrow and defend line by line. Stage 5 is how the retainer keeps the build honest to it."]} />
      <Card t={t} tone="alt" style={{ marginTop: 8 }}>
        <div style={{ fontFamily: t.fontHead, fontSize: 17, color: t.ink, marginBottom: 6 }}>Start here</div>
        <div style={{ fontFamily: t.fontBody, fontSize: 14.5, color: t.muted, lineHeight: 1.6 }}>
          Engagement one: rebuild the narrative spine and layer the first programming onto it. The other three moves are sequenced behind it, each waiting on the leg it depends on.
        </div>
      </Card>
    </div>
  ));

  /* ---------------- STAGE 5 — THE RETAINER ---------------- */
  add(4, "Retainer · Alignment readout", (
    <div>
      <Kicker t={t}>Stage 5 — The retainer · Screen 1 of 2</Kicker>
      <H t={t}>Alignment readout</H>
      <Body t={t} density={density}
        c={["During the build, decisions drift from the defined target. The retainer catches it while it’s cheap. Here’s the fort over six review cycles."]}
        s={["The diagnosis was the start, not the end. During the build, decisions accumulate — each one either holds the defined target or nudges away from it. The retainer catches drift while it’s still cheap to correct. Here is the fort’s target line against where its decisions actually landed over six review cycles."]}
        d={["The diagnosis was the start, not the end. A strategy is only as good as the hundreds of build decisions taken after it, and each of those decisions either holds the defined target or nudges quietly away from it. The retainer exists to catch that drift while it is still a conversation rather than a rebuild. Here is the fort’s defined target line against where its decisions actually landed across six review cycles."]} />
      <Card t={t} style={{ marginTop: 8 }}><AlignmentTrail t={t} /></Card>
      <P t={t} style={{ marginTop: 14, fontSize: 14 }}>By cycle 4 the build had drifted — a decision to prioritise a car-park expansion over the interpretation fit-out pulled it off the narrative spine. Caught here, it’s a conversation. Caught at opening, it’s the whole problem again.</P>
    </div>
  ));

  add(4, "Retainer · Stakeholder cuts", (
    <div>
      <Kicker t={t}>Stage 5 — The retainer · Screen 2 of 2</Kicker>
      <H t={t}>The same read, three ways</H>
      <Body t={t} density={density}
        c={["The same alignment read, framed for owner, PM and operator. It assesses decision-to-strategy fit — never the people."]}
        s={["Drift only gets corrected if each stakeholder can act on it, so the same alignment read is delivered in three framings — owner, project manager, operator. Note what it assesses: decision-to-strategy fit, never the people. Nobody is being marked; the plan is."]}
        d={["Drift only gets corrected if the person holding each lever can act on it, so the same underlying read is delivered three ways — to the owner, the project manager, and the operator — each in the terms that stakeholder actually decides in. And note carefully what it assesses in every cut: the fit between decisions and the defined strategy, never the performance of the people making them. Nobody is being marked here; the plan is."]} />
      <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
        {[
          { r: "Owner", q: "Is the investment still tracking to the strategic outcome we agreed?", a: "Two of six cycles drifted; both are recoverable this quarter. The narrative-first sequence is intact, so the core thesis still holds — but the car-park decision needs revisiting before it hardens.", tone: "accent" },
          { r: "Project Manager", q: "Are the build decisions consistent with the defined target?", a: "Cycle 4's re-prioritisation broke sequence: capital moved to dwell infrastructure before the narrative fit-out it depends on. Re-order these two work packages and alignment returns to green.", tone: "alt" },
          { r: "Operator", q: "Does the day-to-day still match what the visitor was promised?", a: "Front-of-house is delivering the current offer well. The risk isn't performance — it's that the programming the team was promised to run is slipping behind the build, so there'll be a story with nothing scheduled around it.", tone: "" },
        ].map((c) => (
          <Card key={c.r} t={t} tone={c.tone === "alt" ? "alt" : undefined} style={{ borderLeft: c.tone === "accent" ? `4px solid ${t.accent}` : undefined }}>
            <div style={{ fontFamily: t.fontBody, fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: t.muted, marginBottom: 4 }}>Delivered to · {c.r}</div>
            <div style={{ fontFamily: t.fontHead, fontSize: 16.5, color: t.ink, marginBottom: 8 }}>{c.q}</div>
            <div style={{ fontFamily: t.fontBody, fontSize: 14.5, color: t.muted, lineHeight: 1.6 }}>{c.a}</div>
          </Card>
        ))}
      </div>
      <div style={{ fontFamily: t.fontBody, fontSize: 12.5, color: t.muted, textAlign: "center", marginTop: 20 }}>
        End of the walkthrough. Try the density control and UI toggle up top, the A/B findings in Beat 1, and the levers in Beat 4.
      </div>
    </div>
  ));

  return S;
}

/* ============================================================================
   SHELL
   ========================================================================== */
const STAGES = ["Entry", "Discovery", "Backstage", "The Output", "Retainer"];

function Segmented({ t, label, value, options, onChange }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <span style={{ fontSize: 12, color: t.muted }}>{label}</span>
      <div style={{ display: "inline-flex", gap: 4, background: t.panel2, padding: 4, borderRadius: t.mode === "rich" ? 999 : 3, border: `1px solid ${t.line}` }}>
        {options.map(([k, l]) => (
          <button key={k} onClick={() => onChange(k)} style={{ border: "none",
            background: value === k ? (t.mode === "rich" ? t.accent : t.ink) : "transparent",
            color: value === k ? "#fff" : t.muted, padding: "6px 12px", borderRadius: t.mode === "rich" ? 999 : 2,
            fontSize: 12.5, fontWeight: 600 }}>{l}</button>
        ))}
      </div>
    </div>
  );
}

function InternalBanner({ t }) {
  return (
    <div style={{ maxWidth: t.maxw, margin: "0 auto 18px", display: "flex", alignItems: "center", gap: 10,
      background: t.mode === "rich" ? "#fff4e6" : "#f0e6d2", border: `1px solid ${t.mode === "rich" ? "#f0c887" : "#d9c39a"}`,
      borderRadius: t.mode === "rich" ? 10 : 2, padding: "8px 14px" }}>
      <span style={{ fontFamily: t.fontBody, fontSize: 10.5, letterSpacing: ".14em", fontWeight: 700, color: "#fff",
        background: t.warm, padding: "3px 9px", borderRadius: 999 }}>INTERNAL</span>
      <span style={{ fontFamily: t.fontBody, fontSize: 12.5, color: t.mode === "rich" ? "#8a5a12" : t.warm }}>Practitioner view — not shown to the client</span>
    </div>
  );
}

function App() {
  const [uiMode, setUiMode] = useState("minimal");
  const [density, setDensity] = useState("standard");
  const [whyMode, setWhyMode] = useState("chain");
  const [traceSel, setTraceSel] = useState(null);
  const [idx, setIdx] = useState(0);
  const [L, setL] = useState({ ambition: 0.6, horizon: 24, budgetK: 500, canClose: false, offTable: [] });
  const [J, setJ] = useState({
    front: "reset",
    pf: {
      name: "Coastal Heritage Fort",
      exists: ["Feasibility study", "Operator appointed"],
      annualVisitors: "200,000", revenue: "£840,000", spendHead: "4.20", staff: "18",
      budget: "£150k–£500k", timeline: "12–24 months",
    },
    capture: {}, // live discovery capture, keyed by coverage item id
    booking: { day: 16, time: "11:00" },
  });

  const t = useMemo(() => theme(uiMode), [uiMode]);
  const model = useMemo(() => computeModel(L), [L]);
  const screens = useMemo(
    () => buildScreens({ t, J, setJ, density, L, setL, model, whyMode, setWhyMode, traceSel, setTraceSel }),
    [t, J, density, L, model, whyMode, traceSel]
  );

  const cur = screens[idx];
  const atStart = idx === 0, atEnd = idx === screens.length - 1;
  const curStage = cur.stage;
  const go = useCallback((d) => {
    setIdx((i) => Math.max(0, Math.min(screens.length - 1, i + d)));
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, [screens.length]);
  const jumpToStage = (sIdx) => {
    const first = screens.findIndex((s) => s.stage === sIdx);
    if (first >= 0) { setIdx(first); window.scrollTo({ top: 0, behavior: "smooth" }); }
  };
  const stageScreens = screens.filter((s) => s.stage === curStage);
  const posInStage = stageScreens.findIndex((s) => s === cur);

  return (
    <div style={{ background: t.bg, minHeight: "100vh", fontFamily: t.fontBody, color: t.ink }}>
      {/* TOP BAR */}
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: t.bg, borderBottom: `1px solid ${t.line}` }}>
        <div style={{ maxWidth: t.maxw, margin: "0 auto", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontFamily: t.fontHead, fontSize: 19, fontWeight: 700 }}>Rūya</span>
            <span style={{ fontFamily: t.fontBody, fontSize: 12, color: t.muted }}>decision-support walkthrough · prototype</span>
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <Segmented t={t} label="Density:" value={density} onChange={setDensity} options={[["concise", "Concise"], ["standard", "Standard"], ["deep", "Deep"]]} />
            <Segmented t={t} label="UI:" value={uiMode} onChange={setUiMode} options={[["minimal", "Minimal"], ["rich", "Rich"]]} />
          </div>
        </div>
        {/* PROGRESS */}
        <div style={{ maxWidth: t.maxw, margin: "0 auto", padding: "0 20px 12px" }}>
          <div style={{ display: "flex", gap: 8 }}>
            {STAGES.map((s, i) => {
              const active = i === curStage, done = i < curStage;
              return (
                <button key={s} onClick={() => jumpToStage(i)} style={{ flex: 1, textAlign: "left", border: "none", background: "transparent", padding: 0, cursor: "pointer" }}>
                  <div style={{ height: 4, borderRadius: 999, background: active ? (t.mode === "rich" ? t.accent : t.ink) : done ? (t.mode === "rich" ? t.accentBg : t.line) : t.line, marginBottom: 6 }} />
                  <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                    <span style={{ fontSize: 11, color: active ? t.ink : t.muted, fontWeight: active ? 700 : 500 }}>{i + 1}</span>
                    <span style={{ fontSize: 11.5, color: active ? t.ink : t.muted, fontWeight: active ? 700 : 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* BODY */}
      <div style={{ maxWidth: t.maxw, margin: "0 auto", padding: "26px 20px 40px" }}>
        {cur.internal && <InternalBanner t={t} />}
        <div key={idx} className="fadein">{cur.node}</div>
      </div>

      {/* BOTTOM NAV */}
      <div style={{ position: "sticky", bottom: 0, background: t.bg, borderTop: `1px solid ${t.line}` }}>
        <div style={{ maxWidth: t.maxw, margin: "0 auto", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <button onClick={() => go(-1)} disabled={atStart} style={{ border: `1px solid ${t.line}`, background: t.panel, color: atStart ? t.line : t.ink, padding: "10px 18px", borderRadius: t.mode === "rich" ? 999 : 3, fontSize: 14, fontWeight: 600, opacity: atStart ? .5 : 1 }}>← Back</button>
          <div style={{ textAlign: "center", minWidth: 0 }}>
            <div style={{ fontSize: 12.5, color: t.ink, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{cur.label}</div>
            <div style={{ display: "flex", gap: 4, justifyContent: "center", marginTop: 5 }}>
              {stageScreens.map((_, i) => (
                <span key={i} style={{ width: i === posInStage ? 16 : 6, height: 6, borderRadius: 999, background: i === posInStage ? (t.mode === "rich" ? t.accent : t.ink) : t.line, transition: "width .2s" }} />
              ))}
            </div>
          </div>
          <button onClick={() => go(1)} disabled={atEnd} style={{ border: "none", background: atEnd ? t.line : (t.mode === "rich" ? t.accent : t.ink), color: "#fff", padding: "10px 22px", borderRadius: t.mode === "rich" ? 999 : 3, fontSize: 14, fontWeight: 600, opacity: atEnd ? .5 : 1 }}>{atEnd ? "End" : "Next →"}</button>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
