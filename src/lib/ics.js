// Builds an iCalendar (.ics) file for the reception. Times are written in UTC
// so no VTIMEZONE block is needed and every calendar app reads them the same
// way; text values are escaped and long lines folded as RFC 5545 requires.

const enc = new TextEncoder();

const utc = (ms) =>
    new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

const esc = (s) =>
    String(s)
        .replace(/\\/g, "\\\\")
        .replace(/;/g, "\\;")
        .replace(/,/g, "\\,")
        .replace(/\r?\n/g, "\\n");

// Lines may be at most 75 octets; continuation lines start with one space.
function fold(line) {
    const parts = [];
    let cur = "";
    let octets = 0;
    for (const ch of line) {
        const size = enc.encode(ch).length;
        if (octets + size > (parts.length ? 74 : 75)) {
            parts.push(cur);
            cur = "";
            octets = 0;
        }
        cur += ch;
        octets += size;
    }
    parts.push(cur);
    return parts.map((p, i) => (i ? ` ${p}` : p)).join("\r\n");
}

/**
 * @param {{startIso: string, endIso?: string, summary: string,
 *   description?: string, location?: string, url?: string, uid: string,
 *   nowMs: number}} e  startIso/endIso: ISO-8601 with an explicit offset.
 */
export function buildEventIcs(e) {
    const lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Sankar and Priya//Reception//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        `UID:${e.uid}`,
        `DTSTAMP:${utc(e.nowMs)}`,
        `DTSTART:${utc(Date.parse(e.startIso))}`,
        e.endIso ? `DTEND:${utc(Date.parse(e.endIso))}` : "",
        `SUMMARY:${esc(e.summary)}`,
        e.description ? `DESCRIPTION:${esc(e.description)}` : "",
        e.location ? `LOCATION:${esc(e.location)}` : "",
        e.url ? `URL:${e.url}` : "",
        "END:VEVENT",
        "END:VCALENDAR",
    ].filter(Boolean);
    return lines.map(fold).join("\r\n") + "\r\n";
}
