// One-off discovery run: opens the profile in the persistent browser, scrolls a few
// times and saves every JSON response, so we can see which endpoint the grid uses
// before writing src/adapter.js.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { chromium } from 'playwright';
import { DATA_DIR, loadConfig } from './config.js';

const SCROLLS = 4;
const config = loadConfig();
const probeDir = path.join(DATA_DIR, 'probe');
mkdirSync(probeDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomDelay = () =>
  config.scroll.minDelayMs + Math.random() * (config.scroll.maxDelayMs - config.scroll.minDelayMs);

const context = await chromium.launchPersistentContext(config.browserProfileDir, {
  headless: false,
  executablePath: config.browserExecutable ?? undefined,
  viewport: { width: 1280, height: 900 },
});
const page = context.pages()[0] ?? (await context.newPage());

await page.goto(config.profileUrl);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await rl.question('Log in in the browser window if needed, then press Enter here to start the probe… ');
rl.close();

let count = 0;
const index = [];
page.on('response', async (response) => {
  const url = response.url();
  if (!/instagram\.com/.test(url)) return;
  const type = response.headers()['content-type'] ?? '';
  if (!/json|javascript|text\/html/.test(type) || !/graphql|\/api\//.test(url)) return;

  let body;
  try {
    body = await response.text();
  } catch {
    return; // body unavailable (e.g. redirect)
  }
  const request = response.request();
  const file = `${String(++count).padStart(3, '0')}.json`;
  const entry = {
    file,
    status: response.status(),
    method: request.method(),
    url,
    friendlyName: request.headers()['x-fb-friendly-name'] ?? null,
    bytes: body.length,
  };
  index.push(entry);
  writeFileSync(
    path.join(probeDir, file),
    JSON.stringify({ ...entry, postData: request.postData(), body }, null, 2),
  );
  console.log(`${entry.status} ${entry.method} ${entry.friendlyName ?? ''} ${url.slice(0, 120)}`);
});

await page.goto(config.profileUrl);
await sleep(randomDelay());
for (let i = 0; i < SCROLLS; i++) {
  await page.mouse.wheel(0, config.scroll.stepPx);
  console.log(`— scroll ${i + 1}/${SCROLLS}`);
  await sleep(randomDelay());
}

writeFileSync(path.join(probeDir, 'index.json'), JSON.stringify(index, null, 2));
console.log(`\nSaved ${count} responses to data/probe/`);
await context.close();
