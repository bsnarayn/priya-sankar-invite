// Gate message for the album page, built from the times the Worker's
// /api/album/status returns. Always formatted in IST so a guest's own
// timezone cannot shift the dates.
import { day, time } from "./ist-format.js";

/**
 * @param {{reason: "before"|"between", receptionOpenAt: string,
 *   receptionCloseAt: string, permanentAfter: string}} status
 */
export function gateCopy(status) {
    // No permanent-opening date on purpose: guests are only told to subscribe
    // and that they will be notified.
    const subscribe =
        `The final album will be available to view once you subscribe below, ` +
        `and we'll notify you as soon as it's ready.`;
    if (status.reason === "between") {
        return `The reception album is closed for now. ${subscribe}`;
    }
    const open = day(status.receptionOpenAt);
    return (
        `Our shared album will be open during the reception on ${open.weekday} ${open.label} ` +
        `(${time(status.receptionOpenAt)} to ${time(status.receptionCloseAt)}), ` +
        `so you will be able to view the event pictures that you and other guests ` +
        `upload during the event itself. ${subscribe}`
    );
}
