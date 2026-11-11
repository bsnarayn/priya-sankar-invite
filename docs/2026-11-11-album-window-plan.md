# Album Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce the album viewing window (reception hours, then permanent from 9 Dec) in the Worker, fix Worker-to-Immich access with a secret header, and move guest uploads behind the Worker so no Immich slug reaches a browser.

**Architecture:** A pure `albumState()` decides open/closed from the clock and three ISO config values. The Worker checks it before serving any view route, exposes it at `/api/album/status`, proxies uploads to Immich, and sends `X-Album-Key` on every Immich call so a Cloudflare WAF rule can block everything else. The album page reads status from the Worker instead of the browser clock.

**Tech Stack:** Cloudflare Worker (plain ES modules), Astro 7 static site, Node built-in test runner (`node --test`), no new dependencies.

**Spec:** `docs/2026-11-11-album-window-design.md`

## Global Constraints

- Window (IST, ISO with explicit offset): open `2026-11-28T18:00:00+05:30`, close `2026-11-28T23:00:00+05:30`, permanent `2026-12-09T00:00:00+05:30`. Start-inclusive, end-exclusive.
- Worker vars: `ALBUM_OPEN_AT`, `ALBUM_CLOSE_AT`, `ALBUM_PERMANENT_AFTER` (plain `[vars]`). Secret: `IMMICH_PROXY_KEY`. Header sent to Immich: `X-Album-Key`.
- Uploads are never time-gated. No notice about the window on the open album page. The notify-me form stays.
- Missing or unparseable window vars, or missing `IMMICH_PROXY_KEY` -> `500 {"message":"Album not configured"}`.
- Upload cap 25 MB; content type `multipart/form-data`; allowed Referers are the existing `ALLOWED_ORIGINS`.
- No new dependencies. Worker tests run with `cd worker && node --test`; site lib tests with `node --test src/lib/`.
- Do not commit or push unless the user says so, and never start/stop servers or run builds without asking (project rule). Push site changes (Tasks 4-5) only after the Worker is deployed.

## Review Focus

- Clock exactly on a boundary (open, close, permanent) -> Task 1 tests.
- Window vars missing or out of order -> Worker must fail loudly, never open or silently closed (Task 1 `parseWindowConfig`, Task 3 test).
- Closed window must not touch the edge cache, so cached thumbnails cannot leak (Task 3 test).
- Upload with no `Content-Length`, an oversize body, or a wrong content type (Task 2 tests).
- Immich/Cloudflare returns an HTML block page: the Worker must return a clean 502 JSON, not relay HTML as JSON (Task 2 + Task 3 tests).
- Request without a Referer to `/api/album/status` is still refused (Task 3 test).

## File Structure

- Create `worker/package.json` - `{"private": true, "type": "module"}` so `.js` files are ES modules for Node tests.
- Create `worker/src/album-window.js` + `album-window.test.js` - pure window logic.
- Create `worker/src/proxy-guards.js` + `proxy-guards.test.js` - pure upload and upstream-response checks.
- Modify `worker/src/index.js` + create `worker/src/index.test.js` - wiring and route tests.
- Modify `worker/wrangler.toml` - vars and secret docs.
- Modify `src/lib/immich-upload.ts`, `src/pages/camera/camera.astro`, `src/components/PhotoUpload.astro`, `src/env.d.ts`, `src/content/site/site.json`, `src/content.config.ts` - uploads via Worker, slug removed.
- Create `src/lib/album-gate-copy.js` + `album-gate-copy.test.js`; modify `src/pages/album.astro` - status-driven page.

---

### Task 1: Window logic (pure)

**Files:**
- Create: `worker/package.json`, `worker/src/album-window.js`
- Test: `worker/src/album-window.test.js`

**Interfaces:**
- Produces: `parseWindowConfig(env: {ALBUM_OPEN_AT?: string, ALBUM_CLOSE_AT?: string, ALBUM_PERMANENT_AFTER?: string}) -> {receptionOpenAt: string, receptionCloseAt: string, permanentAfter: string} | null` (null if any value is missing, unparseable, or not `open < close <= permanent`).
- Produces: `albumState(nowMs: number, cfg) -> {state: "open"|"closed", mode: "reception"|"permanent"|null, reason: "before"|"between"|null, opensAt: string|null, closesAt: string|null}`. `opensAt` = next opening ISO when closed (before -> receptionOpenAt, between -> permanentAfter); `closesAt` = receptionCloseAt during the reception window; both null once permanent.

- [ ] **Step 1: Write failing tests** in `album-window.test.js` using `node:test` and `node:assert/strict`, with `cfg` = the three spec values: before open (`2026-11-28T17:59:59.999+05:30`) -> closed/before/opensAt=open; exactly at open -> open/reception/closesAt=close; mid-window; one ms before close -> open; exactly at close -> closed/between/opensAt=permanent; one ms before permanent -> closed; exactly at permanent and a year later -> open/permanent, both null; offsets read as IST regardless of machine timezone (set `process.env.TZ` is not needed since ms are compared); `parseWindowConfig` returns null for a missing var, `"garbage"`, and `close <= open`; returns the cfg for the valid trio.
- [ ] **Step 2: Run** `cd worker && node --test` -> FAIL (module missing).
- [ ] **Step 3: Implement** both functions in `album-window.js` (`Date.parse` on the ISO strings; ordering check in `parseWindowConfig`).
- [ ] **Step 4: Run** `cd worker && node --test` -> all PASS.
- [ ] **Step 5: Commit** `worker/package.json worker/src/album-window.js worker/src/album-window.test.js` - "Add album window logic with tests".

### Task 2: Upload and upstream guards (pure)

**Files:**
- Create: `worker/src/proxy-guards.js`
- Test: `worker/src/proxy-guards.test.js`

**Interfaces:**
- Produces: `checkUploadRequest({referer: string, contentType: string, contentLength: string|null}, allowedOrigins: string[], maxBytes: number) -> {ok: true} | {ok: false, status: number, message: string}` (403 bad Referer, 415 not `multipart/form-data`, 411 missing/invalid length, 413 over `maxBytes`).
- Produces: `isCleanUpstream(status: number, contentType: string, expected: "json"|"image") -> boolean` (true for any status whose content type matches `expected`; false when it does not, e.g. an HTML block page).

- [ ] **Step 1: Write failing tests**: allowed Referer + `multipart/form-data; boundary=x` + length `1000` -> ok; Referer `https://evil.example/` -> 403; empty Referer -> 403; `application/json` -> 415; null length -> 411; `"abc"` -> 411; length `26214401` with max `26214400` -> 413; exactly `26214400` -> ok. `isCleanUpstream(403, "text/html; charset=UTF-8", "json")` -> false; `(200, "application/json; charset=utf-8", "json")` -> true; `(404, "application/json", "json")` -> true; `(200, "image/jpeg", "image")` -> true; `(403, "text/html", "image")` -> false.
- [ ] **Step 2: Run** `cd worker && node --test` -> FAIL.
- [ ] **Step 3: Implement** both in `proxy-guards.js`.
- [ ] **Step 4: Run** -> PASS.
- [ ] **Step 5: Commit** "Add upload and upstream guards with tests".

### Task 3: Worker wiring

**Files:**
- Modify: `worker/src/index.js` (the `/api/album/` block, `cachedImmichFetch`), `worker/wrangler.toml`
- Test: `worker/src/index.test.js`

**Interfaces:**
- Consumes: Task 1 `parseWindowConfig`, `albumState`; Task 2 `checkUploadRequest`, `isCleanUpstream`.
- Produces: `GET /api/album/status` -> `200` JSON `{state, mode, reason, opensAt, closesAt, receptionOpenAt, receptionCloseAt, permanentAfter}`, `Cache-Control: no-store`. `POST /api/album/upload` -> relays Immich's status and JSON. View routes `info`, `bucket`, `thumbnail/*` -> `403 {"state":"closed","opensAt":...}` when closed. Constants in `index.js`: `MAX_UPLOAD_BYTES = 25 * 1024 * 1024`, header name `X-Album-Key`.

Tests drive the exported `default.fetch(request, env, ctx)` with `globalThis.fetch` stubbed (records calls) and `globalThis.caches = {default: {match, put}}` stubbed. `env` has the three window vars, `IMMICH_BASE`, `IMMICH_SLUG`, `IMMICH_PROXY_KEY`. Use `Referer: https://priya.sankars.in/album` unless a test says otherwise. Control the clock by stubbing `Date.now`.

- [ ] **Step 1: Write failing tests**:
  - closed (before the window): `GET /api/album/info` -> 403 body `state:"closed"`; the stubbed `fetch` and `caches.default.match` were never called.
  - open (inside the window): `info` -> 200, and the recorded Immich `fetch` carried header `X-Album-Key` equal to `env.IMMICH_PROXY_KEY`.
  - `GET /api/album/status` closed and open -> correct `state`, `Cache-Control: no-store`, includes the three config ISO strings; same request with no Referer -> 403.
  - missing `ALBUM_OPEN_AT` (and separately missing `IMMICH_PROXY_KEY`) -> 500 `{"message":"Album not configured"}`.
  - `POST /api/album/upload` (multipart content type, `content-length: 1000`) while the album is closed -> forwarded to `${IMMICH_BASE}/api/assets?slug=${IMMICH_SLUG}` with `X-Album-Key`, response status relayed; oversize or JSON content type -> 413/415 and no upstream call.
  - upstream stub returns `403 text/html` for `info` -> Worker responds `502` with a JSON `message`, not HTML.
- [ ] **Step 2: Run** `cd worker && node --test` -> new tests FAIL.
- [ ] **Step 3: Implement** in `index.js`: build `cfg` via `parseWindowConfig(env)` once inside the `/api/album/` block after the Referer check, returning the 500 when it or `IMMICH_PROXY_KEY` is null; route order `status` -> `upload` -> closed-check (403) -> `info`/`bucket`/`thumbnail`; pass `{headers: {"X-Album-Key": ...}}` in `cachedImmichFetch` and the upload `fetch` (upload streams `request.body` with `duplex: "half"` and the original `Content-Type`); wrap JSON and image responses with `isCleanUpstream` and return a `502` JSON `{message: "Photo service unavailable"}` when it is false.
- [ ] **Step 4: Update `wrangler.toml`**: add a `[vars]` block with the three window values from Global Constraints, and extend the header comment to list `IMMICH_PROXY_KEY` (secret).
- [ ] **Step 5: Run** `cd worker && node --test` -> all PASS.
- [ ] **Step 6: Commit** "Gate album routes by window, proxy uploads, send X-Album-Key".

### Task 4: Uploads via the Worker, slug out of the browser

**Files:**
- Modify: `src/lib/immich-upload.ts`, `src/pages/camera/camera.astro`, `src/components/PhotoUpload.astro`, `src/env.d.ts`, `src/content/site/site.json`, `src/content.config.ts`

**Interfaces:**
- Consumes: Task 3 `POST /api/album/upload` (same origin, relative URL, multipart body with the same fields the code sends today).
- Produces: `ImmichConfig = {deviceId?: string, userId?: string}` (no `base`/`slug`); `uploadToImmich(file, config)` and `uploadFiles(files, config, onProgress)` keep their signatures.

No test runner covers these browser scripts; verification is by search and build.

- [ ] **Step 1:** In `immich-upload.ts`, drop `base`/`slug` from `ImmichConfig` and the empty-config guard, and POST to `/api/album/upload`.
- [ ] **Step 2:** In `camera.astro`, remove `immichBase`/`immichSlug` from the frontmatter, `define:vars`, `window.__CAM__`, the destructure, and `config`; keep `MAX_SHOTS`/`MAX_UPLOADS`. In `PhotoUpload.astro`, remove the two `data-immich-*` attributes, the Props fields, the dataset reads, and the "isn't set up" guard; config becomes `{deviceId: "WEB"}`. Update `env.d.ts` to match.
- [ ] **Step 3:** Remove `immich_base_url` and `immich_share_slug` from `site.json` and `content.config.ts`.
- [ ] **Step 4: Verify** `grep -rniE "immich_share_slug|immichSlug|immich_base|immichBase|data-immich" src` returns nothing; ask the user to run `npm run build` and confirm it passes.
- [ ] **Step 5: Commit** "Upload through the Worker so the Immich slug never reaches a browser".

### Task 5: Status-driven album page

**Files:**
- Create: `src/lib/album-gate-copy.js`
- Test: `src/lib/album-gate-copy.test.js`
- Modify: `src/pages/album.astro`, `src/content/site/site.json`, `src/content.config.ts` (remove `album_available_after`)

**Interfaces:**
- Consumes: Task 3 `/api/album/status` JSON.
- Produces: `gateCopy(status: {reason: "before"|"between", receptionOpenAt: string, receptionCloseAt: string, permanentAfter: string}) -> string`, formatted in IST (`Asia/Kolkata`), e.g. before: "The album opens during the reception on Sat 28 Nov, 6 pm to 11 pm, and again for good from 9 Dec."; between: "The album is closed for now. It opens again for good on 9 Dec." Page contract: `window.__albumOpen` is set true and `document` dispatches `album:open` once status is `open`.

- [ ] **Step 1: Write failing tests** for `gateCopy` with the spec values: the `before` and `between` strings above verbatim; the date shown is IST even when the process timezone is `America/Los_Angeles`.
- [ ] **Step 2: Run** `node --test src/lib/` -> FAIL.
- [ ] **Step 3: Implement** `gateCopy` with `Intl.DateTimeFormat("en-IN", {timeZone: "Asia/Kolkata", ...})`.
- [ ] **Step 4: Run** -> PASS.
- [ ] **Step 5: Edit `album.astro`**: remove `albumAvailableAfter` and `isAlbumLive`; the first script fetches `/api/album/status`; `open` -> hide gate, show album, set `window.__albumOpen = true`, dispatch `album:open`; `closed` -> fill `#gate-copy` (replacing the static paragraph, with a short no-JS fallback) via `gateCopy`; fetch failure or non-JSON -> gate with "We couldn't check the album just now, please try again." The second script runs `loadAlbum()` immediately if `window.__albumOpen`, otherwise on `album:open`; inside `loadAlbum`, any `403` from `/api/album/*` swaps back to the gate. Notify-me form unchanged. Import `gateCopy` from `../lib/album-gate-copy.js`.
- [ ] **Step 6:** Remove `album_available_after` from `site.json` and `content.config.ts`.
- [ ] **Step 7: Verify** `grep -rn "album_available_after\|albumAvailableAfter" src` returns nothing; ask the user to run `npm run build`; ask the user to check `/album` against the live Worker after deploy (see Rollout).
- [ ] **Step 8: Commit** "Make the album page read its open/closed state from the Worker".

---

## Rollout (done by the user, in this order)

1. Generate a key (`openssl rand -hex 24`); `cd worker && wrangler secret put IMMICH_PROXY_KEY`.
2. `wrangler deploy` (Tasks 1-3). Old site still works: the old rule does not cover `/api/assets`.
3. Push the site (Tasks 4-5); wait for the Pages deploy.
4. Cloudflare WAF: add the new header rule from the spec (it covers `slug=`, `key=` and the share headers, with the key), then delete the old Referer rule.
5. Verify: `curl -H "Referer: https://priya.sankars.in/album" https://priya.sankars.in/api/album/status` shows the right state; `info` is 200 in the window and 403 outside (rehearse by editing the vars); from a phone on mobile data, `https://photos.sankaranarayan.in/api/shared-links/me?slug=...` and `/api/timeline/bucket?...slug=...` are blocked; a camera upload succeeds; `grep -r "priya-sankar-reception" dist/client` finds nothing.
6. Required: new Immich share link (uploads allowed), update `IMMICH_SLUG`, then delete the old link (its slug is public and Immich also exposes a share key).

## Self-Review notes

- Spec coverage: window table (Task 1), status route and 403 gating (Task 3), upload route and caps (Tasks 2-3), `X-Album-Key` (Task 3), clean 502 on HTML (Tasks 2-3), `wrangler.toml` vars (Task 3), slug removal and `site.json` fields (Task 4), gate copy and mid-session 403 (Task 5), WAF rule, rotation and production checks (Rollout).
- Names are consistent across tasks: `parseWindowConfig`, `albumState`, `checkUploadRequest`, `isCleanUpstream`, `gateCopy`, `X-Album-Key`, `IMMICH_PROXY_KEY`.
