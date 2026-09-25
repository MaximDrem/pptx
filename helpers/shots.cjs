#!/usr/bin/env node
// presentation v3 — render a .pptx to per-slide PNGs so a vision-capable model
// can actually SEE a template/reference deck before copying its style.
//
//   node shots.cjs <deck.pptx> [--out-dir <dir>] [--keep]
//
// Uses the app's own one-shot renderer (`--pptx-verify`), the same mode the
// old skill used: it loads the pptx with the production preview renderer and
// captures every slide. Output: slide-NN.png + report.json in --out-dir
// (default: a temp dir; pass --out-dir to keep). Prints one line per slide:
//   slide 01: /abs/path/slide-01.png
// plus a compact text digest per slide (title + background + media roles) so
// the model can jump straight to the right images.
//
// If the app is unavailable, the helper says so and suggests the fallback:
// `read-pptx.cjs <deck.pptx> --extract-media <dir>` and looking at the
// extracted pictures directly.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { readDeck } = require("./lib/pptx.cjs");

function usage() {
  console.error("usage: shots.cjs <deck.pptx> [--out-dir <dir>] [--keep]");
  process.exit(2);
}

function digest(deck, limit) {
  const lines = [];
  const roleOf = new Map((deck.media || []).map((m) => [m.name, m.role || "picture"]));
  const n = Math.min(deck.slides.length, limit || deck.slides.length);
  for (let i = 0; i < n; i++) {
    const s = deck.slides[i];
    const texts = [];
    for (const el of s.elements) {
      if (el.text && el.text.plain && el.text.plain.trim()) texts.push(el.text.plain.trim());
      if (texts.length >= 4) break;
    }
    const title = (texts[0] || "").replace(/\s+/g, " ").slice(0, 48);
    const bg = s.effectiveBg
      ? `${s.effectiveBg.type}${s.effectiveBg.media ? "(" + s.effectiveBg.media + ")" : ""}@${s.effectiveBgSource || "?"}`
      : "none";
    lines.push(`  slide ${String(i + 1).padStart(2, "0")}: «${title}» bg=${bg}`);
    // What the eye sees besides text: pictures with role/size/position and the
    // filled shapes (boxes). This is what tells a template's decor and layout
    // variety apart from a wall of identical rectangles.
    const pics = s.elements.filter((e) => e.kind === "picture" && e.media);
    if (pics.length) {
      const parts = pics.slice(0, 5).map((p) => {
        const px = (p.box && p.box.px) || {};
        const role = roleOf.get(p.media) || "picture";
        return `${p.media}[${role}] ${px.w}×${px.h}@${px.x},${px.y}${px.rot ? " rot" + Math.round(px.rot) + "°" : ""}`;
      });
      lines.push(`    media: ${parts.join("; ")}${pics.length > 5 ? `; +${pics.length - 5} more` : ""}`);
    }
    const boxes = s.elements.filter((e) => e.kind === "shape" && e.fill && e.fill.type && e.fill.type !== "none");
    if (boxes.length) {
      const fills = [...new Set(boxes.map((b) => b.fill.hex).filter(Boolean))].slice(0, 4);
      const texts3 = texts.slice(0, 3).map((t) => "«" + t.replace(/\s+/g, " ").slice(0, 28) + "»").join(", ");
      lines.push(`    boxes: ${boxes.length} filled shape(s)${fills.length ? " (" + fills.join(", ") + ")" : ""}; texts: ${texts3}`);
    }
  }
  return lines;
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const file = argv.find((a, i) => !a.startsWith("--") && (i === 0 || !argv[i - 1].startsWith("--")));
  if (!file || !/\.pptx$/i.test(file)) usage();
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) {
    console.error("shots: file not found: " + abs);
    process.exit(2);
  }

  // Text digest first — it works even without the app.
  let deck = null;
  try {
    deck = await readDeck(abs);
  } catch {
    /* digest is optional */
  }

  const binary = process.env.GIGATOOL_NODE || process.env.MULTITOOL_NODE;
  if (!binary) {
    console.error("shots: $GIGATOOL_NODE is not set — the app renderer is unavailable.");
    console.error("fallback: read-pptx.cjs " + JSON.stringify(abs) + " --extract-media /tmp/tpl-media");
    console.error("then look at the extracted pictures (backgrounds/logos/decor) before reusing them.");
    if (deck) console.log(digest(deck).join("\n"));
    process.exit(2);
  }

  const keep = argv.includes("--keep") || !!flag("--out-dir");
  const outDir = path.resolve(flag("--out-dir") || fs.mkdtempSync(path.join(os.tmpdir(), "pptx-shots-")));

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  if (env.GIGATOOL_APP_PATH && env.GIGATOOL_RENDERER_URL) env.ELECTRON_RENDERER_URL = env.GIGATOOL_RENDERER_URL;
  const args = [];
  if (env.GIGATOOL_APP_PATH) args.push(env.GIGATOOL_APP_PATH);
  args.push("--pptx-verify", abs, "--out-dir", outDir);

  const child = spawn(binary, args, { env, stdio: ["ignore", "inherit", "inherit"] });
  const timeoutMs = Number(process.env.PRESENTATION_RENDER_TIMEOUT_MS || 300000);
  const timer = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {}
  }, timeoutMs);
  child.on("error", (e) => {
    clearTimeout(timer);
    console.error("shots: failed to launch the renderer: " + (e.message || e));
    process.exit(2);
  });
  child.on("exit", (code) => {
    clearTimeout(timer);
    const pngs = fs.existsSync(outDir) ? fs.readdirSync(outDir).filter((f) => /\.png$/i.test(f)).sort() : [];
    if (!pngs.length) {
      console.error(`shots: the renderer produced no PNGs (exit ${code}).`);
      console.error("fallback: read-pptx.cjs " + JSON.stringify(abs) + " --extract-media /tmp/tpl-media");
      process.exit(3);
    }
    for (const f of pngs) console.log("slide " + f.replace(/\D+/g, "").replace(/^0+(?=\d)/, "") + ": " + path.join(outDir, f));
    if (deck) console.log(digest(deck, pngs.length).join("\n"));
    console.log(`shots: ${pngs.length} slide(s)${keep ? "" : " (temp dir: " + outDir + ")"}`);
    if (!keep) {
      try {
        fs.rmSync(outDir, { recursive: true, force: true });
      } catch {}
    }
  });
}

main().catch((e) => {
  console.error(e.stack || String(e));
  process.exit(3);
});
