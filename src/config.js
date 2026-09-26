import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const OUTPUT_DIR = path.join(ROOT, 'output');

export function loadConfig() {
  const config = JSON.parse(readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  config.browserProfileDir = path.resolve(ROOT, config.browserProfileDir);
  return config;
}
