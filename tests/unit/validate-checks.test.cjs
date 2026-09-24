#!/usr/bin/env node
// Unit test: validate.cjs checkDeck — new artifact-level checks.
// Uses synthetic deck objects, so no Chromium/Electron is needed.
//
//   node tests/unit/validate-checks.test.cjs
"use strict";

const path = require("path");
const assert = require("assert");
const { checkDeck, mergeHtmlReport } = require(path.join(__dirname, "..", "..", "helpers", "validate.cjs"));

const SLIDE_W = 12192000;
const SLIDE_H = 6858000;

function el(text, o = {}) {
  return {
    kind: "shape",
    id: o.id ?? 2,
    name: o.name ?? "TextBox",
    box: { emu: o.emu ?? { x: 100000, y: 100000, w: 5000000, h: 1600000 } },
    fill: o.fill ?? { type: "none" },
    text: {
      plain: text,
      paragraphs: [
        {
          runs: [{ text, szPt: o.sz ?? 16, color: { hex: o.color ?? "#111111" } }],
          lineSpacingPt: o.lineSpacingPt ?? null,
        },
      ],
      ...(o.autofit ? { autofit: o.autofit } : {}),
      ...(o.fontScalePct !== undefined ? { fontScalePct: o.fontScalePct } : {}),
    },
  };
}

function deck(slides, o = {}) {
  return {
    slideSize: { emu: o.size ?? { cx: SLIDE_W, cy: SLIDE_H } },
    slides: slides.map((s, i) => ({ index: i, notes: s.notes ?? "", elements: s.elements, effectiveBg: s.bg ?? null })),
    fontHistogram: o.fonts ?? [{ font: "Inter", n: 20 }],
    totals: { slides: slides.length, pics: o.pics ?? 0, svgMedia: o.svgMedia ?? 0, embeddedFonts: o.embeddedFonts ?? 1 },
  };
}

const checks = (arr) => arr.map((x) => x.check);
const has = (arr, name) => checks(arr).includes(name);

const BASE = ["Первый тезис этого слайда достаточно длинный, чтобы не попасть под пустоту.", "Второй тезис с цифрой 42 и выводом."];

// 1. Baseline: корректная колода не даёт ошибок.
{
  const res = checkDeck(deck([{ elements: [el(BASE.join(" "))], notes: "заметки" }], { pics: 1 }));
  assert.deepStrictEqual(res.errors, [], "baseline must have no errors: " + JSON.stringify(res.errors));
}

// 2. Минимальный кегль: 6pt — ошибка.
{
  const res = checkDeck(deck([{ elements: [el(BASE[0], { sz: 6 })] }]));
  assert.ok(has(res.errors, "font-size"), "6pt must be a font-size error");
}

// 3. Контраст по WCAG: #999 на белом (2.85:1) — ошибка, 3.0–4.5 — warning.
{
  const bad = checkDeck(deck([{ elements: [el(BASE.join(" "), { color: "#999999", fill: { type: "solid", hex: "#ffffff" } })] }]));
  assert.ok(has(bad.errors, "contrast"), "#999 on white must be a contrast error");
  const warn = checkDeck(deck([{ elements: [el(BASE.join(" "), { color: "#8a8a8a", fill: { type: "solid", hex: "#ffffff" } })] }]));
  assert.ok(has(warn.warnings, "contrast") && !has(warn.errors, "contrast"), "#8a8a8a on white (3.45) must warn, not error");
}

// 4. Заглушки — ошибка.
{
  const res = checkDeck(deck([{ elements: [el("TODO: вставить реальные цифры за квартал")] }]));
  assert.ok(has(res.errors, "placeholder"), "TODO must be a placeholder error");
  const lorem = checkDeck(deck([{ elements: [el("Lorem ipsum dolor sit amet, consectetur adipiscing elit sed do")] }]));
  assert.ok(has(lorem.errors, "placeholder"), "lorem ipsum must be a placeholder error");
}

// 5. Русская типографика — warning.
{
  const quotes = checkDeck(deck([{ elements: [el('Руководитель сказал "привет" на планёрке и ушёл домой')] }]));
  assert.ok(has(quotes.warnings, "typography-quotes"), "straight quotes around Cyrillic must warn");
  const dash = checkDeck(deck([{ elements: [el("Доход вырос на 12% - расходы снизились на 4% за квартал")] }]));
  assert.ok(has(dash.warnings, "typography-dash"), "spaced hyphen must warn");
}

// 6. Размер сцены ≠ 13.333×7.5in — ошибка.
{
  const res = checkDeck(deck([{ elements: [el(BASE.join(" "))] }], { size: { cx: 9144000, cy: 6858000 } }));
  assert.ok(has(res.errors, "slide-size"), "wrong slide size must error");
}

// 7. Нет встроенных шрифтов — ошибка; нет нативного текста — ошибка.
{
  const res = checkDeck(deck([{ elements: [el(BASE.join(" "))] }], { embeddedFonts: 0 }));
  assert.ok(has(res.errors, "embedded-fonts"), "missing embedded fonts must error");
  const imageOnly = checkDeck(
    deck([{ elements: [{ kind: "picture", id: 5, box: { emu: { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H } } }] }], { pics: 1 }),
  );
  assert.ok(has(imageOnly.errors, "native-text"), "image-only deck must error");
}

// 8. normAutofit — warning.
{
  const res = checkDeck(deck([{ elements: [el(BASE.join(" "), { autofit: "shrink", fontScalePct: 80 })] }]));
  assert.ok(has(res.warnings, "autofit"), "fontScalePct < 100 must warn");
}

// 9. Заметки: больше половины слайдов без заметок — warning; мало слайдов — warning.
{
  const res = checkDeck(
    deck([
      { elements: [el(BASE.join(" "))], notes: "есть" },
      { elements: [el(BASE.join(" "))] },
      { elements: [el(BASE.join(" "))] },
      { elements: [el(BASE.join(" "))] },
    ]),
  );
  assert.ok(has(res.warnings, "notes"), "missing notes on most slides must warn");
  assert.ok(!has(res.warnings, "slide-count"), "4 slides is a normal count");
  const two = checkDeck(deck([{ elements: [el(BASE.join(" "))] }, { elements: [el(BASE.join(" "))] }]));
  assert.ok(has(two.warnings, "slide-count"), "2 slides must warn");
}

// 10. HTML-отчёт сливается без потерь: probe-error → error, img-no-alt → warning,
//     fontsMissing → error FONT NOT LOADED.
{
  const out = { errors: [], warnings: [], info: [] };
  const merged = mergeHtmlReport(
    {
      fontsMissing: ["Comic Relief"],
      slides: [
        { index: 0, issues: [{ type: "img-no-alt", detail: "1 image without alt" }, { type: "probe-error", detail: "boom" }] },
        { index: 1, issues: [{ type: "text-clip", detail: "overflow" }] },
      ],
    },
    out,
  );
  assert.strictEqual(merged, 3, "all probe issues must be merged");
  assert.ok(has(out.errors, "html:probe-error") && has(out.errors, "font-not-loaded"), "probe-error and fontsMissing must be errors");
  assert.ok(has(out.errors, "html:text-clip"), "text-clip must be an error");
  assert.ok(has(out.warnings, "html:img-no-alt"), "img-no-alt must be a warning");
}

// 11. Таблицы: текст ячеек считается содержимым; заглушки в ячейках ловятся.
{
  const tableEl = {
    kind: "graphicFrame",
    frame: "table",
    id: 10,
    box: { emu: { x: 500000, y: 2000000, w: 9000000, h: 2000000 } },
    table: {
      rowsData: [
        { cells: [{ text: "Время" }, { text: "Что делает ассистент" }, { text: "Результат" }] },
        { cells: [{ text: "Утро" }, { text: "Собирает саммари входящих документов и отчётов за ночь" }, { text: "Свежая картина дня к первой встрече" }] },
        { cells: [{ text: "Вечер" }, { text: "Структурирует итоги дня в формате отчёта для команды" }, { text: "Отчёт готов без хвостов на следующий день" }] },
      ],
    },
  };
  const res = checkDeck(deck([{ elements: [el(BASE.join(" ")), tableEl] }]));
  assert.ok(!has(res.warnings, "fullness"), "table text must count as content: " + JSON.stringify(res.warnings));
  const stub = { ...tableEl, table: { rowsData: [{ cells: [{ text: "TODO: вставить цифры" }] }] } };
  const res2 = checkDeck(deck([{ elements: [el(BASE.join(" ")), stub] }]));
  assert.ok(has(res2.errors, "placeholder"), "placeholder inside a table must be caught");
}

// 12. Колонтитул — служебный: не превращает разделитель в «контентный» слайд.
{
  const footer = el("Раздел", { emu: { x: 100000, y: 6250000, w: 1200000, h: 300000 } });
  const res = checkDeck(
    deck([{ elements: [el("Разделитель"), el("Что будет в этом разделе."), footer] }]),
  );
  assert.ok(!has(res.warnings, "fullness"), "footer text must not count as content");
}

// 13. decor-as-background: полнослайдовая прозрачная/декорная картинка — ошибка.
{
  const EMU = { W: 12192000, H: 6858000 };
  const pic = (name) => ({
    kind: "picture",
    id: 50,
    media: name,
    box: { emu: { x: 0, y: 0, w: EMU.W, h: EMU.H } },
  });
  const mk = (media, picName) => ({
    slideSize: { emu: { cx: EMU.W, cy: EMU.H } },
    slides: [{ index: 0, notes: "n", elements: [el(BASE.join(" ")), pic(picName)], effectiveBg: null }],
    media,
    fontHistogram: [{ font: "Inter", n: 5 }],
    totals: { slides: 1, pics: 1, svgMedia: 0, embeddedFonts: 1 },
  });
  const res = checkDeck(mk([{ name: "cat.png", role: "decor", visual: { hasAlpha: true } }], "cat.png"));
  assert.ok(has(res.errors, "decor-as-background"), "full-slide transparent decor must be an error");
  const ok = checkDeck(mk([{ name: "bg.jpg", role: "background", visual: { hasAlpha: false } }], "bg.jpg"));
  assert.ok(!has(ok.errors, "decor-as-background"), "a real full-slide background photo must pass");
}

// 14. visual-scarcity: длинная колода почти без графики — warning.
{
  const slides = Array.from({ length: 6 }, () => ({ elements: [el(BASE.join(" "))], notes: "n" }));
  const res = checkDeck(deck(slides, { pics: 0, svgMedia: 0 }));
  assert.ok(has(res.warnings, "visual-scarcity"), "a text-only 6-slide deck must warn about visuals");
  const withIcons = checkDeck(deck(slides, { pics: 2, svgMedia: 4 }));
  assert.ok(!has(withIcons.warnings, "visual-scarcity"), "icons and pictures satisfy the visual budget");
}

// 15. split-box: плашка + отдельный текстбокс — теперь error (одна фигура).
{
  const shape = {
    kind: "shape",
    id: 7,
    name: "Backdrop",
    box: { emu: { x: 1000000, y: 2000000, w: 4000000, h: 1500000 } },
    fill: { type: "solid", hex: "#eeeeee" },
  };
  const label = el(BASE.join(" "), { id: 8, emu: { x: 1200000, y: 2200000, w: 3600000, h: 1100000 } });
  const res = checkDeck(deck([{ elements: [shape, label] }]));
  assert.ok(has(res.errors, "split-box"), "backdrop + separate text must be an error (one-box rule)");
}

console.log("PASS  validate: новые проверки артефакта (кегль, контраст, заглушки, типографика, размер, шрифты, autofit, заметки)");
