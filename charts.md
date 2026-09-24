# charts.md — charts without libraries

Every snippet is verified by export: SVG becomes **native PowerPoint vector
shapes** (the exporter keeps SVG), caption text stays text or part of the
vector. No canvas and no external JS libraries — only SVG and the CSS
primitives from `_base.css`.

Data honesty rules:

- captions and numbers on the slide must match the source data;
- if the data is estimated, write "estimate" in the caption, never present it
  as fact;
- do not draw "approximate" charts without numbers: either data, or an
  explicit "schematic" label;
- at most one chart per slide; two charts — two slides.

The bar/area/series of a chart is a slide accent: a slide with a chart
automatically satisfies the accent budget (see `patterns.md`).

## 1. Line/area (trend)

```html
<div class="chart">
  <svg viewBox="0 0 520 300" role="img" aria-label="Weekly trend">
    <line class="grid-line" x1="40" y1="70"  x2="500" y2="70"/>
    <line class="grid-line" x1="40" y1="140" x2="500" y2="140"/>
    <line class="grid-line" x1="40" y1="210" x2="500" y2="210"/>
    <line class="axis" x1="40" y1="260" x2="500" y2="260"/>
    <line class="axis" x1="40" y1="30"  x2="40"  y2="260"/>
    <polygon class="area" points="40,238 130,214 220,180 310,168 400,120 490,74 490,260 40,260"/>
    <polyline class="series" points="40,238 130,214 220,180 310,168 400,120 490,74"/>
    <circle class="point" cx="130" cy="214" r="4"/>
    <circle class="point" cx="310" cy="168" r="4"/>
    <circle class="point" cx="490" cy="74"  r="4"/>
    <text class="lbl" x="40"  y="284" text-anchor="middle">W1</text>
    <text class="lbl" x="130" y="284" text-anchor="middle">W2</text>
    <text class="lbl" x="220" y="284" text-anchor="middle">W3</text>
    <text class="lbl" x="310" y="284" text-anchor="middle">W4</text>
    <text class="lbl" x="400" y="284" text-anchor="middle">W5</text>
    <text class="lbl" x="490" y="284" text-anchor="middle">W6</text>
    <text class="val" x="490" y="58"  text-anchor="middle">62%</text>
  </svg>
  <div class="legend"><span><i></i>repeat scenarios, % of active users</span></div>
</div>
```

How to compute coordinates: Y axis from 30 (max) to 260 (zero). A value `v`
with maximum `m`: `y = 260 - (v/m) * 230`. X axis — evenly from 40 to 490.

## 2. Columns (category comparison)

```html
<div class="chart">
  <div class="bars">
    <div class="bar"><div class="val">1 240</div><div class="fill" style="height:78%"></div><div class="lbl">Presentations</div></div>
    <div class="bar"><div class="val">860</div><div class="fill" style="height:54%"></div><div class="lbl">Reports</div></div>
    <div class="bar"><div class="val">2 300</div><div class="fill" style="height:100%"></div><div class="lbl">Letters</div></div>
  </div>
</div>
```

Column `height` = `value / maximum × 100%`. In the `sber`/`signal-night`
styles the bars are filled with the brand gradient automatically
(`--grad-brand`); in the other styles they use the accent color. One color
family — for a
"second series" do not introduce a new color, mark it with a caption/pattern.

## 3. Horizontal bars (ranking)

```html
<div class="hbars">
  <div class="hbar"><span>Scenario A</span><div class="track"><div class="fill" style="width:82%"></div></div><span class="val">82%</span></div>
  <div class="hbar"><span>Scenario B</span><div class="track"><div class="fill" style="width:64%"></div></div><span class="val">64%</span></div>
  <div class="hbar"><span>Scenario C</span><div class="track"><div class="fill" style="width:47%"></div></div><span class="val">47%</span></div>
</div>
```

Left caption ≤ 14 characters (130px column). For long names use a legend under
the chart.

## 4. Donut (structure, shares)

See `patterns.md`, pattern 9. Circle at r=48 ≈ 301.6; a segment is
`stroke-dasharray="{share×301.6} 301.6"`, the next segment shifts by
`stroke-dashoffset="-{sum of previous shares×301.6}"`. Shares sum to 100%.

## 5. KPI tiles instead of a chart

With little data (2–4 numbers) a chart is unnecessary — use `.kpi-row` from
patterns.md. It is more honest and reads faster.

## 6. Diagrams (no data)

For processes — `.flow` (pattern 7), for steps — `.steps` (pattern 6), for an
effort/impact matrix — `.matrix`:

```html
<div class="matrix">
  <div class="axis-y">Impact</div>
  <div class="cell accent"><h3>Quick wins</h3><p>High impact, low effort.</p></div>
  <div class="cell"><h3>Big projects</h3><p>High impact, much work.</p></div>
  <div class="cell"><h3>Routine</h3><p>Low impact, low effort.</p></div>
  <div class="cell"><h3>Do not do</h3><p>Low impact, much work.</p></div>
  <div class="axis-x">Effort</div>
</div>
```

## Export to .pptx

- the exporter turns SVG charts into native PowerPoint vector shapes
  (`svgAsVector`) inserted as a group of shapes — editable as vectors;
- CSS bars (`.bars`, `.hbars`, `.donut`) export as rectangles and rings —
  "Convert to Shapes" works in PowerPoint;
- captions inside SVG stay part of the vector group, not separate text. If
  captions must be editable in PowerPoint, put them in HTML next to the SVG
  (like `.legend` and `.hbar .val`), not inside the SVG;
- verify the result with `render.cjs --pptx` and review slides in PowerPoint:
  the test deck `tests/fixtures/patterns-body.html` is the reference.
