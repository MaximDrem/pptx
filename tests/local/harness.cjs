#!/usr/bin/env node
// presentation v2 — local dev harness (NOT part of the skill runtime).
//
// Reproduces what the app one-shot `--deck-render` does, driving a system
// Chrome over CDP, so probe checks, PNG captures and the .pptx export can be
// verified without Electron:
//
//   node tests/local/harness.cjs probe  <deck.html> [--json out.json]
//   node tests/local/harness.cjs export <deck.html> --out out.pptx
//   node tests/local/harness.cjs shots  <deck.html> --out-dir dir [--scale 1|2]
//
// Chrome is found via $CHROME or google-chrome/chromium.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { launch, newPage } = require("./cdp.cjs");

const SKILL = path.join(__dirname, "..", "..");

function findChrome() {
  for (const c of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    try {
      return execFileSync("which", [c], { encoding: "utf8" }).trim();
    } catch (e) {
      /* try next */
    }
  }
  throw new Error("no Chrome found — set $CHROME");
}

const CHROME = process.env.CHROME || findChrome();

function buildWrapper(deckPath, { exportMode, evalBundle }) {
  const deck = fs.readFileSync(deckPath, "utf8");
  const probeUrl = "file://" + path.join(SKILL, "helpers", "probe.js");
  const d2pUrl = "file://" + path.join(SKILL, "vendor", "dom-to-pptx.bundle.js");

  const manifest = JSON.parse(fs.readFileSync(path.join(SKILL, "fonts", "manifest.json"), "utf8"));
  const fonts = [];
  if (exportMode) {
    for (const [family, files] of Object.entries(manifest.ttf || {})) {
      for (const f of files) {
        const abs = path.join(SKILL, "fonts", f);
        if (fs.existsSync(abs)) {
          fonts.push({ name: family, url: "data:font/ttf;base64," + fs.readFileSync(abs).toString("base64") });
        }
      }
    }
  }

  const pin =
    "#deck-stage, .deck-stage { transform: none !important; left: 0 !important; top: 0 !important; }";
  const runner = `
<script src="${probeUrl}"></script>
${exportMode && !evalBundle ? `<script src="${d2pUrl}"></script>` : ""}
<script>
(() => { const s = document.createElement("style"); s.textContent = ${JSON.stringify(pin)}; document.head.appendChild(s); })();
window.__EXPORT_FONTS__ = ${JSON.stringify(fonts)};
window.__runProbe = async () => {
  const meta = await window.__deckProbe.ready();
  const report = window.__deckProbe.report();
  const inventory = window.__deckProbe.inventory();
  return { meta, report, inventory };
};
window.__runExport = async () => {
  const prep = window.__deckProbe.exportPrep();
  const slides = Array.from(document.querySelectorAll(".slide"));
  const blob = await window.domToPptx.exportToPptx(slides, {
    skipDownload: true, width: 13.333, height: 7.5, svgAsVector: true,
    fonts: window.__EXPORT_FONTS__ || [],
  });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  window.__deckProbe.exportRestore();
  return { prep, bytes: bytes.length, b64: btoa(bin) };
};
</script>`;

  const wrapper = deck.replace(/<\/body>/i, runner + "\n</body>");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "presentation-v2-harness-"));
  const file = path.join(dir, "wrapper.html");
  fs.writeFileSync(file, wrapper);
  return { dir, file };
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const deckArg = argv[1];
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? null : argv[i + 1];
  };
  if (!cmd || !deckArg) {
    console.error("usage: harness.cjs probe|export|shots <deck.html> [--json out] [--out out.pptx] [--out-dir dir] [--scale 1|2]");
    process.exit(2);
  }
  const deck = path.resolve(deckArg);
  const exportMode = cmd === "export";
  const evalBundle = process.env.HARNESS_EVAL_BUNDLE === "1";
  const { dir, file } = buildWrapper(deck, { exportMode, evalBundle });
  const url = "file://" + file;
  console.error("wrapper: " + dir + (argv.includes("--keep") ? "" : " (deleted on success)"));

  const browser = await launch(CHROME, { width: 1280, height: 720 });
  try {
    const page = await newPage(browser.client, url, { width: 1280, height: 720 });
    const result = await page.evaluate("window.__runProbe()");

    const lines = [];
    lines.push(`probe: ${result.meta.slideCount} slide(s), stage ${result.meta.stageW}×${result.meta.stageH}`);
    for (const f of result.meta.fontsMissing || []) lines.push(`deck: FONT NOT LOADED: ${f}`);
    let total = 0;
    for (const r of result.report) {
      for (const issue of r.issues) {
        total++;
        lines.push(`slide ${r.index + 1}: ${issue.type.toUpperCase()}: ${issue.detail}`);
      }
    }
    lines.push(total === 0 ? "probe: clean" : `probe: ${total} issue(s)`);

    if (cmd === "probe") {
      const jsonPath = flag("--json") || path.join(dir, "report.json");
      fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
      lines.push("json: " + jsonPath);
      console.log(lines.join("\n"));
      await page.close();
      process.exitCode = total === 0 ? 0 : 1;
      return;
    }

    if (cmd === "export") {
      const out = flag("--out");
      if (!out) {
        console.error("--out is required");
        process.exitCode = 2;
        return;
      }
      await page.evaluate("window.__deckProbe.reveal(0)");
      if (evalBundle) {
        const bundle = fs.readFileSync(path.join(SKILL, "vendor", "dom-to-pptx.bundle.js"), "utf8");
        await page.evaluate(bundle);
      }
      const exp = await page.evaluate("window.__runExport()", { returnByValue: true });
      fs.writeFileSync(path.resolve(out), Buffer.from(exp.b64, "base64"));
      // Как в render.cjs: точные межстрочные интервалы → пропорциональные.
      const { fixLineSpacing } = require(path.join(SKILL, "helpers", "pptx-post.cjs"));
      const fixed = await fixLineSpacing(fs.readFileSync(path.resolve(out)));
      if (fixed.fixed) fs.writeFileSync(path.resolve(out), fixed.buffer);
      lines.push(
        `pptx: ${path.resolve(out)} (${Math.round(exp.bytes / 1024)}KB, slides ${exp.prep.slides}, notes ${exp.prep.notes}` +
          (fixed.fixed ? `, line-spacing fixed: ${fixed.fixed}` : "") +
          ")",
      );
      console.log(lines.join("\n"));
      await page.close();
      process.exitCode = total === 0 ? 0 : 1;
      return;
    }

    if (cmd === "shots") {
      const outDir = path.resolve(flag("--out-dir") || path.join(dir, "shots"));
      fs.mkdirSync(outDir, { recursive: true });
      const scale = flag("--scale") === "1" ? 1 : 2;
      const n = result.meta.slideCount;
      for (let i = 0; i < n; i++) {
        await page.evaluate(`window.__deckProbe.reveal(${i})`);
        const png = await page.screenshot({ scale });
        fs.writeFileSync(path.join(outDir, `slide-${String(i + 1).padStart(2, "0")}.png`), png);
      }
      lines.push(`shots: ${n} slide(s) → ${outDir} (scale ${scale}×)`);
      console.log(lines.join("\n"));
      await page.close();
      return;
    }

    console.error("unknown command: " + cmd);
    process.exitCode = 2;
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e.stack || String(e));
  process.exit(1);
});
