#!/usr/bin/env node
// Render / measure / export an HTML deck with the app's real Chromium:
//
//   ELECTRON_RUN_AS_NODE=1 "$GIGATOOL_NODE" "$HOME/.wsc/config/skills/presentation/helpers/render.cjs" \
//     deck.html [--out-dir <dir>] [--pptx] [--pdf] [--no-png]
//
// Produces inside --out-dir: slide-NN.png (unless --no-png), report.json,
// inventory.json, <deck>.pptx (--pptx), <deck>.pdf (--pdf). Prints one line
// per layout issue — read them, fix deck.html, re-run — and `render: clean`
// when there is nothing to fix. The model's eyes for fine edits are in
// inventory.json (per-slide elements) and report.json.
//
// Default out-dir: a throwaway temp dir, removed after the run when nothing
// persistent was requested. --pptx/--pdf/explicit --out-dir keep the dir.
// Deliverables (.pptx/.pdf) are copied next to deck.html unless --out-dir is
// given; report.json/inventory.json are parsed before cleanup and returned to
// the caller (validate.cjs) so the HTML findings are never lost.
"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SKILL_DIR = path.join(__dirname, "..");
const { fixLineSpacing } = require("./pptx-post.cjs");

// После успешного экспорта правим точные межстрочные интервалы на
// пропорциональные (см. pptx-post.cjs): иначе рендер может перекрывать текст.
async function postProcessPptx(outDir, deck) {
  const pptx = path.join(outDir, path.basename(deck).replace(/\.html?$/i, "") + ".pptx");
  if (!fs.existsSync(pptx)) return null;
  const buf = fs.readFileSync(pptx);
  const fixed = await fixLineSpacing(buf);
  if (fixed.fixed) fs.writeFileSync(pptx, fixed.buffer);
  return { pptx, fixed: fixed.fixed };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// Deliverables stay in the working folder (deck.html lives there): copy the
// .pptx/.pdf out of the temp render dir unless an explicit --out-dir was used.
// Our own render artifacts inside an out-dir. Everything else (user files) is
// left alone.
const ARTIFACT_RE = /^(slide-\d+\.png|report\.json|inventory\.json|captures\.json)$/i;
function cleanArtifacts(dir) {
  let removed = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!ARTIFACT_RE.test(f)) continue;
      try {
        fs.unlinkSync(path.join(dir, f));
        removed++;
      } catch {
        // read-only leftovers must not break the render
      }
    }
  } catch {
    // no dir yet — the renderer will create it
  }
  return removed;
}

// Only contract violations block the export. Probe issues carry a severity;
// the fallback set keeps older probes safe. Shared with review.cjs.
const BLOCKING_TYPES = new Set([
  "text-clip",
  "out-of-bounds",
  "text-overlap",
  "low-contrast",
  "blank",
  "maybe-blank",
  "mostly-empty",
  "broken-image",
  "stage-broken",
  "probe-error",
  "hidden-slide",
  "missing-br",
]);

function deliverArtifacts(outDir, deck, opts) {
  if (opts.outDir) return [];
  const base = path.basename(deck).replace(/\.html?$/i, "");
  const out = [];
  for (const [ext, wanted] of [[".pptx", !!opts.pptx], [".pdf", !!opts.pdf]]) {
    if (!wanted) continue;
    const src = path.join(outDir, base + ext);
    const dest = path.join(path.dirname(deck), base + ext);
    if (!fs.existsSync(src) || path.resolve(src) === path.resolve(dest)) continue;
    fs.copyFileSync(src, dest);
    out.push(dest);
    console.log("artifact: " + dest);
  }
  return out;
}

// The one-shot is the APP, not the Node runtime: ELECTRON_RUN_AS_NODE must not
// leak into the child or Electron never initializes Chromium and renders nothing.
function rendererEnv() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  if (env.GIGATOOL_APP_PATH && env.GIGATOOL_RENDERER_URL) {
    env.ELECTRON_RENDERER_URL = env.GIGATOOL_RENDERER_URL;
  }
  return env;
}

// → { ran, code, reason?, outDir, kept, post, report, inventory, artifacts }
function renderDeck(deckPath, opts = {}) {
  const deck = path.resolve(deckPath);
  if (!fs.existsSync(deck)) {
    return Promise.resolve({ ran: false, code: 2, reason: "deck not found: " + deck });
  }
  // Build copy: the AUTHORED deck.html is never mutated (data URIs would make
  // it uneditable). expand-styles + asset inlining run on a temp copy only.
  let buildDir = null;
  let buildDeck = null;
  try {
    buildDir = fs.mkdtempSync(path.join(os.tmpdir(), "deck-build-"));
    buildDeck = path.join(buildDir, path.basename(deck));
    fs.copyFileSync(deck, buildDeck);
    // Relative refs (images/…, assets/…) must resolve in the build copy too —
    // without this the renderer saw BROKEN-IMAGE for every local picture.
    try {
      const { collectRefs, isData, isExternal, resolveRef } = require("./refs.cjs");
      const deckDir = path.dirname(deck);
      for (const { ref } of collectRefs(fs.readFileSync(deck, "utf8"))) {
        if (isData(ref) || isExternal(ref)) continue;
        const { found } = resolveRef(deckDir, ref);
        if (!found) continue; // lint reports missing files
        const rel = path.relative(deckDir, found);
        if (rel.startsWith("..")) continue; // outside the working folder
        const dest = path.join(buildDir, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(found, dest);
      }
    } catch (e) {
      // Best-effort, but never silent: a failed copy preflight would surface
      // later as a confusing BROKEN-IMAGE in the render.
      console.error("render: asset copy preflight failed: " + (e && e.message ? e.message : e));
    }
    require("./expand-styles.cjs").expandDeck(buildDeck);
    require("./assets.cjs").inlineAssets(buildDeck, { inline: true, quiet: true });
  } catch (e) {
    if (buildDir) {
      try {
        fs.rmSync(buildDir, { recursive: true, force: true });
      } catch {}
    }
    return Promise.resolve({ ran: false, code: 2, reason: `build copy failed: ${e && e.message}` });
  }
  const binary = process.env.GIGATOOL_NODE || process.env.MULTITOOL_NODE;
  if (!binary) {
    try {
      fs.rmSync(buildDir, { recursive: true, force: true });
    } catch {}
    return Promise.resolve({ ran: false, code: null, reason: "GIGATOOL_NODE is not set — run inside the workspace app" });
  }
  const keep = !!opts.outDir || !!opts.pptx || !!opts.pdf;
  const outDir = path.resolve(opts.outDir || fs.mkdtempSync(path.join(os.tmpdir(), "deck-render-")));
  const timeoutMs = Number(process.env.PRESENTATION_RENDER_TIMEOUT_MS || 300000);
  const env = rendererEnv();
  // Tell the app watchdog to fire just before the helper's own kill timer, so
  // a slow render produces the app's clean "timed out" message (and the
  // helper's deterministic-failure branch) instead of a bare SIGKILL.
  env.PRESENTATION_RENDER_TIMEOUT_MS = String(Math.max(30_000, timeoutMs));

  const args = [];
  if (env.GIGATOOL_APP_PATH) args.push(env.GIGATOOL_APP_PATH);
  args.push(
    "--deck-render",
    buildDeck,
    "--out-dir",
    outDir,
    "--probe",
    path.join(SKILL_DIR, "helpers", "probe.js"),
    "--vendor-dir",
    path.join(SKILL_DIR, "vendor"),
    "--fonts-dir",
    path.join(SKILL_DIR, "fonts"),
  );
  if (opts.pptx) args.push("--pptx");
  if (opts.pdf) args.push("--pdf");
  if (opts.noPng) args.push("--no-png");
  // --force: the app exports despite blocking findings (loud warning).
  if (opts.force) args.push("--allow-blocking");

  return new Promise((resolve) => {
    const cleanup = () => {
      try {
        fs.rmSync(buildDir, { recursive: true, force: true });
      } catch {}
      if (keep) return;
      try {
        fs.rmSync(outDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    };
    const finish = (result) => {
      cleanup();
      resolve(result);
    };

    // One renderer crash (Electron "Object has been destroyed" — observed in a
    // real run) is retried once: it is transient, and the model otherwise gets
    // an opaque failure and starts guessing (disk space, app restart…).
    const runOnce = (attemptNo) => {
      let child;
      let timedOut = false;
      let timer = null;
      let stderrTail = "";
      // A REUSED out-dir is the normal case (`--out-dir /tmp/deck-check`): stale
      // slide PNGs / report from the previous deck made review.cjs print 30
      // image paths for a 1-slide render, and the model went looking at the
      // wrong pictures. Drop our own artifacts before every attempt — but never
      // in the authored deck's own folder (authored files are not ours to
      // delete), and also drop a stale .pptx/.pdf for this deck so a blocked
      // run cannot leave a previous build looking current.
      if (path.resolve(outDir) !== path.dirname(deck)) cleanArtifacts(outDir);
      const deckBase = path.basename(deck).replace(/\.html?$/i, "");
      for (const ext of [".pptx", ".pdf"]) {
        try {
          fs.unlinkSync(path.join(outDir, deckBase + ext));
        } catch {
          // nothing to remove
        }
      }
      try {
        child = spawn(binary, args, { env, stdio: ["ignore", "pipe", "pipe"] });
      } catch (e) {
        finish({ ran: false, code: null, reason: `failed to launch renderer: ${e && e.message}`, outDir });
        return;
      }
      child.stdout.on("data", (d) => process.stdout.write(d));
      child.stderr.on("data", (d) => {
        const txt = d.toString();
        stderrTail = (stderrTail + txt).slice(-4000);
        process.stderr.write(d);
      });
      timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGKILL");
        } catch {
          // already gone
        }
      }, timeoutMs);
      child.on("error", (e) => {
        if (timer) clearTimeout(timer);
        finish({ ran: false, code: null, reason: `failed to launch renderer: ${e && e.message}`, outDir });
      });
      child.on("exit", async (code, signal) => {
        if (timer) clearTimeout(timer);
        if (timedOut) {
          finish({ ran: true, code: 3, reason: `render timed out after ${Math.round(timeoutMs / 1000)}s`, outDir, kept: keep });
          return;
        }
        if (signal) {
          finish({ ran: false, code: null, reason: `renderer killed by ${signal}`, outDir });
          return;
        }
        const finalCode = code ?? 3;
        const destroyed = /has been destroyed|Render process gone|Target closed/i.test(stderrTail);
        const deterministic = !destroyed && /timed out|rendered 0 slides/i.test(stderrTail);
        // exit 3 is a crash even when a report was written earlier: the export
        // can die after report.json exists (dom-to-pptx on heavy effects).
        const crashed = finalCode === 3;
        if (crashed && attemptNo === 1 && !deterministic) {
          console.error(
            destroyed
              ? "render: the app window was destroyed (Electron crash) — this is transient, retrying once"
              : "render: the renderer crashed (exit 3) — retrying once",
          );
          runOnce(2);
          return;
        }
      let post = null;
      let artifacts = [];
      // Parse the reports before the temp dir is removed: the HTML-level probe
      // findings must survive even when nothing persistent was requested, and
      // they are still useful when the export was blocked (exit 4).
      const report = readJson(path.join(outDir, "report.json"));
      const invRaw = readJson(path.join(outDir, "inventory.json"));
      // The app writes {file, slides:[…]}; review/inspect/describe expect the
      // bare array, so unwrap once here (was a real bug: the structural read
      // silently never printed).
      const inventory = invRaw && Array.isArray(invRaw.slides) ? invRaw.slides : invRaw;
      if (crashed) {
        // No retry left (or a deterministic failure): say WHAT crashed and
        // echo the captured stderr. In the real case the model got only
        // "Object has been destroyed" and started guessing about disk space.
        const tail = stderrTail.trim().split("\n").filter(Boolean).slice(-3).join(" | ");
        if (destroyed) {
          console.error(
            "render: the app window was destroyed twice — the app session is broken, not the deck. " +
              "Tell the user to restart the app before retrying; do not guess about disk space.",
          );
        } else if (deterministic) {
          console.error(
            "render: the app reported a deterministic render failure (timeout / 0 slides) — not retried. " +
              "Fix the deck: simplify the slide HTML and remove custom <script> code.",
          );
        } else if (report) {
          console.error(
            "render: the renderer/export crashed after the report was written (exit 3) — if the slides rendered, " +
              "the crash is in the .pptx export (heavy effects, custom <script>); simplify and re-run",
          );
        } else {
          console.error(
            "render: the renderer crashed twice before writing a report — the page likely throws at runtime; " +
              "remove custom <script> code (keep the example navigator) or rewrite the deck, then retry",
          );
        }
        if (tail) console.error("render: last renderer stderr: " + tail.slice(0, 500));
      } else if (finalCode === 2) {
        console.error(
          "render: the renderer could not start or rejected its arguments (exit 2) — check $GIGATOOL_NODE, vendor/ and probe.js; this is NOT a deck bug",
        );
      } else if (finalCode !== 0 && !report) {
        console.error(
          "render: the deck produced no report — the HTML is likely malformed (an unclosed </section>) or throws at runtime; " +
            "lint-deck reports unbalanced <section> tags — fix them or rewrite the whole file",
        );
      }
      if (finalCode === 0 && !report) {
        console.error("render: the renderer exited 0 but wrote no report.json — treating it as a failed render (exit 3)");
      }
      // Only contract violations block the export. Probe issues carry a
      // severity; the fallback set keeps older probes safe.
      const isBlocking = (i) => (i.severity ? i.severity === "error" : BLOCKING_TYPES.has(i.type));
      let effectiveCode = finalCode === 0 && !report ? 3 : finalCode;
      // --force: the app already exported with a loud warning; keep the exit
      // code deliverable but repeat what is still wrong, verbatim.
      if (opts.force && report) {
        const blockingN = (report.slides || []).reduce((n, s) => n + (s.issues || []).filter(isBlocking).length, 0);
        if (blockingN > 0) {
          console.error(
            `render: WARNING — ${blockingN} blocking error(s) remain; the .pptx was delivered anyway (--force). Say exactly what is still wrong in the summary.`,
          );
        }
      }
      // Blocking findings must be exit 4 even without --pptx/--pdf: index.cjs
      // documents 0 = clean, and an agent gating on $? was told "clean" while
      // the render was full of blocking errors.
      if (!opts.force && (effectiveCode === 0 || effectiveCode === 3) && report) {
        const blocking = (report.slides || []).reduce((n, s) => n + (s.issues || []).filter(isBlocking).length, 0);
        if (blocking > 0) {
          console.error(
            `render: ${blocking} blocking error(s)${opts.pptx || opts.pdf ? " — export skipped (the .pptx is not delivered)" : ""} — fix deck.html and re-run`,
          );
          effectiveCode = 4;
        }
      }
      // The app exits 4 before printing the per-issue lines (it gates the
      // export first), so print them here from the parsed report.
      if (effectiveCode === 4 && report) {
        const lines = (report.slides || []).flatMap((s) =>
          (s.issues || []).filter(isBlocking).map((i) => `slide ${s.index + 1}: ${i.type}: ${i.detail}`),
        );
        for (const line of lines.slice(0, 10)) console.error("  " + line);
        if (lines.length > 10) console.error(`  … +${lines.length - 10} more (see report.json)`);
      }
      if (effectiveCode === 0 && opts.pptx) {
        try {
          post = await postProcessPptx(outDir, deck);
          if (post && post.fixed) console.log(`pptx-post: ${post.fixed} межстрочных интервалов исправлено (exact → proportional)`);
        } catch (e) {
          console.error("pptx-post: не удалось обработать .pptx: " + (e.message || e));
        }
      }
      if (effectiveCode === 0) {
        try {
          artifacts = deliverArtifacts(outDir, deck, opts);
        } catch (e) {
          console.error("artifact copy failed: " + (e.message || e));
        }
      }
      finish({ ran: true, code: effectiveCode, outDir, kept: keep, post, report, inventory, artifacts, reason: effectiveCode === 4 ? "blocking layout issues" : undefined });
      });
    };
    runOnce(1);
  });
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const positional = argv.filter((a) => !a.startsWith("--") && a !== flag("--out-dir"));
  const deck = positional[0];
  if (!deck) fail("usage: render.cjs <deck.html> [--out-dir <dir>] [--pptx] [--pdf] [--no-png] [--force]");

  const r = await renderDeck(deck, {
    outDir: flag("--out-dir"),
    pptx: argv.includes("--pptx"),
    pdf: argv.includes("--pdf"),
    noPng: argv.includes("--no-png"),
    force: argv.includes("--force"),
  });
  if (!r.ran) {
    console.error("render: " + r.reason);
    process.exit(2);
  }
  if (r.kept) console.log("render dir: " + r.outDir);
  process.exit(r.code ?? 3);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.stack || String(e));
    process.exit(3);
  });
}

module.exports = { renderDeck, cleanArtifacts, BLOCKING_TYPES };
