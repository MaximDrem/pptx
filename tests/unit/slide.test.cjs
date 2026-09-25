#!/usr/bin/env node
// Unit test: helpers/slide.cjs — per-slide edits without oldString.
//   --list / --get / --set / --append touch only the target <section>;
//   a fragment that is not exactly one <section> is rejected (exit 3);
//   an out-of-range index is rejected (exit 2); the rest of the file is
//   byte-identical (that is the whole point: deck.html has repeated markup,
//   so the generic edit tool's oldString fails by design).
//
//   node tests/unit/slide.test.cjs
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");
const { spawnSync } = require("child_process");

const HELPER = path.join(__dirname, "..", "..", "helpers", "slide.cjs");
const run = (args, input) => spawnSync(process.execPath, [HELPER, ...args], { encoding: "utf8", input });

const DECK = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>t</title></head>
<body><div class="deck-viewport"><div class="deck-stage" id="deck-stage">
<!-- Slide 1 -->
<section class="slide cover" data-role="cover">
  <img class="bg-img" src="images/template-bg-1.png" alt="">
  <div class="slide-pad"><h1 class="headline">Первый</h1></div>
</section>
<!-- Slide 2 -->
<section class="slide" data-role="content">
  <img class="bg-img" src="images/template-bg-2.png" alt="">
  <div class="slide-pad"><h2 class="headline">Второй</h2></div>
</section>
<!-- Slide 3 -->
<section class="slide" data-role="content">
  <img class="bg-img" src="images/template-bg-4.png" alt="">
  <div class="slide-pad"><h2 class="headline">Третий</h2></div>
</section>
</div></div></body></html>
`;

const NEW2 = `<section class="slide" data-role="content">
  <img class="bg-img" src="images/template-bg-3.png" alt="">
  <div class="slide-pad"><h2 class="headline">Второй исправленный</h2></div>
  <div class="footer"><span>Раздел</span><span>02</span></div>
</section>`;

const NEW4 = `<section class="slide closing" data-role="closing">
  <div class="slide-pad"><h2 class="headline">Финал</h2></div>
</section>`;

function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "presentation-v3-slide-"));
  const deck = path.join(dir, "deck.html");
  const before = DECK;
  fs.writeFileSync(deck, before);

  // --list names every slide without touching the file.
  const list = run([deck, "--list"]);
  assert.strictEqual(list.status, 0, "list must succeed");
  assert.ok(/slide 1\/3 \[cover\] «Первый»/.test(list.stdout), "list shows role + headline");
  assert.ok(list.stdout.includes("slide 2/3 [content] «Второй»"), "list shows slide 2");
  assert.strictEqual(fs.readFileSync(deck, "utf8"), before, "list must not change the file");

  // --get returns exactly the section.
  const got = run([deck, "--get", "2"]);
  assert.strictEqual(got.status, 0, "get must succeed");
  assert.ok(got.stdout.startsWith('<section class="slide" data-role="content">'), "get returns the section");
  assert.ok(!got.stdout.includes("Третий"), "get must not bleed into the next slide");
  const oldSec = got.stdout.replace(/\n$/, "");

  // --set replaces only slide 2.
  const frag = path.join(dir, "slide-2.html");
  fs.writeFileSync(frag, NEW2);
  const set = run([deck, "--set", "2", "--from", frag]);
  assert.strictEqual(set.status, 0, "set must succeed");
  assert.ok(/slide 2: replaced/.test(set.stdout), "set reports the replacement");
  const after = fs.readFileSync(deck, "utf8");
  assert.ok(after.includes("Второй исправленный"), "the new slide is in the file");
  assert.ok(after.includes('<img class="bg-img" src="images/template-bg-3.png" alt="">'), "the new bg is in the file");
  assert.ok(!after.includes("images/template-bg-2.png"), "slide 2's old bg is gone");
  assert.ok(after.includes("Первый") && after.includes("Третий"), "other slides are untouched");
  assert.ok(after.includes("<!-- Slide 2 -->"), "surrounding comments survive");
  assert.strictEqual((after.match(/<section\b/g) || []).length, 3, "still 3 sections");
  assert.strictEqual(after.length - before.length, NEW2.trimEnd().length - oldSec.length, "only the section length changed");

  // --append adds a slide at the end of the stage.
  const frag4 = path.join(dir, "slide-4.html");
  fs.writeFileSync(frag4, NEW4);
  const app = run([deck, "--append", "--from", frag4]);
  assert.strictEqual(app.status, 0, "append must succeed");
  const after2 = fs.readFileSync(deck, "utf8");
  assert.strictEqual((after2.match(/<section\b/g) || []).length, 4, "append adds one section");
  assert.ok(after2.indexOf("Финал") > after2.indexOf("Третий"), "the appended slide is last");
  assert.ok(after2.trimEnd().endsWith("</div></div></body></html>"), "the wrapper closes after the new slide");

  // Fragment that is not exactly one section must be rejected and change nothing.
  const bad = path.join(dir, "bad.html");
  fs.writeFileSync(bad, "<p>not a slide</p>");
  const res = run([deck, "--set", "1", "--from", bad]);
  assert.strictEqual(res.status, 3, "a non-section fragment is rejected");
  assert.ok(/exactly one <section>/.test(res.stderr), "the error explains the fragment rule");
  const two = path.join(dir, "two.html");
  fs.writeFileSync(two, NEW2 + "\n" + NEW4);
  assert.strictEqual(run([deck, "--set", "1", "--from", two]).status, 3, "two sections are rejected");

  // Out of range.
  assert.strictEqual(run([deck, "--get", "9"]).status, 2, "get out of range exits 2");
  assert.strictEqual(run([deck, "--set", "0", "--from", frag]).status, 2, "set out of range exits 2");

  // Missing deck / missing args.
  assert.strictEqual(run([path.join(dir, "nope.html"), "--list"]).status, 2, "missing deck exits 2");
  assert.strictEqual(run([]).status, 2, "no args exits 2");

  console.log("PASS  slide: правки по слайдам без oldString (list/get/set/append, защита от мусора)");
}

main();
