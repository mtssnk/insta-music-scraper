import { loadConfig } from './config.js';
import { loadPosts, loadSeed, loadState } from './state.js';

const config = loadConfig();
const state = loadState(config.account);
const posts = loadPosts();
const seedCodes = new Set(loadSeed().map((r) => r.shortcode));

const total = state.totalPosts;
const oldest = posts.at(-1);
const percent = total ? ` (${Math.round((posts.length / total) * 100)}%)` : '';

console.log(`Account:        @${state.account}`);
console.log(`Collected:      ${posts.length}${total ? ` of ${total}` : ''}${percent}`);
console.log(`  seed records: ${posts.filter((p) => seedCodes.has(p.shortcode)).length} of ${seedCodes.size} recaptured`);
console.log(`  other accts:  ${posts.filter((p) => p.other_account).length}`);
console.log(`  no caption:   ${posts.filter((p) => !p.caption).length}`);
console.log(`Oldest so far:  ${oldest ? `${oldest.shortcode} (${oldest.taken_at?.slice(0, 10)}), post ${state.position ?? '?'}` : '-'}`);
console.log(`Finished:       ${state.reachedEnd ? 'yes' : 'no'}`);
if (state.lastRun) {
  const r = state.lastRun;
  console.log(`Last run:       ${r.startedAt.replace('T', ' ').slice(0, 16)}, ${r.pages} pages, +${r.newPosts} new`);
  console.log(`  stopped:      ${r.stopReason}`);
}
