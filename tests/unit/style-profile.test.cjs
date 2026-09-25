#!/usr/bin/env node
// Unit test: the template deploy manifest (helpers/style-profile.cjs → deployAssets).
//   - backgrounds: the slide-1 art is named "cover" and deployed first;
//   - a near-white wide lockup is branded, NOT decor (the real failure: it was
//     pasted top-right on every slide, on top of the logo);
//   - decor keeps a stack (two elements on one template slide) and says the
//     template never repeats one at identical coordinates;
//   - photos/icons get their own menu with circle/placement hints;
//   - slide numbers are 1-based (s.index), not off by one;
//   - layout recipes map media to the deployed file names.
//
//   node tests/unit/style-profile.test.cjs
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");
const { deployAssets } = require(path.join(__dirname, "..", "..", "helpers", "style-profile.cjs"));

const pic = (media, x, y, w, h, rot = 0) => ({ kind: "picture", media, box: { px: { x, y, w, h, rot } }, children: [] });
const box = (hex, alpha, w = 1000, h = 500) => ({
  kind: "shape",
  fill: { type: "solid", hex, alpha },
  box: { emu: { w, h } },
  children: [],
});

function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "presentation-v3-profile-"));
  const assetsDir = path.join(dir, "profile-assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  const deckDir = path.join(dir, "deck");

  const media = [
    { name: "cover.png", role: "background", kind: "raster", w: 3840, h: 2160, usedBySlides: [1], visual: { luminance: 0.3, hasAlpha: false } },
    { name: "content.png", role: "background", kind: "raster", w: 2933, h: 1650, usedBySlides: [2], visual: { luminance: 0.13, hasAlpha: false } },
    { name: "brand.png", role: "decor", kind: "raster", w: 328, h: 114, usedBySlides: [1], visual: { luminance: 1, hasAlpha: true } },
    { name: "banana.png", role: "decor", kind: "raster", w: 693, h: 693, usedBySlides: [2], visual: { luminance: 0.77, hasAlpha: true } },
    { name: "arrow.png", role: "decor", kind: "raster", w: 288, h: 288, usedBySlides: [2], visual: { luminance: 0.61, hasAlpha: true } },
    { name: "logo.svg", role: "logo", kind: "vector", w: 187, h: 30, usedBySlides: [2], visual: { luminance: 1 } },
    { name: "girl.png", role: "photo", kind: "raster", w: 1079, h: 1079, usedBySlides: [2], visual: { luminance: 0.7, hasAlpha: true } },
    { name: "icon.png", role: "icon", kind: "raster", w: 190, h: 190, usedBySlides: [2], visual: { luminance: 0.5, hasAlpha: true } },
  ];
  const written = media.map((m) => ({ name: m.name, role: m.role, bytes: 4, usedBySlides: m.usedBySlides }));
  for (const m of media) fs.writeFileSync(path.join(assetsDir, m.name), "fake");

  const deck = {
    slides: [
      {
        index: 1,
        effectiveBg: { media: "cover.png", type: "image" },
        effectiveBgSource: "full-slide-image",
        elements: [pic("cover.png", 0, 0, 1280, 720), pic("brand.png", 34, 641, 178, 62), pic("logo.svg", 48, 20, 122, 19)],
      },
      {
        index: 2,
        effectiveBg: { media: "content.png", type: "image" },
        effectiveBgSource: "layout",
        elements: [
          pic("content.png", 0, 0, 1280, 720),
          pic("banana.png", 766, -224, 444, 444, 205),
          pic("arrow.png", 1099, 17, 159, 159),
          pic("logo.svg", 48, 20, 122, 19),
          pic("girl.png", 884, -295, 691, 691),
          pic("icon.png", 878, 33, 108, 103),
          box("#FFFFFF", 0.15),
        ],
      },
    ],
    media,
  };
  const colors = { fillVariants: [{ css: "rgba(255, 255, 255, 0.15)", hex: "#FFFFFF", alpha: 0.15, shapes: 1, slides: [2] }] };

  const r = deployAssets(assetsDir, written, deckDir, deck, colors);
  const md = fs.readFileSync(path.join(deckDir, "images", "template-assets.md"), "utf8");

  assert.strictEqual(r.backgrounds, 2, "two backgrounds deployed");
  assert.ok(md.indexOf("## Background 1 (cover)") !== -1, "the slide-1 art is marked as the cover");
  assert.ok(/## Background 1 \(cover\)[\s\S]*?template-bg-1\.png/.test(md), "cover art is Background 1");
  assert.ok(md.includes('<img class="logo pos-tl"'), "logo keeps the template's top-left corner");
  assert.ok(md.includes("## Branding lockup"), "the near-white wide lockup becomes branding");
  assert.ok(!/## Decor[^]*?brand\.png/.test(md), "branding must not be in the decor menu");
  assert.ok(md.includes("It is NOT decor"), "branding carries the do-not-overlap warning");
  assert.strictEqual(r.branding, 1, "one branding lockup");
  assert.strictEqual(r.decor, 2, "two decors on the same slide are kept (a stack)");
  assert.ok(/## Decor 1 \(693×693px\)[\s\S]*?slide 2: left 766px, top -224px, 444×444px, rot 205°/.test(md), "decor placement + rotation is 1-based slide 2");
  assert.ok(md.includes("does NOT repeat decor at identical coordinates"), "decor variety rule is spelled out");
  assert.ok(md.includes("## Photo 1") && md.includes("decor-img round"), "a square photo gets the circle hint");
  assert.ok(md.includes("## Icon 1"), "icons get their own menu");
  assert.ok(md.includes("## Box styles") && md.includes("rgba(255, 255, 255, 0.15)"), "box variants are listed with slide evidence");
  assert.ok(/- slide 1[:(]/.test(md), "recipes use slide 1");
  assert.ok(/- slide 2[:(]/.test(md), "recipes use slide 2 (1-based, not 3)");
  assert.ok(!/- slide 3[:(]/.test(md), "there is no slide 3");
  assert.ok(md.includes("template-decor-1.png") && md.includes("@766,-224"), "recipes map media to deployed decor names");
  assert.ok(md.indexOf("- slide 1") < md.indexOf("- slide 2"), "recipes are ordered");

  console.log("PASS  style-profile: манифест шаблона (cover-first, брендинг≠декор, меню фото/иконок, 1-based подписи)");
}

main();
