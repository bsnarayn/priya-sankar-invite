// Public Cloudflare Tunnel hostname for wedding-planner-api -- not a
// secret (just a domain), so it's a plain constant like N8N_BASE was.
const WEDDING_API_BASE = "https://wedding-planner-api.sankaranarayan.in";

const ALLOWED_ORIGINS = ["https://priya.sankars.in", "https://priya-sankar-invite.pages.dev"];

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
      const refererOk = ALLOWED_ORIGINS.some((o) => referer.startsWith(o));
      if (!refererOk) {
        return new Response("Forbidden", { status: 403, headers: cors });
      }

      const immichBase = env.IMMICH_BASE;
      const slug = env.IMMICH_SLUG;
      if (!immichBase || !slug) {
        return new Response(JSON.stringify({ message: "Album not configured" }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...cors },
        });
      }

      // Edge-caches an upstream Immich response at Cloudflare's PoP, keyed
      // on the upstream URL itself (not the incoming request) so it's
      // shared across every guest hitting this route, regardless of which
      // origin/referer they came from. Cuts repeat concurrent album
      // viewing down to one Immich origin hit per PoP per TTL window,
      // instead of one per guest.
      async function cachedImmichFetch(immichUrl, ttlSeconds) {
        const cache = caches.default;
        const cacheKey = new Request(immichUrl, { method: "GET" });
        const hit = await cache.match(cacheKey);
        if (hit) return hit;

        const upstream = await fetch(immichUrl);
        const resp = new Response(upstream.body, upstream);
        resp.headers.set("Cache-Control", `public, max-age=${ttlSeconds}`);
        if (upstream.ok) ctx.waitUntil(cache.put(cacheKey, resp.clone()));
        return resp;
      }

      if (url.pathname === "/api/album/info" && request.method === "GET") {
        // Short TTL — album metadata (title, asset count) rarely changes,
        // but should reflect new uploads reasonably promptly.
        const resp = await cachedImmichFetch(
          `${immichBase}/api/shared-links/me?slug=${encodeURIComponent(slug)}`,
          30,
        );
        return new Response(await resp.text(), {
          status: resp.status,
          headers: { "Content-Type": "application/json", ...cors },
        });
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
        const resp = await cachedImmichFetch(immichUrl, 20);
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
        const resp = await cachedImmichFetch(immichUrl, 604800);
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
