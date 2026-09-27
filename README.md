# guestsixonetwo record catalogue

A spreadsheet of every record posted by the Instagram crate-digger **[@guestsixonetwo](https://www.instagram.com/guestsixonetwo/)**, who posts one record per post: techno, electro, dub techno and house.

Each row gives you:

| Artist | Title | Label | Format | Date | Instagram post | Discogs | Needs check | Notes |
|---|---|---|---|---|---|---|---|---|
| Rubycon | Physical Plant | Mechanisms Industries | EP | … | link to the post | Discogs search | | |

The output is `output/records.xlsx`, which you can sort and filter, plus `output/records.csv`.

## How it works

The account's captions are almost all hashtags in a set order (`#artist #title #ep #tracks… #label #labelrecords …`). The tool works in three steps:

1. **Scrape.** A real Chromium browser opens the profile under your own login, scrolls slowly, and saves every post's caption and date to `data/posts.jsonl`.
2. **Parse.** Turns hashtags like `#stevebicknell` back into "Steve Bicknell", and picks out the artist, title, label and format.
3. **Export.** Writes the spreadsheet.

The first 723 posts were catalogued by hand ([data/seed_records.json](data/seed_records.json)). Those entries always win over anything the parser comes up with.

## Quick start

You need [Node.js](https://nodejs.org/) 20 or newer.

```sh
pnpm install
pnpm exec playwright install chromium   # only if not using Brave
```

Then:

```sh
pnpm scrape    # collect posts (opens a browser window)
pnpm parse     # turn captions into artist / title / label
pnpm export    # write output/records.xlsx and .csv
pnpm status    # how far along are we?
```

**On your first run**, a browser window opens on Instagram. Log in by hand. Your session is saved in `.browser-profile/`, so you only need to do this once. Your password is never stored by this project.

> **Current status:** `scrape` and `status` work. `parse` and `export` are still to come.

## Stopping and resuming

Stop it whenever you like with **Ctrl-C**, or let it stop itself. Instagram limits how fast you can scroll (the "429 Too Many Requests" error). When that happens the scraper waits, starting at 2 minutes and doubling each time up to 30. If it keeps failing, it saves its progress and exits.

Run `pnpm scrape` again later and it picks up where it left off. Posts it has already saved are never fetched twice.

## Adding new posts

Once everything has been collected, just run `pnpm scrape` again whenever you like. It checks the newest posts, saves any it hasn't seen, and stops as soon as it reaches posts it already has. That's usually a couple of requests and well under a minute. The pinned post at the top of the profile is recognised and ignored.

## Configuration

Edit [config.json](config.json):

| Setting | What it does |
|---|---|
| `account`, `profileUrl` | The account to catalogue |
| `start.afterShortcode` | The last post already catalogued. Collection starts at the next one |
| `start.postNumber` | The same point as a post number (newest = 1), used to check nothing has shifted |
| `start.recaptureBeforeStart` | Also save captions and dates for the posts already catalogued, without changing their hand-entered details |
| `scroll` | Scroll distance and the random pause between scrolls |
| `breaks` | A longer pause every so many pages, to keep the request rate human |
| `backoff` | How long to wait after being rate-limited, and when to give up |
| `browserExecutable` | Which browser to use (currently Brave). Set it to `null` to use Playwright's bundled Chrome for Testing |

## Fixing rows by hand

Some rows will be incomplete: posts with no caption, ambiguous hashtags, or collabs from other accounts. In the spreadsheet, filter **Needs check** to `Yes` and click each row's Instagram link to see the post.

## Where things live

```
config.json              settings
data/seed_records.json   the 723 hand-catalogued records (don't edit)
data/posts.jsonl         raw scraped posts, one per line (generated)
data/state.json          resume point (generated)
output/                  the spreadsheet (generated)
.browser-profile/        your logged-in browser session (never commit this)
```

## A word of caution

Automated browsing is against Instagram's terms and can get an account temporarily restricted. This project is for personal cataloguing of a public account, so it deliberately goes slowly. Consider logging in with a secondary Instagram account. The tool never downloads images or audio.
