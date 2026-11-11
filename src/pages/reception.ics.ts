import type { APIRoute } from "astro";
import { getEntry } from "astro:content";
import { buildEventIcs } from "../lib/ics.js";

// Static calendar file at /reception.ics, built from event.json and site.json
// so the dates, venue and map link never drift from the invite. Linked from
// the reminder email's "Add to Calendar" button.
export const GET: APIRoute = async () => {
    const eventEntry = await getEntry("event", "event");
    const siteEntry = await getEntry("site", "site");
    if (!eventEntry || !siteEntry) throw new Error("Missing event or site content entry");
    const event = eventEntry.data;
    const site = siteEntry.data;
    if (!event.start_datetime) throw new Error("event.start_datetime is required for the calendar file");

    const ics = buildEventIcs({
        startIso: event.start_datetime,
        endIso: event.end_datetime ?? undefined,
        summary: `${site.groom_name} & ${site.bride_name} — Reception & Celebration`,
        description: [
            `Dress: ${event.dress}`,
            event.maps_url ? `Map: ${event.maps_url}` : "",
            `Invitation: ${site.site_url}`,
        ]
            .filter(Boolean)
            .join("\n"),
        location: [event.venue, event.address].filter(Boolean).join(", "),
        url: site.site_url,
        uid: `reception-${event.start_datetime.slice(0, 10)}@${new URL(site.site_url).hostname}`,
        nowMs: Date.now(),
    });

    return new Response(ics, {
        headers: {
            "Content-Type": "text/calendar; charset=utf-8",
            "Content-Disposition": 'attachment; filename="sankar-priya-reception.ics"',
        },
    });
};
