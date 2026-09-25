#!/usr/bin/env node
// presentation v3 — slide.cjs: reliable per-slide edits without oldString.
//
//   node slide.cjs deck.html --list
//   node slide.cjs deck.html --get 3
//   node slide.cjs deck.html --set 3  --from deck-check/slide-3.html
//   node slide.cjs deck.html --append --from deck-check/slide-11.html
//   node slide.cjs deck.html --set 3  --from -        (fragment on stdin)
//
// WHY THIS EXISTS: deck.html is one file where the slide opening, logo and
// decor markup repeat on every slide, so the generic edit tool's oldString is
// ambiguous BY DESIGN. Real runs burned whole turns on "Found multiple
// matches for oldString" / "Could not find oldString" while trying to add a
// background or a footer slide by slide. This helper replaces the Nth
// <section>…</section> exactly, without any matching: get the fragment, edit
// it with the write tool, put it back. The rest of the file stays
// byte-identical.
//
// Exit: 0 ok · 2 bad args / deck or index missing · 3 fragment is not exactly
// one <section>…</section>.
"use strict";

const fs = require("fs");
const path = require("path");

const SECTION_RE = /<section\b[^>]*>[\s\S]*?<\/section>/gi;
const VALUE_FLAGS = new Set(["--get", "--set", "--from"]);

function usage() {
  console.error("usage: slide.cjs <deck.html> --list | --get N | --set N --from <file|-> | --append --from <file|->");
  process.exit(2);
}

function sectionsOf(html) {
  const out = [];
  SECTION_RE.lastIndex = 0;
  let m;
  while ((m = SECTION_RE.exec(html))) out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}

function meta(section) {
  const attrs = (/<section\b([^>]*)>/i.exec(section.text) || ["", ""])[1];
  const role = (/(?:^|\s)data-role=(["'])([^"']+)\1/.exec(attrs) || [])[2] || "content";
  const h = /<h[12][^>]*class=(["'])[^"']*\bheadline\b[^"']*\1[^>]*>([\s\S]*?)<\/h[12]>/i.exec(section.text);
  const title = h ? h[2].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 60) : "";
  return { role, title };
}

function readFragment(src) {
  let text;
  try {
    text = src === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(path.resolve(src), "utf8");
  } catch (e) {
    console.error("slide: cannot read the new slide fragment: " + (e && e.message));
    process.exit(2);
  }
  const t = text.trim();
  SECTION_RE.lastIndex = 0;
  const m = SECTION_RE.exec(t);
  if (!m || m.index !== 0 || m[0].length !== t.length) {
    console.error(
      "slide: the new slide must be exactly one <section>…</section> fragment (no text/comment outside); got " + t.length + " bytes",
    );
    process.exit(3);
  }
  return t + "\n";
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const file = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && VALUE_FLAGS.has(argv[i - 1])));
  if (!file) usage();
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) {
    console.error("slide: deck not found: " + abs);
    process.exit(2);
  }
  let html;
  try {
    html = fs.readFileSync(abs, "utf8");
  } catch (e) {
    console.error("slide: cannot read " + abs + ": " + (e && e.code ? e.code : e && e.message));
    process.exit(2);
  }
  const secs = sectionsOf(html);
  if (!secs.length) {
    console.error("slide: no <section> found in " + abs);
    process.exit(3);
  }

  if (argv.includes("--list")) {
    for (let i = 0; i < secs.length; i++) {
      const m = meta(secs[i]);
      console.log(`slide ${i + 1}/${secs.length} [${m.role}]${m.title ? " «" + m.title + "»" : ""} (${Buffer.byteLength(secs[i].text)} bytes)`);
    }
    return;
  }

  if (argv.includes("--get")) {
    const n = Number(flag("--get"));
    if (!Number.isInteger(n) || n < 1 || n > secs.length) {
      console.error(`slide: --get N out of range (deck has ${secs.length} slide(s))`);
      process.exit(2);
    }
    process.stdout.write(secs[n - 1].text + "\n");
    return;
  }

  if (argv.includes("--set")) {
    const from = flag("--from");
    if (!from) usage();
    const n = Number(flag("--set"));
    if (!Number.isInteger(n) || n < 1 || n > secs.length) {
      console.error(`slide: --set N out of range (deck has ${secs.length} slide(s))`);
      process.exit(2);
    }
    const frag = readFragment(from);
    const s = secs[n - 1];
    fs.writeFileSync(abs, html.slice(0, s.start) + frag.trimEnd() + html.slice(s.end));
    console.log(`slide ${n}: replaced (${s.text.length} → ${frag.trimEnd().length} bytes); ${secs.length} slide(s) total`);
    return;
  }

  if (argv.includes("--append")) {
    const from = flag("--from");
    if (!from) usage();
    const frag = readFragment(from);
    const at = secs[secs.length - 1].end;
    fs.writeFileSync(abs, html.slice(0, at) + "\n" + frag.trimEnd() + html.slice(at));
    console.log(`slide ${secs.length + 1}: appended (${frag.trimEnd().length} bytes); ${secs.length + 1} slide(s) total`);
    return;
  }

  usage();
}

if (require.main === module) {
  main();
}

module.exports = { sectionsOf };
