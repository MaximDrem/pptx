# template.md — the template-copy mode

You are here because the user attached a .pptx and asked for a deck in its
style. **The contract: the result must READ as the same design family — its
backgrounds, its palette, its art, its density.** A deck that only borrows a
token color is not a copy. A real run delivered a 19/19 image-background
template as a flat-fill deck — every warning named it, the agent shipped
anyway. That is the failure this file prevents.

Text parsing alone is NOT enough — it produced decks with flat blue slides
and a decorative cat stretched as a background. The workflow:

```bash
# 1) See the template first: per-slide PNGs + a text digest
... shots.cjs "<attached.pptx>" --out-dir tpl-shots

# 2) Extract tokens + assets AND deploy the key art next to the deck
#    (--deploy takes the working folder; "." only works with the cd above)
... style-profile.cjs "<attached.pptx>" --name "Style name" --deploy .
```

Right after step 2, **verify the deploy landed in YOUR working folder** —
the helper prints the absolute deploy dir; if it is not the folder you are
working in, re-run with `--deploy "<your working folder>"`. A quick
`ls images/` must show template-bg-*.png and template-assets.md before you
write deck.html.

Then, **in this order**:

1. READ every `tpl-shots/slide-NN.png` (vision). For each slide note:
   role (cover/section/content/closing), background (flat color? photo?
   gradient?), where the logo sits, what is decor vs content. This is the
   ground truth — the parser's roles are hints, your eyes are the verdict.
   For a text-heavy template also run `read-pptx.cjs <template.pptx>
   --outline`: the shots digest truncates long texts, and you need the full
   per-slide content to see what its slides actually carry.
2. From the shots pick the **background assets**: full-slide, dark or calm
   images only. A transparent PNG or a small/edge element is DECOR — it never
   becomes a slide background (the validator errors `decor-as-background`;
   real incident: the template's cat decor became the final slide's
   background).
3. Note the palette by looking: dominant color, accent, whether the deck is
   dark or light. Compare with the extracted `tokens.css`; if they disagree,
   trust what you SEE and fix the tokens (bg/ink/accent) by hand.
4. **Look at the art yourself, then decide** — the copy is recognizable because
   it reuses the template's own elements, not because a script placed them.
   `--deploy` copies the art into `images/` and writes
   `images/template-assets.md` with FACTS: the file, its size, and where each
   element appears on the template's own slides (slide number, position,
   rotation). The role words there (`decor`/`photo`/`icon`) are auto-guesses.
   **Open the image files you consider** (you can view them like any PNG) and
   answer in your own words:
   - what is it? (blob/arrow/3D icon/photo of a person/laptop/screenshot/logo…)
   - content or atmosphere? (a photo the slide is *about* vs an edge accent)
   - does your slide need it at all?
   Then look at the template shot of the slide that uses it and place it the
   same way, adapted to your content. Do not stamp the same element at the same
   coordinates on every slide — the template moves, mirrors, scales and bleeds
   its art per slide. Bleeding off an edge is fine (negative offsets); art over
   text, a squashed aspect or the same spot on 3+ slides show up as suggestions
   (`decor-under-text`, `stretched-image`, `decor-stamp`) — decide in the
   render. Technical forms:
   - `<img class="bg-img" src="images/template-bg-1.png" alt="">` as the FIRST child
     of **every slide that has a background in the template** — for corporate
     templates that is usually most content slides too, not only cover and
     closing. The deploy map lists which template slides use which background —
     match by slide type. A token bg is only for flat templates;
   - the profile already reproduces the template's content boxes: `--c-surface`
     holds the template's own card fill (usually a translucent white/black,
     e.g. `rgba(255,255,255,0.15)`), so plain `.card` looks native. The
     manifest's **Box styles** lists the template's actual box looks (fill,
     rounding, border, glow, slide numbers); patterns.md → **Box variants**
     maps each look to its HTML form (`.card` / `.deep` / `.ghost` / `.tint` /
     `.inverse`; rows/steps/numbers are separate patterns). Use the matching
     form — the same box on every slide is the monotonous-copy failure;
   - `<img class="logo" …>` in the corner the manifest prints — corporate
     templates usually keep it TOP-LEFT, so paste `class="logo pos-tl"` and
     add `with-logo` to the slide class (it reserves the top band). A
     **Branding lockup** is a separate section: near-white brand art that goes
     where the template puts it (usually once, on the cover) — it is NOT
     decor: never repeat it and never place it over the logo;
   - a photo is content: prefer a `.media` block inside a pattern (or a
     circular inset for a square portrait) and keep its aspect (set only
     `width`); do not squeeze it into a corner;
   - the **Layout recipes** section lists what the template composes per slide:
     background + art + box looks + `connectors: N (arrows)` + `table R×C` +
     title. Match the recipe to the section you are building — a KPI row, a
     flow, a photo-led slide — instead of putting every section on the same
     grid. Connectors/arrows become the `.flow`/`.steps` patterns (never a
     pasted image), a table becomes `.table`, and a photo's crop/opacity fact
     (when listed) tells you how the original framed it.
   If `template-assets.md` says the template has no reusable art (a flat
   token-only style), say so and move on.
5. Build the deck with `data-presentation-style="profile:<slug>"`. Keep the
   template's dark/light decision on EVERY slide — do not switch some slides
   to a flat fill "for variety" (that is how the blue slides happened).
6. **Verify against the reference before delivering** — this is your mode's
   final gate (SKILL.md §6 covers the common part):

   ```bash
   ... review.cjs deck.html --out-dir deck-final --reference "<template.pptx>"
   ```

   - put a template shot next to your render of the same kind of slide. If
     they feel like different decks, fix tokens, backgrounds or the deployed
     art before delivering;
   - compare DENSITY: the review prints the template's average filled boxes +
     pictures per slide next to yours — a copy at half the reference density
     reads empty even when every check passes. Close the gap with the
     template's own means (its boxes, decor placements, `.flow` for its
     connectors, photos where it has them); empty space is not minimalism;
   - **decor is the template's recurring signature**: the branding lockup goes
     where the template puts it (usually once, the cover), but deployed decor
     belongs on several slides in varied placements — a copy that used only
     the branding lost the template's signature (real case);
   - name the deployed element you used on the cover and on a content slide
     (the structural read's TEMPLATE ASSETS block shows what is where). If
     `template-decor-*` exists and appears nowhere, place it on the
     cover/section/closing (bleed it off an edge if it collides);
   - box variety: the manifest's Box styles list several fills — if every
     card is the same surface, switch some to `.card.deep/.tint/.ghost`; the
     original template mixes them.
