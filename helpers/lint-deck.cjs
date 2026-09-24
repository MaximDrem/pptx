// presentation v2 — static preflight for deck.html. No Chromium, no network.
//
//   ELECTRON_RUN_AS_NODE=1 "$GIGATOOL_NODE" .../lint-deck.cjs deck.html
//
// Errors block (offline contract, tool calls that only exist in the chat
// turn, missing local files, invalid slide markup). Warnings inform (fonts or
// images not inlined yet, missing data-role, classes used but not defined in
// the deck's own <style> — the classic source of silently broken layouts).
// Exit 0 clean / 1 errors / 2 usage.
"use strict";

const fs = require("fs");
const path = require("path");
const { isData, isExternal, resolveRef } = require("./refs.cjs");

const SESSION_TOOL_RE = /(?<![.\w])(gigachat_image|text2image|generate_image|image_generation|web_search|websearch)\s*\(/g;

const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

function collectRefs(html) {
  const refs = [];
  const push = (ref, kind) => {
    if (!ref) return;
    const r = ref.trim();
    if (!r || isData(r)) return;
    refs.push({ ref: r, kind });
  };
  let m;
  const urlRe = /url\((["']?)([^)"']+)\1\)/g;
  while ((m = urlRe.exec(html))) push(m[2], "url");
  const imgRe = /<img\b[^>]*?\bsrc=(["'])([^"']+)\1/gi;
  while ((m = imgRe.exec(html))) push(m[2], "img");
  const scriptRe = /<script\b[^>]*?\bsrc=(["'])([^"']+)\1/gi;
  while ((m = scriptRe.exec(html))) push(m[2], "script");
  const linkRe = /<link\b[^>]*?\bhref=(["'])([^"']+)\1/gi;
  while ((m = linkRe.exec(html))) push(m[2], "link");
  return refs;
}

function lintDeck(deckPath, opts = {}) {
  const errors = [];
  const warnings = [];
  const file = path.resolve(deckPath);
  if (!fs.existsSync(file)) return { errors: ["deck.html not found: " + file], warnings, slideCount: 0 };

  const raw = fs.readFileSync(file, "utf8");
  const html = stripComments(raw);
  const deckDir = path.dirname(file);

  // 1. Offline contract.
  const external = new Set();
  let m;
  const httpRe = /(https?:\/\/[^\s"'<>)]+)/g;
  while ((m = httpRe.exec(html))) {
    if (/^https?:\/\/www\.w3\.org\//.test(m[1])) continue; // xmlns
    external.add(m[1]);
  }
  for (const url of external) errors.push("external URL (the deck must work offline): " + url);

  // 2. Session tools are chat-turn only.
  const toolRe = new RegExp(SESSION_TOOL_RE.source, "g");
  while ((m = toolRe.exec(html))) {
    errors.push(
      "session tool `" + m[1] + "(` can only be called from the chat turn — generate the asset in chat first, then put its file path into deck.html",
    );
  }

  // 3. Local references exist; fonts/images must be inlined before render.
  //    Protocol-relative (//host) and file: refs are not caught by httpRe —
  //    report them here so the offline contract has no holes.
  for (const { ref, kind } of collectRefs(html)) {
    if (isExternal(ref)) {
      if (!/^https?:\/\//i.test(ref) && !external.has(ref)) {
        errors.push("external reference (the deck must work offline): " + ref);
      }
      continue;
    }
    const { found, tried } = resolveRef(deckDir, ref);
    if (!found) {
      errors.push("missing local file: " + ref + " (looked at: " + tried.join(", ") + ")");
      continue;
    }
    const isFont = /\.(woff2?|ttf|otf)$/i.test(ref);
    if ((isFont || kind === "img") && kind !== "script") {
      warnings.push((isFont ? "font" : "image") + " not inlined: " + ref + " — run `assets.cjs deck.html`");
    }
  }

  // 4. Structure.
  const slideTags = raw.match(/<section\b[^>]*\bclass=(["'])[^"']*\bslide\b[^"']*\1[^>]*>/gi) || [];
  if (slideTags.length === 0) errors.push('no <section class="slide"> found — the deck must contain at least one slide');
  for (const tag of slideTags) {
    if (!/\bdata-role=/.test(tag)) warnings.push("slide without data-role (cover|section|content|quote|closing) — layout checks get weaker: " + tag.slice(0, 80));
  }
  if (!/deck-stage/.test(raw) || !/deck-viewport/.test(raw)) {
    warnings.push("stage markers (.deck-stage/.deck-viewport) not found — paste stage.css into the <style> block");
  }
  const styleBlocks = raw.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || [];
  if (styleBlocks.length === 0) warnings.push("no <style> block — stage.css, tokens and base.css must be pasted into the deck");

  // 5. Class pre-flight: a class used in markup but never defined silently
  // falls back to defaults — the number-one source of broken layouts.
  const defined = new Set();
  for (const block of styleBlocks) {
    const css = block
      .replace(/^<style[^>]*>/i, "")
      .replace(/<\/style>$/i, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    let cm;
    const re = /\.(-?[A-Za-z_][\w-]*)/g;
    while ((cm = re.exec(css))) defined.add(cm[1]);
  }
  const used = new Set();
  let um;
  const classRe = /\bclass=(["'])([^"']+)\1/g;
  while ((um = classRe.exec(html))) {
    for (const token of um[2].split(/\s+/)) if (token) used.add(token);
  }
  const ignored = new Set(["lucide"]);
  const unknown = Array.from(used).filter((c) => !defined.has(c) && !ignored.has(c));
  if (unknown.length && styleBlocks.length) {
    warnings.push(
      "class(es) used but not defined in the deck's <style> (silent fallback — typo or missing paste): " +
        unknown.slice(0, 12).join(", ") +
        (unknown.length > 12 ? ` … +${unknown.length - 12}` : ""),
    );
  }

  if (!opts.quiet) {
    for (const e of errors) console.error("error: " + e);
    for (const w of warnings) console.warn("warning: " + w);
  }
  return { errors, warnings, slideCount: slideTags.length };
}

function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!args.length) {
    console.error("usage: lint-deck.cjs <deck.html>");
    process.exit(2);
  }
  const r = lintDeck(args[0]);
  if (r.errors.length) process.exit(1);
  console.log("lint: clean (" + (r.slideCount || 0) + " slide(s), " + r.warnings.length + " warning(s))");
}

if (require.main === module) main();

module.exports = { lintDeck };
