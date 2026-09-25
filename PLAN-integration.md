# PLAN-integration.md — rolling presentation v3 into desktop-ai-app

Goal: replace the current `presentation` skill (PptxGenJS/`deck.js`) with v3
(HTML → native .pptx) and add a one-shot `--deck-render` mode to the app, which
the skill helpers rely on.

The skill is self-contained: no npm dependencies, no network and no new
renderer pages at runtime. All the app has to provide is one off-screen
BrowserWindow, which already exists in production for `--pptx-verify`.

## 1. Files: what goes where

| From (this repository) | To (desktop-ai-app) |
|---|---|
| `presentation_v3/*` | `packages/desktop-electron/resources/defaults/skills/presentation/` (delete the folder and replace it entirely) |
| `presentation_v3/.bundle-version` (= 59) | already inside the folder above |
| `presentation_v3/app/deck-render.ts` | `src/main/deck-render.ts` |
| the detector from `deck-render.ts` (`isRunDeckRender`) | `src/main/deck-render-check.ts` (mirroring `pptx-verify-check.ts`) |

```bash
# in the app repository:
git rm -r packages/desktop-electron/resources/defaults/skills/presentation
cp -r /path/to/presentation_v3 packages/desktop-electron/resources/defaults/skills/presentation
git add packages/desktop-electron/resources/defaults/skills/presentation
```

Verify `.bundle-version` = `59` (the currently installed one = 35; when the
number increases, `seed-defaults.ts` deletes the user's folder and re-seeds it
entirely — the old skill rolls out by itself).

## 2. App changes

### 2.1 Detector: follow the app's existing pattern

`--deck-render` must not split the main bundle. If the app keeps
`isRunPptxVerify()` inside `pptx-verify.ts` and imports it statically (no
separate check file) — as this checkout does — do the same:

- put `export function isRunDeckRender(): boolean` in `src/main/deck-render.ts`
  together with `runDeckRender()`;
- import both statically in `index.ts`.

Do NOT use `await import("./deck-render")`: rollup would emit
`out/main/chunks/*`, while `index.ts` requires a single `out/main/index.js`
(the same reason `pptx-verify` is imported statically).

A separate `deck-render-check.ts` (mirroring an existing
`pptx-verify-check.ts`) is only needed if the app already uses that convention.

```ts
// inside src/main/deck-render.ts
export function isRunDeckRender(): boolean {
  return process.argv.indexOf("--deck-render") !== -1
}
```

### 2.2 `src/main/deck-render.ts` — drop in as is

The file is already written for this repository: an off-screen 1280×720 window
(`offscreen: true`, `backgroundThrottling: false`, `sandbox: true`,
`contextIsolation: true`), `loadFile(deck)`, `probe.js` injection,
per-slide `capturePage`, `report/inventory`, export via
`dom-to-pptx.bundle.js` from the skill folder (`--vendor-dir`), TTF embedding
(`--fonts-dir`), `printToPDF` for `--pdf`. No imports from app internals except
`electron`.

Deliberate deviations from `pptx-verify.ts`:

- no `registerRendererProtocol()` needed — a user `file://` is loaded;
- `setWindowOpenHandler → deny`, `will-navigate → preventDefault` (the deck
  must not navigate anywhere; the offline contract is additionally checked by
  lint-deck);
- paths to `probe.js`/`vendor`/`fonts` are passed as absolutes from the helper
  so the mode does not depend on `process.resourcesPath`/ASAR.

### 2.3 `src/main/index.ts` — the startup branch

Next to the existing `--pptx-verify` branch (before the single-instance lock,
sidecar, updater — same lifecycle as pptx-verify), with a STATIC import:

```ts
import { isRunDeckRender, runDeckRender } from "./deck-render"

// ... where isRunPptxVerify() is handled:
if (isRunDeckRender()) {
  runDeckRender(logger)   // logger — the app's existing logger
  return
}
```

`runDeckRender()` hides the macOS Dock, validates the arguments, sets a 240s
watchdog and exits the process via `app.exit(0|2|3)`. `setupApp()` is skipped,
as in `--pptx-verify`.

### 2.4 `src/main/seed-defaults.ts`

`presentation` is already in `versionStampedSkills` (the line exists in the
current version) — no code change is needed, only the new
`.bundle-version = 59`. If the line is actually missing, add it following the
neighboring skills.

### 2.5 Packaging

Nothing extra: the skill folder ships into `resources` as before, ≈ 6 MB total
(vendored bundles 3.8 MB, fonts 1.6 MB, the reference deck, icons). No new npm
dependencies.

## 3. Rollout and rollback

1. A PR replacing the skill folder + `deck-render.ts` + the branch in
   `index.ts`.
2. Build the app, run scenarios S1–S3 from `tests/acceptance.md` locally (they
   need no PowerPoint, only the CLI).
3. Ship it; on the first launch the seeder replaces the skill for users.
4. Rollback: restore the previous skill folder and `.bundle-version` (with the
   next value so the seeder re-seeds again, e.g. 40). User style profiles in
   `~/.wsc/config/styles/` are unaffected — they live outside the skill.

## 4. What is removed from the repository

- `resources/defaults/skills/presentation/helpers/*` of the old formats
  (`deck.js` runners, template/save-template, text/layout analyzers, built
  pptxgenjs bundles) — fully replaced by the v3 content.
- old vendor build scripts (`vendor-pptxgenjs.ts`, `vendor-automizer.ts`,
  `vendor-skill-extras.ts` + their `*-entry.cjs`) — only after `rg` confirms
  nothing else consumes them (package.json scripts, CI configs, other skills).
  v3 vendors dom-to-pptx/jszip inside the skill folder; the old bundles stay
  recoverable from git history for a rollback.
- `test/pptxgenjs-helpers.test.ts` and `scripts/smoke-pptxgenjs-skill.ts` —
  they require the removed `helpers/text.cjs` and fail at import; remove their
  CI references too.
- old tests referencing the `deck.js` contract (if any) — update to the
  `deck.html` contract: lint/assets/render/export.

## 5. Risks and what to watch during acceptance

| Risk | Check/mitigation |
|---|---|
| `capturePage` on an off-screen window on a specific Electron version | the same pattern is already in production (`--pptx-verify`); S3 produces PNG files |
| `executeJavaScript` with a 3.7 MB bundle string | S1: the export happens; the 240s timeout has headroom |
| Fonts: ~1.1 MB TTF data URIs in the export tick argument | S1: `ppt/fonts/*.fntdata` ≥ 1, text is not "blurred" |
| Windows paths (Cyrillic, spaces) | helpers pass absolute paths only; run S1–S6 on Windows too |
| A deck with endless JS (the navigator) | watchdog + lint cuts external scripts; `timed out` in stdout |
| Raster effects (blur/shadows) in the .pptx | expected: complex effects become a picture; text outside effects stays native (verify in S1) |

## 6. Deliberately out of scope for v3

- editing an existing .pptx in place (edit-in-place on a company master) — do
  it as a separate skill on top of `read-pptx.cjs` if needed; v3 rebuilds the
  deck in HTML;
- EMF/WMF→SVG conversion when reading (no offline converter; the files are
  extracted and listed);
- native PowerPoint charts: charts are drawn in SVG/CSS and exported as vector
  shapes (editable as shapes).

## 7. v3 addition: `--pptx-verify` is a dependency of shots.cjs

`helpers/shots.cjs` renders template slides to PNG for vision-based style
copying via the app's existing one-shot mode:

```js
spawn(GIGATOOL_NODE, [GIGATOOL_APP_PATH?, "--pptx-verify", <abs.pptx>, "--out-dir", <dir>])
```

This mode already exists in production (the v1 skill used it); the integration
must keep it available in parallel with `--deck-render`. If it is ever
removed, shots.cjs degrades to the `read-pptx.cjs --extract-media` fallback
(exit 2, fallback instructions printed) — the skill keeps working, only the
vision quality drops.

## 8. v54 addition: structural read (no new app modes)

`helpers/lib/describe.cjs` + `helpers/inspect.cjs` reuse the existing
`--deck-render` report/inventory: the probe inventory now carries `layers`
(full-slide background/paint), `blocks` (card/grid/stat/step/decor/chart with
fill and geometry) and `cls`/`src`/`fill` per element, and the helpers print a
per-slide structural read plus a factual `images/template-assets.md` usage map.
No app change is required; the emitted report shape is backwards compatible
(only additive keys). Design decisions — layout variety, pictures, decor
placement — stay with the model's visual self-review (SKILL §6), not with
lint gates: functional checks remain limited to objectively visible defects
(clip/overlap/blank/broken).

## 9. v55 addition: richer template extraction + editing guards (no app change)

`style-profile.cjs` key mode now deploys up to 20 assets (bg 4, decor 6,
photo 2, icon 4, logo, branding) instead of 8. The slide-1 background is ranked
first and labelled `(cover)`; near-white wide lockups are classified as
**branding** (not decor) so they are not pasted over the logo on every slide;
`template-assets.md` gains placements with rotation, Photo/Icon/Branding
sections, Box styles (runner-up fill → `--c-surface-2` + `.card.deep`) and a
per-slide `Layout recipes` map; placement slide numbers are 1-based (they used
to be off by one). `lint-deck.cjs` errors on raw `<h3>/<p>/<ul>` inside pattern
boxes (one-box rule), so a fallback to raw HTML inside `.card` is caught as a
static error. Report/inventory shapes are untouched; no app change.

## 10. v56 addition: completion contract (no permission questions)

SKILL.md used to end with "ask the user to verify estimated numbers", which a
real run turned into an English "should I make the pptx?" question. The
delivery section now defines done (the .pptx exists next to deck.html and
`validate` is clean), forbids export/approval questions and English replies to
Russian users, and adds two editing guards: a failed edit means the change did
not land (never re-run the pipeline on it), and a slide-wide rename is one
`replaceAll` edit (or a full rewrite), not N disambiguation attempts. No code
change.

## 11. Release checklist — the version file IS the ship status

The seeder compares `.bundle-version` and re-seeds only when the shipped number
is HIGHER than the installed one. Editing skill files without bumping it ships
nothing: users keep running the old instructions. Real incident: the app repo
carried the new helpers but `.bundle-version` stayed at 41, so a run still had
the old SKILL.md line "ask the user to verify estimated numbers" and the agent
asked whether to build the pptx. When syncing `presentation_v3/` into the app
repo:

1. copy **every** file including the hidden `.bundle-version` (it is tracked;
   do not exclude it from the copy). Use a sync that EXCLUDES `.git` — both
   folders are git working trees, and `cp -a src/. dst/` will overwrite the
   destination's HEAD/refs/index with the stale clone's metadata:
   `rsync -a --delete --exclude .git presentation_v3/ presentation_v3_git/pptx/`
   (fallback without rsync:
   `find presentation_v3 -mindepth 1 -maxdepth 1 ! -name .git -exec cp -a {} presentation_v3_git/pptx/ \;`);
2. verify the tracked value matches the source:
   `git show HEAD:.bundle-version` vs `cat presentation_v3/.bundle-version`;
3. `git status --short` must list only the intended release files (content +
   `.bundle-version`) — commit them together; an uncommitted working tree ships
   nothing either.

## 12. v57 addition: slide.cjs + no hand-off contract

`helpers/slide.cjs` (new) does per-slide `--list/--get/--set/--append` by
replacing the Nth `<section>…</section>` with zero string matching, because
deck.html repeats the slide/logo/decor markup and the edit tool's `oldString`
failed on real runs (multiple matches / not found). SKILL §3 routes per-slide
changes through it (get fragment → edit → set), keeps "a failed edit means the
change is not in the file", and the hard bans explicitly forbid ending the task
by telling the user how to edit the HTML (a real run answered «вам потребуется
вручную добавить фон…» instead of finishing). The lint background-coverage
error now counts slides that actually have a background and names the required
number + asset class instead of leaking profile counters. No app change.

## 13. v58 addition: the loop cannot lie about what it rendered

v58 audit batch (four independent audits: render/app contract, docs vs code,
template extraction behavior, helper CLIs). Fixed on top of the render-loop
fix: `inventory.json` wrapper made review's structural read dead code (now
unwrapped in render.cjs); review ignores a crashed render and printed "clean"
with partial PNGs (now fails the turn with the real exit code); blocking
findings exit 4 without an export too; the app prints per-issue lines before
the export gate and its watchdog honors PRESENTATION_RENDER_TIMEOUT_MS;
stale `.pptx`/`.pdf` in a reused out-dir are removed and review refuses to
validate a .pptx older than deck.html; `box styles` slide numbers were off by
one; backgrounds are always `template-bg-N` and list effective slides;
`expand-styles.cjs` writes only with `--write`; `refs.cjs` ignores CSS/HTML
comments (the canonical comment used to fail review with a false MISSING-FILE
for "..." on clean decks); lint's one-box scan is depth-aware and covers
`.matrix .cell`; the undefined-class warning now uses the canonical CSS;
docs corrected (accent-* are suggestions, charts/patterns snippets no longer
split boxes, slide.cjs instead of footer anchors, real diagnostic strings).

A real 1-slide run reused `--out-dir /tmp/deck-check` from a previous 30-slide
deck: the renderer wrote slide-01.png, review listed slide-01…30, and the model
went looking at the wrong pictures. `render.cjs` now removes its own artifacts
(slide-NN.png, report.json, inventory.json) from the out-dir before every
attempt; `shots.cjs` does the same before `--pptx-verify`. `review.cjs` prints
an explicit ACTION line when blocking errors exist and repeats the
slide.cjs/full-rewrite recovery path; `index.cjs` does the same after a lint
failure. Lint messages for the one-box rule / missing footer / missing
background / missing decor now include the exact paste-ready snippet, and
LOW-CONTRAST names the measured text color and says to fix the color/backdrop,
not the font weight. No app change.

## 14. v59 addition: case-8 fixes (loop-breaking messages, slide count, language)
- language is not flexible: SKILL rule 0 now says **always Russian**, whatever
  the user's language — the "user's language" wording invited an English run;
- **no permanent export block**: `index.cjs`/`render.cjs` accept `--force`
  (app: `--allow-blocking`). After two honest fix attempts the agent exports
  despite blocking findings with a loud warning and states the remaining
  defects — a delivered deck with a known defect beats a stalled run with no
  file. The review ACTION line and the index lint failure print this path.

- probe `missing-br` names the box and the exact pair and says the `<br>` goes
  BETWEEN the rows — a real run put it after the last row and looped four
  review cycles because the message never said where;
- `review.cjs` prints a STATIC LINT block (the authored-file lint that gates
  the export), so a raw `<h3>/<p>` inside a box is named next to the probe
  finding;
- SKILL: reply in the user's language (a real run finished with an English
  summary); a numbered slide plan before writing; 8 slides or fewer in one
  write, 9+ in two passes with `slide.cjs --append` (a 10-slide request
  produced a 5-slide deck because the single write truncated); a count check
  via `slide.cjs --list` before rendering; decor-placement and box-variety
  reminders (one decorative photo was pasted into the same corner on every
  slide and fought the content on slide 4);
- lint ignores role words (`cover/closing/section/quote`) in the class check
  (false warning on the skeleton).
