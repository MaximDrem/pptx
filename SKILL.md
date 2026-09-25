---
name: presentation
description: Use this skill whenever the user asks for a presentation, deck, slides, a .pptx file, or «сделай презентацию», «сверстай слайды», «презентация по…», «сделай в этом стиле» (приложена презентация-образец), «переделай презентацию», «поправь слайды». Builds a deck as editable HTML (deck.html) on a fixed 1280×720 stage and exports it to a REAL .pptx native text, shapes, embedded fonts, speaker notes. Reads an attached .pptx completely (layers, groups, pictures/SVG, tables, charts, styles), shows its slides as images for visual copying, and can copy its style. No npm/internet — everything ships inside the skill.
previewDescription: Презентации (HTML → native PPTX + vision)
---

You build presentations as an **HTML deck** (`deck.html`) on a fixed 1280×720
stage and export it to a **native .pptx** (real text, shapes, embedded fonts,
notes). `deck.html` is the single source of truth: "fix slide 3" means edit the
HTML and rebuild the .pptx.

## Non-negotiable rules

Each of these has already broken a real deck. They are not style advice.

1. **Only `helpers/index.cjs` builds the .pptx.**
   There is no python, no node, no npm and no network in this environment;
   `$GIGATOOL_NODE` is the only runtime and the helpers are the only builder.
   Never write a python-pptx script, never shell out to LibreOffice, never use
   an online converter or an npm package. Another builder = a failed task:
   only this pipeline produces native text, embedded fonts and notes. If the
   command does not work, say so and stop — do not improvise an alternative.
2. **Work in the user's working folder.**
   `deck.html` is created in the current working directory (the chat workspace)
   and the `.pptx` lands next to it. Never build the deck in `/tmp` and never
   create your own folders for it (e.g. `/tmp/folder`) — the user will not see
   the result, and `lint-deck` fails a deck that lives in temp. Temp is only
   for drafts, shots and extracted media.
3. **Never `display:none` a slide.**
   Slides are hidden with `.active` (visibility/opacity) only. The export
   engine silently drops `display:none` subtrees: a real deck lost 8 of its 10
   slides that way. The probe reports `hidden-slide` and the export is blocked.
4. **Never write the base CSS yourself.**
   The skeleton has one managed block —
   `<style data-presentation-style="sber"></style>` — and the builder
   installs `stage.css` + `fonts/fonts.css` + `tokens.css` + `styles/_base.css`
   into it on every run. Your own CSS goes into a separate `<style>` after it,
   only for what the patterns do not cover. Hand-copied CSS drifts from the
   contract (this is how slides disappeared).
5. **Read before writing.**
   Open `patterns.md` and `examples/example-deck.html` first: slides and blocks
   come from there. Do not invent a layout while a verified pattern exists.
6. **The render/validate loops are gates, not advice.**
   `index.cjs deck.html --pptx` refuses to export while there are **blocking
   errors** (exit 4, no `.pptx` is produced). Blocking = broken layout: clipped
   text, out-of-bounds content, overlaps, invisible contrast, blank or hidden
   slides, broken images, rows without `<br>`. Everything else the probe prints
   is a **suggestion** (accents, spacing, emptiness, decor) — review them with
   your eyes, fix what genuinely improves the deck, mention the rest. Every
   content slide must have `elements > 0` and `coverage > 0` in
   `inventory.json`. There is no "deliver anyway" for blocking errors.
7. **Look before you copy, look before you deliver (vision).**
   When a template .pptx is attached, render its slides with
   `helpers/shots.cjs` and READ the images before extracting a style. The
   render→look→fix→repeat loop is driven by `helpers/review.cjs`; READ its
   printed PNGs at every iteration and once more after the export. If you
   cannot view images, say so and rely on `validate.cjs` + the text digest.
8. **Do not change `stage.css`** — the 1280×720 stage is the export contract.
   No emoji, no external URLs/CDNs, no font shrinking to hide overflow
   (cut the text or switch the pattern), never delete `deck.html`.

## Result contract

- The working folder keeps **exactly two files**: `<kebab-slug>.deck.html` and
  `<kebab-slug>.pptx`. Source images live in a subfolder (e.g. `images/`) if
  the user brought them; after the build they are embedded into the HTML.
- No `deck.js`/`deck.ts`/`.py`/build scripts in the result: HTML is the source.
- Reply to the user with absolute paths to the .pptx and .html plus a one-line
  summary.
- Drafts, render folders, shots and extracted media go to temp only, never
  into the project; the deck itself never lives in temp.

## Command (the only allowed runtime)

```bash
ELECTRON_RUN_AS_NODE=1 "$GIGATOOL_NODE" "$HOME/.wsc/config/skills/presentation/helpers/index.cjs" deck.html --pptx
```

All helpers run the same way (`ELECTRON_RUN_AS_NODE=1 "$GIGATOOL_NODE" …
helpers/<name>.cjs …`). There is no bare `node` and no `python` — do not even
try them. If `$GIGATOOL_NODE` is not set, say the deck cannot be built outside
the app and stop.

Full helper list, report formats and diagnostics: `reference.md`.

## Workflow

### 0. Pick the mode

| Request | Mode |
|---|---|
| "make a presentation about X" | new deck (steps 1A, 2–7) |
| "make it in the style of this deck" (a .pptx attached) | **vision style copy** (step 1B), then 2–7 |
| "rework/improve this presentation" (a .pptx attached) | read it (step 1C), then 2–7 |
| "in the style of <saved>" | profile from `~/.wsc/config/styles/` |

Before working, ask the user only what really changes the deck: topic/goal,
audience, approximate length, must-have facts/numbers. Ask at most once, in the
user's language; if the request already contains enough (an attached content
file, "make a presentation about X"), start without asking. **Format is never a
question**: a presentation request always ends with a `.pptx` — never ask
whether to make the pptx, which format, or whether to export. Do not start
laying out before you understand the goal and the length.

### 1A. Pick a built-in style

**Default: `sber`** — the brand style (white canvas, Sber gradient
#0098F8 → #21A038 → #F1E813 in accents and chart fills, Inter in place of the
proprietary SB Sans). Use it unless the content clearly asks for something
else. Alternatives in `styles/index.json`: `signal-night` (dark brand variant
for pitch/strategy), `grid-paper` (neutral IKB when the deck is not
Sber-related), `ink-press` (warm editorial for stories/reports). Pick by
content type without asking; if the user named a style, use it. Never mix two
palettes in one deck.

```html
<style data-presentation-style="sber"></style>
```

### 1B. Copy the style of an attached deck (with your eyes)

Text parsing alone is NOT enough — it produced decks with flat blue slides and
a decorative cat stretched as a background. The workflow:

```bash
# 1) See the template first: per-slide PNGs + a text digest
... shots.cjs "<attached.pptx>" --out-dir /tmp/tpl-shots --keep

# 2) Extract tokens + assets AND deploy the key art next to the deck
... style-profile.cjs "<attached.pptx>" --name "Style name" --deploy .
```

Then, **in this order**:

1. READ every `/tmp/tpl-shots/slide-NN.png` (vision). For each slide note:
   role (cover/section/content/closing), background (flat color? photo?
   gradient?), where the logo sits, what is decor vs content. This is the
   ground truth — the parser's roles are hints, your eyes are the verdict.
2. From the shots pick the **background assets**: full-slide, dark or calm
   images only. A transparent PNG or a small/edge element is DECOR — it never
   becomes a slide background (the validator errors `decor-as-background`;
   real incident: the template's cat decor became the final slide's
   background).
3. Note the palette by looking: dominant color, accent, whether the deck is
   dark or light. Compare with the extracted `tokens.css`; if they disagree,
   trust what you SEE and fix the tokens (bg/ink/accent) by hand.
4. **Use the deployed template art** — this is what makes the copy recognizable
   (skipping it is how a "copy" ends up with zero elements of the original):
   `--deploy` copied the background/logo/decor into `images/` and wrote
   `images/template-assets.md` with snippets and **placement hints** from the
   template's own slides:
   - `<img class="bg-img" src="images/template-bg…" alt="">` as the FIRST child
     of **every slide that has a background in the template** — for corporate
     templates that is usually most content slides too, not only cover and
     closing (a copy with the background on two slides reads as a different
     deck; `lint-deck` errors when the template is image-heavy and backgrounds
     are missing). The deploy map lists which template slides use which
     background — match by slide type. A token bg is only for flat templates;
   - the profile already reproduces the template's content boxes: `--c-surface`
     holds the template's own card fill (usually a translucent white/black,
     e.g. `rgba(255,255,255,0.15)`), so plain `.card` looks native. The
     manifest's **Box styles** section lists the runner-up fill too: alternate
     `.card` / `.card.deep` / `.card.tint` / `.card.ghost` / `.card.inverse`
     the way the template does — the same box on every slide is the
     monotonous-copy failure (probe suggests `accent-cards` when overdone; a
     solid `.card.accent` is for at most ONE short key message per slide);
   - `<img class="logo" …>` in the corner the manifest prints — corporate
     templates usually keep it TOP-LEFT, so paste `class="logo pos-tl"` and
     add `with-logo` to the slide class (it reserves the top band). A
     **Branding lockup** is a separate section: near-white brand art that goes
     where the template puts it (usually once, on the cover) — it is NOT
     decor: never repeat it and never place it over the logo;
   - `<img class="decor-img" …>` for decor, photos and icons. The map's
     coordinates are HINTS: the template never repeats decor at identical
     coordinates — it stacks elements (a blob under an arrow), mirrors, scales
     or bleeds them off an edge. Do the same: move/resize/pick another element
     per slide, keep at least one template decor, and never let art cover text
     (bleed it off an edge with negative offsets or swap it). Square photos in
     the **Photo** section crop as circles (`class="decor-img round"`);
   - the **Layout recipes** section lists what the template composes per slide
     (background + art + boxes + title). Match the recipe to the section you
     are building — a KPI row, a flow, a photo-led slide — instead of putting
     every section on the same grid.
   If `template-assets.md` says the template has no reusable art (a flat
   token-only style), say so and move on.
5. Build the deck with `data-presentation-style="profile:<slug>"`. Keep the
   template's dark/light decision on EVERY slide — do not switch some slides
   to a flat fill "for variety" (that is how the blue slides happened).
6. Verify against the reference: put a template shot next to your render of
   the same kind of slide. If they feel like different decks, fix tokens,
   backgrounds or the deployed art before delivering.

### 1C. Rework someone else's .pptx

```bash
... shots.cjs deck.pptx --out-dir /tmp/tpl-shots --keep   # see it
... read-pptx.cjs deck.pptx --outline                     # texts
... read-pptx.cjs deck.pptx --slide 7                     # one slide in full
... read-pptx.cjs deck.pptx --extract-media /tmp/deck-media
```

Read EVERY slide you need one by one (`--slide N`) plus its shot: z-order,
groups, px coordinates (1:1 with HTML), SVG vectors, tables, charts, notes,
per-text font/size/color with the inheritance source. Never invent the content
of an attached file: if the report does not show it, say you did not find it.

### 2. Plan the structure

Typical arc: cover → context (1–2) → core (3–5) → plan/comparison → closing
with decisions. 15 minutes ≈ 10 slides. Every slide carries one idea; two ideas
is two slides. Never duplicate texts between slides.

### 3. Write deck.html

Use the minimal skeleton (managed style line + your slides). Open
`examples/example-deck.html` as a markup reference — but do NOT copy it
wholesale: its working copy carries expanded CSS that you must not paste.

**Write the whole deck in ONE write call** (all 8–14 slides at once). Do not
assemble it slide-by-slide with edit calls — that is exactly how agents get
stuck on "Found multiple matches for oldString" and burn the turn. The deck
source is small (tens of KB): rewriting it completely is always cheaper than
surgical inserts.

If the edit tool reports an ambiguous anchor (`Found multiple matches` /
`Could not find oldString`) — **do not ask the user about tool mechanics** and
do not retry with a bigger context. The markup repeats on every slide, so the
edit tool is the wrong instrument here; recover with `slide.cjs`:

1. `slide.cjs deck.html --get N` — prints slide N's exact `<section>…</section>`;
2. edit that fragment with the write tool (it is one slide);
3. `slide.cjs deck.html --set N --from /tmp/slide-N.html` — puts it back,
   the rest of the file stays byte-identical;
4. or rewrite the whole file in one write call.

Never leave a half-built deck behind: "continue later" means the next call
rewrites the complete file.

**Editing later** (a second pass, or "fix slide N") — use `slide.cjs`, not the
edit tool:

```bash
... slide.cjs deck.html --list                     # index / role / headline per slide
... slide.cjs deck.html --get 3                    # print slide 3's <section>
#   write the corrected fragment → /tmp/slide-3.html, then:
... slide.cjs deck.html --set 3 --from /tmp/slide-3.html
... slide.cjs deck.html --append --from /tmp/slide-11.html
```

Why: the slide opening, logo and decor markup are IDENTICAL on every slide, so
the edit tool's `oldString` is ambiguous by design — real runs burned turns on
"Found multiple matches" while adding a background or a footer. `slide.cjs`
replaces the Nth `<section>` exactly (no matching at all). Rules:

- one slide per `--set` call; for a slide-wide change (all backgrounds, all
  footers) either loop over slides or rewrite the whole file in one write;
- a failed edit means the change is NOT in the file — never re-run the pipeline
  as if it landed;
- **never invent asset names**: run `slide.cjs --list`/list `images/` or read
  `images/template-assets.md` before referencing `template-*` — a guessed
  `template-bg.png` instead of `template-bg-1.png` fails lint/assets and
  wastes a render cycle;
- if you get stuck on mechanics, rewrite the complete `deck.html` in ONE write
  call — that always works. Never hand the user steps to edit the file.

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Title</title>
<style data-presentation-style="sber"></style>
<style>/* optional: only what the patterns do not cover */</style>
</head>
<body>
<div class="deck-viewport"><div class="deck-stage" id="deck-stage">
  <section class="slide cover" data-role="cover">
    <div class="cover-art" aria-hidden="true"></div>
    …slide-pad…
  </section>
  …
</div></div>
<div class="deck-controls">…</div>
<script>/* navigator: copy from examples/example-deck.html */</script>
</body>
</html>
```

Markup rules:

- slides and blocks come from `patterns.md`; do not invent a new grid until you
  have tried the existing ones. **Raw `<h2>/<p>/<ul>` pages are not slides**:
  a content slide must have `.headline` (in `.slide-head`), a `<div
  class="content">` wrapper and at least one pattern block
  (`.card`, `.kpi-row`, `.grid2/3/4`, `.split`, `.flow`, `.timeline`, `.table`,
  `.steps`, `.donut`, `.matrix`, `.list`). `lint-deck` fails raw-HTML slides —
  they are what produce "no accents / empty regions / mostly empty" decks;
- **one-box rule**: text inside a colored box is written as runs directly in
  the box (`.t-title/.t-body/.t-cap`, `<b>`, `<br>`) with nothing else in the
  box; icons/badges go next to it via `.card-stack`. Raw `<h3>/<p>/<ul>`
  inside `.card/.step/.kpi/.pill/.stat` is a lint error — it splits the box
  into extra shapes and loses its style. **Separate every row
  boundary with `<br>`** — without it the exporter merges the runs into one
  paragraph (probe blocks `missing-br`);
- **accent budget**: every content slide carries at least one emphasis accent
  (accent card/node/cell/step, accent number, chart bar, highlighted table
  row). More than one is fine when the layout expresses real hierarchy; do not
  accent everything equally. Kicker/footer/soft badges do not count (probe
  warns `no-accent`);
- **accent discipline**: accent is produced with SMALL elements — badges,
  icons, numbers, one short card (≤2 lines), a highlighted row. Headings stay
  ink (only section dividers are accent); never paint a content block with an
  OPAQUE accent — a surface over 40% of the slide is a slab (error
  `accent-overload`). When the template highlights blocks, copy its recipe: a
  translucent tint (`.card.tint` / `--c-accent-soft`), not a solid fill;
  suggestions `accent-heading`;
- **visual anchor**: every content slide has something to look at — a Lucide
  icon, a chart, a photo or a big number. A deck of text-only cards reads as
  empty even when the text is there (probe: `sparse-box`, validate:
  `visual-scarcity`);
- **vary the layout**: alternate patterns across slides (grid → split →
  kpi-row → timeline → picture). Three or more content slides with the same box
  grid read as "generated, not designed" — check this by eye in step 6;
- **pictures**: 1–3 images generated with the chat image tool (e.g.
  `gigachat_image`/`text2image`) on the cover or a key content slide are often
  what a text-heavy deck is missing; place them per `patterns.md` (`.media`,
  `.split`) and never reuse one file twice;
- **box fill**: do not leave tall boxes half-empty (probe warns `sparse-box`);
- colors/fonts/radii only via tokens `var(--…)`; hex in markup is forbidden;
- charts — from `charts.md` (SVG/CSS, no libraries), numbers must be honest;
- covers/sections/closings get `<div class="cover-art">` (the style's glow)
  plus at least one `<div class="decor …">` element (`decor-dots`/`decor-ring`/
  `decor-blob`, positions `pos-tr/pos-bl/pos-tl`; they may bleed off-slide and
  are skipped by the probe) — this is the cheap trick that makes covers look
  designed, not typed;
- speaker notes — `<template data-pptx-notes>…</template>` inside EVERY slide;
- **icons**: copy ready `<svg class="icon">…</svg>` lines from
  `styles/_base/icons.md` (one line per name). There is no `node` binary and
  no emoji — never draw your own paths;
- images — local files referenced relatively (`<img src="images/...">` with
  `alt`), generated ONLY with an image tool from your tool list (e.g.
  `text2image`/`gigachat_image`) before assembling; template media — copied
  next to the deck and verified by looking
  at them. **Never paste `data:` URIs into the deck**: the builder inlines
  styles and assets into a temp build copy, so the authored file stays small
  and editable (`index.cjs --inline` bakes them in only when a standalone
  single-file HTML is explicitly asked for). **One image = one meaning**: never place the same file on two slides (probe flags
  `image-reuse`), and a photo must fill a real block — a full-size picture
  squeezed into a small tile reads as an accident (probe flags `tiny-image`);
- no external links/fonts/scripts (except our navigator); contacts are PLAIN
  TEXT — no `http(s)://` URLs, no links: the deck is offline. An email
  address written as text is fine. `lint-deck` names the slide for every
  URL it finds;
- write 8–14 slides in one pass; more — in two passes.

### 4. Render loop (mandatory gate)

```bash
... review.cjs deck.html --out-dir /tmp/deck-check
```

`review.cjs` renders the deck, prints every `slide-NN.png` to look at, lists
the probe findings, runs the artifact validator if a .pptx already exists, and
prints the review checklist. Findings are printed as `error:` (blocking — must
be fixed) or `suggestion:` (taste — judge visually). It also prints a
**structural read** of every slide (background layer, decor with coordinates,
blocks, fills, probe issues). Use it when a suggestion needs exact numbers;
`inspect.cjs deck.html --slide N --detail` prints the same for one slide with
block geometry. The loop is:

1. **review** — run the command;
2. **look** — READ every printed PNG (vision). For a 10-slide deck that is 10
   images; do not skip dense slides or the cover/closing;
3. **fix** — fix every `error:` line first, then the suggestions that make the
   deck visibly better;
4. **repeat** until there are no `error:` lines AND your eyes agree.

Common error → fix (never invent a workaround, never hand files to the user
to edit):

- `BROKEN-IMAGE`: the file is missing or misnamed — copy it next to the deck
  (`images/…`); `./images/x` and `images/x` are the same thing, do not "fix"
  paths; fix ALL slides with that file at once;
- `LOW-CONTRAST`: body text uses `.t-body`/`.lead` (ink/muted) — an accent
  color is never body text;
- `TEXT-CLIP` / `TEXT-OVERLAP`: replace fixed heights / absolute positioning
  with a pattern;
- `MISSING-BR`: add `<br>` between the rows inside the box;
- `MOSTLY-EMPTY`: add a block or switch the pattern (decor does not count as
  content);
- `render: the app window was destroyed` — Electron crashed; the helper
  retries once automatically. If it repeats, tell the user the app session is
  broken instead of guessing about disk space.

If the same fix touches several slides (identical anchors), rewrite the whole
file — do not try N identical edits.

Taste suggestions you intentionally leave (a deliberate wide spacing, an
unaccented quote slide) do not need fixing — but say in your reply which
suggestions you left and why. Do not build the .pptx while errors remain: the
tool refuses anyway (exit 4).

If you cannot view images in this environment, say so explicitly and use
`inspect.cjs deck.html` — it prints what is on every slide (layers, decor,
blocks, fills, empty band) so you can still reason structurally.

### 5. Export and validate

```bash
... index.cjs deck.html --pptx     # build + line-spacing post-processing
... validate.cjs deck.html         # HTML checks + .pptx artifact
```

The .pptx lands next to deck.html (`artifact: <path>`). The export is refused
(exit 4) while blocking issues exist. `validate.cjs` checks the artifact
itself (empty placeholders/slides, split boxes, WCAG contrast, font sizes,
typography, placeholders, stage size, embedded fonts, notes,
`decor-as-background`, `visual-scarcity` …). Loop until `validate: clean`;
warnings must at least be mentioned to the user.

### 6. Visual self-review, then deliver (vision, required)

The last gate — look at the EXPORTED deck, not the HTML:

```bash
... review.cjs deck.html --out-dir /tmp/deck-final [--reference "<template.pptx>"]
```

READ the printed PNGs and answer honestly — first per slide, then the deck as a
whole. In template mode also read the reference shots of the same slide kind.
Look at them fresh: after staring at the markup you tend to see what you meant,
not what rendered (if you have a subagent, hand it the PNG paths for a second
opinion). This is YOUR judgment; the tools only measure (nothing below is a
lint gate):

Per slide:

- is anything cut off, overlapping or touching the edges? aligned with its
  neighbours? gaps even (not one huge empty band in one slide and cramped text
  in another)? contrast readable (icons too, not only text)?
- is there a visual anchor (photo, icon, chart, big number) or is it a wall of
  text boxes?

Across the deck:

- **layout variety**: put your content slides side by side — if three or more
  are the same grid of boxes, change some to another pattern from `patterns.md`
  (split, flow, kpi-row, timeline, table, quote) or make one of them a picture
  slide. A deck of identical squares is the #1 "generated, not designed" tell;
- **box variety**: in template mode the manifest's Box styles list several
  fills — if every card is the same surface, switch some to
  `.card.deep/.tint/.ghost`; the original template mixes them;
- **template art**: in template mode, name the deployed element you used on the
  cover and on a content slide (the structural read's TEMPLATE ASSETS block
  shows what is where). If `template-decor-*` exists and appears nowhere, place
  it on the cover/section/closing (bleed it off an edge if it collides). If you
  reused one decor, its coordinates must not be identical on every slide, and
  text must stay readable on top of it;
- **pictures**: if the deck has no photo and the topic allows one, generate 1–3
  images with the chat image tool (e.g. `gigachat_image`/`text2image`) and use
  them on the cover or a key content slide — a big picture is what makes a
  text-heavy deck land. One image = one meaning; never reuse one file twice.

If something is off — fix the HTML and repeat steps 4–6. If you cannot view
images, state it and deliver on `validate: clean` + `inspect.cjs` alone.

Done means: the `.pptx` exists next to `deck.html` (plus `--pdf` only if the
user asked) and `validate` is clean. Finish the turn with a short summary **in
the user's language** — artifact path(s), slide count, style, and at most two
things worth a human glance in PowerPoint (numbers, fonts). No questions, no
"should I export?", no "would you like…": a presentation request is not
finished until the .pptx is produced. A later "fix slide N" means edit
`deck.html`, rebuild, validate.

## Hard bans

- **no permission questions, no "should I export?"**: never "Would you like me
  to proceed / make these changes / build the .pptx?" — the user asked for the
  deck, so you do the whole job (build → export → validate) in one turn and
  report the artifact path. Upfront content questions are fine; mid-work or
  end-of-work approval is not. Answer the user in the user's language (slides
  stay in the deck's language);
- never re-send the same issue list without a change: fix it and re-render, or
  rewrite the file. A failed edit tool call means the change did NOT land — do
  not re-run the pipeline as if it did; rewrite the file and verify the line is
  present;
- no `.ts/.js/.py` decks or build scripts in the result, no npm/pip/curl;
- no chat tools from HTML or helpers;
- no emoji, external URLs, CDNs;
- no `display:none` on slides;
- never change `stage.css`;
- never paint headings in the accent color and never use accent as a
  content-block background;
- never use decor/logo media as a slide background;
- a template copy must reuse at least one template asset (background, logo or
  decor) whenever the profile has any — a "copy" with zero original elements
  is a failed copy;
- do not "fix" overflow by shrinking the font;
- do not delete `deck.html` after export;
- **never hand the job to the user**: no "add this to the HTML", "you will need
  to insert…", "the next step is for you to…". Fixing files is YOUR job —
  `slide.cjs --set N` or one full write call always works. A final message that
  instructs the user how to edit the deck is a failed task, even if it is
  polite and detailed;
- never unpack the .pptx or copy/rename its media by hand (no unzip/tar/shell
  pipelines into `images/`): template art is already deployed by
  `style-profile.cjs --deploy` — use the EXACT file names from
  `images/template-assets.md`; extracting someone else's media is the job of
  `read-pptx.cjs --extract-media` when the user asks for it;
- never retry an identical tool call: if a call fails twice, change the
  approach (read the exact lines, rewrite the whole file);
- do not ask the user about editor/tool mechanics (ambiguous anchors, failed
  edits, formatting) — read the file and recover yourself: unique anchor or
  full rewrite.

## Files

`patterns.md` — slide patterns · `charts.md` — charts · `reference.md` —
helpers/formats/diagnostics · `styles/_base/icons.md` — paste-ready Lucide
icons · `examples/example-deck.html` — reference deck.
