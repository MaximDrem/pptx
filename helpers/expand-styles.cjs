#!/usr/bin/env node
// presentation v2 — expand the deck's managed style block into canonical CSS.
//
//   node expand-styles.cjs deck.html
//
// A deck declares one managed block:
//
//   <style data-presentation-style="signal-night"></style>
//
// and this helper replaces its content in place with the skill's canonical
// CSS: stage.css + fonts/fonts.css + tokens.css + styles/_base.css.
//
// Why: the old workflow told the model to copy ~900 lines of vendored CSS
// into deck.html by hand. Weak models skipped that, wrote their own layout
// (display:none slides, no stage contract) and the export silently dropped
// the slides. Now the model writes only slide markup and names a style.
//
// The attribute stays on the tag: every run refreshes the managed block from
// the current skill files, so skill updates propagate. Deck-authored <style>
// blocks (without the attribute) are never touched. Runs without the marker
// are a no-op (back-compat).
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const SKILL = path.join(__dirname, "..");
const STYLES_DIR = path.join(os.homedir(), ".wsc", "config", "styles");

function read(file) {
  return fs.readFileSync(path.join(SKILL, file), "utf8");
}

function builtinStyles() {
  try {
    const idx = JSON.parse(read("styles/index.json"));
    return (idx.styles || []).map((s) => s.id);
  } catch {
    return [];
  }
}

function profileStyles() {
  try {
    return fs
      .readdirSync(STYLES_DIR)
      .filter((d) => fs.existsSync(path.join(STYLES_DIR, d, "tokens.css")));
  } catch {
    return [];
  }
}

function resolveTokens(style) {
  const name = String(style || "").trim();
  if (!name) throw new Error(`empty data-presentation-style; use one of: ${builtinStyles().join(", ")}`);
  if (name.startsWith("profile:")) {
    const slug = name.slice("profile:".length).trim();
    const file = path.join(STYLES_DIR, slug, "tokens.css");
    if (!slug || !fs.existsSync(file)) {
      const found = profileStyles();
      throw new Error(`style profile "${slug}" not found in ${STYLES_DIR}${found.length ? ` (found: ${found.join(", ")})` : ""}`);
    }
    return { label: name, css: fs.readFileSync(file, "utf8") };
  }
  const file = path.join(SKILL, "styles", name, "tokens.css");
  if (!fs.existsSync(file)) {
    const found = builtinStyles();
    throw new Error(`unknown built-in style "${name}"; use one of: ${found.join(", ")}, or profile:<slug>`);
  }
  return { label: name, css: fs.readFileSync(file, "utf8") };
}

// Replace the content of the managed block. Returns true when a block exists.
function expandInHtml(html, tokens) {
  const openRe = /<style\b[^>]*\bdata-presentation-style=(["'])([^"']*)\1[^>]*>/i;
  const m = openRe.exec(html);
  if (!m) return { changed: false, html };
  const openEnd = m.index + m[0].length;
  const close = html.indexOf("</style>", openEnd);
  if (close === -1) throw new Error("managed <style> block is not closed");
  const css = [
    "/* ===== presentation-v2: stage.css (managed, do not edit) ===== */",
    read("stage.css"),
    "/* ===== presentation-v2: fonts/fonts.css (managed) ===== */",
    read("fonts/fonts.css"),
    `/* ===== presentation-v2: tokens (${tokens.label}) ===== */`,
    tokens.css,
    "/* ===== presentation-v2: styles/_base.css (managed) ===== */",
    read("styles/_base.css"),
  ].join("\n");
  return { changed: true, style: m[2], html: html.slice(0, openEnd) + "\n" + css + "\n" + html.slice(close) };
}

function expandDeck(file) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error("deck not found: " + abs);
  const html = fs.readFileSync(abs, "utf8");
  const m = /<style\b[^>]*\bdata-presentation-style=(["'])([^"']*)\1[^>]*>/i.exec(html);
  if (!m) return { expanded: false, style: null, file: abs };
  const tokens = resolveTokens(m[2]);
  const out = expandInHtml(html, tokens);
  fs.writeFileSync(abs, out.html);
  return { expanded: true, style: tokens.label, file: abs };
}

function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const file = args[0];
  if (!file) {
    console.error("usage: expand-styles.cjs <deck.html>");
    process.exit(2);
  }
  try {
    const r = expandDeck(file);
    if (!r.expanded) {
      console.log("styles: no managed style block (deck.css already inlined) — nothing to expand");
    } else {
      console.log(`styles: expanded "${r.style}" into ${path.basename(r.file)} (${Math.round(fs.statSync(r.file).size / 1024)}KB)`);
    }
  } catch (e) {
    console.error("styles: " + (e && e.message));
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { expandDeck, expandInHtml, resolveTokens };
