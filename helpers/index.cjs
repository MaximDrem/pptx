#!/usr/bin/env node
// presentation v2 — one-command deck pipeline:
//
//   ELECTRON_RUN_AS_NODE=1 "$GIGATOOL_NODE" "$HOME/.wsc/config/skills/presentation/helpers/index.cjs" \
//     deck.html [--pptx] [--pdf] [--no-png] [--out-dir <dir>]
//
//   1. lint-deck.cjs      static preflight on the authored deck (offline
//                         contract, files, markup, template fidelity)
//   2. render.cjs         builds a TEMP copy (expand-styles + asset inlining),
//                         renders it in Chromium: captures + reports
//   3. --pptx/--pdf       native .pptx (dom-to-pptx) and one-slide-per-page PDF
//   --inline (optional)   bakes styles+assets into deck.html for a standalone
//                         single-file HTML
//
// Exit codes: 0 clean · 1 lint/assets/styles errors · 2 render failed to start ·
// 3 render/export crashed · 4 blocking layout issues — export skipped.
// Non-blocking issues do NOT fail the run: they are lines in stdout to fix.
"use strict";

const { execFileSync } = require("child_process");
const path = require("path");
const { renderDeck } = require("./render.cjs");
const { expandDeck } = require("./expand-styles.cjs");

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const outIdx = argv.indexOf("--out-dir");
  const deck = argv.find((a, i) => !a.startsWith("--") && (outIdx === -1 || i !== outIdx + 1));
  if (!deck) {
    console.error("usage: index.cjs <deck.html> [--pptx] [--pdf] [--no-png] [--out-dir <dir>] [--inline]");
    process.exit(2);
  }
  const absDeck = path.resolve(deck);

  // The authored deck stays untouched: expand-styles and asset inlining run on
  // a TEMP build copy inside renderDeck, so edits never fight data URIs.
  // --inline bakes them into deck.html itself (standalone single-file HTML);
  // keep a relative-ref copy if you plan further edits.
  if (argv.includes("--inline")) {
    try {
      const s = expandDeck(absDeck);
      if (s.expanded) console.log(`styles: expanded "${s.style}" into deck.html (--inline)`);
      const { inlineAssets } = require("./assets.cjs");
      const a = inlineAssets(absDeck, { inline: true, quiet: true });
      console.log(`assets: inlined ${a.inlinedFonts} font(s), ${a.inlinedImages} image(s) into deck.html (--inline)`);
    } catch (e) {
      console.error("index: --inline failed: " + (e && e.message));
      process.exit(1);
    }
  }

  if (!argv.includes("--no-lint")) {
    try {
      execFileSync(process.execPath, [path.join(__dirname, "lint-deck.cjs"), absDeck], { stdio: "inherit", timeout: 120000 });
    } catch (e) {
      console.error("index: lint-deck found blocking errors — fix them and re-run");
      process.exit(1);
    }
  }

  const r = await renderDeck(absDeck, {
    outDir: flag("--out-dir"),
    pptx: argv.includes("--pptx"),
    pdf: argv.includes("--pdf"),
    noPng: argv.includes("--no-png"),
  });
  if (!r.ran) {
    console.error("index: render failed: " + r.reason);
    process.exit(2);
  }
  if (r.kept) console.log("render dir: " + r.outDir);
  process.exit(r.code ?? 3);
}

main().catch((e) => {
  console.error(e.stack || String(e));
  process.exit(3);
});
