# WhatsApp reminders (tap-to-send) - design

Status: implemented and live (API deployed 2026-11-11; workflow published). The
workflow ships without any test scaffolding.
Reception: 28 Nov 2026, 6-9 pm IST, New Woodlands Hotel, Chennai.
Builds on the email reminder (n8n "Reception Reminders", ntfy-gated, live).

## Goal

Reach guests the email cannot (today: 4 Yes guests with a phone but no email,
plus any added by hand) over WhatsApp, with the same "nothing goes out until I
confirm" control as the email. A person taps each message from their own
WhatsApp; nothing is sent automatically.

## Decisions

| Topic | Decision |
|---|---|
| Sending | Tap-to-send `wa.me` links from the owner's own phone. No bot, no unofficial tooling, no ban risk |
| Audience | A list of every Yes guest with a valid number who has not yet had this round. Guests with no email are pre-ticked; the owner ticks or unticks per run |
| Remembering | Log per message round in a new table; a guest can have each round once |
| Manual recipients | Real guests inserted into `reception_guests` (so they count in RSVP stats and get the email too, if they have one) |
| Phone numbers | Already stored as clean international numbers (`+<country code><digits>`, 31 of 31 verified). Links use the digits without the `+`. No guessing or prefixing |
| Rounds | A round is a name + start date + message text in the workflow Config. First round: `reminder`, starting 2026-11-18. A later "day-before" nudge is another round, not new code |
| Control | ntfy notification on topic `wedding-events` (existing credential), link to an unguessable n8n page, same pattern as the email gate |

## Data (wedding-planner database)

New migration `migrations/028_whatsapp_sends.sql` (additive, no existing table changes):

```sql
CREATE TABLE whatsapp_sends (
  id SERIAL PRIMARY KEY,
  guest_id INTEGER NOT NULL REFERENCES reception_guests(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind ~ '^[a-z0-9-]{1,30}$'),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guest_id, kind)
);
```

Adding a guest by hand (the number must be in `+<country code><number>` form):

```sql
INSERT INTO reception_guests (event_id, name, email, mobile, rsvp_response, guests_count, rsvp_submitted_at)
VALUES (2, 'Full Name', NULL, '+91XXXXXXXXXX', 'Yes', 1, now());
```

Note: the email round only reaches guests whose RSVP time is before the reminder
date (18 Nov) on the first run, and before 26 Nov 18:00 IST after that; a guest
added later is picked up by the 26 Nov run. Set `rsvp_submitted_at` earlier to
include them sooner.

## API (`wedding-planner/api/src/routes/invite.ts`)

Both routes sit under `/invite`, behind the existing `x-proxy-secret` hook plus
`requireReminderSecret` (like `/rsvp/due-reminders`).

- `POST /invite/whatsapp/due` body `{kind}` (validated against the same
  pattern as the column). Returns
  `{guests: [{id, name, mobile, waNumber, validNumber, phoneOnly}]}` for guests
  of the reception event with `rsvp_response = 'Yes'`, `rsvp_submitted_at IS NOT NULL`,
  `mobile IS NOT NULL`, and no `whatsapp_sends` row for `(guest, kind)`.
  `validNumber` = mobile matches `^\+[1-9][0-9]{7,14}$`; `waNumber` = mobile
  without the `+`; `phoneOnly` = no email. Ordered phone-only first, then name.
  Read-only.
- `POST /invite/whatsapp/mark-sent` body `{kind, ids: number[]}`. Inserts one
  log row per id that belongs to the reception event, `ON CONFLICT DO NOTHING`.
  Returns `{marked: n}` (the number actually inserted).

## n8n workflow (`nsb-homelab/n8n/workflows/reception-whatsapp-reminders.json`)

A separate workflow, same structure as the email one (trigger Set nodes carry a
`route` field into a `Config` node, then IF nodes route):

- **Config** holds: `kind` (`reminder`), `round_start` (`2026-11-18T00:00:00`,
  IST) and `round_end` (`2026-11-28T18:00:00`, when the event starts),
  `message_template` (with `{name}`, the guest's name exactly as entered, since
  the invite has one "Your name" field), `n8n_webhook_base`, and `list_path` /
  `sent_path` (random segments, also in the webhook nodes).
- **Daily** (schedule, 08:00 IST): only while the round is active
  (`round_start <= now < round_end`); fetch due; if any phone-only guest with a
  valid number is due, post ntfy to `wedding-events`: "N guests need a
  WhatsApp message", with a `view` action "Open list" to the list page. Ignored
  notifications repeat the next day.
- **List page** (GET, unguessable path): fetch due; render a form with, per
  guest, a tick box (pre-ticked when `phoneOnly`), the name, a "no email" tag,
  and an "Open WhatsApp" button that links to
  `https://wa.me/<waNumber>?text=<encoded message>`. Guests with
  `validNumber = false` are shown flagged and untickable. One button at the
  bottom, "Mark ticked as sent", POSTs the ticked ids.
- **Mark sent** (POST, unguessable path): normalise `ids` (string or array),
  call `mark-sent`, return a confirmation page with the count. With no ids
  ticked, return "nothing marked" without calling the API.
- **No test mode ships.** The flow was tried live once with a temporary test
  link (fake guest, nothing recorded); that scaffolding was then removed from
  the workflow, and the validation script fails if it reappears.
- Every webhook path ends at a single respond node; names are HTML-escaped.

Draft message (round `reminder`):

> Hi {name},
> A gentle reminder about Sankar & Priya's reception
>
> Invitation: https://priya.sankars.in
>
> Details: 28 November 2026, 6 pm to 9 pm, at New Woodlands Hotel, Chennai.
> Location: https://maps.app.goo.gl/8J9diUhzpJjKfDeN6
>
> Menu: https://priya.sankars.in/dinner-menu
>
> We can't wait to celebrate with you!

The Invitation link comes first because WhatsApp builds its preview card from the
first link in the message. WhatsApp has no hyperlinked text, so links show as raw
URLs.

## Testing

- API: `tsc --noEmit`; the new queries are checked read-only against the real
  data on the server (counts only), plus a `BEGIN; ... ROLLBACK;` dry run of the
  migration before applying it.
- Workflow: a script checks the graph (every webhook path ends at the respond
  node, no dangling IF output) and runs each code node with real inputs,
  including HTML escaping, the `wa.me` link and message encoding, pre-ticking,
  invalid-number flagging, and the array/string `ids` handling.
- Live: tried once with a temporary test link (since removed), then the real
  list viewed once without marking anyone.

## Rollout order

1. Apply migration 028 on the server (psql in `postgres-common`, role `wedding`).
2. Deploy the API: pull `main` on oci, build, recreate the container (keep the
   previous image tagged for rollback, as for the last deploy).
3. Import `reception-whatsapp-reminders.json` into n8n; activate it.
4. Open the real list once without marking anyone; the first real nudge is
   18 Nov 08:00 IST.

## Risks and limits

- Tapping is manual: a guest only counts as messaged once the owner ticks them
  and presses "Mark ticked as sent". Ticking without sending is possible.
- The list page shows names (PII) behind an unguessable URL, the same
  protection as the email review page.
- `wa.me` links open WhatsApp on the device used; the owner needs the page open
  on a phone (or desktop WhatsApp) with their own WhatsApp.
- Declined guests and guests without a number never appear.

## Out of scope

Automated sending (no bot or business API); guests who did not RSVP Yes;
delivery or read tracking; editing the message per guest.
