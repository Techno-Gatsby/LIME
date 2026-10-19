import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import electron from 'electron';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lime-test-'));
const fx = process.env.LIME_FX || path.join(dir, 'fx');
if (!process.env.LIME_FX) spawnSync(process.execPath, [path.join(import.meta.dirname, 'fixtures.mjs'), fx], { stdio: 'inherit' });
const r = spawnSync(electron, ['.', `--user-data-dir=${path.join(dir, 'user')}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { stdio: 'inherit', env: { ...process.env, LIME_TEST: dir, LIME_FX: fx } });
console.log('results in', dir);
process.exit(r.status ?? 1);
