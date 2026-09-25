"use strict";
// helpers/lib/describe.cjs — structured "second pair of eyes" for a rendered deck.
//
// The model DOES see the PNG captures (vision). What it cannot do is read the
// DOM / computed layout like a developer can: tell a card from decoration,
// name a fill, measure the empty band, count anchors, or notice that a
// deployed template asset is never used. These pure functions turn probe's
// report + inventory + the deployed template-assets.md into that structural
// read — the data one gets from DevTools and the template manifest — so vision
// and numbers describe the same slide.
//
// Input is what probe.js already returns — report (issues per slide) +
// inventory (computed elements/blocks/layers per slide) — plus the deployed
// template-assets.md. Output is a per-slide structural description
// (background, decor + position, heading, blocks, fills, empty band, issues)
// and a factual map of which template assets the deck uses where.
//
// Pure functions, no browser: inspect.cjs feeds them a real render, review.cjs
// reuses its render, unit tests feed fixtures.

const fs = require("fs");
const path = require("path");

const PATTERNS = [
  "kpi-row",
  "grid2",
  "grid3",
  "grid4",
  "split",
  "flow",
  "timeline",
  "table",
  "steps",
  "donut",
  "matrix",
  "funnel",
  "quote",
  "list",
  "chart",
  "bars",
  "hbars",
];
const PATTERN_RE = new RegExp("\\b(" + PATTERNS.join("|") + ")\\b");
const DECOR_RE = /\b(decor|cover-art)\b/;
const ICON_RE = /\b(icon|icon-badge)\b/;
const ACCENT_RE = /\baccent\b|\baccent-text\b/;

const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
const short = (s, n) => {
  const t = norm(s);
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};
const base = (src) => (src || "").split(/[\\/]/).pop();

function classes(el) {
  return (el && el.cls ? el.cls : "").split(/\s+/).filter(Boolean);
}
function hasPattern(el) {
  return PATTERN_RE.test(el && el.cls ? el.cls : "");
}
function hasIcon(el) {
  return ICON_RE.test(el && el.cls ? el.cls : "");
}

// Blocks that act as a visual anchor even without an image/icon.

function semanticCounts(blocks) {
  const count = (re) => blocks.filter((b) => re.test(b.cls || "")).length;
  const out = [];
  const stats = count(/\bstat\b/);
  const nums = count(/\bnum\b/);
  const steps = count(/\bstep\b/);
  const pills = count(/\bpill\b/);
  const quotes = count(/\bquote\b/);
  if (stats || nums) out.push(`${Math.max(stats, nums)} number block(s)`);
  if (steps) out.push(`${steps} step(s)`);
  if (pills) out.push(`${pills} pill(s)`);
  if (quotes) out.push("quote");
  return out;
}

// ---------------------------------------------------------------- one slide

function analyzeSlide(inv, issues) {
  inv = inv || {};
  const elements = Array.isArray(inv.elements) ? inv.elements : [];
  const blocks = Array.isArray(inv.blocks) ? inv.blocks : [];
  const layers = Array.isArray(inv.layers) ? inv.layers : [];

  const headline = elements.find((e) => /\bheadline\b/.test(e.cls || "")) || elements.find((e) => /^h[12]$/.test(e.tag || ""));
  const kicker = elements.find((e) => /\bkicker\b/.test(e.cls || ""));
  const lead = elements.find((e) => /\blead\b/.test(e.cls || ""));

  const bgImage = layers.find((l) => l.kind === "image" && /\bbg-img\b/.test(l.cls || "")) || layers.find((l) => l.kind === "image");
  const paintLayers = layers.filter((l) => l !== bgImage);
  const decors = blocks.filter((b) => DECOR_RE.test(b.cls || ""));
  const decorImgs = elements.filter((e) => /\bdecor-img\b/.test(e.cls || ""));
  const logo = elements.find((e) => /\blogo\b/.test(e.cls || ""));
  const images = elements.filter((e) => e.tag === "img" && e.src && !/\b(decor-img|bg-img|logo)\b/.test(e.cls || ""));
  const icons = blocks.filter(hasIcon).length + elements.filter((e) => e.tag === "svg" && hasIcon(e)).length;
  const patterns = new Set();
  for (const el of blocks.concat(elements)) for (const c of classes(el)) if (PATTERN_RE.test(c)) patterns.add(c);
  const cards = blocks.filter((b) => /\bcard\b/.test(b.cls || ""));
  const fills = [...new Set(cards.map((c) => c.fill).filter(Boolean))];
  const accents = blocks.filter((b) => ACCENT_RE.test(b.cls || "")).length + elements.filter((e) => ACCENT_RE.test(e.cls || "")).length;
  const charts = blocks.filter((b) => /\b(chart|bars|hbars|donut)\b/.test(b.cls || "")).length;
  const numberBlocks = blocks.filter((b) => /\b(stat|num|step|kpi-row|pill)\b/.test(b.cls || "")).length;

  return {
    index: inv.index,
    role: inv.role || "content",
    bgColor: inv.bg || "",
    coverage: inv.coverage || 0,
    notes: inv.notes || "",
    headline: headline ? { text: short(headline.text, 72), size: headline.size, lines: headline.lines } : null,
    kicker: kicker ? short(kicker.text, 48) : null,
    lead: lead ? short(lead.text, 64) : null,
    bgImage: bgImage ? base(bgImage.src || "") : null,
    bgImageCls: bgImage ? bgImage.cls : "",
    paintLayers: paintLayers.map((l) => ({ cls: l.cls, fill: l.fill })),
    decors: decors.map((d) => ({ cls: d.cls, x: d.x, y: d.y, w: d.w, h: d.h })),
    decorImgs: decorImgs.map((d) => ({ src: base(d.src), x: d.x, y: d.y, w: d.w, h: d.h })),
    logo: logo ? base(logo.src) : null,
    images: images.map((i) => base(i.src)),
    semantic: semanticCounts(blocks),
    cards,
    cardFills: fills,
    icons,
    charts,
    accents,
    patterns: [...patterns],
    issues: issues || [],
    blocks,
    elements,
  };
}

function paintText(a) {
  if (a.bgImage) return "image " + a.bgImage + (a.bgImageCls ? " [" + a.bgImageCls + "]" : "");
  const paint = a.paintLayers.length
    ? a.paintLayers.map((p) => (p.cls ? p.cls : "paint") + (p.fill ? " (" + p.fill + ")" : "")).join(", ")
    : null;
  return (paint ? paint + " over " : "") + "flat " + (a.bgColor || "?");
}

function issuesText(a) {
  if (!a.issues.length) return "";
  const parts = a.issues.slice(0, 5).map((i) => (i.severity === "error" ? "ERROR " : "") + i.type);
  return ` · issues: ${parts.join(", ")}${a.issues.length > 5 ? " +" + (a.issues.length - 5) : ""}`;
}

function formatSlide(a, n, opts = {}) {
  const lines = [];
  const title = a.headline ? "«" + a.headline.text + "»" : a.role === "cover" || a.role === "section" || a.role === "closing" ? "" : "(no headline!)";
  lines.push(`slide ${n}/${opts.total || "?"} [${a.role}] ${title}`);
  lines.push(`  bg: ${paintText(a)}`);
  const decorBits = [];
  if (a.decors.length) decorBits.push(a.decors.map((d) => (d.cls || "decor") + ` @${d.x},${d.y} ${d.w}×${d.h}`).join("; "));
  if (a.decorImgs.length) decorBits.push(a.decorImgs.map((d) => `img ${d.src} @${d.x},${d.y} ${d.w}×${d.h}`).join("; "));
  if (a.bgImage && !a.decors.length && !a.decorImgs.length) decorBits.push("none on top of the background");
  lines.push(`  decor: ${decorBits.length ? decorBits.join("; ") : "NONE"}`);
  const head = [];
  if (a.kicker) head.push(`kicker «${a.kicker}»`);
  if (a.headline) head.push(`${a.headline.size}pt × ${a.headline.lines} line(s)`);
  if (a.lead) head.push(`lead «${a.lead}»`);
  if (head.length) lines.push(`  head: ${head.join(" · ")}`);
  const blockBits = [];
  if (a.patterns.length) blockBits.push(a.patterns.join("+"));
  if (a.cards.length) blockBits.push(`${a.cards.length} card(s)` + (a.cardFills.length ? ` fill ${a.cardFills.join("/")}` : ""));
  blockBits.push(...a.semantic);
  blockBits.push(`icons ${a.icons}`, `charts ${a.charts}`, `images ${a.images.length}`);
  lines.push(`  blocks: ${blockBits.join(" · ")}`);
  if (a.images.length) lines.push(`  images: ${a.images.join(", ")}`);
  lines.push(
    `  space: content band ${Math.round(a.coverage * 100)}% of the slide height` + issuesText(a),
  );
  if (opts.detail) {
    for (const b of a.blocks) {
      const bits = [`  block [${b.cls || b.tag || "?"}] @${b.x},${b.y} ${b.w}×${b.h}`];
      if (b.fill) bits.push("fill " + b.fill);
      if (b.src) bits.push("src " + base(b.src));
      if (b.text) bits.push("«" + short(b.text, 48) + "»");
      lines.push(bits.join(" · "));
    }
  }
  return lines;
}

// ---------------------------------------------------------- template usage

function templateUsage(analyses, template) {
  if (!template || !template.length) return [];
  const used = new Map();
  for (const a of analyses) {
    for (const src of [a.bgImage, ...a.images, ...a.decorImgs.map((d) => d.src), a.logo].filter(Boolean)) {
      const b = base(src);
      if (!used.has(b)) used.set(b, []);
      used.get(b).push(a.index + 1);
    }
  }
  const lines = ["", "=== TEMPLATE ASSETS (images/template-assets.md) ==="];
  for (const t of template) {
    const slides = [...new Set(used.get(t.file) || [])];
    const hint = t.place ? " · template: " + short(t.place, 90) : "";
    lines.push(`  ${t.kind} ${t.file}: ${slides.length ? "slides " + slides.join(", ") : "not used on any slide"}${hint}`);
  }
  const withPics = analyses.filter((a) => a.images.length);
  lines.push(
    withPics.length
      ? `  content pictures: ${withPics.map((a) => `slide ${a.index + 1} (${a.images.join(", ")})`).join("; ")}`
      : "  content pictures: none in the deck",
  );
  return lines;
}

// ------------------------------------------------------- template-assets.md

function parseTemplateAssets(md) {
  const out = [];
  for (const chunk of String(md || "").split(/\n(?=## )/)) {
    const h = /^## ([^\n]+)/.exec(chunk);
    if (!h) continue;
    const head = h[1].trim();
    const kind = /^background/i.test(head)
      ? "bg"
      : /^logo/i.test(head)
        ? "logo"
        : /^decor/i.test(head)
          ? "decor"
          : /^photo/i.test(head)
            ? "photo"
            : /^icon/i.test(head)
              ? "icon"
              : /^branding/i.test(head)
                ? "brand"
                : null;
    if (!kind) continue;
    const file = (/src="images\/([^"]+)"/.exec(chunk) || [])[1];
    if (!file) continue;
    const place = (/appears at: ([^\n]+)/.exec(chunk) || [])[1] || (/template slides: ([^\n]+)/.exec(chunk) || [])[1] || "";
    out.push({ kind, file: base(file), place: norm(place) });
  }
  return out;
}

function readTemplateAssets(deckDir) {
  const file = path.join(deckDir, "images", "template-assets.md");
  try {
    if (!fs.existsSync(file)) return null;
    return parseTemplateAssets(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// --------------------------------------------------------------- entrypoint

function describeDeck({ report, inventory, deckDir, deckName, slide, detail }) {
  if (!inventory || !inventory.length) return ["describe: no inventory (render produced nothing)"];
  const issuesFor = (i) => {
    const list = Array.isArray(report) ? report : report && report.slides ? report.slides : [];
    return (list.find((s) => s.index === i) || {}).issues || [];
  };
  const analyses = inventory.map((inv) => analyzeSlide(inv, issuesFor(inv.index)));
  const total = inventory.length;
  const lines = [];
  if (slide) {
    const n = Number(slide);
    const a = analyses.find((x) => x.index + 1 === n);
    if (!a) return [`describe: slide ${n} not found (deck has ${total})`];
    lines.push(...formatSlide(a, n, { total, detail: true }));
    if (a.notes) lines.push(`  notes: ${short(a.notes, 120)}`);
    return lines;
  }
  const template = deckDir ? readTemplateAssets(deckDir) : null;
  const roles = {};
  for (const a of analyses) roles[a.role] = (roles[a.role] || 0) + 1;
  lines.push(
    `deck${deckName ? " " + deckName : ""}: ${total} slide(s) · ` +
      Object.entries(roles).map(([r, n]) => `${r} ${n}`).join(", ") +
      (template ? ` · template assets: ${template.length}` : ""),
  );
  for (let i = 0; i < analyses.length; i++) {
    lines.push(...formatSlide(analyses[i], i + 1, { total, detail }));
  }
  lines.push(...templateUsage(analyses, template));
  return lines;
}

module.exports = { describeDeck, analyzeSlide, templateUsage, parseTemplateAssets, readTemplateAssets, PATTERNS };
