import { test } from "node:test";
import assert from "node:assert/strict";
import { gateCopy } from "./album-gate-copy.js";

const times = {
  receptionOpenAt: "2026-11-28T18:00:00+05:30",
  receptionCloseAt: "2026-11-28T23:00:00+05:30",
  permanentAfter: "2026-12-09T00:00:00+05:30",
};

test("before the reception: announces the window and the permanent date", () => {
  assert.equal(
    gateCopy({ reason: "before", ...times }),
    "The album opens during the reception on Sat 28 Nov, 6 pm to 11 pm, and again for good from 9 Dec.",
  );
});

test("between the window and the permanent date: closed for now", () => {
  assert.equal(
    gateCopy({ reason: "between", ...times }),
    "The album is closed for now. It opens again for good on 9 Dec.",
  );
});

test("dates are shown in IST even when the machine is in another timezone", () => {
  const previous = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  try {
    assert.match(gateCopy({ reason: "before", ...times }), /Sat 28 Nov, 6 pm to 11 pm/);
    assert.match(gateCopy({ reason: "between", ...times }), /9 Dec\.$/);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
