import { test } from "node:test";
import assert from "node:assert/strict";
import { liveCopy, countdownParts, OPENS_BY } from "./live-copy.js";

const W = { opensAt: "2026-11-22T05:45:00+05:30", closesAt: "2026-11-27T23:59:59+05:30" };

test("the countdown label is the same wording for both pages", () => {
  assert.equal(OPENS_BY, "The event live stream opens by");
});

test("waiting: promises the page switches by itself", () => {
  assert.deepEqual(liveCopy({ state: "waiting", ...W }, "wedding"), {
    headline: "Waiting for the stream to begin",
    text: "The wedding stream has not started yet. This page will switch to the video on its own the moment it begins.",
  });
});

test("waiting copy uses the reception's name on its page", () => {
  assert.match(liveCopy({ state: "waiting" }, "reception").text, /The reception stream has not started/);
});

test("closed (the /live page after the last stream): thanks the guest, points to a shared recording link", () => {
  assert.deepEqual(liveCopy({ state: "closed" }, "wedding"), {
    headline: "The live stream has ended",
    text: "Thank you for celebrating with us. If we shared a recording link with you, you can watch it there.",
  });
});

test("a check that failed asks the guest to wait, never shows a player", () => {
  assert.equal(liveCopy({ state: "error" }, "wedding").headline, "We couldn't check the stream just now");
});

test("an unknown state is treated like a failed check", () => {
  assert.equal(liveCopy({ state: "whatever" }, "wedding").headline, "We couldn't check the stream just now");
});

const S = 1000;
const cd = [
  [-5, { days: "00", hours: "00", mins: "00", secs: "00" }],
  [0, { days: "00", hours: "00", mins: "00", secs: "00" }],
  [5 * S, { days: "00", hours: "00", mins: "00", secs: "05" }],
  [999, { days: "00", hours: "00", mins: "00", secs: "00" }],
  [61 * S, { days: "00", hours: "00", mins: "01", secs: "01" }],
  [3 * 3600 * S + 12 * 60 * S + 9 * S, { days: "00", hours: "03", mins: "12", secs: "09" }],
  [10 * 86400 * S + 5 * 3600 * S, { days: "10", hours: "05", mins: "00", secs: "00" }],
  [123 * 86400 * S, { days: "123", hours: "00", mins: "00", secs: "00" }],
];
for (const [ms, want] of cd) {
  test(`countdown parts: ${ms} ms`, () => assert.deepEqual(countdownParts(ms), want));
}
