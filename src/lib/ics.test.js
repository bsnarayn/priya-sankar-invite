import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEventIcs } from "./ics.js";

const event = {
    startIso: "2026-11-28T18:00:00+05:30",
    endIso: "2026-11-28T21:00:00+05:30",
    summary: "Sankar & Priya — Reception & Celebration",
    description: "Dress: Festive\nMap: https://maps.app.goo.gl/8J9diUhzpJjKfDeN6",
    location:
        "New Woodlands Hotel, Chennai, 72-75, Dr Radha Krishnan Salai, CIT Colony, Mylapore, Chennai, Greater Chennai, Tamil Nadu 600004",
    url: "https://priya.sankars.in",
    uid: "reception-2026-11-28@priya.sankars.in",
    nowMs: Date.parse("2026-11-11T14:30:00Z"),
};

// Undo RFC 5545 line folding so assertions read the logical lines.
const unfold = (ics) => ics.replace(/\r\n[ \t]/g, "").split("\r\n").filter(Boolean);
const lines = () => unfold(buildEventIcs(event));

test("is a CRLF-terminated VCALENDAR wrapping one VEVENT", () => {
    const ics = buildEventIcs(event);
    assert.ok(ics.endsWith("\r\n"));
    const l = lines();
    assert.equal(l[0], "BEGIN:VCALENDAR");
    assert.equal(l.at(-1), "END:VCALENDAR");
    assert.equal(l.filter((x) => x === "BEGIN:VEVENT").length, 1);
    assert.ok(l.includes("VERSION:2.0"));
});

test("times are UTC, converted from the IST input (18:00 IST = 12:30Z)", () => {
    const l = lines();
    assert.ok(l.includes("DTSTART:20261128T123000Z"));
    assert.ok(l.includes("DTEND:20261128T153000Z"));
});

test("no TZID and no stray +0530 offset (the old file's bug)", () => {
    const ics = buildEventIcs(event);
    assert.ok(!ics.includes("TZID"));
    assert.ok(!ics.includes("+0530"));
});

test("has the UID and DTSTAMP calendars require", () => {
    const l = lines();
    assert.ok(l.includes("UID:reception-2026-11-28@priya.sankars.in"));
    assert.ok(l.includes("DTSTAMP:20261111T143000Z"));
});

test("text values escape commas, semicolons, backslashes and newlines", () => {
    const l = unfold(buildEventIcs({ ...event, summary: "A; B\\C, D", description: "line1\nline2" }));
    assert.ok(l.includes("SUMMARY:A\\; B\\\\C\\, D"));
    assert.ok(l.includes("DESCRIPTION:line1\\nline2"));
});

test("location keeps every address comma escaped", () => {
    const loc = lines().find((x) => x.startsWith("LOCATION:"));
    assert.ok(loc.startsWith("LOCATION:New Woodlands Hotel\\, Chennai\\, 72-75\\, Dr Radha Krishnan Salai"));
    assert.ok(!/[^\\],/.test(loc), "an unescaped comma remains in LOCATION");
});

test("description carries the map link and the dress code", () => {
    const d = lines().find((x) => x.startsWith("DESCRIPTION:"));
    assert.ok(d.includes("https://maps.app.goo.gl/8J9diUhzpJjKfDeN6"));
    assert.ok(d.includes("Dress: Festive"));
});

test("no physical line is longer than 75 octets", () => {
    const enc = new TextEncoder();
    for (const line of buildEventIcs(event).split("\r\n")) assert.ok(enc.encode(line).length <= 75, `too long: ${line}`);
});

test("folding does not split a multi-byte character", () => {
    const long = "Reception — ".repeat(12);
    const l = unfold(buildEventIcs({ ...event, summary: long }));
    assert.equal(l.find((x) => x.startsWith("SUMMARY:")), `SUMMARY:${long}`);
});

test("omits DTEND when there is no end time", () => {
    const l = unfold(buildEventIcs({ ...event, endIso: undefined }));
    assert.ok(!l.some((x) => x.startsWith("DTEND")));
});
