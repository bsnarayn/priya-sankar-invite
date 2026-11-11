// Route-level tests: everything is driven through the Worker's fetch handler
// with fetch() and the edge cache stubbed, so the window logic, the upload
// guards and the upstream checks are tested exactly as they run.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "./index.js";

const OPEN = "2026-11-28T18:00:00+05:30";
const CLOSE = "2026-11-28T23:00:00+05:30";
const PERMANENT = "2026-12-09T00:00:00+05:30";
const ENV = {
  ALBUM_OPEN_AT: OPEN,
  ALBUM_CLOSE_AT: CLOSE,
  ALBUM_PERMANENT_AFTER: PERMANENT,
  IMMICH_BASE: "https://immich.test",
  IMMICH_SLUG: "slug-1",
  IMMICH_PROXY_KEY: "key-1",
  WEDDING_API_PROXY_SECRET: "unused",
};
const REFERER = "https://priya.sankars.in/album";
const at = (iso) => Date.parse(iso);
const BEFORE = at("2026-11-20T12:00:00+05:30");
const INSIDE = at("2026-11-28T20:00:00+05:30");
const MAX = 25 * 1024 * 1024;

let upstreamCalls;
let cacheMatchCalls;
let cachePutCalls;
let upstreamImpl;

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const htmlResponse = (status = 200) =>
  new Response("<html>blocked or login page</html>", { status, headers: { "Content-Type": "text/html" } });

beforeEach(() => {
  upstreamCalls = [];
  cacheMatchCalls = 0;
  cachePutCalls = 0;
  upstreamImpl = async () => jsonResponse({ ok: true });
  globalThis.fetch = async (url, init) => {
    upstreamCalls.push({ url: String(url), init });
    return upstreamImpl(url, init);
  };
  globalThis.caches = {
    default: {
      match: async () => {
        cacheMatchCalls++;
        return undefined;
      },
      put: async () => {
        cachePutCalls++;
      },
    },
  };
});

const ctx = { waitUntil() {} };
function call(path, { now = INSIDE, env = ENV, referer = REFERER, ...init } = {}) {
  Date.now = () => now;
  const headers = new Headers(init.headers ?? {});
  if (referer) headers.set("Referer", referer);
  const request = new Request(`https://priya.sankars.in${path}`, { ...init, headers });
  return worker.fetch(request, env, ctx);
}
const statusAt = async (now) => (await call("/api/album/status", { now })).json();

// -- The window ---------------------------------------------------------
const windowCases = [
  ["one ms before the window opens", at(OPEN) - 1, { state: "closed", mode: null, reason: "before", opensAt: OPEN, closesAt: null }],
  ["exactly when the window opens", at(OPEN), { state: "open", mode: "reception", reason: null, opensAt: null, closesAt: CLOSE }],
  ["mid-window", at("2026-11-28T20:30:00+05:30"), { state: "open", mode: "reception", closesAt: CLOSE }],
  ["one ms before the window closes", at(CLOSE) - 1, { state: "open", mode: "reception" }],
  ["exactly when the window closes", at(CLOSE), { state: "closed", mode: null, reason: "between", opensAt: PERMANENT, closesAt: null }],
  ["one ms before the permanent date", at(PERMANENT) - 1, { state: "closed", reason: "between" }],
  ["exactly at the permanent date", at(PERMANENT), { state: "open", mode: "permanent", reason: null, opensAt: null, closesAt: null }],
  ["a year after the permanent date", at("2027-12-09T00:00:00+05:30"), { state: "open", mode: "permanent" }],
];
for (const [name, now, expected] of windowCases) {
  test(`status: ${name}`, async () => {
    const body = await statusAt(now);
    for (const [key, value] of Object.entries(expected)) assert.equal(body[key], value, key);
  });
}

test("status carries the config times and is not cacheable", async () => {
  const res = await call("/api/album/status", { now: BEFORE });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  const body = await res.json();
  assert.equal(body.receptionOpenAt, OPEN);
  assert.equal(body.receptionCloseAt, CLOSE);
  assert.equal(body.permanentAfter, PERMANENT);
});

// -- Configuration must fail loudly, never open or silently closed ------
const badConfigs = {
  "a date with no offset": { ALBUM_OPEN_AT: "2026-11-28T18:00:00" },
  "an unparseable date": { ALBUM_OPEN_AT: "garbage" },
  "a close time not after the open time": { ALBUM_OPEN_AT: CLOSE, ALBUM_CLOSE_AT: OPEN },
  "a permanent date before the close time": { ALBUM_PERMANENT_AFTER: "2026-11-28T20:00:00+05:30" },
  "a missing window var": { ALBUM_OPEN_AT: undefined },
  "a missing IMMICH_PROXY_KEY": { IMMICH_PROXY_KEY: undefined },
  "a missing IMMICH_SLUG": { IMMICH_SLUG: undefined },
};
for (const [name, override] of Object.entries(badConfigs)) {
  test(`config: ${name} -> 500 Album not configured`, async () => {
    const env = { ...ENV, ...override };
    for (const key of Object.keys(override)) if (override[key] === undefined) delete env[key];
    const res = await call("/api/album/info", { env });
    assert.equal(res.status, 500);
    assert.equal((await res.json()).message, "Album not configured");
    assert.equal(upstreamCalls.length, 0);
  });
}

// -- Referer ------------------------------------------------------------
for (const referer of ["https://priya.sankars.in/album", "https://priya-sankar-invite.pages.dev/camera"]) {
  test(`referer: ${referer} is accepted`, async () => {
    assert.equal((await call("/api/album/status", { referer })).status, 200);
  });
}
for (const referer of ["", "https://evil.example/", "https://priya.sankars.in.evil.example/", "not a url"]) {
  test(`referer: "${referer}" is refused`, async () => {
    assert.equal((await call("/api/album/status", { referer })).status, 403);
  });
}

// -- View routes while closed ---------------------------------------------
for (const path of ["/api/album/info", "/api/album/bucket?albumId=a&timeBucket=b", "/api/album/thumbnail/asset-1?size=thumbnail"]) {
  test(`closed window: ${path.split("?")[0]} is 403 and touches neither Immich nor the edge cache`, async () => {
    const res = await call(path, { now: BEFORE });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).state, "closed");
    assert.equal(upstreamCalls.length, 0);
    assert.equal(cacheMatchCalls, 0);
  });
}

// -- View routes while open -----------------------------------------------
test("open window: info calls Immich with the slug and the secret header", async () => {
  upstreamImpl = async () => jsonResponse({ album: { id: "a", startDate: "x", endDate: "y", assetCount: 1 } });
  const res = await call("/api/album/info");
  assert.equal(res.status, 200);
  assert.ok(upstreamCalls[0].url.startsWith("https://immich.test/api/shared-links/me?slug=slug-1"));
  assert.equal(new Headers(upstreamCalls[0].init.headers).get("X-Album-Key"), "key-1");
});

test("info returns only the album fields the page needs, never the share key or slug", async () => {
  upstreamImpl = async () =>
    jsonResponse({
      id: "link-1",
      key: "secret-share-key",
      slug: "slug-1",
      userId: "user-1",
      password: null,
      allowUpload: true,
      album: {
        id: "album-1",
        albumName: "Reception",
        ownerId: "owner-1",
        startDate: "2026-11-28T12:00:00.000Z",
        endDate: "2026-11-28T16:00:00.000Z",
        assetCount: 16,
      },
    });
  const res = await call("/api/album/info");
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(text), {
    album: {
      id: "album-1",
      startDate: "2026-11-28T12:00:00.000Z",
      endDate: "2026-11-28T16:00:00.000Z",
      assetCount: 16,
    },
  });
  assert.ok(!text.includes("secret-share-key"));
  assert.ok(!text.includes("slug-1"));
});

test("an Immich JSON error on info is passed on as a status with no Immich body", async () => {
  upstreamImpl = async () => jsonResponse({ message: "not found", key: "leak" }, 404);
  const res = await call("/api/album/info");
  assert.equal(res.status, 404);
  assert.ok(!(await res.text()).includes("leak"));
});

test("an image from Immich is served for thumbnails", async () => {
  upstreamImpl = async () => new Response("jpegbytes", { status: 200, headers: { "Content-Type": "image/jpeg" } });
  const res = await call("/api/album/thumbnail/asset-1?size=thumbnail");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "image/jpeg");
});

// -- Upstream returns a Cloudflare/Access page instead of data --------------
test("a 403 HTML block page from Immich becomes a clean 502 JSON", async () => {
  upstreamImpl = async () => htmlResponse(403);
  const res = await call("/api/album/info");
  assert.equal(res.status, 502);
  assert.match(res.headers.get("Content-Type"), /application\/json/);
  assert.equal(typeof (await res.json()).message, "string");
});

test("a 200 HTML page from Immich is neither relayed nor written to the edge cache", async () => {
  upstreamImpl = async () => htmlResponse(200);
  const res = await call("/api/album/thumbnail/asset-1?size=thumbnail");
  assert.equal(res.status, 502);
  assert.equal(cachePutCalls, 0);
});

// -- Uploads --------------------------------------------------------------
const uploadInit = (headers = {}) => ({
  method: "POST",
  headers: { "Content-Type": "multipart/form-data; boundary=x", "Content-Length": "1000", ...headers },
  body: "x".repeat(1000),
});

test("upload is forwarded to Immich with the slug and secret header, even while the album is closed", async () => {
  upstreamImpl = async () => jsonResponse({ id: "a1", status: "created" }, 201);
  const res = await call("/api/album/upload", { now: BEFORE, ...uploadInit() });
  assert.equal(res.status, 201);
  assert.equal(upstreamCalls.length, 1);
  assert.equal(upstreamCalls[0].url, "https://immich.test/api/assets?slug=slug-1");
  assert.equal(upstreamCalls[0].init.method, "POST");
  assert.equal(new Headers(upstreamCalls[0].init.headers).get("X-Album-Key"), "key-1");
});

test("upload exactly at the size cap is accepted", async () => {
  upstreamImpl = async () => jsonResponse({ id: "a1" }, 201);
  const res = await call("/api/album/upload", uploadInit({ "Content-Length": String(MAX) }));
  assert.equal(res.status, 201);
});

const refusedUploads = [
  ["a body one byte over the cap", { "Content-Length": String(MAX + 1) }, undefined, 413],
  ["a non-multipart body", { "Content-Type": "application/json" }, undefined, 415],
  ["a non-numeric Content-Length", { "Content-Length": "abc" }, undefined, 411],
  ["a foreign Referer", {}, "https://evil.example/", 403],
  ["no Referer", {}, "", 403],
];
for (const [name, headers, referer, status] of refusedUploads) {
  test(`upload: ${name} -> ${status}, and Immich is not called`, async () => {
    const init = uploadInit(headers);
    const res = await call("/api/album/upload", referer === undefined ? init : { ...init, referer });
    assert.equal(res.status, status);
    assert.equal(upstreamCalls.length, 0);
  });
}

test("upload with no Content-Length -> 411, and Immich is not called", async () => {
  const init = uploadInit();
  delete init.headers["Content-Length"];
  const res = await call("/api/album/upload", init);
  assert.equal(res.status, 411);
  assert.equal(upstreamCalls.length, 0);
});

test("an HTML page from Immich on upload becomes a clean 502 JSON", async () => {
  upstreamImpl = async () => htmlResponse(403);
  const res = await call("/api/album/upload", uploadInit());
  assert.equal(res.status, 502);
  assert.equal(typeof (await res.json()).message, "string");
});

// -- Live stream pages ----------------------------------------------------
// /api/live/<wedding|reception>: gated by a time window, and the YouTube video
// id is only ever in a response while the page may show the player.
const W_ID = "cg4Jc0WOclU";
const R_ID = "HzD1mpUKIww";
const W_OPEN = "2026-11-22T05:45:00+05:30";
const W_CLOSE = "2026-11-27T23:59:00+05:30";
const R_OPEN = "2026-11-28T17:30:00+05:30";
const R_CLOSE = "2026-11-29T23:59:00+05:30";
const LIVE_ENV = {
  ...ENV,
  YOUTUBE_API_KEY: "yt-key-1",
  LIVE_WEDDING_OPEN_AT: W_OPEN,
  LIVE_WEDDING_CLOSE_AT: W_CLOSE,
  LIVE_WEDDING_VIDEO_ID: W_ID,
  LIVE_RECEPTION_OPEN_AT: R_OPEN,
  LIVE_RECEPTION_CLOSE_AT: R_CLOSE,
  LIVE_RECEPTION_VIDEO_ID: R_ID,
};
const W_INSIDE = at("2026-11-22T06:00:00+05:30");
const ytItem = (liveBroadcastContent, liveStreamingDetails = {}) =>
  jsonResponse({ items: [{ snippet: { liveBroadcastContent }, liveStreamingDetails }] });
const liveCall = (name, opts = {}) => call(`/api/live/${name}`, { env: LIVE_ENV, now: W_INSIDE, ...opts });
const ytCalls = () => upstreamCalls.filter((c) => c.url.startsWith("https://www.googleapis.com/youtube/"));

const liveCases = [
  ["wedding, before the window", "wedding", at(W_OPEN) - 1, null, { state: "before", opensAt: W_OPEN, closesAt: W_CLOSE }, false],
  ["wedding, exactly at open, not started yet", "wedding", at(W_OPEN), () => ytItem("upcoming"), { state: "waiting" }, false],
  ["wedding, streaming now", "wedding", W_INSIDE, () => ytItem("live", { actualStartTime: "x" }), { state: "live", videoId: W_ID }, true],
  ["wedding, stream ended (replay)", "wedding", W_INSIDE, () => ytItem("none", { actualEndTime: "x" }), { state: "replay", videoId: W_ID }, true],
  ["wedding, YouTube does not know the video (private/deleted)", "wedding", W_INSIDE, () => jsonResponse({ items: [] }), { state: "waiting" }, false],
  ["wedding, YouTube errors", "wedding", W_INSIDE, () => jsonResponse({ error: {} }, 500), { state: "waiting" }, false],
  ["wedding, one ms before close", "wedding", at(W_CLOSE) - 1, () => ytItem("none", { actualEndTime: "x" }), { state: "replay", videoId: W_ID }, true],
  ["wedding, exactly at close", "wedding", at(W_CLOSE), null, { state: "closed" }, false],
  ["reception, wedding window is not its window", "reception", W_INSIDE, null, { state: "before", opensAt: R_OPEN }, false],
  ["reception, live", "reception", at("2026-11-28T18:00:00+05:30"), () => ytItem("live"), { state: "live", videoId: R_ID }, true],
  ["reception, after close", "reception", at(R_CLOSE), null, { state: "closed" }, false],
];
for (const [name, route, now, yt, expected, revealsId] of liveCases) {
  test(`live: ${name}`, async () => {
    if (yt) upstreamImpl = async () => yt();
    const res = await liveCall(route, { now });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    const text = await res.text();
    assert.deepEqual(Object.fromEntries(Object.entries(JSON.parse(text)).filter(([k]) => k in expected)), expected);
    // The id of a video never appears unless the player may be shown.
    for (const id of [W_ID, R_ID]) {
      assert.equal(text.includes(id), revealsId && id === expected.videoId, `${id} in body of ${name}`);
    }
    if (!yt) assert.equal(ytCalls().length, 0, "YouTube is not asked outside the window");
  });
}

test("live: asks YouTube about the right video with the key, for unlisted videos too", async () => {
  upstreamImpl = async () => ytItem("live");
  await liveCall("wedding");
  const u = new URL(ytCalls()[0].url);
  assert.equal(u.pathname, "/youtube/v3/videos");
  assert.equal(u.searchParams.get("id"), W_ID);
  assert.equal(u.searchParams.get("key"), "yt-key-1");
});

test("live: the YouTube answer is cached for a few seconds, an error is not", async () => {
  upstreamImpl = async () => ytItem("live");
  await liveCall("wedding");
  assert.equal(cachePutCalls, 1);
  cachePutCalls = 0;
  upstreamImpl = async () => jsonResponse({ error: {} }, 500);
  await liveCall("wedding");
  assert.equal(cachePutCalls, 0);
});

test("live: LIVE_<NAME>_FORCE=1 shows the player when YouTube cannot be checked", async () => {
  upstreamImpl = async () => jsonResponse({ error: {} }, 500);
  const res = await liveCall("wedding", { env: { ...LIVE_ENV, LIVE_WEDDING_FORCE: "1" } });
  assert.equal((await res.json()).state, "live");
});

test("live: FORCE does not open the page outside its window", async () => {
  const res = await liveCall("wedding", { env: { ...LIVE_ENV, LIVE_WEDDING_FORCE: "1" }, now: at(W_CLOSE) });
  const text = await res.text();
  assert.equal(JSON.parse(text).state, "closed");
  assert.equal(text.includes(W_ID), false);
});

test("live: no video id configured yet -> waiting", async () => {
  const env = { ...LIVE_ENV };
  delete env.LIVE_WEDDING_VIDEO_ID;
  const res = await liveCall("wedding", { env });
  assert.equal((await res.json()).state, "waiting");
  assert.equal(ytCalls().length, 0);
});

test("live: a malformed video id is treated as not configured", async () => {
  const res = await liveCall("wedding", { env: { ...LIVE_ENV, LIVE_WEDDING_VIDEO_ID: "x&key=evil" } });
  assert.equal((await res.json()).state, "waiting");
  assert.equal(ytCalls().length, 0);
});

test("live: a date without an offset -> 500", async () => {
  const res = await liveCall("wedding", { env: { ...LIVE_ENV, LIVE_WEDDING_OPEN_AT: "2026-11-22T05:45:00" } });
  assert.equal(res.status, 500);
});

test("live: close before open -> 500", async () => {
  const res = await liveCall("wedding", { env: { ...LIVE_ENV, LIVE_WEDDING_CLOSE_AT: W_OPEN } });
  assert.equal(res.status, 500);
});

test("live: no YouTube key -> 500 inside the window, still fine before it", async () => {
  const env = { ...LIVE_ENV };
  delete env.YOUTUBE_API_KEY;
  assert.equal((await liveCall("wedding", { env })).status, 500);
  assert.equal((await liveCall("wedding", { env, now: at(W_OPEN) - 1 })).status, 200);
});

test("live: an unknown page name -> 404", async () => {
  assert.equal((await liveCall("nope")).status, 404);
});

test("live: a foreign Referer -> 403 and nothing is asked of YouTube", async () => {
  const res = await liveCall("wedding", { referer: "https://evil.example/" });
  assert.equal(res.status, 403);
  assert.equal(ytCalls().length, 0);
});

test("live: only GET", async () => {
  assert.equal((await liveCall("wedding", { method: "POST" })).status, 405);
});
