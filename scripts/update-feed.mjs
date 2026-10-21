// Writes dist/lime-update-<platform>-<arch>.json next to an installer, for Lime's update check (src/main/updater.js).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { OUT, pkg } from './pack.mjs';

const [file, target] = process.argv.slice(2);
if (!file || !/^(darwin|win32|linux)-(x64|arm64)$/.test(target || '')) throw new Error('usage: node scripts/update-feed.mjs <installer> <platform-arch>');
const h = crypto.createHash('sha256');
await pipeline(fs.createReadStream(file), h);
const feed = { version: pkg.version, file: path.basename(file), size: fs.statSync(file).size, sha256: h.digest('hex'), date: new Date().toISOString() };
const out = path.join(OUT, `lime-update-${target}.json`);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(feed, null, 1)}\n`);
console.log('✓', path.basename(out), feed.sha256);
