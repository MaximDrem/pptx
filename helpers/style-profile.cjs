#!/usr/bin/env node
// presentation v2 — extract a reusable style profile from an attached .pptx:
//
//   ELECTRON_RUN_AS_NODE=1 "$GIGATOOL_NODE" .../style-profile.cjs deck.pptx \
//     --name "Сбер Кот" [--slug sber-kot] [--max-assets 8] [--assets none|key|all]
//
// The profile lands in ~/.wsc/config/styles/<slug>/ — OUTSIDE the skill folder,
// so it survives skill re-seeding (the built-in styles/ dir is replaced on
// update; user profiles are not). Contents:
//
//   profile.json   evidence: theme colors/fonts, histograms, density, notes
//   tokens.css     paste-ready :root block (bg/surface/ink/muted/accent/…)
//   assets/        key decorative media extracted from the deck (svg/png/…)
//
// "Сделай презентацию про X в этом стиле": read profile.json + tokens.css,
// paste tokens before _base.css, reuse assets/ files, keep the layout
// principles it lists. The source deck itself is never copied.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { readDeck } = require("./lib/pptx.cjs");

const TOP = (arr, n) => arr.slice(0, n);

const TRANSLIT = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k",
  л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
  ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function slugify(name) {
  const lower = String(name).toLowerCase();
  let out = "";
  for (const ch of lower) out += TRANSLIT[ch] !== undefined ? TRANSLIT[ch] : ch;
  return out
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "style";
}

function isNeutral(hex) {
  if (!hex) return true;
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  return sat < 0.18 || max < 40 || min > 230;
}

function luminance(hex) {
  const h = hex.replace("#", "");
  const f = (v) => {
    const x = parseInt(v, 16) / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(h.slice(0, 2)) + 0.7152 * f(h.slice(2, 4)) + 0.0722 * f(h.slice(4, 6));
}

function pickColors(deck) {
  const theme = (deck.themeUsage && deck.themeUsage[0] && deck.themes.find((t) => t.part === deck.themeUsage[0].theme)) || deck.theme;
  const scheme = theme.colors || {};
  const hist = deck.colorHistogram.filter((c) => !isNeutral(c.hex));
  const accent = (hist[0] && hist[0].hex) || scheme.accent1 || "#2447F0";
  const accent2 = (hist[1] && hist[1].hex) || scheme.accent2 || null;

  // Background survey across the inheritance chain (slide → full-slide layer
  // → layout → master). Image backgrounds dominate many corporate decks.
  const bgCount = new Map();
  let imageBgSlides = 0;
  let gradientBgSlides = 0;
  const bgSources = new Map();
  for (const s of deck.slides) {
    const src = s.effectiveBgSource || "none";
    bgSources.set(src, (bgSources.get(src) || 0) + 1);
    const b = s.effectiveBg;
    if (!b) continue;
    if (b.type === "image") imageBgSlides++;
    else if (b.type === "gradient") {
      gradientBgSlides++;
      // The darkest stop drives the perceived background tone.
      const stops = (b.stops || []).filter((st) => st.hex);
      if (stops.length) {
        const darkest = stops.slice().sort((a, c) => luminance(a.hex) - luminance(c.hex))[0];
        bgCount.set(darkest.hex, (bgCount.get(darkest.hex) || 0) + 1);
      }
    } else if (b.type === "solid" && b.hex) bgCount.set(b.hex, (bgCount.get(b.hex) || 0) + 1);
  }
  const voted = [...bgCount.entries()].sort((a, b) => b[1] - a[1]);
  const solidBg = voted.length ? voted[0] : null;

  // Real background pixels (when the media inventory could decode them) beat
  // any heuristic: average color and darkness decide the page tone.
  const bgMedia = deck.media.filter((m) => m.role === "background" && m.visual && m.visual.avgColor);
  const bgStats = bgMedia.sort((a, b) => b.usedBySlides.length - a.usedBySlides.length)[0];

  // Dark or light: image backgrounds and bright body text both mean "dark deck".
  let brightText = 0;
  let darkText = 0;
  const walkText = (els) => {
    for (const el of els) {
      if (el.text) {
        for (const p of el.text.paragraphs) {
          for (const r of p.runs) {
            if (r.color && r.color.hex) {
              if (luminance(r.color.hex) > 0.6) brightText++;
              else if (luminance(r.color.hex) < 0.25) darkText++;
            }
          }
        }
      }
      if (el.children) walkText(el.children);
    }
  };
  for (const s of deck.slides) walkText(s.elements);
  const slides = Math.max(1, deck.totals.slides);
  const darkBg =
    (bgStats && bgStats.visual.dark) ||
    imageBgSlides * 2 >= slides ||
    gradientBgSlides * 2 >= slides ||
    brightText > darkText * 1.2 ||
    (solidBg ? luminance(solidBg[0]) < 0.2 : false);

  let bgHex;
  if (darkBg) {
    const statsHex = bgStats && bgStats.visual.luminance < 0.2 ? bgStats.visual.avgColor : null;
    const darkVote = voted.find(([hex]) => luminance(hex) < 0.25);
    bgHex = statsHex || (darkVote ? darkVote[0] : "#0B0F1A");
  } else {
    bgHex = solidBg ? solidBg[0] : "#FFFFFF";
  }
  const ink = darkBg ? "#F2F5F9" : "#0B0B0C";
  const muted = darkBg ? "#93A1B3" : "#63666B";
  // Тёмная поверхность — лёгкое осветление фона (не ×2, иначе цвет уезжает);
  // светлая — лёгкое затемнение.
  const surface = darkBg ? mix(bgHex, "#FFFFFF", 0.08) : shade(bgHex, 0.955);

  return {
    theme,
    scheme,
    accent,
    accent2,
    bg: bgHex,
    surface,
    ink,
    muted,
    darkBg,
    bgStats,
    imageBgSlides,
    gradientBgSlides,
    bgEvidence: deck.slides
      .slice(0, 6)
      .map((sl) => ({ slide: sl.index, type: sl.effectiveBg ? sl.effectiveBg.type : "none", source: sl.effectiveBgSource })),
    backgroundMedia: [
      ...new Set(
        deck.slides
          .map((sl) => sl.effectiveBg && sl.effectiveBg.media)
          .filter(Boolean),
      ),
    ],
    bgSources: [...bgSources.entries()].map(([k, v]) => `${k}:${v}`).join(" "),
  };
}

function mix(hex, other, ratio) {
  const a = hex.replace("#", "");
  const b = other.replace("#", "");
  const to = (i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - ratio) + parseInt(b.slice(i, i + 2), 16) * ratio);
  return "#" + [to(0), to(2), to(4)].map((v) => v.toString(16).padStart(2, "0").toUpperCase()).join("");
}

function shade(hex, factor) {
  const h = hex.replace("#", "");
  const to = (v) => Math.max(0, Math.min(255, Math.round(parseInt(v, 16) * factor)));
  return "#" + [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)].map((c) => to(c).toString(16).padStart(2, "0").toUpperCase()).join("");
}

function pickFonts(deck) {
  const byCount = deck.fontHistogram;
  const body = (byCount[0] && byCount[0].font) || (deck.themeUsage && deck.themeUsage[0] && deck.themeUsage[0].minor) || "Inter";
  // Display: the most frequent font among runs ≥ 28pt.
  const big = new Map();
  const walk = (els) => {
    for (const el of els) {
      if (el.text) {
        for (const p of el.text.paragraphs) {
          for (const r of p.runs) {
            if (r.font && r.szPt && r.szPt >= 28) big.set(r.font, (big.get(r.font) || 0) + 1);
          }
        }
      }
      if (el.children) walk(el.children);
    }
  };
  for (const s of deck.slides) walk(s.elements);
  const display = [...big.entries()].sort((a, b) => b[1] - a[1])[0];
  return { display: (display && display[0]) || body, body };
}

function pickAssets(deck, mode) {
  if (mode === "none") return [];
  // Key art by ROLE (computed automatically from geometry/usage/stats):
  // backgrounds and logos first, then decor, then icons and vector art.
  const roleScore = { background: 60, logo: 50, decor: 40, icon: 20, photo: 10, graphic: 10 };
  const score = (m) => {
    let s = roleScore[m.role] || 0;
    if (m.kind === "vector") s += 40;
    if (m.usedAsBackground) s += 30;
    if (m.usedBySlides.length >= 2) s += 15;
    if (m.visual && m.visual.hasAlpha) s += 5;
    if (/logo|icon|decor|mark/i.test(m.name)) s += 5;
    if (["emf", "wmf", "wdp"].includes(m.ext)) s -= 80; // нельзя встроить в HTML
    return s;
  };
  const ranked = deck.media
    .filter((m) => m.usedBySlides.length || (m.usedByParts && m.usedByParts.length))
    .sort((a, b) => score(b) - score(a));
  const cap = mode === "all" ? 64 : 8;
  return TOP(ranked, cap).filter((m) => !(mode === "key" && ["emf", "wmf", "wdp"].includes(m.ext)));
}

async function extractAssets(deckFile, mediaList, dir) {
  const { openPptx } = require("./lib/pptx.cjs");
  const deck = await openPptx(deckFile);
  fs.mkdirSync(dir, { recursive: true });
  const written = [];
  for (const m of mediaList) {
    if (m.bytes > 12 * 1024 * 1024) continue;
    const buf = await deck.readBuf("ppt/media/" + m.name);
    if (!buf) continue;
    fs.writeFileSync(path.join(dir, m.name), buf);
    written.push({
      name: m.name,
      kind: m.kind,
      role: m.role || null,
      why: m.roleWhy || null,
      bytes: buf.length,
      usedBySlides: m.usedBySlides.slice(0, 6),
    });
  }
  return written;
}

function tokensCss(p, slug) {
  return `/* Style profile «${slug}» — extracted from a presentation.
   Paste order: stage.css → this file → styles/_base.css. */
:root {
  --stage-bg: #101216;
  --slide-bg: ${p.bg};
  --c-bg: ${p.bg};
  --c-surface: ${p.surface};
  --c-ink: ${p.ink};
  --c-muted: ${p.muted};
  --c-accent: ${p.accent};
  --c-on-accent: ${p.darkBg ? "#062430" : "#FFFFFF"};
  --c-line: rgba(${p.darkBg ? "242, 245, 249" : "11, 11, 12"}, 0.16);
  --radius: 4px;
  --f-display: "${p.fonts.display}", Arial, sans-serif;
  --f-body: "${p.fonts.body}", Arial, sans-serif;
  --f-mono: "JetBrains Mono", monospace;
}
`;
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const positional = argv.filter((a, i) => !a.startsWith("--") && (argv[i - 1] === undefined || !argv[i - 1].startsWith("--")));
  const file = positional[0];
  if (!file) {
    console.error('usage: style-profile.cjs <deck.pptx> --name "Название" [--slug id] [--assets none|key|all] [--max-assets N] [--out-dir dir]');
    process.exit(2);
  }
  const name = flag("--name") || path.basename(file).replace(/\.pptx$/i, "");
  // --slug идёт в путь: пропускаем через slugify, чтобы ../../x не убежал из styles/.
  const slug = slugify(flag("--slug") || name);
  const assetsMode = flag("--assets") || "key";
  if (!["none", "key", "all"].includes(assetsMode)) {
    console.error(`style-profile.cjs: --assets must be none|key|all (got «${assetsMode}»)`);
    process.exit(2);
  }
  const outRoot = path.resolve(flag("--out-dir") || path.join(os.homedir(), ".wsc", "config", "styles"));
  const dir = path.join(outRoot, slug);

  const deck = await readDeck(file);
  const colors = pickColors(deck);
  const fonts = pickFonts(deck);
  const media = pickAssets(deck, assetsMode);
  const maxRaw = flag("--max-assets");
  const maxAssets = maxRaw === undefined ? undefined : Math.max(0, parseInt(maxRaw, 10) || 0);
  const chosen = maxAssets === undefined ? media : media.slice(0, maxAssets);

  fs.mkdirSync(dir, { recursive: true });
  const assets = await extractAssets(file, chosen, path.join(dir, "assets"));
  const profile = {
    v: 2,
    slug,
    name,
    extractedAt: new Date().toISOString(),
    source: { file: path.basename(file), slides: deck.totals.slides, size: deck.slideSize.in, bytes: deck.bytes },
    theme: {
      colors: colors.scheme,
      fonts: { major: deck.theme.fonts.major.latin || null, minor: deck.theme.fonts.minor.latin || null },
      perSlide: deck.themeUsage,
    },
    tokens: {
      bg: colors.bg,
      surface: colors.surface,
      ink: colors.ink,
      muted: colors.muted,
      accent: colors.accent,
      accentAlt: colors.accent2,
      dark: colors.darkBg,
    },
    fonts: {
      display: fonts.display,
      body: fonts.body,
      histogram: TOP(deck.fontHistogram, 8),
      note: "Вендорные лица из fonts/ скилла: Inter, Source Serif 4, Unbounded, JetBrains Mono. Если в теме чужое лицо — подставить ближайшее вендорное и сказать пользователю, что шрифт заменён.",
    },
    colors: { top: TOP(deck.colorHistogram, 12) },
    density: {
      shapesPerSlide: +(deck.totals.shapes / deck.totals.slides).toFixed(1),
      picsPerSlide: +(deck.totals.pics / deck.totals.slides).toFixed(1),
      gradients: deck.totals.gradients,
      custGeom: deck.totals.custGeom,
      notes: deck.totals.notes,
      imageBackgrounds: deck.slides.filter((s) => s.bg && s.bg.type === "image").length,
    },
    media: {
      total: deck.totals.media,
      svg: deck.totals.svgMedia,
      roles: deck.media.reduce((acc, m) => {
        if (m.role) acc[m.role] = (acc[m.role] || 0) + 1;
        return acc;
      }, {}),
      backgroundEvidence: colors.bgStats
        ? { name: colors.bgStats.name, avgColor: colors.bgStats.visual.avgColor, dark: !!colors.bgStats.visual.dark, slides: colors.bgStats.usedBySlides.length }
        : null,
      extracted: assets,
      note: "extracted — файлы в assets/ рядом с профилем; это оформление из исходной деки (фоны, логотипы, декор).",
    },
    principles: buildPrinciples(deck, colors, fonts),
  };
  fs.writeFileSync(path.join(dir, "profile.json"), JSON.stringify(profile, null, 2));
  fs.writeFileSync(path.join(dir, "tokens.css"), tokensCss(profile.tokens ? { ...colors, fonts } : { ...colors, fonts }, slug));

  console.log("style profile: " + dir);
  console.log(
    `tokens: bg=${colors.bg} surface=${colors.surface} ink=${colors.ink} accent=${colors.accent} ` +
      `display="${fonts.display}" body="${fonts.body}"`,
  );
  console.log(`assets: ${assets.length} file(s)${assets.length ? " → " + path.join(dir, "assets") : ""}`);
  if (colors.imageBgSlides) console.log(`note: ${colors.imageBgSlides} slide(s) use image backgrounds — reuse assets/ backgrounds or a plain token bg`);
  console.log("use: paste tokens.css before styles/_base.css; read profile.json for principles and evidence");
}

function buildPrinciples(deck, colors, fonts) {
  const out = [];
  out.push(`Фон ${colors.darkBg ? "тёмный" : "светлый"} (${colors.bg}); поверхность/карточки — surface; текст — ink/muted.`);
  out.push(`Акцент один: ${colors.accent}. Не вводить другие насыщенные цвета.`);
  out.push(`Заголовки — ${fonts.display}, текст — ${fonts.body}.`);
  const perSlide = deck.totals.shapes / Math.max(1, deck.totals.slides);
  if (perSlide > 18) out.push("Плотная декомпозиция: много прямоугольных блоков/карточек на слайд — держать модульную сетку.");
  else out.push("Разреженная вёрстка: 2–4 крупных блока на слайд, много воздуха.");
  if (deck.totals.gradients > deck.totals.slides) out.push("Есть градиентные акценты — воспроизводить один-два на деку, не больше.");
  if (deck.totals.notes) out.push("В исходной деке были заметки докладчика — писать заметки через <template data-pptx-notes>.");
  if (deck.slides.some((s) => (s.bg && s.bg.type === "image") || false)) out.push("Фоны-картинки: взять из assets/ или заменить сплошным токеном.");
  return out;
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.stack || String(e));
    process.exit(1);
  });
}

module.exports = { slugify };
