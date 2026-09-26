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

// Template fidelity is NOT linted (v68): the reference skill validates schema
// only; fidelity lives in the workflow (plan-slide mapping, reference shots,
// the agent's eyes). Fidelity warnings were tried and cut — they re-derived
// taste after the fact. The managed-style contract is still linted.
{
  const stylesDir = fs.mkdtempSync(path.join(os.tmpdir(), "presentation-v3-styles-"));
  const profileDir = path.join(stylesDir, "brand");
  fs.mkdirSync(path.join(profileDir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(profileDir, "assets", "bg.png"), "not-a-real-png");
  fs.writeFileSync(path.join(profileDir, "profile.json"), JSON.stringify({ media: { extracted: [{ name: "bg.png", role: "background" }] } }));
  const deck = path.join(dir, "template.deck.html");
  fs.writeFileSync(
    deck,
    `<!doctype html><html><head>
<style data-presentation-style="profile:brand"></style>
<style>.slide { color: red; }</style>
</head><body><div class="deck-viewport"><div class="deck-stage" id="deck-stage">
<section class="slide" data-role="content"><div class="slide-pad">Только текст, ни одного ассета</div></section>
</div></div></body></html>`,
  );
  process.env.PRESENTATION_STYLES_DIR = stylesDir;
  const res = lintDeck(deck, { quiet: true });
  const out = res.warnings.join("\n") + res.errors.join("\n");
  assert.ok(!out.includes("template profile"), "fidelity gaps must NOT be linted (workflow + eyes own them)");
  assert.ok(!out.includes("has assets but the deck uses none"), "asset usage is not a lint finding");
  assert.ok(!out.includes("image background but the deck has none"), "background usage is not a lint finding");
  // The managed style block contract still fires for profile decks.
  fs.writeFileSync(deck, fs.readFileSync(deck, "utf8").replace('<style data-presentation-style="profile:brand"></style>', '<style data-presentation-style="profile:brand">.x{color:red}</style>'));
  const managed = lintDeck(deck, { quiet: true });
  delete process.env.PRESENTATION_STYLES_DIR;
  assert.ok(managed.warnings.join("\n").includes("data-presentation-style"), "CSS pasted into the managed block must still warn");
}

// Malformed deck: an unclosed <section> must be a clear error, not a render crash.
{
  const bad = path.join(dir, "broken.deck.html");
  fs.writeFileSync(
    bad,
    '<!doctype html><html><head><style>.slide { color: red; }</style></head><body><div class="deck-viewport"><div class="deck-stage" id="deck-stage">' +
      '<section class="slide" data-role="content"><div class="slide-pad">без закрывающего тега</div></div></div></body></html>',
  );
  const res = lintDeck(bad, { quiet: true });
  assert.ok(res.errors.join("\n").includes("unbalanced <section>"), "unclosed section must be an error");
}

// Raw HTML slides (no patterns) and URLs get precise errors; emails are fine.
{
  const rawDeck = path.join(dir, "raw.deck.html");
  fs.writeFileSync(
    rawDeck,
    `<!doctype html><html><head><style>.slide { color: red; }</style></head><body>
<div class="deck-viewport"><div class="deck-stage" id="deck-stage">
<section class="slide" data-role="content"><div class="slide-pad">
  <h2>Сырой заголовок</h2><p>Просто текст и <a href="http://example.com">ссылка</a>.</p>
  <ul><li>пункт</li></ul><p>Почта support@example.com — это нормально.</p>
</div></section>
</div></div></body></html>`,
  );
  const res = lintDeck(rawDeck, { quiet: true });
  const errs = res.errors.join("\n");
  const warns = res.warnings.join("\n");
  assert.ok(warns.includes("no block from patterns.md"), "raw paragraphs must be reported (as advice)");
  assert.ok(errs.includes("external URL on slide 1: http://example.com"), "the URL error must name the slide");
  assert.ok(!errs.includes("support@example.com"), "a plain-text email is allowed offline");
}

// Raw block tags inside a pattern box break the export shape merge — hard error.
{
  const cardDeck = path.join(dir, "raw-card.deck.html");
  fs.writeFileSync(
    cardDeck,
    `<!doctype html><html><head><style>.slide { color: red; }</style></head><body>
<div class="deck-viewport"><div class="deck-stage" id="deck-stage">
<section class="slide" data-role="content"><div class="slide-pad">
  <div class="headline">Т</div>
  <div class="content"><div class="card"><h3>Заголовок</h3><p>Текст</p></div></div>
  <div class="footer"><span>1</span></div>
</div></section>
</div></div></body></html>`,
  );
  const res = lintDeck(cardDeck, { quiet: true });
  assert.ok(res.errors.join("\n").includes("raw <h3> inside .card"), "raw tags inside a box must be an error");
  fs.writeFileSync(cardDeck, fs.readFileSync(cardDeck, "utf8").replace("<h3>Заголовок</h3><p>Текст</p>", '<span class="t-title">Заголовок</span><br><span class="t-body">Текст</span>'));
  const clean = lintDeck(cardDeck, { quiet: true });
  assert.ok(!clean.errors.join("\n").includes("raw <"), "runs inside a box stay clean");
}

console.log("PASS  lint-deck: //host и file: ловятся, bypass удалён, фидельность не линтуется (воркфлоу + глаза)");
