---
name: presentation
description: Use this skill whenever the user asks for a presentation, deck, slides, a .pptx file, or «сделай презентацию», «сверстай слайды», «презентация по…», «сделай в этом стиле» (приложена презентация-образец), «переделай презентацию», «поправь слайды». Builds a deck as editable HTML (deck.html) on a fixed 1280×720 stage and exports it to a REAL .pptx: native text, shapes, embedded fonts, speaker notes. Reads an attached .pptx completely (layers, groups, pictures/SVG, tables, charts, styles) and can copy its style. No npm/internet — everything ships inside the skill.
previewDescription: Презентации (HTML → native PPTX)
---

You build presentations as an **HTML deck** (`deck.html`) on a fixed 1280×720
stage and export it to a **native .pptx** (real text, shapes, embedded fonts,
notes). No npm, pip or downloads — everything is inside the skill. `deck.html`
is the single source of truth: "fix slide 3" means edit the HTML and rebuild
the .pptx.

## Result contract

- The working folder keeps **exactly two files**: `<kebab-slug>.deck.html` and
  `<kebab-slug>.pptx`. Source images live in a subfolder (e.g. `images/`) if
  the user brought them; after the build they are embedded into the HTML.
- No `deck.js`/`deck.ts`/build scripts in the result: HTML is the source.
- Reply to the user with absolute paths to the .pptx and .html plus a one-line
  summary.
- Drafts, render folders and extracted media go to temp only, never into the
  project.

## Command (the only allowed runtime)

```bash
ELECTRON_RUN_AS_NODE=1 "$GIGATOOL_NODE" "$HOME/.wsc/config/skills/presentation/helpers/index.cjs" deck.html --pptx
```

`index.cjs` runs lint → asset inlining → real render (PNG + reports) → export.
If `$GIGATOOL_NODE` is not set, say the deck cannot be built outside the app
and stop; do not substitute another interpreter and do not install anything.

Full helper list, report formats and diagnostics: `reference.md`.

## Workflow

### 0. Pick the mode

| Request | Mode |
|---|---|
| "make a presentation about X" | new deck (steps 1–6) |
| "make it in the style of this deck" (a .pptx attached) | copy style (step 1B), then 2–6 |
| "rework/improve this presentation" (a .pptx attached) | read it (step 1C), then 2–6 |
| "in the style of <saved>" | profile from `~/.wsc/config/styles/` |

Before working, ask the user only what really changes the deck: topic/goal,
audience, approximate length, must-have facts/numbers, deadline (if they ask
for "15 minutes" — that's 8–10 slides). Do not start laying out before you
understand the goal and the length.

### 1. Assemble the style

**A. Built-in styles** — `styles/index.json`: `grid-paper` (product/analytics),
`ink-press` (reports/stories), `signal-night` (strategy/pitch). Pick by content
type without asking; if the user named a style, use it.

**B. Style of an attached deck:**

```bash
... style-profile.cjs "<path to attached .pptx>" --name "Style name"
```

It reads `~/.wsc/config/styles/<slug>/`:
- `tokens.css` — paste into the deck (after `stage.css`, before `_base.css`);
- `assets/` — backgrounds/decor; use them as local images;
- `profile.json` — principles (density, accent, fonts) and evidence.
Replace a proprietary font from the sample with the nearest vendored face and
say so in the reply.

**C. Someone else's .pptx to rework** — read it with `read-pptx.cjs` (below),
then rebuild in HTML; take the style from a profile built from the same file.

### 1+. Reading a .pptx

```bash
... read-pptx.cjs deck.pptx                 # summary: slides, themes, media, fonts
... read-pptx.cjs deck.pptx --outline       # texts only (outline)
... read-pptx.cjs deck.pptx --slide 7       # one slide: all elements and styles
... read-pptx.cjs deck.pptx --extract-media /tmp/deck-media
```

Read EVERY slide you need one by one (`--slide N`) before rebuilding:
z-order, groups, px coordinates (1:1 with HTML), SVG vectors, tables, charts,
notes, and for every text — font, size, color with the inheritance source
(layout/master/default) and the background under it (`on=`). Never invent the
content of an attached file: if the report does not show it, say you did not
find it.

For style reuse, media carry automatic roles and stats: `[background]`
(dark/wide → good as a background), `[logo]`, `[decor]`, `[icon]`, `[photo]`,
`[graphic]`, plus `avgColor/dark/saturated/hasAlpha`. Choose background/decor by
role and stats — no eyes needed; take meaningful icons from Lucide
(`icons.cjs --get`), meaningful pictures from chat generation. Role is purpose,
not "what is drawn": for an unclear `[graphic]` ask the user or replace it with
your own graphic.

### 2. Plan the structure

Typical arc: cover → context (1–2) → core (3–5) → plan/comparison → closing
with decisions. 15 minutes ≈ 10 slides. Every slide carries one idea; two ideas
is two slides. Never duplicate texts between slides.

### 3. Write deck.html

Skeleton (CSS block order is mandatory):

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Title</title>
<style>
/* 1. stage.css — as is, never change */
/* 2. fonts/fonts.css — as is */
/* 3. styles/<chosen>/tokens.css or tokens.css from a profile */
/* 4. styles/_base.css — as is */
/* 5. only what is unique to this deck */
</style>
</head>
<body>
<div class="deck-viewport"><div class="deck-stage" id="deck-stage">
  <section class="slide cover" data-role="cover">…</section>
  …
</div></div>
<div class="deck-controls">…</div>
<script>/* navigator: --fit, arrows, hash. Copy from examples/example-deck.html */</script>
</body>
</html>
```

Rules:

- slides and blocks come from `patterns.md` (verified patterns and their
  combinations); do not invent a new grid until you have tried the existing
  ones;
- **one-box rule**: text inside a colored box is written as runs directly in
  the box (`.t-title/.t-body/.t-cap`, `<b>`, `<br>`) with nothing else in the
  box, so the .pptx has one editable shape; icons/badges go next to it via
  `.card-stack`. **Separate every row boundary with `<br>`** — without it the
  exporter merges the runs into one paragraph and PowerPoint shows the title
  and body on one line (probe warns `missing-br`);
- **accent budget**: every content slide carries at least one emphasis accent
  that shows the eye where to look (accent card/node/cell/step, accent number,
  chart bar/area, highlighted table row). More than one accent is fine when the
  layout expresses real hierarchy; do not accent everything equally. Kicker,
  footer, soft icon badges and icon strokes do not count as emphasis (probe
  warns `no-accent`);
- **box fill**: do not leave tall boxes half-empty — two lines of text in a
  260px box reads as a defect (probe warns `sparse-box`); add substance or
  shorten the box;
- colors/fonts/radii only via tokens `var(--…)`; hex in markup is forbidden;
- charts — from `charts.md` (SVG/CSS, no libraries), numbers must be honest;
- speaker notes — `<template data-pptx-notes>…</template>` inside the slide;
- icons — `node helpers/icons.cjs --get <name>` (Lucide, not emoji);
- images — local files (`<img src="images/...">`), not URLs; every image needs
  an `alt` (empty `alt=""` for decoration); generate pictures ONLY with a chat
  tool (e.g. `gigachat_image`) before assembling; the deck itself cannot call
  tools;
- no external links/fonts/scripts (except our navigator) — the deck is offline;
- write 8–14 slides in one pass; more — in two passes (skeleton + first slides,
  rebuild, then the rest).

### 4. Render loop (mandatory)

```bash
... index.cjs deck.html          # report + PNG + inventory, no pptx
```

Read the stdout lines (`slide N: TEXT-CLIPPED: …`) and the diagnostics table in
`reference.md`, fix the HTML, repeat. Goal: `render: clean`. Typical beginner
mistakes: fixed heights on text blocks, absolute positions, empty bottom of a
slide, hex colors outside tokens, runs in a box not separated by `<br>`.

While the render is not clean, do not build the .pptx: the user would get the
same defect.

### 5. Export and self-reflection (mandatory loop)

```bash
... index.cjs deck.html --pptx     # build + line-spacing post-processing
... validate.cjs deck.html         # report: HTML checks + .pptx artifact
```

`index.cjs deck.html --pptx` puts `<slug>.pptx` **next to deck.html** (and
prints `artifact: <path>`); `--out-dir` is only needed to place artifacts
elsewhere.

`validate.cjs` re-renders the deck and additionally checks the .pptx itself
(empty placeholders, split "backdrop + separate textbox" pairs, WCAG AA run
contrast, minimum font size, hierarchy, fullness, density, exact line spacing,
placeholder texts, Russian typography, stage size, embedded fonts,
`<a:normAutofit>`, notes and more). Work in a loop: fix → `validate` → fix
until you see `validate: clean` (errors block delivery; warnings must at least
be mentioned to the user). Then hand over the files.

The result next to `deck.html` is `<slug>.pptx`: native text, shapes, embedded
TTFs, notes. SVG charts become a vector group ("Convert to Shapes" works). If
the report has `FONT NOT LOADED`, the validator raises a `FONT NOT LOADED`
error: replace the font first, then deliver.

### 6. Deliver

- short summary: what the deck is, number of slides, style, paths;
- ask the user to verify a couple of facts/numbers if the data is estimated;
- on "fix slide N" — edit `deck.html`, run `index.cjs --pptx` again,
  overwrite the .pptx (same name).

## Hard bans

- no `.ts/.js` decks and no npm/pip/curl;
- no chat tools from HTML or helpers;
- no emoji, external URLs, CDNs;
- never change `stage.css` (the 1280×720 stage is the export contract);
- do not "fix" overflow by aggressively shrinking the font — first cut the
  text or switch the pattern;
- do not delete `deck.html` after export — it is the source for edits.

## Files

`patterns.md` — slide patterns · `charts.md` — charts · `reference.md` —
helpers/formats/diagnostics · `examples/example-deck.html` — reference deck
(open it when in doubt about the skeleton).
