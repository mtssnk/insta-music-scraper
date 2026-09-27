# guestsixonetwo record catalogue

## Goal

Build a complete catalogue of every record posted by the Instagram account **@guestsixonetwo**. The account is a DJ/crate-digger that posts one record per post, mostly techno, electro, dub techno and house. For each post we want:

- artist, title, label and format (EP, Album, Single or Compilation)
- the Instagram post URL, plus the post date if it can be captured
- a Discogs link (a pre-filled search is fine; an exact release page is a stretch goal)

The final output is a spreadsheet (`.xlsx`, plus `.csv`) that can be sorted and filtered.

## Background (from a previous claude.ai chat)

- The profile grid is **virtualized**. Only the rows near the viewport exist in the DOM, and the rest of the grid is represented by `padding-top` / `padding-bottom` on the grid container. Copying HTML from DevTools therefore only captures about 30–60 posts at a time.
- Each grid item is an `<a href="/guestsixonetwo/p/{shortcode}/">` (or `/reel/`) wrapping an `<img alt="...">`. The alt text is the post caption.
- Captions are almost entirely hashtags in a consistent order:
  `#artist #title #ep|#album|#single|#lp|#compilation #track1 #track2 ... #label #labelrecords #genre #city #country #cratedigger #selector #dj #guestsixonetwo #sixonetwo #guest612 #612`
  - Hashtags are lowercase with no spaces (`#stevebicknell`, `#thebluntedboywonder`), so names need re-spacing and capitalising. Treat this as the hard part of the parsing.
  - The label usually appears twice: as `#name` and as `#namerecords` (or `#namerecordings`).
  - Collaborations and "Various" releases put several artist tags before the title.
  - Remixes appear as `#artistname #remix` among the track tags.
  - The trailing boilerplate is `#cratedigger #selector #dj #guestsixonetwo #sixonetwo #guest612 #612`, sometimes with `#analog` or `#deejay`. Typos occur, such as `#geust612` and `#sellector`.
  - A few posts have no caption at all.
- The grid also includes posts from other accounts (such as @00.00.00_records reels) through collabs or pins. Keep these but flag them.
- An in-browser console script that auto-scrolled the grid collected posts until about post 726, then stalled. Instagram returned **429 Too Many Requests**. The final console message ("WebSocket is already in CLOSING or CLOSED state") came from Instagram's own realtime connection and is not the cause of the stall. The real limit is rate-limiting on the grid's paging requests.
- Grid padding measurements put rows at about 444px and suggest **about 2,200 posts** in total. Verify this against the post count on the profile header.

## Existing data

`data/seed_records.json` contains **723 hand-parsed records**, newest first. They run from the newest post down to shortcode `DUAo3JdjfWR` (Rubycon – *Physical Plant*).

- Fields: `shortcode`, `account`, `artist`, `title`, `label`, `format`, `note`, `needs_check`.
- These records were parsed by hand, so their artist, title and label values are **authoritative**. Automatic parsing must never overwrite them. Use them as overrides, and also as test cases for the parser.
- 12 records are marked `needs_check` because of ambiguous hashtags, and 7 have no caption.

## Architecture

Node.js (LTS) with **Playwright** (Chromium), organised as three independent stages.

### 1. `scrape` — collect the raw posts

- Launch with a **persistent browser profile** (`launchPersistentContext('./.browser-profile')`). The user logs in by hand the first time, and the session is reused after that. Never store credentials.
- Get data from the network, not the DOM. Listen to `page.on('response')` and capture the JSON responses the profile grid makes while scrolling. These contain the shortcode, full caption, `taken_at` timestamp and media type. **Before writing parsing code, open the profile in the persistent browser and inspect the Network tab** to find out which endpoint and response shape the grid currently uses, because Instagram changes them often. Keep the response-to-record mapping in one small adapter module.
- Use DOM scraping (anchor `href` plus `img alt`) as a fallback if the network capture breaks.
- Scroll slowly and with some randomness, for example 800px every 5–9 seconds.
- **Handling 429s:** watch response status codes. On a 429, stop scrolling and back off exponentially (starting at about 2 minutes, doubling, capped at about 30 minutes). After several consecutive failures, save state and exit cleanly so the run can be resumed later.

### 2. `parse` — turn captions into structured fields

- Split each caption into hashtags and strip the boilerplate tags.
- Find the format marker. The tags before it are the artist(s) and title; the tags after it are track names. Find the label from the `*records` / `*recordings` tag.
- Re-space and capitalise names. A good approach is a dictionary of known artists and labels, built first from `seed_records.json` (for example `stevebicknell` → `Steve Bicknell`), with a word-segmentation library as the fallback for unknown tags.
- Set `needs_check: true` on any record where the parse is uncertain.
- Seed records always take priority over parsed values.

### 3. `export` — write the spreadsheet

- Write `output/records.xlsx` (with `exceljs`) and `output/records.csv`.
- Columns: #, Artist, Title, Label, Format, Date, Instagram post (hyperlink), Discogs (hyperlink), Needs check, Notes. Highlight rows that need checking, freeze the header row and turn on filters.
- The Instagram post cell must display the full URL (`https://www.instagram.com/p/{shortcode}/`), not a label like "Open post", and every row must have it, including rows with a blank artist or title. That way the user can open the post and fill in missing data by hand, and the link survives in the CSV, which can't hold hyperlinks.
- Needs check is `Yes` whenever the record is flagged `needs_check` or its artist, title or label is blank, so filtering on it lists every row that needs manual work.
- Discogs search URL: `https://www.discogs.com/search/?q={artist}+{title}&type=all`. For "Various" releases, search with `{title} {label}` instead.
- Optional later stage: resolve exact Discogs release pages through the official Discogs API (needs a token, and is rate-limited to 60 requests per minute), with its own cache.

## Configuration (`config.json`)

All stages read `config.json` rather than hard-coding the account:

- `account` / `profileUrl`: the Instagram account to catalogue.
- `start.afterShortcode`: the last post already catalogued. New collection starts at the post after it. This is the real anchor, because post numbers shift whenever the account posts something new.
- `start.postNumber`: the 1-based position (newest first) where scraping should start. Currently 724, the post after row 723 of `data/guestsixonetwo_records.xlsx`. Use it only as a sanity check: when the scraper reaches `afterShortcode`, log its actual position and warn if that differs from `postNumber - 1`. The difference is the number of new posts made since the last session.
- `start.recaptureBeforeStart`: Instagram can't jump straight to post N, so the scraper always pages through the earlier posts anyway. When this is `true`, it also records their captions and dates in `posts.jsonl`, without overwriting any hand-parsed seed fields.
- `scroll`, `backoff` and `browserProfileDir`: the pacing and 429-handling values described above.
- `state.json` always takes precedence over `start` once it has a `lastCursor`. `start` only matters on a fresh run.

## Resume design (required)

The run *will* be interrupted, by rate limits, crashes, sleep or Ctrl-C. Every stage must be safe to restart.

- **`data/posts.jsonl`**: append-only, with one raw post per line (shortcode, caption, taken_at, media type, owner, and captured_at). Flush it after every batch. On startup, load all the shortcodes from it into a `Set` and skip any post that's already there.
- **`data/state.json`**: written atomically (write to a temp file, then rename). Holds:
  ```json
  {
    "account": "guestsixonetwo",
    "collected": 0,
    "oldestShortcode": null,
    "lastCursor": null,
    "consecutiveFailures": 0,
    "reachedEnd": false,
    "updatedAt": null
  }
  ```
- **Resuming:** if a paging cursor was captured from the network responses (Instagram's feed uses a `max_id` / `end_cursor`-style value), resume from `lastCursor` rather than re-scrolling through posts already collected. Re-scrolling is the fallback. With a persistent session it costs a few dozen requests, and posts already seen are skipped.
- Handle SIGINT and SIGTERM by flushing state before exiting.
- Treat the run as finished (`reachedEnd: true`) when the response reports no more pages, or when the collected count matches the post count shown on the profile.
- Import `seed_records.json` into the dataset once, so it counts as already collected. The scraper should still re-fetch those posts to get their full captions and dates, but must never overwrite the hand-parsed fields.

## Topping up with new posts

The full scrape finished on 2026-09-26: 2,429 posts, with `reachedEnd: true`. From then on, `pnpm scrape` runs in **top-up mode**. It pages from the newest post and stops at the first page that contains no new posts, which normally takes 2 requests.

- **The pinned (sticky) post** always comes first in the feed, whatever its date. Because it's already in the seen-set, it never counts as new and doesn't affect the stop rule. If a new post is pinned, it's simply collected as new.
- **`posts.jsonl` is not in chronological order.** Top-up posts are appended to the end, and the pinned post sits wherever it was first captured. The parse and export stages must therefore **sort by `taken_at` (newest first)** and never rely on file order or feed position. The `pinned` field is only a snapshot from capture time.
- A top-up leaves `position` and `lastCursor` unchanged.
- **To force a full rescan**, for example to pick up edited captions, delete `data/state.json`. Posts already saved are still skipped, so this only fills in gaps.

## Suggested layout

```
package.json        scripts: scrape, parse, export, status
config.json         account, start point, pacing
src/scrape.js
src/adapter.js      network response -> raw post (the only Instagram-specific parsing)
src/parse.js
src/export.js
src/state.js        load/save state, jsonl append, seen-set
src/status.js       prints collected / estimated total / oldest post / last run
data/seed_records.json
data/posts.jsonl    (generated)
data/state.json     (generated)
output/             (generated)
```

Add `.browser-profile/`, `data/posts.jsonl`, `data/state.json` and `output/` to `.gitignore`.

## Notes and constraints

- Automated collection is against Instagram's terms and can get an account temporarily restricted. This project is for personal cataloguing of a public account, so keep the request rate low, and consider using a secondary Instagram account for the logged-in session.
- Don't do image or audio downloads. They aren't needed.
- Test the parser against `seed_records.json`: parsing each seed record's caption (once its caption has been scraped) should reproduce the hand-parsed artist and title in most cases. Report the match rate.
