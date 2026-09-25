#!/usr/bin/env node
// presentation v3 — the self-reflection driver.
//
//   node review.cjs <deck.html> [--reference <template.pptx>] [--out-dir <dir>] [--no-validate]
//
// One command for the whole look-and-fix loop: renders the deck, prints the
// paths of the slide PNGs to LOOK at (vision), lists probe issues, runs the
// artifact validator (if a .pptx exists) and prints the review checklist.
// The loop is: review → look → fix → review … until render is clean AND the
// eyes say OK, then export.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { renderDeck } = require("./render.cjs");
const { describeDeck } = require("./lib/describe.cjs");

const CHECKLIST = [
  "1. Nothing clipped, overlapping or half-empty — compare with the probe lines above.",
  "2. The style is the SAME on every slide (no random flat-color slides, one palette).",
  "3. Cover/sections: cover-art glow and decor are in place; the logo sits in its corner.",
  "4. Every content slide has a visual anchor: icon, chart, big number or photo.",
  "5. Template mode: put the matching reference shot next to your slide — same family?",
  "6. Nothing reads as generic AI slop: no bars under titles, no wall of identical cards,",
  "   no centered body copy, no emoji, no stretched decor used as a background.",
];

function listPngs(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => /^slide-\d+\.png$/i.test(f))
      .sort();
  } catch {
    return [];
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const deckArg = argv.find((a, i) => !a.startsWith("--") && (i === 0 || !argv[i - 1].startsWith("--")));
  if (!deckArg) {
    console.error("usage: review.cjs <deck.html> [--reference <template.pptx>] [--out-dir <dir>] [--no-validate]");
    process.exit(2);
  }
  const deck = path.resolve(deckArg);
  const outDir = path.resolve(flag("--out-dir") || fs.mkdtempSync(path.join(os.tmpdir(), "deck-review-")));

  // Cheap preflight BEFORE the browser: catch missing/misnamed local files
  // (a typo like images/template-bbg-1.png used to surface only as a
  // BROKEN-IMAGE deep in the render loop).
  try {
    const { collectRefs, isData, isExternal, resolveRef } = require("./refs.cjs");
    const missing = [];
    for (const { ref } of collectRefs(fs.readFileSync(deck, "utf8"))) {
      if (isData(ref) || isExternal(ref)) continue;
      const { found } = resolveRef(path.dirname(deck), ref);
      if (!found) missing.push(ref);
    }
    if (missing.length) {
      console.error("=== MISSING FILES (fix these paths first) ===");
      for (const m of missing) console.error("  " + m);
      console.error("the file must exist next to the deck (images/…); check the spelling — do not rename paths to ./images, both forms are equivalent");
      process.exit(1);
    }
  } catch {
    // preflight is best-effort; the render still runs
  }

  const r = await renderDeck(deck, { outDir });
  if (!r.ran) {
    console.error("review: render failed: " + r.reason);
    process.exit(2);
  }
  const pngs = listPngs(outDir);
  const issues = (r.report && r.report.slides ? r.report.slides : []).flatMap((s) =>
    (s.issues || []).map((i) => ({ slide: s.index + 1, type: i.type, detail: i.detail })),
  );

  console.log("=== LOOK AT THESE (vision) ===");
  if (pngs.length) {
    for (const p of pngs) console.log("  " + path.join(outDir, p));
  } else {
    console.log("  (no PNGs — was the render blocked?)");
  }
  console.log(`render: ${issues.length ? issues.length + " issue(s)" : "clean"}`);
  for (const i of issues.slice(0, 20)) {
    console.log(`  slide ${i.slide}: ${i.type.toUpperCase()}: ${i.detail}`);
  }

  // Structural read: same facts the eye gets from the PNGs — background layer,
  // decor position, block/fill inventory, empty band, repeated layouts, unused
  // template art. This is what the model quotes when explaining what it saw.
  if (r.inventory && r.inventory.length) {
    console.log("\n=== WHAT IS ON EACH SLIDE (structural read) ===");
    for (const line of describeDeck({ report: r.report, inventory: r.inventory, deckDir: path.dirname(deck), deckName: path.basename(deck) })) {
      console.log(line);
    }
  }

  if (flag("--reference")) {
    const refDir = path.join(outDir, "reference");
    console.log("\n=== REFERENCE SHOTS (vision) ===");
    try {
      const out = execFileSync(process.execPath, [path.join(__dirname, "shots.cjs"), path.resolve(flag("--reference")), "--out-dir", refDir, "--keep"], {
        encoding: "utf8",
      });
      for (const line of out.split("\n")) if (line.startsWith("slide ")) console.log("  " + line.replace(/^slide \d+: /, ""));
    } catch (e) {
      console.log("  reference shots unavailable: " + String((e.stdout || e.message || e)).trim().split("\n")[0]);
      console.log("  fallback: read-pptx.cjs <template.pptx> --extract-media /tmp/tpl-media and look at the pictures");
    }
  }

  if (!argv.includes("--no-validate")) {
    const pptx = flag("--pptx") || deck.replace(/\.html?$/i, ".pptx");
    console.log("\n=== VALIDATE ===");
    if (fs.existsSync(pptx)) {
      try {
        const v = execFileSync(process.execPath, [path.join(__dirname, "validate.cjs"), pptx], { encoding: "utf8" });
        console.log(v.trim().split("\n").slice(-4).join("\n"));
      } catch (e) {
        const v = String(e.stdout || "").trim();
        console.log(v ? v.split("\n").slice(-8).join("\n") : "validate failed: " + (e.message || e));
      }
    } else {
      console.log("no .pptx yet — run index.cjs deck.html --pptx after the render is clean");
    }
  }

  console.log("\n=== CHECKLIST (answer honestly, fix, repeat) ===");
  for (const line of CHECKLIST) console.log("  " + line);
  console.log(`\nreview dir: ${outDir}`);
}

main().catch((e) => {
  console.error(e.stack || String(e));
  process.exit(3);
});
