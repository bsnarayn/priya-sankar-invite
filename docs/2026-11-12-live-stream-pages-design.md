# Live stream pages (/wedding, /reception) - design

Status: built, not yet deployed. Wedding: 22 Nov 2026, 6 am IST, Guruvayur
temple. Reception: 28 Nov 2026, 6 pm IST, New Woodlands Hotel, Chennai.

## Goal

Two pages on the invite site, each showing a YouTube stream (live, then the
recording) inside a player with our own controls, open only for a set window.

## Decisions

| Topic | Decision |
|---|---|
| Pages | `/wedding` and `/reception` (no `-live`), same layout, `X-Robots-Tag: noindex` |
| Windows (IST) | Wedding 22 Nov 05:45 to 27 Nov 23:59:59. Reception 28 Nov 17:30 to 29 Nov 23:59:59. Open inclusive, close exclusive |
| Gate | In the Worker, not the page. `GET /api/live/<name>` returns the YouTube video id only while the page may show the player, so it is not in the site's HTML |
| Start check | While in the window, the Worker asks the YouTube Data API (`videos.list`, read-only key, works for unlisted videos) whether the stream is live. Answers cached 15 s at the edge |
| Page states | `before` (message + countdown), `waiting` (stream not started; page polls every 15 s and switches by itself), `live`, `replay` (player), `closed` (message) |
| Player | YouTube IFrame API with `controls=0`, `modestbranding`, `rel=0`, `disablekb`; a transparent shield over the video; our own play/pause, seek bar, LIVE badge, full screen. YouTube's small logo cannot be removed (their terms) |
| Fallback | `LIVE_<NAME>_FORCE=1` shows the player inside the window when YouTube cannot be checked |

## Worker configuration (dashboard Secrets, like the album vars)

`YOUTUBE_API_KEY`, and per page `LIVE_WEDDING_*` / `LIVE_RECEPTION_*`:
`OPEN_AT`, `CLOSE_AT` (ISO with `+05:30`), `VIDEO_ID`, optional `FORCE`.
Missing key or an invalid window gives a 500 (the page shows "couldn't check");
a missing video id gives "waiting".

## Limits

- The gate hides the link on our site only. An unlisted YouTube link keeps
  working for anyone who already has it; set the videos to Private after the
  windows if that matters. Do not set them Private earlier: the start check
  cannot see a private video.
- Seeking while live is limited to YouTube's buffer. The replay seeks normally.
- iPhone Safari cannot full-screen an embedded player, so that button is hidden
  there.
- The stream must allow embedding (YouTube Studio, stream settings).

## Tests

`worker/src/index.test.js` (live route: windows, boundaries, no id outside the
window, YouTube states, errors, cache, FORCE, config errors, referer, method),
`src/lib/live-copy.test.js` (messages and countdown).
