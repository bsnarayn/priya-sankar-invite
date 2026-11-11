# Album window (reception hours + permanent open) - design

Status: implemented. The Worker was deployed on 2026-11-11 by pasting
`worker/src/index.js` into the Cloudflare dashboard editor and adding the secrets
and window dates there. Still to do: push the site, swap the WAF rule, rotate the
Immich share link (see Rollout order). Everything is one file, `worker/src/index.js`
(helpers `parseWindowConfig`, `albumState`, `isAllowedReferer`,
`checkUploadRequest`, `isCleanUpstream` sit above the routes), tested through the
fetch handler in `worker/src/index.test.js`.
Reception: 28 Nov 2026, 6-9 pm IST, New Woodlands Hotel, Chennai.

## Goal

1. Guests can view the shared album during the reception (and a buffer after), then
   it locks again until it opens permanently on 9 Dec 2026.
2. The window is actually enforced, not just hidden in the page.
3. Album viewing works in production (it does not today, see Findings).

## Decisions

| Now (IST) | State |
|---|---|
| before 28 Nov 2026 18:00 | closed |
| 28 Nov 18:00 up to 23:00 | open (reception window) |
| 28 Nov 23:00 up to 9 Dec 00:00 | closed |
| from 9 Dec 2026 00:00 | open permanently |

- Window 18:00-23:00 is reception hours plus a 2h buffer. Start-inclusive,
  end-exclusive.
- Permanent go-live is 9 Dec 2026 (the n8n Config was right; `site.json` said 2 Dec).
- The permanent album and its notify-me form stay. The notify-me sign-up feeds the
  "Album is Ready" email n8n sends once the permanent date passes.
- Uploads are never time-gated (guests can upload any time, as today).
- No notice about the window on the open album page.
- Enforcement: a secret header checked by Cloudflare WAF, plus the Worker window
  check. Rotating the Immich share link is REQUIRED (the old slug is public, and
  Immich's shared-link response also carries a share `key`; see Findings).

## Findings (checked 2026-11-11)

- A Cloudflare WAF custom rule blocks requests to `photos.sankaranarayan.in` whose
  path contains `/api/shared-links` unless the `Referer` contains
  `priya.sankars.in` or `priya-sankar.pages.dev`. A phone on mobile data gets the
  Cloudflare "you have been blocked" page for that path; `/s/<slug>` (the share
  page) sits behind a Cloudflare Access login.
- That rule also blocks the Worker: its `fetch()` to Immich sends no `Referer`.
  Calling `https://priya.sankars.in/api/album/info` with the invite Referer returns
  403 carrying Cloudflare's block page, so **album viewing is broken in production**.
  It has gone unnoticed because `album.astro` hides the album behind a client-side
  date check until `site.json: album_available_after`.
- `/api/album/bucket` reached Immich unblocked (it returned Immich's 400 for a
  missing albumId), so the rule covers only `/api/shared-links`. The timeline,
  thumbnail and upload calls are not covered.
- The Immich slug (`site.json: immich_share_slug`) is sent to every guest's browser
  by `camera.astro` and `PhotoUpload.astro`, which upload straight to Immich with
  `?slug=`. It is also in the repo and its history.
- A `Referer` check is easy to fake and "contains" is loose, so it is a speed bump,
  not a gate.
- The Worker's `/api/album/info` used to relay Immich's whole shared-link object to
  the browser. A live response has top-level fields `id, description, password,
  userId, key, type, createdAt, expiresAt, assets, album, allowUpload,
  allowDownload, showMetadata, slug`, i.e. the share `key` and `slug` were being
  handed to every viewer. The Worker now passes on only `album.id`, `startDate`,
  `endDate` and `assetCount`, and only caches responses of the expected type.

## Design

### Cloudflare WAF (done by you in the dashboard)

Replace the existing Referer rule with a header-secret rule. Block when:

```
(http.host eq "photos.sankaranarayan.in")
and (
  http.request.uri.query contains "slug="
  or http.request.uri.query contains "key="
  or any(http.request.headers.names[*] eq "x-immich-share-key")
  or any(http.request.headers.names[*] eq "x-immich-share-slug")
)
and not (any(http.request.headers["x-album-key"][*] eq "<IMMICH_PROXY_KEY value>"))
```

- Immich accepts a share credential as the `slug` or `key` query parameter and
  (to be verified against the deployed Immich version) the `x-immich-share-key` /
  `x-immich-share-slug` headers, so the rule covers all four; a rule on `slug=`
  alone can be bypassed with a `key` or a header.
- The Worker's own calls (`info`, `bucket`, `thumbnail`, upload) carry `slug=` and
  the secret header, so they pass.
- Your own Immich web and app traffic uses logins, not share credentials, so it is
  unaffected. Opening a share link directly in a browser is blocked by design
  (it was already behind the Access login).
- The old Referer rule must be removed (it blocks the Worker), but only after the
  new rule is in place.
- `IMMICH_PROXY_KEY` is a long random value (for example `openssl rand -hex 24`).
  It lives only as a Worker secret and inside the WAF rule; never in the repo.

### Worker (`worker/src/`)

- Pure helper `albumState(nowMs, cfg)` (in `index.js`) returning
  `{ state: "open" | "closed", mode: "reception" | "permanent" | null,
  reason: "before" | "between" | null, opensAt: ISO | null, closesAt: ISO | null }`.
  `cfg` = `receptionOpenAt`, `receptionCloseAt`, `permanentAfter` parsed from
  ISO-8601 strings with an explicit `+05:30` offset. No I/O, no globals.
- `[vars]` in `wrangler.toml` (not secrets; the deployed Worker has them entered
  in the dashboard as Secrets, which behaves the same): `ALBUM_OPEN_AT =
  "2026-11-28T18:00:00+05:30"`, `ALBUM_CLOSE_AT = "2026-11-28T23:00:00+05:30"`,
  `ALBUM_PERMANENT_AFTER = "2026-12-09T00:00:00+05:30"`.
- Secret `IMMICH_PROXY_KEY`. Every Worker request to Immich (`cachedImmichFetch`
  and the upload) adds `X-Album-Key: <IMMICH_PROXY_KEY>`.
- Inside the existing `/api/album/*` block, after the Referer check:
  - Missing or unparseable window vars, or missing `IMMICH_PROXY_KEY` ->
    `500 {message: "Album not configured"}` (fail loudly).
  - `GET /api/album/status` -> the state object plus `permanentAfter`, with
    `Cache-Control: no-store`. Never gated.
  - `info`, `bucket`, `thumbnail/*` -> `403 {state: "closed", ...}` when closed.
    The check runs before `cachedImmichFetch`, so edge-cached thumbnails are
    unreachable outside the window.
  - New `POST /api/album/upload` (not time-gated): checks the Referer, requires
    `multipart/form-data`, rejects bodies over 25 MB, then streams the request
    body to `{IMMICH_BASE}/api/assets?slug={IMMICH_SLUG}` with the secret header
    and relays Immich's status and JSON. `checkUploadRequest()` holds the
    Referer/type/size rules.
  - The Worker passes Immich's real status through, but never relays a Cloudflare
    HTML block page as `application/json` (map a non-JSON upstream error to a clean
    `502 {message}`), so a misconfigured rule shows up as an obvious error.
- Update the header comment in `wrangler.toml` to document the three vars and the
  new secret.

### Site (`src/`)

- `lib/immich-upload.ts`: `uploadToImmich` posts to same-origin
  `/api/album/upload`; the `base`/`slug` config and the empty-config guard go away.
- `camera/camera.astro` and `components/PhotoUpload.astro`: stop reading and passing
  `immichBase` / `immichSlug` (`window.__CAM__`, `data-immich-slug`).
- `content/site/site.json` and `content.config.ts`: remove `immich_base_url`,
  `immich_share_slug`, and `album_available_after`.
- `pages/album.astro`: replace the browser-clock check with
  `fetch("/api/album/status")`. `open` -> album; `closed` -> gate. A failed status
  fetch shows the gate with a "couldn't check, try again" line, never the album.
  Gate copy is built from the returned times (formatted in IST, not hardcoded):
  - before: "The album opens during the reception on <date>, <open>-<close>, and
    again for good from <permanent date>." + notify-me form.
  - between: "The album is closed for now. It opens again for good on <permanent
    date>." + notify-me form.
  If any album request returns 403 while the page is open (window closed
  mid-session), switch to the gate instead of showing broken images.
- `pages/camera/index.astro`: copy already says the album opens during the
  reception; keep it.

## Rollout order

1. Create `IMMICH_PROXY_KEY` and add it to the Worker as a Secret (dashboard, or
   `wrangler secret put IMMICH_PROXY_KEY`).
2. Deploy the Worker (new route, header, window vars). The old site keeps uploading
   straight to Immich, which the old rule does not cover, so nothing breaks.
3. Deploy the site (uploads now go through `/api/album/upload`).
4. In Cloudflare WAF: add the new header rule, then delete the old Referer rule.
5. Verify (below).
6. Required: create a new Immich share link (uploads allowed), set `IMMICH_SLUG`
   to it, then delete the old `priya-sankar-reception` link. The old slug is in git
   history and in every guest's cached camera page, and Immich's shared-link
   response also exposes a share `key` (the Worker no longer relays it, but the
   old link's key may already have been seen). A new link means a new slug and a
   new key. Do this before the reception, after step 5's test upload works.

Risks:
- Doing step 4 before step 3 breaks guest uploads (browser uploads carry no secret).
- Doing step 4 with the wrong secret blocks the Worker; the 502/403 will be visible.
- Missing Worker vars -> album routes 500 until fixed (intentional).
- Accepted limit: thumbnails a browser already cached (7 days, `immutable`) stay
  in that browser.
- The 18:00-23:00 buffer is a one-line var change.

## Testing

- `worker/src/album-window.test.js` (`node --test worker/src`, no new
  dependencies). `albumState`: before open; exactly at open; mid-window; one ms
  before close; exactly at close; between close and permanent; exactly at
  permanent; after permanent; invalid or missing config; offsets read as IST
  regardless of the machine timezone.
- `checkUploadRequest`: allowed and disallowed Referer, wrong content type,
  oversize body, missing content-length.
- `astro build` passes (run by the user).
- After deploy (production):
  - `GET https://priya.sankars.in/api/album/status` returns the right state (edit
    the vars to rehearse each state).
  - With the invite Referer, `/api/album/info` returns 200 JSON inside the window
    and 403 `{state:"closed"}` outside it.
  - From a phone on mobile data, a direct
    `https://photos.sankaranarayan.in/api/timeline/bucket?slug=...` or
    `/api/shared-links/me?slug=...` is blocked by Cloudflare.
  - A test upload from the camera page succeeds.
  - `grep` the built `dist/client` output for the slug: no matches.
