#!/usr/bin/env node
// Unit test: the structural deck read (helpers/lib/describe.cjs).
//   - per-slide lines name the real background layer, decor + position, blocks,
//     fills and probe issues (vision shows pixels; these lines show the numbers);
//   - the template map is factual: which deployed asset is used on which slide;
//   - the read never adds taste verdicts (no "repeated layout", no "add a photo").
//
//   node tests/unit/describe.test.cjs
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");
const { describeDeck, parseTemplateAssets, analyzeSlide } = require(path.join(__dirname, "..", "..", "helpers", "lib", "describe.cjs"));

function cardAt(x, y, text) {
  return { cls: "card", fill: "#FFFFFF@0.15", x, y, w: 271, h: 160, kids: 2, text };
}

function buildInventory() {
  const inv = [
    {
      index: 0,
      role: "cover",
      bg: "#002A3A",
      coverage: 0.42,
      decor: 1,
      layers: [{ kind: "image", cls: "bg-img", src: "images/template-bg-1.png", fill: "", text: "" }],
      blocks: [{ cls: "decor decor-dots pos-tr", fill: "gradient", x: 1000, y: -100, w: 280, h: 280, kids: 0, text: "[div]" }],
      notes: "Ключевая мысль.",
      elements: [
        { tag: "div", cls: "kicker", text: "СТРАТЕГИЯ", x: 72, y: 400, w: 300, h: 16, size: 13, lines: 1, color: "#56FF71" },
        { tag: "h1", cls: "headline xl", text: "Большой заголовок", x: 72, y: 430, w: 900, h: 120, size: 58, lines: 2, color: "#F2F5F9" },
        { tag: "img", cls: "logo", src: "images/template-logo.svg", text: "[image]", x: 1100, y: 30, w: 122, h: 19 },
      ],
    },
  ];
  for (let i = 1; i <= 5; i++) {
    inv.push({
      index: i,
      role: "content",
      bg: "#002A3A",
      coverage: 0.62,
      decor: 0,
      layers: [],
      blocks: [
        { cls: "grid2", fill: "", x: 72, y: 260, w: 1136, h: 180, kids: 4, text: "" },
        cardAt(72, 260, "Карточка " + i + " Описание"),
        cardAt(361, 260, "Карточка " + i + " Описание"),
        cardAt(649, 260, "Карточка " + i + " Описание"),
        cardAt(938, 260, "Карточка " + i + " Описание"),
      ],
      notes: "",
      elements: [
        { tag: "div", cls: "kicker", text: "РАЗДЕЛ", x: 72, y: 52, w: 200, h: 16, size: 13, lines: 1, color: "#56FF71" },
        { tag: "h2", cls: "headline", text: "Слайд " + i, x: 72, y: 76, w: 1136, h: 60, size: 38, lines: 1, color: "#F2F5F9" },
      ],
    });
  }
  inv.push({ index: 6, role: "closing", bg: "#002A3A", coverage: 0.31, decor: 1, layers: [], blocks: [], notes: "", elements: [{ tag: "h2", cls: "headline", text: "Финал", x: 72, y: 300, w: 900, h: 60, size: 44, lines: 1 }] });
  return inv;
}

function main() {
  const inventory = buildInventory();
  const report = {
    slides: inventory.map((s, i) => ({
      index: i,
      issues: i >= 1 && i <= 5 ? [{ type: "no-accent", detail: "no emphasis", severity: "warning" }] : [],
    })),
  };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "presentation-v3-describe-"));
  fs.mkdirSync(path.join(dir, "images"));
  fs.writeFileSync(
    path.join(dir, "images", "template-assets.md"),
    [
      "# Template assets — snippets and placement map",
      "",
      "## Background 1",
      "",
      "Used as the slide background on template slides: 8, 9, 10",
      "",
      "```html",
      '<img class="bg-img" src="images/template-bg-1.png" alt="">',
      "```",
      "",
      "## Logo",
      "",
      "Placed on template slides: slide 3: left 48px, top 20px",
      "",
      "```html",
      '<img class="logo" src="images/template-logo.svg" alt="Logo">',
      "```",
      "",
      "## Decor 2 (693×693px)",
      "",
      "In the template it appears at: slide 3: left 766px, top -224px, 444×444px (reference only)",
      "",
      "```html",
      '<img class="decor-img" style="left:766px; top:-224px; width:444px" src="images/template-decor-2.png" alt="">',
      "```",
    ].join("\n"),
  );

  const out = describeDeck({ report, inventory, deckDir: dir, deckName: "mono.deck.html" }).join("\n");

  assert.ok(/deck mono\.deck\.html: 7 slide\(s\)/.test(out), "deck header names the deck and slide count");
  assert.ok(/slide 1\/7 \[cover\] «Большой заголовок»/.test(out), "cover line names the headline");
  assert.ok(out.includes("bg: image template-bg-1.png [bg-img]"), "the real background layer is named");
  assert.ok(/decor: decor decor-dots pos-tr @1000,-100 280×280/.test(out), "decor class + geometry printed");
  assert.ok(/blocks: grid2 · 4 card\(s\) fill #FFFFFF@0\.15/.test(out), "blocks and fills are named");
  assert.ok(/space: content band 62% of the slide height · issues: no-accent/.test(out), "space + probe issues are printed");
  assert.ok(/decor template-decor-2\.png: not used on any slide/.test(out), "the template map reports unused art as a fact");
  assert.ok(/bg template-bg-1\.png: slides 1/.test(out), "used template assets map to slides");
  assert.ok(/logo template-logo\.svg: slides 1/.test(out), "the logo usage is mapped");
  assert.ok(/content pictures: none in the deck/.test(out), "picture count is factual, no advice");
  assert.ok(!/repeated layout|same box fill|no visual anchor|no accent on slides|generate 1–3/.test(out), "the read must not add taste verdicts");

  // One-slide detail mode prints block geometry (what DevTools would show).
  const one = describeDeck({ report, inventory, deckDir: dir, slide: 2 }).join("\n");
  assert.ok(/block \[grid2\] @72,260 1136×180/.test(one), "detail mode prints block geometry");
  assert.ok(/block \[card\] @72,260 271×160 · fill #FFFFFF@0\.15/.test(one), "detail mode prints card fills");

  // template-assets.md parsing is stable.
  const parsed = parseTemplateAssets(fs.readFileSync(path.join(dir, "images", "template-assets.md"), "utf8"));
  assert.strictEqual(parsed.length, 3, "parses bg + logo + decor");
  assert.deepStrictEqual(parsed.map((p) => p.kind), ["bg", "logo", "decor"]);
  assert.strictEqual(parsed[2].file, "template-decor-2.png");

  // analyzeSlide is defensive about a broken slide record.
  const broken = analyzeSlide({ index: 0, error: "boom" }, []);
  assert.strictEqual(broken.role, "content");
  assert.deepStrictEqual(broken.patterns, []);
  assert.deepStrictEqual(broken.images, []);

  console.log("PASS  describe: структурный разбор (фон/декор/блоки/заливки) без вкусовых вердиктов");
}

main();
