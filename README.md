# Rūya — Decision-Support Journey Prototype

An interactive, in-memory React prototype that validates the **full client
journey** of a decision-support consultancy tool — from first contact through
the output presentation to the ongoing retainer.

## Run it

Just open **`index.html`** in any modern browser. It is fully self-contained:
React and ReactDOM are inlined and the JSX is precompiled, so there is **no
build step, no server, and no network dependency**. State is in-memory only —
there is no backend and nothing is persisted.

A sample project is preloaded so it opens working: a heritage coastal fort with
~200k annual visitors who don't stay, spend, or return.

## Two global toggles (top of every screen)

- **UI direction** — `Minimal` (calm / editorial) vs `Rich` (designed, colour,
  cards). Toggle any time to compare directions.
- **The "why" visual** (Stage 4, Beat 2) has three switchable renderings:
  **A · Chain**, **B · Propagation**, **C · Layered**.

## The five stages (persistent progress indicator; click a stage to jump)

1. **Entry** — front selection, short factual intake, "what happens next".
2. **Discovery** — framing, the presenter's backstage coverage checklist,
   targeted gap-fill.
3. **Backstage** — consolidation + benchmark-anchored scoring, and the
   founders' verdict moment (internal; the client never sees it raw).
4. **The Output** — the heart, built deep across five beats:
   findings → why/root → conclusion → interactive roadmap → what's next.
5. **Retainer** — alignment drift readout and three stakeholder cuts.

Move through the whole thing with **Back / Next** at the bottom.

## Where the numbers come from

All scoring and roadmap economics live in **one commented function**,
`computeModel(ambition)` in `src/app.jsx`, using bounded weighted rules. Every
lever has a realistic min/max drawn from a comparable-sites benchmark set, so
outputs stay defensible and the ambition slider stops where reality stops. Swap
that one function to re-tune the model.

## Editing / rebuilding

The single-file `index.html` is generated from source:

- `src/app.jsx` — all component and screen logic (edit here)
- `src/styles.css` — base styles
- `build.mjs` — inlines React + ReactDOM and precompiles the JSX

```bash
npm install     # dev-only: React UMD builds + Babel for the build step
npm run build   # regenerates index.html
```
