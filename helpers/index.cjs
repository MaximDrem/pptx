#!/usr/bin/env node
// presentation v2 — one-command deck pipeline:
//
//   ELECTRON_RUN_AS_NODE=1 "$GIGATOOL_NODE" "$HOME/.wsc/config/skills/presentation/helpers/index.cjs" \
//     deck.html [--pptx] [--pdf] [--no-png] [--out-dir <dir>]
//
//   1. lint-deck.cjs   static preflight (offline contract, files, markup)
//   2. assets.cjs      inline vendored fonts/images so the deck is standalone
//   3. render.cjs      real Chromium render: captures + report.json + inventory.json
//   4. --pptx/--pdf    native .pptx (dom-to-pptx) and one-slide-per-page PDF
//
// Exit codes: 0 clean · 1 lint/assets errors · 2 render failed to start ·
// 3 render/export crashed. Layout issues do NOT fail the run: they are lines
// in stdout for the model to fix.
"use strict";

const { execFileSync } = require("child_process");
const path = require("path");
const { renderDeck } = require("./render.cjs");

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const outIdx = argv.indexOf("--out-dir");
  const deck = argv.find((a, i) => !a.startsWith("--") && (outIdx === -1 || i !== outIdx + 1));
  if (!deck) {
    console.error("usage: index.cjs <deck.html> [--pptx] [--pdf] [--no-png] [--out-dir <dir>]");
    process.exit(2);
  }
  const absDeck = path.resolve(deck);

  if (!argv.includes("--no-lint")) {
    try {
      execFileSync(process.execPath, [path.join(__dirname, "lint-deck.cjs"), absDeck], { stdio: "inherit", timeout: 120000 });
    } catch (e) {
      console.error("index: lint-deck found blocking errors — fix them and re-run");
      process.exit(1);
    }
  }
  try {
    execFileSync(process.execPath, [path.join(__dirname, "assets.cjs"), absDeck], { stdio: "inherit", timeout: 120000 });
  } catch (e) {
    console.error("index: assets.cjs failed — fix missing files or paths and re-run");
    process.exit(1);
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
