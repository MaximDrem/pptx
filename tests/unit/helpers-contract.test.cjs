#!/usr/bin/env node
// Unit test: helper layer contracts.
//   1. Every CLI helper prints a `usage:` line and exits 2 when called with
//      no arguments — the model always gets told how to call it.
//   2. The blocking-error set is identical in probe.js, render.cjs,
//      validate.cjs and app/deck-render.ts — the lists used to drift.
//   3. `assets.cjs` is check-only by default (the authored deck is not
//      mutated) and `--inline` is what bakes data URIs.
//
//   node tests/unit/helpers-contract.test.cjs
"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");
const assert = require("assert");
const { spawnSync } = require("child_process");

const SKILL = path.join(__dirname, "..", "..");
const H = path.join(SKILL, "helpers");

const CLI = [
  "index.cjs",
  "assets.cjs",
  "expand-styles.cjs",
  "lint-deck.cjs",
  "render.cjs",
  "validate.cjs",
  "review.cjs",
  "inspect.cjs",
  "slide.cjs",
  "shots.cjs",
  "read-pptx.cjs",
  "style-profile.cjs",
  "icons.cjs",
  "pptx-post.cjs",
];

function quotted(src) {
  return [...src.matchAll(/"([a-z][a-z0-9-]*)"/g)].map((m) => m[1]).filter((t) => t.includes("-"));
}
function errorSet(file, blockRe) {
  const src = fs.readFileSync(file, "utf8");
  const m = blockRe.exec(src);
  assert.ok(m, `cannot find the error list in ${path.basename(file)}`);
  const types = quotted(m[1]);
  return new Set(types.filter((t) => t !== "text-clip" || true));
}

function main() {
  // 1. Usage contract.
  for (const helper of CLI) {
    const r = spawnSync(process.execPath, [path.join(H, helper)], { encoding: "utf8", timeout: 30000 });
    const out = (r.stdout || "") + (r.stderr || "");
    assert.strictEqual(r.status, 2, `${helper}: no-args run must exit 2 (got ${r.status})`);
    assert.ok(/usage:\s/.test(out), `${helper}: no-args run must print a usage line`);
  }

  // 2. Blocking-error sets stay in sync.
  const probe = errorSet(path.join(H, "probe.js"), /const ERROR_TYPES = new Set\(\[([\s\S]*?)\]\)/);
  const render = errorSet(path.join(H, "render.cjs"), /const BLOCKING = new Set\(\[([\s\S]*?)\]\)/);
  const validate = errorSet(path.join(H, "validate.cjs"), /const isError = issue\.severity[\s\S]*?\[([\s\S]*?)\]\.includes\(issue\.type\)/);
  const app = errorSet(path.join(SKILL, "app", "deck-render.ts"), /const BLOCKING = new Set\(\[([\s\S]*?)\]\)/);
  for (const [name, set] of [["render.cjs", render], ["validate.cjs", validate], ["app/deck-render.ts", app]]) {
    assert.deepStrictEqual(
      [...set].sort(),
      [...probe].sort(),
      `${name} blocking list differs from probe.js ERROR_TYPES`,
    );
  }

  // 3. assets.cjs: check-only by default, --inline on request.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "presentation-v3-contract-"));
  fs.mkdirSync(path.join(dir, "images"));
  fs.writeFileSync(
    path.join(dir, "images", "px.png"),
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"),
  );
  const deck = path.join(dir, "assets.deck.html");
  const source = '<!doctype html><html><body><img src="images/px.png" alt=""></body></html>';
  fs.writeFileSync(deck, source);

  const check = spawnSync(process.execPath, [path.join(H, "assets.cjs"), deck], { encoding: "utf8" });
  assert.strictEqual(check.status, 0, "default assets check must succeed: " + (check.stderr || ""));
  assert.strictEqual(fs.readFileSync(deck, "utf8"), source, "default assets run must NOT modify the authored deck");

  const inline = spawnSync(process.execPath, [path.join(H, "assets.cjs"), deck, "--inline"], { encoding: "utf8" });
  assert.strictEqual(inline.status, 0, "assets --inline must succeed: " + (inline.stderr || ""));
  assert.ok(fs.readFileSync(deck, "utf8").includes("data:image"), "assets --inline must bake the data URI");

  // 4. Missing input: non-zero exit, the message names the path, no raw stack.
  for (const helper of CLI.filter((h) => h !== "icons.cjs")) {
    const missing = "/tmp/presentation-v3-nonexistent-input.pptx";
    const r = spawnSync(process.execPath, [path.join(H, helper), missing], { encoding: "utf8", timeout: 30000 });
    const out = (r.stdout || "") + (r.stderr || "");
    assert.notStrictEqual(r.status, 0, `${helper}: a missing input must fail (exit ${r.status})`);
    assert.ok(out.includes("nonexistent-input"), `${helper}: the error must name the input path`);
    assert.ok(!/at (Object|Module|async)\b/.test(out), `${helper}: must not print a raw stack trace`);
  }

  console.log("PASS  helpers: usage/exit-контракт, синхронный список блокеров, assets без мутаций по умолчанию, ошибки без стектрейсов");
}

main();
