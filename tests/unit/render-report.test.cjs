#!/usr/bin/env node
// Unit test for render.cjs contract (no Electron): a stub renderer replaces
// "$GIGATOOL_NODE <app> --deck-render …" and writes report.json/inventory.json
// (.pptx with --pptx). Verifies:
//   1. report/inventory are parsed before the temp dir is removed, so probe
//      findings survive the render-only flow (validate.cjs relies on it);
//   2. deliverables are copied next to deck.html when no --out-dir is given;
//   3. an explicit --out-dir suppresses the copy;
//   4. a renderer crash (Electron "Object has been destroyed") is retried once,
//      a repeated crash gets an actionable message + the stderr tail, and a
//      deterministic timeout is not retried.
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
if (process.env.STUB_CRASH_ALWAYS === "1") {
  if (process.env.STUB_CRASH_COUNTER) fs.appendFileSync(process.env.STUB_CRASH_COUNTER, "x");
  console.error("Error: Object has been destroyed");
  console.error("    at Renderer.<anonymous> (deck-render.js:1:1)");
  process.exit(3);
}
if (process.env.STUB_TIMEOUT === "1") {
  if (process.env.STUB_CRASH_COUNTER) fs.appendFileSync(process.env.STUB_CRASH_COUNTER, "x");
  console.error("render: timed out after 240s");
  process.exit(3);
}
if (process.env.STUB_CRASH_ONCE === "1") {
  const marker = process.env.STUB_CRASH_MARKER;
  if (marker && !fs.existsSync(marker)) {
    fs.writeFileSync(marker, "crashed");
    console.error("Error: Object has been destroyed");
    process.exit(3);
  }
}
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify({
  file: deck,
  slideCount: 1,
  fontsMissing: ["Missing Face"],
  slides: [{ index: 0, issues: [{ type: "img-no-alt", detail: "1 image without alt" }] }],
}));
fs.writeFileSync(path.join(out, "inventory.json"), JSON.stringify({ slides: [] }));
// build-copy check: relative refs must be resolvable next to the deck
const refImg = path.join(path.dirname(deck), "images", "px.png");
fs.writeFileSync(path.join(out, "saw-image.txt"), fs.existsSync(refImg) ? "yes" : "no");
const base = path.basename(deck).replace(/\\.html?$/i, "");
// A real (minimal) zip so pptx-post can process it.
const PPTX_B64 = "UEsDBAoAAAAAAM4xOF0AAAAAAAAAAAAAAAAEAAAAcHB0L1BLAwQKAAAAAADOMThdAAAAAAAAAAAAAAAACwAAAHBwdC9zbGlkZXMvUEsDBAoAAAAIAM4xOF0l+eitCgAAAAgAAAAVAAAAcHB0L3NsaWRlcy9zbGlkZTEueG1ssymwKs5J0bcDAFBLAQIUAAoAAAAAAM4xOF0AAAAAAAAAAAAAAAAEAAAAAAAAAAAAEAAAAAAAAABwcHQvUEsBAhQACgAAAAAAzjE4XQAAAAAAAAAAAAAAAAsAAAAAAAAAAAAQAAAAIgAAAHBwdC9zbGlkZXMvUEsBAhQACgAAAAgAzjE4XSX56K0KAAAACAAAABUAAAAAAAAAAAAAAAAASwAAAHBwdC9zbGlkZXMvc2xpZGUxLnhtbFBLBQYAAAAAAwADAK4AAACIAAAAAAA=";
if (process.env.STUB_BLOCKING_REPORT === "1") {
  // An older app exits 0 and exports anyway; the helper must still gate it.
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify({
    file: deck,
    slideCount: 2,
    fontsMissing: [],
    slides: [{ index: 1, issues: [{ type: "hidden-slide", detail: "slide is display:none" }] }],
  }));
}
if (process.env.STUB_BLOCK === "1") {
  // Mirrors the app: blocking findings in report.json, export refused (exit 4).
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify({
    file: deck,
    slideCount: 2,
    fontsMissing: [],
    slides: [{ index: 1, issues: [{ type: "hidden-slide", detail: "slide is display:none" }] }],
  }));
  console.log("render: 2 blocking issue(s) — export skipped.");
  process.exit(4);
}
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
  assert.strictEqual(r1.report.slides[0].issues[0].type, "img-no-alt", "probe findings must survive");
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

  // 4. blocking issues: the app refuses to export (exit 4) and no artifact is
  //    delivered; the report is still available to the caller.
  process.env.STUB_BLOCK = "1";
  const blockedDeck = path.join(dir, "blocked.deck.html");
  fs.writeFileSync(blockedDeck, "<!doctype html><html><body></body></html>");
  const r4 = await renderDeck(blockedDeck, { pptx: true });
  delete process.env.STUB_BLOCK;
  assert.strictEqual(r4.code, 4, "blocked export must surface exit code 4");
  assert.deepStrictEqual(r4.artifacts, [], "no artifacts when the export is blocked");
  assert.ok(r4.report, "report must still be parsed on exit 4");
  assert.ok(!fs.existsSync(path.join(dir, "blocked.deck.pptx")), "no .pptx next to the deck");

  // 5. A blocking finding in report.json blocks delivery even when the app
  //    exits 0 (apps older than the skill do not gate the export themselves).
  process.env.STUB_BLOCKING_REPORT = "1";
  const softDeck = path.join(dir, "soft-block.deck.html");
  fs.writeFileSync(softDeck, "<!doctype html><html><body></body></html>");
  const r5 = await renderDeck(softDeck, { pptx: true });
  delete process.env.STUB_BLOCKING_REPORT;
  assert.strictEqual(r5.code, 4, "helper must surface exit 4 for blocking findings");
  assert.deepStrictEqual(r5.artifacts, [], "no artifacts copied when the helper blocks");
  assert.ok(!fs.existsSync(path.join(dir, "soft-block.deck.pptx")), "no .pptx next to the deck");

  // 6. The authored source stays clean: assets are inlined only in the build copy.
  const px = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  fs.writeFileSync(path.join(dir, "px.png"), px);
  fs.mkdirSync(path.join(dir, "images"), { recursive: true });
  fs.writeFileSync(path.join(dir, "images", "px.png"), px);
  const srcDeck = path.join(dir, "clean.deck.html");
  fs.writeFileSync(
    srcDeck,
    '<!doctype html><html><body><div class="deck-stage" id="deck-stage"><section class="slide" data-role="content"><img src="images/px.png" alt="">text</section></div></body></html>',
  );
  const out6 = path.join(dir, "clean-out");
  const r6 = await renderDeck(srcDeck, { outDir: out6 });
  assert.strictEqual(r6.ran, true);
  assert.ok(!fs.readFileSync(srcDeck, "utf8").includes("data:image"), "authored deck.html must stay free of data URIs");
  assert.ok(fs.readFileSync(srcDeck, "utf8").includes('src="images/px.png"'), "relative refs stay in the source");
  assert.strictEqual(fs.readFileSync(path.join(out6, "saw-image.txt"), "utf8"), "yes", "the build copy must carry referenced images");

  // 7. A renderer crash (Electron "Object has been destroyed") is retried once.
  process.env.STUB_CRASH_ONCE = "1";
  const crashMarker = path.join(dir, "crash.marker");
  process.env.STUB_CRASH_MARKER = crashMarker;
  const crashDeck = path.join(dir, "crash.deck.html");
  fs.writeFileSync(crashDeck, "<!doctype html><html><body></body></html>");
  const r7 = await renderDeck(crashDeck, { outDir: path.join(dir, "crash-out") });
  delete process.env.STUB_CRASH_ONCE;
  delete process.env.STUB_CRASH_MARKER;
  assert.strictEqual(r7.code, 0, "the retry must succeed after one crash");
  assert.ok(fs.existsSync(crashMarker), "the first attempt must have crashed");

  // 8. A repeated Electron crash: exactly one retry, then an actionable "app
  //    session is broken" line plus the captured stderr tail (the real case
  //    ended with the model guessing about disk space).
  {
    process.env.STUB_CRASH_ALWAYS = "1";
    const counter = path.join(dir, "crash-always.count");
    process.env.STUB_CRASH_COUNTER = counter;
    const alwaysDeck = path.join(dir, "crash-always.deck.html");
    fs.writeFileSync(alwaysDeck, "<!doctype html><html><body></body></html>");
    const captured = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk, ...rest) => {
      captured.push(typeof chunk === "string" ? chunk : chunk.toString());
      return origWrite(chunk, ...rest);
    };
    let r8;
    try {
      r8 = await renderDeck(alwaysDeck, { outDir: path.join(dir, "crash-always-out") });
    } finally {
      process.stderr.write = origWrite;
      delete process.env.STUB_CRASH_ALWAYS;
      delete process.env.STUB_CRASH_COUNTER;
    }
    assert.strictEqual(r8.code, 3, "a repeated crash must surface exit 3");
    assert.strictEqual(fs.readFileSync(counter, "utf8"), "xx", "one retry = exactly two attempts");
    const log = captured.join("");
    assert.ok(/app window was destroyed twice/.test(log), "the repeated crash must be named as an Electron crash");
    assert.ok(/restart the app/i.test(log), "the message must direct the model to the app session, not disk space");
    assert.ok(/last renderer stderr: .*deck-render\.js/.test(log), "the captured stderr tail must be echoed");
  }

  // 9. A deterministic app failure (watchdog timeout) is not retried.
  {
    process.env.STUB_TIMEOUT = "1";
    const counter = path.join(dir, "timeout.count");
    process.env.STUB_CRASH_COUNTER = counter;
    const timeoutDeck = path.join(dir, "timeout.deck.html");
    fs.writeFileSync(timeoutDeck, "<!doctype html><html><body></body></html>");
    const r9 = await renderDeck(timeoutDeck, { outDir: path.join(dir, "timeout-out") });
    delete process.env.STUB_TIMEOUT;
    delete process.env.STUB_CRASH_COUNTER;
    assert.strictEqual(r9.code, 3, "the app timeout must surface exit 3");
    assert.strictEqual(fs.readFileSync(counter, "utf8"), "x", "a deterministic timeout must not be retried");
  }

  console.log("PASS  render: отчёт переживает очистку temp, артефакты кладутся рядом с deck.html");
}

main().catch((e) => {
  console.error("FAIL  render: " + (e.message || e));
  process.exit(1);
});
