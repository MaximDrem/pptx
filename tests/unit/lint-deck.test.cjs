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

// Template fidelity: a profile with assets but a deck that uses none → error.
{
  const stylesDir = fs.mkdtempSync(path.join(os.tmpdir(), "presentation-v3-styles-"));
  const profileDir = path.join(stylesDir, "brand");
  fs.mkdirSync(path.join(profileDir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(profileDir, "assets", "logo.png"), "not-a-real-png");
  fs.writeFileSync(path.join(profileDir, "assets", "cat.png"), "not-a-real-png");
  fs.writeFileSync(path.join(profileDir, "assets", "bg.png"), "not-a-real-png");
  fs.writeFileSync(
    path.join(profileDir, "profile.json"),
    JSON.stringify({
      media: { extracted: [{ name: "logo.png", role: "logo" }, { name: "cat.png", role: "decor" }, { name: "bg.png", role: "background" }] },
      source: { slides: 10 },
      density: { imageBackgrounds: 8 },
    }),
  );
  const deck = path.join(dir, "template.deck.html");
  fs.writeFileSync(
    deck,
    `<!doctype html><html><head>
<style data-presentation-style="profile:brand"></style>
<style>.slide { color: red; }</style>
</head><body><div class="deck-viewport"><div class="deck-stage" id="deck-stage">
<section class="slide" data-role="content"><div class="slide-pad">Только текст</div></section>
</div></div></body></html>`,
  );
  process.env.PRESENTATION_STYLES_DIR = stylesDir;
  const noAssetsUsed = lintDeck(deck, { quiet: true });
  assert.ok(
    noAssetsUsed.errors.join("\n").includes("has assets but the deck uses none"),
    "profile with assets + text-only deck must be an error",
  );

  // Background only: the "any image" rule is satisfied, but the decor rule is not.
  const bgOnly = fs
    .readFileSync(deck, "utf8")
    .replace("Только текст", '<img class="bg-img" src="images/template-bg.png" alt="">');
  fs.writeFileSync(deck, bgOnly);
  const bgOnlyRes = lintDeck(deck, { quiet: true });
  assert.ok(
    bgOnlyRes.errors.join("\n").includes("has decor assets but the deck uses none"),
    "background-only copy must fail the decor rule",
  );

  // Decor only: the background is still flat — that is also a failed copy.
  const decorOnly = bgOnly.replace('<img class="bg-img" src="images/template-bg.png" alt="">', "").replace(
    "</section>",
    '<img class="decor-img" style="left:900px; top:-120px; width:380px" src="images/template-decor-1.png" alt=""></section>',
  );
  fs.writeFileSync(deck, decorOnly);
  const decorOnlyRes = lintDeck(deck, { quiet: true });
  assert.ok(
    decorOnlyRes.errors.join("\n").includes("uses an image background but the deck has none"),
    "decor-only copy must fail the background rule",
  );

  // Backgrounds on cover/closing only: a copy must keep them on most slides.
  {
    const four = `<section class="slide" data-role="content"><div class="slide-pad">A</div></section>
<section class="slide" data-role="content"><div class="slide-pad">B</div></section>
<section class="slide" data-role="content"><div class="slide-pad">C</div></section>
<section class="slide" data-role="content"><div class="slide-pad">D</div></section>`;
    const sparse = fs
      .readFileSync(deck, "utf8")
      .replace(/<section class="slide" data-role="content"><div class="slide-pad">[^<]*<\/div><\/section>/g, "")
      .replace("</div></div></body></html>", '<img class="bg-img" src="images/template-bg.png" alt="">' + four + "</div></div></body></html>");
    fs.writeFileSync(deck, sparse);
    const sparseRes = lintDeck(deck, { quiet: true });
    assert.ok(
      sparseRes.errors.join("\n").includes("backgrounds on cover/closing only"),
      "backgrounds missing on most slides must be an error",
    );
  }

  // Adding one decor clears both errors.
  const withDecor = bgOnly.replace("</section>", '<img class="decor-img" style="left:900px; top:-120px; width:380px" src="images/template-decor-1.png" alt=""></section>');
  fs.writeFileSync(deck, withDecor);
  const fixed = lintDeck(deck, { quiet: true });
  delete process.env.PRESENTATION_STYLES_DIR;
  assert.ok(!fixed.errors.join("\n").includes("template profile"), "using bg + decor must clear the template errors");
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

console.log("PASS  lint-deck: //host и file: ловятся, bypass удалён, шаблонные ассеты обязательны");
