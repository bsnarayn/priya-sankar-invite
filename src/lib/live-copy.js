// Words for the /wedding and /reception stream pages, built from what the
// Worker's /api/live/<name> returns. No player is ever described here: the
// page shows the video only for state "live" or "replay".
import { day, time } from "./ist-format.js";

const COULD_NOT_CHECK = {
    headline: "We couldn't check the stream just now",
    text: "Please wait a moment, this page will try again by itself.",
};

/**
 * @param {{state: string, opensAt?: string, closesAt?: string}} status
 * @param {"wedding"|"reception"} name
 * @returns {{headline: string, text: string}}
 */
export function liveCopy(status, name) {
    switch (status.state) {
        case "before": {
            const d = day(status.opensAt);
            return {
                headline: `The ${name} stream opens soon`,
                text: `It opens on ${d.weekday} ${d.label} at ${time(status.opensAt)} IST. Come back then and the video will appear here.`,
            };
        }
        case "waiting":
            return {
                headline: "Waiting for the stream to begin",
                text: `The ${name} stream has not started yet. This page will switch to the video on its own the moment it begins.`,
            };
        case "closed":
            return {
                headline: "This stream has ended",
                text: `The ${name} stream is no longer available on this page. Thank you for celebrating with us.`,
            };
        default:
            return COULD_NOT_CHECK;
    }
}

const plural = (n, unit) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/** "2 days 3 hours", "3 hours 12 minutes", "12 minutes 5 seconds", "any moment now". */
export function countdownText(ms) {
    const total = Math.floor(ms / 1000);
    if (total <= 0) return "any moment now";
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const pair = (a, aUnit, b, bUnit) => [a && plural(a, aUnit), b && plural(b, bUnit)].filter(Boolean).join(" ");
    if (days) return pair(days, "day", hours, "hour");
    if (hours) return pair(hours, "hour", minutes, "minute");
    if (minutes) return pair(minutes, "minute", seconds, "second");
    return plural(seconds, "second");
}
