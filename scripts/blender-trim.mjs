// What Lime leaves out of the official Blender build it bundles, by path inside the unpacked app (forward slashes).
// Everything here is either GPU code for cards Lime's copy doesn't render on, or files Blender never loads at run time.
// Blender itself and the libraries it links stay whole: cycles_kernel_oneapi_aot, sycl and hiprt are linked
// directly by the Blender binary (a hard import, checked with readelf and pefile), so those can't go.
import fs from 'node:fs';
import path from 'node:path';

// The languages Lime reads text in (see LANGS in engines.mjs), so Blender's menus stay translated for them.
const LOCALES = ['languages', 'es', 'fr', 'fr_FR', 'de', 'de_DE', 'it', 'it_IT', 'pt', 'pt_BR', 'pt_PT', 'nl', 'ru', 'ru_RU', 'ar', 'ar_EG', 'hi', 'hi_IN', 'ja', 'ja_JP', 'zh_HANS', 'zh_CN', 'ko', 'ko_KR'];
export const DROP = [
  // Cycles' CUDA, OptiX and HIP kernels: Lime renders on the CPU (and Metal on a Mac, which compiles from source/kernel).
  /\/cycles\/lib\/[^/]*\.(cubin|ptx|fatbin|hipfb)(\.zst)?$/,
  // Open Image Denoise loads its GPU modules only if they are there; the CPU module stays.
  /(^|\/)(lib)?OpenImageDenoise_device_(cuda|hip|sycl)[^/]*$/,
  new RegExp(`/datafiles/locale/(?!(?:${LOCALES.join('|')})(/|$))[^/]+`),
  // The bundled Python's own tests, IDLE, Tk and the pip installer.
  /\/python\/lib\/(python3\.\d+\/)?(test|idlelib|tkinter|turtledemo|ensurepip|lib2to3|__phello__)(\/|$)/,
  /\/python\/lib\/(python3\.\d+\/)?(turtle\.py|lib-dynload\/_tkinter[^/]*)$/,
  /\/python\/lib\/(python3\.\d+\/)?config-[^/]*\//,
  /\/python\/DLLs\/(_tkinter\.pyd|tcl\d+t?\.dll|tk\d+t?\.dll|zlib1\.dll\.pdb)$/i,
  /\/python\/(tcl|libs|include)\//,
  /\/python\/lib\/(python3\.\d+\/)?site-packages\/(.+\/)?tests?\//,
  // Compiled bytecode is made again from the .py files, and debug symbols are for crash debugging only.
  /(^|\/)__pycache__\//,
  /\.(pdb|debug)$/i,
  /\.dSYM\//,
];
export const dropped = (rel) => DROP.some((r) => r.test(`/${rel.replace(/\\/g, '/')}`));

// Removes the dropped files under dir, and returns how many bytes went.
export function trimBlender(dir) {
  let freed = 0;
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name), r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory() && !e.isSymbolicLink()) {
        if (dropped(`${r}/`)) { freed += size(p); fs.rmSync(p, { recursive: true, force: true }); } else walk(p, r);
      } else if (dropped(r)) { freed += fs.lstatSync(p).size; fs.rmSync(p, { force: true }); }
    }
  };
  walk(dir, '');
  return freed;
}
const size = (p) => fs.readdirSync(p, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() && !e.isSymbolicLink() ? size(path.join(p, e.name)) : fs.lstatSync(path.join(p, e.name)).size), 0);
