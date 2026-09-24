# fonts/

Vendored faces (woff2 for rendering + ttf for .pptx embedding), latin+cyrillic
subsets, OFL 1.1 — Inter 400/600/800, Source Serif 4 (600), Unbounded (700),
JetBrains Mono (400).

Provenance: Google Fonts via gwfh.mranftl.com; WOFF2/TTF container magic and
the families were verified while building this skill. Rendered decks reference
these files as `url("fonts/<file>.woff2")`; `helpers/assets.cjs` inlines them
as data URIs so a deck never depends on the skill folder at view time.

Adding a corporate face (only when its license allows redistribution):

1. put `<name>.woff2` and `<name>.ttf` in this folder;
2. add `@font-face` blocks to `fonts.css` (copy the pattern; weight exact);
3. add the family + files to `manifest.json` (`files` and `ttf`);
4. re-run `node helpers/assets.cjs deck.html` for decks that use it.

If a template's face cannot be vendored (proprietary), say so plainly: the
deck will substitute it; pick the closest vendored face instead of pretending.
The render probe reports `FONT NOT LOADED` for families with no loaded face.
