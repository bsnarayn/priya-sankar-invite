import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "./index.js";

const ENV = {
  ALBUM_OPEN_AT: "2026-11-28T18:00:00+05:30",
  ALBUM_CLOSE_AT: "2026-11-28T23:00:00+05:30",
  ALBUM_PERMANENT_AFTER: "2026-12-09T00:00:00+05:30",
  IMMICH_BASE: "https://immich.test",
  IMMICH_SLUG: "slug-1",
  IMMICH_PROXY_KEY: "key-1",
  WEDDING_API_PROXY_SECRET: "unused",
};
const REFERER = "https://priya.sankars.in/album";
const BEFORE = Date.parse("2026-11-20T12:00:00+05:30");
const INSIDE = Date.parse("2026-11-28T20:00:00+05:30");

let upstreamCalls;
let cacheMatchCalls;
let cachePutCalls;
let upstreamImpl;

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

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

test("closed window: info is 403, and neither Immich nor the edge cache is touched", async () => {
  const res = await call("/api/album/info", { now: BEFORE });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).state, "closed");
  assert.equal(upstreamCalls.length, 0);
  assert.equal(cacheMatchCalls, 0);
});

test("open window: info reaches Immich with the secret header and the slug", async () => {
  upstreamImpl = async () =>
    jsonResponse({ album: { id: "album-1", startDate: "2026-11-28", endDate: "2026-11-29", assetCount: 1 } });
  const res = await call("/api/album/info");
  assert.equal(res.status, 200);
  assert.equal(upstreamCalls.length, 1);
  assert.ok(upstreamCalls[0].url.startsWith("https://immich.test/api/shared-links/me?slug=slug-1"));
  assert.equal(new Headers(upstreamCalls[0].init.headers).get("X-Album-Key"), "key-1");
});

test("status reports closed with the config times and is not cacheable", async () => {
  const res = await call("/api/album/status", { now: BEFORE });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  const body = await res.json();
  assert.equal(body.state, "closed");
  assert.equal(body.reason, "before");
  assert.equal(body.receptionOpenAt, ENV.ALBUM_OPEN_AT);
  assert.equal(body.receptionCloseAt, ENV.ALBUM_CLOSE_AT);
  assert.equal(body.permanentAfter, ENV.ALBUM_PERMANENT_AFTER);
});

test("status reports open inside the reception window", async () => {
  const body = await (await call("/api/album/status")).json();
  assert.equal(body.state, "open");
  assert.equal(body.mode, "reception");
});

test("status without a Referer is refused", async () => {
  const res = await call("/api/album/status", { referer: "" });
  assert.equal(res.status, 403);
});

test("missing window var -> 500 Album not configured", async () => {
  const { ALBUM_OPEN_AT, ...env } = ENV;
  const res = await call("/api/album/info", { env });
  assert.equal(res.status, 500);
  assert.equal((await res.json()).message, "Album not configured");
});

test("missing IMMICH_PROXY_KEY -> 500 Album not configured", async () => {
  const { IMMICH_PROXY_KEY, ...env } = ENV;
  const res = await call("/api/album/info", { env });
  assert.equal(res.status, 500);
  assert.equal((await res.json()).message, "Album not configured");
});

const uploadInit = (over = {}) => ({
  method: "POST",
  headers: { "Content-Type": "multipart/form-data; boundary=x", "Content-Length": "1000", ...over },
  body: "x".repeat(1000),
});

test("upload is forwarded to Immich even while the album is closed", async () => {
  upstreamImpl = async () => jsonResponse({ id: "a1", status: "created" }, 201);
  const res = await call("/api/album/upload", { now: BEFORE, ...uploadInit() });
  assert.equal(res.status, 201);
  assert.equal(upstreamCalls.length, 1);
  assert.equal(upstreamCalls[0].url, "https://immich.test/api/assets?slug=slug-1");
  assert.equal(upstreamCalls[0].init.method, "POST");
  assert.equal(new Headers(upstreamCalls[0].init.headers).get("X-Album-Key"), "key-1");
});

test("oversize upload -> 413 and Immich is not called", async () => {
  const res = await call("/api/album/upload", uploadInit({ "Content-Length": String(25 * 1024 * 1024 + 1) }));
  assert.equal(res.status, 413);
  assert.equal(upstreamCalls.length, 0);
});

test("non-multipart upload -> 415 and Immich is not called", async () => {
  const res = await call("/api/album/upload", uploadInit({ "Content-Type": "application/json" }));
  assert.equal(res.status, 415);
  assert.equal(upstreamCalls.length, 0);
});

test("a Cloudflare HTML block page from Immich becomes a clean 502 JSON", async () => {
  upstreamImpl = async () =>
    new Response("<!DOCTYPE html><html>Sorry, you have been blocked</html>", {
      status: 403,
      headers: { "Content-Type": "text/html" },
    });
  const res = await call("/api/album/info");
  assert.equal(res.status, 502);
  assert.match(res.headers.get("Content-Type"), /application\/json/);
  assert.equal(typeof (await res.json()).message, "string");
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

test("a 200 HTML page from Immich is neither relayed nor written to the edge cache", async () => {
  upstreamImpl = async () =>
    new Response("<html>Please sign in</html>", { status: 200, headers: { "Content-Type": "text/html" } });
  const res = await call("/api/album/thumbnail/asset-1?size=thumbnail");
  assert.equal(res.status, 502);
  assert.equal(cachePutCalls, 0);
});
