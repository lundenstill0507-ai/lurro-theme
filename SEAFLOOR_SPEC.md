# Lurro — Seafloor Browsing Experience

**Status:** Locked direction. Build against this.
**Read alongside:** `CLAUDE.md` (build standards). `CLAUDE.md` sets quality
floors — contrast, spacing, performance, accessibility, motion restraint —
that this spec can never override. This spec sets what gets built: concept,
layout, interaction, scope, build order. Where a real conflict remains after
that split, ask rather than assume.

---

## 1. The concept in one paragraph

The Lurro homepage is the ocean. The visitor arrives at the surface, descends, and lands on the seafloor. The seafloor is the shop: real product pieces laid out in a row on the sand. Scrolling moves along the seafloor. Clicking a piece moves the camera in toward it and opens that product. Nothing floats up, nothing flies around — the visitor moves through a still world.

The point is that the browsing surface *is* the brand environment. Not a normal product grid with an ocean photo behind it.

---

## 2. Hard rules

These are not negotiable and override anything below.

1. **No AI-generated jewelry, ever.** Every piece shown is a real Lurro product, photographed or rendered from the real geometry. This holds for placeholders too — supplier photos of the actual sourced pieces are acceptable as temporary stand-ins; invented jewelry is not.
2. **Every product has a real URL.** Whatever the scene does visually, each piece must map to a genuine Shopify product page that loads on its own, is crawlable, and works when linked directly. The seafloor is a layer over real product pages, never a replacement for them.
3. **Every image slot has a fixed aspect ratio.** No layout shift when real photography replaces placeholders.
4. **It has to work without the animation.** If JavaScript fails, the motion is disabled, or the device is slow, the visitor still gets a usable product listing. The scene enhances a working shop; it is not the only way in.
5. **It must still read as a jewelry store.** A visitor who has never seen the site should understand within a few seconds that they can buy things here.

---

## 3. Layout

### Products on the seafloor

- Pieces sit in a **single row**, evenly spaced, resting on the sand. Not scattered.
- Row runs horizontally. Scrolling advances along it.
- Each piece sits in a fixed-size slot so the row stays even regardless of product shape.
- Target: 10–15 pieces at launch. The row must work at 5 and at 20.
- Spacing is generous. Crowding kills the feeling of depth.

### The environment

- Seafloor occupies the lower portion of the frame. Open water above it.
- The water above the row is the **quiet zone** — dark, low-texture, no bright light shafts, no dense particulate. Headings and UI sit there.
- Quiet zone target luminance: **0.05 relative or darker**, giving roughly 9:1 against Bone White `#F5F3ED`.
- Optional environmental anchor at the start of the row (a chest, a spilled case) to explain why jewelry is on the seafloor. One object maximum. It is set dressing, never interactive, never mistaken for a product.

### Desktop vs mobile

| | Desktop (16:9) | Mobile (9:16) |
|---|---|---|
| Row direction | Horizontal | Horizontal, fewer visible at once |
| Quiet zone | Centered, ~60% of frame width | Upper-middle, ~40–45% of frame height |
| Seafloor | Lower portion | Lower quarter |
| Pieces in view | 3–5 | 1–2 |

Mobile is not a crop of desktop. It is composed separately.

---

## 4. Interaction

### Scrolling the row

- Scroll moves the camera along the seafloor. Vertical scroll input maps to horizontal travel.
- Motion is **weighted and slightly slow**. Smooth easing, no bounce, no snap, no elastic overshoot. This single quality is what separates expensive from cheap — get it right before anything else.
- Momentum decays naturally. Never abrupt stops.
- Must work with trackpad, mouse wheel, and touch. Keyboard arrows and Tab must also move between pieces.

### Clicking a piece

**Chosen behavior: camera zoom.** The piece stays where it is on the seafloor. The camera moves in toward it.

Rejected alternative: lifting the piece up out of the sand. It reads as a video game, and invents a place for the object to float to. Do not build this.

Sequence on click:
1. Camera eases in toward the piece. Same weighted timing as the scroll.
2. Surrounding water and neighboring pieces recede — slight blur and darkening, not a hard fade.
3. Product detail appears in the water above and beside the piece: title, price, materials, size and variant selectors, add to cart.
4. Close returns the camera to the row at the same scroll position it left.

The URL must change to the real product URL when a piece opens, and the browser back button must close the detail and return to the row. This is what keeps it shareable and indexable.

### Product rotation

- Each piece has a **180° rotation sequence**, not 360°. The back of a chain is the back of a chain — nobody needs it.
- Roughly **18 frames** at 10° intervals. Half the shoot, half the payload.
- Rotation is driven by scroll position or drag once a piece is open. Never autoplay.
- Frames are pre-rendered stills, not a 3D engine.
- Sequence must be lazy-loaded. It never blocks the row from appearing.

---

## 5. The hero intro

The descent from surface to seafloor plays before the row.

- Generated ocean plates, with the logo pendant composited in separately (see hero storyboard spec).
- **Skippable.** A visible skip control from the first second.
- **Plays once per session.** Return visits within the session land straight on the seafloor.
- The final frame of the intro is visually identical to the resting state of the seafloor, so the handoff is invisible.
- If the video fails to load, the static final frame shows immediately and browsing works normally.

Until the video exists, the hero is a static dark ocean image at the correct aspect ratio. Build the row first.

---

## 6. Build order

Each stage must be independently shippable. Do not begin a stage before the one above it works.

1. **Real product pages.** Standard Shopify product template, working cart, correct URLs. Nothing visual.
2. **The row, static.** Pieces laid out on a seafloor background, no motion. Clicking navigates to the product page normally.
3. **Scroll motion.** Weighted horizontal travel along the row.
4. **Click to zoom.** Camera move, detail panel, URL change, back button.
5. **Rotation sequences.** Added per product as photography lands.
6. **Hero intro.** Once the ocean plates and pendant render exist.

Stages 1 and 2 can be built now with placeholder imagery. Stages 3 and 4 need real photography to judge properly.

---

## 7. Performance budget

- Seafloor background image: AVIF or WebP, `fetchpriority="high"`, never lazy-loaded.
- Product stills in the row: lazy-loaded below the first few visible.
- Rotation sequences: loaded only when a piece is opened.
- Total weight before the row is interactive must stay under what a mid-range phone on 4G can pull in about three seconds.
- If the frame rate drops on a test device, reduce the number of simultaneously animated elements before reducing image quality.

---

## 8. Accessibility

- `prefers-reduced-motion` disables camera travel and rotation. The row becomes a standard scrollable grid.
- Every piece is reachable and openable by keyboard.
- Every product image has real alt text describing the piece.
- Product detail must be readable by a screen reader in a sensible order, independent of visual position in the water.
- Text contrast holds at 4.5:1 minimum over whatever sits behind it. The quiet zone exists so no scrim is needed.

---

## 9. Open questions

- ~~Does the row loop endlessly or have a defined start and end?~~ **Resolved (stage 3): defined end.** The row stops at its last piece and the pin then holds for a short end dwell (a quarter of the frame's height of extra scroll) before the page scrolls on. A loop was rejected: it needs cloned slots (duplicate links and tab stops) and would have to teleport the scroll position, which is a visible snap.
- Do collections get separate seafloors, or does one row hold everything with filtering?
- What happens on the collection and search pages — do they use the scene, or standard Shopify layouts?

These can be answered after stage 2 is visible.
