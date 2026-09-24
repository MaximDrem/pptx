// presentation v2 — local reference resolution shared by assets.cjs and
// lint-deck.cjs. A deck references vendored fonts as url("fonts/<file>.woff2")
// (resolved against this skill's fonts/ directory) and its own images by
// relative path (resolved against the deck's folder).
"use strict";

const fs = require("fs");
const path = require("path");

const SKILL_DIR = path.join(__dirname, "..");
const FONTS_DIR = path.join(SKILL_DIR, "fonts");

const isData = (ref) => /^data:/i.test(ref);
const isExternal = (ref) => /^(https?:)?\/\//i.test(ref) || /^file:/i.test(ref) || /^mailto:/i.test(ref);

const stripQuery = (ref) => ref.split("#")[0].split("?")[0];

// → { found: <abs path>|null, tried: [<abs path>, ...] }
function resolveRef(deckDir, ref) {
  const rel = stripQuery(String(ref).trim());
  const tried = [];
  const push = (base) => {
    const abs = path.resolve(base, rel);
    if (!tried.includes(abs)) tried.push(abs);
  };
  if (rel.startsWith("fonts/")) {
    push(deckDir); // a local fonts/ folder next to the deck wins
    push(path.dirname(FONTS_DIR)); // fallback: the skill's vendored <skill>/fonts/<file>
  } else {
    push(deckDir);
    push(SKILL_DIR);
  }
  for (const abs of tried) {
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return { found: abs, tried };
    } catch (e) {
      /* keep trying */
    }
  }
  return { found: null, tried };
}

const MIME = {
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

const mimeOf = (file) => MIME[path.extname(file).toLowerCase()] || "application/octet-stream";

// Local/remote references of a deck: url(...), <img src>, <script src>, <link href>.
function collectRefs(html) {
  const refs = [];
  const push = (ref, kind) => {
    if (!ref) return;
    const r = ref.trim();
    if (!r || isData(r)) return;
    refs.push({ ref: r, kind });
  };
  let m;
  const urlRe = /url\((["']?)([^)"']+)\1\)/g;
  while ((m = urlRe.exec(html))) push(m[2], "url");
  const imgRe = /<img\b[^>]*?\bsrc=(["'])([^"']+)\1/gi;
  while ((m = imgRe.exec(html))) push(m[2], "img");
  const scriptRe = /<script\b[^>]*?\bsrc=(["'])([^"']+)\1/gi;
  while ((m = scriptRe.exec(html))) push(m[2], "script");
  const linkRe = /<link\b[^>]*?\bhref=(["'])([^"']+)\1/gi;
  while ((m = linkRe.exec(html))) push(m[2], "link");
  return refs;
}

module.exports = { SKILL_DIR, FONTS_DIR, isData, isExternal, resolveRef, mimeOf, collectRefs };
