---
name: Ledger
description: A private reference edition of your own taste — a ranking you can audit line by line.
colors:
  paper: '#f1ece2'
  paper-sunk: '#e8e2d5'
  paper-raised: '#f7f3ea'
  ink: '#1a1a1a'
  ink-quiet: '#55534e'
  ink-faint: '#7d7a72'
  rule: '#b3aea2'
  rule-faint: '#cdc8bb'
  rubric: '#c23a2a'
  rubric-ink: '#a32a1c'
  rubric-wash: '#f3e3df'
  on-rubric: '#fdfbf6'
typography:
  display:
    fontFamily: "'Libre Caslon Text', 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif"
    fontSize: 'clamp(2rem, 1.3rem + 3vw, 3.4rem)'
    fontWeight: 400
    lineHeight: 1.06
    letterSpacing: '-0.018em'
  title:
    fontFamily: "'Libre Caslon Text', 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif"
    fontSize: 'clamp(1.4rem, 1.1rem + 1.3vw, 2rem)'
    fontWeight: 400
    lineHeight: 1.16
    letterSpacing: '-0.012em'
  subtitle:
    fontFamily: "'Libre Caslon Text', 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif"
    fontSize: '1.125rem'
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: '-0.006em'
  body:
    fontFamily: "'Libre Caslon Text', 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif"
    fontSize: '1rem'
    fontWeight: 400
    lineHeight: 1.62
    letterSpacing: 'normal'
  apparatus:
    fontFamily: "'Libre Franklin Variable', 'Libre Franklin', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: '0.6875rem'
    fontWeight: 550
    lineHeight: 1.3
    letterSpacing: '0.13em'
  note:
    fontFamily: "'Libre Caslon Text', 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif"
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 'normal'
  figure:
    fontFamily: "'Libre Franklin Variable', 'Libre Franklin', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: '1rem'
    fontWeight: 500
    letterSpacing: '-0.01em'
  machine:
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace"
    fontSize: '0.8125rem'
    fontWeight: 400
    letterSpacing: '-0.01em'
rounded:
  none: '0px'
spacing:
  s1: '0.25rem'
  s2: '0.5rem'
  s3: '0.75rem'
  s4: '1rem'
  s5: '1.5rem'
  s6: '2rem'
  s7: '3rem'
  s8: '4.5rem'
components:
  button-primary:
    backgroundColor: 'transparent'
    textColor: '{colors.rubric-ink}'
    typography: '{typography.apparatus}'
    rounded: '{rounded.none}'
    padding: '0.55rem 1.1rem'
    height: '2.5rem'
  button-primary-hover:
    backgroundColor: '{colors.rubric-wash}'
    textColor: '{colors.rubric-ink}'
  button-primary-active:
    backgroundColor: '{colors.rubric}'
    textColor: '{colors.on-rubric}'
  button-default:
    backgroundColor: 'transparent'
    textColor: '{colors.ink}'
    typography: '{typography.apparatus}'
    rounded: '{rounded.none}'
    padding: '0.55rem 1.1rem'
    height: '2.5rem'
  button-default-hover:
    backgroundColor: '{colors.rubric-wash}'
    textColor: '{colors.ink}'
  button-default-active:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.paper}'
  button-quiet:
    backgroundColor: 'transparent'
    textColor: '{colors.ink}'
    typography: '{typography.apparatus}'
    rounded: '{rounded.none}'
    padding: '0.55rem 0.5rem'
  input:
    backgroundColor: '{colors.paper-raised}'
    textColor: '{colors.ink}'
    rounded: '{rounded.none}'
    padding: '0.55rem 0.7rem'
    height: '2.5rem'
  entry:
    backgroundColor: 'transparent'
    textColor: '{colors.ink}'
    rounded: '{rounded.none}'
    padding: '0.75rem 0.5rem'
  panel:
    backgroundColor: '{colors.paper-raised}'
    textColor: '{colors.ink}'
    rounded: '{rounded.none}'
    padding: '1rem'
  panel-sunk:
    backgroundColor: '{colors.paper-sunk}'
    textColor: '{colors.ink}'
    rounded: '{rounded.none}'
    padding: '1rem'
  tag:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-quiet}'
    rounded: '{rounded.none}'
    padding: '0.1rem 0.4rem'
  tag-rubric:
    backgroundColor: 'transparent'
    textColor: '{colors.rubric-ink}'
    rounded: '{rounded.none}'
    padding: '0.1rem 0.4rem'
  score-mark-explicit:
    textColor: '{colors.ink}'
    typography: '{typography.figure}'
  score-mark-computed:
    textColor: '{colors.ink-quiet}'
    typography: '{typography.figure}'
---

<!--
  FORM: rw-centre-rail-reference-setting — dealt challenger, fused and built over
  grounded candidate 5 (Consumer Guide newsprint column), beaten on product
  clarity. Staging: spatial-navigation-transit-stack, fused into the rail.
  Mode: operate. Seed key fe9e53d3, index 5.
  This DESIGN.md was recorded from the shipped build (src/app.css is the authority),
  not from the plan. Where the build diverged from the direction contract, the
  build won and the prose says so.
-->

# Design System: Ledger

## Overview

**Creative North Star: "The Reference Edition"**

Ledger is a private reference edition of the reader's own taste — the kind of iron-set, hairline-ruled printed catalogue where every entry has a grade in the margin and every computed number can be traced to the evidence that produced it. It refuses the two shapes this category always ships: the dark album-tile grid and the popularity chart it borrows from. There are no tiles, no artwork bleeds, no glow. There is paper, ink, and rules, and one vermilion the compositor uses sparingly — the rubric — to mark what matters.

The world runs on exactly three values: **iron ink** on **unbleached paper**, with a single **rubric vermilion** that never appears as a large fill. State is _printed, not shaded_: a control is a hairline at rest, filled when pressed, bracketed on focus, and struck through when spent. Depth is tonal, not lifted — three weights of paper (sunk, base, raised) and a hairline rule do the work a shadow would do elsewhere. The signature object is the **rail**: a ruled spine with cut detents that a judgement is _seated_ into and stays lit where it was left. The same object recurs at every scale — the rating control, the work queue, the section navigation, even the switch and the slider are the rail, shrunk.

Type is a two-family printed pairing: a Caslon-style serif for everything read (short measure, wide annotation margin, the way a reference edition hangs its apparatus) and a Franklin-style grotesque set as small-caps for the _apparatus_ — the labels, keys, weights and provenance stamps. Numbers are set in tabular figures so columns of grades align. The dark theme is not an inverted page; it is a **proof pull on black**, where ink becomes the ground, paper becomes the mark, and the rubric is lifted just enough to still read.

**Key Characteristics:**

- Three values only: iron ink, unbleached paper, one rubric vermilion (used on ≤10% of any surface).
- No corner radius anywhere; no shadows; no gradient _fills_ as surface or atmosphere.
- Every border, detent and bracket is drawn at one device pixel by a ruling engine (`--hairline` steps 1px / 0.5px / 0.34px across 1×/2×/3× displays).
- State is a printed mark — hairline at rest, filled when pressed, bracketed on focus, struck when spent.
- The rail is the one repeated object: rating, queue, navigation, switch and slider are all the same spine with cuts.
- Explicit judgements and computed rollups are always visibly different marks; the two are never conflated.

## Colors

A three-value press: one ink, one paper (in three weights), and one rubric accent that is rationed. Neutrals are warm greys pulled from the ink and paper, never pure black or pure white.

### Primary

- **Rubric Vermilion** (`#c23a2a`, `--rubric`): the single accent. Reserved for _marks and fills_ only — the inked rail, the seated detent, the register crosshair, the focus bracket, a filled primary button. It is never a large calm surface; its rarity is the point. On dark it lifts to `#e0604a`.
- **Rubric Ink** (`#a32a1c`, `--rubric-ink`): the darkened text cut of the accent, used wherever the rubric must be _read_ as small type (small-caps labels, links on hover, the "your rating" mark) so it clears 4.5:1 on paper. On dark it lifts to `#ef8a76`.
- **On-Rubric** (`#fdfbf6`, `--on-rubric`): the only foreground permitted on a solid rubric fill; the paper-white that clears 4.5:1 against `--rubric`. On dark it is `#14140f`.
- **Rubric Wash** (`#f3e3df`, `--rubric-wash`): the faintest tint of the accent, for hover beds and text selection only — never for text.

### Neutral — Ink

- **Iron Ink** (`#1a1a1a`, `--ink`): body text, headlines, the strongest rules. Not black; a warm near-black. On dark, ink is the _ground_ (`#14140f`) and this token becomes the bone text (`#ece7da`).
- **Quiet Ink** (`#55534e`, `--ink-quiet`): secondary text, apparatus labels, sub-lines. Under high-contrast it collapses up to full ink.
- **Faint Ink** (`#7d7a72`, `--ink-faint`): fine print, disabled text, provenance caveats, plate initials.

### Neutral — Paper & Rules

- **Unbleached Paper** (`#f1ece2`, `--paper`): the page. Also the runtime `theme-color`.
- **Sunk Paper** (`#e8e2d5`, `--paper-sunk`) / **Raised Paper** (`#f7f3ea`, `--paper-raised`): the two tonal steps that stand a panel, input or plate off the page without a shadow.
- **Rule** (`#b3aea2`, `--rule`) / **Faint Rule** (`#cdc8bb`, `--rule-faint`): the two hairline weights every border, divider and detent is drawn in.

### Named Rules

**The One Rubric Rule.** There is exactly one accent and it is rationed to marks and fills — never a large calm surface, never a body of text. If a screen looks like it has two accent colours, one of them is wrong.

**The Read-vs-Mark Rule.** `--rubric` is for things drawn (rails, detents, brackets, fills); `--rubric-ink` is for things read (small-caps, links, figures). Never set small type in `--rubric`, and never set a fill in `--rubric-ink`.

**The Warm-Neutral Rule.** No pure `#000` or `#fff`. Ink is `#1a1a1a`, paper is `#f1ece2`; every grey is pulled from those two so the page reads as printed stock, not screen.

## Typography

**Display / Reading Font:** Libre Caslon Text (falls back to Iowan Old Style, Palatino, Georgia, serif)
**Apparatus Font:** Libre Franklin (variable; falls back to system-ui grotesques)
**Machine Font:** ui-monospace system stack (SF Mono, Menlo, Consolas)

**Character:** A high-contrast old-style serif carries everything meant to be read; a grotesque set in tight, wide-tracked small-caps carries everything that _labels, keys or annotates_. The serif is warm and literary at a short measure; the grotesque is clinical apparatus. They never trade jobs. **Build note:** both faces are bundled and self-hosted — `src/main.ts` imports `@fontsource/libre-caslon-text` (400, 400-italic, 700) and `@fontsource-variable/libre-franklin` ahead of `app.css`, so Vite emits the woff2/woff files with the build and nothing is fetched from a third party at runtime. The declared stacks still carry a serif and grotesque fallback, but the named faces are the normative value.

### Hierarchy

- **Display** (`.display`, serif 400, `clamp(2rem, 1.3rem + 3vw, 3.4rem)`, line-height 1.06, tracking −0.018em, balanced wrap): page titles ("The desk", "The queue") and the item under judgement.
- **Title** (`.title`, serif 400, `clamp(1.4rem, 1.1rem + 1.3vw, 2rem)`, line-height 1.16, tracking −0.012em): section heads inside a sheet.
- **Subtitle** (`.subtitle`, serif 400, 1.125rem, line-height 1.4): a lead line under a title.
- **Body** (`.prose` / `body`, serif 400, 1rem, line-height 1.62): running text, held to a **68ch measure** (`--measure`).
- **Note** (`.note`, serif 400, 0.875rem, line-height 1.5, quiet ink): secondary prose, reasons, captions; `.note--small` (0.8125rem, faint ink) for fine print.
- **Apparatus** (`.apparatus`, grotesque 550, 0.6875rem, tracking **0.13em**, UPPERCASE small-caps, quiet ink): every label, key, section eyebrow and provenance stamp. `.apparatus--rubric` recolours it to rubric-ink. Never used for running text.
- **Figure** (`.figure`, grotesque, **tabular lining numerals**): all grades, counts and weights, so columns align; `.figure--large` (1.5rem, 600) when the number is the point.
- **Machine** (`.machine`, mono, 0.8125rem): raw identifiers and diagnostic values only.

### Named Rules

**The Apparatus Rule.** Small-caps grotesque is for apparatus only — labels, keys, weights, provenance. If a sentence is meant to be _read_, it is set in the serif, never in tracked small-caps.

**The Tabular Figure Rule.** Every number that could sit in a column — grades, ranks, counts, weights — is set in tabular lining figures (`.figure`) so it aligns down the page. Prose numerals stay in the serif.

**The Two-Mark Rule.** An _explicit_ grade (a judgement the reader seated) and a _computed_ grade (a rollup) must never look alike: explicit is upright ink, computed is set in _italic_ quiet ink. Conflating them is the one thing the type system forbids.

## Layout

A fixed **centre rail + sheet** shell. The navigation rail (`--rail-w`, 15rem) is a sticky printed contents column on the left at ≥60rem; below that it becomes a fixed bottom bar carrying the same five primary stops so muscle memory survives the reflow. The sheet is the working page, padded `--s6` (2rem) desktop, `--s4`–`--s5` on phones.

The signature page layout is the **setting**: a short reading measure twinned with a **wide annotation margin** (`--margin-col`, 13rem) that hangs coverage, sync state and apparatus where a printed reference edition would put its marginalia. The margin is sticky on wide screens and drops below the measure, separated by a hairline, under 68rem. The desk and queue both build their first viewport as _twinned columns either side of a vermilion rail_ that runs the full height.

Spacing is a **named set, not a generative scale**: `--s1`…`--s8` (0.25rem → 4.5rem, roughly a 1.5× rhythm loosening at the top). Density is token-only: `[data-density='compact']` tightens `--s4`–`--s8`; the default `cozy` is the base set. Breakpoints in use: 48rem (phone → desk), 60rem (bottom bar → side rail), 64rem / 68rem / 76rem (twin-column and margin reflows).

## Elevation & Depth

**This system has no shadows.** Depth is entirely tonal and ruled. A surface is lifted or sunk by stepping between the three paper weights — `--paper-sunk` < `--paper` < `--paper-raised` — and bounded by a hairline `--rule`, sometimes marked at the corners by rubric **corner marks** (`.corner-marks`, 7px rubric brackets on two opposing corners). The one `box-shadow` in the codebase is not elevation: it is the `.bracketed` focus treatment, which uses two offset shadows to _draw_ square rubric brackets standing off the element, the way a compositor sets brackets around a correction. There is no ambient or drop shadow vocabulary to catalogue.

### Named Rules

**The Printed-Depth Rule.** Never reach for a shadow. To lift something, change its paper weight and rule it; to mark it as focused or special, bracket it or set corner marks. Depth is printed, not cast.

## Shapes

**Zero radius, everywhere.** No element in the system has a rounded corner; `border-radius: 0` is set explicitly on the four native controls (button, input, slider thumb) that would otherwise inherit a UA radius, and nothing else introduces one. The form language is rectilinear and ruled: hairline borders, ruled dividers (`.rule`, `.divider-dotted`), and the recurring **register crosshair** (a vermilion cross-in-a-circle, `RegisterMark`) that stands as the mark the whole world is set against — printed on ruled section breaks, on empty plates, and in the masthead.

Borders come in two hairline weights (`--rule`, `--rule-faint`) at a single device pixel. Corners are either plain hairline joins or marked with 7px rubric **corner brackets**; they are never softened. Artwork is the one raster element, and it is **tipped in like a plate** — bordered, padded 3px on sunk paper, never bled to an edge and never allowed to set the page's colour.

### Named Rules

**The No-Radius Rule.** Nothing rounds. If a component needs a corner, it is a right angle drawn at one hairline. Pills, rounded cards and capsule toggles belong to another product's world.

## Components

### Buttons

- **Shape:** rectangle, zero radius, hairline border; small-caps grotesque label (0.6875rem, tracking 0.13em, UPPERCASE), min-height 2.5rem, padding `0.55rem 1.1rem`.
- **Default:** transparent on a `--ink` hairline. **Hover** beds it in `--rubric-wash`. **Active** is a _filled impression_ — solid `--ink`, `--paper` text — the way a hand-press leaves ink.
- **Primary** (`.btn--primary`): the border and label become the rubric (`--rubric` edge, `--rubric-ink` text). Hover washes; **active / pressed fills solid `--rubric`** with `--on-rubric` text. Primary is also the only button that ever appears as a full rubric bar (the desk's "Seat a grade", which runs its rubric edge straight into the rail with its own bracketed detent).
- **Quiet** (`.btn--quiet`): borderless until hover, when a `--rule` hairline appears. **Small** (`.btn--small`) drops to 2rem / 0.625rem. **Disabled** goes faint ink on a faint rule.

### Inputs / Fields

- **Style:** `--paper-raised` fill, `--rule` hairline, zero radius, serif input text (0.9375rem), min-height 2.5rem. Selects render their own drawn caret (two linear-gradient triangles, grotesque 0.8125rem). Hover darkens the border to `--ink-quiet`.
- **Focus:** _bracketed, not glowing._ The global focus-visible ring is a 1px `--rubric` outline offset 3px; `.bracketed` elements instead print two rubric square-brackets standing 4px off either side. No glow, no colour-fill, no radius.
- **Checks & radios** (`.check`): a hairline box; checked prints a solid rubric square, and a _radio_ checked prints a rubric **cut** (a 3px bar) seated across the box rather than a dot — no radius even here.
- **Switch & slider:** both are the rail shrunk — a two-stop hairline track with a rubric cut riding along it, never the browser's pill or knob.

### Cards / Panels / Containers

- **Corner Style:** zero radius; hairline `--rule` border, optionally marked with rubric **corner brackets** (`.corner-marks`).
- **Background:** `--paper-raised` (`.panel`) or `--paper-sunk` (`.panel--sunk`); `.panel--rubric` swaps the border to the accent.
- **Depth Strategy:** tonal paper + rule only — see Elevation & Depth. No shadow.
- **Internal Padding:** `--s4` (1rem).

### Catalogue Entry (`.entry` / EntryRow)

The list primitive — **a ruled catalogue line, not a card.** A three-column grid: a right-aligned rank position _or_ a tipped-in plate on the left, name + meta in the measure, a `ScoreMark` grade on the right, divided from the next by a faint hairline. Hover beds the row in `--paper-raised`; the current row washes rubric (`aria-current`).

### Score Mark (signature)

The margin grade, and the enforcer of the Two-Mark Rule. An **explicit** rating prints upright in `--ink`; a **computed** rollup prints in _italic_ `--ink-quiet`; a **blended** value reads as computed; an absent one is a faint em-dash. A provisional computed score (below coverage minimum) appends "· provisional" in apparatus. Explicit and computed are never allowed to look the same.

### The Rail (signature)

The world's core object — one physical spine with detents cut by the current rating scale. A judgement is **seated** into a detent and the rail _inks up to that level_ (a filled bar, not a floating dot), staying lit where it was left. It is one tab stop: arrows walk the detents, digits seat a known verdict, Home/End reach the ends; it stands up on wide screens and lies down under 48rem, carrying its ARIA orientation with it. The same grammar recurs as the **QueueSpine** (work as lit detents, struck when served), the **NavRail** centre spine, and the **DuelStation** beam (two pans on a fulcrum that tips on choice). Below prefers-reduced-motion, the ink and cut transitions are dropped but the marks are unchanged.

### Tags & Stamps

- **Tag** (`.tag`): hairline-bordered rectangle, grotesque 0.6875rem, quiet ink; `.tag--rubric` switches border and text to the accent. No fill, no radius.
- **Specimen stamp** (`SpecimenNote`): a sunk-paper, ruled block that keeps demo/invented data honest wherever the work happens — "Specimen catalogue" in rubric small-caps.

### Navigation (NavRail)

A sticky printed **contents column** on the left (masthead register mark + "Ledger" wordmark, five primary stops, a hairline rule, then secondary stops, then a sync-state line). The current stop is _inked_, marked by a 2px rubric border-left — served, not tinted. Under 60rem it reflows to a fixed bottom bar of the five primary stops, the current one marked by a rubric border-top, the queue count hung clear of its icon.

## Do's and Don'ts

### Do:

- **Do** ration the rubric to marks and fills, ≤10% of any surface; reach for `--rubric-ink` the moment it must be _read_ as small type, and `--on-rubric` as the only foreground on a solid rubric fill.
- **Do** convey depth with the three paper weights and a hairline rule (optionally corner brackets), never a shadow.
- **Do** draw every border, detent and bracket at `--rule-weight` / `--hairline` (1px, stepping to 0.5px and 0.34px on 2× and 3× displays).
- **Do** keep explicit grades upright-ink and computed grades italic-quiet, always visibly distinct.
- **Do** set apparatus (labels, keys, weights, provenance) in tracked grotesque small-caps, and everything read in the Caslon serif at a ≤68ch measure with its annotation margin.
- **Do** set every number that could column-align in tabular lining figures (`.figure`).
- **Do** treat every rating/selection control as the rail — a spine with cuts, seated and lit — including switches and sliders.

### Don't:

- **Don't** round anything. Zero radius is absolute; no pills, no capsule toggles, no rounded cards.
- **Don't** add shadows, glows or glassmorphism; the one `box-shadow` in the system draws focus _brackets_, not elevation.
- **Don't** introduce a second accent, tint large surfaces in the rubric, or set small text in `--rubric` (use `--rubric-ink`).
- **Don't** use `#000` or `#fff`; pull every neutral from the warm ink/paper pair.
- **Don't** let album artwork bleed, fill a background, or set the page's colour — tip it in as a bordered plate, and print initials on a registration crosshair when it is missing or turned off.
- **Don't** ban gradients as a drawing tool: this world uses them natively to _draw_ (the select caret, the barely-there `body::before` paper tooth). What is prohibited is gradient _fills as surface or atmosphere_, not the two-stop gradient used to render a mark.
- **Don't** set running prose in the grotesque small-caps, or conflate an explicit judgement with a computed one.
