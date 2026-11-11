import { test } from "node:test";
import assert from "node:assert/strict";
import { gateCopy } from "./album-gate-copy.js";

const times = {
  receptionOpenAt: "2026-11-28T18:00:00+05:30",
  receptionCloseAt: "2026-11-28T23:00:00+05:30",
  permanentAfter: "2026-12-09T00:00:00+05:30",
};

test("before the reception: the live album, the final album, and how to subscribe", () => {
  assert.equal(
    gateCopy({ reason: "before", ...times }),
    "Our shared album will be open during the reception on Sat 28 Nov (6 pm to 11 pm), so you will be able to view the event pictures that you and other guests upload during the event itself. The final album will be available to view once you subscribe below, and we'll notify you as soon as it's ready.",
  );
});

test("between the window and the permanent date: closed for now, subscribe for the final album", () => {
  assert.equal(
    gateCopy({ reason: "between", ...times }),
    "The reception album is closed for now. The final album will be available to view once you subscribe below, and we'll notify you as soon as it's ready.",
  );
});

test("never mentions the permanent opening date", () => {
  for (const reason of ["before", "between"]) {
    const text = gateCopy({ reason, ...times });
    assert.ok(!/9 Dec|December|2026-12/i.test(text), `${reason}: ${text}`);
  }
});

test("dates are shown in IST even when the machine is in another timezone", () => {
  const previous = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  try {
    assert.match(gateCopy({ reason: "before", ...times }), /on Sat 28 Nov \(6 pm to 11 pm\)/);
    assert.match(gateCopy({ reason: "between", ...times }), /ready\.$/);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
