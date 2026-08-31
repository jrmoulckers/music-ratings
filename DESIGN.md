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

The signature object is the **rail**: a ruled spine with cut detents that a rating is set into and stays lit where it was left. It is the same object at three sizes — the rating control (vertical on a wide screen, horizontal on a phone), the comparison pair, and the section navigation. Everything that sets a value in this app is a rail, so setting a value always feels the same. Past 16 detents the rail changes state rather than shrinking: the cut slides, the graduations go round, and the reading becomes typeable — but it is still one spine, one ink, one cut.

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
- Rate is a single scrollable queue on one accent rail, not a hero panel with a sidebar of leftovers. Twenty slips are shown and the rest load themselves as you reach them, so the queue is something you scan and work down rather than a card that hands you one item at a time. Rating or dismissing a slip changes it in place; the page never jumps back to the top.

## Motion

Three durations (`90ms`, `160ms`, `260ms`) and one ease (`cubic-bezier(0.22, 0.61, 0.36, 1)`). Motion is confirmation, never decoration: the rail's ink fills to the detent you set, the comparison pair tips toward the side you chose, a queue tick scales out under the pointer. Transitions run on `transform` and `opacity` only. Everything collapses under `prefers-reduced-motion: reduce`.

Playback progress is the one exception, because it is a reading rather than a transition. It advances on animation frames from the last authoritative position — the app does not ask Spotify more often to look smoother — and it runs only while something is actually playing, visible and online. A poll that disagrees by less than 1.2s is eased into over a few frames so the line never twitches backwards; a track change, a seek or a larger disagreement snaps at once, because pretending otherwise would be a lie about where you are. Under `prefers-reduced-motion` the easing is dropped and corrections snap, but the line keeps moving: a progress bar that stutters is less usable, not calmer.

## Components

- **Rail** (`rating/RatingRail`) — the rating control, and a dispatcher: it draws the shape the active scale actually is. Five-star scales get `StarRating`, tier lists get coloured detents, dense scales get the precision rail, everything else gets cut detents. It lays the scale out horizontally where there is room for it and stands it up on a narrow screen. One tab stop; arrows walk detents, digits pick a known value, Home/End reach the ends.
- **Stars** (`rating/StarRating`) — for `stars` and `half-stars` only. Five stars, outline when empty, filled in `--star` through the value; hover previews, a click commits, a drag across them scrubs and commits on release, and a half is a real half-filled star rather than two small ones. Not the app's ruler in a star costume: nobody has to be taught what five stars mean, and inventing a novel star control throws that away. Cells are 44px square whatever the glyph size; the accessible value reads "3.5 out of 5 stars".
- **Precision rail** (`rating/PrecisionRail`) — the rail's dense state, entered automatically past 16 detents. A hundred detents is not a hundred choices, so the cut slides instead of being one of a hundred, only round graduations are printed (`1 · 10 · 20 … 100`, thinned to `1 · 20 … 100` on a phone), and the reading becomes a number field you can type into. Dense scales are the one place a rating is **composed and then saved**: the slider, the field and the steppers build a draft, **Save rating** commits it once, Cancel or Escape drops it. An unrated slider rests at the middle because it has to rest somewhere — that resting position is not a value, so the steppers are disabled until you have established a draft, and they can never turn a placeholder 5.0 into a recorded 5.1.
- **Panel** (`RatePanel`, `ComparePanel`) — a raised bounded field holding exactly one decision, with its evidence above and its escapes below. `RatePanel` also has an `inline` state that drops its own frame and heading so a row can host it without two frames around one item, a `shortcuts` flag that means "queue semantics apply", and a `seed` that opens it on a rating other than the current one — which is what lets a History entry be edited from its own value. Opening its context section switches the whole panel from committing to composing: the rail stops writing, one **Save rating** at the foot writes the rating and its context as a single event, and Cancel drops all of it.
- **Ratable row** (`RatableRow`) — the one list primitive for anything you can rate: Rate, Library, Rankings, entity contents, search results, dashboard suggestions. Artwork or rank, name, kind icon and word, why it is here, then `InlineRating`, the score mark, a Rate / Edit rating disclosure, and — only where a queue exists — Skip and Snooze behind a hairline. Opening the disclosure expands the shared `RatePanel` in place. Duplicate actions use progressive disclosure rather than overloading every resting row, and a row standing for several combined sources says so in its second line. Escape closes the editor and returns focus to the disclosure.
- **Inline rating** (`InlineRating`) — the one rating control. Every surface that can record an opinion mounts this and nothing else: rows, panels, the player, entity pages, the search overlay, context facets. It picks the drawing from the scale and the space (`compact`, `row`, `player`, `prominent`), and a variant changes how large the control is and never what pressing it does. `mode="held"` hands the value back instead of writing it, which is how a draft — a context facet, an unsaved panel — uses the identical scale UI, keyboard behaviour and accessible names without emitting an event of its own. One commit is one rating event; the architecture test fences both halves of that.
- **Compact rating** (`rating/CompactRating`) — the small drawing `InlineRating` reaches for in a row. Star scales get the star control at reduced size; tier lists get the tier colours; other coarse scales get pressable detent marks in one bordered strip; dense scales get a number field with −/+ steppers and the same save-once tick as the precision rail. Not mounted directly by any surface.
- **Context editor** (`ContextEditor`) — the optional half of a rating. Collapsed behind **Deeper rating** so the fast path stays one gesture; opened, it asks three to five plain questions about the thing (Enjoyment, Craft, Innovation for its time, Influence, Staying power), each answered on the same scale as the rating itself and each skippable — "Consider craft, influence, and its time." Every facet is an `InlineRating` in held mode, so the facets and the rating itself cannot drift apart, and the editor owns the single atomic Save. One concise disclosure states the arithmetic; a release year is printed as fact ("Released in 1970") and never as a judgement.
- **Combine panel** (`CombinePanel`) — where two records are declared to be one. A progressive panel rather than a dialog, because the decision is made against the item already open: closed it is one quiet button, opened it searches the library, lists candidates with evidence and a verdict, and never treats a live take or cover as a duplicate without saying so. The preview states the exact consequence before confirmation. Once combined it lists every source with its own **Open in Spotify** link, offers **Make primary**, and separates again in place.
- **Auto load** (`AutoLoad`) — the end of a list, watched. An IntersectionObserver sentinel 800px ahead of the viewport appends the next batch itself, guarded against a double request while a batch renders and falling back to scroll measurement where the observer is missing. A "show more" button asks you to confirm that you meant to keep reading, which is a strange thing to ask of someone who is already scrolling; the app has none. Explicit **Refresh** is a different thing and stays.
- **Entity type icon** (`EntityTypeIcon`) — one silhouette per kind: artist, release, track, playlist, show, episode, audiobook, chapter. Decorative beside a visible type word, labelled when it stands alone, so a screen reader is never told the kind twice.
- **Score mark** (`ScoreMark`) — explicit ratings in `--ink`, computed rollups in `--ink-quiet`. The two are never rendered identically, because the app never overwrites one with the other. A row hides it when it would print the number the quick control is already showing.
- **History entry** — a record line that is also a place to rate from. It shows where it stands (_Your rating now_, _An earlier rating_, _Withdrawn_), and offers exactly one record action: **Withdraw** while it still counts, **Delete permanently** — behind an in-place confirmation — only once it has been withdrawn. Opening **Rate again** loads the shared editor seeded from that entry and saves a new one; nothing in the record is ever rewritten.
- **Mini player** (`MiniPlayer`) — one ruled band at the foot of the app, present on every page including Now Playing: the transport lives in exactly one place, and moving it when you open the page you are already listening on would be the one moment it matters most. Sleeve, title, performer, previous/play/next, elapsed and length, the device name, and the same `InlineRating` used in every list — because the point of knowing what is playing is being able to say what you think of it while it plays. It measures itself and publishes `--player-h`, which the shell, the notices and the update prompt clear by exactly; nothing guesses a bar height. With nothing playing it offers a device rather than sitting there blank, and it vanishes entirely when there is no device either.
- **Scrubber** (`PlaybackScrubber`) — the timeline, drawn once and mounted by the bar. It reports only on release, because a scrubber that seeks on every pixel is a scrubber that fights the network.
- **Now Playing** (`NowPlaying`) — not a second remote control. The bar keeps the transport; the page spends its room on what the bar cannot hold: the sleeve at size, the full identity, the deeper rating editor, album-session progress and its track list, Up Next open by default, and the context, device and queue detail. Nothing that the bar already shows is repeated immediately above it. Every control Spotify refuses is disabled with the reason on it rather than failing after the press; when the track changes under an open editor the editor stays pinned to what you were rating and says so, because silently moving an unsaved draft onto a different track would record an opinion nobody held.
- **Device picker** (`DevicePicker`) — the sheet listing what Spotify can see, each with its kind, whether it is active, and whether it is restricted. Transfer moves playback; a restricted device says why it cannot. With nothing listed it gives the three real recoveries — open Spotify somewhere, look again, or turn this browser into a device — rather than an empty list.
- **Album mode** (`AlbumMode`) — a record listened to in order and rated as it goes. The status column states what is true and no more: **Now playing**, **Played this session** only where Spotify has confirmed a play in this sitting, **Awaiting Spotify** where the app watched it play but Spotify has not caught up, **Earlier track** for a position the playhead has passed without either — never "Passed", which would blame the listener for starting mid-record. Each row is a `RatableRow`; the current one is `aria-current` and highlighted but never scrolled to while you are editing another. `x of y rated` and an **Unrated from this record** filter make the gap the thing you close. The record's own rating is a separate control that stays separate.
- **Completed rail** (`TrackRail`) — the signature rail, reused to state a fact rather than take a rating. Cut detents, one per track, filled to the number heard. It is inert, unfocusable, labelled in words beside it, and swept once in ink when a completion has just arrived.
- **Album complete** (`AlbumComplete`) — the earned moment, not a queue suggestion. Artwork, identity, completed rail, timing, tracks rated, observed plays, current rating or rollup, and provenance make the evidence inspectable. It is a stored record rather than a toast: it survives navigation, reload and sync until answered, never blocks playback, and never steals an editor already open on something else.
- **Search overlay** (`SearchOverlay`) — `/` or Ctrl/Cmd+K from anywhere. Answers instantly and offline from your own library; searching the Spotify catalogue is a deliberate second step, and the answers Spotify actually gave lead the list rather than the metadata they dragged in. Two records that would look identical — the 1969 master and the 2019 remaster, both real, both ratable — are told apart by the smallest fact that separates them, and rows that are already distinct get nothing.
- **Recent searches** (`RecentSearches`) — the last eight things you looked for, on an empty field, in both search surfaces from one implementation. Device-local and never synced: what you searched for is not a rating.
- **Detail page** (`Entity`) — asks each kind the question it can answer. Containers get their own word for their contents — a release has a **Tracklist**, a playlist has **Tracks**, an artist has **Releases** and then **Tracks**, a show has **Episodes**, an audiobook has **Chapters** — and leaves are never asked what is inside them at all, so a track has no empty contents section and no button offering to load something Spotify will never return. A leaf leads with what it belongs to instead: **Appears on**, **By**, **From**, grouped by kind and linked, with the record it came from given more weight than the eleventh playlist someone added it to. Two editions of one record are two rows told apart by the smallest fact that separates them. The margin carries three groups and no more — the score with one line of plain reading and the working folded behind it, your note and tags together, and everything technical under **Details** — because a column of ten equal links is a column nobody reads. The page is the context: rows in its own lists do not reprint the name at the top of it.
- **Empty states** — every one names what is missing and offers the action that fixes it.

## Do's and Don'ts

### Do

- Do name a page for what it does — Home, Rate, Compare, Library, Rankings, History, Listening, Insights, Settings.
- Do render an explicit rating in `--ink` and a computed rollup in `--ink-quiet`, so the two are never confused.
- Do draw a rating in the shape its scale already has: five stars for stars, the tier list's own six colours for S–F. A control nobody has to learn beats a consistent one they do.
- Do make a dense scale composed and then saved — draft, **Save rating**, Cancel — and never let a resting placeholder become a recorded value.
- Do keep a context score, a rating and a context-adjusted rating visibly three different things, and never let the first quietly become the second.
- Do set small accent text in `--accent-ink` and reserve `--accent` for fills and marks.
- Do give every empty state a name for what is missing and the action that fixes it.
- Do keep transitions on `transform` and `opacity`, and let them collapse under `prefers-reduced-motion`.
- Do draw structure at one device pixel with `--hairline` rather than at a fixed 1px.
- Do give a list of ratable things a `RatableRow` and let the end of it load itself.
- Do write a suggestion reason as a sentence a person would say: "Played 2 hours ago.", "#3 in your all-time listening.", "No tracks from Rain Ledger rated yet."
- Do disable a playback control Spotify has refused and put the reason on it, rather than letting the press fail.
- Do keep an unsaved rating draft pinned to the thing it was opened on when playback moves on.
- Do let a scrubber follow the finger at whatever resolution the pointer has, and send exactly one seek when it is released. Arrow keys are a different instrument: they move in 5s, Page keys in 30s, and Escape puts the handle back where playback actually is without seeking at all.
- Do mount `InlineRating` wherever something can be rated, and extend its API rather than drawing a second control that looks like it.
- Do open the app against whatever database version is already on the device. Refusing to start protects nothing and puts the user's own ratings out of reach.
- Do say which record you mean when two of them would look the same, using the smallest fact that separates them.
- Do ask a thing the question its kind can answer, and let the graph edges — not the page template — decide whether it holds anything.
- Do leave out of a row whatever the page above it has already said.
- Do print a share with its numerator and denominator beside it — "34 of 52 known tracks (65%)" — so the reader can check the arithmetic and see what the denominator actually was.
- Do qualify every observed figure with the date observation began, and say plainly where the record has holes.

### Don't

- Don't use rounded "cards on a gradient", glassmorphism, glow, or a coloured slab down one edge of a card.
- Don't introduce a second hue, per-item tinting, or any green that reads as an imitation of a streaming service. Three colours are exempt because they carry meaning the shape cannot: `--star` on stars, the six tier-list hexes in `lib/ui/tiers.ts`, and nothing else. A destructive button is not exempt — the accent is already red, so **Delete permanently** is solid ink instead, the only filled thing on its page.
- Don't offer two record actions on one entry. Withdraw is reachable while a rating counts; delete is reachable only after it has stopped.
- Don't repeat a surface inside itself: the persistent bar is the only transport, so Now Playing never draws a second set of controls or a second scrubber above it.
- Don't build a now-playing display that only displays. Every visible piece of state is a control, and the rating beside it is the real one.
- Don't treat connecting an account as finishing setup. Setup is done when the person has been through all three pages and pressed the last button; coming back from Spotify's redirect returns them to the page they were on, not past it.
- Don't claim a standing among other listeners. Spotify publishes no population data, so "top 1% listener" would be invented; say what share of _your own_ observed listening something was instead.
- Don't celebrate a completed record with confetti or a modal. It is an earned statement of fact with its evidence attached, and it waits rather than interrupting.
- Don't reach for marketing hero type, pill spam, or an icon that is only decorative.
- Don't set small text in `--accent` rather than `--accent-ink`.
- Don't derive a scrim from `--ink` — it goes pale in dark mode and washes the page out.
- Don't use themed vocabulary in the UI. Labels say what a thing is: "Your rating", not a metaphor for one.
- Don't put a "Show more" or "Load more" button on an ordinary scrolling list.
- Don't say the same thing twice in one row — not a chip and a sentence that opens on the chip's word, and not a score mark repeating the number in the field beside it.
- Don't report a state as a percentage where a count is what the reader wants: "3 of 12 tracks rated", never "25% rated".
- Don't print an ambiguous fraction. "2 of 13" cannot mean loaded on one screen and rated on the next; a release header says "13 tracks · 2 rated".
- Don't claim a play that Spotify has not confirmed, and don't let a track's position in the running order stand in for one.
- Don't merge two catalogue records because they look alike. They may be two editions, each with its own rating; distinguish them instead.
- Don't offer to load contents a leaf cannot have, or contents Spotify will not return. An empty state that apologises for missing data is a page inventing a hole in it.
