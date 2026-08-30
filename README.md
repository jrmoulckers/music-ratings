# Ledger

A private ledger for what you actually think of music.

Ledger is a local-first, installable web app for rating the music in your Spotify
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

On first run choose **Explore with sample data**. That seeds a complete fictional
catalogue — invented artists, albums, playlists, shows and audiobooks, with a
plausible rating history — so every screen in the app is usable and testable
without a Spotify or Microsoft account. The sample data is clearly marked and can
be removed in one click without touching anything real.

> Use `127.0.0.1`, not `localhost`. Spotify rejects `localhost` as a redirect
> host. The dev server and preview server are both bound to `127.0.0.1` for this
> reason.

---

## Connecting Spotify

Ledger uses the **Authorization Code with PKCE** flow entirely in the browser.
There is no client secret, and one must never be added — a secret in a static site
is a published secret.

### 1. Create a Spotify app

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
   and select **Create app**.
2. Give it any name and description.
3. Under **Redirect URIs**, add the exact URL Ledger will return to:
   - Local development: `http://127.0.0.1:5173/callback`
   - Deployed: `https://your-domain.example/callback`
     (HTTPS is required for any non-loopback host.)
     The redirect URI must match **character for character**, including the trailing
     path and the absence of a trailing slash.
4. Under **Which API/SDKs are you planning to use?**, tick **Web API**.
5. Save, then copy the **Client ID**. There is no need to reveal the client secret.

### 2. Give the ID to Ledger

Either put it in `.env.local`:

```
VITE_SPOTIFY_CLIENT_ID=your_client_id
VITE_SPOTIFY_REDIRECT_URI=http://127.0.0.1:5173/callback
```

…or paste it into **Settings → Spotify** at runtime. The runtime value wins, which
makes it easy to hand a build to a tester who has their own app.

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

| Scope                                                  | Why                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `user-read-private`, `user-read-email`                 | Identify the signed-in account                                                             |
| `user-top-read`                                        | Top artists and tracks, for suggestions                                                    |
| `user-read-recently-played`                            | Recent plays, for suggestions                                                              |
| `user-library-read`                                    | Saved tracks, albums, shows, episodes, audiobooks                                          |
| `playlist-read-private`, `playlist-read-collaborative` | Your playlists and their tracks                                                            |
| `user-read-playback-position`                          | Only requested if you enable shows or episodes — Spotify requires it for podcast endpoints |

Ledger never requests write scopes. It cannot modify your library, your playlists,
or your playback.

---

## API limitations you should know about

Ledger deliberately does not use, work around, or simulate the Spotify endpoints
that were withdrawn from new applications on **27 November 2024**. Where a feature
would have depended on one, the app says so rather than approximating it. The
**Data health** screen lists these at runtime.

| Not available                                               | Consequence in Ledger                                                                                    |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Recommendations                                             | No "you might like" from Spotify. Exploration suggestions are rule-based and explain their own evidence. |
| Related Artists                                             | Similar-artist browsing is absent, not faked.                                                            |
| Audio Features / Audio Analysis                             | No tempo, key, energy or danceability anywhere. Ratings come from you, not from a spectral analysis.     |
| 30-second preview URLs                                      | No in-app previews. Every item deep-links to Spotify instead.                                            |
| Featured Playlists, Category Playlists, Editorial playlists | Only your own and explicitly-searched playlists appear.                                                  |

Other honest limits:

- **Recently played is capped at 50 items** by Spotify, and covers tracks only.
  Ledger stores each fetch so history accumulates over time on your device.
- **Audiobooks are available in the US, UK, Canada, Ireland, New Zealand and
  Australia only.** Outside those markets the entity type degrades to
  "unavailable" rather than silently returning nothing.
- **Some playlist items are unavailable in your market or have been deleted.**
  These are skipped and counted, not dropped silently.
- **Rate limits** return HTTP 429 with a `Retry-After` header, which Ledger honours
  with a visible countdown. In Development Mode a 429 can also mean the app's
  shared quota is exhausted; Ledger distinguishes the two.
- If a token expires or a scope is revoked, Ledger refreshes silently where it can
  and asks you to reconnect where it cannot. Partial imports are kept, never rolled
  back.

Ledger is not affiliated with or endorsed by Spotify. It stores no lyrics and no
audio, and makes no claims on Spotify's behalf.

---

## Connecting OneDrive (optional)

Sync is opt-in and uses a **sandboxed application folder** in your own OneDrive —
Ledger can read and write only its own folder, never the rest of your drive.

1. Register an application in the
   [Microsoft Entra admin centre](https://entra.microsoft.com) →
   **App registrations** → **New registration**.
2. Under **Supported account types**, choose
   _Accounts in any organizational directory and personal Microsoft accounts_.
3. Under **Redirect URI**, select the **Single-page application** platform and
   enter your app's origin (`http://127.0.0.1:5173` locally, or your deployed
   origin). Do not use the Web platform — it requires a secret.
4. Under **API permissions**, add the delegated Microsoft Graph permissions
   `Files.ReadWrite.AppFolder` and `User.Read`.
5. Copy the **Application (client) ID** into `VITE_ONEDRIVE_CLIENT_ID` or into
   **Settings → Sync**.

Use your own registration. Do not reuse a client ID from another project.

**How sync behaves.** Ledger writes a single JSON snapshot into the app folder.
Writes are guarded by the file's ETag, so two devices cannot silently overwrite
each other. When both have changed since they last agreed, Ledger stops, tells you,
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

The build output in `dist/` is a static site. Any static host works.

```bash
VITE_BASE_PATH=/ npm run build
```

For a GitHub Pages **project** site, set the base path to the repository name:

```bash
VITE_BASE_PATH=/music-ratings/ npm run build
```

Then register `https://<user>.github.io/music-ratings/callback` as the
Spotify redirect URI and `https://<user>.github.io` as the Entra SPA redirect URI.

The app is a single-page application with a history-API router, so the host must
serve `index.html` for unknown paths. On GitHub Pages the build emits a `404.html`
copy that does this automatically. On Netlify, Vercel, Cloudflare Pages and similar,
add the usual SPA rewrite to `/index.html`.

**HTTPS is required** in production for both the service worker and the OAuth
redirect.

---

## Privacy

- Ledger has **no backend**. No analytics, no telemetry, no error reporting, no
  third-party scripts.
- Your ratings, notes, tags, comparisons and settings are stored in **IndexedDB in
  your browser**, on your device.
- Data leaves your device in exactly two circumstances, both of which you choose:
  a request to Spotify's API for catalogue and library data, and a snapshot written
  to your own OneDrive app folder.
- Spotify tokens are held in browser storage on your device only. They are never
  transmitted anywhere except to Spotify.
- Album artwork is loaded directly from Spotify's CDN and cached by the service
  worker with a size and age ceiling. **Settings → Data saving** turns artwork off
  entirely.
- **Settings → Data** can export everything, import it elsewhere, or erase all of
  it — including revoking the Spotify connection and forgetting the OneDrive
  account.

---

## How it is built

- **Svelte 5** + **Vite** + **TypeScript**, no meta-framework, static output.
- `src/lib/domain/` is pure, framework-independent TypeScript: scales, Elo,
  containment graph, rating events, the rollup engine, suggestion scoring, insights
  and list building. It has no imports from Svelte or the DOM, and it is where the
  tests are concentrated.
- `src/lib/storage/` owns IndexedDB (via `idb`), schema migrations, snapshots and
  the sync protocol. `src/lib/spotify/` owns PKCE auth, the rate-limited API client,
  and mapping Spotify's shapes into the domain's.
- `src/lib/app/` is the reactive layer: one derived chain
  (`world → graph → ratings → rankings → scores → suggestions`) that every screen
  reads, so no screen decides for itself what an item's score is.
- Rating events are **immutable and temporal**. Every rating is normalised to 0–100
  on write, so changing your scale re-labels your history rather than rewriting it.
  Rankings are derived by replaying the comparison log, never stored.

See `PRODUCT.md` for what the product is, and `DESIGN.md` for how it looks and why.

---

## Licence

Personal project. No licence granted for redistribution.
