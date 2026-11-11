import { test } from "node:test";
import assert from "node:assert/strict";
import { liveCopy, countdownText } from "./live-copy.js";

const W = { opensAt: "2026-11-22T05:45:00+05:30", closesAt: "2026-11-27T23:59:00+05:30" };

test("before the window: says when it opens, in IST", () => {
  assert.deepEqual(liveCopy({ state: "before", ...W }, "wedding"), {
    headline: "The wedding stream opens soon",
    text: "It opens on Sun 22 Nov at 5:45 am IST. Come back then and the video will appear here.",
  });
});

test("reception copy uses its own name and time", () => {
  const got = liveCopy({ state: "before", opensAt: "2026-11-28T17:30:00+05:30", closesAt: "2026-11-29T23:59:00+05:30" }, "reception");
  assert.equal(got.headline, "The reception stream opens soon");
  assert.match(got.text, /Sat 28 Nov at 5:30 pm IST/);
});

test("waiting: promises the page switches by itself", () => {
  assert.deepEqual(liveCopy({ state: "waiting", ...W }, "wedding"), {
    headline: "Waiting for the stream to begin",
    text: "The wedding stream has not started yet. This page will switch to the video on its own the moment it begins.",
  });
});

test("closed: thanks the guest and does not offer the video", () => {
  const got = liveCopy({ state: "closed", ...W }, "wedding");
  assert.equal(got.headline, "This stream has ended");
  assert.match(got.text, /no longer available on this page/);
});

test("a check that failed asks the guest to wait, never shows a player", () => {
  assert.equal(liveCopy({ state: "error" }, "wedding").headline, "We couldn't check the stream just now");
});

test("an unknown state is treated like a failed check", () => {
  assert.equal(liveCopy({ state: "whatever" }, "wedding").headline, "We couldn't check the stream just now");
});

const cd = [
  [-5, "any moment now"],
  [0, "any moment now"],
  [5 * 1000, "5 seconds"],
  [61 * 1000, "1 minute 1 second"],
  [12 * 60 * 1000 + 5000, "12 minutes 5 seconds"],
  [60 * 60 * 1000, "1 hour"],
  [3 * 3600 * 1000 + 12 * 60 * 1000, "3 hours 12 minutes"],
  [24 * 3600 * 1000, "1 day"],
  [2 * 86400 * 1000 + 3 * 3600 * 1000, "2 days 3 hours"],
];
for (const [ms, want] of cd) {
  test(`countdown: ${ms} ms -> ${want}`, () => assert.equal(countdownText(ms), want));
}
