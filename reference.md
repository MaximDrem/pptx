# reference.md — helpers, formats, diagnostics

All commands run from the agent environment **in the user's working folder**
(the chat workspace): the deck and the .pptx must live there, temp is only for
drafts and extracted media. Common template:

```bash
ELECTRON_RUN_AS_NODE=1 "$GIGATOOL_NODE" "$HOME/.wsc/config/skills/presentation/helpers/<helper>.cjs" <args>
```

If `$GIGATOOL_NODE` is not set, you are not inside the app: say so and stop.

## read-pptx.cjs — full .pptx reading

```bash
# deck summary (default): themes, fonts, media, slides
... read-pptx.cjs deck.pptx

# one slide in full: all elements, z-order, groups, text styles
... read-pptx.cjs deck.pptx --slide 7

# all elements of all slides (small decks only)
... read-pptx.cjs deck.pptx --elements

# texts only (fast outline)
... read-pptx.cjs deck.pptx --outline

# extract media (png/jpeg/svg/emf/…) into a folder
... read-pptx.cjs deck.pptx --extract-media /tmp/deck-media

# full JSON (written to temp; the path is printed)
... read-pptx.cjs deck.pptx --json /tmp/deck.json
```

What `--slide N` shows (z-order = paint order, bottom layers first):

```
  41. [pic] id=41 "Рисунок 40" 788,-36 397×397px rot=50.1°  media=image49.png
   3. [grpSp] id=3 "Группа 2" 388,124 945×546px children=2
     1. [pic] id=4 "Рисунок 3" … media=image51.png
  13. [pic] id=13 "Рисунок 12" … media=image32.svg SVG-vector
   7. [sp] id=7 "TextBox 6" 58,458 477×55px fill=none autofit=shape
      ¶1 «Стратегия 2026–2029» [28pt "SB Sans Display Light" left no-bullet lh100%]
  12. [gf] id=12 … table 4×7
  15. [gf] id=15 … chart(doughnut)
      series «» cats=[API (2832), …] vals=[2832, …]
```

Notation: `sp` — shape/text, `pic` — picture, `grpSp` — group (children are
indented, coordinates are already in slide space), `cxn` — connector, `gf` —
graphicFrame (table/chart). `SVG-vector` — a vector picture with no raster,
`svg-fallback` — SVG with a raster backing. Coordinates are px on the
1280×720 canvas (1:1 to the HTML stage), `rot` — degrees, `fill=` — fill
(solid/grad/img), `media=` — the file name in `ppt/media` + role.

Text and styling details:

- **font, size (pt), bold/italic/underline, color (+alpha), highlight
  (`hl=`)** — per run;
- **run style source**: `explicit` (in the run), `layout`/`master`
  (placeholder), `theme` (+mj-lt/+mn-lt), `styleRef`, `default` (nothing set in
  PowerPoint — the 18pt/black/minor-font defaults are shown, marked
  `(defaults)`);
- inheritance chain: run `rPr` → `endParaRPr` → `pPr/defRPr` → level
  `lstStyle` → layout placeholder → master placeholder → master `p:txStyles` →
  default;
- **slide background**: `bg=` with the source (`slide` | `full-slide-image` |
  `full-slide-shape` | `layout` | `master`) and the media name;
- **background under text**: `on=` — the fill of the card/row, a picture
  (`on=img(image8.png)`) or `on=bg(...)` when text sits directly on the slide
  background;
- **decorative elements**: pictures carry roles
  `[background|logo|decor|icon|photo|graphic]`, shapes — `fill`, `line`,
  `shadow/glow`, `custGeom`, `roundRect`, plus `SVG-vector` / `svg-fallback`;
- line/paragraph metrics: `lh100%`, `sb/sa`, `algn`, `lvl`, bullet, `autofit`
  (including `fontScalePct` for `normAutofit`).

JSON (`--json`) contains everything: `slides[].elements[]` (box in EMU/in/px,
fill, line, effects, text with runs, custGeom, tables with cells, charts with
series), `media[]` (sizes, use by slides and layouts, orphan flag),
`theme`/`themes`/`themeUsage` (per master), color and font histograms,
`selfCheck` (parser vs raw XML tags). Keys can be queried with `jq`/grep.

### Media roles and stats (choosing without eyes)

The role is detected **automatically** from geometry, usage and pixel stats —
no template-specific hardcode:

| Role | How it is detected | How to reuse |
|---|---|---|
| `background` | full-slide layer, layout/master background, dark/wide | slide background (or replace with a token color) |
| `logo` | small, at the top edge, transparency, repeated | logo in the header/cover |
| `decor` | at an edge or transparent+saturated | decorative shapes |
| `icon` | square, repeated | icon illustrations |
| `photo` | large area (>25% of the slide) | content photo |
| `graphic` | purpose unclear | inspect `visual` |

`visual` (when decodable): `avgColor`, `luminance`, `dark`/`light`,
`saturated`, `hasAlpha`, `palette` (SVG). For `.jpg/.webp/.wdp/.emf` an honest
`stats unavailable offline` is printed. `--no-visual` disables decoding (faster
on large decks).

Important: a role is a **purpose**, not "what is drawn". For meaningful icons
use Lucide (`icons.cjs --get`), for meaningful pictures use chat generation. If
the model has an image viewer, it may additionally look at files from
`--extract-media`; without one, roles and `visual` are enough.

When to use what:

- "make it in the style of this deck" → `style-profile.cjs` first (below);
- "rework/improve this deck" → `--outline` + `--slide N` for the needed slides
  + `--extract-media` to reuse pictures;
- "what is inside" → the summary + `--elements` for small decks.

## style-profile.cjs — style profile from a .pptx

```bash
... style-profile.cjs deck.pptx --name "Name" [--slug slug] [--assets key|all|none] [--max-assets N] [--deploy <deck-dir>]
```

Creates `~/.wsc/config/styles/<slug>/` (outside the skill folder — survives
skill updates):

- `profile.json` — the evidence base: theme, tokens, fonts, histograms,
  density, principles, list of extracted media;
- `tokens.css` — a ready `:root` to paste into a deck (referenced from the deck
  as `<style data-presentation-style="profile:<slug>">`);
- `assets/` — background/decorative files the style relied on.

With `--deploy <deck-dir>` the role-key art is also copied next to the deck as
`images/template-bg-N.<ext>`, `template-logo.<ext>`, `template-decor-N.<ext>`,
`template-photo-N.<ext>`, `template-icon-N.<ext>`, `template-brand-N.<ext>` and
`images/template-assets.md` is written with paste-ready snippets and a map.
Key mode deploys up to 20 assets (backgrounds 4, decor 6, photos 2, icons 4,
logo 1); the slide-1 background is ranked first and marked `(cover)`, so the
cover art is never ranked out. The manifest sections:

- **Background / Logo** — where each appears on template slides (px, 1-based
  slide numbers) and the corner class for the logo (`pos-tl` when the template
  keeps it left);
- **Branding lockup** — a near-white, wide brand mark. It is NOT decor: the
  template places it once (usually the cover) and it must never be stacked on
  the logo;
- **Decor / Photo / Icon** — every element with all its template placements
  (position, size, rotation). Coordinates are hints: the template itself moves,
  mirrors, scales and bleeds decor, and stacks two elements on one slide; the
  deck should vary them too. Square photos get `class="decor-img round"`;
- **Box styles** — the template's distinct box fills (`--c-surface`,
  `--c-surface-2` → `.card.deep`, plus `.tint/.ghost/.inverse`) with the slides
  they come from;
- **Layout recipes** — per template slide: background, art (mapped to the
  deployed names), box fills and the first text. Use it to mirror a KPI row, a
  flow, a photo-led slide instead of repeating one grid.

```html
<img class="bg-img" src="images/template-bg-1.png" alt="">          <!-- first child of the slide -->
<img class="logo pos-tl" src="images/template-logo.svg" alt="Logo"> <!-- template's corner -->
<img class="decor-img" style="left:766px; top:-224px; width:444px" src="images/template-decor-1.png" alt="">
```

`lint-deck` fails a profile-styled deck that uses none of the profile assets
(if the profile has any) — that is what makes a copy recognizable. A
template-assets.md saying the style is flat/token-only is the only excuse.

How to use the profile in a new deck: reference it in the managed style block
(`profile:<slug>`), use the deployed art as above, then `index.cjs` inlines the
images. Fonts: if the profile has a proprietary face, substitute the nearest
vendored one (Inter / Source Serif 4 / Unbounded / JetBrains Mono) and tell the
user about the
substitution.

## One-box rule (editable .pptx)

In the `.pptx`, text and the box fill are ONE shape if and only if the HTML
filled box contains **only text runs** (`.t-title/.t-body/.t-cap`, `<b>`,
`<br>`). Any non-text child (icon, `<ul>`, `<p>`, `display:flex`, absolute)
splits the box into "shape + separate text boxes". Put icons/badges next to the
box with `.card-stack`. Every row boundary must be a `<br>`: the exporter
merges all runs of a box into a single `<a:p>`, so without `<br>` PowerPoint
shows the title and the body on one line (probe check `missing-br`).

Acceptance tests: `single-box` and `flow-узлы` in `tests/local/run-local.cjs`.
`lint-deck` also fails raw `<h3>/<p>/<ul>` inside `.card/.step/.kpi/.pill/.stat`
(`raw <h3> inside .card`) — writing box text with block tags is the same defect
found earlier, when the model fell back to raw HTML for a template copy.

## validate.cjs — self-reflection report (the main verification tool)

```bash
... validate.cjs deck.html                 # render checks + checks of the .pptx next to it
... validate.cjs deck.html --pptx deck.pptx
... validate.cjs deck.pptx                 # artifact checks only
... validate.cjs deck.html --no-render     # no re-render (fast)
```

Two levels in one report:

1. **HTML** — runs `render.cjs` and merges its probe findings
   (clip/overflow/overlap/contrast/emptiness/alt). `render.cjs` parses
   `report.json` before removing the temp folder, so findings are never lost;
   the list of unloaded fonts (`fontsMissing`) is raised as a `FONT NOT LOADED`
   error.
2. **PPTX** — reads the exported file with the same parser and checks the
   artifact (ports of the python checks from
   `test_agent/example/checks/functional`):

| Check | Catches |
|---|---|
| `empty-slide` | the slide has no elements at all in the .pptx — it fell out of the export (check `display:none` / `.active`) |
| `decor-as-background` | a transparent/decor/logo picture is stretched as a full-slide background (real incident: the template's cat decor became the final slide's background) | backgrounds come from `[background]`-role media or a token; decor stays decor |
| `accent-heading` | a heading is painted in the accent color | headings stay ink; only section dividers use accent (probe error) |
| `accent-overload` | an accent-filled surface covers >40% of the slide (the acid "slab") | keep accent to badges, numbers, one short card; content blocks use surface (probe error) |
| `plain-cover` | the cover has no visual layer at all | add `cover-art`, decor, a logo or the template background |
| `image-reuse` | the same non-chrome picture appears on 2+ slides (one generated image on three slides was a real case) | one image = one meaning: vary the file or drop the repeats |
| `tiny-image` | a full-size picture is rendered as a small tile | enlarge it into an illustration or remove it |
| `mostly-empty` | the content covers <25% of the slide band (probe error; footer/chrome excluded, decor does not count as content) | add text/blocks/a chart or switch the pattern |
| `empty-placeholder` | a filled placeholder with no text or content |
| `split-box` | "backdrop + separate textbox" (text not written as runs in the box) |
| `contrast` | run contrast: error < 3.0 (WCAG AA large text), warning < 4.5 (WCAG AA body); inheritance-aware and blending translucent fills |
| `font-size` | size < 7.5pt — error, < 9pt — warning |
| `placeholder` | leftover placeholder text: `TODO`, `TBD`, `FIXME`, `lorem ipsum`, `{{…}}`, `[insert …]`, `XXX` |
| `typography-quotes` / `typography-dash` | straight quotes around Cyrillic; spaced hyphen instead of a dash |
| `escaped-newlines` | literal `\n` in text |
| `fullness` | empty/overloaded content slide (transition slides excluded; footer text does not count as content, table cell text does) |
| `density` | >46 objects on a slide |
| `hierarchy` | fewer than three text sizes; title not larger than the body |
| `font-variety` | more than four font families |
| `slide-size` | stage not 1280×720 (13.33×7.5in) |
| `native-text` | no native text in the .pptx (everything rasterized) |
| `embedded-fonts` | no embedded TTF in the .pptx while text exists |
| `autofit` | `normAutofit` already shrinks text (fontScale < 100%) |
| `slide-count`, `notes`, `image-coverage`, `repeated-words` | too few slides; notes; no pictures; word repetition |
| `pptx-missing` | `validate.cjs deck.html` found no .pptx next to the deck | run `index.cjs deck.html --pptx`; the export is blocked until the render is clean |
| `slide-count-mismatch` | the render saw more slides than the .pptx has — slides were dropped on export | find `display:none` / hidden slides, use `.active` |
| `visual-scarcity` | the deck has almost no graphics (<3 pictures/SVG across ≥6 slides) | add Lucide icons, charts or photos |
| `tight-line-spacing` | exact line spacing (the cause of overlap in PowerPoint; fixed by `pptx-post.cjs`) |

Output: `validate: N error(s), M warning(s)` + `validate.json`; exit 1 when
there are errors. The loop goal is `validate: clean` (info lines are fine).
When a `deck.html` is passed, the `.pptx` next to it must exist — it is the
delivery artifact, so a missing file is an error (`pptx-missing`).

## pptx-post.cjs — line-spacing treatment

```bash
... pptx-post.cjs deck.pptx    # exact spcPts → proportional spcPct
```

The export engine writes CSS `line-height` as **exact** spacing
(`<a:lnSpc><a:spcPts/>`). With fonts that have large metrics (Unbounded and
others) the renderer draws the first line above the box → text overlaps the
block above, although the HTML is perfect. `pptx-post` converts such spacing to
proportional (back to the CSS percentage), and the overlap disappears. The
font size is taken from the SAME paragraph as the spacing value. `render.cjs`
calls it automatically after `--pptx`.

## expand-styles.cjs — install the canonical CSS (managed block)

```bash
... expand-styles.cjs deck.html
```

The deck declares one managed block:

```html
<style data-presentation-style="sber"></style>
```

The helper replaces its content in place with `stage.css` + `fonts/fonts.css`
+ `tokens.css` + `styles/_base.css` (built-in id or `profile:<slug>`). Every
run refreshes it from the current skill files; deck-authored `<style>` blocks
are never touched; a deck without the marker is a no-op. This exists because
the old workflow asked the model to copy ~900 lines of CSS by hand — weak
models improvised their own layout (`display:none`, broken stage) and the
export silently dropped slides. `index.cjs` and `render.cjs` call it
automatically, so normally you never run it by hand.

## index.cjs — the whole pipeline in one command

```bash
... index.cjs deck.html [--pptx] [--pdf] [--no-png] [--out-dir <dir>]
```

1. `expand-styles.cjs` — install the canonical CSS into the managed block;
2. `assets.cjs` — inline fonts/images as data URIs;
3. `lint-deck.cjs` — static errors (location, external URLs including `//host`
   and `file:`, chat-tool calls, missing files, broken slides);
4. `render.cjs` — the real render: a PNG per slide, `report.json`,
   `inventory.json`, issue lines on stdout;
5. with `--pptx` / `--pdf` — native pptx and/or pdf; the finished files are
   copied **next to deck.html** (`artifact: <path>`), `--out-dir` redirects
   them elsewhere.

Exit: 0 — clean; 1 — lint/assets/styles errors; 2 — render did not start;
3 — render crashed; **4 — blocking layout issues: the export was skipped and
no .pptx was produced**. Non-blocking issues are lines to fix, not failures.

Blocking `error` types: `text-clip`, `out-of-bounds` (content, not decor),
`text-overlap`, `low-contrast`, `blank`/`maybe-blank`, `mostly-empty`,
`broken-image`, `stage-broken`, `probe-error`, `hidden-slide`, `missing-br`.
Everything else (`empty-region`, `tight-gap`, `no-accent`, `sparse-box`,
`accent-*`, `plain-cover`, `img-no-alt`) is a `suggestion` — it never blocks
the export.

## render.cjs — a standalone render run

```bash
... render.cjs deck.html [--out-dir <dir>] [--pptx] [--pdf] [--no-png]
```

`renderDeck` first builds a temp copy of the deck (expand-styles + asset
inlining) and renders that copy — the authored `deck.html` is never mutated.

Use when you only need the report or only the export. Without `--out-dir` (and
without `--pptx/--pdf`) the temp folder is removed after the run, but
`report.json` and `inventory.json` are parsed before removal and returned to
the caller, so probe findings are never lost (`validate.cjs` relies on it). The
helper timeout is 300s (`PRESENTATION_RENDER_TIMEOUT_MS`), plus the app
watchdog.

A renderer crash before any report (`Object has been destroyed`, `Render
process gone`, `Target closed` — exit 3 without `report.json`) is transient:
the helper captures the child's stderr and retries once automatically. If the
retry crashes too, the deck or the app session is broken — read the printed
stderr tail, do not guess about disk space or ask the user to restart the app.

## report.json — layout issues

Format: `{ "slides": [{ "index": 0, "issues": [{ "type": "...", "detail": "...", "severity": "error|warning" }] }] }`.
`error` = contract violation (blocks the export, exit 4); `warning` = a
suggestion for the model to judge visually. SOTA-style split: tools gate
structure, the eyes decide taste.

| Type | Meaning | How to fix |
|---|---|---|
| `text-clip` | text does not fit its box (overflow in a clipping container) | remove the fixed height/`overflow:hidden`, cut the text, switch the pattern |
| `out-of-bounds` | an element extends past the slide edges | shrink/move it; do not rely on edge clipping |
| `low-contrast` | text contrast < 3.0 (WCAG AA large text; includes the worst gradient stop) | change the color/background token; do not cover text with decor |
| `text-overlap` | text overlaps text/picture | remove absolute positioning; separate blocks with the grid |
| `empty-region` | empty top/bottom or an almost empty slide | add a meaningful block/text or switch the pattern |
| `blank` / `maybe-blank` | no text and no media on the slide | delete the duplicate or fill it with content |
| `broken-image` | the image failed to render | check the path, run `assets.cjs` |
| `img-no-alt` | an `<img>` has no `alt` attribute | add alt text (empty `alt=""` for decoration) |
| `hidden-slide` | the slide is `display:none` or zero-sized — the export engine skips it (a real deck lost 8 of 10 slides this way) | hide slides with `.active` only; never `display:none` |
| `the deck uses none of the template assets` (lint) | the deck copies a style profile that has assets, but no `<img>` uses them | run `style-profile.cjs <pptx> --deploy <deck-dir>` and paste the `images/template-assets.md` snippets (`bg-img`/`logo`/`decor-img`) |
| `uses an image background but the deck has none` (lint) | a copy left the background flat | add `<img class="bg-img" …>` on the slides that have it in the template |
| `accent-cards` | 2+ solid accent cards on one slide | keep one; use `.card.tint` for the other highlights |
| `uses an image background … backgrounds on most slides` (lint) | background copied only to cover/closing while the template paints most slides | add `.bg-img` to every slide that has one in the template (map in `images/template-assets.md`) |
| `has decor assets but the deck uses none` (lint) | the background was copied but the template decor ignored — the copy loses its recognisable elements | place **any** deployed decor somewhere sensible (`decor-img`); the map in `images/template-assets.md` is a hint — move/resize/swap decor freely |
| `missing-br` | two text rows in one box are not separated by `<br>` | add `<br>` between the rows — the export is blocked, PowerPoint would show one line |
| `no-accent` | a content slide has no emphasis accent | highlight the key card/step/number/table row (see patterns.md, "Accent budget") |
| `sparse-box` | a box taller than 180px is filled with text by less than 38% | shorten the box or add substance (see patterns.md, "Box fill") |
| `stage-broken` | the stage is not 1280×720 | paste `stage.css` as is; do not resize it |
| `FONT NOT LOADED` (stdout) | the family is missing from the deck's `@font-face` set (or failed to load) | use vendored faces; `validate` raises it as an error |

Rule: fix `stage-broken`/`out-of-bounds`/`text-clip` first, then
`text-overlap`/`low-contrast`, then `empty-region`/`sparse-box`/`no-accent`.
After the fixes — rerun; the goal is `render: clean`.

## inventory.json — eyes for pinpoint edits

Format: `{ "slides": [{ "index", "role", "bg", "coverage", "decor", "layers",
"blocks", "notes", "elements": [{ "tag", "cls", "src", "fill", "role", "text",
"x", "y", "w", "h", "font", "size", "weight", "lh", "color", "lines", "ov" }] }] }`.

`coverage` — the share of height occupied by content (0..1); `decor` — the
number of decorative fills; `ov` — overflow (`"+12v"`); `layers` — full-slide
background/paint layers (`kind`, `cls`, `src`, `fill`); `blocks` — semantic
containers (card/grid/stat/step/decor/chart/…) with class, fill, `src` and
geometry; `elements` — text/media leaves with class, image `src` and computed
`fill` (e.g. `#FFFFFF@0.15`). Coordinates are in stage px. Make edits by
element: find the needed `y` in inventory, change the markup, rerun the render.
To read this without parsing JSON, run `inspect.cjs` (below).

## inspect.cjs — read the deck structure in text

```bash
... inspect.cjs deck.html [--slide N] [--detail] [--out-dir <dir>] [--png] [--json <path>]
```

`review.cjs` already prints this read; `inspect.cjs` is the standalone version
(same render, no PNGs by default). For every slide it prints the real
background layer, decor with position, headline/lead, pattern blocks, card
fills, content band and probe issues; then a factual template-assets map (which
deployed `images/template-*` file is used on which slide, which is not used,
which content pictures exist). `--slide N --detail` adds per-block geometry
(`@x,y W×H`, fill, src, text) — the DevTools view of one slide. If the renderer
is unavailable it falls back to a static HTML outline instead of failing.

## slide.cjs — per-slide edits without oldString

```bash
... slide.cjs deck.html --list                    # index / role / headline / size
... slide.cjs deck.html --get 3                   # exact <section>…</section> of slide 3
... slide.cjs deck.html --set 3 --from /tmp/slide-3.html
... slide.cjs deck.html --append --from /tmp/slide-11.html
```

`deck.html` repeats the slide opening, logo and decor markup on every slide, so
the generic edit tool's `oldString` is ambiguous by design (real runs burned
turns on "Found multiple matches" while adding a background or a footer).
`slide.cjs` replaces the Nth `<section>` exactly and leaves the rest of the
file byte-identical; the fragment must be exactly one `<section>…</section>`
(exit 3 otherwise). One slide per call; for a slide-wide change loop or rewrite
the whole file in one write call.

## lint-deck.cjs / assets.cjs

```bash
... lint-deck.cjs deck.html            # static check (exit 1 = errors)
... assets.cjs deck.html               # check: local refs resolve (default)
... assets.cjs deck.html --inline      # bake data URIs into deck.html (standalone HTML only)
```

Default is check-only. The authored deck keeps relative `images/…` and the
managed style block; the render/export pipeline expands styles and inlines
assets into a temp build copy, so the source the model edits never grows data
URIs. Use `--inline` only when a single-file HTML is explicitly needed.

`lint-deck` catches: `http(s)://`, protocol-relative `//host/...` and `file:`
(the deck is offline), `gigachat_image(` and other chat-tool calls (they must
not live in the deck), missing files, classes without a definition in `<style>`
(silent layout breakage), slides without `data-role`, raw `<h2>/<p>/<ul>` slides
(pattern discipline) and raw block tags inside a pattern box (one-box rule).

## styles? charts?

There are no separate helpers: styles are `tokens.css` + `_base.css` copied in;
charts are snippets from `charts.md`. No libraries in the deck.

## Fonts and icons

- vendored faces: `fonts/manifest.json` (Inter 400/600/800, Source Serif 4 600,
  Unbounded 700, JetBrains Mono 400) — woff2 for rendering, ttf for embedding;
- icons: **copy ready `<svg class="icon">…</svg>` lines from
  `styles/_base/icons.md`** (one line per name, 105 icons). There is no bare
  `node` binary in the app environment — do not try `node helpers/icons.cjs`;
  if you must regenerate the catalog:
  `ELECTRON_RUN_AS_NODE=1 "$GIGATOOL_NODE" …/helpers/icons.cjs --get <name>`;
- a font missing from `fonts/` → use the nearest vendored face and say so;
  `FONT NOT LOADED` in the report is an error, not a detail.

## shots.cjs — see a .pptx with your own eyes (vision)

```bash
... shots.cjs deck.pptx --out-dir /tmp/tpl-shots --keep
```

Renders every slide of ANY .pptx to `slide-NN.png` via the app's production
preview renderer (`--pptx-verify`) and prints the paths plus a one-line text
digest per slide (title + background source). Use it to:

- **look at an attached template before copying its style** — classify slides
  and elements with your eyes; parser roles are hints, your verdict is the
  truth;
- look at the deck you are reworking;
- visually compare your render with the reference before delivery.

If the renderer is unavailable, the helper prints a fallback
(`read-pptx.cjs --extract-media` + looking at the extracted pictures) and
exits 2.

## review.cjs — the self-reflection driver (render → look → fix)

```bash
... review.cjs deck.html --out-dir /tmp/deck-check [--reference <template.pptx>] [--no-validate]
```

One command for the whole loop: renders the deck, prints the paths of every
`slide-NN.png` to LOOK at, lists probe issues, prints the structural read of
every slide (background layer, decor, blocks, fills, issues — the same text
`inspect.cjs` prints), runs `validate.cjs` on the existing `.pptx` (skipped with
`--no-validate`), optionally renders reference shots of a template, and prints
the review checklist (style consistency, layout variety, visual anchors, decor,
template similarity, AI-slop signals).

The loop is: `review` → READ the PNGs (vision) → fix `deck.html` → `review`
again, until `render: clean` AND the eyes agree; then `index.cjs --pptx` and
`validate.cjs`. The export is blocked (exit 4) while blocking issues remain,
so an unreviewed dirty deck cannot slip through.

## Diagnostics

| Symptom | Cause | What to do |
|---|---|---|
| `GIGATOOL_NODE is not set` | running outside the app | tell the user; do not fake a render |
| `render: failed to start` | the app is not built / wrong path | check `$GIGATOOL_NODE`, ask the user |
| `render: timed out` | the deck hangs (endless JS) | remove scripts from the deck except the navigator |
| `render: N blocking issue(s) — export skipped` (exit 4) | blocking layout defects: the .pptx was not produced | fix the listed issues, re-run; export only after a clean render |
| `the deck is inside a temp directory` (lint) | the deck was built in `/tmp` — the user will not see it | build `deck.html` in the working folder |
| `deck: FONT NOT LOADED` | the family is not vendored/declared | replace with a vendored face; `validate` raises `FONT NOT LOADED` |
| `error FONT NOT LOADED` (validate) | font not vendored/declared | swap the token or add the face to `fonts/` |
| `class(es) used but not defined` | a forgotten pattern/typo | check `patterns.md`, rerun lint |
| `error FONT-SIZE` / `CONTRAST` / `PLACEHOLDER` | unreadable size, weak contrast, placeholder text | fix `deck.html` per the detail in the line |
| `warn TYPOGRAPHY-QUOTES/DASH` | straight quotes / hyphen instead of a dash | use «ёлочки», `—`/`–` |
| `warn MISSING-BR` | rows in a box are not separated by `<br>` | add `<br>` between rows |
| `warn NO-ACCENT` | a content slide has nothing accented | highlight the key block (patterns.md, "Accent budget") |
| `warn SPARSE-BOX` | a tall box is nearly empty | shorten the box or add substance |
| `probe: N issue(s)` | see the type table | fix one by one, rerender |
| `Found multiple matches for oldString` / `Could not find oldString` (edit tool) | the slide opening, logo and decor markup repeat on every slide — the edit tool's `oldString` is ambiguous by design | switch to `slide.cjs`: `--get N` → edit the fragment → `--set N --from file` (or `--append`); a full rewrite in one write call also works. Never retry with more context and never re-run the pipeline on a failed edit |

## Skill files

```
presentation/            ← this folder (installed as ~/.wsc/config/skills/presentation)
├── SKILL.md             ← agent instructions (the main file)
├── patterns.md          ← slide patterns (render-verified)
├── charts.md            ← charts/diagrams without libraries
├── reference.md         ← this file
├── stage.css            ← the fixed 1280×720 stage
├── styles/
│   ├── _base.css        ← components (cards, KPI, tables, …)
│   ├── _base/icons/     ← Lucide (ISC), catalog in _base/icons.md
│   ├── index.json       ← built-in style catalog
│   └── {grid-paper,ink-press,signal-night}/tokens.css + profile.json
├── fonts/               ← vendored woff2+ttf (OFL 1.1) + manifest.json
├── helpers/
│   ├── index.cjs        ← styles + lint + assets + render (+ pptx/pdf)
│   ├── expand-styles.cjs ← installs the canonical CSS into the managed block
│   ├── lint-deck.cjs    ├── assets.cjs   ├── render.cjs
│   ├── validate.cjs     ├── pptx-post.cjs ├── refs.cjs
│   ├── read-pptx.cjs    ├── style-profile.cjs ├── icons.cjs
│   ├── shots.cjs        ← .pptx → per-slide PNGs for vision
│   ├── review.cjs       ← render → look → fix loop driver (vision)
│   ├── inspect.cjs      ← per-slide structural read (layers/blocks/fills/template map)
│   ├── slide.cjs        ← per-slide get/set/append without oldString
│   ├── probe.js         ← injected into the render window
│   └── lib/xml.cjs, lib/pptx.cjs, lib/describe.cjs
├── vendor/              ← jszip 3.10.1, dom-to-pptx 2.1.2 (MIT), licenses
├── examples/example-deck.html  ← reference deck (self-contained)
├── app/deck-render.ts   ← one-shot for desktop-ai-app (integration)
└── tests/               ← acceptance: unit/ (node) + local/ (Chrome) + acceptance.md
```
