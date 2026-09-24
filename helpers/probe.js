/* ===========================================================================
   presentation v2 — probe.js
   Injected into the render window (app one-shot `--deck-render`, injected via
   executeJavaScript) and, in the local test harness, loaded as a plain
   <script>. Defines window.__deckProbe and measures the deck AFTER real
   layout in Chromium:

     ready()        → deck meta (slides, stage, fonts, color/size histograms)
     count()        → number of .slide sections
     reveal(i)      → show slide i only (the renderer captures the viewport)
     report()       → per-slide layout issues
     inventory()    → per-slide element inventory (the model's eyes)
     exportPrep()   → un-stack slides for the .pptx export; return counts
     exportRestore()→ undo exportPrep
     printLayout()  → @media print CSS for one-slide-per-page PDF

   All numbers are CSS px on the fixed 1280×720 stage. No modules, no network,
   no file access. Errors are contained per slide: a broken deck must still
   produce a report, not an exception.
   =========================================================================== */
(() => {
  "use strict";

  const PROBE_VERSION = "2.1.0";
  const STAGE_W = 1280;
  const STAGE_H = 720;
  const CLIP_THRESHOLD = 6; // px — below this is renderer rounding noise
  const NEARLY_INVISIBLE = 3.0; // below WCAG AA large-text contrast — an issue

  const slides = () => Array.from(document.querySelectorAll(".slide"));

  const round1 = (n) => Math.round(n * 10) / 10;

  function ownText(el) {
    return Array.from(el.childNodes).some(
      (n) => n.nodeType === Node.TEXT_NODE && (n.textContent || "").trim().length > 0,
    );
  }

  // Visibility-independent text: innerText is "" inside hidden slides.
  function readText(el) {
    return (el.textContent || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t\r\f]+/g, " ")
      .replace(/ *\n+/g, "\n")
      .trim();
  }

  function excerpt(el, max) {
    const t = (el.innerText && el.innerText.trim()) || readText(el);
    const s = t.replace(/\s+/g, " ").trim();
    if (s) return s.length > max ? s.slice(0, max - 3) + "…" : s;
    const tag = el.tagName.toLowerCase();
    if (tag === "img" || el.querySelector("img")) return "[image]";
    if (tag === "svg" || el.querySelector("svg")) return "[svg]";
    if (tag === "canvas") return "[canvas]";
    return "[" + tag + "]";
  }

  function parseColor(css) {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(css || "");
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : parseFloat(m[4]) };
  }

  const hex2 = (v) => Math.round(v).toString(16).padStart(2, "0");
  const rgbHex = (c) => ("#" + hex2(c.r) + hex2(c.g) + hex2(c.b)).toUpperCase();

  function colorHex(css) {
    const c = parseColor(css);
    return c && c.a > 0.05 ? rgbHex(c) : null;
  }

  function luminanceOf(c) {
    const f = (v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }

  function luminance(css) {
    const c = parseColor(css);
    return c && c.a > 0 ? luminanceOf(c) : null;
  }

  const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

  // Composite a translucent color over a base (glass cards over backgrounds).
  function blendOver(fg, base) {
    const a = fg.a + base.a * (1 - fg.a);
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: (fg.r * fg.a + base.r * base.a * (1 - fg.a)) / a,
      g: (fg.g * fg.a + base.g * base.a * (1 - fg.a)) / a,
      b: (fg.b * fg.a + base.b * base.a * (1 - fg.a)) / a,
      a,
    };
  }

  // Gradient stop colors (rgba preserved) or null.
  function gradientStops(bgImage) {
    if (!bgImage || bgImage === "none" || !/gradient/.test(bgImage)) return null;
    const out = [];
    let m;
    const re = /rgba?\([^)]+\)/g;
    while ((m = re.exec(bgImage))) {
      const c = parseColor(m[0]);
      if (c) out.push(c);
    }
    return out.length ? out : null;
  }

  const isFullSlide = (rect, slideRect) =>
    rect.width >= slideRect.width * 0.9 && rect.height >= slideRect.height * 0.9;

  const stageEl = () => document.querySelector("#deck-stage, .deck-stage");

  function stageRect() {
    const el = stageEl();
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 0) return r;
    }
    const first = slides()[0];
    return first ? first.getBoundingClientRect() : null;
  }

  // Effective background luminances behind el: solid | worst gradient stops |
  // null when a background image or unanalyzable fill is in the chain.
  function effectiveBgLuminances(el, slide) {
    let pending = null;
    for (let node = el; node; node = node.parentElement) {
      const st = getComputedStyle(node);
      const stops = gradientStops(st.backgroundImage);
      if (stops) pending = stops;
      else if (st.backgroundImage && st.backgroundImage !== "none") return null;
      if (parseColor(st.backgroundColor) && parseColor(st.backgroundColor).a >= 0.99) {
        const base = parseColor(st.backgroundColor);
        return (pending || [{ r: base.r, g: base.g, b: base.b, a: 1 }]).map((s) => luminanceOf(blendOver(s, base)));
      }
      if (node === slide) break;
    }
    return slideBgLuminances(slide);
  }

  // The slide's own painted background: the LAST full-slide solid/gradient
  // layer wins (mirrors how PowerPoint stacks full-slide rectangles).
  function slideBgLuminances(slide) {
    const sr = slide.getBoundingClientRect();
    const base = parseColor(getComputedStyle(slide).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    let result = [luminanceOf(base)];
    for (const el of slide.querySelectorAll("*")) {
      if (!(el instanceof HTMLElement)) continue;
      if (!isFullSlide(el.getBoundingClientRect(), sr)) continue;
      const st = getComputedStyle(el);
      const stops = gradientStops(st.backgroundImage);
      if (stops) return stops.map((s) => luminanceOf(blendOver(s, base)));
      if (st.backgroundImage && st.backgroundImage !== "none") return null;
      const c = parseColor(st.backgroundColor);
      if (c && c.a >= 0.99) result = [luminanceOf(c)];
    }
    return result;
  }

  // Visible rect after cropping by overflow:hidden ancestors.
  function clipByAncestors(el, rect, slide) {
    let left = rect.left;
    let top = rect.top;
    let right = rect.right;
    let bottom = rect.bottom;
    for (let node = el.parentElement; node && node !== slide; node = node.parentElement) {
      const st = getComputedStyle(node);
      const clips = [st.overflow, st.overflowX, st.overflowY].some((o) => o === "hidden" || o === "clip");
      if (!clips) continue;
      const cr = node.getBoundingClientRect();
      left = Math.max(left, cr.left);
      top = Math.max(top, cr.top);
      right = Math.min(right, cr.right);
      bottom = Math.min(bottom, cr.bottom);
    }
    return { left, top, right, bottom };
  }

  function isClipped(el, slide) {
    for (let node = el; node && node !== slide; node = node.parentElement) {
      const st = getComputedStyle(node);
      if (["hidden", "clip"].includes(st.overflow) || ["hidden", "clip"].includes(st.overflowX) || ["hidden", "clip"].includes(st.overflowY)) {
        return true;
      }
    }
    return false;
  }

  // Overlap test against non-ancestor elements larger than noise.
  function isOverlapped(el, rect, slideRect, all) {
    for (const other of all) {
      if (other === el || other.contains(el) || el.contains(other)) continue;
      const o = other.getBoundingClientRect();
      if (o.width === 0 || o.height === 0) continue;
      if (isFullSlide(o, slideRect)) continue; // background layer
      const ox = Math.min(rect.right, o.right) - Math.max(rect.left, o.left);
      const oy = Math.min(rect.bottom, o.bottom) - Math.max(rect.top, o.top);
      if (ox > 1 && oy > 1) return true;
    }
    return false;
  }

  // The visible block a text belongs to: nearest painted ancestor that is not
  // the slide itself. Stretched cards count at full height, otherwise a filled
  // slide can report EMPTY REGION.
  function blockRectFor(el, slide, slideRect) {
    for (let node = el; node && node !== slide; node = node.parentElement) {
      const st = getComputedStyle(node);
      const painted =
        (st.backgroundImage && st.backgroundImage !== "none") ||
        ((parseColor(st.backgroundColor) || { a: 0 }).a > 0.05) ||
        parseFloat(st.borderTopWidth) > 0;
      if (painted) {
        const r = node.getBoundingClientRect();
        if (!isFullSlide(r, slideRect)) return r;
      }
    }
    return el.getBoundingClientRect();
  }

  const isTableRelated = (el) => el.tagName === "TABLE" || el.closest("table") !== null || el.querySelector("table") !== null;

  // Presentation chrome (footer/controls) is not content.
  const inChrome = (el) => el.closest(".footer, .deck-controls") !== null;

  function overflowOf(el) {
    if (el.clientHeight <= 0 || !readText(el)) return null;
    const v = Math.round(el.scrollHeight - el.clientHeight);
    const h = Math.round(el.scrollWidth - el.clientWidth);
    const parts = [];
    if (v > CLIP_THRESHOLD) parts.push("+" + v + "v");
    if (h > CLIP_THRESHOLD) parts.push("+" + h + "h");
    return parts.length ? parts.join(" ") : null;
  }

  const firstFamily = (ff) => (ff || "").split(",")[0].trim().replace(/^["']|["']$/g, "");

  // Построчные прямоугольники ВСЕГО текста слайда (Range API + SVG <text>).
  // Проверка «текст на текст» по реальным строкам, а не по боксам элементов:
  // ловит частичные наложения, которые боксовая проверка пропускает.
  function textLineRects(slide) {
    const recs = [];
    const walker = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const t = (node.textContent || "").replace(/\s+/g, " ").trim();
      if (t.length < 2) continue;
      const el = node.parentElement;
      if (!el) continue;
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden") continue;
      let rects;
      try {
        const range = document.createRange();
        range.selectNodeContents(node);
        rects = Array.from(range.getClientRects());
      } catch (e) {
        continue;
      }
      for (const r of rects) {
        if (r.width < 3 || r.height < 3) continue;
        recs.push({ el, text: t, rect: r });
      }
    }
    for (const t of Array.from(slide.querySelectorAll("svg text, svg tspan"))) {
      const txt = (t.textContent || "").trim();
      if (txt.length < 2) continue;
      const r = t.getBoundingClientRect();
      if (r.width < 3 || r.height < 3) continue;
      recs.push({ el: t, text: txt, rect: r, svg: true });
    }
    return recs;
  }

  const textOverlaps = (recs) => {
    const hits = [];
    for (let i = 0; i < recs.length; i++) {
      for (let j = i + 1; j < recs.length; j++) {
        const a = recs[i];
        const b = recs[j];
        if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const ix = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
        const iy = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
        if (ix <= 1 || iy <= 1) continue;
        const inter = ix * iy;
        const minArea = Math.min(a.rect.width * a.rect.height, b.rect.width * b.rect.height);
        if (inter > 4 && inter / minArea > 0.06) {
          hits.push({ a: a.text.slice(0, 40), b: b.text.slice(0, 40), frac: inter / minArea });
        }
      }
    }
    return hits;
  };

  // ------------------------------------------------------------------ ready

  async function ready() {
    // Render mode: stage pinned to the viewport origin, no fit transform.
    const mode = document.createElement("style");
    mode.id = "deck-probe-render-mode";
    mode.textContent =
      "#deck-stage, .deck-stage { transform: none !important; left: 0 !important; top: 0 !important; }" +
      ".slide { position: absolute !important; inset: 0 !important; }" +
      ".deck-controls { display: none !important; }";
    document.head.appendChild(mode);

    try {
      await document.fonts.ready;
    } catch (e) {
      /* older engines */
    }
    await Promise.all(Array.from(document.images).map((img) => (img.decode ? img.decode().catch(() => null) : null)));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const list = slides();
    const sr = stageRect();
    const families = new Set();
    const colorCount = new Map();
    const sizeCount = new Map();
    for (const el of document.querySelectorAll("*")) {
      const st = getComputedStyle(el);
      // Шрифты — только у реально отрисованных элементов с текстом (иначе
      // head/title/style/script дают UA-дефолт Times New Roman).
      const rendered = el.getClientRects().length > 0;
      const ownText =
        rendered && Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent || "").trim().length > 0);
      const svgText = rendered && el.namespaceURI === "http://www.w3.org/2000/svg" && (el.tagName === "text" || el.tagName === "tspan");
      if (ownText || svgText) {
        // Только ПЕРВИЧНОЕ лицо стека: fallback-и вроде Arial/Georgia — это
        // штатная подстраховка, а не используемый шрифт.
        const stack = (st.fontFamily || "")
          .split(",")
          .map((part) => part.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
        const primary = stack.find((name) => !/^(sans-serif|serif|monospace|system-ui|cursive|fantasy|ui-\w+)$/i.test(name));
        if (primary) families.add(primary);
      }
      const fg = colorHex(st.color);
      if (fg) colorCount.set(fg, (colorCount.get(fg) || 0) + 1);
      const bg = parseColor(st.backgroundColor);
      if (bg && bg.a > 0.05) {
        const key = rgbHex(bg);
        colorCount.set(key, (colorCount.get(key) || 0) + 1);
      }
      const fs = Math.round(parseFloat(st.fontSize));
      if (fs > 0) sizeCount.set(fs, (sizeCount.get(fs) || 0) + 1);
    }
    // Строгая проверка шрифтов: у каждой используемой семьи должен быть
    // @font-face в самой деке («только вендорные шрифты»). Одного
    // document.fonts.check() мало: для неизвестной семьи он возвращает true,
    // поэтому опечатка/забытый fonts.css раньше не ловились.
    const declared = new Set();
    for (const sheet of Array.from(document.styleSheets)) {
      let rules = null;
      try {
        rules = sheet.cssRules;
      } catch (e) {
        continue;
      }
      for (const rule of Array.from(rules || [])) {
        if (typeof CSSFontFaceRule !== "undefined" && rule instanceof CSSFontFaceRule) {
          const fam = (rule.style.getPropertyValue("font-family") || "").replace(/["']/g, "").trim();
          if (fam) declared.add(fam);
        }
      }
    }
    const missing = [];
    for (const f of families) {
      if (!declared.has(f)) {
        missing.push(f);
        continue;
      }
      // document.fonts.check() врёт для незагруженных/неиспользуемых лиц,
      // поэтому явно грузим 16px-образец кириллица+латиница.
      let faces = [];
      try {
        faces = await document.fonts.load('16px "' + f + '"', "Тест Test 123");
      } catch (e) {
        faces = [];
      }
      if (!faces.length) missing.push(f);
    }
    const top = (map, n) =>
      Array.from(map.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([k, v]) => ({ k, v }));
    return {
      probeVersion: PROBE_VERSION,
      slideCount: list.length,
      stageW: sr ? Math.round(sr.width) : 0,
      stageH: sr ? Math.round(sr.height) : 0,
      title: document.title || "",
      fontsMissing: missing,
      fontsUsed: Array.from(families),
      paletteUsed: top(colorCount, 14),
      typeScaleUsed: top(sizeCount, 14),
    };
  }

  function count() {
    return slides().length;
  }

  async function reveal(i) {
    const list = slides();
    for (let j = 0; j < list.length; j++) list[j].classList.toggle("active", j === i);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return true;
  }

  // ----------------------------------------------------------------- report

  function checkSlide(slide, index, stageR) {
    const issues = [];
    const seen = new Set();
    const push = (type, detail) => {
      const key = type + "|" + detail;
      if (seen.has(key)) return;
      seen.add(key);
      issues.push({ type, detail });
    };

    const slideRect = slide.getBoundingClientRect();

    // Decorative layers (`.decor`, `.cover-art`, template art) may intentionally
    // bleed past the slide edges and must not count as content or trigger
    // geometry checks.
    const isDecor = (el) => !!(el.closest && el.closest(".decor, .cover-art, .bg-img, .logo, .decor-img"));

    // A display:none (or zero-sized) slide is invisible to the export engine:
    // it is silently dropped from the .pptx (real incident: 8 of 10 slides
    // vanished). Slides must be hidden with .active only.
    const slideDisplay = getComputedStyle(slide).display;
    if (slideDisplay === "none" || slideRect.width < 2 || slideRect.height < 2) {
      push("hidden-slide", "slide is display:none or zero-sized — the export engine skips it; hide slides with .active, never display:none");
      return { index, issues };
    }

    const descendants = Array.from(slide.querySelectorAll("*")).filter((el) => el instanceof HTMLElement);
    const slideArea = slideRect.width * slideRect.height;
    const role = slide.dataset.role || "content";

    if (index === 0 && stageR) {
      if (Math.abs(stageR.width - STAGE_W) > 1 || Math.abs(stageR.height - STAGE_H) > 1) {
        push("stage-broken", `stage is ${Math.round(stageR.width)}×${Math.round(stageR.height)}px, expected ${STAGE_W}×${STAGE_H} — stage.css missing or body zoomed`);
      }
    }

    const outOfBounds = [];
    for (const el of descendants) {
      if (isDecor(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 && rect.height <= 0) continue;
      const fullSlide = isFullSlide(rect, slideRect);

      // Text overflowing a box that actually clips it.
      if (!fullSlide && el.clientHeight > 0 && readText(el)) {
        const v = Math.round(el.scrollHeight - el.clientHeight);
        const h = Math.round(el.scrollWidth - el.clientWidth);
        if ((v > CLIP_THRESHOLD || h > CLIP_THRESHOLD) && !isTableRelated(el) && isClipped(el, slide)) {
          const parts = [];
          if (v > CLIP_THRESHOLD) parts.push(v + "px vertically");
          if (h > CLIP_THRESHOLD) parts.push(h + "px horizontally");
          push("text-clip", excerpt(el, 60) + " overflows its box by " + parts.join(", "));
        }
      }

      // Leaking outside the slide.
      const vis = clipByAncestors(el, rect, slide);
      const out = [];
      if (vis.right > slideRect.right + 1) out.push(Math.round(vis.right - slideRect.right) + "px past right edge");
      if (vis.bottom > slideRect.bottom + 1) out.push(Math.round(vis.bottom - slideRect.bottom) + "px past bottom edge");
      if (vis.left < slideRect.left - 1) out.push(Math.round(slideRect.left - vis.left) + "px past left edge");
      if (vis.top < slideRect.top - 1) out.push(Math.round(slideRect.top - vis.top) + "px past top edge");
      if (out.length && !outOfBounds.some((parent) => parent.contains(el))) {
        outOfBounds.push(el);
        push("out-of-bounds", excerpt(el, 60) + " extends " + out.join(", "));
      }

      // Contrast: own text, no foreign elements on top; worst gradient stop.
      if (ownText(el) && !isOverlapped(el, rect, slideRect, descendants)) {
        const fg = luminance(getComputedStyle(el).color);
        const bgs = effectiveBgLuminances(el, slide);
        if (fg !== null && bgs && bgs.length) {
          const worst = Math.min.apply(null, bgs.map((b) => contrast(fg, b)));
          if (worst < NEARLY_INVISIBLE) {
            push("low-contrast", excerpt(el, 60) + ` has insufficient contrast against its background (ratio ${worst.toFixed(1)}:1 < ${NEARLY_INVISIBLE}, WCAG AA large text)`);
          }
        }
      }
    }

    // Text × text collisions — по строкам (Range API + SVG text).
    for (const hit of textOverlaps(textLineRects(slide))) {
      push("text-overlap", `«${hit.a}» overlaps «${hit.b}» (${Math.round(hit.frac * 100)}% of the line box)`);
    }

    // Graphic × text collisions (non-background images only).
    const textEls = [];
    for (const el of descendants) {
      if (!ownText(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) continue;
      textEls.push({ el, rect });
    }
    for (const img of Array.from(slide.querySelectorAll("img"))) {
      const rect = img.getBoundingClientRect();
      if (rect.width <= 8 || rect.height <= 8) continue;
      if (!img.complete || img.naturalWidth === 0) continue;
      if (slideArea > 0 && (rect.width * rect.height) / slideArea > 0.35) continue;
      for (const t of textEls) {
        if (t.el.contains(img) || img.contains(t.el)) continue;
        const ix = Math.min(t.rect.right, rect.right) - Math.max(t.rect.left, rect.left);
        const iy = Math.min(t.rect.bottom, rect.bottom) - Math.max(t.rect.top, rect.top);
        if (ix <= 0 || iy <= 0) continue;
        const minArea = Math.min(t.rect.width * t.rect.height, rect.width * rect.height);
        if (minArea > 0 && (ix * iy) / minArea > 0.25) {
          push("text-overlap", `a ${Math.round(rect.width)}×${Math.round(rect.height)}px graphic collides with text ` + excerpt(t.el, 40));
          break;
        }
      }
    }

    // Broken images.
    for (const img of Array.from(slide.querySelectorAll("img"))) {
      if (img.complete && img.naturalWidth === 0) {
        push("broken-image", "an image failed to render — fix the path and re-run assets.cjs");
        break;
      }
    }

    // Alt-текст: атрибут alt обязателен (пустой — для декоративных картинок).
    let altMissing = 0;
    for (const img of Array.from(slide.querySelectorAll("img"))) {
      if (!img.hasAttribute("alt")) altMissing++;
    }
    if (altMissing) {
      push("img-no-alt", `${altMissing} image(s) without an alt attribute — add alt text (or alt="" for decoration)`);
    }

    // A real photo placed as a small bullet reads as an accident: if the
    // natural size is big but the rendered area is tiny, enlarge it.
    for (const img of Array.from(slide.querySelectorAll("img"))) {
      if (img.closest(".decor, .cover-art, .bg-img, .logo, .decor-img")) continue;
      const r = img.getBoundingClientRect();
      if (r.width * r.height > 0.06 * slideArea) continue;
      if (!img.naturalWidth || img.naturalWidth < 400) continue;
      push("tiny-image", "a full-size picture is rendered as a small tile — enlarge it into an illustration or drop it");
      break;
    }

    // Rows inside a painted box must be separated by <br>: the exporter merges
    // all runs of a box into one <a:p>, so without <br> PowerPoint shows the
    // title and the body on a single line.
    const RUN_CLASSES = ["t-line", "t-title", "t-body", "t-cap"];
    for (const box of Array.from(slide.querySelectorAll(".card, .flow .node, .matrix .cell"))) {
      let prevRun = false;
      for (const kid of Array.from(box.children)) {
        if (kid.tagName === "BR") {
          prevRun = false;
          continue;
        }
        const isRun = kid.classList && RUN_CLASSES.some((c) => kid.classList.contains(c));
        if (isRun && prevRun) {
          push("missing-br", "two text rows in one box are not separated by <br> — in the .pptx they become a single line");
          break;
        }
        prevRun = isRun;
      }
    }

    // Emphasis accent: a content slide must show the eye where to look.
    // Kicker, footer, soft icon badges and icon strokes do not count.
    if ((slide.dataset.role || "content") === "content") {
      const accentSel =
        ".card.accent, .node.accent, .cell.accent, .step.accent, .pill.accent, .icon-badge:not(.soft), .accent-text, .fill, .area, .series, .point, .seg, .table .hl, .timeline .dot, .cover-art, .rule-brand";
      if (!slide.querySelector(accentSel)) {
        push("no-accent", "no emphasis accent on this slide — highlight the key card, step, number or table row");
      }
    }

    // Accent misuse (the "acid slab" and "blue on blue" defects):
    //  - long headings must stay ink (accent headings read as decoration);
    //  - one accent surface larger than 40% of the slide is a slab, not an
    //    accent — keep accent to badges, numbers, one short card.
    const accentRgb = (() => {
      const raw = getComputedStyle(slide).getPropertyValue("--c-accent").trim();
      const m = /^#([0-9a-f]{6})$/i.exec(raw);
      if (!m) return null;
      const n = parseInt(m[1], 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    })();
    if (accentRgb) {
      const nearAccent = (c) => c && Math.abs(c.r - accentRgb.r) + Math.abs(c.g - accentRgb.g) + Math.abs(c.b - accentRgb.b) < 36;
      if (role !== "section") {
        for (const h of Array.from(slide.querySelectorAll(".headline, h1, h2"))) {
          if (nearAccent(parseColor(getComputedStyle(h).color))) {
            push("accent-heading", "a heading is painted in the accent color — headings stay ink; accent belongs to badges, numbers and one short card");
            break;
          }
        }
      }
      let accentArea = 0;
      for (const el of Array.from(slide.querySelectorAll("*"))) {
        if (isDecor(el)) continue;
        const st = getComputedStyle(el);
        const c = parseColor(st.backgroundColor);
        // Only an OPAQUE accent surface is an accent slab; translucent tints
        // (.card.tint) are the recommended way to highlight a block.
        if (!nearAccent(c) || (c && c.a < 0.5)) continue;
        const r = el.getBoundingClientRect();
        const a = r.width * r.height;
        if (a > accentArea) accentArea = a;
      }
      if (slideArea > 0 && accentArea / slideArea > 0.4) {
        push("accent-overload", "an accent-filled block covers over 40% of the slide — accent is emphasis, not a content background; use .card + a small accent element");
      }
      const accentCards = slide.querySelectorAll(".card.accent").length;
      if (accentCards >= 2) {
        push("accent-cards", `${accentCards} solid accent cards on one slide — a wall of filled boxes; keep at most one and use .card.tint for the other highlights`);
      }
    }

    // A cover with no visual at all reads as a typed page.
    if (role === "cover" && !slide.querySelector(".cover-art, .decor, .bg-img, .logo, .decor-img, img, svg, .chart")) {
      push("plain-cover", "the cover has no visual layer — add cover-art, decor, a logo or the template's background");
    }

    // A tall painted box whose text fills less than a third of its height
    // reads as an empty box (the "hollow flow node" defect).
    for (const box of Array.from(slide.querySelectorAll(".card, .flow .node, .matrix .cell"))) {
      const r = box.getBoundingClientRect();
      if (r.height < 180) continue;
      const range = document.createRange();
      range.selectNodeContents(box);
      const rects = Array.from(range.getClientRects()).filter((x) => x.height > 1);
      if (!rects.length) continue;
      const top = Math.min.apply(null, rects.map((x) => x.top));
      const bottom = Math.max.apply(null, rects.map((x) => x.bottom));
      const used = bottom - top;
      if (used / r.height < 0.38) {
        push("sparse-box", `a box is ${Math.round(r.height)}px tall but its text fills only ${Math.round((used / r.height) * 100)}% — shorten the box or add substance`);
        break;
      }
    }

    // Минимальный зазор после заголовка (приём из валидатора guizang-ppt-skill):
    // заголовок не должен «прилипать» к следующему блоку — при рендере в .pptx
    // такой зазор превращается в наложение.
    const airyRole = ["cover", "section", "quote", "closing"].includes(role);
    const headingEls = airyRole ? [] : descendants.filter((el) => el.matches && el.matches("h1, h2, h3, .headline, .t-title, .quote"));
    for (const heading of headingEls) {
      const hr = heading.getBoundingClientRect();
      if (hr.width < 8 || hr.height < 8) continue;
      const minGap = heading.matches(".t-title") ? 6 : heading.matches("h3") ? 8 : 16;
      let nearest = null;
      let nearestGap = Infinity;
      for (const other of descendants) {
        if (other === heading || heading.contains(other) || other.contains(heading)) continue;
        const st = getComputedStyle(other);
        if (st.display === "none" || st.visibility === "hidden") continue;
        const or = other.getBoundingClientRect();
        if (or.width < 8 || or.height < 8) continue;
        const overlapX = Math.min(hr.right, or.right) - Math.max(hr.left, or.left);
        const overlapRatio = overlapX / Math.min(hr.width, or.width);
        if (overlapRatio < 0.15) continue;
        const gap = or.top - hr.bottom;
        if (gap < -1) continue; // это уже наложение — ловится text-overlap
        if (gap > 120) continue;
        if (gap < nearestGap) {
          nearestGap = gap;
          nearest = other;
        }
      }
      if (nearest && nearestGap < minGap) {
        push("tight-gap", `«${excerpt(heading, 32)}» has only ${Math.round(nearestGap)}px before «${excerpt(nearest, 32)}» (min ${minGap}px)`);
      }
    }

    // Empty regions against the content band (slide minus .slide-pad padding).
    const airy = ["cover", "section", "quote", "closing"].includes(role);
    const padEl = slide.querySelector(".slide-pad") || slide;
    const padStyle = getComputedStyle(padEl);
    const padTop = parseFloat(padStyle.paddingTop) || 0;
    const padBottom = parseFloat(padStyle.paddingBottom) || 0;
    const bandTop = slideRect.top + padTop;
    const bandBottom = slideRect.bottom - padBottom;
    const bandHeight = Math.max(1, bandBottom - bandTop);
    const emptyLimit = 0.33;
    const contentRects = [];
    for (const el of descendants) {
      if (isDecor(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 2 || rect.height <= 2) continue;
      if (inChrome(el)) continue;
      const media = /^(IMG|CANVAS|SVG|VIDEO)$/.test(el.tagName);
      if (!ownText(el) && !media) continue;
      if (isFullSlide(rect, slideRect)) continue;
      contentRects.push(media ? rect : blockRectFor(el, slide, slideRect));
    }
    // For content slides even one or two elements are enough to judge the
    // emptiness; airy roles (cover/section/quote/closing) keep the old gate.
    if (contentRects.length >= 3 || (!airy && contentRects.length >= 1)) {
      const firstTop = Math.min.apply(null, contentRects.map((r) => r.top));
      const lastBottom = Math.max.apply(null, contentRects.map((r) => r.bottom));
      const emptyTop = (firstTop - bandTop) / bandHeight;
      const emptyBottom = (bandBottom - lastBottom) / bandHeight;
      if (airy) {
        if (emptyBottom > 0.45) push("empty-region", `bottom ${Math.round(emptyBottom * 100)}% of the content band is empty`);
      } else if (contentRects.reduce((s, r) => s + Math.max(0, r.bottom - r.top), 0) < 0.25 * bandHeight) {
        // A heading plus one small block on an empty canvas is the real
        // "много пустого места" defect: measure how much of the band the
        // content actually covers (kicker/headline count, footer excluded).
        push("mostly-empty", "the slide is mostly empty — content covers less than a quarter of the canvas; add substance or switch the pattern");
      } else if (emptyTop > emptyLimit && emptyTop > emptyBottom * 1.5) {
        push("empty-region", `top ${Math.round(emptyTop * 100)}% of the content band is empty — did the heading get lost?`);
      } else if (emptyBottom > emptyLimit && emptyBottom > emptyTop * 1.5) {
        push("empty-region", `bottom ${Math.round(emptyBottom * 100)}% of the content band is empty while the top is packed — add a row or rebalance`);
      }
    }

    // Candidate blank: no text and no meaningful content. Full-slide layers
    // (backgrounds) are not content.
    const hasText = readText(slide).length > 0;
    let hasContent = false;
    for (const el of descendants) {
      if (isDecor(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 2 || rect.height <= 2) continue;
      if (isFullSlide(rect, slideRect)) continue;
      const media = /^(IMG|CANVAS|SVG|VIDEO)$/.test(el.tagName);
      if (ownText(el) || (media && (rect.width * rect.height) / slideArea < 0.35)) {
        hasContent = true;
        break;
      }
    }
    if (!hasText && !hasContent) push("maybe-blank", "no text or media detected on this slide");

    return { index, issues };
  }

  // На время измерения все слайды делаем видимыми: Range.getClientRects не
  // отдаёт прямоугольники строк внутри visibility:hidden, а report() зовётся,
  // когда активен только последний слайд (капчуры уже сняты).
  function withAllSlidesMeasurable(fn) {
    const style = document.createElement("style");
    style.id = "deck-probe-measure";
    style.textContent = ".slide { visibility: visible !important; }";
    document.head.appendChild(style);
    try {
      return fn();
    } finally {
      style.remove();
    }
  }

  // Severity: only contract violations block the export (exit 4). Taste and
  // quality hints are suggestions — the model reviews them visually and fixes
  // what it agrees with (this is how SOTA skills balance lint vs judgement).
  const ERROR_TYPES = new Set([
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
  const withSeverity = (issue) => ({ ...issue, severity: ERROR_TYPES.has(issue.type) ? "error" : "warning" });

  function report() {
    const stageR = stageRect();
    const list = slides();
    const results = withAllSlidesMeasurable(() =>
      list.map((slide, i) => {
        try {
          const res = checkSlide(slide, i, stageR);
          return { ...res, issues: (res.issues || []).map(withSeverity) };
        } catch (e) {
          return { index: i, issues: [{ type: "probe-error", detail: String((e && e.message) || e), severity: "error" }] };
        }
      }),
    );
    // Deck-level: the same non-chrome picture repeated across slides (real
    // complaint: one generated cat appeared on three slides, two in a row).
    const srcSlides = new Map();
    list.forEach((slide, idx) => {
      for (const img of Array.from(slide.querySelectorAll("img"))) {
        if (img.closest(".decor, .cover-art, .bg-img, .logo, .decor-img")) continue;
        const src = img.getAttribute("src") || "";
        if (!src) continue;
        if (!srcSlides.has(src)) srcSlides.set(src, []);
        srcSlides.get(src).push(idx);
      }
    });
    for (const [, idxs] of srcSlides) {
      if (idxs.length < 2) continue;
      const last = idxs[idxs.length - 1];
      results[last].issues.push(
        withSeverity({
          type: "image-reuse",
          detail: `the same picture appears on ${idxs.length} slides (${idxs.map((i) => i + 1).join(", ")}) — one image = one meaning; vary the image or drop the repeats`,
        }),
      );
    }
    return results;
  }

  // ------------------------------------------------------------- exportPrep

  // The export engine skips hidden subtrees and measures each slide root, so
  // un-stack the slides into a vertical flow and make them measurable. Notes:
  // the engine reads the `data-pptx-notes` ATTRIBUTE value; a [data-notes]
  // element (legacy) is copied into the slide attribute first.
  function exportPrep() {
    const stage = stageEl();
    if (stage) {
      stage.style.setProperty("position", "static", "important");
      stage.style.setProperty("transform", "none", "important");
      stage.style.setProperty("height", "auto", "important");
    }
    let notes = 0;
    for (const slide of slides()) {
      slide.style.setProperty("position", "relative", "important");
      slide.style.setProperty("visibility", "visible", "important");
      slide.style.setProperty("opacity", "1", "important");
      slide.style.setProperty("z-index", "auto", "important");
      for (const legacy of slide.querySelectorAll("[data-notes]:not([data-pptx-notes])")) {
        legacy.setAttribute("data-pptx-notes", readText(legacy));
      }
      if (slide.querySelector("[data-pptx-notes]")) notes++;
    }
    return { slides: slides().length, notes };
  }

  function exportRestore() {
    const stage = stageEl();
    if (stage) {
      stage.style.removeProperty("position");
      stage.style.removeProperty("transform");
      stage.style.removeProperty("height");
    }
    for (const slide of slides()) {
      slide.style.removeProperty("position");
      slide.style.removeProperty("visibility");
      slide.style.removeProperty("opacity");
      slide.style.removeProperty("z-index");
    }
  }

  // -------------------------------------------------------------- inventory

  function inventory() {
    return withAllSlidesMeasurable(() =>
      slides().map((slide, index) => {
      try {
        const sr = slide.getBoundingClientRect();
        const role = slide.dataset.role || "";
        const notes = Array.from(slide.querySelectorAll("[data-pptx-notes], [data-notes]"))
          .map((n) => ((n.tagName || "").toLowerCase() === "template" && n.content ? n.content.textContent : n.textContent) || "")
          .join("\n\n")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 500);
        const elements = [];
        let decor = 0;
        let skipped = 0;
        const contentRects = [];

        for (const el of slide.querySelectorAll("*")) {
          if (!(el instanceof HTMLElement)) continue;
          const rect = el.getBoundingClientRect();
          if (rect.width < 2 || rect.height < 2) continue;
          const st = getComputedStyle(el);
          const media = /^(IMG|CANVAS|SVG|VIDEO)$/.test(el.tagName);
          const hasText = ownText(el);
          const hasPaint =
            (st.backgroundImage && st.backgroundImage !== "none") ||
            (parseColor(st.backgroundColor) || { a: 0 }).a > 0.05 ||
            parseFloat(st.borderTopWidth) > 0;
          const meaningful = hasText || media || el.dataset.role || el.dataset.pptx;
          const fullSlide = isFullSlide(rect, sr);

          if (!meaningful) {
            if (hasPaint && !fullSlide) decor++;
            continue;
          }
          if (fullSlide) continue; // background layer, reported at slide level
          const chrome = inChrome(el);
          if ((hasText || media) && !chrome) contentRects.push(media ? rect : blockRectFor(el, slide, sr));
          if (elements.length >= 40) {
            skipped++;
            continue;
          }
          const size = Math.round(parseFloat(st.fontSize)) || 16;
          const lhRaw = parseFloat(st.lineHeight);
          const lh = Number.isFinite(lhRaw) && lhRaw > 0 ? round1(lhRaw / size) : 1.2;
          elements.push({
            tag: el.tagName.toLowerCase(),
            role: chrome ? "footer" : el.dataset.role || el.dataset.pptx || "",
            text: hasText || media ? excerpt(el, 64) : "",
            x: Math.round(rect.left - sr.left),
            y: Math.round(rect.top - sr.top),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
            font: firstFamily(st.fontFamily),
            size,
            weight: st.fontWeight,
            lh,
            color: colorHex(st.color),
            lines: Math.max(1, Math.round(rect.height / Math.max(1, size * lh))),
            ov: overflowOf(el),
          });
        }
        if (skipped > 0) elements.push({ more: skipped });

        let coverage = 0;
        if (contentRects.length) {
          const top = Math.min.apply(null, contentRects.map((r) => r.top));
          const bottom = Math.max.apply(null, contentRects.map((r) => r.bottom));
          coverage = Math.round(((bottom - top) / Math.max(1, sr.height)) * 100) / 100;
        }
        return {
          index,
          role,
          bg: colorHex(getComputedStyle(slide).backgroundColor) || "#FFFFFF",
          stage: { w: Math.round(sr.width), h: Math.round(sr.height) },
          coverage,
          decor,
          notes,
          elements,
        };
      } catch (e) {
        return { index, role: "", bg: "", coverage: 0, decor: 0, notes: "", elements: [], error: String((e && e.message) || e) };
      }
      }),
    );
  }

  // ------------------------------------------------------------ printLayout

  function printLayout() {
    let style = document.getElementById("deck-probe-print");
    if (!style) {
      style = document.createElement("style");
      style.id = "deck-probe-print";
      document.head.appendChild(style);
    }
    style.textContent = [
      "@page { margin: 0; }",
      "@media print {",
      "  html, body { width: " + STAGE_W + "px; height: auto; overflow: visible; background: #fff; }",
      "  .deck-viewport { position: static; overflow: visible; background: #fff; }",
      "  #deck-stage, .deck-stage { position: static; transform: none !important; width: " + STAGE_W + "px; height: " + STAGE_H + "px; background: none; }",
      "  .slide { position: relative !important; display: block !important; visibility: visible !important; opacity: 1 !important; pointer-events: auto !important; width: " + STAGE_W + "px; height: " + STAGE_H + "px; break-after: page; page-break-after: always; }",
      "  .slide:last-of-type { break-after: auto; page-break-after: auto; }",
      "  .deck-controls { display: none !important; }",
      "}",
    ].join("\n");
  }

  window.__deckProbe = {
    PROBE_VERSION,
    ready,
    count,
    reveal,
    report,
    inventory,
    exportPrep,
    exportRestore,
    printLayout,
  };
})();
