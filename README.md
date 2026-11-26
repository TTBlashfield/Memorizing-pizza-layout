# Makeline Trainer

An installable iPhone web app (PWA) for learning pizza builds by heart: toppings, build order,
portions for every size, per-slice placement and which drizzles go on before or after the bake.
It also sends quiz questions as notifications through the day.

**No build data lives in this repo or on the website.** The app works from your own
`builds.json`, which you load from the Files app. It stays on your phone (IndexedDB), and so does
your progress. Push messages carry no build data either: your phone picks the question.

## Install on iPhone

1. Open the site in **Safari** → **Share** → **Add to Home Screen** (leave "Open as Web App" on).
2. Open **Makeline** from the Home Screen icon, not from Safari. Safari and the Home Screen app
   keep separate storage.
3. Tap **Load builds** → choose `builds.json` from Files.

## What's in it

- **Home**: cards due, streak, accuracy, range/size filter chips (remembered), a button per mode
  and **Weak spots**.
- **Browse**: search, pizza pages with a size switcher, numbered build steps, "After the bake",
  base, placement, notes, facts and ⚠ flags.
- **Modes**: Flashcards · Build it (tap the order, type the portions) · Quick-fire portions ·
  Codes (both ways) · Placement & rules (per slice, slices per size, drizzles before or after
  the bake, extra cheese, facts).
- **Spaced repetition**: Leitner boxes 1–5, due again after 0 / 1 / 3 / 7 / 14 days. Misses go
  back to box 1 and come round again in the same session. Progress is keyed by stable IDs, so
  it survives re-importing an updated `builds.json`.
- **Deep links**: `#/q/<question key>` opens one question (notifications use this), then offers
  "3 more?".
- **Settings**: re-import, export/import/reset progress, notifications, check for updates.

## Quiz notifications

iPhone only allows web push for Home Screen apps (iOS 16.4+), and web apps can't schedule
notifications themselves. So a GitHub Actions workflow (`.github/workflows/quiz-notify.yml`) runs
every hour at about :17 and sends a push when the UK hour matches one of your times.

**Pick your times in the app**: Settings → Notifications → *Your times*. They travel to GitHub
inside the `PUSH_SUBSCRIPTION` secret (the **Copy my push subscription** button copies your
subscription *and* your times). If you change times later, the app says so: copy again and paste
over the secret. GMT/BST is handled for you, and there's one notification per hour at most.
Without times in the secret, [`notifier/default-schedule.json`](notifier/default-schedule.json)
is used (quiz at 10:00, 13:00, 16:00, 19:00, and the summary at 21:00).

How it stays private and reliable:

- The push is a [Declarative Web Push](https://github.com/w3c/push-api) message
  (`"web_push": 8030`, a generic `notification` with an absolute `navigate` URL, and
  `"mutable": true` next to it). It holds no build data.
- Whenever the app is open, it saves the next ~30 notification questions (favouring due and
  often-missed ones, mixing types, respecting your filters) in IndexedDB, with a backup copy in
  Cache Storage.
- On a push, the service worker (`docs/sw-push.js`) shows the next question with
  `tag: "quiz"`, and tapping it opens `#/q/<key>`. It **always** shows something; if anything
  fails it falls back to "🍕 Quiz time, tap to practise". The evening summary shows what's due
  and your streak. The app icon badge shows how many cards are due.

Secrets (repo **Settings → Secrets and variables → Actions**):

| Secret | What |
| --- | --- |
| `VAPID_PRIVATE_KEY` | Private half of the key pair. The public half is in `docs/js/config.js`. |
| `PUSH_SUBSCRIPTION` | From the app: Settings → Notifications → **Copy my push subscription** (includes your times). |
| `VAPID_SUBJECT` | Optional, e.g. `mailto:you@example.com`. Defaults to the app's address. |

If the push service says the subscription has gone (404/410), the run **fails** with "Re-enable
notifications in the app and update PUSH_SUBSCRIPTION", so GitHub emails you. To test, open
**Actions → Quiz notifications → Run workflow**.

GitHub turns off scheduled workflows in public repos after 60 days without activity. To stop
that, the workflow re-enables itself through the GitHub API once a day (the 03:17 UTC run). If
it's ever switched off anyway, open Actions → Quiz notifications → **Enable workflow**.

## Updating the app

Change files in `docs/`, then bump the version (`npm run bump 1.0.1`) and push. The installed
app shows **"Update available · tap to refresh"**. The service worker caches the app shell with a
versioned, cache-first cache and deletes old caches. Your builds and progress are untouched.

## Development

Plain HTML, CSS and JavaScript (ES modules). No framework, no build step, no CDNs.

```sh
npm test                 # unit tests (Node's test runner), FAKE fixture only
npm run e2e              # Playwright pass at an iPhone viewport (WebKit if installed, else Chromium)
npm run serve            # http://127.0.0.1:8080/makeline/
npm run icons            # re-render the icons
```

- `docs/`: the app (published by GitHub Pages)
- `notifier/`: the push sender run by GitHub Actions
- `tests/fixtures/sample-builds.json`: **fake** sample data. Never put a real `builds.json` in
  the repo; `.gitignore` blocks it.
