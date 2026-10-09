---
name: Music Ratings
description: A quiet, local-first instrument for rating your own music.
colors:
  surface: '#f4f4fb'
  surface-sunk: '#f1f1f9'
  surface-raised: '#ffffff'
  ink: '#1c1d2e'
  ink-quiet: '#5b5e7e'
  ink-faint: '#5b5e7e'
  border: '#dcdcea'
  border-faint: '#dcdcea'
  control-border: '#7d809b'
  accent: '#6b46f0'
  accent-ink: '#5632c8'
  accent-wash: '#ebe7fc'
  on-accent: '#ffffff'
  scrim: 'rgb(0 0 0 / 0.45)'
typography:
  display:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif'
    fontSize: '1.6rem'
    fontWeight: 700
    lineHeight: 1.2
  title:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif'
    fontSize: '1.25rem'
    fontWeight: 700
    lineHeight: 1.2
  body:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif'
    fontSize: '1rem'
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif'
    fontSize: '0.9rem'
    fontWeight: 400
    lineHeight: 1.4
  note:
    fontSize: '0.875rem'
    lineHeight: 1.5
  figure:
    fontSize: '1rem'
    fontWeight: 500
  mono:
    fontFamily: 'ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace'
    fontSize: '0.8125rem'
  scale:
    tick: '0.625rem'
    fine: '0.75rem'
    small: '0.8125rem'
    note: '0.875rem'
    label: '0.9rem'
    compact: '0.9375rem'
    base: '1rem'
    lead: '1.0625rem'
    subhead: '1.125rem'
    title: '1.25rem'
    score: '1.375rem'
    step3: '1.5rem'
    display: '1.6rem'
    step4: '1.75rem'
    step5: '1.875rem'
    step6: '2rem'
    step7: '2.75rem'
    step8: '3rem'
    step9: '3.4rem'
rounded:
  sm: '8px'
  md: '8px'
spacing:
  s1: '0.25rem'
  s2: '0.5rem'
  s3: '0.75rem'
  s4: '1rem'
  s5: '1.25rem'
  s6: '1.5rem'
  s7: '2rem'
  s8: '3rem'
components:
  button-primary:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.on-accent}'
    rounded: '{rounded.sm}'
  button-default:
    backgroundColor: '{colors.surface-raised}'
    textColor: '{colors.ink}'
    rounded: '{rounded.sm}'
  panel:
    backgroundColor: '{colors.surface-raised}'
    textColor: '{colors.ink}'
    rounded: '{rounded.md}'
  input:
    backgroundColor: '{colors.surface-raised}'
    textColor: '{colors.ink}'
    rounded: '{rounded.sm}'
---

# Design system

**The music leads. The interface helps you decide.** This is an operating tool, not an album wall or a printed reference edition. Quiet grounds, readable system type, a single action color, and concise controls make repeated rating comfortable. Remove duplicate explanations, decorative rules, uppercase apparatus, corner marks, and texture before adding containers.

`PRODUCT.md` owns product truth. `src/app.css` owns visual values; components consume its semantic roles. Existing token names remain compatible with all surfaces.

## Studio alignment

The foundation follows the studio reference at commit `390036f73dc72412251608f59178407fdb231d29`: `principles/experience/ux.md`, `accessibility.md`, `interaction.md`, `principles/design/tokens-and-themes.md`, and the default semantic light/dark color tokens.

Adopt the shared language, not unrelated product features: one dominant primary action; familiar paths; primitive → semantic → component references; consistent action color; system sans; tabular numbers; plain, actionable feedback; keyboard and reduced-motion support. No new token package dependency is needed. The studio's private package is not registry-published.

This app retains its persisted light/dark/system, compact/cozy, high-contrast, artwork, and motion preferences. It does not silently add OLED themes, cognitive settings, or another persistence mechanism.

## Color and surfaces

| Role                         | Light     | Dark      | Meaning                           |
| ---------------------------- | --------- | --------- | --------------------------------- |
| `--surface`                  | `#f4f4fb` | `#0f1020` | Page and navigation ground        |
| `--surface-sunk`             | `#f1f1f9` | `#24263f` | Secondary/selected surface        |
| `--surface-raised`           | `#ffffff` | `#1a1b2e` | Focused task or overlay           |
| `--ink`                      | `#1c1d2e` | `#e9e9f4` | Primary text and direct ratings   |
| `--ink-quiet`, `--ink-faint` | `#5b5e7e` | `#a3a6cb` | Readable secondary text           |
| `--border`, `--border-faint` | `#dcdcea` | `#313357` | Non-interactive separation        |
| `--control-border`           | `#7d809b` | `#72769e` | Control boundaries, ≥3:1          |
| `--accent`                   | `#6b46f0` | `#9990ff` | Dominant action and rating marks  |
| `--accent-ink`               | `#5632c8` | `#b9adff` | Action-colored text and hover     |
| `--accent-wash`              | `#ebe7fc` | `#24213f` | Restrained selected/hover context |
| `--on-accent`                | `#ffffff` | `#0f1020` | Text on action fills              |
| `--star`, `--star-edge`      | `#806600` | `#ffd166` | Stars only                        |

The dark action is the rounded sRGB equivalent of studio `oklch(0.71 0.16 285)`. Gold never means generic success, navigation, or sync. Scale-specific tier colors retain their domain meaning.

Normal text, including placeholders and provenance, clears 4.5:1 on all three surfaces. Interactive boundaries and focus indicators clear 3:1. Low-contrast divider tokens must not supply the only boundary of an input. High contrast strengthens text and boundaries independently of theme.

Depth is tonal, not decorative. Use one boundary for one task, not nested cards. List rows stay flat. Controls and bounded panels use an 8px radius; a studio 16px card radius is not a requirement to round every region. No grain, gradient atmosphere, glass, corner ornaments, or offset print shadows.

## Type, rhythm, and controls

The shared roles use system sans: display 1.6rem/700/1.2, title 1.25rem/700/1.2, body 1rem/400/1.5, and sentence-case labels 0.9rem/400/1.4. Notes use 0.875rem; score provenance uses 0.75rem. Reserve 0.625rem for short count annotations, never instructions. Numeric columns are tabular; monospace is for machine facts only.

Spacing steps are 4, 8, 12, 16, 20, 24, and 32px, with 48px available for major separation. Compact mode reduces section gaps, not text size or touch safety. Prose is capped at 68ch.

Primary buttons are filled action color, ordinary buttons use a neutral raised surface and a visible control edge, and quiet actions remove that edge. Name the action in sentence case. Prefer one visible primary action per task; disclosure holds advanced options and explanations. Desktop buttons can be 32–40px high where pointer precision permits; coarse-pointer controls and all navigation targets are at least 46px.

## Shell and navigation

Desktop uses a 13.5rem navigation column, with every section directly reachable and one Search field. The rail scrolls on short viewports. Current location uses a neutral fill and heavier text, not a second meaning for the action color.

At ≤60rem or on a coarse-pointer touch device, show five equal destinations: **Search, Home, Rate, Library, More**. Compare, Rankings, Now playing, History, Listening, Insights, Settings, and Data health remain reachable in More. The More sheet is a native modal dialog: the browser contains focus and makes the background inert; Escape closes it; the close action restores focus to More. Route changes and returning to desktop close it.

`--nav-h` is 3.5rem plus the device's bottom safe area, compatible with the existing player offset. The mini-player publishes `--player-h`; shell padding, updates, and notices clear both bands. Do not introduce fixed guessed player heights. `/` and Ctrl/Cmd+K retain global search behavior.

Status says only what is known: Local only, Offline, Sync connected, Syncing, Sync queued, Synced, Sync conflict, or Sync failed. Connected is not the same as synced. Errors and conflicts have words and a warning glyph, never color alone; Data health remains the recovery path.

## Shared component contracts

- **Artwork:** user-selected full, thumbnail, or none; no catalogue fixtures. Lazy by default, eager only for priority artwork. Missing/failed artwork retains the initials slot; a new source is tried independently of a previous failure.
- **Empty:** one truthful title, short explanation, optional recovery, and real exclusion counts. No ornamental frame or illustration required.
- **Entity type icon:** one shared silhouette per kind, decorative beside visible text and labelled when alone. Icon-only controls need an accessible action name.
- **Score mark:** direct, context, context-adjusted, rollup, and blended views read their actual channels. Direct ratings use normal ink; computed/context values use secondary ink and italic figures. Visible provenance is concise; hiding it never hides provenance from assistive technology. Insufficient rollup coverage remains provisional.
- **Notices:** compact message, optional undo/action, accessible dismiss target. Warnings include a labelled glyph and alert semantics. The shell stacks notices and updates together so they never overlap each other, navigation, or the player.

Feature surfaces continue to use `InlineRating` rather than inventing competing controls. Stars retain familiar star interactions and 44px cells; dense scales keep a draft and save once. Ratings remain temporal events, context stays optional, and explicit scores are never overwritten by computed scores. Playback state remains evidence from Spotify, not an inferred rating or confirmed listen.

## Accessibility and motion

Keyboard interaction, visible 2px focus rings, skip navigation, live announcements, and screen-reader names are required. Setting theme updates both browser theme-color entries from the actual CSS surface; explicit app choice takes precedence over OS chrome media queries.

Functional state motion uses 150ms, larger transitions 250ms, with one ease-out curve. OS-reduced motion in System mode and the persisted Reduce override collapse transitions to 1ms and disable smooth scrolling. Full motion remains an explicit override. Do not add decorative entrances or make essential content depend on animation.

## Integration checks

Foundation tests cover light/dark browser chrome, OS theme updates and listener cleanup, preferences, navigation reachability/modal controls, artwork failure recovery, every score channel, and WCAG text/control contrast across normal and high-contrast themes. PWA manifest, HTML chrome colors, favicon, and generated install icons share the final palette.

When integrating page work, remove redundant headings and metadata rather than hiding important product evidence. Keep errors, offline limits, score provenance, and optional integration choices inspectable. No demo catalogue, invented listening history, or new account requirement.
