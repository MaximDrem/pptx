# presentation v3 — HTML-first presentations with a native .pptx export (vision)

A skill for the work agent: the deck is built as **editable HTML**
(`deck.html`, 1280×720 stage) and exported to **native PowerPoint** — real
text, shapes, embedded TTFs, speaker notes. Fully offline: no npm/pip/network,
all bundles live in `vendor/`.

On top of that the skill can **read a .pptx completely** (layers, groups,
pictures and SVG, tables, charts, text styles, notes, layout themes) and **copy
the style of an attached presentation** (background, fonts, decor, layout
density).

## What is verified (and where)

| Layer | Verification | Status |
|---|---|---|
| Reading .pptx | 10 real decks (incl. `ГигаКот_Стратегия_final.pptx`, 19 slides, 266 shapes, 95 pictures, 9 groups, 28 gradients, SVG/EMF/WDP) — the parser self-check against raw XML tags matches | ✅ on this machine |
| HTML stage | `stage.css`, `_base.css`, 3 styles, fonts, Lucide icons — rendered in real Chromium | ✅ |
| Render loop | probe (12 check types + metrics/inventory) on the reference deck — clean; the defect fixture catches all 6 types; an undeclared font yields `FONT NOT LOADED`; 10 patterns — clean | ✅ |
| .pptx export | `example-deck.html` → 5 slides, 57 text runs, 68 shapes, 4 embedded TTFs, notes; LibreOffice imports and renders 1:1 | ✅ |
| In-app one-shot | `app/deck-render.ts` (off-screen Electron, capturePage, export) — written following the proven `--pptx-verify` pattern, but Electron is not available on this machine | ⚠️ tested on the work laptop (see `tests/acceptance.md`) |
| Style profile | extracted from `ГигаКот` (dark theme, background from pixels `#002A3A`, assets by role), `Сводка почты` (dark), `hybrid-work` (light) | ✅ |
| Template extraction (v55) | `style-profile.cjs --deploy`: cover-first backgrounds (label `(cover)`), near-white lockups as branding ≠ decor, up to 6 decors + 2 photos + 4 icons per template, placements with rotation, Box styles (runner-up fill → `--c-surface-2`/`.card.deep`), per-slide Layout recipes; slide numbers are 1-based | ✅ |
| Editing guards (v55) | lint errors on raw `<h3>/<p>/<ul>` inside pattern boxes (one-box rule); SKILL spells out the repeating-markup anchor trap, "first failed edit → full rewrite", and "never invent asset names (read `template-assets.md`)" | ✅ |
| Media roles (auto) | background/logo/decor/icon/photo/graphic from geometry and usage + `visual` (avgColor, dark, hasAlpha) — verified on ГигаКот | ✅ |
| Text styles | font/size/color with the inheritance chain (run → endPara → defRPr → lstStyle → layout/master placeholders → txStyles → default), `hl=` (highlight), `on=` (background under text) | ✅ |
| Box+text merging | `single-box` regression: run boxes → one PowerPoint shape, block children → not | ✅ |
| Text overlap | line-level detector (Range API + SVG labels) in probe + `TIGHT-GAP`; found and fixed a real export overlap (exact line spacing) | ✅ |
| Artifact validation | `validate.cjs`: ports of the python checks (empty placeholders, split-box, WCAG contrast, hierarchy, fullness, density, repetition, notes) + font size, placeholders, typography, stage size, native text/fonts, normAutofit — plus a `validate.json` report | ✅ |
| .pptx post-processing | `pptx-post.cjs`: exact→proportional line spacing (37 fixes per deck), PDF render without overlaps | ✅ |
| Contract guards | `expand-styles` (managed CSS block), `hidden-slide`/`missing-br`/`no-accent`/`sparse-box` probe checks, export blocked on blocking errors (exit 4, no .pptx); taste findings are labelled `suggestion:` and never block, temp-dir decks refused, `slide-count-mismatch` | ✅ |
| Vision workflow (v3) | `shots.cjs` renders any .pptx to per-slide PNGs (via the app's `--pptx-verify`) + text digest; the SKILL requires looking at template slides before style copying and at own slides before delivery | ✅ (renderer on the work laptop) |
| Template-copy guards (v3) | `validate`: `decor-as-background` error (transparent/decor media stretched as a background), `visual-scarcity` warning; `style-profile`: contrast guard for extracted ink/bg | ✅ |
| Self-reflection driver (v3) | `review.cjs`: render → PNG paths → probe → validate → structural read → checklist in one command; template mode adds reference shots | ✅ |
| Structural read (v3, v54) | `inspect.cjs` + `review.cjs` print what the DOM measures and the eye cannot: real background layer, decor + coordinates, blocks, card fills, content band, probe issues, and a factual template-asset usage map (which deployed asset is used on which slide). `probe` inventory gained `layers`/`blocks`/`cls`/`src`/`fill`; no taste verdicts — layout variety, pictures and decor are judged by looking (SKILL §6 checklist) | ✅ |
| Default style upgrade (v3) | rebuilt tokens for all three styles (accent-2, `--cover-glow`), `cover-art` glow on covers/sections, `timeline` pattern, themed surfaces | ✅ |

Local acceptance run: `node tests/local/run-local.cjs` (Chrome required;
the LibreOffice check is optional).

## Architecture

```
deck.html ──┬─ expand-styles.cjs  canonical CSS into the managed style block
            ├─ assets.cjs       inline fonts/images as data URIs
            ├─ lint-deck.cjs    static checks (location, offline, files, classes)
            ├─ render.cjs ──► app --deck-render (Electron, off-screen)
            │                   ├─ probe.js (metrics + inventory)
            │                   ├─ slide-NN.png, report.json, inventory.json
            │                   └─ dom-to-pptx.bundle.js → <slug>.pptx (blocked on
            │                      blocking issues: exit 4, no export)
            └─ read-pptx.cjs / style-profile.cjs   (input: someone else's .pptx)
```

- **Source and build are separate.** `deck.html` is a small editable source
  (relative `images/…`, managed style block). The builder expands styles and
  inlines assets into a temp build copy for render/export, so the source the
  model edits never contains data URIs. `index.cjs --inline` bakes a
  standalone single-file HTML on request.
- **The model never copies the CSS.** The deck carries one managed block
  (`<style data-presentation-style="signal-night">`…) and the builder installs
  `stage.css` + `fonts.css` + tokens + `_base.css` on every run; deck-authored
  CSS lives in a separate block. This is what keeps weak models on the
  contract (the old copy-by-hand workflow produced `display:none` decks that
  the exporter dropped).
- **HTML is the source of truth.** Edits = HTML edits; the .pptx is rebuilt.
- **Layout is measured, not guessed.** The exporter does not "understand"
  flex/grid; it takes the final `x/y/w/h` of every element from Chromium — so
  the HTML and the .pptx match pixel for pixel.
- **.pptx reading is a custom parser** (`helpers/lib/xml.cjs` +
  `lib/pptx.cjs`): dependency-free, with groups/transforms, run styles and a
  media inventory.

## Contracts that must not be broken

- the working folder keeps the deck and the .pptx: decks live in the chat
  workspace, never in `/tmp` (`lint-deck` fails a deck in temp);
- the stage is exactly 1280×720 (= 13.333×7.5in = 96dpi): PNG and PDF are
  slide-for-slide;
- slides are `<section class="slide">`, visibility via `.active` (not
  `display:none` — the export engine skips such slides);
- the canonical CSS lives in the managed block
  (`<style data-presentation-style="…">`), installed by `expand-styles.cjs`;
- notes — `<template data-pptx-notes>` inside the slide;
- fonts — vendored only (`fonts/`); hex colors — only in tokens;
- every row inside a filled box is separated by `<br>` (one-box rule);
- the export is blocked (exit 4) while blocking layout issues exist, so an
  empty/broken deck cannot be delivered;
- no internet and no chat tools inside the deck/helpers.

## Provenance and licenses

- `vendor/dom-to-pptx.bundle.js` — dom-to-pptx 2.1.2 (MIT), distributed as is;
  sha256 matches the npm dist. License next to it.
- `vendor/jszip.bundle.cjs` — JSZip 3.10.1 (MIT/GPLv3), sha256 = npm dist.
- `fonts/` — Google Fonts (OFL 1.1), latin+cyrillic: Inter, Source Serif 4,
  Unbounded, JetBrains Mono (woff2 — rendering, ttf — embedding into .pptx);
  copyrights and the full license text — `fonts/NOTICE.txt`,
  `fonts/LICENSE-OFL-1.1.txt`.
- `styles/_base/icons/` — Lucide (ISC), a subset, attribution in the files.
- `stage.css` is conceptually based on `viewport-base.css` from frontend-slides
  (MIT); the style set was inspired by curated presets from the same project.
  The code was written from scratch and verified by rendering.

## Known limitations

- EMF/WMF/WDP from old .pptx files are read and extracted but **not embedded
  into HTML** (the browser cannot draw them): on rebuild they must be replaced
  (SVG/PNG/redrawn) — the skill lists such files honestly.
- Complex CSS effects (`backdrop-filter`, blend modes) are rasterized into a
  picture by the exporter — editability is unaffected, but the text inside is
  no longer text.
- Group rotation is approximated when reading (flagged in JSON).
- Proprietary fonts from a sample are replaced with the nearest vendored
  face — the skill tells the user about the substitution.
- A reused template background is embedded per slide, so decks reusing
  heavy template art grow by the image size per slide (a 3-slide deck with a
  565KB background is ~2.6MB). Reuse backgrounds only where the template uses
  them.
- Pixel stats for media are computed for PNG/SVG; for JPEG/WebP/WDP/EMF an
  honest "stats unavailable offline" is written (the role is still determined
  from geometry and usage).
