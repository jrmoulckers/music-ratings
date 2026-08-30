---
name: Music Ratings
description: A private, auditable record of what you actually think of your own music.
colors:
  surface: '#f5f5f7'
  surface-sunk: '#eaeaee'
  surface-raised: '#ffffff'
  ink: '#17171b'
  ink-quiet: '#54545e'
  ink-faint: '#7a7a86'
  border: '#d5d5dc'
  border-faint: '#e6e6eb'
  scrim: 'rgb(0 0 0 / 0.45)'
  accent: '#cf3f26'
  accent-ink: '#b23319'
  accent-wash: '#fbeae6'
  on-accent: '#ffffff'
typography:
  display:
    fontFamily: "'Libre Franklin Variable', 'Libre Franklin', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: 'clamp(2rem, 1.3rem + 3vw, 3.4rem)'
    fontWeight: 400
    lineHeight: 1.06
    letterSpacing: '-0.018em'
  title:
    fontFamily: "'Libre Franklin Variable', 'Libre Franklin', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: 'clamp(1.4rem, 1.1rem + 1.3vw, 2rem)'
    fontWeight: 400
    lineHeight: 1.16
    letterSpacing: '-0.012em'
  subtitle:
    fontFamily: "'Libre Franklin Variable', 'Libre Franklin', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: '1.0625rem'
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: '-0.006em'
  body:
    fontFamily: "'Libre Franklin Variable', 'Libre Franklin', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: '1rem'
    fontWeight: 400
    lineHeight: 1.62
    letterSpacing: 'normal'
  label:
    fontFamily: "'Libre Franklin Variable', 'Libre Franklin', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: '0.6875rem'
    fontWeight: 550
    lineHeight: 1.3
    letterSpacing: '0.13em'
  note:
    fontFamily: "'Libre Franklin Variable', 'Libre Franklin', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 'normal'
  figure:
    fontFamily: "'Libre Franklin Variable', 'Libre Franklin', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: '1rem'
    fontWeight: 500
    letterSpacing: '-0.01em'
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace"
    fontSize: '0.8125rem'
    fontWeight: 400
    letterSpacing: '-0.01em'
  scale:
    micro: '0.5625rem'
    tick: '0.625rem'
    label: '0.6875rem'
    fine: '0.75rem'
    small: '0.8125rem'
    note: '0.875rem'
    compact: '0.9375rem'
    base: '1rem'
    lead: '1.0625rem'
    subhead: '1.125rem'
    step1: '1.25rem'
    step2: '1.375rem'
    step3: '1.5rem'
    step4: '1.75rem'
    step5: '1.875rem'
    step6: '2rem'
    step7: '2.75rem'
    step8: '3rem'
    step9: '3.4rem'
rounded:
  sm: '3px'
  md: '5px'
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
    backgroundColor: '{colors.accent}'
    textColor: '{colors.on-accent}'
    typography: '{typography.label}'
    rounded: '{rounded.sm}'
    padding: '0.55rem 1.1rem'
    height: '2.5rem'
  button-primary-hover:
    backgroundColor: '{colors.accent-ink}'
    textColor: '{colors.on-accent}'
  button-default:
    backgroundColor: 'transparent'
    textColor: '{colors.ink}'
    typography: '{typography.label}'
    rounded: '{rounded.sm}'
    padding: '0.55rem 1.1rem'
    height: '2.5rem'
  button-default-hover:
    backgroundColor: '{colors.accent-wash}'
    textColor: '{colors.ink}'
  button-default-active:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.surface}'
  button-quiet:
    backgroundColor: 'transparent'
    textColor: '{colors.ink}'
    typography: '{typography.label}'
    rounded: '{rounded.sm}'
    padding: '0.55rem 0.5rem'
  input:
    backgroundColor: '{colors.surface-raised}'
    textColor: '{colors.ink}'
    rounded: '{rounded.sm}'
    padding: '0.55rem 0.7rem'
    height: '2.5rem'
  entry:
    backgroundColor: 'transparent'
    textColor: '{colors.ink}'
    rounded: '{rounded.sm}'
    padding: '0.75rem 0.5rem'
  panel:
    backgroundColor: '{colors.surface-raised}'
    textColor: '{colors.ink}'
    rounded: '{rounded.md}'
    padding: '1rem'
  panel-sunk:
    backgroundColor: '{colors.surface-sunk}'
    textColor: '{colors.ink}'
    rounded: '{rounded.md}'
    padding: '1rem'
  tag:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-quiet}'
    rounded: '{rounded.sm}'
    padding: '0.1rem 0.4rem'
  score-mark-explicit:
    textColor: '{colors.ink}'
    typography: '{typography.figure}'
  score-mark-computed:
    textColor: '{colors.ink-quiet}'
    typography: '{typography.figure}'
---

<!--
  FORM: rw-centre-rail-reference-setting — dealt challenger, seed key fe9e53d3,
  index 5. Mode: operate.

  The form survived a de-theming pass. The rail is still the signature object
  and the ruled, unrounded, print-derived structure is still the world. What was
  removed was the *setting*: the reference-edition costume (Caslon, unbleached
  paper, "rubric", "seat a judgement", register crosshairs, the decorative
  centre rail on Home) read as a law-book theme rather than as a music app, and
  obscured what each page was for. Names are now plainly what they do.

  This DESIGN.md is recorded from the shipped build. src/app.css is the
  authority; where prose and build disagree, the build is right.
-->

# Design System: Music Ratings

## Overview

**Creative North Star: "The instrument, not the album wall."**

Music Ratings is a private instrument for deciding what you actually think of your own music. It refuses the two shapes this category always ships: the dark album-tile grid, and the popularity chart borrowed from a streaming service. There are no tiles, no artwork bleeds, no glow, no hero. There is a neutral ground, one text colour, hairline rules, and a single warm accent used sparingly to mark the one thing that matters on a screen.

Depth is tonal, not lifted — three surface weights (sunk, base, raised) and a hairline rule do the work a shadow would do elsewhere. Corners are nearly square (3px / 5px) so a panel reads as a bounded field rather than a card floating on a gradient.

The signature object is the **rail**: a ruled spine with cut detents that a rating is set into and stays lit where it was left. It is the same object at three sizes — the rating control (vertical on a wide screen, horizontal on a phone), the comparison pair, and the section navigation. Everything that sets a value in this app is a rail, so setting a value always feels the same.

Type is one family, Libre Franklin, worked hard: near-black headings at a tight measure, small-caps letterspaced labels for the apparatus (kinds, keys, provenance, reasons), and tabular figures so columns of scores align. A monospace face appears only for machine facts — ids, file names, byte counts.

The dark theme is not an inverted page. It is a genuinely dark neutral (`#141417`) with the accent lifted to `#f4634a` so it still clears contrast against it, and a scrim that is always black in both themes so an overlay pushes the page back rather than washing it out.

**Key characteristics:**

- Neutral greys, one warm accent (used on ≤10% of any surface), no second hue.
- Radii of 3px and 5px only. No shadows. No gradient fills as surface or atmosphere.
- Every border and detent is drawn at one device pixel (`--hairline` steps 1px / 0.5px / 0.34px across 1×/2×/3×).
- State is a mark, not a wash: hairline at rest, filled when set, outlined on focus, struck when spent.
- Page names say what the page does: Home, Rate, Compare, Library, Rankings, History, Insights, Settings.

## Colors

The palette is a neutral ramp plus one accent. There is no secondary colour and no per-genre or per-artist tinting; artwork supplies colour, the interface does not compete with it.

| Token              | Light               | Dark                | Use                                            |
| ------------------ | ------------------- | ------------------- | ---------------------------------------------- |
| `--surface`        | `#f5f5f7`           | `#141417`           | Page ground, navigation rail                   |
| `--surface-sunk`   | `#eaeaee`           | `#0e0e10`           | Recessed fields: the rating rail, inset panels |
| `--surface-raised` | `#ffffff`           | `#1c1c21`           | Panels that hold a single focused task         |
| `--ink`            | `#17171b`           | `#e9e9ee`           | Primary text                                   |
| `--ink-quiet`      | `#54545e`           | `#a2a2ae`           | Secondary text; ≥4.5:1 on `--surface`          |
| `--ink-faint`      | `#7a7a86`           | `#787883`           | Non-essential text only; never load-bearing    |
| `--border`         | `#d5d5dc`           | `#35353d`           | Structural rules                               |
| `--border-faint`   | `#e6e6eb`           | `#26262c`           | Rules inside a panel                           |
| `--scrim`          | `rgb(0 0 0 / 0.45)` | `rgb(0 0 0 / 0.68)` | Behind overlays, in both themes                |
| `--accent`         | `#cf3f26`           | `#f4634a`           | Fills and marks                                |
| `--accent-ink`     | `#b23319`           | `#ff8b74`           | Accent **text**, darkened/lightened for 4.5:1  |
| `--accent-wash`    | `#fbeae6`           | `#2c1a16`           | Hover ground under a quiet control             |
| `--on-accent`      | `#ffffff`           | `#16100e`           | What may sit on a solid accent fill            |

Two accent tokens exist because one cannot do both jobs: `--accent` is tuned for fills and 3px marks, `--accent-ink` for small text on the surface. Never set small text in `--accent`.

`[data-contrast='high']` collapses `--ink-quiet` into `--ink` and strengthens both border tokens; it is a supported mode, not a fallback.

### Palette

- **Ground** (#f5f5f7): the light page ground. Everything sits on it; it is warm-neutral rather than pure white so `--surface-raised` (#ffffff) can lift a panel without a shadow.
- **Ground, dark** (#141417): the dark page ground. A genuinely dark neutral, not an inverted page; `--surface-raised` lifts to #1c1c21.
- **Ink** (#17171b): primary text, and the colour of every explicit rating mark. `--ink-quiet` (#54545e) carries secondary text at ≥4.5:1 and marks computed rollups.
- **Rule** (#d5d5dc): structural hairlines. `--border-faint` (#e6e6eb) divides rows inside a panel.
- **Accent** (#cf3f26): fills, detent marks, and the single most important control on a screen — never more than ~10% of a surface.
- **Accent ink** (#b23319): accent-coloured _text_, darkened to clear 4.5:1 on the ground. In the dark theme both lift, to #f4634a and #ff8b74.

## Typography

One family. `--display` is an alias of `--sans` so a future serif can be reintroduced in one line without touching a component.

| Role           | Size                                  | Weight | Notes                                    |
| -------------- | ------------------------------------- | ------ | ---------------------------------------- |
| `.display`     | `clamp(2rem, 1.3rem + 3vw, 3.4rem)`   | 400    | One per page; the page name              |
| `.title`       | `clamp(1.4rem, 1.1rem + 1.3vw, 2rem)` | 400    | Section heads                            |
| body           | `1rem` / 1.62                         | 400    | Default                                  |
| `.note`        | `0.875rem` / 1.5                      | 400    | Explanation under a control              |
| `.note--small` | `0.8125rem`                           | 400    | Row subtitles                            |
| `.label`       | `0.6875rem`, `0.13em`, uppercase      | 550    | Apparatus: kinds, keys, reasons, sources |
| `.figure`      | `1rem`, tabular lining figures        | 500    | Any number that sits in a column         |
| `.mono`        | `0.8125rem`                           | 400    | Machine facts only                       |

**Type ramp.** Sizes are on a 1/16rem grid. In use: `0.5625`, `0.625`, `0.6875`, `0.75`, `0.8125`, `0.875`, `0.9375`, `1`, `1.0625`, `1.125`, `1.25`, `1.375`, `1.5`, `1.75`, `1.875`, `2`, `2.75`, `3`, `3.4` rem. The four fluid steps (`.display`, `.title`, the entity name, the onboarding head) interpolate between members of that ramp, so a fluid heading never lands on a size the ramp does not contain. Sizes below `0.625rem` appear only in the mobile tab bar and in superscript annotations, never in running text.

## Elevation

There are no shadows in this design system. Depth is tonal and structural: three surface weights and a hairline rule carry every level a shadow would carry elsewhere.

- **Sunk** (`--surface-sunk`) — a field you set a value into: the rating rail's channel, inset panels, code blocks.
- **Base** (`--surface`) — the page ground and the navigation rail.
- **Raised** (`--surface-raised`) — a panel that holds one focused task; it is separated from the ground by `1px solid var(--border)`, never by a shadow.

Overlays are the only true layer: the search overlay and the mobile More sheet sit above `--scrim`, which is black in both themes. Corners stay at 3px / 5px at every level, so raising a surface never rounds it further.

## Space and structure

Spacing is a fixed set (`--s1` 0.25rem … `--s8` 4.5rem), not a generator. `[data-density='compact']` shrinks `--s4`–`--s8` only; the two tight steps stay put so controls do not lose their touch target.

- `--measure: 68ch` caps any column of running prose.
- `--rail-w: 15rem` is the desktop navigation rail; below `60rem` it becomes a fixed bottom tab bar of seven tabs (Search, Home, Rate, Compare, Library, Rankings, More), with the remaining sections in a sheet behind **More**. Nothing becomes unreachable on a phone.
- Home is two plain columns at `≥64rem` and one column below: _what to do next_ on the left, _what has happened_ on the right.

## Motion

Three durations (`90ms`, `160ms`, `260ms`) and one ease (`cubic-bezier(0.22, 0.61, 0.36, 1)`). Motion is confirmation, never decoration: the rail's ink fills to the detent you set, the comparison pair tips toward the side you chose, a queue tick scales out under the pointer. Transitions run on `transform` and `opacity` only. Everything collapses under `prefers-reduced-motion: reduce`.

## Components

- **Rail** (`RatingRail`) — the rating control. Vertical above `48rem`, horizontal on a phone. One tab stop; arrows walk detents, digits pick a known value, Home/End reach the ends. Detents are cut by whichever scale is active, so a 1–10 rail and an S–F tier rail are the same object with different cuts.
- **Panel** (`RatePanel`, `ComparePanel`) — a raised bounded field holding exactly one decision, with its evidence above and its escapes (skip, snooze, don't know it) below.
- **Entry row** — the list primitive everywhere: artwork, name and subtitle, kind label, score mark. Never a card.
- **Score mark** (`ScoreMark`) — explicit ratings in `--ink`, computed rollups in `--ink-quiet`. The two are never rendered identically, because the app never overwrites one with the other.
- **Search overlay** — `/` or Ctrl/Cmd+K from anywhere. Answers instantly and offline from your own library; searching the Spotify catalogue is a deliberate second step.
- **Empty states** — every one names what is missing and offers the action that fixes it.

## Do's and Don'ts

### Do

- Do name a page for what it does — Home, Rate, Compare, Library, Rankings, History, Insights, Settings.
- Do render an explicit rating in `--ink` and a computed rollup in `--ink-quiet`, so the two are never confused.
- Do set small accent text in `--accent-ink` and reserve `--accent` for fills and marks.
- Do give every empty state a name for what is missing and the action that fixes it.
- Do keep transitions on `transform` and `opacity`, and let them collapse under `prefers-reduced-motion`.
- Do draw structure at one device pixel with `--hairline` rather than at a fixed 1px.

### Don't

- Don't use rounded "cards on a gradient", glassmorphism, glow, or a coloured slab down one edge of a card.
- Don't introduce a second hue, per-item tinting, or any green that reads as an imitation of a streaming service.
- Don't reach for marketing hero type, pill spam, or an icon that is only decorative.
- Don't set small text in `--accent` rather than `--accent-ink`.
- Don't derive a scrim from `--ink` — it goes pale in dark mode and washes the page out.
- Don't use themed vocabulary in the UI. Labels say what a thing is: "Your rating", not a metaphor for one.
