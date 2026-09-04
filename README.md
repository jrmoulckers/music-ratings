# Music Ratings

A private record of what you actually think of music.

**Live:** <https://rank.jrmoulckers.com/> — try it without connecting
anything; the demo mode is the whole app on seeded fictional data.

Music Ratings is a local-first, installable web app for rating the music in your Spotify
library — and, more importantly, for turning a pile of disconnected scores into an
honest ordering of your real favourites and least favourites. It does that with a
hybrid method: direct ratings on a scale you choose, plus occasional head-to-head
comparisons where a flat score cannot separate two things you love.

Your ratings are yours. They live in your browser and, if you want, in a sandboxed
folder in your own OneDrive. There is no server, no account, and no database
belonging to anyone but you.

---

## What it does

- **Rate** anything Spotify exposes — artists, albums, tracks, playlists, and
  (where the API permits) shows, episodes, audiobooks and chapters — on a scale
  you pick: stars, half-stars, 1–3/5/10/100, decimal, thumbs, or your own labelled
  ordinal scale.
- **Compare** two items head-to-head when a score is not decisive. Comparisons
  drive a per-type Elo ladder that reports its own uncertainty.
- **Roll up** child ratings into parents through a transparent, deterministic
  engine. Every computed score can explain itself, channel by channel, including
  what it excluded and why.
- **Suggest** what to rate next from your own listening: recent plays, top items,
  saved library, unrated children of things you have already rated, ratings gone
  stale, rankings that are still uncertain, and coverage gaps.
- **Show you your taste** — polarising artists, hidden gems, drift over time,
  completion gaps, stable versus uncertain rankings — computed locally from your
  own data by rules you can read.
- **Combine duplicates.** The same record reaches a library several times over —
  an original, a remaster, a regional edition, the same song again on a
  compilation. Declare them one thing and they become one row everywhere: one
  entry in every list, one candidate in every comparison, one child in every
  rollup. Nothing is deleted, every source keeps its own Spotify link, and where
  two of them were rated the two ratings are averaged into one new entry with
  both originals left in your history. It comes apart again, and separating puts
  every rating back.
- **Rate what is playing.** Music Ratings is a Spotify Connect remote: transport,
  devices, queue, and — if you want it — this browser as a Connect device of its
  own. Rate the track, the record and the performer without leaving the music, and
  sit with an album track by track while it plays.
- **Keep a record of what you actually played**, taken only from Spotify's
  recently-played list, and tell you what it shows: most played tracks, releases
  and artists, how much of a record or an artist's catalogue you have heard,
  repeat listening, what is new, and where your listening and your ratings
  disagree. When every available track on one album edition has a confirmed play
  inside the completion window, the record is marked finished and offered for a
  rating — once, when the last track lands.
- **Work offline**, install to your home screen or dock, and sync between your own
  devices through your own OneDrive.

Explicit ratings and computed rollups are stored separately and never overwrite
each other. You can view either alone, or blended.

---

## Quick start

```bash
npm install
npm run dev
```

Then open <http://127.0.0.1:5173>.

On first run you choose whether to connect Spotify. Connecting it fills the rating
queue from your own listening; skipping it gives you an empty library that you can
fill by hand, or by restoring a backup from Settings.

There is no sample catalogue. Everything you see in the app is either your own
data or something you fetched from Spotify yourself.

> Use `127.0.0.1`, not `localhost`. Spotify rejects `localhost` as a redirect
> host. The dev server and preview server are both bound to `127.0.0.1` for this
> reason.

---

## Connecting Spotify

Music Ratings uses the **Authorization Code with PKCE** flow entirely in the browser.
There is no client secret, and one must never be added — a secret in a static site
is a published secret.

**Most people can skip this whole section.** The deployed app ships a Spotify
application ID, so the front door is a single **Sign in with Spotify** button and
nothing needs registering. Read on only if that sign-in turns you away — Spotify's
development mode authorises a small fixed number of accounts — or if you would
rather ask as your own application.

### 1. Create a Spotify app

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
   and select **Create app**.
2. Give it any name and description.
3. Under **Redirect URIs**, add the exact URL this app will return to:
   - Local development: `http://127.0.0.1:5173/callback`
   - Deployed: `https://rank.jrmoulckers.com/callback`
     (HTTPS is required for any non-loopback host.)
     The redirect URI must match **character for character**, including the trailing
     path and the absence of a trailing slash.
4. Under **Which API/SDKs are you planning to use?**, tick **Web API**.
5. Save, then copy the **Client ID**. There is no need to reveal the client secret.

### 2. Give the ID to the app

Either paste it into **Settings → Spotify → Use my own Spotify app instead**, which
takes effect immediately and overrides whatever the build ships…

…or bake it into a build of your own via `.env.local`:

```
VITE_SPOTIFY_CLIENT_ID=your_client_id
VITE_SPOTIFY_REDIRECT_URI=http://127.0.0.1:5173/callback
```

The runtime value always wins over the build's, which makes it easy to hand a
deployed build to someone who has their own app.

### 3. Add your testers

New Spotify apps start in **Development Mode**, which allows **a maximum of 25
listed users**, and in practice Spotify has been approving far fewer for new
apps — plan on about five. Add each tester under **User Management** using the
email address on their Spotify account _and_ their Spotify display name. They must
each accept before the app will work for them.

Two further constraints worth knowing before you invite anyone:

- The **app owner's Spotify account must be Premium**. This is checked at app
  creation and enforced on the dashboard.
- Leaving Development Mode requires an **extended quota mode** request, which
  Spotify grants only to organisations, generally with 250,000+ monthly active
  users. For a private tool used by a handful of people, Development Mode is the
  permanent, intended home.

### Scopes requested

| Scope                                                     | Why                                                                                                   |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `user-read-private`, `user-read-email`                    | Identify the signed-in account                                                                        |
| `user-top-read`                                           | Top artists and tracks, for suggestions                                                               |
| `user-read-recently-played`                               | Recent plays, for suggestions                                                                         |
| `user-library-read`                                       | Saved tracks, albums, shows, episodes, audiobooks                                                     |
| `playlist-read-private`, `playlist-read-collaborative`    | Your playlists and their tracks                                                                       |
| `user-read-playback-position`                             | Only requested if you enable shows or episodes — Spotify requires it for podcast endpoints            |
| `user-read-playback-state`, `user-read-currently-playing` | Read what is playing, on which device, for Now Playing                                                |
| `user-modify-playback-state`                              | The transport controls: play/pause, skip, seek, volume, shuffle, repeat, queue, transfer              |
| `streaming`                                               | **Only** when you turn on the browser player in Settings — it makes this tab a Spotify Connect device |

Music Ratings requests no scope that can change your library. `user-modify-playback-state`
controls playback only: it cannot save, unsave, or edit a playlist. `streaming` is not
requested at all until you ask for the browser player.

**Playback needs Spotify Premium.** Reading what is playing works on any account; every
control — including the browser player — is Premium-only, and Spotify returns a clear
refusal otherwise, which the app shows you rather than swallowing.

If you connected before playback existed, your stored token has none of the three player
scopes. Now Playing says so and offers **Reconnect Spotify**; there are no mysterious 403s.

---

## API limitations you should know about

Music Ratings deliberately does not use, work around, or simulate the Spotify endpoints
that were withdrawn from new applications on **27 November 2024**, nor those removed
from Development Mode apps in **February 2026**. Where a feature would have depended
on one, the app says so rather than approximating it. The **Data health** screen lists
these at runtime.

| Not available                                               | Consequence here                                                                                         |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Recommendations                                             | No "you might like" from Spotify. Exploration suggestions are rule-based and explain their own evidence. |
| Related Artists                                             | Similar-artist browsing is absent, not faked.                                                            |
| Audio Features / Audio Analysis                             | No tempo, key, energy or danceability anywhere. Ratings come from you, not from a spectral analysis.     |
| 30-second preview URLs                                      | No in-app previews. Every item deep-links to Spotify instead.                                            |
| Featured Playlists, Category Playlists, Editorial playlists | Only your own and explicitly-searched playlists appear.                                                  |

Other honest limits:

- **Search returns at most 10 results per entity type.** Spotify cut the search page
  size from 50 to 10 for Development Mode apps in
  [February 2026](https://developer.spotify.com/documentation/web-api/references/changes/february-2026);
  asking for more is refused outright.
- **Contents of playlists you neither own nor collaborate on are no longer readable.**
  Since February 2026 Spotify returns only metadata for them, so such a playlist can
  still be rated on its own but has no track breakdown to roll up.
- **Popularity, follower counts, labels and available-markets lists are gone** from
  Spotify responses. Music Ratings never scored on them, so nothing about your
  results changes.
- **Recently played is capped at 50 items** by Spotify, and covers tracks only.
  Music Ratings stores each fetch so history accumulates over time on your device.
  This makes the listening record a log of what this app observed, not a lifetime
  history: anything played while the app was closed for a while was never visible
  to it. Every figure on the Listening screen is qualified by the date observation
  started, and a fetch that comes back full is recorded as a possible gap rather
  than passed off as complete.
- **There is no listener percentile or population comparison** in the Spotify API.
  Music Ratings therefore never shows a "top 1% listener" figure. It reports only
  shares of your own observed listening, always with the numerator and denominator
  visible — `18% of your observed plays`, `34 of 52 known tracks`.
- **Listening time is estimated from track lengths**, because recently-played says
  a track was played, not how much of it was heard. It is labelled as an estimate
  everywhere it appears.
- **Audiobooks are available in the US, UK, Canada, Ireland, New Zealand and
  Australia only.** Outside those markets the entity type degrades to
  "unavailable" rather than silently returning nothing.
- **Some playlist items are unavailable in your market or have been deleted.**
  These are skipped and counted, not dropped silently.
- **Rate limits** return HTTP 429 with a `Retry-After` header, which Music Ratings honours
  with a visible countdown. In Development Mode a 429 can also mean the app's
  shared quota is exhausted; Music Ratings distinguishes the two.
- If a token expires or a scope is revoked, Music Ratings refreshes silently where it can
  and asks you to reconnect where it cannot. Partial imports are kept, never rolled
  back.

Music Ratings is not affiliated with or endorsed by Spotify. It stores no lyrics and no
audio, and makes no claims on Spotify's behalf.

### Now Playing and the browser player

- **Playback is Premium-only.** Free accounts can see what is playing; controls
  return a refusal, which the app shows on the disabled control itself.
- **Something must already be playing, or a device must be awake.** Spotify has no
  "wake my phone" API. With no device, Music Ratings offers the three real
  recoveries: open Spotify somewhere, look again, or turn this browser into a device.
- **Spotify reports what each device and track disallow** (`actions.disallows`).
  Music Ratings disables those controls with the reason attached rather than letting
  the press fail. Ads, local files and private sessions are handled the same way.
- **The browser player is opt-in.** Turning it on in Settings adds the `streaming`
  scope and asks you to reconnect; the Web Playback SDK is downloaded only then, and
  never for people who only remote-control another device. Browsers require a real
  tap before audio starts, and iOS Safari is unreliable for it — remote-controlling
  a phone or speaker is the better path there. Closing the tab removes the device.
- **Polling, not push.** Spotify has no playback webhook, so Music Ratings reads
  state every 4s while playing and 15s while paused, drops to 10s/45s in
  data-saving mode, and stops entirely when the tab is hidden or the device is
  offline. Progress is interpolated locally between reads, so the clock moves
  smoothly without extra requests.
- **Playback state is never stored or synced.** It belongs to the device you are on.
  Ratings you make while listening are ordinary rating events and sync normally.
- **Without Spotify connected, playback is simulated** from your own catalogue so
  the whole experience — transport, queue, album mode, live rating — works and can
  be judged before you connect anything. It is labelled demo playback throughout.

---

## Connecting OneDrive (optional)

Sync is opt-in. Turn it on in **Settings → Your copy in OneDrive** and press
**Sign in with Microsoft** — the deployed app ships a Microsoft application ID, so
there is nothing to register. You sign in with your own Microsoft account and the
backup goes to your own drive.

### Getting your ratings back on a new device

Setup's first page offers **Restore my ratings from OneDrive**. Sign in with the
same Microsoft account and the backup comes down; if it holds anything, the rest of
setup is skipped, because what you rate and on what scale were answered on the
other device and travel in the file.

If that account has no backup yet — a first device, or the wrong account — nothing
is overwritten. Sync stays on so this device starts backing itself up, and setup
carries on normally.

### Where the backup lives

Two choices, and the choice decides what permission is asked for at sign-in:

| Mode                                         | Where                                             | Permission requested                     |
| -------------------------------------------- | ------------------------------------------------- | ---------------------------------------- |
| **A folder only this app can see** (default) | `Apps/Music Ratings/`                             | `Files.ReadWrite.AppFolder`, `User.Read` |
| **A folder I choose**                        | Any path you name, e.g. `Documents/Music Ratings` | `Files.ReadWrite`, `User.Read`           |

The sandboxed app folder is the default because it is the one arrangement where
this app genuinely cannot read the rest of your drive. Choosing your own folder is
a real trade: Microsoft Graph has no way to scope a delegated grant to a single
folder, so naming your own folder necessarily asks for read and write across the
drive. Microsoft's consent screen says so plainly when it asks, and switching modes
asks again rather than inheriting the older, narrower grant. A folder you name is
created for you, and recreated if you delete it.

### Using your own app registration

Only needed if you would rather not use the shipped one.

1. Register an application in the
   [Microsoft Entra admin centre](https://entra.microsoft.com) →
   **App registrations** → **New registration**.
2. Under **Supported account types**, choose
   _Accounts in any organizational directory and personal Microsoft accounts_.
3. Under **Redirect URI**, select the **Single-page application** platform and
   enter the app's callback address — the same one Spotify uses, because both
   providers return to the same route: `http://127.0.0.1:5173/callback` locally,
   or `https://rank.jrmoulckers.com/callback` when deployed.
   Do not use the Web platform — it requires a secret.
4. No **API permissions** need configuring. Scopes are requested at sign-in, so the
   registration does not need to know in advance which folder mode you will pick.
5. Copy the **Application (client) ID** into
   **Settings → Your copy in OneDrive → Use my own Microsoft app instead**, or into
   `VITE_ONEDRIVE_CLIENT_ID` for a build of your own. The runtime value wins.

**How sync behaves.** Music Ratings writes a single JSON snapshot into the chosen folder.
Writes are guarded by the file's ETag, so two devices cannot silently overwrite
each other. When both have changed since they last agreed, Music Ratings stops, tells you,
and asks which side wins — it never merges by guessing. Per-record merging uses
last-write-wins on `updatedAt`, and deletions are tombstoned so a delete on one
device is not resurrected by another. MSAL is loaded only when you first connect,
so the 245 kB auth library costs nothing to anyone who does not use sync.

If you would rather not connect anything: **Settings → Data** exports the same
JSON snapshot to a file and imports it back on any device.

---

## Scripts

| Command                           | Does                                                        |
| --------------------------------- | ----------------------------------------------------------- |
| `npm run dev`                     | Dev server on `127.0.0.1:5173`                              |
| `npm run build`                   | Production build into `dist/`                               |
| `npm run preview`                 | Serve the production build                                  |
| `npm run check`                   | `svelte-check` — types across `.ts` and `.svelte`           |
| `npm run lint`                    | ESLint                                                      |
| `npm run format` / `format:check` | Prettier                                                    |
| `npm test`                        | Vitest (unit tests for the domain, storage and sync layers) |
| `npm run verify`                  | format:check → lint → check → test → build                  |

`npm run verify` is what CI runs.

---

## Deployment

The live site is <https://rank.jrmoulckers.com/>.

### GitHub Pages

`.github/workflows/deploy.yml` builds and publishes on every push to `main`, and
on demand from the Actions tab. Production is built for `/` because the custom
domain serves the app at the origin root. `public/CNAME` is copied into every
uploaded artifact so deployments retain `rank.jrmoulckers.com`.

Pages itself has to be switched on once by a person — the workflow's token is
not allowed to create the site. In **Settings → Pages**, set the source to
**GitHub Actions**. Every push after that deploys on its own.

Nothing secret is involved. The build carries a Spotify and a Microsoft client ID
so that signing in needs no setup, and neither is a secret: both are OAuth public
clients guarded by PKCE and a redirect-URI allowlist, which is why they are safe to
commit. See `src/lib/config.ts`.

A fork can point at its own applications without editing code by setting the
repository **variables** `VITE_SPOTIFY_CLIENT_ID` and `VITE_ONEDRIVE_CLIENT_ID`
(Settings → Secrets and variables → Actions → Variables); the deploy workflow
passes them to the build. Use variables rather than secrets — Actions masks a
secret as `***`, which would be baked into the bundle as a broken ID. Leaving them
unset is fine and keeps the committed IDs. Either can also be overridden per user
in **Settings**, which lets a tester point the app at their own registration.

### Register the two redirect URIs by hand

OAuth providers match a redirect URI character for character against a list you
maintain, so a deployment is not connected until both are registered:

| Provider             | Redirect URI                            |
| -------------------- | --------------------------------------- |
| Spotify (dashboard)  | `https://rank.jrmoulckers.com/callback` |
| Entra (SPA platform) | `https://rank.jrmoulckers.com/callback` |

Locally both are `http://127.0.0.1:5173/callback`. Add both entries to each app
registration so one registration serves development and the deployed site.
The old `https://jrmoulckers.github.io/music-ratings/callback` entry may remain
temporarily during cutover, but it is not the canonical production callback and
should be removed after the custom-domain deployment is stable.

GitHub redirects the old project URL to the custom domain once Pages accepts the
domain. Service workers are origin-scoped, so the old `github.io` worker cannot
control or cache responses from `rank.jrmoulckers.com`.

### Any other static host

```bash
VITE_BASE_PATH=/ npm run build
```

`dist/` is a static site; serve it from anywhere. Set `VITE_BASE_PATH` to the
subdirectory if it is not served from the root — every asset URL, the manifest
`start_url` and `scope`, and the service worker's navigation fallback are all
built from it.

The app is a single-page application with a history-API router, so the host must
serve `index.html` for unknown paths. On GitHub Pages the build emits a `404.html`
copy that does this automatically. On Netlify, Vercel, Cloudflare Pages and similar,
add the usual SPA rewrite to `/index.html`.

**HTTPS is required** in production for both the service worker and the OAuth
redirect.

---

## Privacy

- Music Ratings has **no backend**. No analytics, no telemetry, no error reporting, no
  third-party scripts.
- Your ratings, notes, tags, comparisons and settings are stored in **IndexedDB in
  your browser**, on your device.
- Data leaves your device in exactly two circumstances, both of which you choose:
  a request to Spotify's API for catalogue and library data, and a snapshot written
  to a folder in your own OneDrive — by default one sandboxed to this app.
- Spotify tokens are held in browser storage on your device only. They are never
  transmitted anywhere except to Spotify.
- Album artwork is loaded directly from Spotify's CDN and cached by the service
  worker with a size and age ceiling. **Settings → Data saving** turns artwork off
  entirely.
- **Settings → Data** can export everything, import it elsewhere, or erase all of
  it — including revoking the Spotify connection and forgetting the OneDrive
  account.
- **Listening history is optional and separately erasable.** Turning off
  **Settings → Listening → Keep a record of what I played** stops new plays being
  recorded. **Delete listening history** removes the log and the completions on
  their own, leaving every rating untouched, and writes tombstones so the deletion
  reaches your other devices instead of being undone by the next sync. A retention
  setting can cap how far back the log is kept, and the log can be exported by
  itself.

---

## How it is built

- **Svelte 5** + **Vite** + **TypeScript**, no meta-framework, static output.
- `src/lib/domain/` is pure, framework-independent TypeScript: scales, Elo,
  containment graph, rating events, the rollup engine, suggestion scoring, insights
  and list building. It has no imports from Svelte or the DOM, and it is where the
  tests are concentrated. Album completion and the listening aggregates live here
  too, as pure functions over a play log, so what the app claims about your
  listening can be tested without a browser or an account.
- `src/lib/listening/` is the only door between Spotify's recently-played endpoint
  and the durable log: it deduplicates by a deterministic play identity, folds
  coverage, and re-evaluates completion for the touched albums alone rather than
  recomputing everything.
- `src/lib/storage/` owns IndexedDB (via `idb`), schema migrations, snapshots and
  the sync protocol. `src/lib/spotify/` owns PKCE auth, the rate-limited API client,
  and mapping Spotify's shapes into the domain's.
- `src/lib/app/` is the reactive layer: one derived chain
  (`world → canonical → graph → ratings → rankings → scores → suggestions`) that
  every screen reads, so no screen decides for itself what an item's score is.
- Rating events are **immutable and temporal**. Every rating is normalised to 0–100
  on write, so changing your scale re-labels your history rather than rewriting it.
  Rankings are derived by replaying the comparison log, never stored.
- Combining duplicates is a **resolution rule, not an edit**. A canonical group
  names the sources and which of them is primary; its primary's own id is the
  canonical id, so no invented identifier ever reaches a rating, a comparison or
  a URL. Every stored row keeps the subject it was written against and the
  derived chain resolves source ids as it reads, which is why a combine — or an
  uncombine, or changing the primary — costs one small record and loses nothing.

See `PRODUCT.md` for what the product is, and `DESIGN.md` for how it looks and why.

---

## Licence

Personal project. No licence granted for redistribution.
