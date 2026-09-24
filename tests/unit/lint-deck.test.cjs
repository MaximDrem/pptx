#!/usr/bin/env node
// Unit test: lint-deck.cjs offline contract — protocol-relative and file: refs
// must be errors (http(s) was the only pattern before), the removed
// GIGATOOL_DECK_LINT=0 bypass must not disable the checker, missing local
// files and undefined classes keep working.
//
//   node tests/unit/lint-deck.test.cjs
"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");
const assert = require("assert");
const { lintDeck } = require(path.join(__dirname, "..", "..", "helpers", "lint-deck.cjs"));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "presentation-v2-lint-test-"));
const file = path.join(dir, "lint.deck.html");
fs.writeFileSync(
  file,
  `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>lint fixture</title>
<style>.slide { color: red; }</style></head>
<body><div class="deck-viewport"><div class="deck-stage" id="deck-stage">
  <section class="slide bogus" data-role="content">
    <img src="//evil.example/x.png" alt="">
    <img src="file:/etc/passwd" alt="">
    <img src="https://cdn.example/y.png" alt="">
    <img src="nope.png" alt="">
  </section>
</div></div></body></html>`,
);

const res = lintDeck(file, { quiet: true });
const errors = res.errors.join("\n");
assert.ok(errors.includes("inside a temp directory"), "a deck in a temp dir must be an error (the user will not see it)");
assert.ok(errors.includes("//evil.example/x.png"), "protocol-relative ref must be an error");
assert.ok(errors.includes("file:/etc/passwd"), "file: ref must be an error");
assert.ok(errors.includes("https://cdn.example/y.png"), "http(s) ref must stay an error");
assert.ok(errors.includes("missing local file: nope.png"), "missing local file must stay an error");

const warnings = res.warnings.join("\n");
assert.ok(warnings.includes("bogus"), "undefined class must stay a warning");

// The env bypass was removed: setting it must not silence the checker.
process.env.GIGATOOL_DECK_LINT = "0";
const bypass = lintDeck(file, { quiet: true });
delete process.env.GIGATOOL_DECK_LINT;
assert.ok(bypass.errors.length > 0, "GIGATOOL_DECK_LINT=0 must not disable lint anymore");

console.log("PASS  lint-deck: //host и file: ловятся, bypass удалён");
