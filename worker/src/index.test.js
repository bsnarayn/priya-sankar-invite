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
