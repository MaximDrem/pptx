// presentation v2 — static preflight for deck.html. No Chromium, no network.
//
//   ELECTRON_RUN_AS_NODE=1 "$GIGATOOL_NODE" .../lint-deck.cjs deck.html
//
// Errors block (offline contract, tool calls that only exist in the chat
// turn, missing local files, invalid slide markup). Warnings inform (fonts or
// missing local files, missing data-role, classes used but not defined in
// the deck's own <style> — the classic source of silently broken layouts).
// Exit 0 clean / 1 errors / 2 usage.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { isData, isExternal, resolveRef, collectRefs } = require("./refs.cjs");

const SESSION_TOOL_RE = /(?<![.\w])(gigachat_image|text2image|generate_image|image_generation|web_search|websearch)\s*\(/g;
const SKILL_DIR = path.join(__dirname, "..");

// Classes defined by the canonical CSS (stage + base + all built-in tokens +
// fonts). An authored deck with only the empty managed block has no other
// source of classes, so unknown names are typos/missing pastes — the check
// used to be skipped exactly in that (normal) case.
let canonicalClasses = null;
function loadCanonicalClasses() {
  if (canonicalClasses) return canonicalClasses;
  const set = new Set();
  const files = [path.join(SKILL_DIR, "stage.css"), path.join(SKILL_DIR, "fonts", "fonts.css"), path.join(SKILL_DIR, "styles", "_base.css")];
  try {
    for (const d of fs.readdirSync(path.join(SKILL_DIR, "styles"), { withFileTypes: true })) {
      if (d.isDirectory()) files.push(path.join(SKILL_DIR, "styles", d.name, "tokens.css"));
    }
  } catch {
    // styles/ missing — nothing canonical to compare
  }
  for (const f of files) {
    try {
      const css = fs.readFileSync(f, "utf8");
      let m;
      const re = /\.(-?[A-Za-z_][\w-]*)/g;
      while ((m = re.exec(css))) set.add(m[1]);
    } catch {
      // skip unreadable file
    }
  }
  canonicalClasses = set;
  return set;
}

const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

// Inner HTML of every element carrying `class="… boxClass …"`, depth-aware for
// nested same-tag elements (a plain lazy regex stopped at the first </div> and
// missed raw <h3>/<p> hidden behind a .card-stack/.n wrapper).
function boxInners(html, boxClass) {
  const out = [];
  const openRe = new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*\\bclass=(["'])[^"']*\\b${boxClass}\\b[^"']*\\2[^>]*>`, "gi");
  let m;
  while ((m = openRe.exec(html))) {
    const tag = m[1];
    const start = m.index + m[0].length;
    const tagRe = new RegExp(`</?${tag}\\b[^>]*>`, "gi");
    tagRe.lastIndex = start;
    let depth = 1;
    let t;
    while ((t = tagRe.exec(html))) {
      if (t[0][1] === "/") depth--;
      else depth++;
      if (depth === 0) break;
    }
    out.push(html.slice(start, t ? t.index : html.length));
  }
  return out;
}

// ---- --fix: mechanical one-box repair -------------------------------------
// What it does inside .card/.kpi/.pill/.stat/.cell (direct children only):
//   <h1..h6>…</hN> → <span class="t-title">…</span>
//   <p>…</p>       → <span class="t-body">…</span>
//   <ul><li>a<li>b → <span class="t-body">a<br>b</span>   (ol numbers kept)
//   adjacent row runs without a <br> between them get one (missing-br)
// Deeper structure and everything outside the boxes is left untouched.

const VOID_TAGS = new Set(["img", "hr", "input", "source", "wbr", "area", "base", "col", "embed", "track"]);
const ROW_LIKE = new Set(["span", "b", "strong", "em", "i", "small"]);

function parseAttrs(open) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(open))) attrs[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3];
  return attrs;
}

// Top-level nodes of a box's inner HTML (tags with depth-aware closes).
function topNodes(inner) {
  const nodes = [];
  let i = 0;
  const openRe = /^<([a-z][a-z0-9]*)\b[^>]*>/i;
  while (i < inner.length) {
    if (inner[i] === "<") {
      const m = openRe.exec(inner.slice(i));
      if (!m) {
        nodes.push({ type: "text", text: "<" });
        i++;
        continue;
      }
      const tag = m[1].toLowerCase();
      if (VOID_TAGS.has(tag) || m[0].endsWith("/>")) {
        nodes.push({ type: "el", tag, open: m[0], whole: m[0], content: "" });
        i += m[0].length;
        continue;
      }
      const closeRe = new RegExp(`</?${tag}\\b[^>]*>`, "gi");
      closeRe.lastIndex = i + m[0].length;
      let depth = 1;
      let t;
      while ((t = closeRe.exec(inner))) {
        if (t[0][1] === "/") depth--;
        else depth++;
        if (depth === 0) break;
      }
      const end = t ? t.index + t[0].length : inner.length;
      nodes.push({ type: "el", tag, open: m[0], whole: inner.slice(i, end), content: inner.slice(i + m[0].length, t ? t.index : inner.length) });
      i = end;
    } else {
      const next = inner.indexOf("<", i);
      const stop = next === -1 ? inner.length : next;
      nodes.push({ type: "text", text: inner.slice(i, stop) });
      i = stop;
    }
  }
  return nodes;
}

function fixBoxInner(inner) {
  const what = [];
  const nodes = topNodes(inner);
  let out = "";
  let prevRow = false; // previous emitted node was a row run (needs <br> before the next one)
  let pendingBreak = false; // whitespace gap since the last row run
  for (const n of nodes) {
    if (n.type === "text") {
      if (n.text.trim() === "") {
        if (prevRow) pendingBreak = true;
        out += n.text.includes("\n") ? "\n" : n.text;
        continue;
      }
      out += n.text;
      prevRow = false;
      pendingBreak = false;
      continue;
    }
    if (n.tag === "br") {
      out += n.whole;
      prevRow = false;
      pendingBreak = false;
      continue;
    }
    if (/^(h[1-6]|p)$/i.test(n.tag) || n.tag === "ul" || n.tag === "ol") {
      if (prevRow) out += "<br>";
      const a = parseAttrs(n.open);
      const extra = a.class ? " " + a.class : "";
      const keep = ["style", "id", "lang", "data-role"].filter((k) => a[k]).map((k) => `${k}="${a[k]}"`).join(" ");
      if (n.tag === "ul" || n.tag === "ol") {
        const items = [];
        const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
        let li;
        let k = 0;
        while ((li = liRe.exec(n.content))) {
          k++;
          items.push((n.tag === "ol" ? `${k}. ` : "") + li[1].trim());
        }
        out += `<span class="t-body${extra}"${keep ? " " + keep : ""}>${items.join("<br>")}</span>`;
        what.push(`<${n.tag}> → .t-body runs`);
      } else {
        const cls = /^h[1-6]$/i.test(n.tag) ? "t-title" : "t-body";
        out += `<span class="${cls}${extra}"${keep ? " " + keep : ""}>${n.content.trim()}</span>`;
        what.push(`<${n.tag.toLowerCase()}> → .${cls}`);
      }
      prevRow = true;
      pendingBreak = false;
      continue;
    }
    // any other element: keep verbatim; inline row runs still need separation
    if (ROW_LIKE.has(n.tag)) {
      if (prevRow && pendingBreak) out += "<br>";
      out += n.whole;
      prevRow = true;
      pendingBreak = false;
    } else {
      out += n.whole;
      prevRow = false;
      pendingBreak = false;
    }
  }
  return { html: out, what };
}

function fixDeck(raw) {
  const fixes = [];
  for (const boxClass of ["card", "kpi", "pill", "stat", "cell"]) {
    const ranges = [];
    const openRe = new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*\\bclass=(["'])[^"']*\\b${boxClass}\\b[^"']*\\2[^>]*>`, "gi");
    let m;
    while ((m = openRe.exec(raw))) {
      const tag = m[1];
      const start = m.index + m[0].length;
      const tagRe = new RegExp(`</?${tag}\\b[^>]*>`, "gi");
      tagRe.lastIndex = start;
      let depth = 1;
      let t;
      while ((t = tagRe.exec(raw))) {
        if (t[0][1] === "/") depth--;
        else depth++;
        if (depth === 0) break;
      }
      const end = t ? t.index : raw.length;
      const slide = (raw.slice(0, m.index).match(/<section\b/gi) || []).length;
      ranges.push({ start, end, inner: raw.slice(start, end), slide });
    }
    for (let i = ranges.length - 1; i >= 0; i--) {
      const r = ranges[i];
      const fixed = fixBoxInner(r.inner);
      if (fixed.html !== r.inner) {
        raw = raw.slice(0, r.start) + fixed.html + raw.slice(r.end);
        fixes.push({ slide: r.slide, boxClass, what: fixed.what });
      }
    }
  }
  return { html: raw, fixes };
}

function lintDeck(deckPath, opts = {}) {
  const errors = [];
  const warnings = [];
  const file = path.resolve(deckPath);
  if (!fs.existsSync(file)) {
    const missing = ["deck.html not found: " + file];
    if (!opts.quiet) for (const e of missing) console.error("error: " + e);
    return { errors: missing, warnings, slideCount: 0 };
  }

  const raw = fs.readFileSync(file, "utf8");
  const html = stripComments(raw);
  const deckDir = path.dirname(file);

  // 0. Location contract: the deck lives in the user's working folder, never in
  //    temp (drafts/extracted media may go to temp, the result must not).
  const abs = path.resolve(file);
  const tmp = os.tmpdir();
  if (abs.startsWith(tmp + path.sep)) {
    errors.push(
      `the deck is inside a temp directory (${tmp}): the user will not see the result. ` +
        `Build deck.html in the current working folder (${process.cwd()})`,
    );
  } else if (!abs.startsWith(path.resolve(process.cwd()) + path.sep)) {
    warnings.push(
      `the deck is outside the current working folder (${process.cwd()}) — the user expects the files there (deck: ${abs})`,
    );
  }

  // 0b. Template fidelity: if the deck copies a saved style profile that has
  //     assets, the deck must actually use at least one of them (real runs
  //     copied only the tokens and lost every element of the original).
  const profileMatch = /data-presentation-style=(["'])profile:([^"']+)\1/.exec(raw);
  if (profileMatch) {
    const stylesDir = process.env.PRESENTATION_STYLES_DIR || path.join(os.homedir(), ".wsc", "config", "styles");
    const assetsDir = path.join(stylesDir, profileMatch[2].trim(), "assets");
    let hasAssets = false;
    try {
      hasAssets = fs.readdirSync(assetsDir).some((f) => /\.(png|jpe?g|svg|webp)$/i.test(f));
    } catch {
      hasAssets = false;
    }
    const imgCount = (raw.match(/<img\b/gi) || []).length;
    if (hasAssets && imgCount === 0) {
      errors.push(
        `template profile «${profileMatch[2].trim()}» has assets but the deck uses none — reuse the template's background/logo/decor: ` +
          `run style-profile.cjs <template.pptx> --name "…" --deploy <this deck's folder> and paste the snippets from images/template-assets.md`,
      );
    }
    // A copy that keeps only the background loses the recognisable decor; a
    // copy that keeps only the boxes leaves the background flat — both were
    // real failures. The profile knows which roles it has.
    let extracted = [];
    let imageBgTemplate = 0;
    let templateSlides = 0;
    try {
      const profile = JSON.parse(fs.readFileSync(path.join(stylesDir, profileMatch[2].trim(), "profile.json"), "utf8"));
      extracted = (profile.media && profile.media.extracted) || [];
      imageBgTemplate = (profile.density && profile.density.imageBackgrounds) || 0;
      templateSlides = (profile.source && profile.source.slides) || 0;
    } catch {
      extracted = [];
    }
    const hasDecor = extracted.some((a) => a.role === "decor");
    const hasBg = extracted.some((a) => a.role === "background");
    const usesDecor = /class=(["'])[^"']*\b(?:decor|decor-img)\b/.test(raw);
    if (hasDecor && !usesDecor) {
      errors.push(
        `template profile «${profileMatch[2].trim()}» has decor assets but the deck uses none — the copy loses the original's recognisable elements. ` +
          `Place at least one deployed decor anywhere sensible, e.g. ` +
          `<img class="decor-img" style="left:1080px; top:-80px; width:260px" src="images/template-decor-1.png" alt=""> ` +
          `(exact names in images/template-assets.md; position, size and the choice of decor are yours)`,
      );
    }
    const usesBg = /class=(["'])[^"']*\bbg-img\b/.test(raw) || /background-image\s*:/.test(raw);
    if (hasBg && !usesBg) {
      errors.push(
        `template profile «${profileMatch[2].trim()}» uses an image background but the deck has none — a flat fill is not a style copy. ` +
          `Add <img class="bg-img" src="images/template-bg-1.png" alt=""> as the first child of the slides that have it in the template ` +
          `(or set background-image yourself); use a token background only if the template is flat`,
      );
    }
    if (hasBg && imageBgTemplate >= Math.max(2, templateSlides * 0.4)) {
      const slideBodies = raw.match(/<section\b[\s\S]*?<\/section>/gi) || [];
      const withBg = slideBodies.filter((b) => /class=(["'])[^"']*\bbg-img\b/.test(b) || /background-image\s*:/.test(b)).length;
      const need = Math.ceil(slideBodies.length * 0.5);
      if (slideBodies.length > 0 && withBg < need) {
        errors.push(
          `template profile «${profileMatch[2].trim()}» uses image backgrounds on its slides, but the deck has a background on only ${withBg} of ${slideBodies.length} — flat slides read as a different deck. ` +
            `Put a background on at least ${need} slides: <img class="bg-img" src="images/template-bg-N…" alt=""> as the first child of the slide ` +
            `(images/template-assets.md says which background belongs to which slide type; use one or two ` +
            `different backgrounds instead of a flat fill)`,
        );
      }
    }
  }

  // 1. Offline contract.
  const external = new Set();
  let m;
  const httpRe = /(https?:\/\/[^\s"'<>)]+)/g;
  while ((m = httpRe.exec(html))) {
    if (/^https?:\/\/www\.w3\.org\//.test(m[1])) continue; // xmlns
    external.add(m[1]);
  }
  for (const url of external) {
    const at = raw.indexOf(url);
    const onSlide = at === -1 ? null : (raw.slice(0, at).match(/<section\b/gi) || []).length;
    errors.push(
      `external URL${onSlide ? ` on slide ${onSlide}` : ""}: ${url} — the deck is offline: replace it with plain text ` +
        `(contacts are text, not links; an email address as plain text is fine)`,
    );
  }

  // 2. Session tools are chat-turn only.
  const toolRe = new RegExp(SESSION_TOOL_RE.source, "g");
  while ((m = toolRe.exec(html))) {
    errors.push(
      "session tool `" + m[1] + "(` can only be called from the chat turn — generate the asset in chat first, then put its file path into deck.html",
    );
  }

  // 3. Local references exist; fonts/images must be inlined before render.
  //    Protocol-relative (//host) and file: refs are not caught by httpRe —
  //    report them here so the offline contract has no holes.
  for (const { ref, kind } of collectRefs(html)) {
    if (isExternal(ref)) {
      if (!/^https?:\/\//i.test(ref) && !external.has(ref)) {
        errors.push("external reference (the deck must work offline): " + ref);
      }
      continue;
    }
    const { found, tried } = resolveRef(deckDir, ref);
    if (!found) {
      errors.push(
        "missing local file: " + ref + " (looked at: " + tried.join(", ") + ") — " +
          "if this is template art, use the EXACT file names from images/template-assets.md " +
          "(they are already deployed by style-profile.cjs --deploy; never unpack the .pptx by hand)",
      );
      continue;
    }
    // Local refs staying relative is the normal authored state — the builder
    // inlines them into the temp build copy (run assets.cjs --inline only for
    // a standalone single-file HTML).
  }

  // 4. Structure.
  const slideTags = raw.match(/<section\b[^>]*\bclass=(["'])[^"']*\bslide\b[^"']*\1[^>]*>/gi) || [];
  if (slideTags.length === 0) errors.push('no <section class="slide"> found — the deck must contain at least one slide');
  // Malformed HTML (a slide missing its </section>) renders 0 slides and
  // exit 3 — catch it here with a precise message instead of a render crash.
  const openSections = (raw.match(/<section\b/gi) || []).length;
  const closeSections = (raw.match(/<\/section>/gi) || []).length;
  if (openSections !== closeSections) {
    errors.push(
      `unbalanced <section> tags: ${openSections} open vs ${closeSections} closed — the deck HTML is malformed and will render 0 slides; fix the missing/extra </section> (or rewrite the file)`,
    );
  }
  for (const tag of slideTags) {
    if (!/\bdata-role=/.test(tag)) warnings.push("slide without data-role (cover|section|content|quote|closing) — layout checks get weaker: " + tag.slice(0, 80));
  }
  // Pattern discipline: raw <h2>/<p>/<ul> is not a slide. Without the pattern
  // blocks the deck collapses into sparse text pages (no accents, empty
  // regions, mostly-empty errors) — this was a real failed run.
  const PATTERN_BLOCK = /class=(["'])[^"']*\b(card|kpi-row|grid2|grid3|grid4|split|flow|timeline|table|steps|donut|matrix|funnel|list|quote|content)\b/;
  const sectionRe = /<section\b([^>]*)>([\s\S]*?)<\/section>/gi;
  let sec;
  let secIndex = 0;
  while ((sec = sectionRe.exec(raw))) {
    secIndex++;
    const role = (/(?:^|\s)data-role=(["'])([^"']+)\1/.exec(sec[1]) || [])[2] || "content";
    if (role !== "content") continue;
    const body = sec[2];
    if (!/class=(["'])[^"']*\bheadline\b/.test(body)) {
      errors.push(`slide ${secIndex}: no .headline — content slides use the heading pattern (.kicker + .headline), not a raw <h2>`);
    }
    if (!/<div[^>]*class=(["'])[^"']*\bcontent\b/.test(body)) {
      errors.push(`slide ${secIndex}: no <div class="content"> — blocks live inside the content wrapper`);
    }
    if (!PATTERN_BLOCK.test(body)) {
      errors.push(
        `slide ${secIndex}: no block from patterns.md (card/kpi-row/grid/split/flow/timeline/table/steps/donut/matrix/list) — raw <p>/<ul> is not a pattern; take the markup from patterns.md`,
      );
    }
    // One-box rule: text inside a painted box is runs (.t-title/.t-body/.t-cap
    // + <br>), never raw <h3>/<p>/<ul>. Block tags split the box into extra
    // text shapes and lose the box style on export (real case: the model fell
    // back to raw HTML inside .card and the copy stopped looking like the
    // template). The scan is depth-aware: a `.card-stack`/`.n` wrapper inside
    // the box must not hide the raw tags behind the first `</div>`.
    for (const boxClass of ["card", "kpi", "pill", "stat", "cell"]) {
      for (const inner of boxInners(body, boxClass)) {
        const rawTag = /<(h[1-6]|p|ul|ol)\b/i.exec(inner);
        if (!rawTag) continue;
        errors.push(
          `slide ${secIndex}: raw <${rawTag[1].toLowerCase()}> inside .${boxClass} — box text must be runs (.t-title/.t-body/.t-cap, <b>, <br>), nothing else in the box (export merge + style; patterns.md → One-box rule). ` +
            `Run the mechanical fix: lint-deck.cjs ${path.basename(file)} --fix (converts the box blocks into runs and adds the row <br> automatically), or replace by hand: ` +
            `<${rawTag[1].toLowerCase()}>text</${rawTag[1].toLowerCase()}> → <span class="${/^h[1-6]$/.test(rawTag[1].toLowerCase()) ? "t-title" : "t-body"}">text</span>; rows are separated by <br>, not by block tags`,
        );
        break;
      }
    }
    if (!/class=(["'])[^"']*\bfooter\b/.test(body)) {
      warnings.push(
        `slide ${secIndex}: no .footer — the numbering/anchor is lost (add <div class="footer"><span>Раздел</span><span>${String(secIndex).padStart(2, "0")}</span></div> as the last child of .slide-pad)`,
      );
    }
  }
  if (!/deck-stage/.test(raw) || !/deck-viewport/.test(raw)) {
    warnings.push("stage markers (.deck-stage/.deck-viewport) not found — paste stage.css into the <style> block");
  }
  const styleBlocks = raw.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || [];
  if (styleBlocks.length === 0) warnings.push("no <style> block — stage.css, tokens and base.css must be pasted into the deck");

  // 5. Class pre-flight: a class used in markup but never defined silently
  // falls back to defaults — the number-one source of broken layouts.
  const defined = new Set();
  for (const block of styleBlocks) {
    const css = block
      .replace(/^<style[^>]*>/i, "")
      .replace(/<\/style>$/i, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    let cm;
    const re = /\.(-?[A-Za-z_][\w-]*)/g;
    while ((cm = re.exec(css))) defined.add(cm[1]);
  }
  const used = new Set();
  let um;
  const classRe = /\bclass=(["'])([^"']+)\1/g;
  while ((um = classRe.exec(html))) {
    for (const token of um[2].split(/\s+/)) if (token) used.add(token);
  }
  const ignored = new Set(["lucide", "cover", "closing", "section", "quote"]); // role words used as classes in the skeleton
  let unknown = Array.from(used).filter((c) => !defined.has(c) && !ignored.has(c));
  const managedEmpty = /<style\b[^>]*\bdata-presentation-style=(["'])[^"']*\1[^>]*>\s*<\/style>/i.test(raw);
  if (managedEmpty) {
    const canon = loadCanonicalClasses();
    unknown = unknown.filter((c) => !canon.has(c));
  }
  if (unknown.length && (styleBlocks.length || managedEmpty)) {
    warnings.push(
      "class(es) used but not defined in the deck's <style> or the canonical CSS (silent fallback — typo or missing paste): " +
        unknown.slice(0, 12).join(", ") +
        (unknown.length > 12 ? ` … +${unknown.length - 12}` : ""),
    );
  }

  if (!opts.quiet) {
    for (const e of errors) console.error("error: " + e);
    for (const w of warnings) console.warn("warning: " + w);
  }
  return { errors, warnings, slideCount: slideTags.length };
}

function main() {
  const argv = process.argv.slice(2);
  const fix = argv.includes("--fix");
  const args = argv.filter((a) => !a.startsWith("--"));
  if (!args.length) {
    console.error("usage: lint-deck.cjs <deck.html> [--fix]");
    process.exit(2);
  }
  if (fix) {
    const file = path.resolve(args[0]);
    const before = fs.readFileSync(file, "utf8");
    const { html, fixes } = fixDeck(before);
    if (fixes.length) {
      fs.writeFileSync(file, html);
      for (const f of fixes) {
        console.log(`fix: slide ${f.slide || 1} .${f.boxClass}: ${f.what.length ? f.what.join(", ") : "row <br> added"}`);
      }
      console.log(`fix: ${fixes.length} box(es) repaired — review the diff, then lint again`);
    } else {
      console.log("fix: nothing to repair (no raw block tags or missing row <br> in boxes)");
    }
  }
  const r = lintDeck(args[0]);
  if (r.errors.length) process.exit(1);
  console.log("lint: clean (" + (r.slideCount || 0) + " slide(s), " + r.warnings.length + " warning(s))");
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error("lint-deck: " + (e && e.message ? e.message : e));
    process.exit(1);
  }
}

module.exports = { lintDeck, fixDeck };
