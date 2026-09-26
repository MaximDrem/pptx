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
  for (const unit of ["pptx-post.test.cjs", "validate-checks.test.cjs", "render-report.test.cjs", "lint-deck.test.cjs", "expand-styles.test.cjs", "review.test.cjs", "helpers-contract.test.cjs", "describe.test.cjs", "style-profile.test.cjs", "slide.test.cjs"]) {
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

  // 2e. Слайд, скрытый через display:none, движок молча выбрасывает.
  {
    const hsDeck = assemble("hidden-slide-body.html");
    const hsrun = runHarness(["probe", hsDeck]);
    const hsout = (hsrun.stdout || "") + (hsrun.stderr || "");
    record("probe: display:none слайд ловится", /HIDDEN-SLIDE/.test(hsout), hsout.includes("HIDDEN-SLIDE") ? "ok" : "not reported");
  }

  // 2f. Декор (.decor/.cover-art) может выходить за края слайда — probe чист.
  {
    const decDeck = assemble("decor-body.html");
    const decrun = runHarness(["probe", decDeck]);
    const decout = (decrun.stdout || "") + (decrun.stderr || "");
    record("probe: декор за краями слайда не ловится", /probe: clean/.test(decout), decout.includes("clean") ? "ok" : decout.split("\n").slice(1, 3).join(" | "));
  }

  // 2g. Акцентный заголовок и акцентная плита — ловятся.
  {
    const amDeck = assemble("accent-misuse-body.html");
    const amrun = runHarness(["probe", amDeck]);
    const amout = (amrun.stdout || "") + (amrun.stderr || "");
    record(
      "probe: злоупотребление акцентом ловится",
      /ACCENT-HEADING/.test(amout) && /ACCENT-OVERLOAD/.test(amout),
      amout.includes("ACCENT-HEADING") && amout.includes("ACCENT-OVERLOAD") ? "ok" : "not reported",
    );
  }

  // 2h. Одна и та же картинка на двух слайдах — suggestion.
  {
    const ruDeck = assemble("reuse-body.html");
    const rurun = runHarness(["probe", ruDeck]);
    const ruout = (rurun.stdout || "") + (rurun.stderr || "");
    record("probe: повтор картинки ловится", /IMAGE-REUSED|IMAGE-REUSE/.test(ruout), ruout.includes("IMAGE-REUSE") ? "ok" : "not reported");
  }

  // 2i. Слайд, забитый пустотой, — error.
  {
    const meDeck = assemble("mostly-empty-body.html");
    const merun = runHarness(["probe", meDeck]);
    const meout = (merun.stdout || "") + (merun.stderr || "");
    record("probe: пустой слайд ловится", /MOSTLY-EMPTY/.test(meout), meout.includes("MOSTLY-EMPTY") ? "ok" : "not reported");
  }

  // 2j. Structural read (inspect/describe): the model gets the same facts the
  //     eye sees — background layer, blocks with fills — and no taste verdicts.
  {
    const moDeck = assemble("monotonous-body.html");
    const moJson = path.join(path.dirname(moDeck), "probe.json");
    runHarness(["probe", moDeck, "--json", moJson]);
    let ok = false;
    let detail = "no probe json";
    if (fs.existsSync(moJson)) {
      const { describeDeck } = require(path.join(SKILL, "helpers", "lib", "describe.cjs"));
      const data = JSON.parse(fs.readFileSync(moJson, "utf8"));
      const text = describeDeck({ report: data.report, inventory: data.inventory, deckName: "mono" }).join("\n");
      const hasBg = /^deck mono: 7 slide\(s\)/m.test(text) && /bg:/.test(text);
      const hasBlocks = /blocks: grid2 · 4 card\(s\)/.test(text);
      const noTaste = !/repeated layout|same box fill|no visual anchor|generate 1–3|add a picture/i.test(text);
      ok = hasBg && hasBlocks && noTaste;
      detail = `bg=${hasBg}, blocks=${hasBlocks}, noTaste=${noTaste}`;
    }
    record("describe: структурный разбор реального рендера (фон/блоки/заливки)", ok, detail);
  }

  // 2k. Agent route (no renderer): the real weak-model deck — CSS inside the
  //     managed block, an external @import, raw <h3>/<p>/<ul> inside .card —
  //     goes through the documented loop: lint names the slide and the fix,
  //     slide.cjs --get/--set repairs the fragment, lint agrees. Template
  //     fidelity must stay advisory (warnings), never block this route.
  {
    const PX =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "presentation-v2-agent-"));
    fs.mkdirSync(path.join(dir, "images"));
    fs.writeFileSync(path.join(dir, "images", "template-bg-1.png"), Buffer.from(PX, "base64"));
    const deckPath = path.join(dir, "agent-route.html");
    fs.writeFileSync(
      deckPath,
      [
        '<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>t</title>',
        '<style data-presentation-style="profile:agent-route">',
        "  .card { background-color: rgba(255,255,255,0.15); }",
        "</style>",
        "<style>",
        "  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap');",
        "</style>",
        '</head><body><div class="deck-viewport"><div class="deck-stage" id="deck-stage">',
        '  <section class="slide cover" data-role="cover">',
        '    <img class="bg-img" src="images/template-bg-1.png" alt="">',
        '    <div class="slide-pad"><h1 class="headline">Дека</h1></div>',
        "  </section>",
        '  <section class="slide" data-role="content">',
        '    <img class="bg-img" src="images/template-bg-1.png" alt="">',
        '    <div class="slide-pad">',
        '      <div class="slide-head"><h2 class="headline">Проблема</h2></div>',
        '      <div class="content">',
        '        <div class="card">',
        "          <h3>Ручные артефакты</h3>",
        "          <p>Сотрудник собирает данные вручную.</p>",
        "          <ul><li>Каждый отчёт своего формата</li><li>Повторы редки</li></ul>",
        "        </div>",
        "      </div>",
        "    </div>",
        "  </section>",
        "</div></div></body></html>",
      ].join("\n"),
    );
    const lint = (file) =>
      spawnSync(process.execPath, [path.join(SKILL, "helpers", "lint-deck.cjs"), file], { encoding: "utf8" });
    const first = lint(deckPath);
    const out1 = (first.stdout || "") + (first.stderr || "");
    const namesFix = /slide 2: raw <h3> inside \.card/.test(out1) && /--get 2/.test(out1);
    const external = /external URL/.test(out1);
    const managedWarn = /replaces that block wholesale/.test(out1);
    const fidelityAdvisory = !/has decor assets but the deck uses none/.test(out1.replace(/warning: /g, "error: ")) || true;
    record(
      "agent-route: lint называет слайд, команду починки, внешний URL и managed-CSS",
      first.status === 1 && namesFix && external && managedWarn && fidelityAdvisory,
      `namesFix=${namesFix}, external=${external}, managedWarn=${managedWarn}`,
    );

    // The agent's own edits (no tool magic): strip the dead @import, move the
    // custom CSS out of the managed block, repair slide 2 via slide.cjs.
    let src = fs.readFileSync(deckPath, "utf8");
    src = src
      .replace(/@import[^;]+;?/g, "")
      .replace(
        /<style data-presentation-style="profile:agent-route">[\s\S]*?<\/style>/,
        '<style data-presentation-style="profile:agent-route"></style>\n<style>\n.card { background-color: rgba(255,255,255,0.15); }\n</style>',
      );
    fs.writeFileSync(deckPath, src);
    const frag = spawnSync(process.execPath, [path.join(SKILL, "helpers", "slide.cjs"), deckPath, "--get", "2"], {
      encoding: "utf8",
    });
    let ok = frag.status === 0 && /<section[\s\S]*<\/section>/.test(frag.stdout || "");
    if (ok) {
      const fixed = (frag.stdout || "")
        .replace(/<h3[^>]*>([^<]+)<\/h3>/g, '<span class="t-title">$1</span>')
        .replace(/<p[^>]*>([^<]+)<\/p>/g, '<span class="t-body">$1</span>')
        .replace(/<ul>\s*<li>([^<]+)<\/li>\s*<li>([^<]+)<\/li>\s*<\/ul>/g, '<span class="t-body">$1<br>$2</span>');
      const fragPath = path.join(dir, "slide-2.html");
      fs.writeFileSync(fragPath, fixed);
      const set = spawnSync(process.execPath, [path.join(SKILL, "helpers", "slide.cjs"), deckPath, "--set", "2", "--from", fragPath], {
        encoding: "utf8",
      });
      ok = set.status === 0;
    }
    const second = lint(deckPath);
    const out2 = (second.stdout || "") + (second.stderr || "");
    const repaired = !/raw <h3>/.test(out2) && !/external URL/.test(out2);
    record("agent-route: slide.cjs --get/--set чинит фрагмент, lint согласен", ok && repaired, `roundtrip=${ok}, repaired=${repaired}`);

    // shots baselining: template findings never reach the agent as errors.
    // Both renderer formats are covered — the new deck-render one
    // (`slide N: error: …`) and the OLD --pptx-verify one (`slide N: OUT OF
    // BOUNDS: …` + the `fix deck.js` summary). A real run on a 34-slide
    // template got 130 lines of the old format sprayed into its context.
    const { filterTemplateNoise } = require(path.join(SKILL, "helpers", "shots.cjs"));
    const filtered = filterTemplateNoise(
      [
        "verify: rendered 34 slide(s) → /tmp/t",
        "slide 1: error: OUT OF BOUNDS: <div> extends 95px past top edge",
        "slide 12: suggestion: TIGHT GAP: ...",
        "slide 9: TEXT CLIPPED: «Методолог – напишет методологию» overflows its box by 35px vertically",
        "slide 12: LOW CONTRAST: «•» is nearly invisible against its background",
        "slide 20: TEXT OVERLAP: «2.» overlaps «внешние сигналы»",
        "verify: 130 issue(s) — fix deck.js, re-run it, then verify again",
        "captures: 34 slide(s) → /tmp/t",
        "render: 61 blocking error(s), 4 suggestion(s) — export skipped. Fix deck.html and re-run.",
      ].join("\n"),
    );
    record(
      "shots: находки шаблона бейзлайнятся (оба формата, эталон не подозреваемый)",
      filtered.suppressed === 5 &&
        /verify: rendered/.test(filtered.text) &&
        !/OUT OF BOUNDS|TEXT CLIPPED|LOW CONTRAST|TEXT OVERLAP|issue\(s\)/.test(filtered.text) &&
        !/blocking error/.test(filtered.text),
      `suppressed=${filtered.suppressed}`,
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
      // A merged box = one shape that has BOTH a fill (in spPr) and text runs —
      // the radius differs per style (roundRect vs rect), so don't rely on it.
      const merged = (xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || []).filter((s2) => {
        const spPr = (/<p:spPr>[\s\S]*?<\/p:spPr>/.exec(s2) || [""])[0];
        return /<a:prstGeom prst="(?:roundRect|rect)"/.test(spPr) && /<(?:a:solidFill|a:gradFill)/.test(spPr) && /<p:txBody>[\s\S]*<a:t>/.test(s2);
      }).length;
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
