import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

const STATE_PATH = path.join(DATA_DIR, 'state.json');
const POSTS_PATH = path.join(DATA_DIR, 'posts.jsonl');
const SEED_PATH = path.join(DATA_DIR, 'seed_records.json');

export function loadState(account) {
  if (existsSync(STATE_PATH)) return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  return {
    account,
    collected: 0,
    oldestShortcode: null,
    lastCursor: null,
    consecutiveFailures: 0,
    reachedEnd: false,
    updatedAt: null,
  };
}

// Write to a temp file then rename, so a crash never leaves a half-written state.json.
export function saveState(state) {
  state.updatedAt = new Date().toISOString();
  const tmp = `${STATE_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, STATE_PATH);
}

// Reads posts.jsonl, skipping a truncated last line left by a crash mid-append.
export function loadPosts() {
  if (!existsSync(POSTS_PATH)) return [];
  const posts = [];
  for (const line of readFileSync(POSTS_PATH, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      posts.push(JSON.parse(line));
    } catch {
      console.warn('Skipping unreadable line in posts.jsonl');
    }
  }
  return posts;
}

export function loadSeen() {
  return new Set(loadPosts().map((p) => p.shortcode));
}

export function appendPosts(posts) {
  if (!posts.length) return;
  appendFileSync(POSTS_PATH, posts.map((p) => JSON.stringify(p)).join('\n') + '\n');
}

export function loadSeed() {
  return JSON.parse(readFileSync(SEED_PATH, 'utf8'));
}
