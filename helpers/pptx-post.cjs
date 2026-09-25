// presentation v2 — post-processing of the exported .pptx.
//
// Problem it fixes (found by artifact-level validation): the export engine
// writes CSS line-height as EXACT line spacing (`<a:lnSpc><a:spcPts …>`).
// Renderers (PowerPoint, LibreOffice) position glyphs of the first line by
// the font's own ascent/descent; when exact spacing is smaller than the font's
// natural line height (Unbounded, display faces), the text pokes ABOVE the
// shape box and overlaps whatever sits above it — while the HTML was perfect.
//
// Fix: rewrite exact spacing to PROPORTIONAL (`spcPct = spcPts / sz × 100000`,
// i.e. back to the CSS line-height percentage). Proportional spacing scales
// the font's natural metrics, so glyphs never leave the box.
//
// Also normalises `<a:spcPts>` inside spcBef/spcAft stay untouched (they are
// paragraph spacing, not line height).
"use strict";

const fs = require("fs");
const path = require("path");
const X = require("./lib/xml.cjs");

let JSZip = null;
function getJSZip() {
  if (JSZip) return JSZip;
  const vendor = path.join(__dirname, "..", "vendor", "jszip.bundle.cjs");
  JSZip = fs.existsSync(vendor) ? require(vendor) : require("jszip");
  return JSZip;
}

// Paragraph slice around an offset: the line-spacing value and the run size
// must come from the SAME <a:p>, otherwise a duplicate spcPts earlier in the
// part hijacks the font size (and the rewrite lands on the wrong paragraph).
function paragraphAround(xml, offset) {
  const startOpen = xml.lastIndexOf("<a:p>", offset);
  const startOpenAttr = xml.lastIndexOf("<a:p ", offset);
  const start = Math.max(startOpen, startOpenAttr);
  const end = xml.indexOf("</a:p>", offset);
  return { start: start === -1 ? 0 : start, end: end === -1 ? xml.length : end };
}

// → { buffer, fixed, details: [{ part, from, to }] }
async function fixLineSpacing(buffer) {
  const zip = await getJSZip().loadAsync(buffer);
  const parts = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const details = [];
  for (const part of parts) {
    const xml = await zip.file(part).async("string");
    let changed = false;
    const out = xml.replace(/<a:lnSpc>\s*<a:spcPts val="(\d+)"\s*\/>\s*<\/a:lnSpc>/g, (m, ptsRaw, offset) => {
      const pts = parseInt(ptsRaw, 10);
      if (!Number.isFinite(pts) || pts <= 0) return m;
      // Размер шрифта — из того же абзаца: сначала раны после lnSpc, затем
      // любой rPr/endParaRPr до конца абзаца.
      const { start, end } = paragraphAround(xml, offset);
      const para = xml.slice(start, end);
      const rel = offset - start;
      const szMatch =
        /<a:rPr[^>]*\bsz="(\d+)"/.exec(para.slice(rel)) ||
        /<a:rPr[^>]*\bsz="(\d+)"/.exec(para) ||
        /<a:endParaRPr[^>]*\bsz="(\d+)"/.exec(para);
      const sz = szMatch ? parseInt(szMatch[1], 10) : null;
      if (!sz) return m;
      const pct = Math.round((pts / sz) * 100000);
      if (pct < 50000 || pct > 300000) return m; // защита от мусора
      changed = true;
      details.push({ part, from: pts, to: pct });
      return `<a:lnSpc><a:spcPct val="${pct}"/></a:lnSpc>`;
    });
    if (changed) zip.file(part, out);
  }
  if (!details.length) return { buffer, fixed: 0, details };
  const result = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { buffer: result, fixed: details.length, details };
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: pptx-post.cjs <deck.pptx>");
    process.exit(2);
  }
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) {
    console.error("pptx-post: file not found: " + abs);
    process.exit(1);
  }
  const { buffer, fixed, details } = await fixLineSpacing(fs.readFileSync(abs));
  fs.writeFileSync(abs, buffer);
  console.log(`pptx-post: ${fixed} line-spacing value(s) exact → proportional in ${path.basename(abs)}`);
  for (const d of details.slice(0, 8)) console.log(`  ${d.part}: ${d.from}/100pt → ${d.to / 1000}%`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error("pptx-post: " + (e && e.message ? e.message : e));
    process.exit(1);
  });
}

module.exports = { fixLineSpacing };
