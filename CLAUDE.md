# Build Standards

Rules every site build follows — Lurro first, client projects after.
Read this before writing any code. Pair it with the project's own brief
(for Lurro: `LURRO_MASTER_CLAUDE_HANDOFF.md`).

This file sets quality floors — contrast, spacing, performance, accessibility,
motion restraint. These are minimums; nothing overrides them, including a
project brief. A project brief sets what gets built — concept, layout,
interaction, scope, build order. Where a real conflict remains after that
split, ask rather than assume.

---

## 0. How to use this file

- Drop it in the repo root as `CLAUDE.md` (or import it from there) so Claude
  Code loads it every session.
- Per project, only Section 2 (tokens) changes. Everything else stays.
- For a client project, copy this file, swap the tokens, delete the
  Shopify section if the site isn't a store.

---

## 1. Non-negotiables

1. **Never edit a live theme or a live site directly.** Work on an
   unpublished copy or a branch. Duplicate before any risky change.
2. **Never ship an unverified claim.** No "925 sterling", "18K gold",
   "waterproof", "hypoallergenic" unless it's been confirmed or tested.
   Same for reviews, counts, and press mentions.
3. **No fake urgency.** No countdowns that reset, no invented "only 2 left".
   Honest aggregate proof only.
4. **Never lazy-load the hero.** It is the first thing a visitor sees and
   the main thing performance is judged on.
5. **Every clickable thing must look clickable**, and nothing else should.
6. **Ask before adding a dependency.** Prefer what the platform already has.

---

## 2. Design tokens (per project)

Define once, reference everywhere. Never type a raw hex or pixel value
into a component.

Three tiers:
- **Primitive** — the raw value. `--navy-900: #0F1E2E;`
- **Semantic** — the job. `--color-text: var(--navy-900);`
- **Component** — the use. `--button-bg: var(--color-accent);`

Eight color roles, every project:
`background`, `surface`, `text`, `text-muted`, `accent`, `border`,
`success`, `error`

### Lurro tokens — PLACEHOLDER
Replace once the palette is locked. Do not build around these long-term.

```css
:root {
  --color-background: #F3EDE3;
  --color-surface:    #FFFFFF;
  --color-text:       #13263A;
  --color-text-muted: #5A6B7C;
  --color-accent:     #B8893A;
  --color-border:     #DED4C6;
  --color-success:    #1A7F4E;
  --color-error:      #C5283D;
}
```

Fonts: to be locked. One display face with personality, one plain face for
body. Never more than two families; use weights for variety.

---

## 3. Typography

| Role | Desktop | Mobile |
|---|---|---|
| H1 (once per page) | 48–64px | 32–40px |
| H2 | 28–36px | 24–28px |
| H3 | 20–24px | 18–20px |
| Body | 16–18px | 16px minimum |
| Caption | 12–14px, sparingly | same |

- Body line height 1.5×; headline line height 1.1–1.2×.
- Line length under 80 characters. Cap text columns around 600–700px.
- Big jumps between levels. Near-identical sizes are the worst option —
  the reader ends up doing the sorting.
- Avoid the generated-page tells: one accented word in a headline,
  ALL-CAPS eyebrow labels above every heading, `→` glued onto button text.

---

## 4. Color and contrast

- Body text: **4.5:1** minimum against its background.
- Large text (24px+, or bold 18px+): **3:1**.
- Buttons, borders, form fields: **3:1**.
- Check with the WebAIM contrast checker before shipping. Not by eye.
- Color is never the only signal. An error needs an icon or the word,
  not just red text.
- Bright golds, oranges and reds usually fail as body text. Darken a
  separate text variant instead of reusing the brand color.

---

## 5. Spacing and layout

- **8-point grid.** Every spacing value is a multiple of 8:
  `4 (rare) / 8 / 16 / 24 / 32 / 48 / 64`.
- **Internal ≤ external.** Space inside a group is smaller than the
  space around it. Card padding 24px, card-to-card gap 32px+.
- 12-column desktop grid; 8 at tablet; 4 on phone. The column count
  changes at each size — a phone layout is designed, not shrunk.
- Breakpoints to check every build: **375 / 768 / 1024 / 1440**.
- Mobile-first. Design the tightest version first.

---

## 6. Motion

- Motion answering a tap or click is always welcome: opening, expanding,
  confirming. It shows what changed.
- Automatic motion is rationed. **One orchestrated moment per page.**
  Fade-and-slide-up on every section and hover lift on every card is the
  generated-page default — don't.
- `prefers-reduced-motion: reduce` must render the final state
  immediately, with nothing lost.
- Any scroll animation must leave the page fully usable if it never runs.
  Product cards stay real links, not painted pixels.

---

## 7. Performance

- Hero image: never lazy-loaded, `fetchpriority="high"`.
- Everything below the fold: `loading="lazy"`.
- Images in AVIF or WebP, sized to their slot. No 4000px file in a
  400px box.
- Hero video under 2MB, with a poster frame, muted, `playsinline`:
  ```
  ffmpeg -i raw.mp4 -crf 28 -movflags +faststart -vcodec libx264 out.mp4
  ```
- Phones get a static image instead of video unless tested otherwise.
- Every image slot has a **fixed aspect ratio** so swapping a photo
  never shifts the layout.
- Third-party scripts are a cost. Each one needs a reason.

---

## 8. Accessibility floor

Check before calling anything done:
- [ ] Contrast passes (4.5:1 body / 3:1 large and controls)
- [ ] Visible keyboard focus on every interactive element
- [ ] Tap targets 44×44px minimum
- [ ] Real alt text on content images; empty alt on decorative ones
- [ ] Reduced motion respected
- [ ] Forms have real labels, not just placeholder text
- [ ] SVG icons, never emoji as icons

---

## 9. Shopify (store projects)

- Theme lives in GitHub, connected two-way to Shopify. Never rename a
  connected repo — it breaks the link.
- Build on an **unpublished** theme. Duplicate before any big change.
- Liquid, CSS and vanilla JS. No React, no headless, unless the brief
  says so.
- **Products vs variants:** one product per item, variants for finish
  (gold/silver) and size (chain length, ring size). Never separate
  products for colors of the same piece.
- Every variant gets its own SKU and its own image.
- Use **metafields** for structured detail (material, length, width,
  care) instead of burying it in the description.
- Sections and blocks so the owner can edit without code.
- SEO: collection pages are what rank — give each one real copy.
  Product schema with material, dimensions, price, availability.
  Canonical tags on filtered/faceted URLs.
- Cart, checkout and search must work with JavaScript failing.

---

## 10. Copy

- Say what happens: "Add to bag", not "Submit".
- The same action keeps the same word all the way through.
- Plain language, sentence case, no filler.
- Errors say what went wrong and how to fix it. They don't apologize
  and they're never vague.
- An empty state is an invitation to do something.

---

## 11. Photography and AI media

- **AI enhances a real photo. It never invents the product.** Product
  images must be the actual item being sold.
- Source photos: window light or a soft LED panel, plain background,
  consistent framing across the catalog.
- Metal and reflective pieces need **diffused** light, or you get
  hotspots that read as part of the shape.
- Consistency across the catalog matters more than any single great
  image: same lighting direction, same color temperature, one grading
  pass at the end.
- AI is fine for scenes, backgrounds and lifestyle. Not for the main
  product shot.
- Written consent before using anyone's face or voice. Keep the record.

---

## 12. Before calling it done

- [ ] Checked at 375 / 768 / 1024 / 1440
- [ ] Contrast checked, not eyeballed
- [ ] Keyboard-only pass: can you reach and use everything?
- [ ] Reduced-motion pass
- [ ] Hero loads fast; nothing above the fold is lazy-loaded
- [ ] No placeholder text, no unverified claims, no fake proof
- [ ] Every spacing value maps to the scale
- [ ] No raw hex codes in components
- [ ] Remove one thing that isn't earning its place
