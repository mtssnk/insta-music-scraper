// Collects raw posts into data/posts.jsonl. Safe to stop (Ctrl-C) and re-run at any time.
//
// It loads the profile once and scrolls just far enough for the grid to make its own
// paging request, then replays that request with each next cursor at a slow, random pace.
import readline from 'node:readline/promises';
import { chromium } from 'playwright';
import {
  buildPagingBody,
  captureTemplate,
  isPagingRequest,
  isTimelineRequest,
  parseJson,
  parseMediaCount,
  parseTimeline,
} from './adapter.js';
import { loadConfig } from './config.js';
import { appendPosts, loadPosts, loadSeed, loadState, saveState } from './state.js';

const config = loadConfig();
const state = loadState(config.account);
const seen = new Set();
let collected = 0;
for (const post of loadPosts()) {
  if (!seen.has(post.shortcode)) collected++;
  seen.add(post.shortcode);
}
if (!config.start.recaptureBeforeStart) {
  for (const record of loadSeed()) seen.add(record.shortcode);
}

// Once the whole account has been collected, later runs only fetch newly posted records.
const topUp = state.reachedEnd;
state.consecutiveFailures = 0;
const run = { startedAt: new Date().toISOString(), pages: 0, newPosts: 0, stopReason: null };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const between = (min, max) => min + Math.random() * (max - min);
const minutes = (ms) => `${(ms / 60000).toFixed(1)} min`;

function finish(reason, exitCode = 0) {
  run.stopReason = reason;
  run.endedAt = new Date().toISOString();
  state.lastRun = run;
  saveState(state);
  console.log(`\nStopped: ${reason}. ${collected} posts in data/posts.jsonl.`);
  process.exitCode = exitCode;
}

// Returns the number of posts that were new.
function handlePage(page, { trackPosition }) {
  const fresh = [];
  for (const post of page.posts) {
    if (trackPosition) {
      state.position = (state.position ?? 0) + 1;
      if (post.shortcode === config.start.afterShortcode) checkAnchor();
    }
    if (seen.has(post.shortcode)) continue;
    seen.add(post.shortcode);
    fresh.push(post);
  }
  appendPosts(fresh);
  collected += fresh.length;
  run.pages++;
  run.newPosts += fresh.length;

  const oldest = page.posts.at(-1);
  if (!topUp && trackPosition && oldest) {
    state.oldestShortcode = oldest.shortcode;
    state.lastCursor = page.endCursor;
  }
  state.collected = collected;
  saveState(state);

  const date = oldest?.taken_at?.slice(0, 10) ?? '?';
  const total = state.totalPosts ? `/${state.totalPosts}` : '';
  console.log(
    `page ${run.pages} · reached post ${state.position ?? '?'}${total} (${date}) · +${fresh.length} new · ${collected} collected`,
  );
  return fresh.length;
}

function checkAnchor() {
  const expected = config.start.postNumber - 1;
  const drift = state.position - expected;
  console.log(
    drift === 0
      ? `✓ Reached ${config.start.afterShortcode} at post ${state.position}, as expected.`
      : `⚠ Reached ${config.start.afterShortcode} at post ${state.position}, expected ${expected}: ` +
          `${drift > 0 ? `${drift} new post(s) since the last session` : `${-drift} post(s) fewer, perhaps deleted`}.`,
  );
}

async function waitForEnter(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question(message);
  rl.close();
}

const context = await chromium.launchPersistentContext(config.browserProfileDir, {
  headless: false,
  executablePath: config.browserExecutable ?? undefined,
  viewport: { width: 1280, height: 900 },
});
const page = context.pages()[0] ?? (await context.newPage());

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  // Pages are saved as they arrive, so the state on disk is already consistent.
  finish(`interrupted (${signal})`, 130);
  await context.close().catch(() => {});
  process.exit(130);
}
process.on('SIGINT', () => shutdown('Ctrl-C'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

page.on('response', async (response) => {
  if (response.request().headers()['x-fb-friendly-name'] !== 'PolarisProfilePageContentQuery') return;
  const count = parseMediaCount(await response.text().catch(() => ''));
  if (count) state.totalPosts = count;
});

// 1. Load the profile and read the first page the grid fetches.
async function openProfile() {
  const first = page.waitForResponse((r) => isTimelineRequest(r.request()), { timeout: 30000 });
  await page.goto(config.profileUrl);
  return first;
}

let firstResponse = await openProfile().catch(() => null);
if (!firstResponse) {
  await waitForEnter('Posts didn’t load. Log in in the browser window if needed, then press Enter… ');
  firstResponse = await openProfile().catch(() => null);
}
if (!firstResponse) {
  console.error('Still no posts. Instagram may have changed its API: run `pnpm probe` and check src/adapter.js.');
  await context.close();
  process.exit(1);
}
const firstPage = parseTimeline(parseJson(await firstResponse.text()), config.account);
if (!firstPage) {
  console.error('The first page of posts was not in the expected format. Run `pnpm probe` and check src/adapter.js.');
  await context.close();
  process.exit(1);
}
console.log(
  topUp
    ? 'Whole account already collected; checking for new posts.'
    : state.lastCursor
      ? `Resuming after post ${state.position} (${state.oldestShortcode}).`
      : 'Starting from the newest post.',
);
if (state.totalPosts) console.log(`Profile shows ${state.totalPosts} posts.`);

// Remember where resuming would start, before handlePage moves it on.
const saved = topUp ? null : state.lastCursor ? { cursor: state.lastCursor, position: state.position } : null;
const fromTop = !saved;
if (fromTop) state.position = 0;

let newOnPage = handlePage(firstPage, { trackPosition: fromTop });
let topCursor = firstPage.endCursor;
let topPosition = state.position;

// 2. Scroll until the grid makes its own paging request, and keep a copy of it.
let template = null;
for (let attempt = 0; attempt < 10 && !template && firstPage.hasNextPage; attempt++) {
  const next = page.waitForResponse((r) => isPagingRequest(r.request()), { timeout: config.scroll.maxDelayMs });
  await page.mouse.wheel(0, config.scroll.stepPx);
  const response = await next.catch(() => null);
  if (!response) continue;
  template = await captureTemplate(response.request());
  const gridPage = response.ok() ? parseTimeline(parseJson(await response.text()), config.account) : null;
  if (gridPage && fromTop) {
    newOnPage = handlePage(gridPage, { trackPosition: true });
    topCursor = gridPage.hasNextPage ? gridPage.endCursor : null;
    topPosition = state.position;
  }
}

if (!firstPage.hasNextPage) {
  state.reachedEnd = true;
  finish('the account has only one page of posts');
} else if (!template) {
  finish('the grid never requested a second page. Run `pnpm probe` and check src/adapter.js', 1);
} else if (topUp && newOnPage === 0) {
  finish('no new posts');
} else {
  await crawl();
}
await context.close();

// 3. Replay the paging request, one page at a time, until the end.
async function crawl() {
  let cursor = saved ? saved.cursor : topCursor;
  if (saved) state.position = saved.position;
  let usingSavedCursor = Boolean(saved);

  while (cursor) {
    const breaks = config.breaks;
    if (breaks?.everyPages && run.pages > 0 && run.pages % breaks.everyPages === 0) {
      const pause = between(breaks.minMs, breaks.maxMs);
      console.log(`Taking a ${minutes(pause)} break…`);
      await sleep(pause);
    } else {
      await sleep(between(config.scroll.minDelayMs, config.scroll.maxDelayMs));
    }

    const result = await page
      .evaluate(
        async ({ url, headers, body }) => {
          const response = await fetch(url, { method: 'POST', headers, body, credentials: 'include' });
          return { status: response.status, text: await response.text() };
        },
        { url: template.url, headers: template.headers, body: buildPagingBody(template, cursor) },
      )
      .catch((error) => ({ status: 0, text: String(error) }));

    let pageData = null;
    if (result.status === 200) {
      try {
        pageData = parseTimeline(parseJson(result.text), config.account);
      } catch {
        // not JSON: treated as a failure below
      }
    }

    if (pageData) {
      state.consecutiveFailures = 0;
      usingSavedCursor = false;
      const fresh = handlePage(pageData, { trackPosition: true });
      if (!pageData.hasNextPage) {
        if (!topUp) state.reachedEnd = true;
        return finish(`reached the oldest post (${collected} collected; profile shows ${state.totalPosts ?? '?'})`);
      }
      if (topUp && fresh === 0) return finish('caught up with new posts');
      cursor = pageData.endCursor;
      continue;
    }

    if ([401, 403].includes(result.status) || /login_required|checkpoint_required/.test(result.text)) {
      return finish('Instagram wants you to log in again. Re-run and log in in the browser window', 1);
    }

    const rateLimited = result.status === 429 || /wait a few minutes/i.test(result.text);
    if (usingSavedCursor && !rateLimited) {
      console.log('The saved resume point was rejected; paging from the top instead (posts already saved are skipped).');
      usingSavedCursor = false;
      cursor = topCursor;
      state.position = topPosition;
      continue;
    }

    state.consecutiveFailures++;
    saveState(state);
    if (state.consecutiveFailures >= config.backoff.maxConsecutiveFailures) {
      return finish(`${state.consecutiveFailures} failures in a row (last: HTTP ${result.status}). Try again later`, 2);
    }
    const wait = Math.min(config.backoff.initialMs * 2 ** (state.consecutiveFailures - 1), config.backoff.maxMs);
    const why = rateLimited ? 'Rate-limited by Instagram' : `Request failed (HTTP ${result.status})`;
    console.log(`${why}; waiting ${minutes(wait)} before retrying (${state.consecutiveFailures}/${config.backoff.maxConsecutiveFailures})…`);
    await sleep(wait);
  }
}
