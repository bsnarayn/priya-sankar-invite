// Invite site Worker (priya.sankars.in/api/*): proxies RSVP, album-notify and
// photo-normalize to wedding-planner-api, gates the shared Immich album by a
// time window, and proxies guest uploads so no Immich credential reaches a
// browser. One file so it can be pasted into the Cloudflare dashboard editor;
// the tests (index.test.js) drive the fetch handler.

// -- Request and response checks -------------------------------------------

// Pure request/response checks for the album proxy routes.

/** True when the Referer's origin exactly matches an allowed origin. */
function isAllowedReferer(referer, allowedOrigins) {
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
function checkUploadRequest({ referer, contentType, contentLength }, allowedOrigins, maxBytes) {
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
function isCleanUpstream(status, contentType, expected) {
  const type = (contentType ?? "").toLowerCase();
  return expected === "json" ? type.includes("application/json") : type.startsWith("image/");
}

// -- Album window ----------------------------------------------------------

// Pure album-window logic: when the shared album may be viewed.
// Two ways in: a reception window (start-inclusive, end-exclusive), and a
// permanent open from `permanentAfter` onwards. Config values are ISO-8601
// strings that carry an explicit +05:30 offset, so no timezone guesswork.

/**
 * Reads the three window vars from the Worker env.
 * Returns null unless all three parse and `open < close <= permanent`.
 */
function parseWindowConfig(env) {
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
function albumState(nowMs, cfg) {
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

// -- Routes ----------------------------------------------------------------

// Public Cloudflare Tunnel hostname for wedding-planner-api -- not a
// secret (just a domain), so it's a plain constant like N8N_BASE was.
const WEDDING_API_BASE = "https://wedding-planner-api.sankaranarayan.in";

const ALLOWED_ORIGINS = ["https://priya.sankars.in", "https://priya-sankar-invite.pages.dev"];

// Guest photo uploads are capped here, before anything is streamed to Immich.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") ?? "";
    const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": corsOrigin,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const cors = { "Access-Control-Allow-Origin": corsOrigin };
    const json = (body, status = 200, extra = {}) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...cors, ...extra },
      });

    // ── POST /api/webhook/rsvp ───────────────────────────────────────────
    // Proxies to wedding-planner-api's own intake route now, not n8n --
    // see priya-sankar-wedding-planner's invite.ts. Public-facing path here
    // is unchanged so RSVP.astro doesn't need to know anything moved.
    if (url.pathname === "/api/webhook/rsvp" && request.method === "POST") {
      const body = await request.text();
      const resp = await fetch(`${WEDDING_API_BASE}/invite/rsvp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-proxy-secret": env.WEDDING_API_PROXY_SECRET,
          // Forwarded under a custom header name, not cf-connecting-ip or
          // x-real-ip -- both got silently overwritten in testing.
          // CF-Connecting-IP is Cloudflare-reserved and re-stamped on any
          // request re-entering their network (this fetch() included,
          // since the API's tunnel hostname is also Cloudflare-fronted) to
          // reflect the truthful sender for *that* hop, which is this
          // Worker's edge location, not the guest. X-Real-IP then got
          // overwritten again one hop later by NPM's reverse-proxy config
          // in front of the API container (its default behavior for that
          // specific header name). x-guest-ip has no special meaning to
          // either layer, so nothing along the chain has a built-in reason
          // to touch it.
          "x-guest-ip": request.headers.get("CF-Connecting-IP") ?? "",
        },
        body,
      });
      return new Response(await resp.text(), {
        status: resp.status,
        headers: { "Content-Type": "application/json", ...cors },
      });
    }

    // ── POST /api/webhook/album-notify ──────────────────────────────────
    if (url.pathname === "/api/webhook/album-notify" && request.method === "POST") {
      const body = await request.text();
      const resp = await fetch(`${WEDDING_API_BASE}/invite/album-notify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-proxy-secret": env.WEDDING_API_PROXY_SECRET,
          // Same x-guest-ip fix as the RSVP route above -- this was still
          // sending x-real-ip, which NPM's reverse proxy silently
          // overwrites, so every guest's submission was landing on the
          // same rate-limit key (NPM's own internal IP) and blocking
          // everyone else after 3 total submissions per hour, site-wide.
          "x-guest-ip": request.headers.get("CF-Connecting-IP") ?? "",
        },
        body,
      });
      return new Response(await resp.text(), {
        status: resp.status,
        headers: { "Content-Type": "application/json", ...cors },
      });
    }

    // ── POST /api/webhook/photo-normalize ───────────────────────────────
    // Runs a guest's photo through wedding-planner-api's server-side
    // HEIC-decode/resize step (see invite.ts's normalize-image route)
    // before this Worker uploads it on to Immich. Replaces the old
    // browser-image-compression client-side step, which silently no-op'd
    // for HEIC photos on most non-Safari browsers.
    if (url.pathname === "/api/webhook/photo-normalize" && request.method === "POST") {
      const resp = await fetch(`${WEDDING_API_BASE}/invite/normalize-image`, {
        method: "POST",
        headers: {
          "Content-Type": request.headers.get("Content-Type") ?? "",
          "x-proxy-secret": env.WEDDING_API_PROXY_SECRET,
          "x-guest-ip": request.headers.get("CF-Connecting-IP") ?? "",
        },
        body: request.body,
      });
      if (!resp.ok) {
        return new Response(await resp.text(), {
          status: resp.status,
          headers: { "Content-Type": "application/json", ...cors },
        });
      }
      const normalizedFilename = resp.headers.get("X-Normalized-Filename") ?? "";
      return new Response(resp.body, {
        status: resp.status,
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Normalized-Filename": normalizedFilename,
          ...cors,
        },
      });
    }

    // The dashboard-reception route (GET /api/webhook/dashboard, PIN-gated)
    // has been removed -- that view moved to wedding.sankars.in, which is
    // already behind its own session auth and calls the n8n webhook
    // directly from its own API service, not through this proxy.

    // ── Album viewing (proxied to Immich) ───────────────────────────────
    // The album page never talks to Immich directly and never sees the
    // share slug -- it only knows about these routes. That keeps the slug
    // (Immich's actual access credential for the shared album) out of the
    // browser entirely, so it can't be lifted from dev tools and used to
    // hit Immich directly, bypassing this site.
    if (url.pathname.startsWith("/api/album/")) {
      // Requests must be same-origin loads of the invite site, not a
      // direct hit on this worker route from elsewhere.
      const referer = request.headers.get("Referer") ?? "";
      if (!isAllowedReferer(referer, ALLOWED_ORIGINS)) {
        return new Response("Forbidden", { status: 403, headers: cors });
      }

      const immichBase = env.IMMICH_BASE;
      const slug = env.IMMICH_SLUG;
      // Sent to Immich as X-Album-Key; the Cloudflare WAF rule on the photos
      // host blocks any slug-bearing request that does not carry it.
      const proxyKey = env.IMMICH_PROXY_KEY;
      const windowCfg = parseWindowConfig(env);
      if (!immichBase || !slug || !proxyKey || !windowCfg) {
        return json({ message: "Album not configured" }, 500);
      }
      const badGateway = () => json({ message: "Photo service unavailable" }, 502);
      const windowState = albumState(Date.now(), windowCfg);

      // Edge-caches an upstream Immich response at Cloudflare's PoP, keyed
      // on the upstream URL itself (not the incoming request) so it's
      // shared across every guest hitting this route, regardless of which
      // origin/referer they came from. Cuts repeat concurrent album
      // viewing down to one Immich origin hit per PoP per TTL window,
      // instead of one per guest.
      // Only a response of the kind the route expects ("json" or "image") is
      // cached, so a 200 HTML login/block page cannot be stuck in the cache.
      async function cachedImmichFetch(immichUrl, ttlSeconds, expected) {
        const cache = caches.default;
        const cacheKey = new Request(immichUrl, { method: "GET" });
        const hit = await cache.match(cacheKey);
        if (hit) return hit;

        const upstream = await fetch(immichUrl, { headers: { "X-Album-Key": proxyKey } });
        const resp = new Response(upstream.body, upstream);
        resp.headers.set("Cache-Control", `public, max-age=${ttlSeconds}`);
        if (upstream.ok && isCleanUpstream(upstream.status, upstream.headers.get("Content-Type"), expected)) {
          ctx.waitUntil(cache.put(cacheKey, resp.clone()));
        }
        return resp;
      }

      // Always answerable, so the album page can decide what to show.
      if (url.pathname === "/api/album/status" && request.method === "GET") {
        return json(
          {
            ...windowState,
            receptionOpenAt: windowCfg.receptionOpenAt,
            receptionCloseAt: windowCfg.receptionCloseAt,
            permanentAfter: windowCfg.permanentAfter,
          },
          200,
          { "Cache-Control": "no-store" },
        );
      }

      // Guest uploads go through here so the Immich slug never reaches a
      // browser. Deliberately not time-gated: guests can upload any time.
      if (url.pathname === "/api/album/upload" && request.method === "POST") {
        const contentType = request.headers.get("Content-Type") ?? "";
        const check = checkUploadRequest(
          { referer, contentType, contentLength: request.headers.get("Content-Length") },
          ALLOWED_ORIGINS,
          MAX_UPLOAD_BYTES,
        );
        if (!check.ok) return json({ message: check.message }, check.status);

        const upstream = await fetch(`${immichBase}/api/assets?slug=${encodeURIComponent(slug)}`, {
          method: "POST",
          headers: { "Content-Type": contentType, "X-Album-Key": proxyKey },
          body: request.body,
          duplex: "half",
        });
        if (!isCleanUpstream(upstream.status, upstream.headers.get("Content-Type"), "json")) {
          return badGateway();
        }
        return new Response(await upstream.text(), {
          status: upstream.status,
          headers: { "Content-Type": "application/json", ...cors },
        });
      }

      // Everything below shows photos, so it only works while the album is
      // open. Checked before cachedImmichFetch so edge-cached copies cannot
      // be served outside the window.
      if (windowState.state === "closed") {
        return json({ state: "closed", reason: windowState.reason, opensAt: windowState.opensAt }, 403);
      }

      if (url.pathname === "/api/album/info" && request.method === "GET") {
        // Short TTL — album metadata (title, asset count) rarely changes,
        // but should reflect new uploads reasonably promptly.
        const resp = await cachedImmichFetch(
          `${immichBase}/api/shared-links/me?slug=${encodeURIComponent(slug)}`,
          30,
          "json",
        );
        if (!isCleanUpstream(resp.status, resp.headers.get("Content-Type"), "json")) return badGateway();
        // Immich's shared-link object also carries the share key and slug,
        // which would let a guest query Immich directly outside the window,
        // so only the album fields the page uses are passed on.
        if (!resp.ok) return json({ message: "Album unavailable" }, resp.status);
        let link;
        try {
          link = JSON.parse(await resp.text());
        } catch {
          return badGateway();
        }
        if (!link?.album) return badGateway();
        const { id, startDate, endDate, assetCount } = link.album;
        return json({ album: { id, startDate, endDate, assetCount } });
      }

      if (url.pathname === "/api/album/bucket" && request.method === "GET") {
        const albumId = url.searchParams.get("albumId") ?? "";
        const timeBucket = url.searchParams.get("timeBucket") ?? "";
        const order = url.searchParams.get("order") ?? "desc";
        const immichUrl =
          `${immichBase}/api/timeline/bucket?albumId=${encodeURIComponent(albumId)}` +
          `&order=${encodeURIComponent(order)}&slug=${encodeURIComponent(slug)}` +
          `&timeBucket=${encodeURIComponent(timeBucket)}`;
        // Short TTL — this is the list of asset ids in the bucket. New
        // photos guests upload during the event need to show up for
        // everyone else without a long wait, so we trade a little bit of
        // origin load for freshness here rather than caching hard.
        const resp = await cachedImmichFetch(immichUrl, 20, "json");
        if (!isCleanUpstream(resp.status, resp.headers.get("Content-Type"), "json")) return badGateway();
        return new Response(await resp.text(), {
          status: resp.status,
          headers: { "Content-Type": "application/json", ...cors },
        });
      }

      const thumbMatch = url.pathname.match(/^\/api\/album\/thumbnail\/([^/]+)$/);
      if (thumbMatch && request.method === "GET") {
        const assetId = thumbMatch[1];
        const size = url.searchParams.get("size") ?? "thumbnail";
        const immichUrl =
          `${immichBase}/api/assets/${encodeURIComponent(assetId)}/thumbnail` +
          `?slug=${encodeURIComponent(slug)}&size=${encodeURIComponent(size)}`;
        // Long TTL, safe to cache hard — a given assetId+size's image bytes
        // never change once uploaded (a new photo is always a new assetId,
        // so this never goes stale the way the bucket listing above can).
        const resp = await cachedImmichFetch(immichUrl, 604800, "image");
        if (!isCleanUpstream(resp.status, resp.headers.get("Content-Type"), "image")) return badGateway();
        return new Response(resp.body, {
          status: resp.status,
          headers: {
            "Content-Type": resp.headers.get("Content-Type") ?? "image/jpeg",
            "Cache-Control": "public, max-age=604800, immutable",
            ...cors,
          },
        });
      }

      return new Response("Not found", { status: 404, headers: cors });
    }

    return new Response("Not found", { status: 404, headers: cors });
  },
};
