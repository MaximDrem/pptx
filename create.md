# create.md — the from-scratch mode

You are here because the user asked for a presentation and did not attach a
style reference. The design system is already built: pick a preset, lean on
`patterns.md`, generate one picture. Do not invent a style when a verified
one exists.

## 1. Pick a built-in style

**Default: `sber`** — the brand style (white canvas, Sber gradient
#0098F8 → #21A038 → #F1E813 in accents and chart fills, Inter in place of the
proprietary SB Sans). Use it unless the content clearly asks for something
else. Alternatives in `styles/index.json`: `signal-night` (dark brand variant
for pitch/strategy), `grid-paper` (neutral IKB when the deck is not
Sber-related), `ink-press` (warm editorial for stories/reports). Pick by
content type without asking; if the user named a style, use it. Never mix two
palettes in one deck.

```html
<style data-presentation-style="sber"></style>
```

If the user asks for the style of a saved profile (`~/.wsc/config/styles/`),
paste its `tokens.css` before `styles/_base.css` and use
`data-presentation-style="profile:<slug>"`.

## 2. The scratch-mode picture rule

A deck made from scratch (5+ slides) MUST carry at least one generated
picture — the cover or a key content slide. Generate it with the chat image
tool (e.g. `gigachat_image`/`text2image`), SAVE the file into `images/`, and
reference the local path (`src="images/<file>"`) inside the deck — never the
tool call itself, never an external URL (the deck is offline; the lint error
on a `gigachat_image(` call in deck.html means exactly this: file, not
call). Place per `patterns.md` (`.media`, `.split`), never reuse one file
twice, and if the topic allows more, 1–3 images is what makes a text-heavy
deck land.

## 3. Then

Plan (SKILL.md §2) → write (§3) → the render loop (§4) → export (§5) →
self-review (§6). Covers, sections and closings get `<div class="cover-art">`
plus at least one `<div class="decor …">` element — the cheap trick that
makes covers look designed, not typed (see §3 markup rules).
