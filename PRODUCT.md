# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The owner — a person with a Spotify Premium account and a long listening history — plus a handful of invited Premium testers (Spotify Developer Mode currently allows roughly five approved users, and that ceiling is accepted).

They are not casual listeners. They are the kind of person who keeps lists, argues about album ordering, and can tell you their top five records but not their top fifty. They use the product in deliberate sessions: at a desk with headphones on, or on a phone while something is playing, judging music they already know rather than discovering new music.

## Product Purpose

Establish the user's **actual** favourites and least favourites — not a pile of disconnected scores.

Most rating tools collect numbers and stop. This one treats the numbers as evidence and produces a defensible ranking on top of them: what you truly love, what you truly avoid, how confident that answer is, and exactly why the app believes it. Success is the user being able to say "these are my real top twenty albums" and trust it.

## Positioning

Two mechanisms a neighbouring product could not truthfully copy:

1. **Hybrid judgement.** Direct ratings establish absolute level; occasional head-to-head comparisons resolve the ordering that ratings alone cannot. Spotify data only _selects which candidates are worth comparing_ — Spotify popularity never influences the user's result.
2. **A transparent, auditable rollup.** Every computed score can be opened and explained: which explicit rating, which children, which comparisons, which weights, what was excluded and why. No black box, no model, no "our algorithm thinks".

The data is the user's own: local-first, offline-capable, synced to the user's own OneDrive. There is no hosted application database and no server that ever sees the user's ratings.

## Operating Context

- **Rating session.** The user works a queue: rate, skip, snooze, mark "not familiar". Batch-friendly, keyboard-driven on desktop, swipeable on phone. Each queued item states why it was suggested.
- **Comparison session.** Two items side by side; pick one, or "can't decide", or "both unfamiliar". Undo is always available.
- **Lookup.** Search for an artist, album, playlist or track and inspect its detail page: explicit rating, computed score, rank, confidence, child breakdown, history, notes, tags, Spotify deep link.
- **Review.** Top and bottom lists per entity type, the rating timeline, and locally computed taste insights.
- **Environments.** Desktop browser and installed mobile PWA. Frequently offline or on poor connections; ratings made offline queue and sync later.
- **Accounts.** Spotify (Authorization Code with PKCE, no client secret) is optional; Microsoft/OneDrive is optional; a fully seeded demo mode requires neither.

## Capabilities and Constraints

### Confirmed functionality

- Entity types: artist, album, track, playlist, and — only where the current Spotify API genuinely supports them — show/episode and audiobook/chapter. Entity types are user-configurable and degrade to "unavailable" rather than being faked.
- Ratings are **temporal events**, not fields. Each carries a value, the scale it was entered on, an optional note, tags, context and confidence. History is retained; edit and undo are supported.
- All rating scales normalise internally to 0–100: stars, half-stars, integers 1–3 / 1–5 / 1–10 / 1–100, decimal, thumbs, and custom labelled ordinal scales. Original scale values remain visible. Changing scale must not lose normalised history.
- Head-to-head comparisons feed a per-entity-type Elo rating carrying uncertainty and comparison count. Cross-type comparison is off by default.
- Explicit ratings and computed rollups are stored separately and never overwrite each other. Explicit-only, rollup-only, and blended views are all available.
- Rollup weights are user-customisable per parent type. Defaults: parent explicit 50%, direct child explicit 30%, descendant 10%, comparison-derived 10%, renormalised over whatever evidence actually exists.
- Containment: artist → releases/tracks, album → tracks, playlist → tracks, show → episodes, audiobook → chapters. A track reachable by several paths must not be counted twice. Various-artists releases and multi-artist tracks allocate contribution fairly. A playlist's explicit rating is independent of its tracks' ratings.

### Technical constraints

- **Spotify.** Authorization Code with PKCE in the browser. Client ID and redirect URI are configurable; no client secret is ever required or exposed. Developer Mode's approved-user limit applies.
- **Spotify APIs that must not be depended on:** recommendations, related-artists, audio-features, audio-analysis. Rating suggestions are therefore built deterministically from recently played (max 50), top tracks/artists (short/medium/long term), saved library, unrated children of rated parents, stale ratings due for review, low-confidence rankings, and coverage gaps.
- Rate limiting (`Retry-After`), token refresh, auth expiry, revoked scopes, partial data, pagination, market/unavailable content, deleted playlist items, and offline mode are all explicit product states, not error pages.
- **Storage.** IndexedDB locally; optional sync to a sandboxed Microsoft Graph app folder as JSON, with lazily loaded MSAL, ETag optimistic concurrency, explicit conflict surfacing, per-entity merges and tombstones, and full export/import. No hosted database.
- **Distribution.** Installable, responsive PWA suitable for static hosting.

### Deliberately undecided

- Whether show/episode and audiobook/chapter ship enabled by default depends on what Spotify's API supports at build time; the product treats them as configurable and gracefully unavailable.
- No hosting domain, deployment target, or public availability has been decided.

## Brand Commitments

- Name: **music-ratings** (working repository name; no final product name confirmed).
- The product must not look like or imitate Spotify. Not a Spotify clone, not an all-green interface.
- Explicitly ruled out by the owner: excessive rounded cards, glassmorphism, gradient-heavy backgrounds, pill spam, huge marketing hero text.
- Nothing may be borrowed from the Score King project except architectural ideas — no branding, no visual design, no Azure client ID.

## Evidence on Hand

- **Real data source:** the Spotify Web API, reachable only with the user's own credentials. No Spotify data is bundled.
- **Demo data:** a seeded set of _fictional_ artists, albums, tracks and playlists must be authored so the full experience is usable without any credentials. It is synthetic and must be labelled as such.
- **Absences future work must not fabricate:** no real artist, album or track metadata may be shipped in the repository; no lyrics; no claim that Spotify recommended, endorsed, or generated anything; no user counts, testimonials, benchmarks, pricing, or availability claims.
- **Architectural reference (read-only, not a content source):** `C:\Users\jrmou\src\score-king` — local-first IndexedDB plus optional OneDrive/MSAL/Graph app-folder JSON sync.

## Product Principles

1. **The user's judgement is the only authority.** Spotify supplies catalogue and relevance signals; it never supplies an opinion. Popularity is never an input to a score.
2. **Explain every number.** Any computed score can be opened and traced to the evidence and weights that produced it. If it cannot be explained, it should not be shown.
3. **Evidence accumulates; nothing is overwritten.** Ratings are events with history. Explicit and computed values coexist. Scale changes and re-ratings never destroy what came before.
4. **Local-first is unconditional.** The app is fully usable offline with no account. Spotify and OneDrive are optional capability layers on top, and either can be absent or broken without breaking the product.
5. **Judging must be fast and physical.** The rating and comparison interactions are the product. They are optimised for repetition — keyboard on desktop, thumb on mobile — and must feel decisive.

## Accessibility & Inclusion

WCAG 2.2 AA is a requirement, not a goal. Full keyboard operation, touch targets sized for one-handed phone use, screen-reader-correct semantics and live regions, honoured reduced-motion preferences, and dark / light / system themes with stable contrast regardless of album artwork colour.
