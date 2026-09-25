#!/usr/bin/env node
// presentation v2 — check (default) or inline (--inline) local fonts/images.
//
//   ELECTRON_RUN_AS_NODE=1 "$GIGATOOL_NODE" .../assets.cjs deck.html [--inline]
//
// Default is CHECK ONLY: it verifies that every local reference resolves
// (fonts/ → the skill's fonts dir, images/ → next to the deck) and reports
// what is not inlined yet. The authored deck.html stays small and editable —
// the render/export pipeline inlines assets into a TEMP build copy, so data
// URIs never enter the source that the model edits.
//
// --inline bakes the data URIs into deck.html itself; use it only when a
// standalone single-file HTML is explicitly needed (editing it afterwards is
// no longer practical — keep the relative-ref version as the source).
"use strict";

const fs = require("fs");
const path = require("path");
const { isData, isExternal, resolveRef, mimeOf } = require("./refs.cjs");

function inlineAssets(deckPath, opts = {}) {
  const inline = !!opts.inline;
  const check = !inline;
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
  const inline = args.includes("--inline");
  const file = args.filter((a) => !a.startsWith("--"))[0];
  if (!file) {
    console.error("usage: assets.cjs <deck.html> [--inline]");
    process.exit(2);
  }
  const r = inlineAssets(file, { inline, quiet: true });
  for (const m of r.missing) console.error("missing local file: " + m);
  if (r.external) console.error("external reference(s) present (" + r.external + ") — lint-deck blocks them; host locally");
  if (r.missing.length) process.exit(1);
  if (inline) {
    console.log(
      "assets: inlined " + r.inlinedFonts + " font(s), " + r.inlinedImages + " image(s)" +
        (r.already ? ", already inline " + r.already : ""),
    );
    return;
  }
  if (r.pending) {
    console.log("assets: ok — " + r.pending + " local reference(s) stay relative (the builder inlines them into the temp build copy)");
  } else {
    console.log("assets: clean (all local refs resolve)");
  }
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error("assets: " + (e && e.message ? e.message : e));
    process.exit(1);
  }
}

module.exports = { inlineAssets };
