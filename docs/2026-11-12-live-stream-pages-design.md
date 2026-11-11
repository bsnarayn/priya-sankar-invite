# Live stream pages (/live, /wedding, /reception) - design

Status: built; Worker secrets must be updated before deploying (see below).
Wedding: 22 Nov 2026, 6 am IST, Guruvayur temple. Reception: 28 Nov 2026,
6 pm IST, New Woodlands Hotel, Chennai.

## Pages

| Page | Audience | Behaviour |
|---|---|---|
| `/live` | Everyone (linked from the reminders) | Follows the day. Shows the event whose flag is on, from its opening time until its live-close time, then moves to the next enabled event. After the last one: "The live stream has ended" |
| `/wedding`, `/reception` | Hand-shared with guests (the recording) | Open from the event's opening time and **never close** (no closing gate): the stream while live, the replay afterwards |

All three are `noindex`. `/live` changes its heading and details by itself as
the day moves from the wedding to the reception.

## Times (IST)

| Event | Opens (all pages) | `/live` stops showing it |
|---|---|---|
| Wedding | 22 Nov 05:45 | 22 Nov 23:59:59 |
| Reception | 28 Nov 17:30 | 28 Nov 23:59:59 |

Open inclusive, close exclusive. Between the events `/live` counts down to the
reception.

## Worker configuration (dashboard Secrets)

Per event (`WEDDING` / `RECEPTION`):

- `LIVE_<X>_ENABLED`: `1` or `true` (any case) shows that event on `/live`;
  anything else or unset hides it. It does **not** affect `/wedding` or
  `/reception`.
- `LIVE_<X>_OPEN_AT`: opening time, ISO with `+05:30`. Used by all pages.
- `LIVE_<X>_CLOSE_AT`: when `/live` stops showing the event. Used only by
  `/live` (required when the event is enabled). The hand-shared pages ignore it.
- `LIVE_<X>_VIDEO_ID`: the 11 characters after `/live/` in the YouTube link.
- `LIVE_<X>_FORCE` (optional): `1` shows the player inside the window if
  YouTube cannot be checked. It never opens a page early or keeps `/live` open
  past its close time.

Plus `YOUTUBE_API_KEY`. A disabled event needs no other settings on `/live`.

## How the gate works

The video id is not in the site's HTML. The pages ask the Worker
(`/api/live/wedding`, `/api/live/reception`, `/api/live/current`), which
returns the id only when the player may be shown. While a window is open the
Worker asks the YouTube Data API (read-only key, works for unlisted videos)
whether the stream is live (answer cached 15 s at the edge).

| State | Meaning | Page shows |
|---|---|---|
| `before` | Not open yet | The event card countdown, "The event live stream opens by" |
| `waiting` | Open, stream not started (or YouTube cannot see the video) | "Waiting for the stream to begin"; polls every 15 s |
| `live` / `replay` | Stream running / ended | The player |
| `closed` | `/live` only: nothing left to show | "The live stream has ended" |

## Player

YouTube IFrame API with `controls=0`, `modestbranding`, `rel=0`, `disablekb`; a
transparent shield over the video; our own play/pause, seek bar, LIVE badge and
full screen; right-click and long-press blocked. YouTube's small logo cannot be
removed (their terms).

## Limits

- The gate hides the link on our site only. Anyone who opens the browser's
  developer tools while the player is on screen can read the video id, and an
  unlisted YouTube link keeps working for anyone who has it. Set the videos to
  Private later if that matters. Do not set them Private before the streams:
  the start check cannot see a private video.
- Seeking while live is limited to YouTube's buffer; the replay seeks normally.
- iPhone Safari cannot full-screen an embedded player, so that button is hidden
  there.
- The streams must allow embedding (YouTube Studio, stream settings).

## Tests

`worker/src/index.test.js` (all three routes: windows and boundaries, flag
values, no id outside the window, no closing gate on the hand-shared pages,
YouTube states, errors, cache, FORCE, configuration, referer, method),
`src/lib/live-copy.test.js` (messages and countdown numbers).
