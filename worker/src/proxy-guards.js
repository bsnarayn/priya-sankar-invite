// Pure request/response checks for the album proxy routes.

/** True when the Referer's origin exactly matches an allowed origin. */
export function isAllowedReferer(referer, allowedOrigins) {
  if (!referer) return false;
  let origin;
  try {
    origin = new URL(referer).origin;
  } catch {
    return false;
  }
  return allowedOrigins.includes(origin);
}

/**
 * Guards the upload route before any body is streamed to Immich.
 * @returns {{ok: true} | {ok: false, status: number, message: string}}
 */
export function checkUploadRequest({ referer, contentType, contentLength }, allowedOrigins, maxBytes) {
  if (!isAllowedReferer(referer, allowedOrigins)) {
    return { ok: false, status: 403, message: "Forbidden" };
  }
  if (!(contentType ?? "").toLowerCase().startsWith("multipart/form-data")) {
    return { ok: false, status: 415, message: "Expected a multipart upload" };
  }
  const length = Number(contentLength);
  if (contentLength == null || contentLength === "" || !Number.isFinite(length) || length < 0) {
    return { ok: false, status: 411, message: "Content-Length required" };
  }
  if (length > maxBytes) {
    return { ok: false, status: 413, message: "Photo too large" };
  }
  return { ok: true };
}

/**
 * Whether an upstream (Immich) response looks like what the route expects.
 * A Cloudflare block page comes back as text/html, which must never be
 * relayed as if it were JSON or an image.
 */
export function isCleanUpstream(status, contentType, expected) {
  const type = (contentType ?? "").toLowerCase();
  return expected === "json" ? type.includes("application/json") : type.startsWith("image/");
}
