// Dates and times shown to guests are always formatted in IST, so a guest's
// own timezone cannot shift them.

const TZ = "Asia/Kolkata";

function parts(date, options) {
    const out = {};
    for (const p of new Intl.DateTimeFormat("en-US", { timeZone: TZ, ...options }).formatToParts(date)) {
        out[p.type] = p.value;
    }
    return out;
}

/** @returns {{weekday: string, label: string}} e.g. { weekday: "Sat", label: "28 Nov" } */
export function day(iso) {
    const p = parts(new Date(iso), { weekday: "short", day: "numeric", month: "short" });
    return { weekday: p.weekday, label: `${p.day} ${p.month}` };
}

/** @returns {string} e.g. "6 pm" or "5:45 am" */
export function time(iso) {
    const p = parts(new Date(iso), { hour: "numeric", minute: "2-digit", hour12: true });
    const clock = p.minute === "00" ? p.hour : `${p.hour}:${p.minute}`;
    return `${clock} ${p.dayPeriod.toLowerCase()}`;
}
