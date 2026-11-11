// Gate message for the album page, built from the times the Worker's
// /api/album/status returns. Always formatted in IST so a guest's own
// timezone cannot shift the dates.

const TZ = "Asia/Kolkata";

function parts(date, options) {
    const out = {};
    for (const p of new Intl.DateTimeFormat("en-US", { timeZone: TZ, ...options }).formatToParts(date)) {
        out[p.type] = p.value;
    }
    return out;
}

function day(iso) {
    const p = parts(new Date(iso), { weekday: "short", day: "numeric", month: "short" });
    return { weekday: p.weekday, label: `${p.day} ${p.month}` };
}

function time(iso) {
    const p = parts(new Date(iso), { hour: "numeric", minute: "2-digit", hour12: true });
    const clock = p.minute === "00" ? p.hour : `${p.hour}:${p.minute}`;
    return `${clock} ${p.dayPeriod.toLowerCase()}`;
}

/**
 * @param {{reason: "before"|"between", receptionOpenAt: string,
 *   receptionCloseAt: string, permanentAfter: string}} status
 */
export function gateCopy(status) {
    const permanent = day(status.permanentAfter).label;
    if (status.reason === "between") {
        return `The album is closed for now. It opens again for good on ${permanent}.`;
    }
    const open = day(status.receptionOpenAt);
    return (
        `The album opens during the reception on ${open.weekday} ${open.label}, ` +
        `${time(status.receptionOpenAt)} to ${time(status.receptionCloseAt)}, ` +
        `and again for good from ${permanent}.`
    );
}
