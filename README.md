# 📺 WSTV Live — WebSockets Television

An iCarly-style web TV network. Anyone can run their own television channel from
their browser — schedule shows, go live, take breaks — and everyone else watches
from a proper DStv-style guide. Built with Node, Express and Socket.IO.

```
Viewer (browser)  ◀── websockets: guide, viewers, chat ──▶  WSTV server
      │
      └── plays videos straight from their urls (youtube / mp4 / streams)
```

The server never streams video. It serves **info** — channels, schedules,
what's on now, viewer counts, chat — and locks everything down. Video playback
happens client-side from the URLs in the schedule.

## Roles

| Role | What they can do |
|---|---|
| **Viewer** | Watch, follow the guide, chat live |
| **Broadcaster** | Everything a viewer can + create channels, upload channel image, go live, schedule shows, set break-time videos |
| **Admin** | Everything + edit **any** channel (incl. the system ones), manage users & roles, ban, set channel numbers |

The **first account created on a fresh install becomes the admin**. No env vars needed.

## Channels

- **System channels** (created at first boot, admin-only): `100 WSTV Prime` — the flagship web-show channel, and `101 WSTV Loop` — regular shows & reruns.
- **User channels** — created by broadcasters, numbered from 200 up.
- Each channel has: name, tagline, image, live url, **next-show info**, break videos, and a schedule.
- **Next-show info**: if the owner/admin writes a custom note it shows everywhere; otherwise it falls back to the channel name (first few words).
- **Offline channels** show an info card laid over the channel's uploaded image.

## The guide (homepage)

A proper decoder UI — desktop gets the channel rail, the i-plate (now/next) and
a 4-hour programme grid with a live now-line. Mobile gets channel chips, a
now/next list and a bottom tab bar. Everything (status, viewer counts) updates
live over websockets without a refresh.

## Watching

`/watch/:id` is the player. It works out what should be on screen right now:

- scheduled show running → plays that video (YouTube links become embeds, everything else uses `<video>`)
- between shows → **break time**: plays the channel's break videos on a loop with an "up next" countdown
- live with no schedule → plays the channel's live URL
- offline → info card over the channel image

Plus a live chat (signed-in users only) and live viewer counts.

## Security

- scrypt-hashed passwords, httpOnly session cookies (7-day sliding)
- role checks on every write; channel edits restricted to owner (user channels) or admin (everything)
- system channels can't be deleted by anyone
- CSP locks scripts to same-origin; images/media allowed from anywhere since channels point at external urls
- uploaded images sniffed by magic bytes (png/jpg/gif/webp), 2MB cap
- rate limits: signup, login, channel create/edit, chat (6 msgs / 10s)
- chat and all rendered text escaped; nothing user-written ever hits innerHTML unescaped
- unknown pages → real 404 test-card page; unknown API paths → JSON 404

## Run it

```bash
npm install
npm start          # PORT env respected, defaults to 3000
```

Open `http://localhost:3000`, create the first account (it becomes admin), then:

1. `/studio` → create a channel, upload an image, add a schedule, drop in break video urls, flip the live switch.
2. `/admin` → manage users, quick-toggle any channel, edit next-show info, open full editor in Studio.
3. Watch from the guide, chat from the watch page.

Data lives in `data/*.json` (gitignored) — users, sessions, channels, chat. Easy to back up, easy to read.

## Deploy

Any Node 18+ host (Railway, Render, Fly…). Set `PORT` if the host requires it. No database, no env secrets. If you put it behind a proxy, make sure websockets are allowed (`ws://` upgrade).
