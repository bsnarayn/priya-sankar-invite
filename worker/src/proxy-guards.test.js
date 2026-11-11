import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkUploadRequest,
  isAllowedReferer,
  isCleanUpstream,
} from "./proxy-guards.js";

const ALLOWED = ["https://priya.sankars.in", "https://priya-sankar-invite.pages.dev"];
const MAX = 25 * 1024 * 1024;
const good = {
  referer: "https://priya.sankars.in/camera/camera",
  contentType: "multipart/form-data; boundary=abc",
  contentLength: "1000",
};

test("isAllowedReferer accepts pages on an allowed origin", () => {
  assert.equal(isAllowedReferer("https://priya.sankars.in/album", ALLOWED), true);
  assert.equal(isAllowedReferer("https://priya-sankar-invite.pages.dev/", ALLOWED), true);
});

test("isAllowedReferer rejects other origins, prefix tricks, and empty values", () => {
  assert.equal(isAllowedReferer("https://evil.example/", ALLOWED), false);
  assert.equal(isAllowedReferer("https://priya.sankars.in.evil.example/", ALLOWED), false);
  assert.equal(isAllowedReferer("", ALLOWED), false);
  assert.equal(isAllowedReferer("not a url", ALLOWED), false);
});

test("checkUploadRequest accepts a valid upload", () => {
  assert.deepEqual(checkUploadRequest(good, ALLOWED, MAX), { ok: true });
});

test("checkUploadRequest rejects a foreign Referer with 403", () => {
  const r = checkUploadRequest({ ...good, referer: "https://evil.example/" }, ALLOWED, MAX);
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
});

test("checkUploadRequest rejects a missing Referer with 403", () => {
  assert.equal(checkUploadRequest({ ...good, referer: "" }, ALLOWED, MAX).status, 403);
});

test("checkUploadRequest rejects a non-multipart body with 415", () => {
  const r = checkUploadRequest({ ...good, contentType: "application/json" }, ALLOWED, MAX);
  assert.equal(r.status, 415);
});

test("checkUploadRequest rejects a missing Content-Length with 411", () => {
  assert.equal(checkUploadRequest({ ...good, contentLength: null }, ALLOWED, MAX).status, 411);
});

test("checkUploadRequest rejects a non-numeric Content-Length with 411", () => {
  assert.equal(checkUploadRequest({ ...good, contentLength: "abc" }, ALLOWED, MAX).status, 411);
});

test("checkUploadRequest rejects a body one byte over the cap with 413", () => {
  const r = checkUploadRequest({ ...good, contentLength: String(MAX + 1) }, ALLOWED, MAX);
  assert.equal(r.status, 413);
});

test("checkUploadRequest accepts a body exactly at the cap", () => {
  assert.deepEqual(checkUploadRequest({ ...good, contentLength: String(MAX) }, ALLOWED, MAX), { ok: true });
});

test("isCleanUpstream treats a Cloudflare HTML block page as not clean JSON", () => {
  assert.equal(isCleanUpstream(403, "text/html; charset=UTF-8", "json"), false);
});

test("isCleanUpstream accepts JSON bodies at any status", () => {
  assert.equal(isCleanUpstream(200, "application/json; charset=utf-8", "json"), true);
  assert.equal(isCleanUpstream(404, "application/json", "json"), true);
});

test("isCleanUpstream accepts images for image routes and rejects HTML there", () => {
  assert.equal(isCleanUpstream(200, "image/jpeg", "image"), true);
  assert.equal(isCleanUpstream(403, "text/html", "image"), false);
});
