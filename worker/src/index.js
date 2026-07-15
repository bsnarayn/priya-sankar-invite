const N8N_BASE = "https://workflow.sankaranarayan.in";

const ALLOWED_ORIGINS = ["https://priya.sankars.in", "https://priya-sankar-invite.pages.dev"];

export default {
  async fetch(request, env) {
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
    if (url.pathname === "/api/webhook/rsvp" && request.method === "POST") {
      const body = await request.text();
      const resp = await fetch(`${N8N_BASE}/webhook/rsvp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-webhook-secret": env.WEBHOOK_SECRET,
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
      const resp = await fetch(`${N8N_BASE}/webhook/album-notify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-webhook-secret": env.WEBHOOK_SECRET,
        },
        body,
      });
      return new Response(await resp.text(), {
        status: resp.status,
        headers: { "Content-Type": "application/json", ...cors },
      });
    }

    // The dashboard-reception route (GET /api/webhook/dashboard, PIN-gated)
    // has been removed -- that view moved to wedding.sankars.in, which is
    // already behind its own session auth and calls the n8n webhook
    // directly from its own API service, not through this proxy.

    return new Response("Not found", { status: 404, headers: cors });
  },
};
