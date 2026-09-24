#!/usr/bin/env node
// Unit test: pptx-post.cjs must take the font size from the SAME paragraph
// as the line-spacing value. Regression for the offset bug where a duplicate
// spcPts earlier in the part hijacked the size (all body paragraphs share one
// line-height value, so the collision was guaranteed on real decks).
//
//   node tests/unit/pptx-post.test.cjs
"use strict";

const path = require("path");
const assert = require("assert");
const JSZip = require(path.join(__dirname, "..", "..", "vendor", "jszip.bundle.cjs"));
const { fixLineSpacing } = require(path.join(__dirname, "..", "..", "helpers", "pptx-post.cjs"));

const slideXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody>
    <a:bodyPr/><a:lstStyle/>
    <a:p><a:pPr><a:lnSpc><a:spcPts val="1400"/></a:lnSpc></a:pPr><a:r><a:rPr lang="ru-RU" sz="1400"/><a:t>Первый</a:t></a:r><a:endParaRPr sz="1400"/></a:p>
    <a:p><a:pPr><a:lnSpc><a:spcPts val="1400"/></a:lnSpc></a:pPr><a:r><a:rPr lang="ru-RU" sz="2800"/><a:t>Второй</a:t></a:r></a:p>
  </p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`;

async function main() {
  const zip = new JSZip();
  zip.file("ppt/slides/slide1.xml", slideXml);
  const buf = await zip.generateAsync({ type: "nodebuffer" });

  const { buffer, fixed, details } = await fixLineSpacing(buf);
  assert.strictEqual(fixed, 2, `expected 2 fixes, got ${fixed}`);

  const out = await JSZip.loadAsync(buffer);
  const xml = await out.file("ppt/slides/slide1.xml").async("string");
  const pcts = [...xml.matchAll(/<a:spcPct val="(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepStrictEqual(pcts, [100000, 50000], `spcPct values wrong: ${pcts.join(", ")}`);
  assert.deepStrictEqual(
    details.map((d) => d.to),
    [100000, 50000],
    "details must carry the per-paragraph percentage",
  );

  // A run whose size sits before the lnSpc inside the same rPr still resolves
  // (fallback scans the whole paragraph, not just the text after the value).
  const inline = `<p:sld xmlns:a="x"><p:cSld><p:spTree><p:sp><p:txBody>
    <a:p><a:pPr/><a:r><a:rPr sz="1600"><a:lnSpc><a:spcPts val="1200"/></a:lnSpc></a:rPr><a:t>X</a:t></a:r></a:p>
  </p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  const zip2 = new JSZip();
  zip2.file("ppt/slides/slide1.xml", inline);
  const r2 = await fixLineSpacing(await zip2.generateAsync({ type: "nodebuffer" }));
  assert.strictEqual(r2.fixed, 1, "the same-paragraph fallback must still fix the value");
  const xml2 = await (await JSZip.loadAsync(r2.buffer)).file("ppt/slides/slide1.xml").async("string");
  assert.ok(xml2.includes('<a:spcPct val="75000"/>'), "1200pt at 16pt must become 75%");

  console.log("PASS  pptx-post: размер шрифта берётся из своего абзаца");
}

main().catch((e) => {
  console.error("FAIL  pptx-post: " + (e.message || e));
  process.exit(1);
});
