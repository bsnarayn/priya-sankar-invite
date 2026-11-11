# Album window + reminder workflow - PARKED

Parked on 2026-11-11 until the `/dinner-menu` work (see
`2026-11-11-dinner-menu-design.md`) is settled. Nothing here is approved for
implementation. Decisions recorded so they are not re-derived.

## Album window (decided)

| Now (IST) | State |
|---|---|
| before 28 Nov 2026 18:00 | closed |
| 28 Nov 18:00 up to 23:00 | open (reception window) |
| 28 Nov 23:00 up to 9 Dec 00:00 | closed |
| from 9 Dec 2026 00:00 | open permanently |

- Permanent go-live is 9 Dec 2026 (n8n Config was right; `site.json` says 2 Dec and
  is out of date). The permanent album and its notify-me form stay.
- Today the gate is client-side only (`album.astro` + `site.json:
  album_available_after`); the Worker `/api/album/*` routes only check Referer, so
  photos are reachable any time. Enforcement should move into the Worker.
- Proposed design: pure `albumState(now, cfg)` module in `worker/src/`, Worker
  vars `ALBUM_OPEN_AT` / `ALBUM_CLOSE_AT` / `ALBUM_PERMANENT_AFTER` (ISO with
  `+05:30`), `GET /api/album/status`, 403 on other album routes when closed (before
  the edge-cache lookup), missing vars -> 500 not silently open, page reads status
  instead of comparing the browser clock, 403 mid-session falls back to the gate.
  Unit tests via `node:test`. Deploy the Worker before the site.
- Accepted limits: already-cached thumbnails (7 days, immutable) stay in guests'
  browsers; the Referer check is weak.

## n8n "Reception Reminders" (`nsb-homelab/n8n/workflows/reception-reminders.json`)

Findings from review:
- Config node `album_available_after` = 2026-12-09, `reminder_date` =
  2026-11-18, `event_date` = 2026-11-28T18:00. The workflow fires daily; the
  reminder goes to RSVP'd guests the API returns from `/invite/rsvp/due-reminders`.
- The reminder email template is stale and hardcoded: "Evening onwards", "To be
  announced", "Smart casual - Festive welcome", raw ISO date. Real values (from
  `event.json`): 6 pm to 9 pm, New Woodlands Hotel Chennai, Festive, 28th November
  2026. Must be fixed before the 18 Nov 2026 08:00 IST send.
- Planned email changes: Config fields for the display values, a "View Menu" button
  (`https://priya.sankars.in/dinner-menu`), and a line about the album window.

New requirements raised, not yet designed:
- Send reminders over the couple's WhatsApp, around 25 messages per day.
- Manually add a few reminder recipients by inserting rows into the DB.
- Open concern for that discussion: automating a personal WhatsApp number risks
  the number being restricted; the official WhatsApp Business route has template
  and opt-in rules. Decide before building.
