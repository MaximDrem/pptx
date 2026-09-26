#!/usr/bin/env node
// presentation v3 — the self-reflection driver.
//
//   node review.cjs <deck.html> [--reference <template.pptx>] [--out-dir <dir>] [--no-validate]
//
// One command for the whole look-and-fix loop: renders the deck, prints the
// paths of the slide PNGs to LOOK at (only the captures of THIS render — the
// out-dir is cleaned first), lists probe issues with their severity, prints the
// structural read, runs the artifact validator (if a .pptx newer than
// deck.html exists) and prints the review checklist.
//
// Exit: 0 clean · 4 blocking findings (fix, then re-run) · 2 render could not
// start · 3 render failed/no report. The loop is: review → look → fix → review
// … until render is clean AND the eyes say OK, then export.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { renderDeck, BLOCKING_TYPES } = require("./render.cjs");
const { describeDeck } = require("./lib/describe.cjs");

const VALUE_FLAGS = new Set(["--out-dir", "--reference"]);

const CHECKLIST = [
  "1. Nothing clipped, overlapping or half-empty — compare with the probe lines above.",
  "2. The style is the SAME on every slide (no random flat-color slides, one palette).",
  "3. Cover/sections: cover-art glow and decor are in place; the logo sits in its corner;",
  "   branding lockups are not repeated and never placed over the logo.",
  "4. Every content slide has a visual anchor: icon, chart, big number or photo.",
  "5. Template mode: put the matching reference shot next to your slide (same family?),",
  "   and follow the manifest's Layout recipe — vary decor coordinates and box styles",
  "   (.card/.deep/.tint/.ghost) the way the original does, no identical square wall.",
  "5b. Density: your slides carry roughly as much as the template's (see the density",
  "    lines above) — a copy at a third of its boxes/photos reads empty, and empty",
  "    space is not minimalism.",
  "6. Nothing reads as generic AI slop: no bars under titles, no wall of identical cards,",
  "   no centered body copy, no emoji, no stretched decor used as a background.",
  "7. No plan-language labels on slides: kickers/captions/footers say what the slide IS",
  "   ABOUT (a fact, a number, a domain term) — «проблема», «сценарий», «возможности»,",
  "   «преимущества» are words from your plan, not slide content.",
];

function listPngs(dir) {
  try {
    return fs
      .readdirSync(dir)
      .map((f) => ({ f, n: Number((/^slide-(\d+)\.png$/i.exec(f) || [])[1]) }))
      .filter((x) => Number.isFinite(x.n))
      .sort((a, b) => a.n - b.n)
      .map((x) => x.f);
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
  const deckArg = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && VALUE_FLAGS.has(argv[i - 1])));
  if (!deckArg) {
    console.error("usage: review.cjs <deck.html> [--reference <template.pptx>] [--out-dir <dir>] [--no-validate]");
    process.exit(2);
  }
  const deck = path.resolve(deckArg);
  const outDir = path.resolve(flag("--out-dir") || path.join(process.cwd(), "deck-check"));

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
      const deckDir = path.dirname(path.resolve(deck));
      console.error(`the deck is ${path.resolve(deck)} — its files must exist under ${deckDir}/images/`);
      console.error(`if the assets are elsewhere, redeploy them INTO the deck's folder: style-profile.cjs <template.pptx> --name "…" --deploy "${deckDir}"`);
      console.error("do not move the deck to the files, do not copy folders to temp — the deck stays where it is");
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
  const report = Array.isArray(r.report) ? r.report : r.report && Array.isArray(r.report.slides) ? r.report.slides : null;
  if (!report) {
    // A crash mid-capture can leave a few PNGs from the failed attempt: they
    // are not the deck, do not let the model reason from them.
    console.error(`review: render FAILED (exit ${r.code ?? "?"}) — no report.json${r.reason ? " (" + r.reason + ")" : ""}`);
    console.error("review: do not act on partial pictures above; fix the HTML (slide.cjs --get N → edit → --set N, or one full rewrite), then run review once.");
    process.exit(r.code && r.code > 0 ? r.code : 3);
  }
  const issues = report.flatMap((s) =>
    (s.issues || []).map((i) => ({ slide: s.index + 1, type: i.type, detail: i.detail, severity: i.severity })),
  );
  const isBlocking = (i) => (i.severity ? i.severity === "error" : BLOCKING_TYPES.has(i.type));
  const blocking = issues.filter(isBlocking);
  const pngs = listPngs(outDir);

  console.log("=== LOOK AT THESE (vision) ===");
  if (pngs.length) {
    for (const p of pngs) console.log("  " + path.join(outDir, p));
  } else {
    console.log("  (no PNGs — was the render blocked?)");
  }
  console.log(
    `render: ${issues.length ? issues.length + " issue(s)" : "clean"}` +
      (blocking.length ? ` — ${blocking.length} BLOCKING` : "") +
      (issues.length - blocking.length ? `, ${issues.length - blocking.length} suggestion(s)` : ""),
  );
  for (const i of issues.slice(0, 20)) {
    console.log(`  slide ${i.slide}: ${isBlocking(i) ? "error" : "suggestion"}: ${i.type.toUpperCase()}: ${i.detail}`);
  }
  if (blocking.length) {
    console.log(
      `\nACTION: fix the ${blocking.length} blocking error(s) above in deck.html ` +
        `(slide.cjs deck.html --get N → edit the fragment → slide.cjs deck.html --set N --from deck-check/slide-N.html; ` +
        `or rewrite the whole file in ONE write call), then run review once. ` +
        `Do not re-run review without changing deck.html — the same errors come back and the run stalls. ` +
        `If the same blocker survived two honest repairs, deliver with index.cjs deck.html --pptx --force and state the remaining defect.`,
    );
  }

  // Static lint, printed once from the same run (it used to spawn a child and
  // echo every line twice). It is advisory: errors here are contract breaks
  // (offline, missing files, box markup that corrupts the export) — the rest
  // is judgement the agent applies to its own deck.
  console.log("\n=== STATIC LINT ===");
  let lintCount = 0;
  try {
    const { lintDeck } = require("./lint-deck.cjs");
    const r = lintDeck(deck, { quiet: true });
    lintCount = r.errors.length + r.warnings.length;
    for (const e of r.errors.slice(0, 6)) console.log("  error: " + e);
    if (r.errors.length > 6) console.log(`  … +${r.errors.length - 6} more error(s)`);
    for (const w of r.warnings.slice(0, 6)) console.log("  warning: " + w);
    if (r.warnings.length > 6) console.log(`  … +${r.warnings.length - 6} more warning(s)`);
    if (!r.errors.length && !r.warnings.length) console.log("  clean");
  } catch (e) {
    console.log("  lint failed: " + (e.message || e));
  }
  if (lintCount > 0) {
    // A real run died exactly here: the model read the warnings, tried the
    // string-edit tool, hit "Could not find oldString" three times, the
    // runtime stopped it for the repeated call — and it handed the job to
    // the user. Print the recovery path AT the point of failure.
    console.log(
      `\nFIX PATH: apply these with slide.cjs deck.html --get N → edit the fragment → slide.cjs deck.html --set N --from deck-check/slide-N.html, ` +
        `or rewrite the WHOLE deck.html in one write call (always works). ` +
        `The string-edit tool is the wrong instrument on deck markup (its anchors repeat on every slide by design): if it failed once, do NOT retry it with the same anchor and never explain the edit to the user instead of making it.`,
    );
  }

  // Structural read: same facts the eye gets from the PNGs — background layer,
  // decor position, block/fill inventory, empty band, unused template art.
  if (Array.isArray(r.inventory) && r.inventory.length) {
    console.log("\n=== WHAT IS ON EACH SLIDE (structural read) ===");
    for (const line of describeDeck({ report, inventory: r.inventory, deckDir: path.dirname(deck), deckName: path.basename(deck) })) {
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
      // Density as FACTS only (like thumbnail.py's grid): the template's
      // average and the deck's average side by side. Whether "much lower"
      // is a defect is the agent's judgment against the reference shots
      // (SKILL §1B.6 + checklist 5b) — a <60% threshold here was tried and
      // rejected as a taste gate in numeric clothing.
      const tplDensity = (out.split("\n").find((l) => /^density: /.test(l)) || "").trim();
      const inv = Array.isArray(r.inventory) ? r.inventory : [];
      const m = /averages ([\d.]+) filled boxes \+ ([\d.]+)/.exec(tplDensity);
      if (m && inv.length) {
        const per = inv.map((s) =>
          (s.blocks?.length || 0) + (s.elements || []).filter((e) => e.src && !/\bbg-img\b/.test(String(e.cls || ""))).length,
        );
        const deckAvg = per.reduce((a, b) => a + b, 0) / per.length;
        const tplAvg = Number(m[1]) + Number(m[2]);
        console.log(`  ${tplDensity}`);
        console.log(`  density: your deck averages ${Math.round(deckAvg * 10) / 10} visual block(s) per slide vs the template's ${Math.round(tplAvg * 10) / 10}`);
      }
    } catch (e) {
      console.log("  reference shots unavailable: " + String((e.stdout || e.message || e)).trim().split("\n")[0]);
      console.log("  fallback: read-pptx.cjs <template.pptx> --extract-media tpl-media and look at the pictures");
    }
  }

  if (!argv.includes("--no-validate")) {
    const pptx = deck.replace(/\.html?$/i, ".pptx");
    console.log("\n=== VALIDATE ===");
    if (fs.existsSync(pptx)) {
      // Only validate an artifact built from THIS deck.html: a stale .pptx is
      // worse than none (the model thinks the current HTML was checked).
      let stale = false;
      try {
        stale = fs.statSync(pptx).mtimeMs < fs.statSync(deck).mtimeMs;
      } catch {}
      if (stale) {
        console.log("the .pptx next to the deck is OLDER than deck.html — rebuild with index.cjs deck.html --pptx before validating");
      } else {
        try {
          const v = execFileSync(process.execPath, [path.join(__dirname, "validate.cjs"), pptx], { encoding: "utf8" });
          console.log(v.trim().split("\n").slice(-4).join("\n"));
        } catch (e) {
          const v = String(e.stdout || "").trim();
          console.log(v ? v.split("\n").slice(-8).join("\n") : "validate failed: " + (e.message || e));
        }
      }
    } else {
      console.log("no .pptx yet — run index.cjs deck.html --pptx after the render is clean");
    }
  }

  console.log("\n=== CHECKLIST (answer honestly, fix, repeat) ===");
  for (const line of CHECKLIST) console.log("  " + line);
  console.log(`\nreview dir: ${outDir}`);
  process.exit(blocking.length ? 4 : 0);
}

main().catch((e) => {
  console.error(e.stack || String(e));
  process.exit(3);
});
