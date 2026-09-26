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

0. **User-facing text is Russian; thinking stays English.** The reply to the
   user, the visible plan, the final summary and any question are in Russian.
   Your internal reasoning between tool calls may be English — that is the
   platform default (think in English, talk to the user in Russian); do not
   translate it and do not let it leak into the answer. Slides are Russian
   too — a real run delivered an all-English deck to a Russian user. That
   is the failure this rule prevents.

1. **Only `helpers/index.cjs` builds the .pptx.**
   There is no python, no node, no npm and no network in this environment;
   `$GIGATOOL_NODE` is the only runtime and the helpers are the only builder.
   Never write a python-pptx script, never shell out to LibreOffice, never use
   an online converter or an npm package. Another builder = a failed task:
   only this pipeline produces native text, embedded fonts and notes. If the
   command does not work, say so and stop — do not improvise an alternative.
 2. **Everything lives in the working folder.**
    `deck.html` is created in the current working directory (the chat
    workspace, the one `pwd` showed at start) and the `.pptx` lands next to
    it; renders, shots, art and edit fragments go into the helper folders
    there (`deck-check/`, `tpl-shots/`, `images/`, `deck-media/`). Never put
    user-visible files in `/tmp` and never invent your own folders — the user
    will not see them, and `lint-deck` fails a deck that lives in temp.

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
 6. **Tools report, you decide.**
    `index.cjs deck.html --pptx` renders, checks and exports. Only **fatal
    render defects** stop the export (exit 4, no `.pptx`): a blank or hidden
    slide, clipped text, a broken image, a broken stage. Everything else the
    probe prints — overlaps, off-slide bleed, contrast, emptiness, spacing,
    accents — is a **finding for your eyes**, not a gate: look at the render,
    keep what is the design, fix what is a defect. lint errors are the same
    deal: offline contract, missing files, box markup that corrupts the
    export; lint warnings are advice. Every content slide must have
    `elements > 0` and `coverage > 0` in `inventory.json`. **A gate stops the
    loop, not the delivery**: if the same blocking error survives two honest
    repairs (or the runtime warns about repeated calls), deliver anyway with
    `index.cjs deck.html --pptx --force` — the .pptx is produced with a loud
    warning — and state exactly which defects remain. A delivered deck with a
    known defect beats a stalled run with no file. Fix markup in deck.html
    itself (it is your source, not a build artifact): a failed string
    replacement is not a broken tool — re-read the file, or edit the slide
    fragment via `slide.cjs --get N` / `--set N --from -`.
 7. **The edit loop is yours, and it is bounded.**
    Your first render usually has a few real issues — overlaps, overflow,
    misalignment. Find them, fix deck.html, re-render, and stop: two or three
    honest passes beat endless polishing. After staring at your own markup you
    see what you expect rather than what rendered — look at the PNGs fresh.
 8. **Look before you copy, look before you deliver (vision).**
    When a template .pptx is attached, render its slides with
    `helpers/shots.cjs` and READ the images before extracting a style. The
    template is the reference, not a suspect deck: its off-slide bleed, its
    text-over-graphics, its contrast choices are the design you are copying —
    the tools baseline them out and say so. The render→look→fix→repeat loop is
    driven by `helpers/review.cjs`; READ its printed PNGs at every iteration
    and once more after the export. If you cannot view images, say so and rely
    on `validate.cjs` + the text digest.
 9. **Do not change `stage.css`** — the 1280×720 stage is the export contract.
    No emoji, no external URLs/CDNs, no font shrinking to hide overflow
    (cut the text or switch the pattern), never delete `deck.html`.


## Markup gotchas — write it right the first time

Each of these was a real failed run. The lint catches them, but the cheap fix
is not writing them:

- **One box = one native shape.** Text inside `.card`/`.kpi`/`.pill`/`.stat`/
  `.cell` is runs — `.t-title`/`.t-body`/`.t-cap`, `<b>`, and `<br>` between
  rows — nothing else. A raw `<h3>`/`<p>`/`<ul>` inside the box splits it into
  extra text shapes on export and the box style is lost; the rows also merge
  without `<br>`. This is the #1 markup defect.
- **The managed style block is replaced wholesale.**
  `<style data-presentation-style="…">` is filled by the builder on every run —
  CSS pasted into it silently disappears from the render. Your own CSS goes
  into a second, plain `<style>` block after it.
- **Content lives inside `.slide-pad`.** It carries the font and padding
  contract; a slide whose content sits directly in `<section>` falls back to
  the browser default font (Times New Roman in the render).
- **The deck is offline.** No external URLs — an `@import` from a CDN never
  loads and blocks the build; fonts come from the profile tokens.
- **Art layers are pinned by z-index** (bg 0, content 1, logo/decor 2): the
  order of `<img class="bg-img">`/`.decor-img`/`.logo` inside the slide does
  not change what covers what. Set only `width` on photos — width+height
  stretches them.
- **Slides hide via `.active`, never `display:none`** — the exporter drops
  hidden subtrees silently.

## Result contract

- The working folder holds the deliverables — `<kebab-slug>.deck.html` and
  `<kebab-slug>.pptx` — plus the folders the helpers create next to them:
  `images/` (deployed art), `tpl-shots/` (template renders),
  `deck-check/` (deck renders and edit fragments), `deck-media/` (extracted
  media). Everything the user might open lives here, visible; `/tmp` is only
  the builder's internal scratch, which it cleans itself. Never invent your
  own folders (`/tmp/folder`, `output/`, `result/`).
- No `deck.js`/`deck.ts`/`.py`/build scripts in the result: HTML is the source.
- Reply to the user with absolute paths to the .pptx and .html plus a one-line
  summary.

## Command (the only allowed runtime)

```bash
cd "<the chat's working folder>" && ELECTRON_RUN_AS_NODE=1 "$GIGATOOL_NODE" "$HOME/.wsc/config/skills/presentation/helpers/index.cjs" deck.html --pptx
```

Every command runs in the working folder the session starts in — you know it
from `pwd` at start, and it is where the user expects the files. Write
`deck.html`, `images/`, `tpl-shots/`, `deck-check/` and `deck-media/` there;
the deck never lives in `/tmp`, and neither do the helper folders the user
might open — `/tmp` is only the builder's internal scratch, which it cleans
itself. Prefix helper calls with
`cd "<working folder>" &&` so a drifted shell cannot send files elsewhere,
and when a helper prints an absolute folder (deploy dir, artifact paths),
read it — if it is not your working folder, re-run with an explicit path.
After a style-profile `--deploy`, verify with `ls images/` before writing
deck.html.

All helpers run the same way (`ELECTRON_RUN_AS_NODE=1 "$GIGATOOL_NODE" …
helpers/<name>.cjs …`). There is no bare `node` and no `python` — do not even
try them. If `$GIGATOOL_NODE` is not set, say the deck cannot be built outside
the app and stop.

Full helper list, report formats and diagnostics: `reference.md`.

## Workflow

### 0. Pick the mode — and read its rules file BEFORE writing

| Request | Mode |
|---|---|
| "make a presentation about X" | read **`create.md`**, then steps 2–7 |
| "make it in the style of this deck" (a .pptx attached) | read **`template.md`**, then steps 2–7 |
| "rework/improve this presentation" (a .pptx attached) | read it (step 1C), then steps 2–7 |
| "in the style of <saved profile>" | `create.md` (it covers saved profiles) |

The mode file is part of the contract, not optional reading: the template-copy
failures (flat backgrounds on an image-bg template, branding-only decor) all
happened while the copy rules sat in a file the agent skimmed past. Read the
one file for your mode, then continue with the plan (§2), writing (§3) and the
loop (§4–6).

Before working, ask the user only what really changes the deck: topic/goal,
audience, approximate length, must-have facts/numbers. Ask at most once, in the
Russian; if the request already contains enough (an attached content
file, "make a presentation about X"), start without asking. **Format is never a
question**: a presentation request always ends with a `.pptx` — never ask
whether to make the pptx, which format, or whether to export. Do not start
laying out before you understand the goal and the length.

### 1C. Rework someone else's .pptx

```bash
... shots.cjs deck.pptx --out-dir tpl-shots   # see it
... read-pptx.cjs deck.pptx --outline                     # texts
... read-pptx.cjs deck.pptx --slide 7                     # one slide in full
... read-pptx.cjs deck.pptx --extract-media deck-media
```

Read EVERY slide you need one by one (`--slide N`) plus its shot: z-order,
groups, px coordinates (1:1 with HTML), SVG vectors, tables, charts, notes,
per-text font/size/color with the inheritance source. Never invent the content
of an attached file: if the report does not show it, say you did not find it.

### 2. Plan the structure

Typical arc: cover → context (1–2) → core (3–5) → plan/comparison → closing
with decisions. 15 minutes ≈ 10 slides. Every slide carries one idea; two ideas
is two slides. Never duplicate texts between slides.

Write the plan as a numbered list — one line per slide — BEFORE the HTML:
`1. cover — …`, `2. kpi-row — …`, `3. split + photo — …`. The plan fixes the
slide count (a "10 slides" request with 8 lines is already a shortfall) and the
pattern per slide, so the deck does not collapse into one repeated grid.

The plan is working notes, never slide content. Plan-role words («проблема»,
«возможности», «преимущества», «сценарий», «презентация») must not appear as
kickers, captions or footers — a real copy carried them as the only labels.
Every label on a slide says what the slide is ABOUT: a fact, a number, a
domain term — not the slide's place in your plan.

### 3. Write deck.html

Use the minimal skeleton (managed style line + your slides). Open
`examples/example-deck.html` as a markup reference — but do NOT copy it
wholesale: its working copy carries expanded CSS that you must not paste.

**Write the whole deck in ONE write call for 8 slides or fewer** (all slides at
once). Do not assemble it slide-by-slide with edit calls — that is exactly how
agents get stuck on "Found multiple matches for oldString" and burn the turn.
The deck source is small (tens of KB): rewriting it completely is always cheaper
than surgical inserts.

**For 9+ slides write in TWO passes**: first a complete deck with the cover and
the first half (it must render), then append the rest with
`slide.cjs deck.html --append --from deck-check/slide-N.html` (or `--from -`), one
fragment per call. A real 10-slide request produced a 5-slide deck because the
single huge write was truncated.

**Count check before rendering**: `slide.cjs deck.html --list` must show exactly
the number of lines in the plan. Fewer → append the missing slides first; the
review header repeats the count, and a short deck is a failed deliverable even
when every present slide is perfect.

If the edit tool reports an ambiguous anchor (`Found multiple matches` /
`Could not find oldString`) — **do not ask the user about tool mechanics** and
do not retry with a bigger context. The markup repeats on every slide, so the
edit tool is the wrong instrument here; recover with `slide.cjs`:

1. `slide.cjs deck.html --get N` — prints slide N's exact `<section>…</section>`;
2. edit that fragment with the write tool (it is one slide);
3. `slide.cjs deck.html --set N --from deck-check/slide-N.html` — puts it back,
   the rest of the file stays byte-identical;
4. or rewrite the whole file in one write call.

Never leave a half-built deck behind: "continue later" means the next call
rewrites the complete file.

**Editing later** (a second pass, or "fix slide N") — use `slide.cjs`, not the
edit tool:

```bash
... slide.cjs deck.html --list                     # index / role / headline per slide
... slide.cjs deck.html --get 3                    # print slide 3's <section>
#   write the corrected fragment → deck-check/slide-3.html, then:
... slide.cjs deck.html --set 3 --from deck-check/slide-3.html
... slide.cjs deck.html --append --from deck-check/slide-11.html
```

Why: the slide opening, logo and decor markup are IDENTICAL on every slide, so
the edit tool's `oldString` is ambiguous by design — real runs burned turns on
"Found multiple matches" while adding a background or a footer. `slide.cjs`
replaces the Nth `<section>` exactly (no matching at all). Rules:

- one slide per `--set` call; for a slide-wide change (all backgrounds, all
  footers) either loop over slides or rewrite the whole file in one write;
- a failed edit means the change is NOT in the file — never re-run the pipeline
  as if it landed;
- **the same error twice means the fix missed the cause**: do not re-run the
   same command (weak runtimes stop the turn for repeated tool calls). Open the
   slide (`slide.cjs --get N`), change the offending element, and re-run once.
   If the runtime has already stopped you for a repeated failed edit call, the
   string-edit tool is finished for this task: rewrite the complete `deck.html`
   in ONE write call (or `slide.cjs --get N` → edit → `--set N`) — and never
   switch to describing the edit to the user instead of making it;
  For `LOW-CONTRAST` change the COLOR or the backdrop — `var(--c-ink)` for
  body, `.card.deep/.card.inverse` on light slides — **not** the font weight;
  for `raw <p> inside .card` replace `<p>x</p>` with
  `<span class="t-body">x</span>`, `<h3>x</h3>` with
  `<span class="t-title">x</span>`, rows separated by `<br>`;
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
  inside `.card/.kpi/.pill/.stat/.matrix .cell` is a lint error — it splits the box
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
  `accent-overload`, a suggestion judged by eye). When the template highlights blocks, copy its recipe: a
  translucent tint (`.card.tint` / `--c-accent-soft`), not a solid fill;
  suggestions `accent-heading`;
- **visual anchor**: every content slide has something to look at — a Lucide
  icon, a chart, a photo or a big number. A deck of text-only cards reads as
  empty even when the text is there (probe: `sparse-box`, validate:
  `visual-scarcity`);
- **vary the layout**: alternate patterns across slides (grid → split →
  kpi-row → timeline → picture). Three or more content slides with the same box
  grid read as "generated, not designed" — check this by eye in step 6;
- **pictures**: a deck made from scratch (5+ slides) MUST carry at least one
  generated picture — the cover or a key content slide. Generate it with the
  chat image tool (e.g. `gigachat_image`/`text2image`), SAVE the file into
  `images/`, and reference the local path (`src="images/<file>"`) inside the
  deck — never the tool call itself, never an external URL (the deck is
  offline; the lint error on a `gigachat_image(` call in deck.html means
  exactly this: file, not call). Place per `patterns.md` (`.media`, `.split`)
  and never reuse one file twice;
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
  `text2image`/`gigachat_image`) before assembling (see `create.md` for the
  from-scratch picture rule); template media — copied
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
- write 8 slides or fewer in one pass; 9+ in two passes (see §3).

### 4. Render loop (look → fix → stop)

```bash
... review.cjs deck.html --out-dir deck-check
# template mode: review.cjs deck.html --out-dir deck-check --reference "<template.pptx>"
```

`review.cjs` renders the deck, prints every `slide-NN.png` to look at, lists
the probe findings, prints the STATIC LINT block (advisory: contract errors
plus advice on the authored file), runs the artifact validator if a .pptx
already exists, and prints the review checklist. Findings are printed as
`error:` (fatal — a blank, hidden, clipped or broken slide; must be fixed) or
`suggestion:` (overlaps, bleed, contrast, spacing, emptiness — judge them
visually: keep what is the design, fix what is a defect). It also prints a
**structural read** of every slide (background layer, decor with coordinates,
blocks, fills, probe issues). Use it when a suggestion needs exact numbers;
`inspect.cjs deck.html --slide N --detail` prints the same for one slide with
block geometry. The out-dir is cleaned before each render, so the printed PNG
list always matches THIS deck — never act on pictures you did not just receive.
The loop is:

1. **review** — run the command;
2. **look** — READ every printed PNG (vision). For a 10-slide deck that is 10
   images; do not skip dense slides or the cover/closing;
3. **fix** — fix every `error:` line; for `suggestion:` lines decide with your
   eyes what genuinely improves the deck;
4. **repeat** until there are no `error:` lines AND your eyes agree — then
   stop. Two or three honest passes are the norm; endless polishing is not.

Finding → what it usually means (never invent a workaround, never hand files
to the user to edit):

- `BROKEN-IMAGE` (error): the file is missing or misnamed — copy it next to
  the deck (`images/…`); `./images/x` and `images/x` are the same thing, do
  not "fix" paths; fix ALL slides with that file at once. If the whole
  `images/` set is gone, the deploy landed in another folder — re-run
  `style-profile.cjs <template.pptx> --deploy "<the deck's folder>"`. Never
  ask the user for template art you can extract yourself, and never copy the
  workspace to temp to "fix permissions";
- `TEXT-CLIP` (error): replace fixed heights / absolute positioning with a
  pattern — text must never be cut off;
- `LOW-CONTRAST` (suggestion): body text uses `.t-body`/`.lead` (ink/muted) —
  an accent color is never body text; if it is the template's own look on
  purpose, keep it and move on;
- `TEXT-OVERLAP` (suggestion): real collision — move the block or the graphic;
  intentional layering (a stamp over a wash) is fine, the render is the judge;
- `MISSING-BR` (suggestion): add `<br>` between the rows inside the box;
- `MOSTLY-EMPTY` (suggestion): add a block or switch the pattern (decor does
  not count as content);
- `render: the app window was destroyed` — Electron crashed; the helper
  retries once automatically. If it repeats, tell the user the app session is
  broken instead of guessing about disk space.

If the same fix touches several slides (identical anchors), rewrite the whole
file — do not try N identical edits.

Taste suggestions you intentionally leave (a deliberate wide spacing, an
unaccented quote slide) do not need fixing — but say in your reply which
suggestions you left and why. Do not build the .pptx while fatal errors
remain: the tool refuses anyway (exit 4).

If you cannot view images in this environment, say so explicitly and use
`inspect.cjs deck.html` — it prints what is on every slide (layers, decor,
blocks, fills, empty band) so you can still reason structurally.

### 5. Export and validate

```bash
... index.cjs deck.html --pptx     # build + line-spacing post-processing
... validate.cjs deck.html         # HTML checks + .pptx artifact
```

The .pptx lands next to deck.html (`artifact: <path>`). The export is refused
(exit 4) only while fatal render defects exist. `validate.cjs` checks the
itself (empty placeholders/slides, split boxes, WCAG contrast, font sizes,
typography, placeholders, stage size, embedded fonts, notes,
`decor-as-background`, `visual-scarcity` …). Loop until `validate: clean`;
warnings must at least be mentioned to the user.

### 6. Visual self-review, then deliver (vision, required)

The last gate — look at the EXPORTED deck, not the HTML:

```bash
... review.cjs deck.html --out-dir deck-final [--reference "<template.pptx>"]
```

READ the printed PNGs and answer honestly — first per slide, then the deck as a
whole. In template mode this step IS `template.md` step 6 (reference shots side
by side, density, decor signature). Look at them fresh: after staring at the
markup you tend to see what you meant, not what rendered (if you have a
subagent, hand it the PNG paths for a second opinion). This is YOUR judgment;
the tools only measure (nothing below is a lint gate):

Per slide:

- is anything cut off, overlapping or touching the edges? aligned with its
  neighbours? gaps even (not one huge empty band in one slide and cramped text
  in another)? contrast readable (icons too, not only text)?
- is there a visual anchor (photo, icon, chart, big number) or is it a wall of
  text boxes?

Across the deck:

- **completeness**: count the slides (`slide.cjs deck.html --list`): the deck
  must match the plan line by line, closing/CTA included. A 10-slide request
  that produced 5 is a failed deliverable even if the five look good;
- **layout variety**: put your content slides side by side — if three or more
  are the same grid of boxes, change some to another pattern from `patterns.md`
  (split, flow, kpi-row, timeline, table, quote) or make one of them a picture
  slide. A deck of identical squares is the #1 "generated, not designed" tell;
- **art placement**: read the structural read's `decor:`/`images:` lines and
  judge with your eyes: is the same element at the same coordinates on 3+
  slides (`decor-stamp`)? Is a photo squashed (`stretched-image`)? Does art sit
  on text (`decor-under-text`)? These are signals, not rules — move, mirror,
  scale or bleed the element, swap it, or keep it deliberately (off-slide bleed
  is stylistically fine).

If something is off — fix the HTML and repeat steps 4–6. If you cannot view
images, state it and deliver on `validate: clean` + `inspect.cjs` alone.

Done means: the `.pptx` exists next to `deck.html` (plus `--pdf` only if the
user asked) and `validate` is clean. **A turn that ends without a .pptx is a
failed turn**: if the runtime guard stops your next edit mid-loop, do not
write a progress report — run `index.cjs deck.html --pptx` (with `--force`
after two honest fix attempts) on what you already have and deliver that with
a stated list of what remains. A real run fixed everything, got stopped before
export and left the user with a status text instead of the deck. Finish the
turn with a short summary **in Russian** — artifact path(s), slide count,
style, and at most two things worth a human glance in PowerPoint (numbers,
fonts). No questions, no "should I export?", no "would you like…": a
presentation request is not finished until the .pptx is produced. A later
"fix slide N" means edit `deck.html`, rebuild, validate.

## Hard bans

- **no permission questions, no "should I export?"**: never "Would you like me
  to proceed / make these changes / build the .pptx?" — the user asked for the
  deck, so you do the whole job (build → export → validate) in one turn and
  report the artifact path. Upfront content questions are fine; mid-work or
  end-of-work approval is not. Answer in Russian (slides are Russian too);
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
- **never end the turn without the artifact**: a status report is not a
  deliverable — if the runtime guard stops your next edit, export what you
  have (`index.cjs deck.html --pptx`, `--force` after two honest fix
  attempts) and state what remains;
- do not ask the user about editor/tool mechanics (ambiguous anchors, failed
  edits, formatting) — read the file and recover yourself: unique anchor or
  full rewrite.

## Files

`create.md` — the from-scratch mode rules · `template.md` — the template-copy
mode rules · `patterns.md` — slide patterns · `charts.md` — charts ·
`reference.md` — helpers/formats/diagnostics · `styles/_base/icons.md` —
paste-ready Lucide icons · `examples/example-deck.html` — reference deck.
