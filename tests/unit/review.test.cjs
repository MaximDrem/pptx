#!/usr/bin/env node
// Unit test: review.cjs (the render → look → fix driver) — with a stub
// renderer it must print the slide PNG paths to look at, the render status,
// the checklist and the validate hint for a deck without a .pptx.
//
//   node tests/unit/review.test.cjs
"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");
const assert = require("assert");
const { execFileSync } = require("child_process");

const SKILL = path.join(__dirname, "..", "..");

const STUB = `"use strict";
const fs = require("fs");
const path = require("path");
const argv = process.argv.slice(2);
const flag = (n) => argv[argv.indexOf(n) + 1];
const deck = argv[argv.indexOf("--deck-render") + 1];
const out = flag("--out-dir");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify({
  file: deck,
  slideCount: 2,
  fontsMissing: [],
  slides: [
    { index: 0, issues: [{ type: "no-accent", detail: "no emphasis accent on this slide" }] },
    { index: 1, issues: [] },
  ],
}));
fs.writeFileSync(path.join(out, "inventory.json"), JSON.stringify({ slides: [] }));
fs.writeFileSync(path.join(out, "slide-01.png"), "not-a-real-png");
fs.writeFileSync(path.join(out, "slide-02.png"), "not-a-real-png");
console.log("render: 1 issue(s)");
`;

function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "presentation-v3-review-test-"));
  const stub = path.join(dir, "stub-render.cjs");
  fs.writeFileSync(stub, STUB);
  const deck = path.join(dir, "review.deck.html");
  fs.writeFileSync(deck, "<!doctype html><html><body></body></html>");
  const outDir = path.join(dir, "review-out");

  const env = {
    ...process.env,
    GIGATOOL_NODE: process.execPath,
    GIGATOOL_APP_PATH: stub,
  };
  const out = execFileSync(process.execPath, [path.join(SKILL, "helpers", "review.cjs"), deck, "--out-dir", outDir], {
    encoding: "utf8",
    env,
  });

  assert.ok(out.includes("=== LOOK AT THESE (vision) ==="), "must print the vision header");
  assert.ok(out.includes(path.join(outDir, "slide-01.png")) && out.includes(path.join(outDir, "slide-02.png")), "must list both slide PNGs");
  assert.ok(/render: 1 issue\(s\)/.test(out), "must report the issue count");
  assert.ok(/slide 1: (suggestion|error): NO-ACCENT|slide 1: NO-ACCENT/.test(out), "must list probe issues with slide numbers");
  assert.ok(out.includes("no .pptx yet"), "without a .pptx it must point at index.cjs --pptx");
  assert.ok(out.includes("=== CHECKLIST"), "must print the review checklist");
  assert.ok(out.includes("template") || out.includes("Template"), "checklist must mention template comparison");

  // --no-validate silences the validate section.
  const out2 = execFileSync(process.execPath, [path.join(SKILL, "helpers", "review.cjs"), deck, "--out-dir", outDir, "--no-validate"], {
    encoding: "utf8",
    env,
  });
  assert.ok(!out2.includes("=== VALIDATE ==="), "--no-validate must skip the validate step");

  console.log("PASS  review: пакет для саморефлексии (PNG-пути, probe, чек-лист) формируется");
}

main();
