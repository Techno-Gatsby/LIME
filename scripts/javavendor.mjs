// The Java app Lime bundles, ProjectLibre (project schedules), and a trimmed Java runtime of its own archive, so any
// later Java app shares it. Everything is version-pinned and SHA-256 checked, fetched here at build time only, and written as
// vendor/apps/<target>/{java,projectlibre}.tar.br with their manifest entries; Lime unpacks them on first use.
//
// The runtime is jlink'd from Eclipse Temurin's JDK for the target. jlink must be the same build as the target's jmods,
// so a build for another platform also fetches the Temurin JDK for the build machine and runs its jlink.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const TEMURIN = 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.9%2B10';
export const JDK = {
  version: '21.0.9+10',
  'linux-x64': ['OpenJDK21U-jdk_x64_linux_hotspot_21.0.9_10.tar.gz', '810d3773df7e0d6c4394e4e244b264c8b30e0b05a0acf542d065fd78a6b65c2f'],
  'darwin-arm64': ['OpenJDK21U-jdk_aarch64_mac_hotspot_21.0.9_10.tar.gz', '55a40abeb0e174fdc70f769b34b50b70c3967e0b12a643e6a3e23f9a582aac16'],
  'win32-x64': ['OpenJDK21U-jdk_x64_windows_hotspot_21.0.9_10.zip', '1c67df516e9795c0b09f5714bfe151da2e3cc988082042f5bbb60d75e4e63fb5'],
};
// What ProjectLibre uses (jdeps over its jars, plus what Groovy, JAXB and the MPP reader load by reflection).
const MODULES = ['java.base', 'java.desktop', 'java.datatransfer', 'java.logging', 'java.prefs', 'java.sql', 'java.xml', 'java.naming', 'java.scripting', 'java.management', 'java.compiler', 'java.instrument', 'jdk.unsupported', 'jdk.charsets', 'jdk.localedata'];
const LOCALES = 'en,ar,de,es,fr,hi,it,pt,ru,zh,ja,ko,nl,tr,ur';
export const PROJECTLIBRE = { version: '1.9.8', url: 'https://downloads.sourceforge.net/project/projectlibre/ProjectLibre/1.9.8/projectlibre-1.9.8.tar.gz', sha: '7ae4fd810e9e2c7f10f943a0906586851adda8e8b095918d87919148cdcfc8fa' };

const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
const sh = (c, a, o = {}) => execFileSync(c, a, { stdio: ['ignore', 'ignore', 'inherit'], maxBuffer: 1 << 30, ...o });
const mk = (d) => (fs.mkdirSync(d, { recursive: true }), d);
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
const sha256 = (f) => new Promise((ok, no) => { const h = crypto.createHash('sha256'); fs.createReadStream(f).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', no); });
async function pinned(url, sha, cache, name = decodeURIComponent(path.basename(new URL(url).pathname))) {
  const f = path.join(mk(cache), name);
  if (!fs.existsSync(f) || fs.statSync(f).size === 0) {
    for (let i = 1; ; i++) {
      console.log('↓', url);
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(900000) });
        if (!r.ok) throw new Error(`${r.status} ${url}`);
        const { pipeline } = await import('node:stream/promises'), { Readable } = await import('node:stream');
        await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(`${f}.part`));
        fs.renameSync(`${f}.part`, f);
        break;
      } catch (e) { if (i === 3) throw e; console.warn(`retrying ${url}: ${e.message}`); }
    }
  }
  const got = await sha256(f);
  if (got !== sha) { fs.rmSync(f, { force: true }); throw new Error(`${name}: SHA-256 ${got} isn't the pinned ${sha}`); }
  return f;
}
const brTar = (dir, names, dest) => {
  const tar = `${dest}.tar`;
  sh(TAR, ['-cf', tar, '-C', dir, ...names]);
  const buf = fs.readFileSync(tar);
  fs.writeFileSync(dest, zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_LGWIN]: 24, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }));
  fs.rmSync(tar, { force: true });
  return fs.statSync(dest).size;
};
const readManifest = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };

// Unpacks a Temurin JDK archive (or just its jmods) into dir and returns its home folder.
function unpackJdk(archive, dir, onlyJmods) {
  mk(dir);
  if (archive.endsWith('.zip')) {
    const { unzipSync } = require('fflate');
    const files = unzipSync(fs.readFileSync(archive), { filter: (f) => !f.name.endsWith('/') && (!onlyJmods || /\/jmods\//.test(f.name)) });
    for (const [name, data] of Object.entries(files)) { const out = path.join(dir, ...name.split('/')); mk(path.dirname(out)); fs.writeFileSync(out, data, { mode: /\/bin\//.test(name) ? 0o755 : 0o644 }); }
  } else sh(TAR, ['-xzf', archive, '-C', dir, ...(onlyJmods ? ['--wildcards', '*/jmods/*'] : [])]);
  const top = path.join(dir, fs.readdirSync(dir)[0]);
  return fs.existsSync(path.join(top, 'Contents', 'Home')) ? path.join(top, 'Contents', 'Home') : top;
}

export async function buildJava(T, appsDir, cache) {
  const HOST = `${process.platform}-${process.arch}`;
  if (!JDK[T]) { console.warn(`! no pinned Java runtime for ${T}, so ProjectLibre is left out`); return {}; }
  if (!JDK[HOST]) throw new Error(`building the Java runtime needs a ${Object.keys(JDK).filter((k) => k !== 'version').join(', ')} build machine`);
  mk(appsDir);
  const mf = path.join(appsDir, 'manifest.json'), manifest = readManifest(mf), sizes = {};
  const save = () => fs.writeFileSync(mf, JSON.stringify(manifest));
  const work = path.join(cache, `java-${T}`);

  const javaDest = path.join(appsDir, 'java.tar.br');
  if (!fs.existsSync(javaDest) || manifest.java?.version !== JDK.version) {
    fs.rmSync(work, { recursive: true, force: true });
    const target = unpackJdk(await pinned(`${TEMURIN}/${JDK[T][0]}`, JDK[T][1], cache), path.join(work, 'target'), T !== HOST);
    const host = T === HOST ? target : unpackJdk(await pinned(`${TEMURIN}/${JDK[HOST][0]}`, JDK[HOST][1], cache), path.join(work, 'host'), false);
    const out = path.join(work, 'image');
    sh(path.join(host, 'bin', process.platform === 'win32' ? 'jlink.exe' : 'jlink'), ['--module-path', path.join(target, 'jmods'), '--add-modules', MODULES.join(','), `--include-locales=${LOCALES}`,
      '--strip-java-debug-attributes', '--no-header-files', '--no-man-pages', '--output', path.join(out, 'java')]);
    // A runtime that ships inside Lime is never updated on its own; its legal notices stay with it.
    fs.rmSync(path.join(out, 'java', 'lib', 'src.zip'), { force: true });
    sizes.java = brTar(out, ['java'], javaDest);
    manifest.java = { version: JDK.version, file: T.startsWith('win32') ? 'java/bin/javaw.exe' : 'java/bin/java' };
    save();
    console.log('☕', 'Java runtime', JDK.version, mb(sizes.java));
    fs.rmSync(work, { recursive: true, force: true });
  } else sizes.java = fs.statSync(javaDest).size;

  const plDest = path.join(appsDir, 'projectlibre.tar.br');
  if (!fs.existsSync(plDest) || manifest.projectlibre?.version !== PROJECTLIBRE.version) {
    const dir = mk(path.join(work, 'pl'));
    sh(TAR, ['-xzf', await pinned(PROJECTLIBRE.url, PROJECTLIBRE.sha, cache), '-C', dir]);
    const top = fs.readdirSync(dir)[0];
    fs.renameSync(path.join(dir, top), path.join(dir, 'projectlibre'));
    for (const f of ['projectlibre.sh', 'projectlibre.bat']) fs.rmSync(path.join(dir, 'projectlibre', f), { force: true });
    sizes.projectlibre = brTar(dir, ['projectlibre'], plDest);
    manifest.projectlibre = { version: PROJECTLIBRE.version, file: 'projectlibre/projectlibre.jar', java: true };
    save();
    console.log('▣', 'ProjectLibre', PROJECTLIBRE.version, mb(sizes.projectlibre));
    fs.rmSync(work, { recursive: true, force: true });
  } else sizes.projectlibre = fs.statSync(plDest).size;

  return sizes;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const T = process.argv[2] || `${process.platform}-${process.arch}`, V = process.env.LIME_VENDOR || path.join(import.meta.dirname, '..', 'vendor');
  console.log(await buildJava(T, path.join(V, 'apps', T), process.argv[3] || path.join(V, '.cache')));
}
