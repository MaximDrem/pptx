# acceptance.md — how the skill is verified

Three levels. L0–L2 run automatically on the dev machine; L3 runs on the work
laptop inside the built app (the Electron part is unavailable on the dev
machine).

## L0 — static (no browser)

```bash
node --check helpers/lib/xml.cjs helpers/lib/pptx.cjs helpers/read-pptx.cjs
node helpers/lint-deck.cjs examples/example-deck.html      # → clean
node helpers/assets.cjs  examples/example-deck.html --check # → clean
node tests/unit/pptx-post.test.cjs          # per-paragraph line spacing
node tests/unit/validate-checks.test.cjs    # new artifact checks
node tests/unit/render-report.test.cjs      # report/artifacts after temp cleanup, exit 4
node tests/unit/lint-deck.test.cjs          # location, //host/file:, no bypass
node tests/unit/expand-styles.test.cjs      # managed style block expansion
```

## L1 — render with real Chromium (test harness)

```bash
node tests/local/run-local.cjs
```

Expected: lint/assets clean; `probe example clean` (including the new
`missing-br`, `no-accent`, `sparse-box` checks — the reference deck and the
patterns fixture must be free of them); the defect fixture catches all 6 types
(`TEXT-CLIP`, `OUT-OF-BOUNDS`, `LOW-CONTRAST`, `EMPTY-REGION`,
`BLANK/MAYBE-BLANK`, `BROKEN-IMAGE`); the font fixture yields
`FONT NOT LOADED: Comic Relief`; the export gives 5 slides, ≥40 text runs,
≥30 shapes, ≥1 embedded TTF, notes; LibreOffice imports the pptx.

Additional (validation and regressions):

- `probe` positives: `font-missing` → `FONT NOT LOADED`; `br-missing` →
  `MISSING-BR`; `accent-sparse` → `NO-ACCENT` + `SPARSE-BOX`;
  `hidden-slide` → `HIDDEN-SLIDE` (a `display:none` slide is dropped by the
  export engine);
- `expand-styles`: the managed block is installed, deck CSS survives, re-runs
  are byte-identical, unknown styles fail loudly;
- `overlap fixture`: line-level overlap detector (HTML text × HTML text,
  SVG label × HTML text) + `TIGHT-GAP` (gap after a heading < 16px);
- `validate.cjs`: on the reference deck — no errors and no known warnings;
  on the contrast fixture — a `CONTRAST` error;
- `pptx-post.cjs`: after export, exact spacing is converted to proportional
  and the PDF render has no word overlap.

Convention regressions:

- `single-box`: run boxes (`.t-*` inside a fill) merge into one shape, block
  children do not (`tests/fixtures/merge-test.html`); rows separated by `<br>`
  still merge and become separate paragraphs;
- `media roles`: `image32.svg → logo`, `image8.png → background` (+`dark`),
  `image48.png → decor` (+`hasAlpha`) — classification is automatic, from
  geometry/usage/pixels.

Standalone fixtures:

```bash
node tests/local/harness.cjs probe  tests/fixtures/patterns-body.html   # 10 patterns, clean
node tests/local/harness.cjs shots  examples/example-deck.html --out-dir /tmp/shots
node tests/local/harness.cjs export examples/example-deck.html --out /tmp/example.pptx

# App path: the bundle is injected as a string (executeJavaScript), not as a
# <script> tag — verify that the UMD still defines window.domToPptx there:
HARNESS_EVAL_BUNDLE=1 node tests/local/harness.cjs export examples/example-deck.html --out /tmp/example2.pptx
```

## L2 — read/export contracts (local)

Reading `ГигаКот_Стратегия_final.pptx` must yield (compare `selfCheck` in JSON):

- 19 slides, 266 shapes, 95 pictures, 9 groups, 5 connectors, 2 graphicFrames
  (2 tables, 0 charts), 28 gradFill, 1 custGeom;
- media: 78 files, of which 5 svg, 1 emf, 4 wdp; ≥1 `SVG-vector` picture in
  `--slide` output (slide 7, `image32.svg`);
- notes: 16 notesSlides, real text on slide 14.

Metrics for `Метрики_СберКот_1409_final.pptx`: 7 slides, 2 charts
(doughnut/bar) with categories and values.

Export (already in L1): `<a:t>` > 40, `<p:sp>` > 30, `ppt/fonts/*.fntdata` ≥ 1,
typeface Inter/Unbounded, notes in `notesSlide`.

## L3 — acceptance in the app (work laptop)

Precondition: the integration from `PLAN-integration.md` is done and
`--deck-render` is available. Every scenario: command → expected result.

- **S1. Build the reference deck**
  `... index.cjs examples/example-deck.html --pptx --out-dir /tmp/s1`
  → `render: clean`; `/tmp/s1` has 5 PNGs, report.json, inventory.json,
  `example-deck.pptx`; the pptx opens in PowerPoint, text is editable, fonts
  are Inter/Unbounded, notes are in place.
- **S2. Defect detection**
  `... index.cjs tests/fixtures/defect-body.html --out-dir /tmp/s2`
  → stdout has `TEXT CLIPPED`, `OUT OF BOUNDS`, `LOW CONTRAST`,
  `EMPTY REGION`, `BLANK SLIDE`, `BROKEN IMAGE`; without `--pptx` the exit
  code is 0 (issues ≠ crash); with `--pptx` the same deck exits 4 and no .pptx
  is produced (S10).
- **S3. PDF/PNG**
  `... render.cjs examples/example-deck.html --out-dir /tmp/s3 --pdf`
  → `example-deck.pdf` with 5 pages of 13.333×7.5in, no margins.
- **S4. Reading a real .pptx**
  `... read-pptx.cjs <ГигаКот.pptx> --slide 7` → groups with children,
  `image32.svg SVG-vector`, table/chart lines; `--extract-media /tmp/s4-media`
  → svg/emf files, `media.json` with usage.
- **S5. Style profile**
  `... style-profile.cjs <ГигаКот.pptx> --name "ГигаКот"` → in
  `~/.wsc/config/styles/gigakot/` tokens (dark background, cyan accent),
  assets ≥ 5. Then a deck in that style: 6–8 slides, background from assets/
  or a token, assets inlined, `--pptx` opens.
- **S6. Style copy from a light deck**
  The same with `hybrid-work-benefits.pptx` → light tokens, accent #4472C4.
- **S7. Missing font**
  A deck with a font outside `fonts/` → stdout `FONT NOT LOADED`, export does
  not crash, the agent reports the substitution.
- **S8. External references**
  `http(s)://`, `//host/...`, `file:` or a chat-tool call in the deck →
  `lint-deck` exit 1 with a clear error.
- **S9. Post-delivery edit**
  "Fix slide 3" → edit deck.html, `index.cjs --pptx` overwrites the pptx, the
  slide count and content match.
- **S10. Export is blocked on defects**
  `... index.cjs tests/fixtures/hidden-slide-body.html --pptx --out-dir /tmp/s10`
  → exit 4, stdout has `HIDDEN-SLIDE` and `blocking issue(s) — export skipped`,
  and **no** `hidden-slide-body.pptx` in `/tmp/s10`. After the `display:none`
  is replaced with `.active`, the export succeeds.
- **S11. Deck in temp is refused**
  `... lint-deck.cjs /tmp/deck.html` → exit 1 with
  `the deck is inside a temp directory` — the result must be built in the
  working folder.
- **S12. Styles expansion**
  A deck with `<style data-presentation-style="signal-night"></style>` gets
  the canonical CSS installed by `index.cjs` before lint/render; re-running
  refreshes it without touching deck-authored `<style>` blocks.

## Acceptance criteria (from the original task)

1. **Full .pptx understanding** — S4 + L2: layers/z-order, groups, pictures
   (png/jpeg/svg/emf/wdp), SVG vectors, tables, charts, text styles
   (size/color/font/weight), notes, layout themes; self-check 100%.
2. **Full-control HTML authoring** — S1/S2/S3: any slides from the verified
   patterns, instant edits, metrics from report/inventory.
3. **Native .pptx, not pictures** — S1/L1: `<a:t>`, `<p:sp>`, embedded fonts,
   notes; LibreOffice/PowerPoint open and edit it.
