# Handoff: PreciCV Resume Design Catalog (11 new designs)

## Overview
This bundle contains **11 new one-page resume designs** meant to replace/augment the current
generic ten (`classic, modern, compact, executive, elegant, technical, contemporary, minimal,
onyx, midnight`). They are grouped into five categories and engineered to your existing
architecture: one shared `TailoredCv` model, background-agnostic Light/Dark, 1-column and
2-column (`split`), a single A4 page, and 100% ATS-safe DOM order.

The designs are: **Ledger** (featured), **Index**, **Masthead**, **Marginalia**, **Panel**,
**Column Rule**, **Rail**, **Grid**, **Timeline**, **Spec Sheet**, **Mono**.

## About the design files
`PreciCV Resume Catalog.html` is a **design reference created in HTML** — a prototype showing the
intended look of every design in Light and Dark. It is **not production code to copy**. The task
is to **recreate these designs inside the existing renderer** at
`src/components/cv-renderer.tsx`, using the project's real data model and patterns. Open the file
in a browser and pan/zoom the canvas; each design has a badge id (`1a`–`1k`) you can reference.

## Fidelity
**Hi-fi** for visuals (exact hex, fonts, spacing, hierarchy are final), but **content is
deliberately placeholder** ("Full Name", "Job Title", "Company Name", "Skill 1", short lorem,
`2021 — Present`). Build each design as a **shell that renders live `TailoredCv` data** — do not
hard-code the placeholder copy.

---

## Where this lives in the codebase

| Concern | Location |
|---|---|
| Template registry + `CvRenderer` | `src/components/cv-renderer.tsx` — the `TEMPLATES: Record<CvTemplate, TemplateDef>` map and the render body |
| Template id union + gallery list | `src/lib/types.ts` — `CvTemplate`, `CV_TEMPLATES` |
| Data model (the shared shape) | `src/lib/types.ts` — `TailoredCv` = `{ contact, headline, summary, sections[], skills[] }`, where `sections[].items[]` = `{ primary, secondary, meta, bullets[] }` |
| Fonts (already wired) | `cv-renderer.tsx` `FONT` map → CSS vars: `serif` (Source Serif 4), `playfair` (Playfair Display), `lora` (Lora), `space` (Space Grotesk), `archivo` (Archivo), `mono` (IBM Plex Mono), `inter` (Inter), `figtree` (Figtree) |
| Theme neutrals | `cv-renderer.tsx` `PALETTE.light` / `PALETTE.dark` |

**Every font these designs use already exists in the `FONT` map — no new font loading required.**

---

## The one architectural change you need

Today `TemplateDef` only varies **typeface, accent, spacing, and `sectionVariant`
(`underline | chip | plain`)** over a single hard-coded body layout. That is exactly why the
current ten feel generic. These new designs introduce **structural layout**, so add a layout
dimension:

1. Add a `layout` field to `TemplateDef`:
   ```ts
   type CvLayout =
     | "linear"      // classic single flow (existing behavior)
     | "date-rail"   // fixed left date column (Ledger)
     | "numbered"    // 01/02/03 section headers (Index)
     | "masthead"    // full-width header band + hairline section rules (Masthead)
     | "marginalia"  // left gutter holds section labels (Marginalia)
     | "band"        // filled header banner, body below (Panel)
     | "two-col"     // centered masthead + center-ruled two columns (Column Rule)
     | "rail"        // tinted left sidebar + main (Rail)
     | "grid"        // modular hairline grid + skills tag-grid (Grid)
     | "timeline"    // vertical ruled spine on experience (Timeline)
     | "readme";     // // comment section markers + boxed skill stack (Spec Sheet, Mono)
   ```
2. In `CvRenderer`, branch the **body** on `t.layout`. **Reuse everything you already have**:
   `Editable`, `renderSection`, `renderSkills`, the `theme`/`PALETTE` mapping, `split`, the
   dynamic page-fill effect, the section de-dupe, and the print CSS. Each layout is a different
   arrangement of the *same* blocks — not a new data path.
3. Keep each design **background-agnostic**: read colors from `PALETTE[theme]` for neutrals and
   from a per-template `accent[theme]` for the signature color (same pattern as today).

### Non-negotiable constraints to preserve
- **ATS-safe DOM order.** Visual columns/rails/bands/sidebars are **CSS only** (grid/flex). The
  source order must always read logically: `name → headline → contact → summary → experience →
  skills → education`. **Do not** build a separate hidden text layer, and **do not** use tables or
  absolute positioning for content flow (the one exception: the small timeline **dot** in
  Timeline is decorative and may be absolutely positioned — the text next to it stays in flow).
  For `rail`/`band`/`sidebar` designs, route *supporting* sections (skills, education,
  certifications, languages) into the aside and *narrative* sections (summary, experience,
  projects) into main, but keep the source order sensible.
- **Single A4 page** (`210mm × 297mm`) + the existing dynamic page-fill.
- **`split` (2-column)** must work for every design — see each spec's "2-col" note.
- **Inline editing** (`Editable`, workspace only) must still wrap every text node.
- **Metrics auto-emphasis** (see below).

### Metric emphasis helper (view-layer only)
Several designs bold numeric tokens in the accent color with tabular figures. Add a render-time
helper — **never mutate `cv`**:
```ts
// wraps 32%, $4M, 4, 18%, 3x … in <strong style={{color: accent, fontVariantNumeric:'tabular-nums'}}>
function withMetrics(text: string, accent: string): React.ReactNode { /* regex split */ }
```
Apply it inside bullet and summary rendering only. Regex suggestion:
`/(\$?\d[\d.,]*\+?%?|\d+x)/g`. Skills are **never** rated — no bars/stars/percentages on skills.

### Hard nos (client requirement)
No profile photos · no skill-rating charts (bars/stars/%) · no heavy icons/SVG that break text
extraction · keep accents muted and accessible in both themes (no neon / loud backgrounds).

---

## Design tokens

**Neutrals** (align these to the existing `PALETTE`; the catalog used slightly warmer values you
can adopt or map):

| Token | Light | Dark |
|---|---|---|
| page background | `#ffffff` | `#171c24` |
| text | `#1a1a1a` | `#e8ecf1` |
| subtle (meta/company) | `#6b7280` | `#9aa5b3` |
| hairline rule | `#e6e5e0` | `rgba(255,255,255,0.13)` |

**Per-design signature accent** (`accent: { light, dark }`):

| id | Design | Category | Fonts (FONT keys) | accent.light | accent.dark |
|---|---|---|---|---|---|
| 1a | **Ledger** ★ | Data-Forward | `serif` name · `inter` body · `mono` dates/labels | `#1f6b57` | `#86cea6` |
| 1b | Index | Data-Forward | `archivo` head · `inter` body · `space` numerals | `#33507a` | `#9fb6da` |
| 1c | Masthead | Editorial | `playfair` name · `lora` body · `archivo` labels | `#8a3a30` | `#d99a8f` |
| 1d | Marginalia | Editorial | `serif` body · `inter` labels | `#3a4a63` | `#9fb3d1` |
| 1e | Panel | Executive | `playfair` name · `inter` body · `mono` contact | `#8a6a24` | `#d4af6a` |
| 1f | Column Rule | Executive | `serif` name · `inter` body | `#3f4c5a` | `#c3ccd8` |
| 1g | Rail | Modern | `figtree` all · `mono` dates | `#2f6b4f` | `#86cea6` |
| 1h | Grid | Modern | `archivo` head · `inter` body · `mono` meta | `#2f5c8a` | `#93b4e6` |
| 1i | Timeline | Modern | `space` head · `inter` body | `#6d4d78` | `#c1a6cc` |
| 1j | Spec Sheet | Technical | `space` name · `inter` body · `mono` labels | `#2f6b4f` | `#6ee7b7` |
| 1k | Mono | Technical | `mono` all · `inter` long prose | `#9a6b12` | `#d9a441` |

Panel's header band: `#232a34` on Light (reversed text); on Dark an elevated panel `#212a36` with
a `2px` bottom border in the gold accent. Rail's sidebar tint: `#f4f6f2` (Light) / `#1e242e`
(Dark). Skill chips use the accent at low opacity or a hairline border — never a filled loud block.

---

## Per-design specs
For exact pixel values, open `PreciCV Resume Catalog.html` and inspect the matching badge id. Each
design already appears there in **both Light and Dark**; the featured one is built in all four
states.

### 1a · Ledger  ★ featured — build this first
- **Vibe / audience:** a financial ledger for a career; data, analytics, finance, ops, research.
- **Layout (`date-rail`):** full-width masthead (`serif` name, `inter` headline, `mono` contact,
  hairline rule). Body is a CSS grid `grid-template-columns: 60px 1fr`. **Section headers span
  both columns** (`grid-column: 1 / -1`) with a top hairline. Each experience/education **item**
  puts its dates in the left rail cell (`mono`, right-aligned, `tabular-nums`) and content in the
  right cell. Summary and skills span full width.
- **2-col (`split`):** drop the rail; dates go inline-right on each item; sections balance across a
  center hairline (mirror the existing `splitBody` logic).
- **Skills:** hairline-bordered tag chips. **Metrics:** `withMetrics` in accent + tabular-nums.
- **ATS:** grid is presentational; DOM stays label → dates → title → company → bullets.
- **Why featured:** boldest concept that ships unchanged, maximal 5-second scannability, refined.

### 1b · Index — Data-Forward
Numbered `01 / 02 / 03` section headers (`space` numerals in accent) over hairline rules;
`archivo` uppercase titles, `inter` body, company name in accent, right-aligned tabular dates,
slim outlined skill tags. **1-col** baseline grid; **2-col** flows numbered sections into two
even columns.

### 1c · Masthead — Editorial
`playfair` name with contact set on the baseline at right; a `2px` accent rule under the masthead;
`archivo` small-caps section titles that ride a hairline running to the margin; `lora` body,
italic company lines; skills as one **inline dot-separated line** (no chips). **1-col** by nature;
**2-col** justifies the body beneath the masthead.

### 1d · Marginalia — Editorial
`serif` throughout, `inter` for labels. A left gutter (`grid-template-columns: 88px 1fr`,
`row-gap`) holds **right-aligned section labels** beside their content; no rules, whitespace is the
divider; muted slate-blue accent, inline dot skills. **2-col / narrow:** labels fold above each
section.

### 1e · Panel — Executive
Full-bleed header **banner** (`#232a34`, reversed text; on Dark an elevated `#212a36` panel with a
gold bottom border). Body below: gold small-caps section labels over hairlines, `inter` body,
softly-filled skill chips, `mono` contact in the banner. **2-col** balances experience vs
education+skills below the banner.

### 1f · Column Rule — Executive
Centered masthead (`serif` name, tracked uppercase headline, `mono` contact), full-width rule,
full-width summary, then a **center-ruled two-column** body (`display:flex` + `border-left`).
Neutral slate accent, underlined caps labels, slim tags. Built for **2-col**; folds to one column.

### 1g · Rail — Modern
Full-width name header, then `display:flex`: a **tinted left sidebar** (`152px`: contact, skills as
tinted chips, education) + wide main (summary, experience). `figtree` throughout, brand-green
accent. **1-col / narrow:** the rail unstacks above the main column. *(Keep DOM order sensible —
see ATS note.)*

### 1h · Grid — Modern
Swiss modular grid: header (big `archivo` name + `mono` contact block), then sections separated by
**top hairlines**; a foot module is a two-cell grid `education | skills`, where skills is a
**multi-column tag grid** (`grid-template-columns: 1fr 1fr`). Cobalt accent, tabular dates. Modules
restack in one column.

### 1i · Timeline — Modern
Experience becomes a **vertical ruled spine**: a container with `border-left`, each role a
relatively-positioned block with an absolutely-positioned **ringed dot** (`background: page-bg;
border: 2px accent`) sitting on the line; dates `mono` tabular. Summary/education/skills sit
outside the spine. `space` headings, plum accent. In 2-col the spine stays with experience.

### 1j · Spec Sheet — Technical
README aesthetic: `// SUMMARY`, `// EXPERIENCE`, `// STACK` section markers (`mono`, accent);
`space` name, `inter` body; company as `@ Company Name`; skills in a **boxed panel** of `mono`
chips; teal accent, tabular metrics. **2-col** splits experience from stack+education.

### 1k · Mono — Technical
Pure terminal: `mono` everywhere (body may relax to `inter` for long prose), muted-amber accent,
an amber underline on the name, `#` section markers, `@ company` + tabular dates, bullets prefixed
with an accent `-`, skills as `[bracketed]` inline tokens. Strict single column (2-col available
but reads best full-width).

---

## Suggested implementation order
1. Wire the `layout` field + branch scaffold; keep `"linear"` = current behavior so nothing breaks.
2. Add the `withMetrics` helper.
3. Implement **1a Ledger** end-to-end (Light, Dark, `split`, print/A4, `Editable`). Use it to prove
   the branch pattern.
4. Roll out the rest by category. Add each id to `CV_TEMPLATES` + `CvTemplate` and to the picker
   metadata (`CV_TEMPLATE_META`).
5. Verify each in Light **and** Dark, **1-col and 2-col**, that it holds one A4 page, and that
   copying the rendered text yields a clean linear resume (ATS check).

## Files in this bundle
- `PreciCV Resume Catalog.html` — self-contained visual reference (all 11 designs, Light + Dark;
  featured design in all four states). Pan/zoom canvas; badge ids `1a`–`1k`.
- `README.md` — this document.
