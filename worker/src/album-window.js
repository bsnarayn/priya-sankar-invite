// Pure album-window logic: when the shared album may be viewed.
// Two ways in: a reception window (start-inclusive, end-exclusive), and a
// permanent open from `permanentAfter` onwards. Config values are ISO-8601
// strings that carry an explicit +05:30 offset, so no timezone guesswork.

/**
 * Reads the three window vars from the Worker env.
 * Returns null unless all three parse and `open < close <= permanent`.
 */
export function parseWindowConfig(env) {
  const open = env?.ALBUM_OPEN_AT;
  const close = env?.ALBUM_CLOSE_AT;
  const permanent = env?.ALBUM_PERMANENT_AFTER;
  if (!open || !close || !permanent) return null;

  // Workers run in UTC, so a date without an offset would silently shift the
  // window by 5.5 hours. Require Z or an explicit +hh:mm / -hh:mm.
  const HAS_OFFSET = /(Z|[+-]\d{2}:\d{2})$/i;
  if (![open, close, permanent].every((v) => HAS_OFFSET.test(v))) return null;

  const openMs = Date.parse(open);
  const closeMs = Date.parse(close);
  const permanentMs = Date.parse(permanent);
  if (![openMs, closeMs, permanentMs].every(Number.isFinite)) return null;
  if (!(openMs < closeMs && closeMs <= permanentMs)) return null;

  return {
    receptionOpenAt: open,
    receptionCloseAt: close,
    permanentAfter: permanent,
  };
}

/**
 * @returns {{state: "open"|"closed", mode: "reception"|"permanent"|null,
 *   reason: "before"|"between"|null, opensAt: string|null,
 *   closesAt: string|null}}
 */
export function albumState(nowMs, cfg) {
  const open = Date.parse(cfg.receptionOpenAt);
  const close = Date.parse(cfg.receptionCloseAt);
  const permanent = Date.parse(cfg.permanentAfter);

  if (nowMs >= permanent) {
    return { state: "open", mode: "permanent", reason: null, opensAt: null, closesAt: null };
  }
  if (nowMs >= open && nowMs < close) {
    return { state: "open", mode: "reception", reason: null, opensAt: null, closesAt: cfg.receptionCloseAt };
  }
  if (nowMs < open) {
    return { state: "closed", mode: null, reason: "before", opensAt: cfg.receptionOpenAt, closesAt: null };
  }
  return { state: "closed", mode: null, reason: "between", opensAt: cfg.permanentAfter, closesAt: null };
}
