# patterns.md — frozen slide patterns

Every pattern below is **verified by a real render** (probe clean: no overflow,
no out-of-bounds, no empty regions, no sparse boxes). Take the markup as is,
change text/numbers/accent classes. Do not invent a new slide structure until
you have tried these.

Rules shared by all patterns:

- one slide = `<section class="slide" data-role="…">`; inside it `.slide-pad`
  and exactly one `.content` (cover/section/closing don't need `.content`);
- `data-role`: `cover | section | content | quote | closing`. Emptiness checks
  depend on the role;
- footer: `<div class="footer"><span>Section</span><span>NN</span></div>` —
  the last element of `.slide-pad`; the `NN` numbering also makes every
  slide block uniquely addressable when editing (anchor on the previous
  slide's footer; see SKILL step 3);
- heading: `.kicker` + `.headline` (`.xl` for cover/section, `.wide` for long
  headings);
- speaker notes: `<template data-pptx-notes>text</template>` — hidden on the
  slide, exported into .pptx notes;
- colors/fonts only via tokens (`var(--c-*)`, `var(--f-*)`). No hex in markup:
  switching a style must be a one-file token swap;
- every content slide has a **visual anchor**: a Lucide icon, a chart, a photo
  or a big number. Text-only card walls read as empty (validate warns
  `visual-scarcity`); icons are copied as ready `<svg class="icon">` lines
  from `styles/_base/icons.md`.

## One-box rule (verified by export)

Text inside a **filled/outlined** box (`.card`, `.node`, `.matrix .cell`) is
written as **text runs directly in the box**, and the box must contain
**nothing but runs** — then the .pptx has ONE native shape the user edits with
one click.

```html
<div class="card">
  <span class="t-cap">Now</span><br>
  <span class="t-title">Manual artifacts</span><br>
  <span class="t-body">• The employee collects data by hand.<br>• Every report has its own format.</span>
</div>
```

- `.t-title` / `.t-body` / `.t-cap` are row runs; `<b>` inside a row is
  emphasis;
- **every row boundary must be a `<br>`.** The exporter merges all runs of a
  box into a single `<a:p>`; without `<br>` PowerPoint shows the title and the
  body on one line. Probe warns `missing-br`;
- `<br>` inside a row is a soft line break inside the same paragraph;
- **never** put these inside a filled box: icons, `<ul>`, `<p>`, `<div>`,
  `display:flex`, absolute-positioned elements. Any such child splits the box
  into "shape + separate text boxes" (`merge-test` in tests);
- an icon/badge goes NEXT to the box:
  `<div class="card-stack"><span class="icon-badge">…</span><div class="card">…runs…</div></div>`;
- lists inside colored cards use the `•` marker in text; a real `<ul>` is fine
  on the slide background (outside filled boxes);
- a box without fill/border (a plain column) may have block children.

## Accent budget

- every **content** slide carries at least one emphasis accent showing the eye
  where to look: an accent card/node/cell/step, an accent number
  (`.accent-text`), a bar/area/donut segment, or a highlighted table row
  (`.table tr.hl`). Probe warns `no-accent`;
- more than one accent per slide is allowed when the layout expresses real
  hierarchy (e.g. two key cards among six), but do not accent everything
  equally — an accent that marks nothing marks nothing;
- **accent discipline**: accent is small by design — badges, icons, numbers,
  one short card (≤2 lines), a highlighted row. Headings stay ink (only
  section dividers are accent). A surface over 40% of the slide → error
  `accent-overload` (the acid "slab" defect: never paint a content block with
  an opaque accent). For a highlighted block use the template's recipe:
  `.card.tint` (translucent `--c-accent-soft`) reads as a highlight, while
  `.card.accent` (solid) is only for ONE short key message;
- the kicker, footer, soft icon badges and icon strokes do NOT count as
  emphasis: they are chrome, not signal.

## Box fill

A box must not look hollow. If a box is taller than its text (probe warns
`sparse-box` above 180px with less than 38% of the height filled), either
shorten the box by removing the stretching wrapper, or add substance (a third
line, a number, a concrete example). Never stretch a box with two lines of text
to 260px.

## 1. cover

```html
<section class="slide cover" data-role="cover">
  <div class="cover-art" aria-hidden="true"></div>
  <div class="decor decor-dots pos-tr"></div>
  <div class="slide-pad">
    <div class="kicker">Product team · Q3 2026</div>
    <h1 class="headline xl wide">Cover headline in two lines</h1>
    <p class="lead">One sentence about why this deck exists.</p>
    <div class="footer"><span>Deck name</span><span>01</span></div>
  </div>
</section>
```

Headline: 5–9 words, no period. `.lead` — at most two lines. `.cover-art`
paints the style's two-color glow and `.decor` adds texture — always include at
least one decor element on covers/sections/closings; it is what separates
"designed" from "typed". Decor never carries text and may bleed off-slide
(probe skips it). Useful picks: `.decor-dots.pos-tr`, `.decor-ring.pos-tr`,
`.decor-blob.pos-bl`, `.decor-blob.alt.pos-tl`. With a brand template add the
logo (`<img>` ~120px wide, top corner) and/or the template's background.

## 2. section

```html
<section class="slide section" data-role="section">
  <div class="cover-art" aria-hidden="true"></div>
  <div class="decor decor-ring pos-tr"></div>
  <div class="slide-pad">
    <div class="content">
      <div class="kicker">Section 2</div>
      <h2 class="headline xl">New section</h2>
      <p class="lead">What this section is about.</p>
    </div>
    <div class="footer"><span>Section</span><span>02</span></div>
  </div>
</section>
```

## 3. kpi — four numbers + takeaway

```html
<section class="slide" data-role="content">
  <div class="slide-pad">
    <div class="slide-head">
      <div class="kicker">Quarter results</div>
      <h2 class="headline wide">Four numbers of the quarter</h2>
    </div>
    <div class="content">
      <div class="kpi-row">
        <div class="stat"><div class="num">+32%</div><div class="cap">revenue growth</div></div>
        <div class="stat"><div class="num">62%</div><div class="cap">return in week two</div></div>
        <div class="stat"><div class="num accent-text">4.6</div><div class="cap">average score</div></div>
        <div class="stat"><div class="num">×2.4</div><div class="cap">artifacts per user</div></div>
      </div>
      <div class="card accent">
        <span class="t-title">What it means</span><br>
        <span class="t-body">A short takeaway under the numbers — no more than two lines.</span>
      </div>
    </div>
    <div class="footer"><span>Results</span><span>03</span></div>
  </div>
</section>
```

Numbers must be real or honestly marked as estimates ("estimate" in the
caption). Use `.num.sm` when a value is a word or is long.

## 4. compare — two options side by side

```html
<div class="grid2">
  <div class="card">
    <span class="t-cap">Now</span><br>
    <span class="t-title">Manual artifacts</span><br>
    <span class="t-body">• The employee collects data by hand.<br>• Every report has its own format.<br>• Repeat scenarios are rare.</span>
  </div>
  <div class="card accent">
    <span class="t-cap">Target</span><br>
    <span class="t-title">Agent skills</span><br>
    <span class="t-body">• One request — a finished artifact.<br>• One style for all teams.<br>• Repeatability — weekly.</span>
  </div>
</div>
```

The accent card marks the recommended/highlighted option. `.card.inverse`
(ink background) is an alternative emphasis for light styles.

## 5. table — table with numbers

```html
<table class="table">
  <thead><tr><th>Scenario</th><th class="num">Runs</th><th class="num">Repeat</th><th class="num">Score</th></tr></thead>
  <tbody>
    <tr><td>Presentations</td><td class="num">1 240</td><td class="num">62%</td><td class="num">4.6</td></tr>
    <tr class="hl"><td>Reports</td><td class="num">860</td><td class="num">48%</td><td class="num">4.4</td></tr>
  </tbody>
</table>
```

4–6 rows, 3–5 columns. `tr.hl` highlights the key row (accent first cell).
Never paste a screenshot of a table when the data can be typed: text stays
editable in .pptx. Add a `.lead` under the table when the slide has room.

## 6. steps — a three-step plan

```html
<div class="steps">
  <div class="card-stack">
    <span class="icon-badge soft">…rocket icon…</span>
    <div class="step accent"><div class="n">01</div><h3>Pilot</h3><p>One team, two weeks, three real scenarios.</p></div>
  </div>
  <div class="card-stack">
    <span class="icon-badge soft">…workflow icon…</span>
    <div class="step"><div class="n">02</div><h3>Integration</h3><p>Connect corporate systems and knowledge bases.</p></div>
  </div>
  <div class="card-stack">
    <span class="icon-badge soft">…trending-up icon…</span>
    <div class="step"><div class="n">03</div><h3>Growth</h3><p>Training, guides and new skills on team demand.</p></div>
  </div>
</div>
```

Three steps is optimal (four max). Icons are optional but make the pattern
substantially more expressive; `.step.accent` marks the decisive step.
Icons come from `node helpers/icons.cjs --get <name>` (Lucide), never emoji.

## 7. flow — process with arrows

```html
<div class="flow">
  <div class="node">
    <span class="t-title">Request</span><br>
    <span class="t-body">The user states the task in plain words — no commands or instructions.</span>
  </div>
  <div class="arrow">→</div>
  <div class="node">
    <span class="t-title">Context</span><br>
    <span class="t-body">The assistant pulls documents, data and history from corporate systems.</span>
  </div>
  <div class="arrow">→</div>
  <div class="node accent">
    <span class="t-title">Result</span><br>
    <span class="t-body">A summary, a draft, a table or a brief — in the format needed next.</span>
  </div>
</div>
<p class="lead">One sentence that explains the whole chain.</p>
```

2–4 nodes. Keep 2–4 lines of text per node so the boxes are not hollow
(probe warns `sparse-box`); the final or decisive node carries `.accent`.

## 8. split — list + number/chart next to it

```html
<div class="split">
  <div class="content top">
    <ul class="list">
      <li>First thesis with evidence.</li>
      <li>Second thesis with a number.</li>
      <li>Third thesis about a risk.</li>
    </ul>
    <div class="card">
      <div class="card-cap">Risk</div><br>
      <span class="t-title">A concrete risk</span><br>
      <span class="t-body">What happens if nothing changes.</span>
    </div>
  </div>
  <div class="chart">
    <div class="hbars">
      <div class="hbar"><span>Scenario A</span><div class="track"><div class="fill" style="width:82%"></div></div><span class="val">82%</span></div>
      <div class="hbar"><span>Scenario B</span><div class="track"><div class="fill" style="width:64%"></div></div><span class="val">64%</span></div>
      <div class="hbar"><span>Scenario C</span><div class="track"><div class="fill" style="width:47%"></div></div><span class="val">47%</span></div>
    </div>
  </div>
</div>
```

The right column may be `.chart` (SVG, see charts.md), `.hbars` or `.media`
with a picture. The chart bars/area are the slide's accent.

## 9. donut — structure with shares

```html
<div class="split">
  <div class="donut">
    <svg viewBox="0 0 120 120" role="img" aria-label="Scenario shares">
      <circle class="track" cx="60" cy="60" r="48"/>
      <circle class="seg" cx="60" cy="60" r="48" stroke-dasharray="150 151" stroke-dashoffset="0"/>
      <circle class="seg alt" cx="60" cy="60" r="48" stroke-dasharray="60 241" stroke-dashoffset="-150"/>
      <circle class="seg muted" cx="60" cy="60" r="48" stroke-dasharray="91 210" stroke-dashoffset="-210"/>
      <text class="center" x="60" y="60" text-anchor="middle">50%</text>
      <text class="center-cap" x="60" y="74" text-anchor="middle">presentations</text>
    </svg>
    <div class="stack">
      <div class="card ghost"><span class="t-title">Presentations — 50%</span><br><span class="t-body">The main scenario.</span></div>
      <div class="card ghost"><span class="t-title">Reports — 20%</span><br><span class="t-body">Regular summaries.</span></div>
    </div>
  </div>
  <div class="content top">
    <div class="card"><span class="card-cap">Observation</span><br><span class="t-title">One scenario dominates</span><br><span class="t-body">Half of all runs are presentations; optimizing here has the largest effect.</span></div>
    <ul class="list">
      <li>The second most frequent scenario is reports.</li>
      <li>The donut structure is recalculated monthly.</li>
    </ul>
  </div>
</div>
```

Shares sum to 100%. Circle length at r=48 ≈ 301.6: `stroke-dasharray =
"share×301.6 301.6"`; every next segment shifts by `stroke-dashoffset` = minus
the sum of previous shares.

## 10. quote / closing — quote + decisions

```html
<section class="slide" data-role="closing">
  <template data-pptx-notes>Ask for a decision, point by point.</template>
  <div class="cover-art" aria-hidden="true"></div>
  <div class="decor decor-blob pos-bl"></div>
  <div class="slide-pad">
    <div class="content center">
      <blockquote class="quote">«A short quote that fixes the main idea.»
        <span class="by">Who said it, when</span>
      </blockquote>
      <div class="steps">
        <div class="step"><div class="n">→</div><h3>Decision 1</h3><p>What we ask to decide.</p></div>
        <div class="step"><div class="n">→</div><h3>Decision 2</h3><p>What we ask to decide.</p></div>
        <div class="step"><div class="n">→</div><h3>Decision 3</h3><p>What we ask to decide.</p></div>
      </div>
    </div>
    <div class="footer"><span>Decisions</span><span>10</span></div>
  </div>
</section>
```

## 11. timeline — a day/process with time marks

```html
<div class="timeline">
  <div class="tl">
    <div class="t">09:00</div>
    <div class="rail"><div class="dot"></div></div>
    <div class="body"><h3>Morning</h3><p>The assistant collects overnight summaries.</p></div>
  </div>
  <div class="tl">
    <div class="t">14:00</div>
    <div class="rail"><div class="dot"></div></div>
    <div class="body"><h3>Meeting</h3><p>A brief on participants and the agenda, ready before the call.</p></div>
  </div>
  <div class="tl">
    <div class="t">19:00</div>
    <div class="rail"><div class="dot"></div></div>
    <div class="body"><h3>Evening</h3><p>The day's outcomes structured into a report.</p></div>
  </div>
</div>
```

3–5 rows; the time column is short (`09:00`, `Q1`, `утро`). Pair with a
`.split` when a summary/chart belongs next to it.

## Deck rhythm

- 8+ slides: at least one `section` and one `closing`; two `kpi` in a row is
  fine, three is monotonous — alternate with `split`/`compare`/`quote`;
- never more than two consecutive slides with the same main block
  (`kpi-row`, `grid2`, `table`);
- cover and closing are mandatory; footer numbering is continuous;
- alternate dense and airy slides: after a table, give the eye a flow or a
  quote.

## What not to do

- `position: absolute` for text coordinates — only if no pattern fits; then
  run render.cjs twice (overflow/overlap);
- nest `.card` inside `.card` deeper than one level;
- set a fixed `height` on cards — height comes from content and the grid;
- stretch short text across a tall box (see "Box fill");
- use `text-align: justify` or `letter-spacing` on Cyrillic;
- leave `<!-- ... -->` comments with draft text in the markup;
- leave a content slide without an emphasis accent.
