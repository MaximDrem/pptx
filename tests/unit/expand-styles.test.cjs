#!/usr/bin/env node
// Unit test: expand-styles.cjs installs the canonical CSS into the managed
// <style data-presentation-style="…"> block, keeps deck-authored CSS, is
// idempotent and fails loudly on an unknown style.
//
//   node tests/unit/expand-styles.test.cjs
"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");
const assert = require("assert");
const { expandDeck } = require(path.join(__dirname, "..", "..", "helpers", "expand-styles.cjs"));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "presentation-v2-expand-test-"));
const deck = path.join(dir, "expand.deck.html");
fs.writeFileSync(
  deck,
  `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>t</title>
<style data-presentation-style="signal-night"></style>
<style>.mine { color: red; }</style>
</head><body><div class="deck-viewport"><div class="deck-stage" id="deck-stage">
<section class="slide cover" data-role="cover"><div class="slide-pad"><h1 class="headline xl">T</h1></div></section>
</div></div></body></html>`,
);

const r = expandDeck(deck);
assert.strictEqual(r.expanded, true, "a deck with the marker must be expanded");
const out = fs.readFileSync(deck, "utf8");
assert.ok(out.includes("presentation-v2: stage.css"), "stage.css must be installed");
assert.ok(out.includes(".deck-viewport"), "stage.css content must be present");
assert.ok(out.includes("--c-accent"), "signal-night tokens must be installed");
assert.ok(out.includes(".card-stack"), "_base.css must be installed");
assert.ok(out.includes(".mine"), "deck-authored CSS must be preserved");
assert.ok(out.includes('data-presentation-style="signal-night"'), "the marker attribute stays for later refreshes");

// Idempotent: the second run produces identical bytes (safe to re-run).
const first = fs.readFileSync(deck, "utf8");
expandDeck(deck);
assert.strictEqual(fs.readFileSync(deck, "utf8"), first, "second expansion must be byte-identical");

// A deck without the marker is untouched (back-compat).
const plain = path.join(dir, "plain.deck.html");
fs.writeFileSync(plain, "<html><head><style>.x{}</style></head><body></body></html>");
const before = fs.readFileSync(plain, "utf8");
assert.strictEqual(expandDeck(plain).expanded, false, "no marker → no-op");
assert.strictEqual(fs.readFileSync(plain, "utf8"), before, "no-marker deck must not change");

// Unknown style: fail loudly, do not touch the file.
const bad = path.join(dir, "bad.deck.html");
fs.writeFileSync(bad, '<style data-presentation-style="no-such-style"></style>');
const badBefore = fs.readFileSync(bad, "utf8");
assert.throws(() => expandDeck(bad), /unknown built-in style/, "unknown style must throw");
assert.strictEqual(fs.readFileSync(bad, "utf8"), badBefore, "failed expansion must not rewrite the file");

console.log("PASS  expand-styles: канонический CSS ставится, свой CSS сохраняется, повтор идемпотентен");
