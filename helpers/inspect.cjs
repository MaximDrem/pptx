#!/usr/bin/env node
// presentation v3 — inspect.cjs: "what is actually on every slide".
//
//   node inspect.cjs <deck.html> [--slide N] [--detail] [--out-dir <dir>] [--png] [--json <path>] [--no-render]
//
// Vision shows the pixels; this command prints the structure the eye cannot
// measure: per slide the real background layer, decoration and its position,
// headline/lead, blocks (cards/stats/steps/charts), fill colors, anchors,
// empty band, and the probe issues. Then a deck audit: repeated layouts,
// a wall of identical cards, unused template assets (images/template-assets.md),
// zero pictures, missing accents. Same data a developer reads in DevTools.
//
//   inspect.cjs deck.html --slide 4 --detail   # one slide with block geometry
//
// PNGs are NOT captured by default (--png keeps them); the model already has
// review.cjs for the look loop. If the renderer is unavailable (no
// GIGATOOL_NODE), inspect falls back to a static HTML outline instead of
// failing.
"use strict";

const fs = require("fs");
const path = require("path");
const { renderDeck } = require("./render.cjs");
const { describeDeck, PATTERNS } = require("./lib/describe.cjs");

const PATTERN_RE = new RegExp("\\b(" + PATTERNS.join("|") + ")\\b");

function usage() {
  console.error("usage: inspect.cjs <deck.html> [--slide N] [--detail] [--out-dir <dir>] [--png] [--json <path>] [--no-render]");
  process.exit(2);
}

const strip = (s) => String(s || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
const base = (s) => String(s || "").split(/[\\/]/).pop();

// Static outline: works without a browser, so the model is never left blind.
function staticOutline(html, slide) {
  const lines = [];
  const re = /<section\b([^>]*)>([\s\S]*?)<\/section>/gi;
  let m;
  let n = 0;
  while ((m = re.exec(html))) {
    n++;
    if (slide && Number(slide) !== n) continue;
    const attrs = m[1];
    const body = m[2];
    const role = (/(?:^|\s)data-role=(["'])([^"']+)\1/.exec(attrs) || [])[2] || "content";
    const cls = [...body.matchAll(/class=(["'])([^"']*)\1/g)]
      .flatMap((c) => c[2].split(/\s+/))
      .filter((c) => PATTERN_RE.test(c));
    const patterns = [...new Set(cls)];
    const headline = strip((/<h[12][^>]*class=(["'])[^"']*\bheadline\b[^"']*\1[^>]*>([\s\S]*?)<\/h[12]>/i.exec(body) || [])[2]);
    const srcs = [...new Set([...body.matchAll(/src=(["'])([^"']+)\1/g)].map((s) => base(s[2])))];
    const imgs = (body.match(/<img\b/g) || []).length;
    const svgs = (body.match(/<svg\b/g) || []).length;
    lines.push(`slide ${n} [${role}]${headline ? " «" + headline.slice(0, 72) + "»" : ""}`);
    lines.push(`  static: patterns ${patterns.join("+") || "none"} · img ${imgs} · svg ${svgs} · assets ${srcs.join(", ") || "none"}`);
  }
  if (!lines.length && slide) lines.push(`slide ${slide}: not found (deck has ${n})`);
  return lines;
}

function issueLines(report) {
  const slides = Array.isArray(report) ? report : report && report.slides ? report.slides : [];
  const lines = [];
  let errors = 0;
  let suggestions = 0;
  for (const s of slides) {
    for (const i of s.issues || []) {
      const isError = i.severity ? i.severity === "error" : true;
      if (isError) errors++;
      else suggestions++;
      lines.push(`slide ${s.index + 1}: ${isError ? "error" : "suggestion"}: ${String(i.type).toUpperCase()}: ${i.detail}`);
    }
  }
  return { lines, errors, suggestions };
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const deckArg = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && ["--slide", "--out-dir", "--json"].includes(argv[i - 1])));
  if (!deckArg) usage();
  const deck = path.resolve(deckArg);
  if (!fs.existsSync(deck)) {
    console.error("inspect: deck not found: " + deck);
    process.exit(2);
  }
  const html = fs.readFileSync(deck, "utf8");
  const slide = flag("--slide");
  const detail = argv.includes("--detail") || !!slide;

  if (argv.includes("--no-render")) {
    console.log(`render: skipped (--no-render) — static outline only${slide ? `, slide ${slide}` : ""}`);
    const lines = staticOutline(html, slide);
    console.log(lines.join("\n"));
    if (flag("--json")) {
      const file = path.resolve(flag("--json"));
      fs.writeFileSync(file, JSON.stringify({ deck, digest: lines }, null, 2));
      console.log("inspect json: " + file);
    }
    return;
  }

  const outDir = flag("--out-dir");
  const r = await renderDeck(deck, { outDir, noPng: !argv.includes("--png") });
  if (!r.ran || !r.report) {
    console.log(`render: unavailable (${r.reason || `exit ${r.code}`}) — static outline only`);
    const lines = staticOutline(html, slide);
    console.log(lines.join("\n"));
    if (flag("--json")) {
      const file = path.resolve(flag("--json"));
      fs.writeFileSync(file, JSON.stringify({ deck, digest: lines }, null, 2));
      console.log("inspect json: " + file);
    }
    return;
  }
  if (r.outDir) console.log("render dir: " + r.outDir + (argv.includes("--png") ? " (slide-NN.png captured)" : ""));
  const issues = issueLines(r.report);
  if (issues.lines.length) {
    console.log(`=== ISSUES (${issues.errors} error(s), ${issues.suggestions} suggestion(s)) ===`);
    for (const l of issues.lines) console.log("  " + l);
  } else {
    console.log("=== ISSUES: none ===");
  }
  console.log("\n=== WHAT IS ON EACH SLIDE ===");
  const digest = describeDeck({ report: r.report, inventory: r.inventory, deckDir: path.dirname(deck), deckName: path.basename(deck), slide, detail });
  for (const line of digest) console.log(line);
  if (flag("--json")) {
    const file = path.resolve(flag("--json"));
    fs.writeFileSync(file, JSON.stringify({ deck, report: r.report, inventory: r.inventory, digest }, null, 2));
    console.log("\ninspect json: " + file);
  }
  process.exit(0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error("inspect: " + (e && e.message ? e.message : e));
    process.exit(3);
  });
}

module.exports = { staticOutline };
