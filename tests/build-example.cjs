#!/usr/bin/env node
// Assemble examples/example-deck.html from the skill's CSS files and the body
// template, then verify it:
//
//   node tests/build-example.cjs
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const SKILL = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(SKILL, p), "utf8");

const body = read("tests/fixtures/example-body.html");
const out = body
  .replace("{{STAGE_CSS}}", read("stage.css"))
  .replace("{{FONTS_CSS}}", read("fonts/fonts.css"))
  .replace("{{TOKENS_CSS}}", read("styles/grid-paper/tokens.css"))
  .replace("{{BASE_CSS}}", read("styles/_base.css"));

const target = path.join(SKILL, "examples", "example-deck.html");
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, out);
console.log("built: " + target + " (" + Math.round(out.length / 1024) + "KB)");
execFileSync(process.execPath, [path.join(SKILL, "helpers", "lint-deck.cjs"), target], { stdio: "inherit" });
if (process.argv.includes("--inline")) {
  execFileSync(process.execPath, [path.join(SKILL, "helpers", "assets.cjs"), target], { stdio: "inherit" });
  console.log("example is self-contained (fonts inlined)");
}
