#!/usr/bin/env node
// presentation v2 — artifact validation (the self-reflection report).
//
//   ELECTRON_RUN_AS_NODE=1 "$GIGATOOL_NODE" .../validate.cjs <deck.html|deck.pptx> \
//     [--pptx <deck.pptx>] [--out-dir <dir>] [--no-render] [--json <path>]
//
// Two levels, one report:
//   1. HTML level (when a deck.html is given): runs render.cjs and reads its
//      probe report (real Chromium: clip/overflow/contrast/overlap/empty,
//      missing alt text). The report object is returned by renderDeck even
//      when the temp dir is removed, so findings always reach this report.
//   2. PPTX level: reads the exported file with the same parser the skill uses
//      and checks the artifact itself — filled boxes without text, split
//      "backdrop + separate textbox" pairs, WCAG contrast of runs (inheritance
//      chain included), font sizes (readability floor), font variety, text
//      hierarchy, slide fullness, shape density, repeated words, escaped
//      newlines, exact line spacing (the known render-overlap cause), leftover
//      placeholder text, Russian typography (straight quotes / spaced hyphen),
//      PowerPoint normAutofit shrink, speaker notes, slide size, embedded
//      fonts, missing native text and the deck's own slide count. Table cell
//      text counts as content for fullness/typography/placeholders; footer
//      text does not count as content.
//
// Checks are ported from the Python functional suite
// (test_agent/example/checks/functional): empty_text_frame,
// text_background_contrast, font_variety, text_hierarchy, slide_fullness,
// shape_density, repeated_words, escaped_newlines, slide_count.
//
// Thresholds: contrast < 3.0 is an error (WCAG AA large text), 3.0–4.5 is a
// warning (AA for body text); runs below 7.5pt (~10px) are errors, below 9pt
// (~12px) warnings.
//
// Output: one line per finding + `validate: N error(s), M warning(s)` and
// validate.json next to the report. Exit 1 when errors exist.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { readDeck, emuToPx } = require("./lib/pptx.cjs");

const MIN_TEXT = 4; // короче — не считаем содержимым
const MIN_CONTRAST_ERROR = 3.0; // ниже — грубое «сливается» (WCAG AA для крупного текста)
const MIN_CONTRAST_WARN = 4.5; // WCAG AA для обычного текста
const MIN_FONT_PT = 7.5; // ≈10px — нечитаемо, error
const MIN_FONT_WARN_PT = 9; // ≈12px — ниже типографической базы _base.css
const SLIDE_CX_EMU = 12192000; // 13.333in = 1280px при 96dpi
const SLIDE_CY_EMU = 6858000; // 7.5in = 720px
const SLIDE_SIZE_TOL = 0.01; // 1% — допуск на округление
const TRANSITION_MAX_CHARS = 200; // §разделитель = кикер + заголовок + лид, без колонтитула
const TRANSITION_MAX_SHAPES = 3;
const COVER_FRAC = 0.08;
const SPLIT_COVER_FRAC = 0.8;

// Заглушки, которых не должно быть в финальном артефакте.
const PLACEHOLDER_RE =
  /lorem ipsum|\bTODO\b|\bTBD\b|\bFIXME\b|\bplaceholder\b|\{\{[^}]{0,80}\}\}|\[insert[^\]]{0,80}\]|\b[xXхХ]{3,}\b/i;
// Прямые кавычки вокруг кириллицы и дефис с пробелами вместо тире.
const STRAIGHT_QUOTES_RE = /"([^"\n]*[А-Яа-яЁё][^"\n]*)"/;
const SPACED_HYPHEN_RE = /\s-\s/;

// ------------------------------------------------------------------ helpers

const luminance = (hex) => {
  const h = (hex || "").replace("#", "");
  if (h.length !== 6) return null;
  const f = (v) => {
    const x = parseInt(v, 16) / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(h.slice(0, 2)) + 0.7152 * f(h.slice(2, 4)) + 0.0722 * f(h.slice(4, 6));
};

const contrast = (a, b) => {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
};

const box = (el) => (el && el.box && el.box.emu ? el.box.emu : null);
const overlapArea = (a, b) => {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  if (x1 <= x0 || y1 <= y0) return 0;
  return (x1 - x0) * (y1 - y0);
};
const area = (b) => Math.max(0, b.w) * Math.max(0, b.h);

// Все элементы слайда в порядке рисования (включая детей групп).
function flatten(els, out = []) {
  for (const el of els) {
    out.push(el);
    if (el.children) flatten(el.children, out);
  }
  return out;
}

function runColors(el) {
  const out = [];
  if (!el.text) return out;
  for (const p of el.text.paragraphs) {
    for (const r of p.runs) {
      if (!r.text || r.text.trim().length < MIN_TEXT - 3) continue;
      if (r.color && r.color.hex) out.push(r.color.hex);
      if (r.highlight && r.highlight.hex) out.push(r.highlight.hex);
    }
  }
  return out;
}

function textOf(el) {
  return el.text ? el.text.plain : "";
}

// Смешивание полупрозрачной заливки с базовым фоном слайда.
function blendOver(hex, alpha, baseHex) {
  const h = (x) => (x || "").replace("#", "");
  if (h(hex).length !== 6 || h(baseHex).length !== 6) return null;
  const a = Math.max(0, Math.min(1, alpha === undefined || alpha === null ? 1 : alpha));
  const ch = (s, i) => parseInt(s.slice(i, i + 2), 16);
  const to = (i) => Math.round(ch(h(hex), i) * a + ch(h(baseHex), i) * (1 - a));
  return "#" + [to(0), to(2), to(4)].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}

// Базовый непрозрачный фон слайда (solid) для смешивания, если известен.
function baseHex(slide) {
  const eff = slide.effectiveBg;
  if (eff && eff.type === "solid" && eff.hex) return eff.hex;
  return null;
}

// Фон фигуры/слайда для контраста: массив hex (полупрозрачные смешаны с
// базовым фоном слайда) | null, когда измерить нельзя (картинка, без стопов).
function bgColorsFor(el, slide) {
  const base = baseHex(slide);
  const solid = (c) => {
    if (!c || !c.hex) return null;
    if (c.alpha === undefined || c.alpha >= 0.95) return [c.hex];
    const mixed = base ? blendOver(c.hex, c.alpha, base) : null;
    return mixed ? [mixed] : null;
  };
  const gradient = (f) => {
    const out = [];
    for (const st of f.stops || []) {
      if (!st.hex) continue;
      if (st.alpha === undefined || st.alpha >= 0.95) out.push(st.hex);
      else {
        const mixed = base ? blendOver(st.hex, st.alpha, base) : null;
        if (mixed) out.push(mixed);
      }
    }
    return out.length ? out : null;
  };
  const fill = el.fill;
  if (fill && fill.type === "solid") {
    const r = solid(fill);
    if (r) return r;
  }
  if (fill && fill.type === "gradient") {
    const r = gradient(fill);
    if (r) return r;
  }
  if (el.kind === "picture" || !fill || fill.type === "none" || fill.type === "group" || fill.type === "image") {
    const eff = slide.effectiveBg;
    if (eff && eff.type === "solid") return solid(eff);
    if (eff && eff.type === "gradient") return gradient(eff);
    return null;
  }
  return null;
}

// Служебная зона колонтитула: нижние 40px. Текст оттуда не считается
// «содержимым» для наполненности (иначе секции-разделители ловят FULLNESS).
const FOOTER_BAND_PX = 40;

// Текст таблицы (graphicFrame): ячейки живут не в el.text, а в el.table.
function tableText(el) {
  if (!el.table || !Array.isArray(el.table.rowsData)) return "";
  return el.table.rowsData.map((r) => r.cells.map((c) => c.text).join(" ")).join("\n");
}

// ------------------------------------------------------------------- checks

function checkDeck(deck) {
  const errors = [];
  const warnings = [];
  const info = [];
  const slidePx = { w: emuToPx(deck.slideSize.emu.cx), h: emuToPx(deck.slideSize.emu.cy) };
  const isChrome = (el) => {
    const b = box(el);
    return !!b && emuToPx(b.y) + emuToPx(b.h) >= slidePx.h - FOOTER_BAND_PX;
  };

  const isFullSlideBox = (b) => b.w >= deck.slideSize.emu.cx * 0.9 && b.h >= deck.slideSize.emu.cy * 0.9;
  for (const slide of deck.slides) {
    const flat = flatten(slide.elements);
    const shapeBoxes = flat.filter((el) => box(el));
    const texts = flat.filter((el) => el.text && textOf(el).trim().length > 0);
    // Текст таблиц: ячейки не попадают в texts, но это такое же содержимое.
    const tableStrings = flat.map(tableText).filter((t) => t.trim().length > 0);
    const tableChars = tableStrings.reduce((s, t) => s + t.trim().length, 0);

    // --- 1. Пустые залитые боксы (портируем empty_text_frame).
    const lids = [];
    for (const el of shapeBoxes) {
      const hasText = el.text && textOf(el).trim();
      const isPic = el.kind === "picture";
      if (hasText || isPic) lids.push(box(el));
    }
    for (const el of shapeBoxes) {
      if (el.kind !== "shape") continue;
      if (el.text && textOf(el).trim()) continue;
      const f = el.fill;
      if (!f || (f.type !== "solid" && f.type !== "gradient" && f.type !== "image")) continue;
      const b = box(el);
      if (!b || isFullSlideBox(b)) continue; // фон слайда — не плашка
      if (b.w / deck.slideSize.emu.cx < 0.12 || b.h / deck.slideSize.emu.cy < 0.06) continue;
      const covered = lids.reduce((s, lid) => s + overlapArea(b, lid), 0) / Math.max(1, area(b));
      if (covered >= COVER_FRAC) continue;
      errors.push({
        slide: slide.index,
        check: "empty-placeholder",
        detail: `«${el.name || el.id}» — залитая плашка без текста и содержимого (${emuToPx(b.w)}×${emuToPx(b.h)}px)`,
      });
    }

    // --- 2. Разбитые боксы «подложка + отдельный текстбокс».
    for (const el of shapeBoxes) {
      if (el.kind !== "shape") continue;
      if (el.text && textOf(el).trim()) continue;
      const f = el.fill;
      if (!f || f.type === "none" || f.type === "group") continue;
      const b = box(el);
      if (!b || area(b) <= 0 || isFullSlideBox(b)) continue; // фон — не подложка
      for (const t of texts) {
        if (t === el) continue;
        const tb = box(t);
        if (!tb || isFullSlideBox(tb)) continue;
        const cover = overlapArea(tb, b) / Math.max(1, area(tb));
        if (cover >= SPLIT_COVER_FRAC && area(tb) / area(b) <= 0.95) {
          warnings.push({
            slide: slide.index,
            check: "split-box",
            detail: `плашка «${el.name || el.id}» + отдельный текст «${textOf(t).replace(/\\s+/g, " ").slice(0, 40)}» — в PowerPoint это два объекта; текст пишется ранами прямо в бокс`,
          });
        }
      }
    }

    // --- 3. Контраст текста: ниже 3.0 — error, ниже 4.5 — warning (WCAG AA).
    for (const el of texts) {
      const bgs = bgColorsFor(el, slide);
      const runs = runColors(el);
      if (!bgs || !runs.length) continue;
      let worst = Infinity;
      for (const bg of bgs) {
        for (const fg of runs) {
          const c = contrast(fg, bg);
          if (c !== null && c < worst) worst = c;
        }
      }
      const excerpt = `«${textOf(el).replace(/\s+/g, " ").slice(0, 40)}» — контраст ${worst.toFixed(1)}`;
      if (worst < MIN_CONTRAST_ERROR) {
        errors.push({
          slide: slide.index,
          check: "contrast",
          detail: `${excerpt} (< ${MIN_CONTRAST_ERROR}, WCAG AA для крупного текста)`,
        });
      } else if (worst < MIN_CONTRAST_WARN) {
        warnings.push({
          slide: slide.index,
          check: "contrast",
          detail: `${excerpt} (< ${MIN_CONTRAST_WARN}, WCAG AA для обычного текста)`,
        });
      }
    }

    // --- 4. Экранированные переводы строк.
    for (const el of texts) {
      if (/\\n|\\r/.test(textOf(el))) {
        errors.push({ slide: slide.index, check: "escaped-newlines", detail: `«${textOf(el).slice(0, 40)}» содержит литеральный \\n` });
      }
    }

    // --- 4b. Заглушки и русская типографика (текст слайда + таблицы).
    const slideText = [texts.map(textOf).join("\n"), ...tableStrings].join("\n");
    const stub = PLACEHOLDER_RE.exec(slideText);
    if (stub) {
      errors.push({ slide: slide.index, check: "placeholder", detail: `текст-заглушка «${stub[0].slice(0, 40)}» — заменить реальным содержанием` });
    }
    if (STRAIGHT_QUOTES_RE.test(slideText)) {
      warnings.push({ slide: slide.index, check: "typography-quotes", detail: "прямые кавычки в русском тексте — использовать «ёлочки»" });
    }
    if (SPACED_HYPHEN_RE.test(slideText)) {
      warnings.push({ slide: slide.index, check: "typography-dash", detail: "дефис с пробелами вместо тире (— или –)" });
    }

    // --- 5. Наполненность/плотность (slide_fullness, shape_density).
    //      Колонтитул — служебный: он не делает слайд «наполненным» и не
    //      мешает распознать секцию-разделитель.
    const contentTexts = texts.filter((el) => !isChrome(el));
    const chars = contentTexts.reduce((s, el) => s + textOf(el).trim().length, 0) + tableChars;
    const shapeCount = flat.length;
    const isTransition = chars < TRANSITION_MAX_CHARS && contentTexts.length <= TRANSITION_MAX_SHAPES;
    if (!isTransition) {
      if (chars < 160) warnings.push({ slide: slide.index, check: "fullness", detail: `мало текста для контентного слайда (${chars} симв.)` });
      if (chars > 1600) warnings.push({ slide: slide.index, check: "fullness", detail: `перегружен текстом (${chars} симв.)` });
      if (shapeCount > 46) warnings.push({ slide: slide.index, check: "density", detail: `слишком много объектов (${shapeCount})` });
    }

    // --- 6. Иерархия размеров (text_hierarchy): заголовок > текста, ≥3 размеров.
    const sizes = new Set();
    let maxTitle = 0;
    let bodyMin = Infinity;
    for (const el of flat) {
      if (!el.text) continue;
      for (const p of el.text.paragraphs) {
        for (const r of p.runs) {
          if (!r.text || !r.text.trim() || !r.szPt) continue;
          sizes.add(Math.round(r.szPt * 10) / 10);
          if (r._source && (r._source.szPt === "default" || r._source.szPt === "layout" || r._source.szPt === "master")) continue;
          const big = r.szPt >= 24;
          const small = r.szPt <= 16;
          if (big && r.szPt > maxTitle) maxTitle = r.szPt;
          if (small && r.szPt < bodyMin) bodyMin = r.szPt;
        }
      }
    }
    if (!isTransition) {
      if (sizes.size < 3) warnings.push({ slide: slide.index, check: "hierarchy", detail: `меньше трёх размеров текста (${sizes.size})` });
      if (maxTitle && bodyMin < Infinity && maxTitle <= bodyMin) warnings.push({ slide: slide.index, check: "hierarchy", detail: "заголовок не крупнее основного текста" });
    }

    // --- 6b. Минимальный кегль и автоподгонка (normAutofit).
    let worstSize = Infinity;
    let worstSizeText = "";
    let shrink = null;
    for (const el of flat) {
      if (!el.text) continue;
      for (const p of el.text.paragraphs) {
        for (const r of p.runs) {
          if (!r.text || !r.text.trim() || !r.szPt) continue;
          if (r.szPt < worstSize) {
            worstSize = r.szPt;
            worstSizeText = r.text;
          }
        }
      }
      const fsPct = el.text.fontScalePct;
      if (el.text.autofit === "shrink" && fsPct !== undefined && fsPct !== null && fsPct < 100 && fsPct < (shrink ?? Infinity)) {
        shrink = fsPct;
      }
    }
    if (Number.isFinite(worstSize) && worstSize < MIN_FONT_PT) {
      errors.push({
        slide: slide.index,
        check: "font-size",
        detail: `«${worstSizeText.replace(/\s+/g, " ").slice(0, 30)}» набран ${worstSize}pt (< ${MIN_FONT_PT}pt) — нечитаемо`,
      });
    } else if (Number.isFinite(worstSize) && worstSize < MIN_FONT_WARN_PT) {
      warnings.push({ slide: slide.index, check: "font-size", detail: `самый мелкий текст ${worstSize}pt (< ${MIN_FONT_WARN_PT}pt) — проверь читаемость` });
    }
    if (shrink !== null) {
      warnings.push({
        slide: slide.index,
        check: "autofit",
        detail: `PowerPoint может ужать текст до ${shrink}% (normAutofit) — сократи текст или смени паттерн`,
      });
    }

    // --- 7. Повторяющиеся слова (repeated_words, >=4 раза, слово длиннее 7).
    const words = new Map();
    for (const t of [...texts.map(textOf), ...tableStrings]) {
      for (const w of t.toLowerCase().match(/[а-яёa-z]{8,}/gi) || []) {
        words.set(w, (words.get(w) || 0) + 1);
      }
    }
    for (const [w, n] of words) {
      if (n >= 4) info.push({ slide: slide.index, check: "repeated-words", detail: `«${w}» повторяется ${n} раз` });
    }

    // --- 8. Точный межстрочный интервал (причина наложения в рендере).
    for (const el of flat) {
      if (!el.text) continue;
      for (const p of el.text.paragraphs) {
        const ls = p.lineSpacingPt;
        if (!ls) continue;
        const sz = (p.runs[0] && p.runs[0].szPt) || 14;
        if (ls / sz < 1.12) {
          warnings.push({
            slide: slide.index,
            check: "tight-line-spacing",
            detail: `абзац с точным интервалом ${ls}pt при ${sz}pt — при рендере текст может выходить за бокс (лечится pptx-post.cjs)`,
          });
          break;
        }
      }
    }

    // --- 9. Заметки докладчика.
    if (!slide.notes) info.push({ slide: slide.index, check: "notes", detail: "нет заметок докладчика" });
  }

  // Колода целиком.
  // Сцена: экспорт обязан быть 13.333×7.5in (stage 1280×720).
  const sizeOk =
    Math.abs(deck.slideSize.emu.cx - SLIDE_CX_EMU) / SLIDE_CX_EMU <= SLIDE_SIZE_TOL &&
    Math.abs(deck.slideSize.emu.cy - SLIDE_CY_EMU) / SLIDE_CY_EMU <= SLIDE_SIZE_TOL;
  if (!sizeOk) {
    errors.push({
      check: "slide-size",
      detail: `размер слайда ${emuToPx(deck.slideSize.emu.cx)}×${emuToPx(deck.slideSize.emu.cy)}px — нужен 1280×720 (13.33×7.5in, stage.css не менять)`,
    });
  }

  // Нативный текст и встроенные шрифты: колода не должна быть картинками.
  let runTotal = 0;
  for (const slide of deck.slides) {
    for (const el of flatten(slide.elements)) {
      if (!el.text) continue;
      for (const p of el.text.paragraphs) {
        for (const r of p.runs) if (r.text && r.text.trim()) runTotal++;
      }
    }
  }
  if (runTotal === 0) {
    errors.push({
      check: "native-text",
      detail: "в .pptx нет нативного текста — текст растрирован в картинки; собирай деку из паттернов и ранов",
    });
  }
  if (runTotal > 0 && !deck.totals.embeddedFonts) {
    errors.push({
      check: "embedded-fonts",
      detail: "в .pptx не встроено ни одного шрифта (ppt/fonts/*.fntdata) — на чужой машине текст подменится",
    });
  }
  if (deck.totals.slides < 3) {
    warnings.push({ check: "slide-count", detail: `в колоде ${deck.totals.slides} слайд(ов) — для истории обычно нужно ≥3` });
  }

  const fonts = new Set(deck.fontHistogram.map((f) => f.font));
  if (fonts.size > 4) warnings.push({ check: "font-variety", detail: `шрифтов больше четырёх: ${[...fonts].join(", ")}` });
  if (!deck.totals.pics && !deck.totals.svgMedia && deck.totals.slides >= 6) {
    info.push({ check: "image-coverage", detail: "в колоде нет картинок — только текст и фигуры" });
  }
  const missingNotes = deck.slides.filter((s) => !s.notes).length;
  if (deck.totals.slides >= 3 && missingNotes / deck.totals.slides > 0.5) {
    warnings.push({ check: "notes", detail: `заметок докладчика нет на ${missingNotes} из ${deck.totals.slides} слайдов` });
  }
  if (missingNotes === 0 && deck.totals.slides > 1) info.push({ check: "notes", detail: "заметки есть на всех слайдах" });

  return { errors, warnings, info, slideCount: deck.totals.slides, fonts: [...fonts] };
}

// ---------------------------------------------------------------------- CLI

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function mergeHtmlReport(rep, out) {
  if (!rep) return 0;
  let n = 0;
  for (const slide of rep.slides || []) {
    for (const issue of slide.issues || []) {
      n++;
      const detail = `слайд ${slide.index + 1}: ${issue.type}: ${issue.detail}`;
      if (
        ["text-clip", "out-of-bounds", "text-overlap", "low-contrast", "blank", "broken-image", "stage-broken", "probe-error"].includes(
          issue.type,
        )
      ) {
        out.errors.push({ slide: slide.index + 1, check: "html:" + issue.type, detail });
      } else {
        out.warnings.push({ slide: slide.index + 1, check: "html:" + issue.type, detail });
      }
    }
  }
  for (const font of rep.fontsMissing || []) {
    out.errors.push({ check: "font-not-loaded", detail: `шрифт «${font}» не загружен — вендори его или смени токен (FONT NOT LOADED)` });
  }
  return n;
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const positional = argv.filter((a, i) => !a.startsWith("--") && (i === 0 || !argv[i - 1].startsWith("--") || argv[i - 1] === undefined));
  const input = positional[0] || flag("--pptx");
  if (!input) {
    console.error("usage: validate.cjs <deck.html|deck.pptx> [--pptx <file>] [--out-dir <dir>] [--no-render] [--json <path>]");
    process.exit(2);
  }
  const abs = path.resolve(input);
  const out = { errors: [], warnings: [], info: [] };
  let htmlIssues = 0;

  // 1. HTML-уровень: рендер и probe-отчёт. renderDeck returns the parsed
  //    report even when the temp dir was removed, so the probe findings are
  //    never dropped (they used to be read from an already-deleted file).
  if (/\.html?$/i.test(abs) && !argv.includes("--no-render")) {
    const { renderDeck } = require("./render.cjs");
    const r = await renderDeck(abs, { outDir: flag("--out-dir"), pptx: false, noPng: true });
    if (!r.ran) {
      out.errors.push({ check: "render", detail: "рендер не запустился: " + r.reason });
    } else if (r.code !== 0) {
      out.errors.push({ check: "render", detail: `рендер завершился с кодом ${r.code}` + (r.reason ? `: ${r.reason}` : "") });
    } else {
      const report = r.report || readJson(path.join(r.outDir || path.dirname(abs), "report.json"));
      htmlIssues = mergeHtmlReport(report, out);
    }
  }

  // 2. PPTX-уровень.
  const pptxPath = flag("--pptx") ? path.resolve(flag("--pptx")) : abs.replace(/\.html?$/i, ".pptx");
  let deck = null;
  if (fs.existsSync(pptxPath) && /\.pptx$/i.test(pptxPath)) {
    try {
      deck = await readDeck(pptxPath);
      const res = checkDeck(deck);
      out.errors.push(...res.errors);
      out.warnings.push(...res.warnings);
      out.info.push(...res.info);
      out.slideCount = res.slideCount;
      out.fonts = res.fonts;
    } catch (e) {
      out.errors.push({ check: "pptx-read", detail: "не удалось прочитать .pptx: " + (e.message || e) });
    }
  } else if (!/\.html?$/i.test(abs)) {
    out.errors.push({ check: "input", detail: "нет .pptx для проверки: " + pptxPath });
  }

  const jsonPath = flag("--json") || path.join(flag("--out-dir") || os.tmpdir(), `presentation-v2-validate-${process.pid}.json`);
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify({ input: abs, pptx: deck ? pptxPath : null, ...out }, null, 2));

  const line = (kind, e) => `${kind} ${e.slide ? "slide " + e.slide + ": " : ""}${e.check.toUpperCase()}: ${e.detail}`;
  for (const e of out.errors) console.log(line("error", e));
  for (const w of out.warnings) console.log(line("warn ", w));
  if (out.errors.length + out.warnings.length === 0) {
    console.log(`validate: clean — ${out.slideCount || "?"} slide(s), HTML issues: ${htmlIssues}`);
  } else {
    console.log(`validate: ${out.errors.length} error(s), ${out.warnings.length} warning(s), ${out.slideCount || "?"} slide(s)`);
  }
  console.log("validate json: " + jsonPath);
  process.exit(out.errors.length ? 1 : 0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.stack || String(e));
    process.exit(1);
  });
}

module.exports = { checkDeck, mergeHtmlReport };
