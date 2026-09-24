#!/usr/bin/env node
// Unit test for render.cjs contract (no Electron): a stub renderer replaces
// "$GIGATOOL_NODE <app> --deck-render …" and writes report.json/inventory.json
// (.pptx with --pptx). Verifies:
//   1. report/inventory are parsed before the temp dir is removed, so probe
//      findings survive the render-only flow (validate.cjs relies on it);
//   2. deliverables are copied next to deck.html when no --out-dir is given;
//   3. an explicit --out-dir suppresses the copy.
//
//   node tests/unit/render-report.test.cjs
"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");
const assert = require("assert");
const { renderDeck } = require(path.join(__dirname, "..", "..", "helpers", "render.cjs"));

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
  slideCount: 1,
  fontsMissing: ["Missing Face"],
  slides: [{ index: 0, issues: [{ type: "text-clip", detail: "overflow" }] }],
}));
fs.writeFileSync(path.join(out, "inventory.json"), JSON.stringify({ slides: [] }));
const base = path.basename(deck).replace(/\\.html?$/i, "");
// A real (minimal) zip so pptx-post can process it.
const PPTX_B64 = "UEsDBAoAAAAAAM4xOF0AAAAAAAAAAAAAAAAEAAAAcHB0L1BLAwQKAAAAAADOMThdAAAAAAAAAAAAAAAACwAAAHBwdC9zbGlkZXMvUEsDBAoAAAAIAM4xOF0l+eitCgAAAAgAAAAVAAAAcHB0L3NsaWRlcy9zbGlkZTEueG1ssymwKs5J0bcDAFBLAQIUAAoAAAAAAM4xOF0AAAAAAAAAAAAAAAAEAAAAAAAAAAAAEAAAAAAAAABwcHQvUEsBAhQACgAAAAAAzjE4XQAAAAAAAAAAAAAAAAsAAAAAAAAAAAAQAAAAIgAAAHBwdC9zbGlkZXMvUEsBAhQACgAAAAgAzjE4XSX56K0KAAAACAAAABUAAAAAAAAAAAAAAAAASwAAAHBwdC9zbGlkZXMvc2xpZGUxLnhtbFBLBQYAAAAAAwADAK4AAACIAAAAAAA=";
if (argv.includes("--pptx")) fs.writeFileSync(path.join(out, base + ".pptx"), Buffer.from(PPTX_B64, "base64"));
console.log("render: clean");
`;

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "presentation-v2-render-test-"));
  const stub = path.join(dir, "stub-render.cjs");
  fs.writeFileSync(stub, STUB);
  const deck = path.join(dir, "unit.deck.html");
  fs.writeFileSync(deck, "<!doctype html><html><body></body></html>");

  process.env.GIGATOOL_NODE = process.execPath;
  process.env.GIGATOOL_APP_PATH = stub;

  // 1. render-only: the parsed report must survive the temp cleanup.
  const r1 = await renderDeck(deck, {});
  assert.strictEqual(r1.ran, true, "renderer must start");
  assert.strictEqual(r1.code, 0, "stub exits 0");
  assert.ok(r1.report, "report must be parsed before the temp dir is removed");
  assert.deepStrictEqual(r1.report.fontsMissing, ["Missing Face"], "fontsMissing must travel in report.json");
  assert.strictEqual(r1.report.slides[0].issues[0].type, "text-clip", "probe findings must survive");
  assert.ok(r1.inventory, "inventory must be parsed before cleanup");
  assert.ok(!fs.existsSync(r1.outDir), "temp dir is removed when nothing persistent is requested");

  // 2. --pptx: the file lands next to deck.html, temp dir stays for captures.
  const r2 = await renderDeck(deck, { pptx: true });
  const delivered = path.join(dir, "unit.deck.pptx");
  assert.ok(fs.existsSync(delivered), "pptx must be copied next to deck.html");
  assert.deepStrictEqual(r2.artifacts, [delivered], "artifacts must list the delivered path");
  assert.ok(fs.existsSync(r2.outDir), "temp dir is kept when --pptx is requested");

  // 3. explicit --out-dir: no copy into the deck folder.
  const outDir = path.join(dir, "explicit-out");
  const r3 = await renderDeck(deck, { pptx: true, outDir });
  assert.ok(fs.existsSync(path.join(outDir, "unit.deck.pptx")), "pptx must exist in --out-dir");
  assert.deepStrictEqual(r3.artifacts, [], "explicit --out-dir must suppress the copy");

  console.log("PASS  render: отчёт переживает очистку temp, артефакты кладутся рядом с deck.html");
}

main().catch((e) => {
  console.error("FAIL  render: " + (e.message || e));
  process.exit(1);
});
