#!/usr/bin/env node
// presentation v2 — inline local fonts/images into deck.html as data URIs.
//
//   ELECTRON_RUN_AS_NODE=1 "$GIGATOOL_NODE" .../assets.cjs deck.html [--check]
//
// The working folder must contain ONLY the deliverables (deck.html +
// <slug>.pptx). Fonts are referenced as url("fonts/<file>.woff2") — this
// script resolves them against the skill's fonts/ directory and bakes them
// in, so the deck is self-contained for rendering and for the export engine.
// `--check` reports only (exit 1 when something is not inlined yet).
"use strict";

const fs = require("fs");
const path = require("path");
const { isData, isExternal, resolveRef, mimeOf } = require("./refs.cjs");

function inlineAssets(deckPath, opts = {}) {
  const check = !!opts.check;
  const file = path.resolve(deckPath);
  const deckDir = path.dirname(file);
  const html = fs.readFileSync(file, "utf8");
  const result = { changed: false, inlinedFonts: 0, inlinedImages: 0, pending: 0, missing: [], external: 0, already: 0 };

  const dataUriFor = (found) => "data:" + mimeOf(found) + ";base64," + fs.readFileSync(found).toString("base64");

  let out = html.replace(/url\((["']?)([^)"']+)\1\)/g, (m, quote, ref) => {
    const isFont = /\.(woff2?|ttf|otf)$/i.test(ref);
    const isImage = /\.(png|jpe?g|webp|gif|svg)$/i.test(ref);
    if (!isFont && !isImage) return m;
    if (isData(ref)) {
      result.already++;
      return m;
    }
    if (isExternal(ref)) {
      result.external++;
      return m;
    }
    const { found } = resolveRef(deckDir, ref);
    if (!found) {
      result.missing.push(ref);
      return m;
    }
    if (check) {
      result.pending++;
      return m;
    }
    if (isFont) result.inlinedFonts++;
    else result.inlinedImages++;
    return (isFont ? "url(" : "url(") + '"' + dataUriFor(found) + '"' + ")";
  });

  out = out.replace(/(<img\b[^>]*?\bsrc=)(["'])([^"']+)\2/gi, (m, pre, quote, ref) => {
    if (isData(ref)) {
      result.already++;
      return m;
    }
    if (isExternal(ref)) {
      result.external++;
      return m;
    }
    const { found } = resolveRef(deckDir, ref);
    if (!found) {
      result.missing.push(ref);
      return m;
    }
    if (check) {
      result.pending++;
      return m;
    }
    result.inlinedImages++;
    return pre + quote + dataUriFor(found) + quote;
  });

  result.changed = out !== html;
  if (!check && result.changed) fs.writeFileSync(file, out);
  return result;
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const file = args.filter((a) => !a.startsWith("--"))[0];
  if (!file) {
    console.error("usage: assets.cjs <deck.html> [--check]");
    process.exit(2);
  }
  const r = inlineAssets(file, { check });
  for (const m of r.missing) console.error("missing local file: " + m);
  if (r.external) console.error("external reference(s) present (" + r.external + ") — lint-deck blocks them; host locally");
  if (check) {
    if (r.pending || r.missing.length) {
      if (r.pending) console.error("assets: " + r.pending + " reference(s) not inlined — run assets.cjs without --check");
      if (r.missing.length) console.error("assets: " + r.missing.length + " missing local file(s) — fix the paths first");
      process.exit(1);
    }
    console.log("assets: clean (all local refs inlined)");
    return;
  }
  console.log(
    "assets: inlined " + r.inlinedFonts + " font(s), " + r.inlinedImages + " image(s)" +
      (r.already ? ", already inline " + r.already : "") +
      (r.missing.length ? ", MISSING " + r.missing.length : ""),
  );
  if (r.missing.length) process.exit(1);
}

if (require.main === module) main();

module.exports = { inlineAssets };
