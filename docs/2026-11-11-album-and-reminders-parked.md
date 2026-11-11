# n8n reminder workflow - PARKED

Parked on 2026-11-11, expected to be a larger revamp. The album window moved out
of this file into `2026-11-11-album-window-design.md`. Nothing here is approved for
implementation.

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

## Cross-dependency

The 9 Dec album date lives in two places: the Worker var `ALBUM_PERMANENT_AFTER`
(enforcement) and the n8n Config node `album_available_after` (the "Album is Ready"
email trigger). Change both together.
