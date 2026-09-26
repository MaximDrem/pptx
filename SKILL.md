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
   platform default (think in English, talk to the user in Russian). Slides
   are Russian too — a real run delivered an all-English deck to a Russian
   user.
1. **Only `helpers/index.cjs` builds the .pptx.**
   There is no python, no node, no npm and no network in this environment;
   `$GIGATOOL_NODE` is the only runtime and the helpers are the only builder.
   Never write a python-pptx script, never shell out to LibreOffice, never use
   an online converter or an npm package. Another builder = a failed task:
   only this pipeline produces native text, embedded fonts and notes. If the
   command does not work, say so and stop — do not improvise an alternative.
2. **Work in the user's working folder.**
   `deck.html` is created in the current working directory (the chat
   workspace) and the `.pptx` lands next to it; renders, shots and art go into
   the helper folders next to the deck (`deck-check/`, `tpl-shots/`,
   `images/`). Never put the deck in `/tmp` and never invent your own folders
   (`/tmp/folder`, `output/`) — the user will not see them, and `lint-deck`
   fails a deck that lives in temp.
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
6. **Fatal defects gate the export; everything else is for your eyes.**
   `index.cjs deck.html --pptx` refuses to export (exit 4, no `.pptx`) only
   while FATAL render defects exist: clipped text, a blank or hidden slide, a
   broken image, a broken stage. Everything the probe prints besides that —
   overlaps, off-slide bleed, contrast, spacing, accents — is a finding to
   judge with your eyes in the render, not a gate. **The gate stops the loop,
   not the delivery**: if the same blocker survives two honest repairs, deliver
   with `index.cjs deck.html --pptx --force` and state exactly what remains —
   a delivered deck with a known defect beats a stalled run with no file.
   Every content slide must have `elements > 0` and `coverage > 0` in
   `inventory.json`.
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

- The working folder holds the deliverables — `<kebab-slug>.deck.html` and
  `<kebab-slug>.pptx` — plus the helper folders next to them (`images/`,
  `tpl-shots/`, `deck-check/`). Everything the user might open lives here,
  visible; `/tmp` is only the builder's internal scratch, which it cleans
  itself.
- No `deck.js`/`deck.ts`/`.py`/build scripts in the result: HTML is the source.
- Reply to the user with absolute paths to the .pptx and .html plus a one-line
  summary.

## Command (the only allowed runtime)

```bash
cd "<the chat's working folder>" && ELECTRON_RUN_AS_NODE=1 "$GIGATOOL_NODE" "$HOME/.wsc/config/skills/presentation/helpers/index.cjs" deck.html --pptx
```

All helpers run the same way (`ELECTRON_RUN_AS_NODE=1 "$GIGATOOL_NODE" …
helpers/<name>.cjs …`), prefixed with `cd "<working folder>" &&` so a drifted
shell cannot send files elsewhere. There is no bare `node` and no `python` —
do not even try them. If `$GIGATOOL_NODE` is not set, say the deck cannot be
built outside the app and stop.

Full helper list, report formats and diagnostics: `reference.md`.

## Workflow

### 0. Pick the mode

| Request | Mode |
|---|---|
| "make a presentation about X" | new deck (steps 1A, 2–7) |
| "make it in the style of this deck" (a .pptx attached) | **template copy** (step 1B), then 2–7 |
| "rework/improve this presentation" (a .pptx attached) | read it (step 1C), then 2–7 |
| "in the style of <saved>" | profile from `~/.wsc/config/styles/` |

Before working, ask the user only what really changes the deck: topic/goal,
audience, approximate length, must-have facts/numbers. Ask at most once, in
Russian; if the request already contains enough, start without asking.
**Format is never a question**: a presentation request always ends with a
`.pptx`.

### 1A. Pick a built-in style

**Default: `sber`** — the brand style (white canvas, Sber gradient in accents
and chart fills, Inter in place of the proprietary SB Sans). Alternatives in
`styles/index.json`: `signal-night` (dark, pitch/strategy), `grid-paper`
(neutral, non-Sber), `ink-press` (warm editorial). Pick by content type
without asking; if the user named a style, use it. Never mix two palettes in
one deck.

```html
<style data-presentation-style="sber"></style>
```

### 1B. Copy the style of an attached deck (with your eyes)

Text parsing alone is NOT enough — it produced decks with flat blue slides and
a decorative cat stretched as a background. The workflow:

```bash
# 1) See the template first: per-slide PNGs + a text digest
... shots.cjs "<attached.pptx>" --out-dir tpl-shots

# 2) Extract tokens + assets AND deploy the key art next to the deck
... style-profile.cjs "<attached.pptx>" --name "Style name" --deploy .
```

Right after step 2, verify the deploy landed in YOUR working folder (the
helper prints the absolute deploy dir; `ls images/` must show
template-bg-*.png and template-assets.md).

Then, **in this order**:

1. READ every `tpl-shots/slide-NN.png` (vision). For each slide note:
   role (cover/section/content/closing), background (flat color? photo?
   gradient?), where the logo sits, what is decor vs content. This is the
   ground truth — the parser's roles are hints, your eyes are the verdict.
   For a text-heavy template also run `read-pptx.cjs <template.pptx>
   --outline` — the shots digest truncates long texts.
2. From the shots pick the **background assets**: full-slide, dark or calm
   images only. A transparent PNG or a small/edge element is DECOR — it never
   becomes a slide background (the validator errors `decor-as-background`;
   real incident: the template's cat decor became the final slide's
   background).
3. Note the palette by looking: dominant color, accent, dark or light deck.
   Compare with the extracted `tokens.css`; if they disagree, trust what you
   SEE and fix the tokens (bg/ink/accent) by hand.
4. **MAP every plan slide onto a template slide** (see §2): the copy is
   recognizable because each slide follows a template slide's composition —
   its background, its box looks, its art — not because a script placed
   elements. `images/template-assets.md` holds FACTS: file, size, and where
   each element appears in the template (slide number, position, rotation);
   the role words (`decor`/`photo`/`icon`) are auto-guesses. **Open the image
   files you consider** and answer: what is it? content or atmosphere? does
   my slide need it? Then look at the template shot of the slide you mapped
   and place the art the same way, adapted. Do not stamp one element at the
   same coordinates on every slide — the template moves, mirrors, scales and
   bleeds its art per slide. Technical forms:
   - `<img class="bg-img" src="images/template-bg-1.png" alt="">` as the FIRST
     child of every slide that has a background in the template — usually
     most content slides too, not only cover and closing; match by slide type
     from the deploy map;
   - `--c-surface` already holds the template's own card fill, so `.card`
     looks native; the manifest's **Box styles** lists its actual box looks —
     map each look to its form in patterns.md → **Box variants**
     (`.card`/`.deep`/`.ghost`/`.tint`); the same box on every slide is the
     monotonous-copy failure;
   - `<img class="logo" pos-tl …>` in the corner the manifest prints; a
     **branding lockup** goes where the template puts it (usually once, the
     cover) — it is NOT decor: never repeat it, never place it over the logo;
   - connectors/arrows in the template become `.flow`/`.steps` (never a
     pasted image), a table becomes `.table`; the manifest's **Layout
     recipes** list what the template composes per slide.
5. Build the deck with `data-presentation-style="profile:<slug>"`. Keep the
   template's dark/light decision on EVERY slide — do not switch some slides
   to a flat fill "for variety" (that is how the blue slides happened).
6. Verify against the reference: put a template shot next to your render of
   the same kind of slide. If they feel like different decks, fix tokens,
   backgrounds or the deployed art before delivering.

### 1C. Rework someone else's .pptx

```bash
... shots.cjs deck.pptx --out-dir tpl-shots    # see it
... read-pptx.cjs deck.pptx --outline          # texts
... read-pptx.cjs deck.pptx --slide 7          # one slide in full
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

Write the plan as a numbered list — one line per slide — BEFORE the HTML. In
template mode each line names the TEMPLATE SLIDE it copies:

```
1. cover     ← tpl 1  (фото-фон, логотип слева-сверху, замок бренда внизу)
2. цифры     ← tpl 2  (3 stat-карточки с числами + строка источников)
3. surfaces  ← tpl 6  (сетка иконок 2×3 с подписями)
...
```

The plan fixes the slide count and the composition per slide, so the deck does
not collapse into one repeated grid — "every section on the same
title-and-cards slide" is THE template-copy failure. No two neighbouring
slides map to the same template slide unless the template itself repeats.

The plan is working notes, never slide content: plan-role words («проблема»,
«возможности», «преимущества», «сценарий») must not appear as kickers,
captions or footers — every label on a slide says what the slide is ABOUT
(a fact, a number, a domain term).

### 3. Write deck.html

Use the minimal skeleton (managed style line + your slides). Open
`examples/example-deck.html` as a markup reference — but do NOT copy it
wholesale.

**Write the whole deck in ONE write call for 8 slides or fewer.** Do not
assemble it slide-by-slide with edit calls — that is exactly how agents get
stuck on "Found multiple matches for oldString". **For 9+ slides write in TWO
passes**: a complete deck with the first half (it must render), then append
the rest with `slide.cjs deck.html --append --from deck-check/slide-N.html`.

**In template mode, write in batches of 2–3 slides with the mapped
`tpl-shots/slide-NN.png` open in front of you** (Read the image right before
writing the batch): the copy is made at the writing moment, not from memory
of the shots. A real copy was written in one blast "from the plan" and came
out as flat generic cards.

**Count check before rendering**: `slide.cjs deck.html --list` must show
exactly the number of lines in the plan. Fewer → append the missing slides;
a short deck is a failed deliverable even when every present slide is perfect.

If the edit tool reports an ambiguous anchor (`Found multiple matches` /
`Could not find oldString`) — do not retry it and do not ask the user: the
slide markup repeats on every slide, so the edit tool is the wrong instrument.
Recover with `slide.cjs`:

```bash
... slide.cjs deck.html --list              # index / role / headline
... slide.cjs deck.html --get 3             # print slide 3's <section>
#   write the corrected fragment → deck-check/slide-3.html, then:
... slide.cjs deck.html --set 3 --from deck-check/slide-3.html
... slide.cjs deck.html --append --from deck-check/slide-11.html
```

`slide.cjs` replaces the Nth `<section>` exactly, no matching at all. One
slide per `--set` call; for a slide-wide change (all backgrounds, all
footers) rewrite the whole file in one write call. A failed edit means the
change is NOT in the file — never re-run the pipeline as if it landed. If the
runtime has already stopped you for a repeated failed call, the string-edit
tool is finished for this task: rewrite the complete `deck.html` in ONE write
call. Never leave a half-built deck behind.

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
  have tried the existing ones. Raw `<h2>/<p>/<ul>` pages are not slides;
- **one-box rule**: text inside a colored box is runs directly in the box
  (`.t-title/.t-body/.t-cap`, `<b>`, `<br>` between rows) with nothing else in
  the box — raw `<h3>/<p>/<ul>` inside `.card/.kpi/.pill/.stat` is a lint
  error: it splits the box into extra shapes and loses its style;
- **accent budget**: every content slide carries at least one emphasis accent
  (accent card/node/cell/step, accent number, chart bar, highlighted table
  row); kicker/footer/soft badges do not count (probe warns `no-accent`);
- **visual anchor**: every content slide has something to look at — a Lucide
  icon, a chart, a photo or a big number (probe: `sparse-box`, validate:
  `visual-scarcity`);
- **box fill**: do not leave tall boxes half-empty (probe warns `sparse-box`);
- colors/fonts/radii only via tokens `var(--…)`; hex in markup is forbidden;
- charts — from `charts.md` (SVG/CSS, no libraries), numbers must be honest;
- covers/sections/closings get `<div class="cover-art">` plus at least one
  `<div class="decor …">` element (`decor-dots`/`decor-ring`/`decor-blob`;
  they may bleed off-slide) — the cheap trick that makes covers look
  designed, not typed;
- speaker notes — `<template data-pptx-notes>…</template>` inside EVERY slide;
- **icons**: copy ready `<svg class="icon">…</svg>` lines from
  `styles/_base/icons.md`. No emoji, never draw your own paths;
- images — local files (`<img src="images/...">` with `alt`), generated ONLY
  with a chat image tool (e.g. `gigachat_image`) before assembling; template
  media — deployed by `style-profile.cjs --deploy`, never unpacked by hand;
  never paste `data:` URIs; one image = one meaning, never the same file on
  two slides;
- no external links/fonts/scripts (except our navigator); contacts are PLAIN
  TEXT;
- write 8 slides or fewer in one pass; 9+ in two passes.

### 4. Render loop (look → fix → stop)

```bash
... review.cjs deck.html --out-dir deck-check
# template mode: review.cjs deck.html --out-dir deck-check --reference "<template.pptx>"
```

`review.cjs` renders the deck, prints every `slide-NN.png` to look at, lists
the probe findings (`error:` — fatal, must be fixed; `suggestion:` — overlaps,
bleed, contrast, spacing, emptiness: judge them with your eyes), prints the
static lint (contract errors + advice) and the review checklist. The loop is:

1. **review** — run the command;
2. **look** — READ every printed PNG (vision). For a 10-slide deck that is 10
   images; do not skip dense slides or the cover/closing;
3. **fix** — fix every `error:` line; for `suggestion:` lines decide with your
   eyes what genuinely improves the deck;
4. **repeat** until there are no `error:` lines AND your eyes agree — then
   stop. Two or three honest passes are the norm; endless polishing is not.

Taste suggestions you intentionally leave (a deliberate wide spacing, an
unaccented quote slide) do not need fixing — but say in your reply which ones
and why. If you cannot view images in this environment, say so explicitly and
rely on the probe lines + `inventory.json` (`coverage` > 0 on every content
slide).

### 5. Export and validate

```bash
... index.cjs deck.html --pptx     # build + line-spacing post-processing
... validate.cjs deck.html         # HTML checks + .pptx artifact
```

The .pptx lands next to deck.html (`artifact: <path>`). The export is refused
(exit 4) only while fatal defects exist. `validate.cjs` checks the artifact
itself (empty placeholders/slides, split boxes, WCAG contrast, font sizes,
stage size, embedded fonts, notes, `decor-as-background`,
`visual-scarcity` …). Loop until `validate: clean`; warnings must at least be
mentioned to the user.

### 6. Visual self-review, then deliver (vision)

The last gate — look at the EXPORTED deck, not the HTML:

```bash
... review.cjs deck.html --out-dir deck-final [--reference "<template.pptx>"]
```

READ the printed PNGs (in template mode also the reference shots of the same
slide type) and answer the checklist honestly. If something is off — fix the
HTML and repeat steps 4–6. If you cannot view images, state it and deliver on
`validate: clean` alone.

**A turn that ends without a .pptx is a failed turn.** If the runtime guard
stops your next edit mid-loop, do not write a progress report — run
`index.cjs deck.html --pptx` (with `--force` after two honest fix attempts)
on what you already have and deliver that with a stated list of what remains.
A real run fixed everything, got stopped before export and left the user with
a status text instead of the deck.

Delivery: short summary in Russian — artifact path(s), slide count, style,
and at most two things worth a human glance in PowerPoint. No questions, no
"should I export?": a presentation request is not finished until the .pptx is
produced. A later "fix slide N" means edit `deck.html`, rebuild, validate.

## Hard bans

- no permission questions, no "should I export?" — the user asked for the
  deck, so you do the whole job in one turn and report the artifact path;
- no `.ts/.js/.py` decks or build scripts in the result, no npm/pip/curl;
- no chat tools from HTML or helpers;
- no emoji, external URLs, CDNs;
- no `display:none` on slides;
- never change `stage.css`;
- never use decor/logo media as a slide background;
- a template copy must reuse the template's art (backgrounds, logo, decor) —
  a "copy" with zero original elements is a failed copy;
- **never hand the job to the users**: no "add this to the HTML", "you will
  need to insert…", "refine it in PowerPoint". Fixing files is YOUR job —
  `slide.cjs --set N` or one full write call always works;
- never unpack the .pptx or copy/rename its media by hand: template art is
  deployed by `style-profile.cjs --deploy`; use the EXACT file names from
  `images/template-assets.md`;
- never retry an identical tool call: if a call fails twice, change the
  approach (read the exact lines, rewrite the whole file);
- do not "fix" overflow by shrinking the font;
- do not delete `deck.html` after export.

## Files

`patterns.md` — slide patterns · `charts.md` — charts · `reference.md` —
helpers/formats/diagnostics · `styles/_base/icons.md` — paste-ready Lucide
icons · `examples/example-deck.html` — reference deck.
