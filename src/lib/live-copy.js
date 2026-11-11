// Words for the /wedding, /reception and /live stream pages, built from what
// the Worker's /api/live/<name> returns. No player is ever described here: the
// page shows the video only for state "live" or "replay". (The "before" state
// is a countdown card, not a message.)

/** Label above the countdown, the same on both pages. */
export const OPENS_BY = "The event live stream opens by";

const COULD_NOT_CHECK = {
    headline: "We couldn't check the stream just now",
    text: "Please wait a moment, this page will try again by itself.",
};

/**
 * @param {{state: string}} status
 * @param {"wedding"|"reception"} name the event the page is about (used in the waiting message)
 * @returns {{headline: string, text: string}}
 */
export function liveCopy(status, name) {
    switch (status.state) {
        case "waiting":
            return {
                headline: "Waiting for the stream to begin",
                text: `The ${name} stream has not started yet. This page will switch to the video on its own the moment it begins.`,
            };
        case "closed":
            return {
                headline: "The live stream has ended",
                text: "Thank you for celebrating with us. If we shared a recording link with you, you can watch it there.",
            };
        default:
            return COULD_NOT_CHECK;
    }
}

const pad = (n) => String(n).padStart(2, "0");

/**
 * The numbers for the days / hours / minutes / seconds countdown, as the event
 * details card shows them: two digits each, never negative.
 * @param {number} ms milliseconds left
 */
export function countdownParts(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    return {
        days: pad(Math.floor(total / 86400)),
        hours: pad(Math.floor((total % 86400) / 3600)),
        mins: pad(Math.floor((total % 3600) / 60)),
        secs: pad(total % 60),
    };
}
