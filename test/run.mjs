import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import electron from 'electron';

const ROOT = path.resolve(import.meta.dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lime-test-'));
const fx = process.env.LIME_FX || path.join(dir, 'fx');
if (!process.env.LIME_FX) spawnSync(process.execPath, [path.join(import.meta.dirname, 'fixtures.mjs'), fx], { stdio: 'inherit', cwd: ROOT });
let app = ROOT;
if (process.argv[2]) {
  app = path.join(dir, 'app');
  fs.cpSync(path.resolve(process.argv[2]), app, { recursive: true, verbatimSymlinks: true });
  fs.cpSync(path.join(ROOT, 'test'), path.join(app, 'test'), { recursive: true });
  fs.symlinkSync(path.join(ROOT, 'vendor'), path.join(app, 'vendor'), 'junction');
}
const r = spawnSync(electron, [app, `--user-data-dir=${path.join(dir, 'user')}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { stdio: 'inherit', env: { ...process.env, LIME_TEST: dir, LIME_FX: fx } });
console.log('results in', dir);
process.exit(r.status ?? 1);
