import { test } from "node:test";
import assert from "node:assert/strict";
import { albumState, parseWindowConfig } from "./album-window.js";

const OPEN = "2026-11-28T18:00:00+05:30";
const CLOSE = "2026-11-28T23:00:00+05:30";
const PERMANENT = "2026-12-09T00:00:00+05:30";
const cfg = {
  receptionOpenAt: OPEN,
  receptionCloseAt: CLOSE,
  permanentAfter: PERMANENT,
};
const at = (iso) => Date.parse(iso);

test("closed before the reception window", () => {
  assert.deepEqual(albumState(at(OPEN) - 1, cfg), {
    state: "closed",
    mode: null,
    reason: "before",
    opensAt: OPEN,
    closesAt: null,
  });
});

test("open exactly at the window start", () => {
  assert.deepEqual(albumState(at(OPEN), cfg), {
    state: "open",
    mode: "reception",
    reason: null,
    opensAt: null,
    closesAt: CLOSE,
  });
});

test("open mid-window", () => {
  const s = albumState(at("2026-11-28T20:30:00+05:30"), cfg);
  assert.equal(s.state, "open");
  assert.equal(s.mode, "reception");
});

test("open one millisecond before the window closes", () => {
  assert.equal(albumState(at(CLOSE) - 1, cfg).state, "open");
});

test("closed exactly at the window end, reopening on the permanent date", () => {
  assert.deepEqual(albumState(at(CLOSE), cfg), {
    state: "closed",
    mode: null,
    reason: "between",
    opensAt: PERMANENT,
    closesAt: null,
  });
});

test("closed one millisecond before the permanent date", () => {
  const s = albumState(at(PERMANENT) - 1, cfg);
  assert.equal(s.state, "closed");
  assert.equal(s.reason, "between");
});

test("open permanently exactly at the permanent date", () => {
  assert.deepEqual(albumState(at(PERMANENT), cfg), {
    state: "open",
    mode: "permanent",
    reason: null,
    opensAt: null,
    closesAt: null,
  });
});

test("still open permanently a year later", () => {
  const s = albumState(at("2027-12-09T00:00:00+05:30"), cfg);
  assert.equal(s.state, "open");
  assert.equal(s.mode, "permanent");
});

test("parseWindowConfig returns the config for a valid trio", () => {
  assert.deepEqual(
    parseWindowConfig({
      ALBUM_OPEN_AT: OPEN,
      ALBUM_CLOSE_AT: CLOSE,
      ALBUM_PERMANENT_AFTER: PERMANENT,
    }),
    cfg,
  );
});

test("parseWindowConfig returns null when a var is missing", () => {
  assert.equal(
    parseWindowConfig({ ALBUM_OPEN_AT: OPEN, ALBUM_CLOSE_AT: CLOSE }),
    null,
  );
  assert.equal(parseWindowConfig({}), null);
});

test("parseWindowConfig returns null for an unparseable date", () => {
  assert.equal(
    parseWindowConfig({
      ALBUM_OPEN_AT: "garbage",
      ALBUM_CLOSE_AT: CLOSE,
      ALBUM_PERMANENT_AFTER: PERMANENT,
    }),
    null,
  );
});

test("parseWindowConfig returns null when close is not after open", () => {
  assert.equal(
    parseWindowConfig({
      ALBUM_OPEN_AT: CLOSE,
      ALBUM_CLOSE_AT: OPEN,
      ALBUM_PERMANENT_AFTER: PERMANENT,
    }),
    null,
  );
});

test("parseWindowConfig returns null when permanent is before close", () => {
  assert.equal(
    parseWindowConfig({
      ALBUM_OPEN_AT: OPEN,
      ALBUM_CLOSE_AT: CLOSE,
      ALBUM_PERMANENT_AFTER: "2026-11-28T20:00:00+05:30",
    }),
    null,
  );
});

test("parseWindowConfig returns null when a date has no explicit offset", () => {
  assert.equal(
    parseWindowConfig({
      ALBUM_OPEN_AT: "2026-11-28T18:00:00",
      ALBUM_CLOSE_AT: CLOSE,
      ALBUM_PERMANENT_AFTER: PERMANENT,
    }),
    null,
  );
});
