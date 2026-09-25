// presentation v2 — deep PPTX reader.
//
// Parses a .pptx package into a complete, ordered description of every
// element: z-order (layer), groups with composed transforms, shapes with
// geometry/fill/line/effects, text with per-run styles, pictures with media
// references (incl. SVG/EMF/WMF), tables with cells, charts with series,
// connectors, hyperlinks, slide backgrounds, notes, theme colors/fonts and
// the media inventory. Everything is offline (vendored JSZip) and exact:
// values are read from XML, not guessed from other tools' summaries.
//
// Used by helpers/read-pptx.cjs (CLI) and helpers/style-profile.cjs.
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const X = require("./xml.cjs");

const EMU_PER_INCH = 914400;
const EMU_PER_PX = 9525; // 96 dpi

let JSZip = null;
function getJSZip() {
  if (JSZip) return JSZip;
  const vendor = path.join(__dirname, "..", "..", "vendor", "jszip.bundle.cjs");
  if (fs.existsSync(vendor)) {
    JSZip = require(vendor);
    return JSZip;
  }
  JSZip = require("jszip"); // dev fallback
  return JSZip;
}

// --------------------------------------------------------------- basic units

const emuToIn = (emu) => Math.round((emu / EMU_PER_INCH) * 1000) / 1000;
const emuToPx = (emu) => Math.round(emu / EMU_PER_PX);
const zero = (v) => v === 0 || v === null || v === undefined;

// ECMA-376 preset colors (the full set PowerPoint ships).
const PRST_COLORS = {
  aliceblue: "F0F8FF", antiquewhite: "FAEBD7", aqua: "00FFFF", aquamarine: "7FFFD4", azure: "F0FFFF",
  beige: "F5F5DC", bisque: "FFE4C4", black: "000000", blanchedalmond: "FFEBCD", blue: "0000FF",
  blueviolet: "8A2BE2", brown: "A52A2A", burlywood: "DEB887", cadetblue: "5F9EA0", chartreuse: "7FFF00",
  chocolate: "D2691E", coral: "FF7F50", cornflowerblue: "6495ED", cornsilk: "FFF8DC", crimson: "DC143C",
  cyan: "00FFFF", darkblue: "00008B", darkcyan: "008B8B", darkgoldenrod: "B8860B", darkgray: "A9A9A9",
  darkgreen: "006400", darkgrey: "A9A9A9", darkkhaki: "BDB76B", darkmagenta: "8B008B", darkolivegreen: "556B2F",
  darkorange: "FF8C00", darkorchid: "9932CC", darkred: "8B0000", darksalmon: "E9967A", darkseagreen: "8FBC8F",
  darkslateblue: "483D8B", darkslategray: "2F4F4F", darkslategrey: "2F4F4F", darkturquoise: "00CED1",
  darkviolet: "9400D3", deeppink: "FF1493", deepskyblue: "00BFFF", dimgray: "696969", dimgrey: "696969",
  dodgerblue: "1E90FF", firebrick: "B22222", floralwhite: "FFFAF0", forestgreen: "228B22", fuchsia: "FF00FF",
  gainsboro: "DCDCDC", ghostwhite: "F8F8FF", gold: "FFD700", goldenrod: "DAA520", gray: "808080",
  green: "008000", greenyellow: "ADFF2F", grey: "808080", honeydew: "F0FFF0", hotpink: "FF69B4",
  indianred: "CD5C5C", indigo: "4B0082", ivory: "FFFFF0", khaki: "F0E68C", lavender: "E6E6FA",
  lavenderblush: "FFF0F5", lawngreen: "7CFC00", lemonchiffon: "FFFACD", lightblue: "ADD8E6",
  lightcoral: "F08080", lightcyan: "E0FFFF", lightgoldenrodyellow: "FAFAD2", lightgray: "D3D3D3",
  lightgreen: "90EE90", lightgrey: "D3D3D3", lightpink: "FFB6C1", lightsalmon: "FFA07A",
  lightseagreen: "20B2AA", lightskyblue: "87CEFA", lightslategray: "778899", lightslategrey: "778899",
  lightsteelblue: "B0C4DE", lightyellow: "FFFFE0", lime: "00FF00", limegreen: "32CD32", linen: "FAF0E6",
  magenta: "FF00FF", maroon: "800000", mediumaquamarine: "66CDAA", mediumblue: "0000CD",
  mediumorchid: "BA55D3", mediumpurple: "9370DB", mediumseagreen: "3CB371", mediumslateblue: "7B68EE",
  mediumspringgreen: "00FA9A", mediumturquoise: "48D1CC", mediumvioletred: "C71585",
  midnightblue: "191970", mintcream: "F5FFFA", mistyrose: "FFE4E1", moccasin: "FFE4B5",
  navajowhite: "FFDEAD", navy: "000080", oldlace: "FDF5E6", olive: "808000", olivedrab: "6B8E23",
  orange: "FFA500", orangered: "FF4500", orchid: "DA70D6", palegoldenrod: "EEE8AA", palegreen: "98FB98",
  paleturquoise: "AFEEEE", palevioletred: "DB7093", papayawhip: "FFEFD5", peachpuff: "FFDAB9",
  peru: "CD853F", pink: "FFC0CB", plum: "DDA0DD", powderblue: "B0E0E6", purple: "800080",
  red: "FF0000", rosybrown: "BC8F8F", royalblue: "4169E1", saddlebrown: "8B4513", salmon: "FA8072",
  sandybrown: "F4A460", seagreen: "2E8B57", seashell: "FFF5EE", sienna: "A0522D", silver: "C0C0C0",
  skyblue: "87CEEB", slateblue: "6A5ACD", slategray: "708090", slategrey: "708090", snow: "FFFAFA",
  springgreen: "00FF7F", steelblue: "4682B4", tan: "D2B48C", teal: "008080", thistle: "D8BFD8",
  tomato: "FF6347", turquoise: "40E0D0", violet: "EE82EE", wheat: "F5DEB3", white: "FFFFFF",
  whitesmoke: "F5F5F5", yellow: "FFFF00", yellowgreen: "9ACD32",
};

// ------------------------------------------------------------------- colors

function clamp255(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

function rgbToHex({ r, g, b }) {
  return "#" + [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, "0")).join("").toUpperCase();
}

// DrawingML color transforms applied to the raw scheme/srgb color.
function applyColorTransforms(hex, colorNode) {
  let { r, g, b } = hexToRgb(hex);
  let alpha = 1;
  let approx = false;
  for (const t of colorNode ? colorNode.children : []) {
    const val = () => X.num(X.attr(t, "val"), 0);
    switch (t.local) {
      case "alpha":
        alpha *= val() / 100000;
        break;
      case "lumMod": {
        const f = val() / 100000;
        r *= f; g *= f; b *= f;
        break;
      }
      case "lumOff": {
        const o = (val() / 100000) * 255;
        r += o; g += o; b += o;
        break;
      }
      case "tint": {
        const f = val() / 100000;
        r = r * f + 255 * (1 - f);
        g = g * f + 255 * (1 - f);
        b = b * f + 255 * (1 - f);
        break;
      }
      case "shade": {
        const f = 1 - val() / 100000;
        r *= f; g *= f; b *= f;
        break;
      }
      case "gray": {
        const f = val() / 100000;
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = r * (1 - f) + lum * f;
        g = g * (1 - f) + lum * f;
        b = b * (1 - f) + lum * f;
        break;
      }
      case "inv":
        r = 255 - r; g = 255 - g; b = 255 - b;
        break;
      case "satMod":
      case "hueMod":
        approx = true; // recorded, not computed
        break;
      default:
        break;
    }
  }
  return { hex: rgbToHex({ r, g, b }), alpha: Math.round(alpha * 1000) / 1000, approx };
}

// Resolve one color element (srgbClr/schemeClr/prstClr/sysClr/scrgbClr/…).
function resolveColor(colorNode, ctx) {
  if (!colorNode) return null;
  switch (colorNode.local) {
    case "srgbClr": {
      const raw = X.attr(colorNode, "val", "");
      if (!/^[0-9A-Fa-f]{6}$/.test(raw)) return null;
      const res = applyColorTransforms(raw.toUpperCase(), colorNode);
      return res;
    }
    case "schemeClr": {
      const alias = { bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2" };
      const rawKey = X.attr(colorNode, "val", "");
      const key = alias[rawKey] || rawKey;
      const base = ctx.theme.scheme[key];
      if (!base) return { hex: null, alpha: 1, approx: true, unresolved: "scheme:" + rawKey };
      const res = applyColorTransforms(base, colorNode);
      return res;
    }
    case "prstClr": {
      const name = String(X.attr(colorNode, "val", "")).toLowerCase();
      const base = PRST_COLORS[name];
      if (!base) return null;
      const res = applyColorTransforms(base, colorNode);
      res.prst = name;
      return res;
    }
    case "sysClr": {
      const base = X.attr(colorNode, "lastClr") || PRST_COLORS[String(X.attr(colorNode, "val", "")).toLowerCase()];
      if (!base) return null;
      const res = applyColorTransforms(base.toUpperCase(), colorNode);
      res.sys = X.attr(colorNode, "val", "");
      return res;
    }
    case "scrgbClr": {
      const pct = (n) => Math.round((X.num(X.attr(colorNode, n), 0) / 100000) * 255);
      const res = applyColorTransforms(rgbToHex({ r: pct("r"), g: pct("g"), b: pct("b") }).slice(1), colorNode);
      return res;
    }
    default:
      return null;
  }
}

function colorRef(res) {
  if (!res) return null;
  const out = { hex: res.hex };
  if (res.alpha !== undefined && res.alpha < 1) out.alpha = res.alpha;
  if (res.approx) out.approx = true;
  if (res.unresolved) out.unresolved = res.unresolved;
  return out;
}

// -------------------------------------------------------------------- fills

function firstColorChild(node) {
  for (const c of node ? node.children : []) {
    if (["srgbClr", "schemeClr", "prstClr", "sysClr", "scrgbClr"].includes(c.local)) return c;
  }
  return null;
}

function parseGradient(gradFill, ctx) {
  const stops = [];
  const gsLst = X.child(gradFill, "gsLst");
  for (const gs of X.children(gsLst, "gs")) {
    const pos = X.num(X.attr(gs, "pos"), 0) / 1000;
    const color = resolveColor(firstColorChild(gs), ctx);
    if (color) stops.push({ pos: Math.round(pos * 10) / 10, ...colorRef(color) });
  }
  let angle = null;
  let path = null;
  const lin = X.child(gradFill, "lin");
  if (lin) angle = Math.round((X.num(X.attr(lin, "ang"), 0) / 60000) * 10) / 10;
  const gpath = X.child(gradFill, "path");
  if (gpath) path = X.attr(gpath, "path", "rect");
  return { type: "gradient", stops, angle, path };
}

function parseFill(node, ctx) {
  if (!node) return null;
  const solid = X.child(node, "solidFill");
  if (solid) {
    const c = resolveColor(firstColorChild(solid), ctx);
    return c ? { type: "solid", ...colorRef(c) } : { type: "solid", unresolved: true };
  }
  const grad = X.child(node, "gradFill");
  if (grad) return parseGradient(grad, ctx);
  const blip = X.child(node, "blipFill");
  if (blip) {
    const b = X.child(blip, "blip");
    return { type: "image", ref: b ? X.attr(b, "embed") : null, crop: parseCrop(blip) };
  }
  const patt = X.child(node, "pattFill");
  if (patt) {
    const c = resolveColor(firstColorChild(patt), ctx);
    return { type: "pattern", prst: X.attr(patt, "prst", ""), fg: c ? colorRef(c) : null };
  }
  if (X.child(node, "grpFill")) return { type: "group" };
  if (X.child(node, "noFill")) return { type: "none" };
  return null;
}

function parseCrop(parent) {
  const src = X.child(parent, "srcRect");
  if (!src) return null;
  const v = (n) => (X.attr(src, n) === null ? null : X.num(X.attr(src, n), 0) / 1000);
  const crop = { l: v("l"), t: v("t"), r: v("r"), b: v("b") };
  return crop.l || crop.t || crop.r || crop.b ? crop : null;
}

// Fill/line inherited from p:style refs (theme references) — recorded, and
// used as a fallback when no explicit fill exists.
function styleRef(node) {
  const style = X.child(node, "style");
  if (!style) return {};
  const out = {};
  for (const ref of ["fillRef", "lnRef", "effectRef", "fontRef"]) {
    const r = X.child(style, ref);
    if (r) out[ref] = { idx: X.num(X.attr(r, "idx"), 0), color: firstColorChild(r) || null };
  }
  return out;
}

function fillFromRef(ref, ctx) {
  if (!ref || !ref.idx) return null;
  const c = resolveColor(ref.color, ctx);
  return c ? { type: "solid", ...colorRef(c), fromStyleRef: true } : null;
}

// -------------------------------------------------------------------- lines

function parseLine(ln, ctx) {
  if (!ln) return null;
  if (X.child(ln, "noFill")) return { none: true };
  let fill = parseFill(ln, ctx);
  const w = X.num(X.attr(ln, "w"), null);
  const out = {};
  if (w !== null) out.wPt = Math.round((w / 12700) * 100) / 100;
  if (fill) out.fill = fill;
  const dash = X.child(ln, "prstDash");
  if (dash) out.dash = X.attr(dash, "val", "");
  const cap = X.attr(ln, "cap");
  if (cap) out.cap = cap;
  for (const endName of ["headEnd", "tailEnd"]) {
    const end = X.child(ln, endName);
    if (end && X.attr(end, "type") && X.attr(end, "type") !== "none") {
      out[endName] = { type: X.attr(end, "type"), w: X.attr(end, "w", "med"), len: X.attr(end, "len", "med") };
    }
  }
  return Object.keys(out).length ? out : null;
}

// ------------------------------------------------------------------- effects

function parseEffects(spPr) {
  const effects = X.child(spPr, "effectLst") || X.child(spPr, "effectDag");
  if (!effects) return null;
  const out = {};
  const shadow = X.child(effects, "outerShdw") || X.child(effects, "innerShdw");
  if (shadow) {
    out.shadow = {
      inner: shadow.local === "innerShdw",
      blurPt: Math.round((X.num(X.attr(shadow, "blurRad"), 0) / 12700) * 100) / 100,
      distPt: Math.round((X.num(X.attr(shadow, "dist"), 0) / 12700) * 100) / 100,
      dirDeg: Math.round((X.num(X.attr(shadow, "dir"), 0) / 60000) * 10) / 10,
    };
  }
  const glow = X.child(effects, "glow");
  if (glow) out.glow = { radiusPt: Math.round((X.num(X.attr(glow, "rad"), 0) / 12700) * 100) / 100 };
  const soft = X.child(effects, "softEdge");
  if (soft) out.softEdge = { radiusPt: Math.round((X.num(X.attr(soft, "rad"), 0) / 12700) * 100) / 100 };
  return Object.keys(out).length ? out : null;
}

// ---------------------------------------------------------------- transforms

// Affine subset {a,d,e,f}: x' = a*x + e, y' = d*y + f (scale + translate).
const IDENTITY = { a: 1, d: 1, e: 0, f: 0 };
const applyT = (t, x, y) => ({ x: t.a * x + t.e, y: t.d * y + t.f });

function composeGroup(parent, grpXfrm) {
  const off = X.child(grpXfrm, "off");
  const ext = X.child(grpXfrm, "ext");
  const chOff = X.child(grpXfrm, "chOff");
  const chExt = X.child(grpXfrm, "chExt");
  const ox = X.num(X.attr(off, "x"), 0);
  const oy = X.num(X.attr(off, "y"), 0);
  const ex = X.num(X.attr(ext, "cx"), 0);
  const ey = X.num(X.attr(ext, "cy"), 0);
  const cx = X.num(X.attr(chOff, "x"), 0);
  const cy = X.num(X.attr(chOff, "y"), 0);
  const cw = X.num(X.attr(chExt, "cx"), 0);
  const chh = X.num(X.attr(chExt, "cy"), 0);
  if (!cw || !chh) return parent;
  const sx = ex / cw;
  const sy = ey / chh;
  return {
    a: parent.a * sx,
    d: parent.d * sy,
    e: parent.e + parent.a * (ox - cx * sx),
    f: parent.f + parent.d * (oy - cy * sy),
  };
}

function parseXfrm(xfrmNode, t) {
  const rotRaw = X.attr(xfrmNode, "rot");
  const flipH = X.attr(xfrmNode, "flipH") === "1";
  const flipV = X.attr(xfrmNode, "flipV") === "1";
  const off = X.child(xfrmNode, "off");
  const ext = X.child(xfrmNode, "ext");
  if (!off || !ext) return null;
  const x0 = X.num(X.attr(off, "x"), 0);
  const y0 = X.num(X.attr(off, "y"), 0);
  const cx = X.num(X.attr(ext, "cx"), 0);
  const cy = X.num(X.attr(ext, "cy"), 0);
  const p = applyT(t, x0, y0);
  return {
    x: Math.round(p.x),
    y: Math.round(p.y),
    cx: Math.round(cx * t.a),
    cy: Math.round(cy * t.d),
    rot: rotRaw === null ? 0 : Math.round((rotRaw / 60000) * 10) / 10,
    flipH,
    flipV,
  };
}

// --------------------------------------------------------------------- text

function typefaceOf(rPr, ctx) {
  const latin = X.child(rPr, "latin");
  let name = latin ? X.attr(latin, "typeface", "") : "";
  if (!name) return { font: null, from: null };
  if (name === "+mj-lt") return { font: ctx.theme.fonts.major.latin || null, from: "theme-major" };
  if (name === "+mn-lt") return { font: ctx.theme.fonts.minor.latin || null, from: "theme-minor" };
  if (name === "+mj-ea") return { font: ctx.theme.fonts.major.ea || null, from: "theme-major-ea" };
  if (name === "+mn-ea") return { font: ctx.theme.fonts.minor.ea || null, from: "theme-minor-ea" };
  return { font: name, from: "explicit" };
}

function runProps(rPr, ctx) {
  if (!rPr) return {};
  const out = {};
  const sz = X.num(X.attr(rPr, "sz"), null);
  if (sz !== null) out.szPt = Math.round((sz / 100) * 10) / 10;
  if (X.attr(rPr, "b") === "1") out.bold = true;
  if (X.attr(rPr, "i") === "1") out.italic = true;
  const u = X.attr(rPr, "u");
  if (u && u !== "none") out.underline = u;
  const strike = X.attr(rPr, "strike");
  if (strike && strike !== "noStrike") out.strike = strike;
  const cap = X.attr(rPr, "cap");
  if (cap && cap !== "none") out.caps = cap;
  const spc = X.num(X.attr(rPr, "spc"), null);
  if (spc) out.spcPt = Math.round((spc / 100) * 100) / 100;
  const baseline = X.num(X.attr(rPr, "baseline"), null);
  if (baseline) out.baselinePct = baseline / 1000;
  const solidFill = X.child(rPr, "solidFill");
  const color = solidFill ? resolveColor(firstColorChild(solidFill), ctx) : resolveColor(firstColorChild(rPr), ctx);
  if (color) out.color = colorRef(color);
  const { font, from } = typefaceOf(rPr, ctx);
  if (font) {
    out.font = font;
    out.fontFrom = from;
  }
  const ln = X.child(rPr, "ln");
  if (ln && !X.child(ln, "noFill")) {
    const lineFill = parseFill(ln, ctx);
    if (lineFill) out.outline = lineFill;
  }
  const hlink = X.child(rPr, "hlinkClick");
  if (hlink && X.attr(hlink, "r:id")) out.linkId = X.attr(hlink, "r:id");
  const hl = X.child(rPr, "highlight");
  if (hl) {
    const hlColor = resolveColor(firstColorChild(hl), ctx);
    if (hlColor) out.highlight = colorRef(hlColor);
  }
  return out;
}

function pPrProps(pPr, ctx) {
  const out = {};
  if (!pPr) return out;
  const lvl = X.num(X.attr(pPr, "lvl"), null);
  if (lvl !== null) out.level = lvl;
  const algn = X.attr(pPr, "algn");
  if (algn) out.align = algn;
  const marL = X.num(X.attr(pPr, "marL"), null);
  if (marL !== null) out.marLIn = emuToIn(marL);
  const indent = X.num(X.attr(pPr, "indent"), null);
  if (indent !== null) out.indentIn = emuToIn(indent);
  const lnSpc = X.child(pPr, "lnSpc");
  if (lnSpc) {
    const pct = X.child(lnSpc, "spcPct");
    const pts = X.child(lnSpc, "spcPts");
    if (pct) out.lineSpacingPct = X.num(X.attr(pct, "val"), 0) / 1000;
    else if (pts) out.lineSpacingPt = Math.round((X.num(X.attr(pts, "val"), 0) / 100) * 10) / 10;
  }
  for (const [key, name] of [["spaceBeforePt", "spcBef"], ["spaceAfterPt", "spcAft"]]) {
    const spc = X.child(pPr, name);
    if (spc) {
      const pts = X.child(spc, "spcPts");
      const pct = X.child(spc, "spcPct");
      if (pts) out[key] = Math.round((X.num(X.attr(pts, "val"), 0) / 100) * 10) / 10;
      else if (pct) out[key.replace("Pt", "Pct")] = X.num(X.attr(pct, "val"), 0) / 1000;
    }
  }
  const buNone = X.child(pPr, "buNone");
  const buChar = X.child(pPr, "buChar");
  const buAuto = X.child(pPr, "buAutoNum");
  if (buNone) out.bullet = { type: "none" };
  else if (buChar) out.bullet = { type: "char", char: X.attr(buChar, "char", "•") };
  else if (buAuto) out.bullet = { type: "auto", scheme: X.attr(buAuto, "type", "arabicPeriod"), startAt: X.num(X.attr(buAuto, "startAt"), 1) };
  const defRPr = X.child(pPr, "defRPr");
  if (defRPr) {
    const props = runProps(defRPr, ctx);
    if (Object.keys(props).length) out.defaultRun = props;
  }
  return out;
}

// lstStyle: per-level run defaults from <a:lstStyle><a:lvlNpPr><a:defRPr>.
function lstStyleDefaults(txBody, ctx) {
  const lst = X.child(txBody, "lstStyle");
  const out = {};
  if (!lst) return out;
  for (let i = 1; i <= 9; i++) {
    const lvl = X.child(lst, "lvl" + i + "pPr");
    if (!lvl) continue;
    const defRPr = X.child(lvl, "defRPr");
    if (defRPr) out[i - 1] = runProps(defRPr, ctx);
  }
  return out;
}

function mergeRunProps(...layers) {
  const out = {};
  const source = {};
  const keys = ["szPt", "bold", "italic", "underline", "strike", "caps", "spcPt", "baselinePct", "color", "font", "fontFrom", "outline", "highlight", "linkId"];
  for (const layer of layers) {
    if (!layer) continue;
    for (const k of keys) {
      if (layer[k] !== undefined && out[k] === undefined) {
        out[k] = layer[k];
        source[k] = layer._src || (layer === layers[0] ? "run" : "inherited");
      }
    }
  }
  if (Object.keys(source).length) out._source = source;
  return out;
}

// Стили плейсхолдеров из макета/мастера: в сгенерированных деках цвет,
// размер и шрифт текста слайда часто лежат именно там, а не в ране.
async function readPlaceholderStyles(deck, part, theme, srcTag) {
  if (!part) return new Map();
  if (!deck._phCache) deck._phCache = new Map();
  const cacheKey = part + "|" + srcTag;
  if (deck._phCache.has(cacheKey)) return deck._phCache.get(cacheKey);
  const map = new Map();
  try {
    const root = X.parse(await deck.read(part));
    const spTree = X.descendants(root, "spTree")[0];
    const ctx = { theme: theme || { scheme: {} } };
    const walk = (node) => {
      for (const sp of X.children(node, "sp")) {
        const nvPr = X.descendants(sp, "nvPr")[0];
        const ph = nvPr ? X.child(nvPr, "ph") : null;
        if (ph) {
          const type = X.attr(ph, "type", "obj");
          const idx = X.num(X.attr(ph, "idx"), null);
          const txBody = X.child(sp, "txBody");
          if (txBody) {
            const levels = {};
            for (let lvl = 0; lvl < 9; lvl++) {
              const props = {};
              const lst = X.child(txBody, "lstStyle");
              if (lst) {
                const lvlPr = X.child(lst, "lvl" + (lvl + 1) + "pPr");
                const defRPr = lvlPr ? X.child(lvlPr, "defRPr") : null;
                if (defRPr) Object.assign(props, runProps(defRPr, ctx));
              }
              levels[lvl] = props;
            }
            const firstP = X.child(txBody, "p");
            const base = {};
            if (firstP) {
              const pPr = X.child(firstP, "pPr");
              const defRPr = pPr ? X.child(pPr, "defRPr") : null;
              if (defRPr) Object.assign(base, runProps(defRPr, ctx));
              const endPara = X.child(firstP, "endParaRPr");
              if (endPara) Object.assign(base, runProps(endPara, ctx));
            }
            for (const k of Object.keys(base)) base[k] = base[k];
            base._src = srcTag;
            for (const k of Object.keys(levels)) levels[k]._src = srcTag;
            const entry = { levels, base };
            map.set(type + "#" + (idx === null ? "" : idx), entry);
            if (!map.has(type + "#")) map.set(type + "#", entry);
          }
        }
        if (X.child(sp, "grpSp")) walk(X.child(sp, "grpSp"));
      }
      for (const g of X.children(node, "grpSp")) walk(g);
    };
    walk(spTree || root);
    // Мастерские стили текста (p:txStyles) — наследуются плейсхолдерами,
    // когда макет не задаёт defRPr.
    const txStyles = X.descendants(root, "txStyles")[0];
    if (txStyles) {
      const mapStyle = { titleStyle: "title", bodyStyle: "body", otherStyle: "other" };
      for (const styleNode of txStyles.children) {
        const styleName = mapStyle[styleNode.local];
        if (!styleName) continue;
        const levels = {};
        for (let lvl = 0; lvl < 9; lvl++) {
          const props = {};
          const lvlPr = X.child(styleNode, "lvl" + (lvl + 1) + "pPr");
          const defRPr = lvlPr ? X.child(lvlPr, "defRPr") : null;
          if (defRPr) Object.assign(props, runProps(defRPr, ctx));
          props._src = srcTag;
          levels[lvl] = props;
        }
        const firstP = X.child(styleNode, "p");
        const base = {};
        if (firstP) {
          const pPr = X.child(firstP, "pPr");
          const defRPr = pPr ? X.child(pPr, "defRPr") : null;
          if (defRPr) Object.assign(base, runProps(defRPr, ctx));
          const endPara = X.child(firstP, "endParaRPr");
          if (endPara) Object.assign(base, runProps(endPara, ctx));
        }
        base._src = srcTag;
        map.set("style:" + styleName + "#", { levels, base });
      }
    }
  } catch (e) {
    // стили макета не критичны — молча пропускаем
  }
  deck._phCache.set(cacheKey, map);
  return map;
}

function placeholderDefaults(maps, placeholder) {
  if (!placeholder) return null;
  const styleKey = { title: "title", ctrTitle: "title", body: "body", subTitle: "body" }[placeholder.type] || "other";
  const keys = [
    placeholder.type + "#" + (placeholder.idx === null || placeholder.idx === undefined ? "" : placeholder.idx),
    placeholder.type + "#",
    "style:" + styleKey + "#",
  ];
  for (const key of keys) {
    const merged = { levels: {}, base: null };
    let found = false;
    for (const map of maps) {
      const entry = map && map.get(key);
      if (!entry) continue;
      found = true;
      for (let lvl = 0; lvl < 9; lvl++) {
        merged.levels[lvl] = { ...(merged.levels[lvl] || {}), ...entry.levels[lvl] };
        if (entry.levels[lvl] && entry.levels[lvl]._src) merged.levels[lvl]._src = entry.levels[lvl]._src;
      }
      if (entry.base) merged.base = { ...(merged.base || {}), ...entry.base, _src: entry.base._src };
    }
    if (found) return merged;
  }
  return null;
}

function parseTextBody(txBody, ctx) {
  if (!txBody) return null;
  const phDefaults = ctx.phDefaults || null;
  const bodyPr = X.child(txBody, "bodyPr");
  const text = { paragraphs: [], plain: "" };
  if (bodyPr) {
    text.anchor = X.attr(bodyPr, "anchor", "t");
    text.wrap = X.attr(bodyPr, "wrap", "square");
    const ins = (n) => (X.attr(bodyPr, n) === null ? null : emuToIn(X.num(X.attr(bodyPr, n), 0)));
    text.insetsIn = { l: ins("lIns"), t: ins("tIns"), r: ins("rIns"), b: ins("bIns") };
    if (X.child(bodyPr, "normAutofit")) {
      const na = X.child(bodyPr, "normAutofit");
      text.autofit = "shrink";
      const fs = X.num(X.attr(na, "fontScale"), null);
      const lr = X.num(X.attr(na, "lnSpcReduction"), null);
      if (fs !== null) text.fontScalePct = fs / 1000;
      if (lr !== null) text.lineSpacingReductionPct = lr / 1000;
    } else if (X.child(bodyPr, "spAutoFit")) text.autofit = "shape";
    else if (X.child(bodyPr, "noAutofit")) text.autofit = "none";
  }
  const defaults = lstStyleDefaults(txBody, ctx);
  const lines = [];
  for (const p of X.children(txBody, "p")) {
    const pPr = X.child(p, "pPr");
    const props = pPrProps(pPr, ctx);
    const lvlDefault = defaults[props.level || 0];
    const runs = [];
    for (const node of p.children) {
      if (node.local === "r" || node.local === "fld") {
        const rPr = X.child(node, "rPr");
        const t = X.child(node, "t");
        const base = runProps(rPr, ctx);
        const endPara = X.child(p, "endParaRPr");
        const endProps = endPara ? runProps(endPara, ctx) : null;
        const phLevel = phDefaults && phDefaults.levels ? phDefaults.levels[props.level || 0] : null;
        const merged = mergeRunProps(base, endProps, props.defaultRun, lvlDefault, phLevel, phDefaults ? phDefaults.base : null, ctx.styleText || null);
        const text = t ? X.allText(t) : "";
        if (text) {
          // Не задано вообще нигде → это дефолт PowerPoint, помечаем честно.
          if (merged.szPt === undefined) {
            merged.szPt = 18;
            (merged._source = merged._source || {}).szPt = "default";
          }
          if (merged.color === undefined) {
            merged.color = { hex: "#000000" };
            (merged._source = merged._source || {}).color = "default";
          }
          if (merged.font === undefined) {
            merged.font = (ctx.theme && ctx.theme.fonts && ctx.theme.fonts.minor && ctx.theme.fonts.minor.latin) || null;
            merged.fontFrom = "theme-minor";
            (merged._source = merged._source || {}).font = "default";
          }
        }
        runs.push({
          text,
          field: node.local === "fld" ? X.attr(node, "type", "field") : undefined,
          ...merged,
        });
      } else if (node.local === "br") {
        runs.push({ text: "\n", br: true });
      }
    }
    lines.push({ ...props, runs });
  }
  text.paragraphs = lines;
  // `plain` is what analysis/rework reads: keep the bullet marker (buChar is
  // formatting, so without this a bullet list came out as run-on lines).
  text.plain = lines
    .map((l) => {
      const t = l.runs.map((r) => r.text).join("");
      const marker = l.bullet && l.bullet.char ? l.bullet.char : null;
      if (!marker || !t.trim() || t.startsWith(marker)) return t;
      return `${marker} ${t}`;
    })
    .join("\n");
  return text;
}

// ---------------------------------------------------------------- geometry

function parseGeom(spPr) {
  const prst = X.child(spPr, "prstGeom");
  if (prst) {
    const adj = [];
    const avLst = X.child(prst, "avLst");
    for (const gd of X.children(avLst, "gd")) adj.push({ name: X.attr(gd, "name", ""), fmla: X.attr(gd, "fmla", "") });
    return { prst: X.attr(prst, "prst", "rect"), ...(adj.length ? { adj } : {}) };
  }
  const cust = X.child(spPr, "custGeom");
  if (cust) {
    const pathLst = X.child(cust, "pathLst");
    const paths = X.children(pathLst, "path");
    let points = 0;
    for (const p of paths) points += p.children.filter((c) => ["moveTo", "lnTo", "cubicBezTo", "quadBezTo", "arcTo"].includes(c.local)).length;
    const first = paths[0];
    return {
      custGeom: {
        paths: paths.length,
        points,
        w: X.num(X.attr(first, "w"), 0),
        h: X.num(X.attr(first, "h"), 0),
      },
    };
  }
  const custom = X.child(spPr, "spPr") ? null : null;
  return custom || { prst: null };
}

// --------------------------------------------------------------- chart part

function chartText(node) {
  if (!node) return null;
  const t = X.descendants(node, "t");
  const s = t.map((x) => X.allText(x)).join("");
  return s || null;
}

function parseChart(xmlText, ctx) {
  const root = X.parse(xmlText);
  const chart = X.child(root, "chart") || root;
  const plot = X.child(chart, "plotArea");
  const out = { types: [], series: [], title: null };
  const titleNode = X.child(chart, "title");
  out.title = chartText(titleNode);
  if (!plot) return out;
  const typeNodes = [];
  for (const c of plot.children) {
    if (/^[a-z]+Chart$/.test(c.local) || c.local === "ofPieChart") typeNodes.push(c);
  }
  for (const tn of typeNodes) {
    const kind = tn.local.replace(/Chart$/, "");
    const grouping = X.attr(tn, "grouping");
    const barDir = X.attr(X.child(tn, "barDir"), "val");
    out.types.push({ kind, grouping: grouping || null, barDir: barDir || null });
    for (const ser of X.children(tn, "ser")) {
      const nameRef = X.child(ser, "tx");
      const catRef = X.child(ser, "cat") || X.child(ser, "xVal");
      const valRef = X.child(ser, "val") || X.child(ser, "yVal");
      const cacheOf = (ref) => {
        if (!ref) return [];
        const cache = X.descendants(ref, "pt");
        return cache.map((pt) => {
          const v = X.child(pt, "v");
          return v ? X.allText(v) : null;
        }).filter((v) => v !== null);
      };
      const series = {
        name: chartText(nameRef) || null,
        cats: cacheOf(catRef),
        vals: cacheOf(valRef),
      };
      const spPr = X.child(ser, "spPr");
      const fill = spPr ? parseFill(spPr, ctx) : null;
      if (fill) series.fill = fill;
      out.series.push(series);
    }
  }
  const dTable = X.child(plot, "dTable");
  if (dTable) out.dataTable = true;
  return out;
}

// ------------------------------------------------------------------- tables

function parseTable(tbl, ctx) {
  const grid = X.child(tbl, "tblGrid");
  const colWidths = X.children(grid, "gridCol").map((c) => emuToIn(X.num(X.attr(c, "w"), 0)));
  const rows = [];
  for (const tr of X.children(tbl, "tr")) {
    const height = X.num(X.attr(tr, "h"), null);
    const cells = [];
    for (const tc of X.children(tr, "tc")) {
      const tcPr = X.child(tc, "tcPr");
      const cell = { text: parseTextBody(X.child(tc, "txBody"), ctx)?.plain || "" };
      if (tcPr) {
        const gs = X.num(X.attr(tcPr, "gridSpan"), null);
        const rs = X.num(X.attr(tcPr, "rowSpan"), null);
        if (gs) cell.gridSpan = gs;
        if (rs) cell.rowSpan = rs;
        if (X.attr(tcPr, "hMerge") === "1") cell.hMerge = true;
        if (X.attr(tcPr, "vMerge") === "1") cell.vMerge = true;
        const fill = parseFill(tcPr, ctx);
        if (fill) cell.fill = fill;
        const anchor = X.attr(tcPr, "anchor");
        if (anchor) cell.anchor = anchor;
      }
      cells.push(cell);
    }
    rows.push({ heightIn: height === null ? null : emuToIn(height), cells });
  }
  return { cols: colWidths.length, rows: rows.length, colWidthsIn: colWidths, rowsData: rows };
}

// --------------------------------------------------------------- media info

function parseSvgSize(buf) {
  const s = buf.toString("utf8", 0, Math.min(buf.length, 4096));
  const w = /<svg[^>]*\bwidth="([\d.]+)(px|pt)?"/i.exec(s);
  const h = /<svg[^>]*\bheight="([\d.]+)(px|pt)?"/i.exec(s);
  const vb = /viewBox="([\d.\s-]+)"/i.exec(s);
  const out = {};
  if (w) out.w = Math.round(parseFloat(w[1]));
  if (h) out.h = Math.round(parseFloat(h[1]));
  if ((!out.w || !out.h) && vb) {
    const p = vb[1].trim().split(/[\s,]+/).map(Number);
    if (p.length === 4) {
      if (!out.w) out.w = Math.round(p[2]);
      if (!out.h) out.h = Math.round(p[3]);
    }
  }
  return out;
}

function parseEmfSize(buf) {
  try {
    if (buf.length < 40) return {};
    const l = buf.readInt32LE(8);
    const t = buf.readInt32LE(12);
    const r = buf.readInt32LE(16);
    const b = buf.readInt32LE(20);
    // rclBounds is in 0.01 mm units.
    const mm = (v) => v / 100;
    return { wmm: Math.round(r - l), hmm: Math.round(b - t), bbox: { l: mm(l), t: mm(t), r: mm(r), b: mm(b) } };
  } catch (e) {
    return {};
  }
}

function imageDims(buf, ext) {
  try {
    if (ext === "png" && buf.length > 24) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (ext === "jpg" || ext === "jpeg") {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        }
        if (len <= 0) break;
        i += 2 + len;
      }
      return {};
    }
    if (ext === "gif" && buf.length > 10) return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    if (ext === "webp" && buf.length > 30) {
      if (buf.toString("ascii", 12, 16) === "VP8X") {
        const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
        const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
        return { w, h };
      }
      if (buf.toString("ascii", 12, 16) === "VP8 ") {
        return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
      }
      return {};
    }
    if (ext === "svg") return parseSvgSize(buf);
    if (ext === "emf") return parseEmfSize(buf);
    if (ext === "bmp" && buf.length > 26) return { w: buf.readInt32LE(18), h: Math.abs(buf.readInt32LE(22)) };
    return {};
  } catch (e) {
    return {};
  }
}

// Programmatic image stats: what a text-only agent needs to pick a background
// or decor without seeing pixels. PNG (8-bit) is decoded with zlib and unfiltered;
// SVG gets its palette from fill/stroke colors; GIF/dim-only and JPEG/WebP are
// reported honestly as "stats unavailable".
function sampleStats(pixels, pxCount, alphaMode) {
  let r = 0, g = 0, b = 0, n = 0, aSum = 0, minA = 255;
  let satSum = 0;
  for (let i = 0; i < pxCount; i++) {
    const o = i * (alphaMode ? 4 : 3);
    const a = alphaMode ? pixels[o + 3] : 255;
    aSum += a;
    if (a < minA) minA = a;
    if (a < 24) continue;
    const pr = pixels[o], pg = pixels[o + 1], pb = pixels[o + 2];
    r += pr; g += pg; b += pb; n++;
    const mx = Math.max(pr, pg, pb), mn = Math.min(pr, pg, pb);
    satSum += mx === 0 ? 0 : (mx - mn) / mx;
  }
  if (!n) return null;
  r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
  const hex = "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return {
    avgColor: hex,
    luminance: Math.round((lum / 255) * 100) / 100,
    dark: lum / 255 < 0.35,
    light: lum / 255 > 0.75,
    saturated: satSum / n > 0.35,
    hasAlpha: alphaMode ? minA < 250 || aSum / n < 250 : false,
  };
}

function pngStats(buf) {
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  let palette = null, trns = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "PLTE") palette = Buffer.from(data);
    else if (type === "tRNS") trns = Buffer.from(data);
    else if (type === "IDAT") idat.push(Buffer.from(data));
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (!width || !height || bitDepth !== 8 || !idat.length) return null;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) return null;
  let raw;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat));
  } catch (e) {
    return null;
  }
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) return null;
  const out = Buffer.alloc(height * stride);
  let inPos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[inPos++];
    const rowStart = y * stride;
    const prevStart = rowStart - stride;
    for (let x = 0; x < stride; x++) {
      const rv = raw[inPos + x];
      const a = x >= channels ? out[rowStart + x - channels] : 0;
      const b = y > 0 ? out[prevStart + x] : 0;
      const c = x >= channels && y > 0 ? out[prevStart + x - channels] : 0;
      let v;
      if (filter === 0) v = rv;
      else if (filter === 1) v = rv + a;
      else if (filter === 2) v = rv + b;
      else if (filter === 3) v = rv + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = rv + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else return null;
      out[rowStart + x] = v & 0xff;
    }
    inPos += stride;
  }
  // Downsample to ~24k samples for speed.
  const total = width * height;
  const step = Math.max(1, Math.floor(Math.sqrt(total / 24000)));
  const rgba = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const o = y * stride + x * channels;
      let r, g, b, alpha = 255;
      if (colorType === 6) { r = out[o]; g = out[o + 1]; b = out[o + 2]; alpha = out[o + 3]; }
      else if (colorType === 2) { r = out[o]; g = out[o + 1]; b = out[o + 2]; }
      else if (colorType === 0) { r = g = b = out[o]; }
      else if (colorType === 4) { r = g = b = out[o]; alpha = out[o + 1]; }
      else if (colorType === 3) {
        if (!palette) return null;
        const idx = out[o];
        r = palette[idx * 3]; g = palette[idx * 3 + 1]; b = palette[idx * 3 + 2];
        if (trns && idx < trns.length) alpha = trns[idx];
      }
      rgba.push(r, g, b, alpha);
    }
  }
  const stats = sampleStats(rgba, rgba.length / 4, true);
  if (stats) {
    stats.width = width;
    stats.height = height;
    stats.aspect = Math.round((width / height) * 100) / 100;
  }
  return stats;
}

function svgStats(buf) {
  const text = buf.toString("utf8");
  const colors = new Map();
  const re = /(?:fill|stroke|stop-color)\s*[:=]\s*"?(#[0-9A-Fa-f]{3,8})/g;
  let m;
  while ((m = re.exec(text))) {
    let hex = m[1].slice(1);
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    if (hex.length === 6 || hex.length === 8) {
      const key = "#" + hex.slice(0, 6).toUpperCase();
      colors.set(key, (colors.get(key) || 0) + 1);
    }
  }
  if (!colors.size) return { palette: [], note: "no explicit colors (uses currentColor)" };
  const entries = [...colors.entries()].sort((a, b) => b[1] - a[1]);
  let r = 0, g = 0, b = 0, n = 0, sat = 0;
  for (const [hex, count] of entries.slice(0, 6)) {
    const pr = parseInt(hex.slice(1, 3), 16), pg = parseInt(hex.slice(3, 5), 16), pb = parseInt(hex.slice(5, 7), 16);
    r += pr * count; g += pg * count; b += pb * count; n += count;
    const mx = Math.max(pr, pg, pb), mn = Math.min(pr, pg, pb);
    sat += (mx === 0 ? 0 : (mx - mn) / mx) * count;
  }
  r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return {
    palette: entries.slice(0, 4).map(([hex, count]) => ({ hex, count })),
    avgColor: "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase(),
    luminance: Math.round((lum / 255) * 100) / 100,
    dark: lum / 255 < 0.35,
    light: lum / 255 > 0.75,
    saturated: sat / n > 0.35,
  };
}

function imageStats(buf, ext) {
  if (ext === "png") return pngStats(buf);
  if (ext === "svg") return svgStats(buf);
  return null;
}

const VECTOR_EXT = new Set(["svg", "emf", "wmf"]);
const PHOTO_EXT = new Set(["wdp", "tif", "tiff"]);

// ---------------------------------------------------------------- pptx open

function normalizePart(baseDir, target) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = (baseDir ? baseDir.split("/") : []).concat(target.split("/"));
  const out = [];
  for (const p of parts) {
    if (!p || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

async function openPptx(file) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error("pptx: file not found: " + abs);
  let zip;
  try {
    zip = await getJSZip().loadAsync(fs.readFileSync(abs));
  } catch (e) {
    throw new Error(
      "pptx: " + path.basename(abs) + " is not a readable .pptx (not a zip archive). " +
        "If it opens in PowerPoint it may be an old .ppt — re-save as .pptx; if encrypted, remove the password.",
    );
  }
  const parts = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  if (!parts.includes("ppt/presentation.xml")) {
    throw new Error("pptx: " + path.basename(abs) + " has no ppt/presentation.xml — not a PowerPoint package");
  }

  return {
    file: abs,
    bytes: fs.statSync(abs).size,
    zip,
    parts: new Set(parts),
    async read(part) {
      const entry = zip.file(part);
      if (!entry) throw new Error("pptx: missing part " + part);
      return entry.async("string");
    },
    async readBuf(part) {
      const entry = zip.file(part);
      if (!entry) return null;
      return entry.async("nodebuffer");
    },
    async relsFor(part) {
      const dir = path.posix.dirname(part);
      const relsPart = (dir === "." ? "" : dir + "/") + "_rels/" + path.posix.basename(part) + ".rels";
      if (!parts.includes(relsPart)) return new Map();
      const xmlText = await this.read(relsPart);
      const root = X.parse(xmlText);
      const map = new Map();
      for (const rel of X.children(root, "Relationship")) {
        map.set(X.attr(rel, "Id"), {
          type: X.attr(rel, "Type", ""),
          target: X.attr(rel, "Target", ""),
          external: X.attr(rel, "TargetMode", "") === "External",
        });
      }
      for (const [, rel] of map) {
        rel.part = rel.external || rel.target.startsWith("http") ? null : normalizePart(dir === "." ? "" : dir, rel.target);
      }
      return map;
    },
  };
}

// ------------------------------------------------------------------- theme

async function readTheme(deck) {
  const collection = await collectThemes(deck);
  return collection.primary;
}

// All themes referenced by presentation and masters, plus the master→theme map
// (a deck can carry several masters; each slide inherits its own theme).
async function collectThemes(deck) {
  const cache = new Map();
  const load = async (part) => {
    if (!part) return null;
    if (cache.has(part)) return cache.get(part);
    const theme = await readThemePart(deck, part);
    cache.set(part, theme);
    return theme;
  };
  const presRels = await deck.relsFor("ppt/presentation.xml");
  let presentationTheme = null;
  for (const [, rel] of presRels) {
    if (rel.type.endsWith("/theme") && rel.part) presentationTheme = await load(rel.part);
  }
  const masterThemes = new Map();
  const masterParts = [...deck.parts].filter((n) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(n));
  for (const master of masterParts) {
    const rels = await deck.relsFor(master);
    for (const [, rel] of rels) {
      if (rel.type.endsWith("/theme") && rel.part) {
        const theme = await load(rel.part);
        if (theme) masterThemes.set(master, theme);
      }
    }
  }
  // Layouts → masters (for per-slide theme resolution).
  const layoutMaster = new Map();
  for (const layout of [...deck.parts].filter((n) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(n))) {
    const rels = await deck.relsFor(layout);
    for (const [, rel] of rels) {
      if (rel.type.endsWith("/slideMaster") && rel.part) layoutMaster.set(layout, rel.part);
    }
  }
  const unique = [...cache.values()];
  return {
    primary: presentationTheme || unique[0] || { colors: {}, fonts: { major: {}, minor: {} }, scheme: {} },
    themes: unique,
    masterThemes,
    layoutMaster,
  };
}

async function readThemePart(deck, themePart) {
  const out = {
    part: themePart,
    name: null,
    colors: {},
    scheme: {},
    fonts: { major: {}, minor: {} },
  };
  if (!themePart) return out;
  const xmlText = await deck.read(themePart);
  const root = X.parse(xmlText);
  const themeEl = root.local === "theme" ? root : X.child(root, "theme");
  const elements = X.child(themeEl, "themeElements");
  const cs = X.child(elements, "clrScheme");
  out.name = X.attr(cs, "name", null);
  for (const c of X.children(cs)) {
    const local = c.local;
    const valueNode = firstColorChild(c);
    let hex = null;
    if (local === "dk1" || local === "lt1" || local === "dk2" || local === "lt2" || /^accent\d$/.test(local) || local === "hlink" || local === "folHlink") {
      if (valueNode) {
        if (valueNode.local === "sysClr") hex = X.attr(valueNode, "lastClr", null) || PRST_COLORS[String(X.attr(valueNode, "val", "")).toLowerCase()] || null;
        else hex = X.attr(valueNode, "val", null);
      }
      if (hex) {
        out.colors[local] = "#" + hex.toUpperCase();
        // Scheme children in the theme usually carry no transforms; keep raw.
        out.scheme[local] = hex.toUpperCase();
      }
    }
  }
  // fillStyleLst colors — needed to resolve slide/bgRef (idx >= 1001).
  out.fillStyleColors = [];
  const fmtScheme = X.child(elements, "fmtScheme");
  const fillLst = fmtScheme ? X.child(fmtScheme, "fillStyleLst") : null;
  for (const f of X.children(fillLst)) {
    const c = resolveColor(firstColorChild(f), { theme: { scheme: out.scheme } });
    out.fillStyleColors.push(c ? colorRef(c) : null);
  }
  const fs2 = X.child(elements, "fontScheme");
  for (const which of ["major", "minor"]) {
    const fontNode = X.child(fs2, which + "Font");
    if (!fontNode) continue;
    for (const script of ["latin", "ea", "cs"]) {
      const s = X.child(fontNode, script);
      if (s) out.fonts[which][script] = X.attr(s, "typeface", "") || null;
    }
  }
  return out;
}

// ------------------------------------------------------------------- slides

function elementBox(xfrm) {
  if (!xfrm) return {};
  const inBox = { x: emuToIn(xfrm.x), y: emuToIn(xfrm.y), w: emuToIn(xfrm.cx), h: emuToIn(xfrm.cy) };
  const pxBox = { x: emuToPx(xfrm.x), y: emuToPx(xfrm.y), w: emuToPx(xfrm.cx), h: emuToPx(xfrm.cy) };
  return {
    emu: { x: xfrm.x, y: xfrm.y, w: xfrm.cx, h: xfrm.cy },
    in: inBox,
    px: pxBox,
    rot: xfrm.rot || 0,
    ...(xfrm.flipH ? { flipH: true } : {}),
    ...(xfrm.flipV ? { flipV: true } : {}),
  };
}

function parseShape(sp, ctx) {
  const nv = X.child(sp, "nvSpPr") || X.child(sp, "nvCxnSpPr");
  const cNvPr = X.child(nv, "cNvPr");
  const spPr = X.child(sp, "spPr");
  const nvPr = X.child(nv, "nvPr");
  const ph = nvPr ? X.child(nvPr, "ph") : null;
  const line = spPr ? parseLine(X.child(spPr, "ln"), ctx) : null;
  const el = {
    kind: sp.local === "cxnSp" ? "connector" : "shape",
    id: X.num(X.attr(cNvPr, "id"), null),
    name: X.attr(cNvPr, "name", "") || "",
    ...(X.attr(cNvPr, "descr") ? { descr: X.attr(cNvPr, "descr") } : {}),
    ...(X.attr(cNvPr, "title") ? { title: X.attr(cNvPr, "title") } : {}),
    ...(ph ? { placeholder: { type: X.attr(ph, "type", "obj"), idx: X.num(X.attr(ph, "idx"), null), sz: X.attr(ph, "sz", null) } } : {}),
  };
  if (spPr) {
    const xfrm = X.child(spPr, "xfrm");
    if (xfrm) el.box = elementBox(parseXfrm(xfrm, ctx.t));
    const geom = parseGeom(spPr);
    el.geom = geom.prst || (geom.custGeom ? "custom" : null);
    if (geom.custGeom) el.custGeom = geom.custGeom;
    if (geom.adj) el.adj = geom.adj;
    const fill = parseFill(spPr, ctx);
    if (fill) el.fill = fill;
    if (line) el.line = line;
    const effects = parseEffects(spPr);
    if (effects) el.effects = effects;
    const refs = styleRef(sp);
    if (refs.fillRef && refs.fillRef.idx && !el.fill) {
      const fromRef = fillFromRef(refs.fillRef, ctx);
      if (fromRef) el.fill = fromRef;
    }
  }
  const refs = styleRef(sp);
  const styleText = {};
  if (refs.fontRef && refs.fontRef.idx) {
    const c = resolveColor(refs.fontRef.color, ctx);
    if (c) styleText.color = colorRef(c);
    const coll = String(refs.fontRef.idx).toLowerCase();
    if (coll === "major" || coll === "minor") {
      const tf = ctx.theme.fonts[coll] && ctx.theme.fonts[coll].latin;
      if (tf) {
        styleText.font = tf;
        styleText.fontFrom = "theme-" + coll;
      }
    }
    styleText._src = "styleRef";
  }
  const childCtx = {
    ...ctx,
    phDefaults: ph && ctx.phMaps ? placeholderDefaults(ctx.phMaps, { type: X.attr(ph, "type", "obj"), idx: X.num(X.attr(ph, "idx"), null) }) : null,
    styleText: Object.keys(styleText).length > 1 ? styleText : null,
  };
  el.text = parseTextBody(X.child(sp, "txBody"), childCtx);
  return el;
}

function parsePicture(pic, ctx) {
  const nv = X.child(pic, "nvPicPr");
  const cNvPr = X.child(nv, "cNvPr");
  const blipFill = X.child(pic, "blipFill");
  const blip = X.child(blipFill, "blip");
  const spPr = X.child(pic, "spPr");
  const el = {
    kind: "picture",
    id: X.num(X.attr(cNvPr, "id"), null),
    name: X.attr(cNvPr, "name", "") || "",
    ...(X.attr(cNvPr, "descr") ? { descr: X.attr(cNvPr, "descr") } : {}),
  };
  if (spPr) {
    const xfrm = X.child(spPr, "xfrm");
    if (xfrm) el.box = elementBox(parseXfrm(xfrm, ctx.t));
    const geom = parseGeom(spPr);
    el.geom = geom.prst || (geom.custGeom ? "custom" : null);
    const line = parseLine(X.child(spPr, "ln"), ctx);
    if (line) el.line = line;
    const effects = parseEffects(spPr);
    if (effects) el.effects = effects;
  }
  if (blip) {
    const svgBlip = X.descendants(blip, "svgBlip")[0];
    const svgEmbed = svgBlip ? X.attr(svgBlip, "r:embed") : null;
    el.mediaRef = X.attr(blip, "embed") || X.attr(blip, "link") || svgEmbed || null;
    el.mediaLinked = !X.attr(blip, "embed") && !!X.attr(blip, "link");
    if (svgEmbed) {
      el.svgRef = svgEmbed;
      el.svgVector = !X.attr(blip, "embed"); // SVG with no raster fallback
    }
  }
  if (blipFill) {
    el.crop = parseCrop(blipFill);
    if (X.child(blipFill, "tile")) el.tile = true;
  }
  const alpha = X.child(blip, "alphaModFix");
  if (alpha && X.attr(alpha, "amt") !== null) el.alphaPct = Math.round((X.num(X.attr(alpha, "amt"), 100000) / 1000) * 10) / 10;
  const hlink = cNvPr ? X.child(cNvPr, "hlinkClick") : null;
  if (hlink && X.attr(hlink, "r:id")) el.linkId = X.attr(hlink, "r:id");
  return el;
}

function parseGraphicFrame(gf, ctx) {
  const nv = X.child(gf, "nvGraphicFramePr");
  const cNvPr = X.child(nv, "cNvPr");
  const xfrmNode = X.child(gf, "xfrm");
  const el = {
    kind: "graphicFrame",
    id: X.num(X.attr(cNvPr, "id"), null),
    name: X.attr(cNvPr, "name", "") || "",
  };
  if (xfrmNode) el.box = elementBox(parseXfrm(xfrmNode, ctx.t));
  const graphic = X.child(gf, "graphic");
  const data = X.child(graphic, "graphicData");
  const uri = X.attr(data, "uri", "");
  if (/table$/.test(uri)) {
    el.frame = "table";
    const tbl = X.child(data, "tbl");
    if (tbl) el.table = parseTable(tbl, ctx);
  } else if (/chart$/.test(uri)) {
    el.frame = "chart";
    const chartRef = X.descendants(data, "chart")[0];
    if (chartRef) el.chartRef = X.attr(chartRef, "r:id", null);
    const extLst = X.child(data, "extLst");
    if (extLst) el.chartExternal = true;
  } else if (/diagram$/.test(uri)) {
    el.frame = "diagram";
    const rel = X.descendants(data, "relIds")[0];
    if (rel) el.diagramRef = X.attr(rel, "r:dm", null) || null;
  } else if (/ole$/.test(uri) || /package$/.test(uri)) {
    el.frame = "ole";
  } else {
    el.frame = "other";
  }
  return el;
}

async function parseGroup(grp, ctx, out, depth, parentIds) {
  const nv = X.child(grp, "nvGrpSpPr");
  const cNvPr = X.child(nv, "cNvPr");
  const grpSpPr = X.child(grp, "grpSpPr");
  const xfrm = grpSpPr ? X.child(grpSpPr, "xfrm") : null;
  const id = X.num(X.attr(cNvPr, "id"), null);
  const el = {
    kind: "group",
    id,
    name: X.attr(cNvPr, "name", "") || "",
    depth,
    groupPath: parentIds.slice(),
    children: [],
  };
  if (xfrm) {
    el.box = elementBox(parseXfrm(xfrm, ctx.t));
    if (X.attr(xfrm, "rot")) el.rot = Math.round((X.num(X.attr(xfrm, "rot"), 0) / 60000) * 10) / 10;
  }
  out.push(el);
  const childT = xfrm ? composeGroup(ctx.t, xfrm) : ctx.t;
  const childCtx = { ...ctx, t: childT, approxBox: ctx.approxBox || !!X.attr(xfrm || { attrs: {} }, "rot") };
  const nextPath = parentIds.concat(id === null ? [] : [id]);
  for (const child of grp.children) {
    await parseElement(child, childCtx, el.children, depth + 1, nextPath);
  }
  return el;
}

async function parseElement(node, ctx, out, depth, parentIds) {
  switch (node.local) {
    case "sp":
    case "cxnSp": {
      const el = parseShape(node, ctx);
      el.depth = depth;
      el.groupPath = parentIds.slice();
      out.push(el);
      return el;
    }
    case "pic": {
      const el = parsePicture(node, ctx);
      el.depth = depth;
      el.groupPath = parentIds.slice();
      out.push(el);
      return el;
    }
    case "grpSp":
      return parseGroup(node, ctx, out, depth, parentIds);
    case "graphicFrame": {
      const el = parseGraphicFrame(node, ctx);
      el.depth = depth;
      el.groupPath = parentIds.slice();
      out.push(el);
      return el;
    }
    default:
      return null;
  }
}

function resolveBgRef(bgRef, theme) {
  const idx = X.num(X.attr(bgRef, "idx"), 0);
  const own = resolveColor(firstColorChild(bgRef), { theme: theme || { scheme: {} } });
  if (own) return { type: "solid", ...colorRef(own), bgRefIdx: idx, fromThemeRef: true };
  if (idx >= 1001 && theme && theme.fillStyleColors && theme.fillStyleColors[idx - 1001]) {
    return { type: "solid", ...theme.fillStyleColors[idx - 1001], bgRefIdx: idx, fromThemeRef: true };
  }
  return { type: "themeRef", bgRefIdx: idx, fromThemeRef: true };
}

// Background of a layout/master part as it renders: a full-slide painted
// layer in the part's own shape tree (the common corporate "фон") paints OVER
// the part's cSld bg, so it wins; otherwise the declared bg is used.
async function readPartBg(deck, part, theme, slideSize) {
  if (!part) return null;
  if (!deck._bgCache) deck._bgCache = new Map();
  const key = part + (slideSize ? "@" + slideSize.cx + "x" + slideSize.cy : "");
  if (!deck._bgCache.has(key)) {
    let bg = null;
    try {
      const root = X.parse(await deck.read(part));
      const rels = await deck.relsFor(part);
      const cSld = X.descendants(root, "cSld")[0];
      // 1. full-slide shapes/pictures in the part's spTree (topmost wins)
      const spTree = cSld ? X.child(cSld, "spTree") : null;
      if (spTree && slideSize) {
        const full = [];
        const walk = (node) => {
          for (const c of node.children) {
            if (c.local === "sp" || c.local === "pic") {
              const spPr = X.child(c, "spPr");
              const xfrm = spPr ? X.child(spPr, "xfrm") : null;
              const off = xfrm ? X.child(xfrm, "off") : null;
              const ext = xfrm ? X.child(xfrm, "ext") : null;
              if (off && ext) {
                const w = X.num(X.attr(ext, "cx"), 0);
                const h = X.num(X.attr(ext, "cy"), 0);
                if (w >= slideSize.cx * 0.9 && h >= slideSize.cy * 0.9) {
                  if (c.local === "pic") {
                    const blip = X.descendants(c, "blip")[0];
                    const svg = X.descendants(c, "svgBlip")[0];
                    const rid = blip ? X.attr(blip, "embed") || X.attr(blip, "link") : null;
                    const srid = svg ? X.attr(svg, "r:embed") : null;
                    const useRid = svg ? srid : rid;
                    if (useRid && rels.has(useRid)) {
                      const rel = rels.get(useRid);
                      if (rel.part) full.push({ type: "image", media: path.posix.basename(rel.part), ref: useRid });
                    }
                  } else {
                    const fill = parseFill(spPr, { theme: theme || { scheme: {} } });
                    if (fill && fill.type !== "none") full.push(fill);
                  }
                }
              }
            }
            if (c.local === "grpSp") walk(c);
          }
        };
        walk(spTree);
        const last = full[full.length - 1];
        if (last) bg = last;
      }
      // 2. declared cSld bg
      if (!bg) {
        const bgNode = cSld ? X.child(cSld, "bg") : null;
        if (bgNode) {
          const bgPr = X.child(bgNode, "bgPr");
          if (bgPr) {
            bg = parseFill(bgPr, { theme: theme || { scheme: {} } });
            if (bg && bg.type === "image" && bg.ref && rels.has(bg.ref)) {
              const rel = rels.get(bg.ref);
              if (rel.part) bg.media = path.posix.basename(rel.part);
            }
          }
          const bgRef = X.child(bgNode, "bgRef");
          if (bgRef) bg = resolveBgRef(bgRef, theme);
        }
      }
    } catch (e) {
      bg = null;
    }
    deck._bgCache.set(key, bg);
  }
  return deck._bgCache.get(key);
}

async function parseSlide(deck, part, index, themes, slideSize) {
  const xmlText = await deck.read(part);
  const root = X.parse(xmlText);
  const sld = X.child(root, "sld") || root;
  const cSld = X.child(sld, "cSld");
  const spTree = X.child(cSld, "spTree");
  const rels = await deck.relsFor(part);
  const slide = {
    index,
    part,
    name: path.posix.basename(part),
    bg: null,
    elements: [],
    notes: null,
    counts: {},
  };

  // Resolve layout → master → theme: a deck can carry several masters, and
  // inheritance (theme colors, placeholder styles) follows this chain.
  const layoutRel = [...rels.values()].find((r) => r.type.endsWith("/slideLayout"));
  if (layoutRel) slide.layout = layoutRel.part;
  if (slide.layout && themes.layoutMaster) slide.master = themes.layoutMaster.get(slide.layout) || null;
  const slideTheme = (slide.master && themes.masterThemes && themes.masterThemes.get(slide.master)) || themes.primary;
  slide.themePart = slideTheme && slideTheme.part ? slideTheme.part : null;
  const ctx = { theme: slideTheme || themes.primary, t: IDENTITY, approxBox: false };
  if (slide.master || slide.layout) {
    const masterPh = slide.master ? await readPlaceholderStyles(deck, slide.master, ctx.theme, "master") : null;
    const layoutPh = slide.layout ? await readPlaceholderStyles(deck, slide.layout, ctx.theme, "layout") : null;
    ctx.phMaps = [layoutPh, masterPh].filter(Boolean); // layout перекрывает master
  }
  if (slide.layout) {
    slide.bgFromLayout = await readPartBg(deck, slide.layout, ctx.theme, slideSize);
  }
  if (!slide.bgFromLayout && slide.master) {
    slide.bgFromMaster = await readPartBg(deck, slide.master, ctx.theme, slideSize);
  }

  // Background: explicit p:bg wins; otherwise the layout background applies
  // (recorded as inherited with the layout part for honesty).
  const bg = X.child(cSld, "bg");
  if (bg) {
    const bgPr = X.child(bg, "bgPr");
    if (bgPr) {
      const fill = parseFill(bgPr, ctx);
      if (fill) slide.bg = fill;
    }
    const bgRef = X.child(bg, "bgRef");
    if (bgRef) slide.bg = resolveBgRef(bgRef, ctx.theme);
  }
  if (!slide.bg && slide.layout) slide.bgInheritedFromLayout = slide.layout;
  if (slide.bg && slide.bg.type === "image" && slide.bg.ref && rels.has(slide.bg.ref)) {
    const rel = rels.get(slide.bg.ref);
    if (rel.part) slide.bg.media = path.posix.basename(rel.part);
  }

  if (spTree) {
    for (const child of spTree.children) {
      if (["sp", "pic", "grpSp", "cxnSp", "graphicFrame", "contentPart"].includes(child.local)) {
        await parseElement(child, ctx, slide.elements, 0, []);
      }
    }
  }

  // Resolve media references and hyperlinks via the slide relationships.
  const walk = (els) => {
    for (const el of els) {
      if (el.mediaRef && rels.has(el.mediaRef)) {
        const rel = rels.get(el.mediaRef);
        el.media = rel.part ? path.posix.basename(rel.part) : rel.target;
      }
      if (el.linkId && rels.has(el.linkId)) el.link = rels.get(el.linkId).target;
      if (el.chartRef && rels.has(el.chartRef)) el.chartPart = rels.get(el.chartRef).part;
      if (el.children) walk(el.children);
      const text = el.text;
      if (text) {
        for (const p of text.paragraphs) {
          for (const r of p.runs) {
            if (r.linkId && rels.has(r.linkId)) r.link = rels.get(r.linkId).target;
          }
        }
      }
    }
  };
  walk(slide.elements);

  // Notes text: speaker notes only — the slide-number placeholder that every
  // notes page carries is not a note.
  const notesRel = [...rels.values()].find((r) => r.type.endsWith("/notesSlide"));
  if (notesRel && notesRel.part) {
    const notesXml = await deck.read(notesRel.part);
    const nRoot = X.parse(notesXml);
    const texts = [];
    const collectNotes = (node) => {
      for (const c of node.children) {
        if (c.local === "sp" || c.local === "pic") {
          const nvPr = X.descendants(c, "nvPr")[0];
          const ph = nvPr ? X.child(nvPr, "ph") : null;
          if (ph && X.attr(ph, "type") === "sldNum") continue; // page number, not a note
          for (const t of X.descendants(c, "t")) {
            const s = X.allText(t).trim();
            if (s) texts.push(s);
          }
        } else {
          collectNotes(c);
        }
      }
    };
    collectNotes(nRoot);
    const joined = texts.join("\n").trim();
    slide.notes = joined || null;
  }

  // Raw tag counts — the file's own truth, used as a self-check of the parse.
  slide.rawCounts = {
    sp: (xmlText.match(/<p:sp[ >]/g) || []).length,
    pic: (xmlText.match(/<p:pic[ >]/g) || []).length,
    grpSp: (xmlText.match(/<p:grpSp[ >]/g) || []).length,
    cxnSp: (xmlText.match(/<p:cxnSp[ >]/g) || []).length,
    graphicFrame: (xmlText.match(/<p:graphicFrame[ >]/g) || []).length,
    gradFill: (xmlText.match(/<a:gradFill[ >]/g) || []).length,
    custGeom: (xmlText.match(/<a:custGeom[ >]/g) || []).length,
    blip: (xmlText.match(/<a:blip[ >]/g) || []).length,
    svgBlip: (xmlText.match(/[A-Za-z0-9_]+:svgBlip[ >]/g) || []).length,
    tbl: (xmlText.match(/<a:tbl[ >]/g) || []).length,
  };
  // Effective background: explicit cSld bg → full-slide painted layer (the
  // common "фон" rectangle/photo) → layout → master. Style extraction and the
  // report use this, because most real decks paint their background in shapes.
  let effBg = null;
  let effSource = null;
  if (slideSize) {
    const full = [];
    const walk = (els) => {
      for (const el of els) {
        const box = el.box;
        if (box && box.emu && box.emu.w >= slideSize.cx * 0.9 && box.emu.h >= slideSize.cy * 0.9 && !el.text) {
          if (el.kind === "picture" && el.media) full.push({ type: "image", media: el.media, ref: el.mediaRef });
          else if (el.kind === "shape" && el.fill && el.fill.type !== "none") full.push(el.fill);
        }
        if (el.children) walk(el.children);
      }
    };
    walk(slide.elements);
    const last = full[full.length - 1];
    if (last) {
      effBg = last;
      effSource = last.type === "image" ? "full-slide-image" : "full-slide-shape";
    }
  }
  if (!effBg && slide.bgFromLayout) {
    effBg = slide.bgFromLayout;
    effSource = "layout";
  }
  if (!effBg && slide.bgFromMaster) {
    effBg = slide.bgFromMaster;
    effSource = "master";
  }
  if (!effBg && slide.bg) {
    effBg = slide.bg;
    effSource = "slide";
  }
  slide.effectiveBg = effBg || null;
  slide.effectiveBgSource = effSource || "none";
  return slide;
}

// ------------------------------------------------------------------- reader

// Deterministic media roles from geometry/usage — the text-only agent must be
// able to pick assets without looking at pixels: "background / logo / icon /
// decor / photo / content", with the evidence that decided it.
function classifyMedia(media, slideSizePx, slides) {
  const usageOf = (name) => {
    const out = [];
    for (const s of slides) {
      const walk = (els) => {
        for (const el of els) {
          if (el.kind === "picture" && el.media === name && el.box && el.box.px) {
            out.push({
              slide: s.index,
              x: el.box.px.x,
              y: el.box.px.y,
              w: el.box.px.w,
              h: el.box.px.h,
              fullSlide: el.box.px.w >= slideSizePx.w * 0.9 && el.box.px.h >= slideSizePx.h * 0.9,
            });
          }
          if (el.children) walk(el.children);
        }
      };
      walk(s.elements);
    }
    return out;
  };
  for (const m of media) {
    const usages = usageOf(m.name);
    const partOwner = (m.usedByParts || []).some((p) => /slideLayouts|slideMasters|notesMasters/.test(p));
    const slideCount = new Set(usages.map((u) => u.slide)).size;
    const maxW = usages.reduce((a, u) => Math.max(a, u.w), 0);
    const maxH = usages.reduce((a, u) => Math.max(a, u.h), 0);
    const maxArea = Math.max(...usages.map((u) => u.w * u.h), 0);
    const minY = usages.length ? Math.min(...usages.map((u) => u.y)) : null;
    const minX = usages.length ? Math.min(...usages.map((u) => u.x)) : null;
    const rightEdge = usages.length ? Math.max(...usages.map((u) => u.x + u.w)) : null;
    const bottomEdge = usages.length ? Math.max(...usages.map((u) => u.y + u.h)) : null;
    const squareish = maxW > 0 && Math.abs(maxW - maxH) / Math.max(maxW, maxH) < 0.25;
    const small = maxW <= 320 && maxH <= 200;
    const medium = maxW <= 620 && maxH <= 620;
    const areaShare = maxArea / (slideSizePx.w * slideSizePx.h);
    const nearTop = minY !== null && minY <= slideSizePx.h * 0.15;
    const nearLeft = minX !== null && minX <= slideSizePx.w * 0.12;
    const nearEdge =
      (rightEdge !== null && rightEdge >= slideSizePx.w * 0.82) ||
      (bottomEdge !== null && bottomEdge >= slideSizePx.h * 0.82) ||
      nearLeft;

    let role;
    let why;
    if (m.usedAsBackground || usages.some((u) => u.fullSlide) || (partOwner && areaShare >= 0.5)) {
      role = "background";
      why = m.usedAsBackground
        ? "layout/master background"
        : usages.some((u) => u.fullSlide)
          ? "placed full-slide"
          : "used by master/layout at large size";
    } else if (small && nearTop && (nearLeft || (slideCount >= 3 && maxW >= maxH * 1.6))) {
      role = "logo";
      why = `small ${maxW}×${maxH}px near the top edge, on ${slideCount || "master"} slide(s)`;
    } else if (medium && squareish && slideCount >= 2) {
      role = "icon";
      why = `${maxW}×${maxH}px, repeated on ${slideCount} slides`;
    } else if (medium && (nearEdge || slideCount >= 2)) {
      role = "decor";
      why = nearEdge ? `${maxW}×${maxH}px at the slide edge` : `${maxW}×${maxH}px, repeated on ${slideCount} slides`;
    } else if (m.visual && m.visual.hasAlpha && m.visual.saturated && medium) {
      role = "decor";
      why = `${maxW}×${maxH}px, transparent and saturated — decorative element`;
    } else if (areaShare >= 0.25) {
      role = "photo";
      why = `covers ${Math.round(areaShare * 100)}% of the slide`;
    } else {
      role = "graphic";
      why = `${maxW}×${maxH}px inside the content area, purpose not obvious`;
    }
    if (m.ext === "emf" || m.ext === "wmf" || m.ext === "wdp") {
      why += "; cannot be inlined into HTML (rasterize or replace)";
    }
    if (m.visual) {
      const v = m.visual;
      const bits = [];
      if (v.note) bits.push(v.note);
      if (v.dark) bits.push("dark");
      if (v.light) bits.push("light");
      if (v.saturated) bits.push("saturated");
      if (v.hasAlpha) bits.push("has transparency");
      if (v.avgColor) bits.push(v.avgColor);
      if (bits.length) why += " [" + bits.join(", ") + "]";
    }
    m.role = role;
    m.roleWhy = why;
  }
}

async function readDeck(file, opts = {}) {
  const deck = await openPptx(file);
  const themes = await collectThemes(deck);
  const theme = themes.primary;
  // Charts and any theme-dependent parsing use the per-slide theme on demand;
  // the global `theme` stays the presentation-level one for reporting.

  // Presentation order comes from sldIdLst, not filenames.
  const presXml = await deck.read("ppt/presentation.xml");
  const presRoot = X.parse(presXml);
  const ppt = X.child(presRoot, "presentation") || presRoot;
  const sldSz = X.child(ppt, "sldSz");
  const cx = X.num(X.attr(sldSz, "cx"), 12192000);
  const cy = X.num(X.attr(sldSz, "cy"), 6858000);
  const presRels = await deck.relsFor("ppt/presentation.xml");
  const slideIds = [];
  const sldIdLst = X.child(ppt, "sldIdLst");
  for (const sldId of X.children(sldIdLst, "sldId")) {
    const rid = X.attr(sldId, "r:id");
    const rel = presRels.get(rid);
    if (rel && rel.part) slideIds.push(rel.part);
  }
  // Fallbacks and validation.
  const allSlideParts = [...deck.parts].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => {
    const na = +(/slide(\d+)/.exec(a) || [])[1];
    const nb = +(/slide(\d+)/.exec(b) || [])[1];
    return na - nb;
  });
  const slides = slideIds.length ? slideIds : allSlideParts;
  if (!slides.length) throw new Error("pptx: " + path.basename(deck.file) + " contains 0 slides — re-export it");

  // Media inventory with per-slide usage.
  const mediaEntries = [...deck.parts]
    .filter((n) => /^ppt\/media\//.test(n))
    .sort();
  const media = [];
  const usage = new Map(); // basename -> [{slide, elementId}]
  for (const part of mediaEntries) {
    const name = path.posix.basename(part);
    const ext = (name.split(".").pop() || "").toLowerCase();
    const buf = await deck.readBuf(part);
    const dims = imageDims(buf, ext);
    const kind = VECTOR_EXT.has(ext) ? "vector" : PHOTO_EXT.has(ext) ? "photo" : "raster";
    const entry = {
      name,
      ext,
      kind,
      bytes: buf ? buf.length : 0,
      ...dims,
      usedBySlides: [],
      usedByElementIds: [],
      links: /^https?:/.test(ext) ? true : undefined,
    };
    if (buf && opts.visual !== false) {
      const stats = imageStats(buf, ext);
      if (stats) entry.visual = stats;
      else if (["jpg", "jpeg", "webp", "wdp", "emf", "wmf", "tif", "tiff"].includes(ext)) {
        entry.visual = { note: "stats unavailable offline (no decoder for ." + ext + ")" };
      }
    }
    media.push(entry);
    usage.set(name, entry);
  }

  const slideResults = [];
  const colorHistogram = new Map();
  const fontHistogram = new Map();
  const bump = (map, key) => {
    if (!key) return;
    map.set(key, (map.get(key) || 0) + 1);
  };

  // Referenced-anywhere usage: a media file can also be used by a master or a
  // layout (brand backgrounds, logos) — it is not an orphan then.
  const usedByParts = new Map();
  for (const part of deck.parts) {
    if (!part.endsWith(".rels")) continue;
    let relRoot;
    try {
      relRoot = X.parse(await deck.read(part));
    } catch (e) {
      continue;
    }
    for (const rel of X.children(relRoot, "Relationship")) {
      if (!/(\/image|\/media)$/.test(X.attr(rel, "Type", ""))) continue;
      const target = X.attr(rel, "Target", "");
      if (!target || /^https?:/.test(target)) continue;
      const name = path.posix.basename(target);
      const owner = part.replace(/^_rels\//, "").replace(/\.rels$/, "");
      if (!usedByParts.has(name)) usedByParts.set(name, new Set());
      usedByParts.get(name).add(owner);
    }
  }
  for (const [name, owners] of usedByParts) {
    const entry = usage.get(path.posix.basename(name));
    if (entry) entry.usedByParts = [...owners].sort();
  }

  for (let i = 0; i < slides.length; i++) {
    const slide = await parseSlide(deck, slides[i], i + 1, themes, { cx, cy });
    for (const bg of [slide.bg, slide.bgFromLayout, slide.bgFromMaster]) {
      if (!bg || !bg.media) continue;
      const entry = media.find((m) => m.name === bg.media);
      if (!entry) continue;
      if (!entry.usedBySlides.includes(slide.index)) entry.usedBySlides.push(slide.index);
      entry.usedAsBackground = true;
    }
    const mark = (els) => {
      for (const el of els) {
        if (el.media && usage.has(el.media)) {
          const entry = usage.get(el.media);
          if (!entry.usedBySlides.includes(slide.index)) entry.usedBySlides.push(slide.index);
          if (el.id !== null) entry.usedByElementIds.push(el.id);
        }
        if (el.children) mark(el.children);
        const text = el.text;
        if (text) {
          for (const p of text.paragraphs) {
            for (const r of p.runs) {
              if (r.color && r.color.hex) bump(colorHistogram, r.color.hex);
              if (r.font) bump(fontHistogram, r.font);
            }
          }
        }
      }
    };
    mark(slide.elements);
    slideResults.push(slide);
  }

  // Charts.
  for (const slide of slideResults) {
    const walk = async (els) => {
      for (const el of els) {
        if (el.frame === "chart" && el.chartPart) {
          try {
            const xmlText = await deck.read(el.chartPart);
            el.chart = parseChart(xmlText, { theme });
          } catch (e) {
            el.chartError = String(e.message || e);
          }
        }
        if (el.children) await walk(el.children);
      }
    };
    await walk(slide.elements);
  }

  classifyMedia(media, { w: emuToPx(cx), h: emuToPx(cy) }, slideResults);

  // Totals.
  const notesParts = [...deck.parts].filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n)).length;
  const totals = {
    slides: slideResults.length,
    shapes: 0,
    pics: 0,
    groups: 0,
    connectors: 0,
    graphicFrames: 0,
    tables: 0,
    charts: 0,
    gradients: 0,
    custGeom: 0,
    media: media.length,
    svgMedia: media.filter((m) => m.ext === "svg").length,
    svgBlips: 0,
    vectorMedia: media.filter((m) => VECTOR_EXT.has(m.ext)).length,
    notes: slideResults.filter((s) => s.notes).length,
    notesParts,
    orphanMedia: 0,
    embeddedFonts: [...deck.parts].filter((n) => /^ppt\/fonts\/.*\.fntdata$/.test(n)).length,
  };
  const walkCount = (els) => {
    for (const el of els) {
      if (el.kind === "shape") totals.shapes++;
      else if (el.kind === "picture") totals.pics++;
      else if (el.kind === "group") totals.groups++;
      else if (el.kind === "connector") totals.connectors++;
      else if (el.kind === "graphicFrame") totals.graphicFrames++;
      if (el.frame === "table") totals.tables++;
      if (el.frame === "chart") totals.charts++;
      if (el.custGeom) totals.custGeom++;
      if (el.children) walkCount(el.children);
    }
  };
  for (const slide of slideResults) {
    slide.counts = { ...slide.rawCounts };
    totals.gradients += slide.rawCounts.gradFill;
    totals.svgBlips += slide.rawCounts.svgBlip || 0;
    walkCount(slide.elements);
  }
  totals.orphanMedia = media.filter((m) => !(m.usedByParts && m.usedByParts.length)).length;

  return {
    file: deck.file,
    bytes: deck.bytes,
    slideSize: {
      emu: { cx, cy },
      in: { w: emuToIn(cx), h: emuToIn(cy) },
      px: { w: emuToPx(cx), h: emuToPx(cy) },
    },
    theme,
    themes: themes.themes.map((t) => ({ part: t.part, name: t.name, colors: t.colors, major: t.fonts.major.latin, minor: t.fonts.minor.latin })),
    masterThemes: [...themes.masterThemes.entries()].map(([master, t]) => ({ master, theme: t.part, major: t.fonts.major.latin, minor: t.fonts.minor.latin })),
    themeUsage: (() => {
      const count = new Map();
      for (const s of slideResults) {
        const key = s.themePart || "none";
        count.set(key, (count.get(key) || 0) + 1);
      }
      return [...count.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([part, sl]) => {
          const t = themes.themes.find((x) => x.part === part);
          return { theme: part, slides: sl, major: t ? t.fonts.major.latin : null, minor: t ? t.fonts.minor.latin : null };
        });
    })(),
    layoutCount: [...deck.parts].filter((n) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(n)).length,
    masterCount: [...deck.parts].filter((n) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(n)).length,
    totals,
    media,
    colorHistogram: [...colorHistogram.entries()].sort((a, b) => b[1] - a[1]).map(([hex, n]) => ({ hex, n })),
    fontHistogram: [...fontHistogram.entries()].sort((a, b) => b[1] - a[1]).map(([font, n]) => ({ font, n })),
    slides: slideResults,
  };
}

module.exports = {
  readDeck,
  openPptx,
  parseChart,
  parseTextBody,
  resolveColor,
  emuToIn,
  emuToPx,
  PRST_COLORS,
  IMAGE_DIMS: imageDims,
};
