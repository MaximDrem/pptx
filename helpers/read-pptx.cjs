#!/usr/bin/env node
// presentation v2 — deep reader for an attached .pptx.
//
//   ELECTRON_RUN_AS_NODE=1 "$GIGATOOL_NODE" .../read-pptx.cjs deck.pptx \
//     [--json <path>] [--slide N [--elements]] [--elements] [--outline] [--extract-media <dir>]
//
// "The agent must see every element": the reader returns the file's truth —
// z-order layer list, groups with composed transforms, shapes with geometry/
// fill/line/effects, per-run text styles, pictures with media references
// (png/jpeg/svg/emf/wmf/wdp), tables with cells, charts with series, links,
// notes, theme colors/fonts and the media inventory. stdout stays compact by
// default; the full JSON goes to the OS temp dir and one slide can be printed
// in detail with --slide N (the model never reads the whole JSON).
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const { readDeck } = require("./lib/pptx.cjs");

const LABEL = {
  shape: "sp",
  picture: "pic",
  group: "grpSp",
  connector: "cxn",
  graphicFrame: "gf",
};

function round(n, d = 2) {
  if (n === null || n === undefined) return null;
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

function px(box) {
  if (!box || !box.px) return "?";
  const { x, y, w, h } = box.px;
  return `${x},${y} ${w}×${h}px`;
}

function colorStr(c) {
  if (!c) return "";
  const a = c.alpha !== undefined && c.alpha < 1 ? `@${c.alpha}` : "";
  const approx = c.approx ? "~" : "";
  const unresolved = c.unresolved ? `?(${c.unresolved})` : "";
  return `${approx}${c.hex || "?"}${a}${unresolved}`;
}

function fillStr(fill) {
  if (!fill) return "none";
  switch (fill.type) {
    case "solid": return colorStr(fill);
    case "gradient": {
      const stops = (fill.stops || []).map((s) => `${s.pos}%${colorStr(s)}`).join(" ");
      return `grad(${fill.angle !== null ? fill.angle + "°" : fill.path || ""}; ${stops})`;
    }
    case "image": return `img(${fill.media || fill.ref || "?"})`;
    case "pattern": return `patt(${fill.prst})`;
    case "group": return "inherit-group";
    case "none": return "none";
    default: return fill.type;
  }
}

function lineStr(line) {
  if (!line) return "";
  if (line.none) return " line=none";
  const bits = [];
  if (line.wPt !== undefined) bits.push(line.wPt + "pt");
  if (line.fill && line.fill.type === "solid") bits.push(colorStr(line.fill));
  if (line.dash) bits.push(line.dash);
  return bits.length ? " line=" + bits.join(" ") : "";
}

const ALIGN = { l: "left", ctr: "center", r: "right", just: "justify", dist: "dist", thaiDist: "thai" };

function runStr(r) {
  const bits = [];
  if (r.szPt !== undefined) bits.push(r.szPt + "pt");
  else bits.push("size?");
  if (r.bold) bits.push("bold");
  if (r.italic) bits.push("italic");
  if (r.underline) bits.push("u");
  if (r.strike) bits.push("strike");
  if (r.caps) bits.push(r.caps);
  if (r.spcPt) bits.push("spc" + r.spcPt);
  if (r.color) bits.push(colorStr(r.color));
  if (r.highlight) bits.push("hl=" + colorStr(r.highlight));
  if (r.font) bits.push(`"${r.font}"${r.fontFrom === "theme-major" || r.fontFrom === "theme-minor" ? "(theme)" : ""}`);
  if (r.link) bits.push("→" + r.link);
  if (r._source && (r._source.szPt === "default" || r._source.color === "default")) bits.push("(defaults)");
  return bits.join(" ");
}

function paraStr(p) {
  const bits = [];
  if (p.align) bits.push(ALIGN[p.align] || p.align);
  if (p.level) bits.push("lvl" + p.level);
  if (p.bullet) bits.push(p.bullet.type === "char" ? `•${p.bullet.char}` : p.bullet.type === "auto" ? `#${p.bullet.scheme}` : "no-bullet");
  if (p.lineSpacingPct) bits.push("lh" + Math.round(p.lineSpacingPct) + "%");
  if (p.spaceBeforePt) bits.push("sb" + p.spaceBeforePt);
  if (p.spaceAfterPt) bits.push("sa" + p.spaceAfterPt);
  return bits.join(" ");
}

function textLines(el, indent) {
  const out = [];
  const t = el.text;
  if (!t || !t.paragraphs || !t.paragraphs.length) return out;
  const visibleRuns = (p) => p.runs.filter((r) => !r.br && (r.text || "").trim());
  const nonEmpty = t.paragraphs.filter((p) => visibleRuns(p).length);
  if (!nonEmpty.length) return out;
  nonEmpty.forEach((p, i) => {
    const meta = paraStr(p);
    const runs = visibleRuns(p);
    if (runs.length === 1 && p.runs.filter((r) => r.br).length === 0) {
      out.push(`${indent}¶${i + 1} «${runs[0].text}» [${runStr(runs[0])}${meta ? " " + meta : ""}]`);
    } else {
      out.push(`${indent}¶${i + 1}${meta ? " [" + meta + "]" : ""}`);
      for (const r of runs) {
        out.push(`${indent}    «${r.text}» [${runStr(r)}]`);
      }
    }
  });
  return out;
}

function elementLine(el, idx, mediaRoles) {
  const kind = LABEL[el.kind] || el.kind;
  const name = el.name ? `"${el.name}"` : "";
  const bits = [`${idx}. [${kind}] id=${el.id} ${name} ${px(el.box)}`];
  if (el.box && el.box.rot) bits.push(`rot=${el.box.rot}°`);
  if (el.placeholder) bits.push(`ph=${el.placeholder.type}${el.placeholder.idx !== null ? "#" + el.placeholder.idx : ""}`);
  if (el.custGeom) bits.push(`custGeom(${el.custGeom.paths}p/${el.custGeom.points}pts)`);
  else if (el.geom && el.geom !== "rect") bits.push("geom=" + el.geom);
  if (el.fill) bits.push("fill=" + fillStr(el.fill));
  else if (el.kind === "picture" || el.kind === "group") bits.push("fill=-");
  bits.push(lineStr(el.line));
  if (el.effects) {
    const e = el.effects;
    if (e.shadow) bits.push(`shadow(${e.shadow.inner ? "inner " : ""}blur${e.shadow.blurPt}pt d${e.shadow.distPt}pt)`);
    if (e.glow) bits.push(`glow(${e.glow.radiusPt}pt)`);
    if (e.softEdge) bits.push(`soft(${e.softEdge.radiusPt}pt)`);
  }
  if (el.kind === "picture") {
    const media = el.media || el.mediaRef || "?";
    const role = mediaRoles && mediaRoles[media] ? `[${mediaRoles[media]}]` : "";
    bits.push("media=" + media + role);
    if (el.svgVector) bits.push("SVG-vector");
    else if (el.svgRef) bits.push("svg-fallback");
    if (el.alphaPct !== undefined) bits.push(`alpha${el.alphaPct}%`);
    if (el.crop) bits.push(`crop(l${el.crop.l ?? 0},t${el.crop.t ?? 0},r${el.crop.r ?? 0},b${el.crop.b ?? 0}%)`);
    if (el.mediaLinked) bits.push("LINKED");
  }
  if (el.link) bits.push("→" + el.link);
  if (el.frame === "table" && el.table) bits.push(`table ${el.table.cols}×${el.table.rows}`);
  if (el.frame === "chart") bits.push("chart(" + (el.chart ? el.chart.types.map((t) => t.kind).join(",") : "?") + ")");
  if (el.frame === "diagram") bits.push("diagram");
  if (el.kind === "group") bits.push(`children=${(el.children || []).length}`);
  if (el.text && el.text.autofit) bits.push("autofit=" + el.text.autofit + (el.text.fontScalePct ? `(${el.text.fontScalePct}%)` : ""));
  return bits.join(" ");
}

function flattenPaintOrder(els, out = []) {
  for (const el of els) {
    out.push(el);
    if (el.children) flattenPaintOrder(el.children, out);
  }
  return out;
}

// Фон под текстом: ближайший нижний по z-порядку элемент с заливкой/картинкой,
// покрывающий текст (>=80% площади). Ответ на «на каком фоне лежит текст».
function backgroundUnder(el, flat) {
  if (!el.box || !el.box.emu || !el.text) return null;
  let best = null;
  const inner = { x: el.box.emu.x, y: el.box.emu.y, w: el.box.emu.w, h: el.box.emu.h };
  for (const other of flat) {
    if (other === el) break; // элементы до нас в порядке рисования
    if (other === el) continue;
    const b = other.box && other.box.emu;
    if (!b || b.w <= 0 || b.h <= 0) continue;
    const ix = Math.min(inner.x + inner.w, b.x + b.w) - Math.max(inner.x, b.x);
    const iy = Math.min(inner.y + inner.h, b.y + b.h) - Math.max(inner.y, b.y);
    if (ix <= 0 || iy <= 0) continue;
    const cover = (ix * iy) / (inner.w * inner.h);
    if (cover < 0.8) continue;
    if (other.fill && other.fill.type !== "none") best = fillStr(other.fill);
    else if (other.kind === "picture" && other.media) best = "img(" + other.media + ")";
  }
  return best;
}

function printElement(el, idx, indent = "  ", mediaRoles) {
  const lines = [indent + elementLine(el, idx, mediaRoles)];
  lines.push(...textLines(el, indent + "    "));
  if (el.table) {
    for (const row of el.table.rowsData) {
      const cells = row.cells.map((c) => c.text.replace(/\s+/g, " ").slice(0, 40)).join(" | ");
      lines.push(`${indent}    row: ${cells}`);
    }
  }
  if (el.chart) {
    if (el.chart.title) lines.push(`${indent}    chart title «${el.chart.title}»`);
    for (const s of el.chart.series.slice(0, 8)) {
      lines.push(`${indent}    series «${s.name || ""}» cats=[${s.cats.slice(0, 10).join(", ")}] vals=[${s.vals.slice(0, 10).join(", ")}]`);
    }
  }
  if (el.children) {
    let i = 1;
    for (const c of el.children) lines.push(...printElement(c, i++, indent + "  ", mediaRoles));
  }
  return lines;
}

function slideHeader(s, deck) {
  const counts = [];
  const kinds = { sp: 0, pic: 0, grpSp: 0, cxn: 0, gf: 0 };
  const walk = (els) => {
    for (const el of els) {
      if (el.kind === "shape") kinds.sp++;
      else if (el.kind === "picture") kinds.pic++;
      else if (el.kind === "group") kinds.grpSp++;
      else if (el.kind === "connector") kinds.cxn++;
      else if (el.kind === "graphicFrame") kinds.gf++;
      if (el.children) walk(el.children);
    }
  };
  walk(s.elements);
  for (const [k, v] of Object.entries(kinds)) if (v) counts.push(`${v} ${k}`);
  const eff = s.effectiveBg;
  const bg = eff ? fillStr(eff) + (s.effectiveBgSource && s.effectiveBgSource !== "slide" ? "@" + s.effectiveBgSource : "") : "none";
  return (
    `slide ${s.index} (${s.name}): bg=${bg} elements=[${counts.join(", ")}] ` +
    `gradients=${s.counts.gradFill} custGeom=${s.counts.custGeom}` +
    (s.notes ? ` notes=${JSON.stringify(s.notes.replace(/\s+/g, " ").slice(0, 60))}` : "")
  );
}

function deckHeader(d) {
  const lines = [];
  const mb = round(d.bytes / 1024 / 1024, 1);
  lines.push(`pptx: ${d.file} (${mb}MB)`);
  lines.push(
    `slides=${d.totals.slides} size=${d.slideSize.in.w}×${d.slideSize.in.h}in (${d.slideSize.px.w}×${d.slideSize.px.h}px) ` +
      `layouts=${d.layoutCount} masters=${d.masterCount}`,
  );
  lines.push(
    `theme: major="${d.theme.fonts.major.latin || "?"}" minor="${d.theme.fonts.minor.latin || "?"}" | ` +
      Object.entries(d.theme.colors).map(([k, v]) => `${k}=${v}`).join(" "),
  );
  if (d.themeUsage && d.themeUsage.length) {
    const usage = d.themeUsage
      .map((t) => `${t.theme || "?"} (${t.slides} slides, ${t.major || "?"}/${t.minor || "?"})`)
      .join(" · ");
    lines.push(`theme per slide: ${usage}`);
  }
  lines.push(
    `totals: shapes=${d.totals.shapes} pics=${d.totals.pics} groups=${d.totals.groups} connectors=${d.totals.connectors} ` +
      `frames=${d.totals.graphicFrames} (tables=${d.totals.tables} charts=${d.totals.charts}) gradients=${d.totals.gradients} ` +
      `custGeom=${d.totals.custGeom} media=${d.totals.media} (svg=${d.totals.svgMedia}) ` +
      `notes=${d.totals.notes}/${d.totals.notesParts} orphanMedia=${d.totals.orphanMedia} embeddedFonts=${d.totals.embeddedFonts}`,
  );
  const topFonts = d.fontHistogram.slice(0, 5).map((f) => `${f.font}(${f.n})`).join(", ");
  if (topFonts) lines.push(`fonts used: ${topFonts}`);
  const topColors = d.colorHistogram.slice(0, 8).map((c) => `${c.hex}(${c.n})`).join(" ");
  if (topColors) lines.push(`colors used: ${topColors}`);
  return lines;
}

function mediaLine(m) {
  const dims = m.w ? ` ${m.w}×${m.h}` : "";
  const used = m.usedBySlides.length ? ` slides:${m.usedBySlides.join(",")}` : "";
  const role = m.role ? ` [${m.role}]` : "";
  return `  ${m.name} ${Math.round(m.bytes / 1024)}KB ${m.kind}${dims}${role}${used} — ${m.roleWhy || ""}`;
}

function printElementWithBg(el, flat, slide, deck) {
  const roles = {};
  for (const m of deck.media) if (m.role) roles[m.name] = m.role;
  const lines = printElement(el, el.id !== null ? el.id : 0, "  ", roles);
  const bg = backgroundUnder(el, flat);
  if (bg && lines.length && el.text) lines[0] += "  on=" + bg;
  else if (bg === null && el.text && (!el.fill || el.fill.type === "none")) {
    const eff = slide.effectiveBg;
    lines[0] += "  on=bg" + (eff ? "(" + fillStr(eff) + ")" : "");
  }
  return lines;
}

async function extractMedia(deckData, dir, opts = {}) {
  const perFileMax = opts.perFileMax || 24 * 1024 * 1024;
  const { openPptx } = require("./lib/pptx.cjs");
  const deck = await openPptx(deckData.file);
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  for (const m of deckData.media) {
    const entry = {
      name: m.name,
      bytes: m.bytes,
      kind: m.kind,
      ext: m.ext,
      w: m.w || null,
      h: m.h || null,
      role: m.role || null,
      roleWhy: m.roleWhy || null,
      visual: m.visual || null,
      usedBySlides: m.usedBySlides,
      usedByParts: m.usedByParts || [],
      written: false,
    };
    if (m.bytes && m.bytes <= perFileMax) {
      const part = "ppt/media/" + m.name;
      const buf = await deck.readBuf(part);
      if (buf) {
        fs.writeFileSync(path.join(dir, m.name), buf);
        entry.written = true;
      }
    }
    files.push(entry);
  }
  fs.writeFileSync(path.join(dir, "media.json"), JSON.stringify({ files }, null, 2));
  return files.filter((f) => f.written);
}

function defaultJsonPath(file) {
  const slug = path.basename(file).replace(/\.pptx$/i, "").replace(/[^\w.-]+/g, "_");
  return path.join(os.tmpdir(), "presentation-v2", "read", `${slug}-${process.pid}.json`);
}

async function main() {
  const argv = process.argv.slice(2);
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") flags.json = argv[++i];
    else if (a === "--slide") flags.slide = parseInt(argv[++i], 10);
    else if (a === "--extract-media") flags.extractMedia = argv[++i];
    else if (a === "--elements") flags.elements = true;
    else if (a === "--outline") flags.outline = true;
    else if (a === "--no-visual") flags.noVisual = true;
    else if (!a.startsWith("--")) positional.push(a);
  }
  const file = positional[0];
  if (!file) {
    console.error("usage: read-pptx.cjs <deck.pptx> [--json <path>] [--slide N] [--elements] [--outline] [--no-visual] [--extract-media <dir>]");
    process.exit(2);
  }

  let deck;
  try {
    deck = await readDeck(file, { visual: !flags.noVisual });
  } catch (e) {
    console.error(e.message || String(e));
    process.exit(1);
  }

  // Self-check: parsed structure must match the raw tag counts in the XML.
  const raw = { sp: 0, pic: 0, grpSp: 0, cxnSp: 0, graphicFrame: 0 };
  for (const s of deck.slides) {
    raw.sp += s.rawCounts.sp;
    raw.pic += s.rawCounts.pic;
    raw.grpSp += s.rawCounts.grpSp;
    raw.cxnSp += s.rawCounts.cxnSp;
    raw.graphicFrame += s.rawCounts.graphicFrame;
  }
  deck.selfCheck = {
    parsed: {
      sp: deck.totals.shapes,
      pic: deck.totals.pics,
      grpSp: deck.totals.groups,
      cxnSp: deck.totals.connectors,
      graphicFrame: deck.totals.graphicFrames,
    },
    raw,
    ok:
      raw.sp === deck.totals.shapes &&
      raw.pic === deck.totals.pics &&
      raw.grpSp === deck.totals.groups &&
      raw.cxnSp === deck.totals.connectors &&
      raw.graphicFrame === deck.totals.graphicFrames,
  };

  const jsonPath = flags.json || defaultJsonPath(file);
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(deck, null, 2));

  const out = [];
  out.push(...deckHeader(deck));
  if (!deck.selfCheck.ok) {
    out.push(`WARNING: self-check mismatch parsed=${JSON.stringify(deck.selfCheck.parsed)} raw=${JSON.stringify(raw)} — report it`);
  }

  if (flags.outline) {
    for (const s of deck.slides) {
      const texts = [];
      const collect = (els) => {
        for (const el of els) {
          if (el.text) texts.push(...el.text.paragraphs.map((p) => p.runs.map((r) => r.text).join("")).filter((t) => t.trim()));
          if (el.children) collect(el.children);
        }
      };
      collect(s.elements);
      out.push(`slide ${s.index}: ${texts.slice(0, 6).map((t) => "«" + t.replace(/\s+/g, " ").slice(0, 60) + "»").join(" ")}`);
    }
  } else if (Number.isInteger(flags.slide)) {
    const s = deck.slides.find((x) => x.index === flags.slide);
    if (!s) {
      console.error(`slide ${flags.slide} not found (deck has ${deck.slides.length})`);
      process.exit(1);
    }
    out.push(slideHeader(s, deck));
    const flat = flattenPaintOrder(s.elements);
    for (const el of s.elements) out.push(...printElementWithBg(el, flat, s, deck));
  } else if (flags.elements) {
    for (const s of deck.slides) {
      out.push(slideHeader(s, deck));
      const flat = flattenPaintOrder(s.elements);
      for (const el of s.elements) out.push(...printElementWithBg(el, flat, s, deck));
    }
  } else {
    for (const s of deck.slides) {
      const firstTexts = [];
      const collect = (els) => {
        for (const el of els) {
          if (firstTexts.length < 3 && el.text) {
            for (const p of el.text.paragraphs) {
              const t = p.runs.map((r) => r.text).join("").replace(/\s+/g, " ").trim();
              if (t) { firstTexts.push("«" + t.slice(0, 40) + "»"); break; }
            }
          }
          if (el.children) collect(el.children);
        }
      };
      collect(s.elements);
      out.push(slideHeader(s, deck) + (firstTexts.length ? " " + firstTexts.join(" ") : ""));
    }
    if (deck.media.length) {
      const byKind = deck.media.filter((m) => m.usedBySlides.length);
      out.push(`media used by slides (${byKind.length}/${deck.media.length}):`);
      for (const m of byKind.slice(0, 24)) out.push(mediaLine(m));
      if (byKind.length > 24) out.push(`  … +${byKind.length - 24} more (full list in --json)`);
    }
    out.push(
      `hint: one slide in full → --slide N · all elements → --elements · text outline → --outline · ` +
        `media files → --extract-media <dir> · full JSON → ${jsonPath}`,
    );
  }

  if (flags.extractMedia) {
    const written = await extractMedia(deck, path.resolve(flags.extractMedia));
    const skipped = deck.media.length - written.length;
    out.push(
      `media extracted: ${written.length} file(s) → ${path.resolve(flags.extractMedia)}` +
        (skipped > 0 ? ` (${skipped} skipped: >24MB each — listed in media.json)` : "") +
        " · media.json lists every file with sizes and usage",
    );
  }

  console.log(out.join("\n"));
  if (!flags.json) console.log(`pptx json: ${jsonPath}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message || String(e));
    process.exit(1);
  });
}

module.exports = { readDeck };
