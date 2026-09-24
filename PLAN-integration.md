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
| `presentation_v3/.bundle-version` (= 48) | already inside the folder above |
| `presentation_v3/app/deck-render.ts` | `src/main/deck-render.ts` |
| the detector from `deck-render.ts` (`isRunDeckRender`) | `src/main/deck-render-check.ts` (mirroring `pptx-verify-check.ts`) |

```bash
# in the app repository:
git rm -r packages/desktop-electron/resources/defaults/skills/presentation
cp -r /path/to/presentation_v3 packages/desktop-electron/resources/defaults/skills/presentation
git add packages/desktop-electron/resources/defaults/skills/presentation
```

Verify `.bundle-version` = `48` (the currently installed one = 35; when the
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
`.bundle-version = 48`. If the line is actually missing, add it following the
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
