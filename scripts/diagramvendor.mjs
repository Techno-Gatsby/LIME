// Builds the platform-independent payloads that ship inside Lime and unpack on first use, with no download at run time:
// vendor/diagrams (a trimmed draw.io) and vendor/translate (the Bergamot translator and its language models).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const DRAWIO = { tag: 'v32.5.5', commit: '17b367b91dbab91804f852645788d7ffb46dcb79' };
const BERGAMOT = { version: '0.4.9', url: 'https://registry.npmjs.org/@browsermt/bergamot-translator/-/bergamot-translator-0.4.9.tgz', sha512: 'bNuuCwM/JnsIYQCKXcYKFT4Qc5vLMoB8Nbvz8ReIgs7xzebK8Sa+R8iEK8mLvNBe/WaZ6zrPaUQilLsRT/ea8Q==' };
// Mozilla's Firefox Translations models (MPL-2.0): the small "tiny" students for German, French, Spanish and Hindi,
// and the "base-memory" students for Arabic, the smallest there are. Files ending .gz are hashed before unpacking.
const SANDBOX = 'bergamot-models-sandbox/0.3.4', PROD = 'moz-fx-translations-data--303e-prod-translations-data/models';
export const MODELS = {
  ende: [[`${SANDBOX}/ende/model.ende.intgemm.alphas.bin`, 'b3e980d6602ab0bdfe8d9315cb5fc282a16bb1c8dccf38e70945c584551c4318'], [`${SANDBOX}/ende/lex.50.50.ende.s2t.bin`, 'f03eb8245042feb7a5800815b8d0dc215d7a60691632405b65c461d250cedbe6'], [`${SANDBOX}/ende/vocab.deen.spm`, '417668f2ed297970febafb5b079a9d5ebc4ed0b3550ac8386d67a90473a09bd7']],
  deen: [[`${SANDBOX}/deen/model.deen.intgemm.alphas.bin`, '1980225d00dc5645491777accff5b3c9d20b92eff67a25135f1cf8fe2ed8fb8f'], [`${SANDBOX}/deen/lex.50.50.deen.s2t.bin`, '2f7c0f7bbce97ae5b52454074a892ba7b7610fb98e3c5d341e4ca79f0850c4de'], [`${SANDBOX}/deen/vocab.deen.spm`, '417668f2ed297970febafb5b079a9d5ebc4ed0b3550ac8386d67a90473a09bd7']],
  enfr: [[`${SANDBOX}/enfr/model.enfr.intgemm.alphas.bin`, '0678019c4d74c8c81d2de17e3e58d3aba5f5eb48f5595d9240c17f69d30461de'], [`${SANDBOX}/enfr/lex.50.50.enfr.s2t.bin`, '38fb44bad1fd5f1e6bfdcf15cc8baa09d61aad2a4f9c587914e24e7b5c25c32c'], [`${SANDBOX}/enfr/vocab.fren.spm`, '4c84b95b62c930f0791466d73eb996841eef474c96d0c2f0e6c6d80640f2005a']],
  fren: [[`${SANDBOX}/fren/model.fren.intgemm.alphas.bin`, '185f76d24c2d400fe4ea0cb2487df77722641b97a3ef10633872e8a7fdf40e09'], [`${SANDBOX}/fren/lex.50.50.fren.s2t.bin`, '3148abf21ea98a4d69d0e4504e0d68a6c060204a9b9a39b76855aee1d5b2c8ea'], [`${SANDBOX}/fren/vocab.fren.spm`, '4c84b95b62c930f0791466d73eb996841eef474c96d0c2f0e6c6d80640f2005a']],
  enes: [[`${SANDBOX}/enes/model.enes.intgemm.alphas.bin`, 'fa7460037a3163e03fe1d23602f964bff2331da6ee813637e092ddf37156ef53'], [`${SANDBOX}/enes/lex.50.50.enes.s2t.bin`, '3a113d713dec3cf1d12bba5b138ae616e28bba4bbc7fe7fd39ba145e26b86d7f'], [`${SANDBOX}/enes/vocab.esen.spm`, '909b1eea1face0d7f90a474fe29a8c0fef8d104b6e41e65616f864c964ba8845']],
  esen: [[`${SANDBOX}/esen/model.esen.intgemm.alphas.bin`, '4b6b7f451094aaa447d012658af158ffc708fc8842dde2f871a58404f5457fe0'], [`${SANDBOX}/esen/lex.50.50.esen.s2t.bin`, 'f11a2c23ef85ab1fee1c412b908d69bc20d66fd59faa8f7da5a5f0347eddf969'], [`${SANDBOX}/esen/vocab.esen.spm`, '909b1eea1face0d7f90a474fe29a8c0fef8d104b6e41e65616f864c964ba8845']],
  enhi: [[`${PROD}/en-hi/h1-2025_KoJuCNf_Q42R2Bz6j2jlOQ/exported/lex.50.50.enhi.s2t.bin.gz`, 'ce5f1dd9d4fb343cb6e0da91e4603e50b673b91ea22b50b959a0dc199d4e9dd9'], [`${PROD}/en-hi/h1-2025_KoJuCNf_Q42R2Bz6j2jlOQ/exported/model.enhi.intgemm.alphas.bin.gz`, '751032330fe04b9dd4e1245c4dcf8f58dd6836daa7ed3f3b93be52eb1fca9ba4'], [`${PROD}/en-hi/h1-2025_KoJuCNf_Q42R2Bz6j2jlOQ/exported/vocab.enhi.spm.gz`, 'bb3bf8252b14fa57100beb371824cf51a7281e833a3becec135721fe679ce076']],
  hien: [[`${PROD}/hi-en/h1-2025_IcUQD-GbSJWB6WV08oDoEw/exported/lex.50.50.hien.s2t.bin.gz`, '9647fd7a38db4bafa549f73bf34cabd5a415cd34f3acd7212fced93f163dbd49'], [`${PROD}/hi-en/h1-2025_IcUQD-GbSJWB6WV08oDoEw/exported/model.hien.intgemm.alphas.bin.gz`, 'd30d257188bec64fceeb37483a6be8c54f1246583ad4e4f99dda174b630afeb3'], [`${PROD}/hi-en/h1-2025_IcUQD-GbSJWB6WV08oDoEw/exported/vocab.hien.spm.gz`, '7554161ff543abf09200b4feec83328259b0acb0e58003d834ad43bac47f6124']],
  enar: [[`${PROD}/en-ar/retrain_base-memory_G3CmhwG_TZext3cys-udHg/exported/lex.50.50.enar.s2t.bin.gz`, 'b7466406d7f5e0c493bc65dc7de221aa3e6cd7f95c6fc7dd1e73759520c937ac'], [`${PROD}/en-ar/retrain_base-memory_G3CmhwG_TZext3cys-udHg/exported/model.enar.intgemm.alphas.bin.gz`, '88e85e33403cda6b1a529f32dc30c0977a4234285d6f8340e0d630da21b176e5'], [`${PROD}/en-ar/retrain_base-memory_G3CmhwG_TZext3cys-udHg/exported/vocab.enar.spm.gz`, '3a4b9e81c0f73ef8ed02c254b3ae99d64f8265afa54a6b838a0870bb4f9d0369']],
  aren: [[`${PROD}/ar-en/retrain_base-memory_X9fDxFreTOCslPKzb1CXTg/exported/lex.50.50.aren.s2t.bin.gz`, '59335a02934f19f5e9bf171de9db8b73b5e95a69dce03a7d2fe6e9e43e3f849e'], [`${PROD}/ar-en/retrain_base-memory_X9fDxFreTOCslPKzb1CXTg/exported/model.aren.intgemm.alphas.bin.gz`, '31e032a402a8463a1e19c8e355529f73c0732926b22b1eadc8bade39ecc23a80'], [`${PROD}/ar-en/retrain_base-memory_X9fDxFreTOCslPKzb1CXTg/exported/vocab.aren.spm.gz`, 'c379c52857c2f0886ae52a255ac770e5992524782ee20bb0966deca079e9595f']],
};
export const MODEL_VERSION = '2025.1';

const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
const sh = (c, a, o = {}) => execFileSync(c, a, { stdio: ['ignore', 'ignore', 'inherit'], ...o });
const mk = (d) => (fs.mkdirSync(d, { recursive: true }), d);
const sha = (buf, alg = 'sha256', enc = 'hex') => crypto.createHash(alg).update(buf).digest(enc);
async function fetchBuf(url) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(600000) });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) { if (i === 3) throw e; console.warn(`retrying ${url}: ${e.message}`); }
  }
}
function pack(dir, name, dest, q) {
  const tar = `${dest}.tar`;
  sh(TAR, ['-cf', tar, '-C', dir, name]);
  const buf = fs.readFileSync(tar);
  fs.writeFileSync(dest, zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: q, [zlib.constants.BROTLI_PARAM_LGWIN]: 24, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }));
  fs.rmSync(tar, { force: true });
  return fs.statSync(dest).size;
}
const manifest = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch (_) { return {}; } };
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

// Everything the editor and the export tool use; the Confluence, viewer, PlantUML and collaboration bundles, the
// brand-name stencil libraries (cloud vendors, logos, signs), templates, MathJax and other languages are left out.
const DRAWIO_SKIP = /^(js\/(diagramly|grapheditor|onedrive|integrate\.min|viewer|viewer-static\.min|plantuml|mermaid|elk|gliffy|simplepeer|orgchart|embed\.dev)|mxgraph\/src|img\/(lib|people|networking|computers|clipart|telecommunication|finance|google-app)|templates|math4|WEB-INF|META-INF|connect|shapes|images\/sidebar-|resources\/dia_|service-worker|workbox-|teams\.html|onedrive3\.html|open\.html|vsdxImporter\.html|clear\.html)|\.map$|\.md$/;
const STENCIL_SKIP = /^(alibaba|android|atlassian|aws|azure|bootstrap|cisco|citrix|cumulus|dfd|gcp|gmdl|ibm|ios|kubernetes|mscae|office|openstack|salesforce|sap|signs|veeam|vvd|webicons|weblogos|allied|arista|fortinet|juniper|mikrotik|networks2|threat|azure2|ios7|fluid_power|rack\/(?!general))/;
const LIME_JS = `// Lime: keeps a handle on the editor so the window around it can load, save and export.
var limeAllLoaded = checkAllLoaded;
checkAllLoaded = function () {
  if (mxScriptsLoaded && mxWinLoaded && !window.limeHooked) {
    window.limeHooked = true;
    var main = App.main;
    App.main = function (a, d) { return main.call(this, function (ui) { window.limeUi = ui; if (a) a(ui); }, d); };
  }
  limeAllLoaded();
};
`;
const LIME_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>draw.io</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<link rel="stylesheet" type="text/css" href="styles/grapheditor.css">
<script src="js/bootstrap.js"></script><script src="js/lime.js"></script>
</head><body class="geEditor geClassic"><div id="geInfo"><div id="geStatus"></div></div><script src="js/main.js"></script></body></html>
`;
export async function buildDrawio(out, cache) {
  const dest = path.join(mk(out), 'drawio.tar.br'), m = manifest(out);
  if (fs.existsSync(dest) && m.drawio?.version === DRAWIO.tag) return fs.statSync(dest).size;
  const src = path.join(mk(cache), 'drawio-src'), web = path.join(src, 'src', 'main', 'webapp');
  if (!fs.existsSync(path.join(src, '.git'))) sh('git', ['clone', '--depth', '1', '--branch', DRAWIO.tag, '--filter=blob:none', '--no-checkout', 'https://github.com/jgraph/drawio.git', src]);
  const head = execFileSync('git', ['-C', src, 'rev-parse', 'HEAD']).toString().trim();
  if (head !== DRAWIO.commit) throw new Error(`draw.io ${DRAWIO.tag} is ${head}, expected ${DRAWIO.commit}`);
  const files = execFileSync('git', ['-C', src, 'ls-tree', '-r', '--name-only', 'HEAD', 'src/main/webapp'], { maxBuffer: 64 << 20 }).toString().split('\n').filter(Boolean).map((f) => f.slice('src/main/webapp/'.length)).filter((f) => !DRAWIO_SKIP.test(f));
  sh('git', ['-C', src, 'sparse-checkout', 'set', '--no-cone', ...files.map((f) => `/src/main/webapp/${f}`)]);
  sh('git', ['-C', src, 'checkout']);
  const tmp = path.join(cache, 'drawio-site'), site = path.join(tmp, 'drawio');
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const f of files) { mk(path.dirname(path.join(site, f))); fs.copyFileSync(path.join(web, f), path.join(site, f)); }
  const st = path.join(site, 'js', 'stencils.min.js');
  fs.writeFileSync(st, fs.readFileSync(st, 'utf8').replace(/^f\['([^']+)'\] = '[^']*';\n/gm, (all, name) => (STENCIL_SKIP.test(name) ? '' : all)));
  fs.writeFileSync(path.join(site, 'js', 'lime.js'), LIME_JS);
  fs.writeFileSync(path.join(site, 'lime.html'), LIME_HTML);
  const size = pack(tmp, 'drawio', dest, 9);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ ...manifest(out), drawio: { version: DRAWIO.tag, file: 'drawio/lime.html' } }));
  console.log('◇', 'draw.io', DRAWIO.tag, mb(size));
  return size;
}

export async function buildTranslate(out, cache, { pairs = Object.keys(MODELS), keep = false } = {}) {
  mk(out);
  const sizes = {};
  const engine = path.join(out, 'bergamot.tar.br');
  if (!fs.existsSync(engine) || manifest(out).bergamot?.version !== BERGAMOT.version) {
    const tgz = await fetchBuf(BERGAMOT.url);
    if (sha(tgz, 'sha512', 'base64') !== BERGAMOT.sha512) throw new Error('the Bergamot package does not match its pinned hash');
    const tmp = mk(path.join(cache, 'bergamot')), f = path.join(tmp, 'b.tgz'), dir = mk(path.join(tmp, 'bergamot'));
    fs.writeFileSync(f, tgz);
    sh(TAR, ['-xzf', f, '-C', dir, '--strip-components=2', 'package/worker']);
    fs.rmSync(f);
    sizes.bergamot = pack(tmp, 'bergamot', engine, 9);
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ ...manifest(out), bergamot: { version: BERGAMOT.version, file: 'bergamot/translator-worker.js' } }));
  } else sizes.bergamot = fs.statSync(engine).size;
  for (const p of pairs) {
    const dest = path.join(out, `${p}.tar.br`);
    if (fs.existsSync(dest) && manifest(out)[p]?.version === MODEL_VERSION) { sizes[p] = fs.statSync(dest).size; continue; }
    const tmp = mk(path.join(cache, `model-${p}`)), dir = mk(path.join(tmp, p));
    for (const [rel, want] of MODELS[p]) {
      let buf = await fetchBuf(`https://storage.googleapis.com/${rel}`);
      if (sha(buf) !== want) throw new Error(`${path.basename(rel)} (${p}) does not match its pinned hash`);
      if (rel.endsWith('.gz')) buf = zlib.gunzipSync(buf);
      fs.writeFileSync(path.join(dir, path.basename(rel).replace(/\.gz$/, '')), buf);
    }
    const model = fs.readdirSync(dir).find((f) => f.startsWith('model.'));
    sizes[p] = pack(tmp, p, dest, 5);
    if (!keep) fs.rmSync(tmp, { recursive: true, force: true });
    fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ ...manifest(out), [p]: { version: MODEL_VERSION, file: `${p}/${model}` } }));
    console.log('◇', `translation ${p}`, mb(sizes[p]));
  }
  return sizes;
}
