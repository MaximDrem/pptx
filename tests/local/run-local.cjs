#!/usr/bin/env node
// presentation v2 — local acceptance run (dev machines with Chrome).
//
//   node tests/local/run-local.cjs
//
// Verifies the whole loop without Electron:
//   1. lint + assets on the shipped example
//   2. probe on the example must be clean (real Chromium via CDP)
//   3. probe on the defect fixture must catch every issue type
//   4. native .pptx export of the example + OOXML invariants (text runs,
//      embedded fonts, speaker notes, slide count)
//   5. optional LibreOffice check: the exported deck imports (if soffice is present)
//
// The Electron one-shot (app/deck-render.ts) mirrors steps 2–4; that is the
// only piece this machine cannot execute.
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SKILL = path.join(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(SKILL, p), "utf8");
const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

function assemble(fixture) {
  const body = read("tests/fixtures/" + fixture);
  const css = [read("stage.css"), read("fonts/fonts.css"), read("styles/grid-paper/tokens.css"), read("styles/_base.css")].join("\n");
  // Фикстуры должны быть self-contained, как настоящая дека после assets.cjs:
  // иначе строгая проверка шрифтов справедливо ругается на relative url().
  const inlined = css.replace(/url\((["']?)(fonts\/[^)"']+)\1\)/g, (m, q, rel) => {
    const abs = path.join(SKILL, rel);
    if (!fs.existsSync(abs)) return m;
    const mime = rel.endsWith(".woff2") ? "font/woff2" : rel.endsWith(".ttf") ? "font/ttf" : "application/octet-stream";
    return `url("data:${mime};base64,${fs.readFileSync(abs).toString("base64")}")`;
  });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "presentation-v2-tests-")), fixture.replace("-body.html", ".html"));
  fs.writeFileSync(file, body.replace("{{CSS}}", inlined));
  return file;
}

function runHarness(args) {
  return spawnSync(process.execPath, [path.join(__dirname, "harness.cjs"), ...args], { encoding: "utf8", timeout: 300000 });
}

async function main() {
  // 1. lint + assets --check on the shipped example.
  const example = path.join(SKILL, "examples", "example-deck.html");
  const lint = spawnSync(process.execPath, [path.join(SKILL, "helpers", "lint-deck.cjs"), example], { encoding: "utf8" });
  record("lint example (no errors)", lint.status === 0, (lint.stderr || "").trim().slice(0, 200) || "clean");
  const assets = spawnSync(process.execPath, [path.join(SKILL, "helpers", "assets.cjs"), example, "--check"], { encoding: "utf8" });
  record("assets check (self-contained example)", assets.status === 0, (assets.stdout || assets.stderr || "").trim().slice(0, 160));

  // 1b. Pure-node unit tests (no browser): pptx-post offset, artifact checks,
  //     render report/artifact contract.
  for (const unit of ["pptx-post.test.cjs", "validate-checks.test.cjs", "render-report.test.cjs", "lint-deck.test.cjs"]) {
    const u = spawnSync(process.execPath, [path.join(__dirname, "..", "unit", unit)], { encoding: "utf8", timeout: 60000 });
    const tail = ((u.stdout || "") + (u.stderr || "")).trim().split("\n").pop() || "";
    record(`unit ${unit}`, u.status === 0, tail.slice(0, 180));
  }

  // 2. probe on the example must be clean.
  const probe = runHarness(["probe", example]);
  record(
    "probe example clean",
    probe.status === 0,
    (probe.stdout || probe.stderr || "").split("\n").filter(Boolean).slice(-3).join(" | ").slice(0, 300),
  );

  // 2b. Строгая проверка шрифтов: лицо без @font-face должно попасть в FONT NOT LOADED.
  {
    const fontDeck = assemble("font-missing-body.html");
    const frun = runHarness(["probe", fontDeck]);
    const fout = (frun.stdout || "") + (frun.stderr || "");
    record("probe: незадекларированный шрифт ловится", /FONT NOT LOADED: Comic Relief/.test(fout), fout.includes("Comic Relief") ? "ok" : "not reported");
  }

  // 2c. Строки в боксе без <br> (иначе PowerPoint склеит их в одну строку).
  {
    const brDeck = assemble("br-missing-body.html");
    const brun = runHarness(["probe", brDeck]);
    const bout = (brun.stdout || "") + (brun.stderr || "");
    record("probe: строки в боксе без <br> ловятся", /MISSING-BR/.test(bout), bout.includes("MISSING-BR") ? "ok" : "not reported");
  }

  // 2d. Контентный слайд без акцента и полупустой бокс.
  {
    const asDeck = assemble("accent-sparse-body.html");
    const asrun = runHarness(["probe", asDeck]);
    const asout = (asrun.stdout || "") + (asrun.stderr || "");
    record(
      "probe: нет акцента и полупустой бокс ловятся",
      /NO-ACCENT/.test(asout) && /SPARSE-BOX/.test(asout),
      asout.includes("NO-ACCENT") && asout.includes("SPARSE-BOX") ? "ok" : "not reported",
    );
  }

  // 3. defect fixture: every issue type must fire.
  const defect = assemble("defect-body.html");
  const defectRun = runHarness(["probe", defect]);
  const out = (defectRun.stdout || "") + (defectRun.stderr || "");
  const must = [
    ["TEXT-CLIP", /TEXT-CLIP/],
    ["OUT-OF-BOUNDS", /OUT-OF-BOUNDS/],
    ["LOW-CONTRAST", /LOW-CONTRAST/],
    ["EMPTY-REGION", /EMPTY-REGION/],
    ["BLANK/CANDIDATE", /MAYBE-BLANK|BLANK SLIDE/],
    ["BROKEN-IMAGE", /BROKEN-IMAGE/],
  ];
  const missing = must.filter(([, re]) => !re.test(out)).map(([name]) => name);
  record("defect fixture caught all issue types", missing.length === 0, missing.length ? "missing: " + missing.join(", ") : "6/6");

  // 4. export + OOXML invariants.
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "presentation-v2-export-"));
  const pptx = path.join(outDir, "example.pptx");
  const exp = runHarness(["export", example, "--out", pptx]);
  if (exp.status !== 0 || !fs.existsSync(pptx)) {
    record("export example → native pptx", false, (exp.stdout || exp.stderr || "").slice(0, 300));
  } else {
    const JSZip = require(path.join(SKILL, "vendor", "jszip.bundle.cjs"));
    const zip = await JSZip.loadAsync(fs.readFileSync(pptx));
    const names = Object.keys(zip.files);
    const slides = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort();
    const fonts = names.filter((n) => /^ppt\/fonts\/.*fntdata$/.test(n));
    let runs = 0;
    let shapes = 0;
    const typefaces = new Set();
    for (const s of slides) {
      const xml = await zip.file(s).async("string");
      runs += (xml.match(/<a:t>/g) || []).length;
      shapes += (xml.match(/<p:sp>/g) || []).length;
      for (const m of xml.matchAll(/typeface="([^"]+)"/g)) typefaces.add(m[1]);
    }
    let notes = "";
    for (const n of names.filter((x) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(x))) {
      notes += await zip.file(n).async("string");
    }
    record("export: 5 slides", slides.length === 5, String(slides.length));
    record("export: native text runs", runs >= 40, runs + " <a:t>");
    record("export: native shapes", shapes >= 30, shapes + " <p:sp>");
    record("export: embedded TTF", fonts.length >= 1, fonts.length + " fntdata");
    record("export: typefaces kept", typefaces.has("Inter") && typefaces.has("Unbounded"), [...typefaces].join(", "));
    record("export: speaker notes", /Открыть одним предложением/.test(notes), notes.includes("Открыть") ? "notes ok" : "(none)");

    // 4b. validate.cjs на экспортированной колоде: без ошибок и известных
    //     warning'ов (SPLIT-BOX / TIGHT-LINE-SPACING / CONTRAST).
    {
      const v = spawnSync(process.execPath, [path.join(SKILL, "helpers", "validate.cjs"), pptx], { encoding: "utf8" });
      const vout = v.stdout || "";
      const errs = vout.split("\n").filter((l) => l.startsWith("error")).length;
      const bad = /SPLIT-BOX|TIGHT-LINE-SPACING|CONTRAST/.test(vout);
      record("validate: эталон без ошибок и известных warning'ов", v.status === 0 && errs === 0 && !bad, `exit=${v.status}, errors=${errs}`);
    }

    // 5. LibreOffice import (optional).
    const soffice = ["/usr/bin/soffice", "/usr/bin/libreoffice"].find((p) => fs.existsSync(p));
    if (soffice) {
      const conv = spawnSync(soffice, ["--headless", "--convert-to", "pdf", "--outdir", outDir, pptx], { encoding: "utf8", timeout: 240000 });
      const pdf = path.join(outDir, "example.pdf");
      record("LibreOffice imports the pptx", conv.status === 0 && fs.existsSync(pdf), fs.existsSync(pdf) ? "pdf ok" : "no pdf");
    } else {
      record("LibreOffice check (skipped)", true, "soffice not installed");
    }
  }

  // 6. Регрессия «один бокс»: текст ранами внутри залитого бокса склеивается
  //    в одну фигуру, блочные дети — нет (см. patterns.md).
  {
    const mergeDeck = assemble("merge-test.html");
    const mergeOut = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "presentation-v2-merge-")), "merge.pptx");
    const mrun = runHarness(["export", mergeDeck, "--out", mergeOut]);
    // Диагностическая фикстура: probe-замечания (намеренный overlap бейджа)
    // допустимы, важен только произведённый pptx.
    if ((mrun.status !== 0 && mrun.status !== 1) || !fs.existsSync(mergeOut)) {
      record("merge-test export", false, (mrun.stdout || mrun.stderr || "").slice(0, 200));
    } else {
      const JSZip = require(path.join(SKILL, "vendor", "jszip.bundle.cjs"));
      const zip = await JSZip.loadAsync(fs.readFileSync(mergeOut));
      const xml = await zip.file("ppt/slides/slide1.xml").async("string");
      const shapes = xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || [];
      const textsOf = (s2) => (s2.match(/<a:t>([^<]*)<\/a:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join("");
      const merged = shapes.filter((s2) => /roundRect/.test(s2) && /<p:txBody>/.test(s2) && /<a:t>/.test(s2)).map(textsOf);
      const loose = shapes.filter((s2) => !/roundRect/.test(s2) && /<p:txBody>/.test(s2) && /<a:t>/.test(s2)).map(textsOf);
      const mergedOk = merged.some((t) => t.includes("O4")) && merged.some((t) => t.includes("O5")) && merged.length === 2;
      const looseOk = ["O1 Заголовок", "O2 Заголовок", "O3 Заголовок", "O6 Заголовок"].every((label) =>
        loose.some((t) => t.includes(label)),
      );
      record("single-box: ран-боксы склеиваются (O4,O5), блочные дети — нет", mergedOk && looseOk, `merged=${merged.length}, loose=${loose.length}`);
    }
  }

  // 5b. Наложения/слипшиеся зазоры: построчный детектор и tight-gap.
  {
    const overlapDeck = assemble("overlap-body.html");
    const orun = runHarness(["probe", overlapDeck]);
    const oout = (orun.stdout || "") + (orun.stderr || "");
    const lineOverlap = (oout.match(/TEXT-OVERLAP/g) || []).length;
    const tightGap = /TIGHT-GAP/.test(oout);
    record(
      "overlap fixture: построчные наложения + tight-gap",
      lineOverlap >= 2 && tightGap,
      `TEXT-OVERLAP×${lineOverlap}, TIGHT-GAP=${tightGap}`,
    );
  }

  // 5c. validate.cjs: контраст-фикстура даёт error, эталон — без ошибок.
  {
    const contrastDeck = assemble("contrast-body.html");
    const cOut = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "presentation-v2-contrast-")), "contrast.pptx");
    const crun = runHarness(["export", contrastDeck, "--out", cOut]);
    let contrastErr = 0;
    if ((crun.status === 0 || crun.status === 1) && fs.existsSync(cOut)) {
      const v = spawnSync(process.execPath, [path.join(SKILL, "helpers", "validate.cjs"), cOut], { encoding: "utf8" });
      contrastErr = (v.stdout || "").split("\n").filter((l) => l.startsWith("error")).length;
    }
    record("validate: контраст-фикстура ловится (CONTRAST error)", contrastErr >= 1, `errors=${contrastErr}`);
  }

  // 6b. Flow-узлы из base.css должны склеиваться (раньше был flex → разрыв).
  {
    const patternsDeck = assemble("patterns-body.html");
    const patOut = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "presentation-v2-flow-")), "patterns.pptx");
    const prun = runHarness(["export", patternsDeck, "--out", patOut]);
    if ((prun.status !== 0 && prun.status !== 1) || !fs.existsSync(patOut)) {
      record("patterns export (flow merge)", false, (prun.stdout || prun.stderr || "").slice(0, 200));
    } else {
      const JSZip = require(path.join(SKILL, "vendor", "jszip.bundle.cjs"));
      const zip = await JSZip.loadAsync(fs.readFileSync(patOut));
      const xml = await zip.file("ppt/slides/slide7.xml").async("string");
      const merged = (xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || []).filter(
        (s2) => /roundRect/.test(s2) && /<p:txBody>/.test(s2) && /<a:t>/.test(s2),
      ).length;
      record("flow-узлы склеиваются в одну фигуру (слайд 7 patterns)", merged === 3, `merged=${merged}`);
    }
  }

  // 7. Автоматические роли медиа + программные признаки (для выбора без зрения).
  {
    const { readDeck } = require(path.join(SKILL, "helpers", "lib", "pptx.cjs"));
    const sample = "/home/maksi/test_agent/artifacts/ГигаКот_Стратегия_final.pptx";
    if (!fs.existsSync(sample)) {
      record("media roles (fixture skipped)", true, "sample deck not found");
    } else {
      const deck = await readDeck(sample);
      const byName = Object.fromEntries(deck.media.map((m) => [m.name, m]));
      const okLogo = byName["image32.svg"] && byName["image32.svg"].role === "logo";
      const okBg = byName["image8.png"] && byName["image8.png"].role === "background" && byName["image8.png"].visual && byName["image8.png"].visual.dark;
      const okDecor = byName["image48.png"] && byName["image48.png"].role === "decor" && byName["image48.png"].visual && byName["image48.png"].visual.hasAlpha;
      record("media roles: logo/background/decor + stats", !!(okLogo && okBg && okDecor), `logo=${okLogo}, bg=${okBg}, decor=${okDecor}`);
    }
  }

  const failed = results.filter((x) => !x.ok);
  console.log(failed.length ? `\nLOCAL ACCEPTANCE: ${failed.length} failure(s)` : "\nLOCAL ACCEPTANCE: all green");
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e.stack || String(e));
  process.exit(1);
});
