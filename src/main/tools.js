'use strict';
const U = require('./engines/util');
const { fsp, path } = U;

const lazy = (name) => () => require(`./engines/${name}`);
const word = lazy('word'), excel = lazy('excel'), slides = lazy('slides'), kit = lazy('officekit');
const gif = lazy('gif'), plus = lazy('pdfplus');
const pdf = lazy('pdf'), img = lazy('image'), media = lazy('media'), arc = lazy('archive'), office = lazy('office'), cad = lazy('cad'), craft = lazy('crafts'), data = lazy('data'), subs = lazy('subtitles'), ebook = lazy('ebook'), fonts = lazy('fonts'), email = lazy('email'), web = lazy('web');

const MORE_GROUPS = { subtitle: ['smi', 'sami', 'lrc', 'ttml', 'dfxp', 'scc'], data: ['jsonl', 'ndjson', 'jsonc', 'toml'], contacts: ['vcf', 'vcard'],
  font: ['ttf', 'otf', 'woff', 'woff2', 'eot', 'ttc'], mail: ['eml', 'msg'], webarchive: ['mht', 'mhtml'], comic: ['cbz', 'cbr', 'cb7', 'cbt', 'cbc'], ebook: ['epub', 'kepub', 'mobi', 'azw', 'azw3', 'azw4', 'prc', 'fb2', 'htmlz', 'txtz'] };
const MORE_EXT = Object.fromEntries(Object.entries(MORE_GROUPS).flatMap(([g, list]) => list.map((e) => [e, g])));
Object.assign(MORE_EXT, require('./diagramtools').EXT);
function palmBook(p) {
  try { const fd = U.fs.openSync(p, 'r'), b = Buffer.alloc(8); U.fs.readSync(fd, b, 0, 8, 60); U.fs.closeSync(fd); return /^(BOOKMOBI|TEXtREAd)$/.test(b.toString('latin1')); } catch (_) { return false; }
}
function groupOf(p) {
  const g = U.groupOf(p), e = U.ext(p);
  if (g === 'folder') return g;
  if (g === 'doc' && e === 'xml') return 'data';
  return MORE_EXT[e] || (e === 'pdb' && palmBook(p) ? 'ebook' : g);
}

const choice = (key, label, choices, def, extra = {}) => ({ key, type: 'choice', label, choices, default: def ?? choices[0][0], ...extra });
const select = (key, label, choices, def, extra = {}) => ({ key, type: 'select', label, choices, default: def ?? choices[0][0], ...extra });
const text = (key, label, def = '', extra = {}) => ({ key, type: 'text', label, default: def, ...extra });
const num = (key, label, def, extra = {}) => ({ key, type: 'number', label, default: def, ...extra });
const range = (key, label, def, min, max, extra = {}) => ({ key, type: 'range', label, default: def, min, max, step: 1, ...extra });
const toggle = (key, label, def = false, extra = {}) => ({ key, type: 'toggle', label, default: def, ...extra });
const pages = (key = 'pages', label = 'Pages', def = 'all', extra = {}) => ({ key, type: 'pages', label, default: def, placeholder: '1-3, 5, 8-', ...extra });
const color = (key, label, def) => ({ key, type: 'color', label, default: def });
const password = (key, label, extra = {}) => ({ key, type: 'password', label, default: '', ...extra });
const cells = (key, label, extra = {}) => ({ key, type: 'cells', label, default: '', placeholder: 'A1:F20 or Sheet2!B2:H40', ...extra });
const file = (key, label, filters, extra = {}) => ({ key, type: 'file', label, filters, default: '', ...extra });
const level = (def = 'recommended') => choice('level', 'Compression', [['low', 'Light'], ['recommended', 'Balanced'], ['extreme', 'Strong']], def);
const pdfPassword = password('password', 'Password, if locked', { advanced: true });
const WEB_PAGE = ['html', 'htm', 'xhtml'], WEB_CODE = [...WEB_PAGE, 'css', 'js', 'mjs'], WEB_OPEN = [...WEB_CODE, 'md', 'svg'];

const each = (fn) => async (files, opts, ctx) => {
  const out = [];
  for (let i = 0; i < files.length; i++) {
    const sub = { ...ctx, progress: (f, l) => ctx.progress((i + (f || 0)) / files.length, files.length > 1 ? `${l || 'Working'} · ${i + 1} of ${files.length}` : l) };
    out.push(await fn(files[i], opts, sub));
  }
  return out;
};
const outFile = (suffix, e) => (f, ctx) => ctx.out.file(f, `${U.base(f)}${suffix}.${e}`);
const IMAGE_IN = ['image', 'raw'];
const anyToPdf = (f, c, out) => (IMAGE_IN.includes(U.groupOf(f)) ? img().toPdf([f], { pageSize: 'fit' }, out || outFile('', 'pdf')(f, c), c) : office().anyToPdf(f, c, out));
const NO_ALPHA_OUT = ['jpg', 'bmp', 'heic', 'pcx', 'ppm', 'pgm', 'pbm', 'pfm', 'ras', 'xbm', 'wbmp'];
const IMAGE_OUT = [['jpg', 'JPG'], ['png', 'PNG'], ['webp', 'WebP'], ['heic', 'HEIC'], ['avif', 'AVIF'], ['tiff', 'TIFF'], ['gif', 'GIF'], ['apng', 'Animated PNG (APNG)'], ['pdf', 'PDF'], ['psd', 'Photoshop (PSD)'],
  ['ico', 'Windows icon (ICO)'], ['icns', 'Mac icon (ICNS)'], ['cur', 'Cursor (CUR)'], ['bmp', 'BMP'], ['jxl', 'JPEG XL'], ['jp2', 'JPEG 2000 (lossless)'], ['tga', 'TGA'], ['qoi', 'QOI'], ['dds', 'DDS texture'],
  ['pcx', 'PCX'], ['ppm', 'PPM'], ['pgm', 'PGM (greyscale)'], ['pbm', 'PBM (black and white)'], ['pam', 'PAM'], ['pfm', 'PFM (float)'], ['sgi', 'SGI'], ['ras', 'Sun raster'], ['xpm', 'XPM'], ['xbm', 'XBM'], ['wbmp', 'WBMP']];
const LANGS = [['eng', 'English'], ['spa', 'Spanish'], ['fra', 'French'], ['deu', 'German'], ['ita', 'Italian'], ['por', 'Portuguese'], ['nld', 'Dutch'], ['rus', 'Russian'], ['ara', 'Arabic'], ['hin', 'Hindi'], ['jpn', 'Japanese'], ['chi_sim', 'Chinese'], ['kor', 'Korean']];
const CAD2D_OUT = [['pdf', 'PDF'], ['svg', 'SVG'], ['png', 'PNG'], ['jpg', 'JPG'], ['dxf', 'DXF'], ['ai', 'Illustrator (AI)'], ['eps', 'EPS'], ['emf', 'EMF']];
const CAD3D_OUT = [['stl', 'STL'], ['step', 'STEP'], ['iges', 'IGES'], ['obj', 'OBJ'], ['glb', 'GLB'], ['gltf', 'glTF (one file)'], ['3mf', '3MF'], ['ply', 'PLY'], ['brep', 'BREP (Open CASCADE)'], ['off', 'OFF'], ['amf', 'AMF'],
  ['wrl', 'VRML (WRL)'], ['x3d', 'X3D'], ['dae', 'Collada (DAE)'], ['png', 'PNG render'], ['pdf', 'PDF render']];
const UNIT_OUT = ['stl', 'step', 'iges', 'obj', '3mf', 'ply', 'brep', 'off', 'amf', 'wrl', 'x3d', 'dae'];
const MODEL_UNITS = [['mm', 'Millimetres'], ['cm', 'Centimetres'], ['m', 'Metres'], ['in', 'Inches'], ['ft', 'Feet']];
const PLACE_OPTS = [select('centre', 'Position', [['', 'As it is'], ['centre', 'Centred'], ['floor', 'Centred, on the ground']], '', { advanced: true }), num('scale', 'Scale (%)', 100, { advanced: true, min: 0.001 })];
const MERGE_OUT = [['stl', 'STL'], ['step', 'STEP'], ['obj', 'OBJ'], ['glb', 'GLB'], ['3mf', '3MF'], ['ply', 'PLY']];
const SAME_MODEL = ['stl', 'obj', 'ply', 'off', '3mf', 'glb', 'gltf'];
const sameModel = (files) => (SAME_MODEL.includes(U.ext(files[0] || '')) ? U.ext(files[0]) : 'stl');
const VIDEO_OUT = [['mp4', 'MP4 (H.264)'], ['hevc', 'MP4 (HEVC)'], ['av1', 'MP4 (AV1)'], ['mov', 'MOV'], ['webm', 'WebM'], ['mkv', 'MKV'], ['avi', 'AVI'], ['wmv', 'WMV'], ['flv', 'FLV'], ['mpg', 'MPG (MPEG-2)'], ['ts', 'TS'], ['m2ts', 'M2TS (Blu-ray)'], ['vob', 'VOB (DVD)'], ['ogv', 'OGV (Theora)'], ['3gp', '3GP'], ['3g2', '3G2'], ['m4v', 'M4V'], ['dv', 'DV'], ['mxf', 'MXF'], ['gif', 'GIF'], ['apng', 'APNG (animated PNG)']];
const AUDIO_OUT = [['mp3', 'MP3'], ['m4a', 'M4A (AAC)'], ['wav', 'WAV'], ['flac', 'FLAC'], ['alac', 'ALAC (Apple Lossless)'], ['aiff', 'AIFF'], ['ogg', 'OGG'], ['opus', 'Opus'], ['aac', 'AAC'], ['wma', 'WMA'], ['ac3', 'AC3'], ['eac3', 'E-AC-3'], ['m4b', 'M4B (audiobook)'], ['wv', 'WavPack'], ['tta', 'TTA'], ['caf', 'CAF'], ['au', 'AU'], ['w64', 'Wave64'], ['mp2', 'MP2'], ['mka', 'MKA'], ['weba', 'WEBA'], ['voc', 'VOC'], ['amr', 'AMR (voice)']];
const LOSSY = ['mp3', 'm4a', 'aac', 'ogg', 'opus', 'wma', 'ac3', 'eac3', 'm4b', 'mp2', 'mka', 'weba'];
const AUDIO_OPTS = (label) => [select('to', label, AUDIO_OUT), select('bitrate', 'Quality', [['', 'Auto'], ['320k', '320 kbps'], ['256k', '256 kbps'], ['192k', '192 kbps'], ['128k', '128 kbps'], ['96k', '96 kbps'], ['64k', '64 kbps']], '', { when: { to: LOSSY } }),
  toggle('mono', 'Mono', false, { advanced: true }), select('rate', 'Sample rate', [['', 'Original'], ['48000', '48 kHz'], ['44100', '44.1 kHz'], ['22050', '22.05 kHz'], ['16000', '16 kHz'], ['8000', '8 kHz']], '', { advanced: true, when: { to: ['wav', 'w64'] } }),
  select('depth', 'Bit depth', [['16', '16-bit'], ['24', '24-bit'], ['32', '32-bit'], ['float', '32-bit float'], ['8', '8-bit']], '16', { advanced: true, when: { to: ['wav', 'w64'] } })];
const MEDIA_EXT = { hevc: 'mp4', av1: 'mp4', apng: 'png', alac: 'm4a' };
const mediaExt = (o) => MEDIA_EXT[o.to] || o.to;
const FFMPEG_TARGETS = new Set(['convert-video', 'extract-audio', 'convert-audio', 'gif-to-video']);
const SUB_IN = ['srt', 'vtt', 'ass', 'ssa', 'smi', 'sami', 'lrc', 'ttml', 'dfxp', 'scc', 'sub'];
const SINGLE_IN = ['gz', 'bz2', 'xz', 'lzma', 'z', 'zst', 'tgz', 'tbz', 'tbz2', 'txz', 'tzst'];
const ARCHIVE_OUT = [['zip', 'ZIP'], ['7z', '7Z'], ['tar.gz', 'TAR.GZ'], ['tar.xz', 'TAR.XZ'], ['tar.bz2', 'TAR.BZ2'], ['tar', 'TAR'], ['gz', 'GZ (one file)'], ['bz2', 'BZ2 (one file)'], ['xz', 'XZ (one file)']];

const PRINT_OPTS = [
  choice('print', 'Print', [['workbook', 'Workbook'], ['active', 'Active sheet'], ['selection', 'Selection']], 'workbook'),
  cells('cells', 'Cells', { required: true, when: { print: ['selection'] } }),
  select('fit', 'Scaling', [['sheet', 'As set in the file'], ['none', 'Actual size'], ['page', 'Fit sheet on one page'], ['columns', 'Fit all columns on one page'], ['rows', 'Fit all rows on one page']], 'sheet'),
  choice('orientation', 'Orientation', [['auto', 'Auto'], ['portrait', 'Portrait'], ['landscape', 'Landscape']], 'auto'),
  select('paper', 'Paper', [['auto', 'As set in the file'], ['a4', 'A4'], ['letter', 'Letter'], ['legal', 'Legal'], ['a3', 'A3'], ['a5', 'A5'], ['tabloid', 'Tabloid']], 'auto'),
  choice('gridlines', 'Gridlines', [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']], 'auto'),
  choice('margins', 'Margins', [['auto', 'As set'], ['normal', 'Normal'], ['narrow', 'Narrow'], ['wide', 'Wide']], 'auto', { advanced: true }),
  choice('order', 'Page order', [['auto', 'As set'], ['down', 'Down, then over'], ['over', 'Over, then down']], 'auto', { advanced: true }),
  toggle('headings', 'Row and column headings', false, { advanced: true }),
  toggle('center', 'Center on page', false, { advanced: true }),
  toggle('pageNumbers', 'Page numbers', false, { advanced: true }),
  toggle('ignoreArea', 'Ignore print areas', false, { advanced: true, when: { print: ['workbook', 'active'] } }),
];
const PAPER_CHOICES = [['a4', 'A4'], ['letter', 'Letter'], ['legal', 'Legal'], ['a3', 'A3'], ['a5', 'A5']];
const DOC_PRINT = [
  select('paper', 'Paper', [['auto', 'As set in the document'], ...PAPER_CHOICES], 'auto'),
  choice('orientation', 'Orientation', [['auto', 'Auto'], ['portrait', 'Portrait'], ['landscape', 'Landscape']], 'auto'),
  choice('margins', 'Margins', [['auto', 'As set'], ['normal', 'Normal'], ['narrow', 'Narrow'], ['wide', 'Wide']], 'auto', { advanced: true }),
  toggle('pageNumbers', 'Page numbers', false, { advanced: true }),
  pages('pages', 'Pages', 'all', { advanced: true }),
];
const HANDOUTS = ['2', '3', '4', '6', '9'];
const SLIDE_PRINT = [
  select('layout', 'Layout', [['slides', 'Full page slides'], ['2', 'Handouts, 2 per page'], ['3', 'Handouts, 3 per page with lines'], ['4', 'Handouts, 4 per page'], ['6', 'Handouts, 6 per page'], ['9', 'Handouts, 9 per page']], 'slides'),
  pages('slides', 'Slides', 'all'),
  select('paper', 'Paper', [['auto', 'Automatic'], ...PAPER_CHOICES], 'auto', { when: { layout: HANDOUTS } }),
  choice('orientation', 'Orientation', [['portrait', 'Portrait'], ['landscape', 'Landscape']], 'portrait', { when: { layout: HANDOUTS } }),
  toggle('frame', 'Frame slides', true, { when: { layout: HANDOUTS } }),
];
const WORD_IN = ['docx', 'docm', 'dotx', 'dotm'], XLSX_IN = ['xlsx', 'xlsm', 'xltx', 'xltm'], PPTX_IN = ['pptx', 'pptm', 'ppsx', 'ppsm', 'potx', 'potm'];
const OFFICE_IN = [...WORD_IN, 'odt', ...XLSX_IN, 'ods', ...PPTX_IN, 'odp'];
const sameExt = (suffix) => (files, o) => `${U.base(files[0])}${typeof suffix === 'function' ? suffix(o) : suffix}.${U.ext(files[0])}`;
const SHEETS = { name: 'Spreadsheets', extensions: ['csv', 'tsv', 'xlsx', 'xls', 'xlsm', 'ods'] };
const PHOTO_EXT = ['jpg', 'jpeg', 'png', 'webp', 'tif', 'tiff', 'psd', 'psb', 'pcraft'];
const LAYERED_EXT = ['psd', 'psb', 'pcraft', 'tif', 'tiff'];
const LIGHT_EXT = ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'heic', 'heif', 'webp', 'avif', 'jxl'];
const photoExt = (o, files) => { const e = U.ext(files[0] || ''); return ['jpg', 'png', 'webp'].includes(e) ? e : e === 'jpeg' ? 'jpg' : 'png'; };
const lightExt = (o, files) => (['png', 'tif', 'tiff'].includes(U.ext(files[0] || '')) ? 'png' : 'jpg');
const LIGHT_LOOK_CHOICES = craft().LIGHT_PRESETS.map((id) => [id, id.replace(/^lc\./, '').replace(/^bw-/, 'B&W ').replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()).replace('70s', '70s')]);
const VIDEO_LOOK_CHOICES = craft().VIDEO_LOOKS.map((l) => [l, l]);
const notMidi = (files) => !files.some((f) => ['mid', 'midi'].includes(U.ext(f)));
const WORD_EDIT = [...WORD_IN, 'odt', 'rtf'], WORD_DOCS = [...WORD_EDIT, 'doc'];
const wordExt = (o, files) => (['docx', 'odt', 'rtf'].includes(U.ext(files[0] || '')) ? U.ext(files[0]) : 'docx');
const CSV_IN = ['csv', 'tsv'], GRID_IN = [...XLSX_IN, 'ods', 'xls', 'xlsb', ...CSV_IN], DECK_IN = ['pptx', 'deckcraft'];

const TOOLS = [
  { id: 'edit-pdf', cat: 'pdf', name: 'Edit PDF', desc: 'Change text, add text, images, shapes and highlights.', accepts: ['pdf'], max: 1, editor: 'edit' },
  { id: 'sign-pdf', cat: 'pdf', name: 'Sign PDF', desc: 'Draw, type or place a signature.', accepts: ['pdf'], max: 1, editor: 'sign' },
  { id: 'organize-pdf', cat: 'pdf', name: 'Organize pages', desc: 'Reorder, rotate, delete and insert pages.', accepts: ['pdf'], max: 1, editor: 'pages' },
  { id: 'edit-image', cat: 'image', name: 'Edit image', desc: 'Crop, straighten, adjust, retouch and add text, with PhotoCraft and LightCraft tools.', accepts: ['image', 'raw'], max: 1, editor: 'image' },
  { id: 'edit-video', cat: 'media', name: 'Edit video', desc: 'Trim, cut, crop, add titles and music, with FilmCraft tools.', accepts: ['video'], max: 1, editor: 'media' },
  { id: 'edit-audio', cat: 'media', name: 'Edit audio', desc: 'Trim, cut, fade, level and clean up a recording.', accepts: ['audio'], max: 1, editor: 'media' },
  { id: 'edit-vector', cat: 'cad', name: 'Edit vector', desc: 'Recolour, trace, outline and export artwork, with VectorCraft.', accepts: ['vector'], extAccept: ['svg', 'svgz', 'pdf'], max: 1, editor: 'studio:vectorcraft' },
  { id: 'edit-layout', cat: 'docs', name: 'Edit layout', desc: 'Check, fix and export a page layout, with DesignCraft.', accepts: ['layout'], max: 1, editor: 'studio:designcraft' },
  { id: 'edit-motion', cat: 'media', name: 'Edit animation', desc: 'Retime, recolour and render an animation, with EffectCraft.', accepts: ['motion'], max: 1, editor: 'studio:effectcraft' },
  { id: 'edit-web', cat: 'docs', name: 'Edit web page', desc: 'Design view and code side by side, kept in step, with a preview at phone, tablet and desktop widths.', accepts: [], extAccept: WEB_OPEN, max: 1, editor: 'web' },
  { id: 'edit-timeline', cat: 'media', name: 'Edit timeline', desc: 'Look through, trim and render an edit, with FilmCraft.', accepts: ['timeline'], max: 1, editor: 'studio:filmcraft' },
  { id: 'merge-pdf', cat: 'pdf', name: 'Merge PDF', desc: 'Combine PDFs and images into one PDF.', accepts: ['pdf', 'image'], min: 2, ordered: true, ext: 'pdf', suffix: ' - merged',
    run: async (files, opts, ctx) => {
      const tmp = await U.tmpDir('merge');
      const list = [];
      for (const f of files) { if (U.groupOf(f) === 'pdf') list.push(f); else { const p = path.join(tmp, `${list.length}.pdf`); await img().toPdf([f], { pageSize: 'fit' }, p); list.push(p); } }
      const out = ctx.out.file(files[0], `${U.base(files[0])} - merged.pdf`);
      await pdf().merge(list, out, ctx);
      fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
      return [out];
    } },
  { id: 'split-pdf', cat: 'pdf', name: 'Split PDF', desc: 'Split by ranges, into equal parts, or pull out the pages you pick.', accepts: ['pdf'], save: 'folder', suffix: ' - split',
    single: (o) => (o.mode === 'ranges' && !!o.mergeRanges) || (o.mode === 'select' && o.mergeSelected !== false),
    options: [choice('mode', 'Split', [['ranges', 'Ranges'], ['every', 'Fixed size'], ['all', 'Every page'], ['select', 'Pick pages']]), text('ranges', 'Ranges (each becomes a PDF)', '1-3, 4-6', { when: { mode: 'ranges' }, placeholder: '1-3, 4-6, 7-' }), toggle('mergeRanges', 'Combine the ranges into one PDF', false, { when: { mode: 'ranges' } }), num('every', 'Pages in each PDF', 2, { when: { mode: 'every' }, min: 1 }), pages('pages', 'Pages to extract', '1', { when: { mode: 'select' } }), toggle('mergeSelected', 'Save them as one PDF', true, { when: { mode: 'select' } })],
    run: each((f, o, c) => pdf().split(f, o, c)) },
  { id: 'compress-pdf', cat: 'pdf', name: 'Compress PDF', desc: 'Recompress images and rebuild the file.', accepts: ['pdf'], ext: 'pdf', suffix: '-compressed',
    options: [level(), pdfPassword], run: each((f, o, c) => plus().compress(f, o, outFile('-compressed', 'pdf')(f, c), c)) },
  { id: 'optimize-pdf', cat: 'pdf', name: 'Repair PDF', desc: 'Fix a damaged or bloated PDF: PdfCraft rebuilds and slims it.', tags: 'optimize broken corrupt fix rebuild', accepts: ['pdf'], ext: 'pdf', suffix: '-optimized', craft: 'pdfcraft', prio: 10, petal: ['Repair', 'Fix & slim'],
    options: [range('quality', 'Image quality', 60, 20, 95, { unit: '%', advanced: true })], run: each((f, o, c) => craft().optimizePdf(f, o, c)) },
  { id: 'pdf-to-word', cat: 'pdf', name: 'PDF to Word', desc: 'Editable DOCX with paragraphs and images.', accepts: ['pdf'], ext: 'docx',
    options: [pdfPassword], run: each((f, o, c) => pdf().toWord(f, o, outFile('', 'docx')(f, c), c)) },
  { id: 'pdf-to-powerpoint', cat: 'pdf', name: 'PDF to PowerPoint', desc: 'One slide per page, text in the notes.', accepts: ['pdf'], ext: 'pptx',
    options: [toggle('notes', 'Page text in speaker notes', true), pdfPassword], run: each((f, o, c) => pdf().toPowerPoint(f, o, outFile('', 'pptx')(f, c), c)) },
  { id: 'pdf-to-excel', cat: 'pdf', name: 'PDF to Excel', desc: 'Rebuild tables into rows and columns.', accepts: ['pdf'], ext: (o) => o.to || 'xlsx',
    options: [choice('to', 'Format', [['xlsx', 'Excel'], ['csv', 'CSV']]), pdfPassword], run: each((f, o, c) => pdf().toExcel(f, o, outFile('', o.to || 'xlsx')(f, c))) },
  { id: 'pdf-to-jpg', cat: 'pdf', name: 'PDF to images', desc: 'Save each page as a picture.', accepts: ['pdf'], save: 'folder', suffix: ' - images',
    options: [choice('format', 'Format', [['jpg', 'JPG'], ['png', 'PNG'], ['webp', 'WebP']]), choice('dpi', 'Resolution', [['96', 'Screen'], ['150', 'Standard'], ['300', 'Print']], '150'), pages(), pdfPassword],
    run: each((f, o, c) => pdf().toImages(f, o, c)) },
  { id: 'pdf-to-tiff', cat: 'pdf', name: 'PDF to TIFF', desc: 'Every page in one multi-page TIFF.', accepts: ['pdf'], ext: 'tif',
    options: [choice('dpi', 'Resolution', [['150', 'Standard'], ['300', 'Print'], ['600', 'Archive']], '300'), pages(), pdfPassword], run: each((f, o, c) => pdf().toTiff(f, o, outFile('', 'tif')(f, c), c)) },
  { id: 'pdf-to-cbz', cat: 'pdf', name: 'PDF to comic book', desc: 'Pages as a CBZ for comic and e-book readers.', accepts: ['pdf'], ext: 'cbz',
    options: [choice('dpi', 'Resolution', [['96', 'Small'], ['150', 'Standard'], ['300', 'Sharp']], '150'), range('quality', 'JPEG quality', 85, 30, 100, { unit: '%' }), pages(), pdfPassword], run: each((f, o, c) => pdf().toComic(f, o, outFile('', 'cbz')(f, c), c)) },
  { id: 'pdf-to-markdown', cat: 'pdf', name: 'PDF to Markdown', desc: 'Headings, paragraphs, lists and pictures as Markdown.', accepts: ['pdf'], ext: 'md', options: [pdfPassword], run: each((f, o, c) => pdf().toMarkdown(f, o, outFile('', 'md')(f, c), c)) },
  { id: 'pdf-to-text', cat: 'pdf', name: 'PDF to text', desc: 'All text as a plain-text file.', accepts: ['pdf'], ext: 'txt', options: [pdfPassword], run: each((f, o, c) => pdf().toText(f, o, outFile('', 'txt')(f, c))) },
  { id: 'pdf-to-html', cat: 'pdf', name: 'PDF to HTML', desc: 'A web page that keeps the layout.', accepts: ['pdf'], ext: 'html', options: [pdfPassword], run: each((f, o, c) => pdf().toHtml(f, o, outFile('', 'html')(f, c))) },
  { id: 'pdf-to-svg', cat: 'pdf', name: 'PDF to SVG', desc: 'Vector artwork via VectorCraft.', accepts: ['pdf'], ext: 'svg', craft: 'vectorcraft', prio: 20, petal: ['SVG', 'Vector'], run: each((f, o, c) => craft().vector(f, { to: 'svg' }, c)) },
  { id: 'to-pdf', cat: 'pdf', name: 'Make PDF', desc: 'Documents, slides, sheets, drawings or images to PDF.', accepts: ['doc', 'sheet', 'slides', 'vector', 'cad2d', 'layout', 'image', 'raw', 'ebook'], ext: 'pdf',
    run: each((f, o, c) => anyToPdf(f, c)) },
  { id: 'jpg-to-pdf', cat: 'pdf', name: 'Images to PDF', desc: 'One PDF from photos, scans or screenshots.', accepts: IMAGE_IN, ordered: true, ext: 'pdf',
    options: [choice('combine', 'Output', [['one', 'One PDF'], ['each', 'One per image']]), select('pageSize', 'Page size', [['fit', 'Same as image'], ['a4', 'A4'], ['letter', 'Letter'], ['legal', 'Legal'], ['a3', 'A3']]), choice('orientation', 'Orientation', [['auto', 'Auto'], ['portrait', 'Portrait'], ['landscape', 'Landscape']], 'auto', { when: { pageSize: ['a4', 'letter', 'legal', 'a3'] } }), choice('margin', 'Margin', [['none', 'None'], ['small', 'Small'], ['large', 'Large']])],
    run: async (files, o, c) => (o.combine === 'each' ? each((f, oo, cc) => img().toPdf([f], oo, outFile('', 'pdf')(f, cc), cc))(files, o, c) : [await img().toPdf(files, o, c.out.file(files[0], files.length > 1 ? `${U.base(files[0])} and ${files.length - 1} more.pdf` : `${U.base(files[0])}.pdf`), c)]) },
  { id: 'html-to-pdf', cat: 'pdf', name: 'Web page to PDF', desc: 'Save a web address as a PDF.', accepts: [], noFiles: true, ext: 'pdf',
    options: [text('url', 'Web address', '', { placeholder: 'https://example.com', required: true }), select('pageSize', 'Page size', [['A4', 'A4'], ['Letter', 'Letter'], ['A3', 'A3']]), toggle('landscape', 'Landscape')],
    run: async (files, o, c) => [await office().urlToPdf(o.url, o, c)] },
  { id: 'remove-pages', cat: 'pdf', name: 'Remove pages', desc: 'Delete pages you don’t need.', accepts: ['pdf'], ext: 'pdf', suffix: '-trimmed',
    options: [pages('pages', 'Pages to remove', '', { required: true })], run: each((f, o, c) => pdf().removePages(f, o.pages, outFile('-trimmed', 'pdf')(f, c))) },
  { id: 'extract-pages', cat: 'pdf', name: 'Extract pages', desc: 'Copy chosen pages into a new PDF.', accepts: ['pdf'], ext: 'pdf', suffix: '-extract',
    options: [pages('pages', 'Pages to keep', '1', { required: true })], run: each((f, o, c) => pdf().extract(f, o.pages, outFile('-extract', 'pdf')(f, c))) },
  { id: 'rotate-pdf', cat: 'pdf', name: 'Rotate PDF', desc: 'Turn pages the right way up.', accepts: ['pdf'], ext: 'pdf', suffix: '-rotated',
    options: [choice('angle', 'Rotate', [['90', '90° right'], ['180', '180°'], ['270', '90° left']], '90'), pages()], run: each((f, o, c) => pdf().rotate(f, o, outFile('-rotated', 'pdf')(f, c))) },
  { id: 'page-numbers', cat: 'pdf', name: 'Page numbers', desc: 'Number pages in your chosen style.', accepts: ['pdf'], ext: 'pdf', suffix: '-numbered',
    options: [select('position', 'Position', [['bottom-center', 'Bottom centre'], ['bottom-right', 'Bottom right'], ['bottom-left', 'Bottom left'], ['top-center', 'Top centre'], ['top-right', 'Top right']]), select('format', 'Format', [['{n}', '1'], ['Page {n}', 'Page 1'], ['Page {n} of {total}', 'Page 1 of 9'], ['{n} / {total}', '1 / 9']]), num('start', 'First number', 1), range('size', 'Size', 11, 6, 36, { unit: 'pt' }), pages(), color('color', 'Colour', '#333333')],
    run: each((f, o, c) => pdf().pageNumbers(f, o, outFile('-numbered', 'pdf')(f, c))) },
  { id: 'watermark-pdf', cat: 'pdf', name: 'Watermark PDF', desc: 'Stamp text or an image on pages.', accepts: ['pdf'], ext: 'pdf', suffix: '-watermarked',
    options: [choice('kind', 'Watermark', [['text', 'Text'], ['image', 'Image']]), text('text', 'Text', 'CONFIDENTIAL', { when: { kind: 'text' } }), file('image', 'Image', [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }], { when: { kind: 'image' } }), choice('layout', 'Layout', [['single', 'Once'], ['tiled', 'Tiled']]), range('opacity', 'Opacity', 30, 5, 100, { unit: '%' }), range('rotation', 'Angle', 45, -90, 90, { unit: '°' }), { ...color('color', 'Colour', '#d13438'), when: { kind: 'text' } }, range('scale', 'Image size', 40, 5, 100, { unit: '%', when: { kind: 'image' } }), pages()],
    run: each((f, o, c) => pdf().watermark(f, o, outFile('-watermarked', 'pdf')(f, c))) },
  { id: 'crop-pdf', cat: 'pdf', name: 'Crop PDF', desc: 'Trim page margins.', accepts: ['pdf'], ext: 'pdf', suffix: '-cropped',
    options: [num('top', 'Top (mm)', 10, { min: 0 }), num('bottom', 'Bottom (mm)', 10, { min: 0 }), num('left', 'Left (mm)', 10, { min: 0 }), num('right', 'Right (mm)', 10, { min: 0 }), pages()],
    run: each((f, o, c) => pdf().crop(f, o, outFile('-cropped', 'pdf')(f, c))) },
  { id: 'pages-per-sheet', cat: 'pdf', name: 'Pages per sheet', desc: 'Put 2, 4, 9 or 16 pages on each sheet.', accepts: ['pdf'], ext: 'pdf', suffix: '-n-up',
    options: [choice('n', 'Pages per sheet', ['2', '4', '6', '8', '9', '16'].map((n) => [n, n]), '4'), choice('paper', 'Paper', [['auto', 'Same as the pages'], ...PAPER_CHOICES]), choice('orientation', 'Orientation', [['auto', 'Best fit'], ['portrait', 'Portrait'], ['landscape', 'Landscape']]), choice('order', 'Order', [['across', 'Across'], ['down', 'Down']]), num('margin', 'Margin (mm)', 10, { min: 0 }), toggle('border', 'Border round each page'), pages(), pdfPassword],
    run: each((f, o, c) => pdf().pagesPerSheet(f, o, outFile('-n-up', 'pdf')(f, c))) },
  { id: 'pdf-page-size', cat: 'pdf', name: 'Change page size', desc: 'Put every page on A4, Letter or a size you choose.', accepts: ['pdf'], ext: 'pdf', suffix: '-resized',
    options: [choice('paper', 'Paper', [...PAPER_CHOICES, ['custom', 'Custom']]), num('width', 'Width (mm)', 210, { min: 20, when: { paper: 'custom' } }), num('height', 'Height (mm)', 297, { min: 20, when: { paper: 'custom' } }), choice('orientation', 'Orientation', [['auto', 'Like each page'], ['portrait', 'Portrait'], ['landscape', 'Landscape']]), choice('scale', 'Content', [['fit', 'Fit'], ['fill', 'Fill'], ['actual', 'Actual size']]), num('margin', 'Margin (mm)', 0, { min: 0 }), pdfPassword],
    run: each((f, o, c) => pdf().pageSize(f, o, outFile('-resized', 'pdf')(f, c))) },
  { id: 'overlay-pdf', cat: 'pdf', name: 'Overlay PDF', desc: 'Lay a letterhead or another PDF over or under the pages.', accepts: ['pdf'], ext: 'pdf', suffix: '-overlay',
    options: [file('overlay', 'PDF to lay on the pages', [{ name: 'PDF', extensions: ['pdf'] }], { required: true }), choice('position', 'Place it', [['over', 'On top'], ['under', 'Underneath']]), choice('repeat', 'Use', [['first', 'First page on every page'], ['each', 'Page by page']]), choice('scale', 'Size', [['fit', 'Fit the page'], ['actual', 'Actual size']]), pages(), pdfPassword],
    run: each((f, o, c) => pdf().overlay(f, o, outFile('-overlay', 'pdf')(f, c))) },
  { id: 'grayscale-pdf', cat: 'pdf', name: 'Grayscale PDF', desc: 'Turn colour into shades of grey; text stays sharp.', accepts: ['pdf'], ext: 'pdf', suffix: '-grayscale', options: [pdfPassword],
    run: each((f, o, c) => pdf().grayscale(f, o, outFile('-grayscale', 'pdf')(f, c), c)) },
  { id: 'redact-pdf', cat: 'pdf', name: 'Redact PDF', desc: 'Permanently remove words, emails and numbers.', accepts: ['pdf'], ext: 'pdf', suffix: '-redacted',
    options: [{ key: 'terms', type: 'textarea', label: 'Words or phrases, one per line', default: '' }, { key: 'patterns', type: 'multi', label: 'Also find', choices: [['email', 'Emails'], ['phone', 'Phones'], ['card', 'Cards'], ['iban', 'IBANs']], default: [] }, toggle('boxes', 'Black boxes', true), pdfPassword],
    run: each((f, o, c) => pdf().redact(f, o, outFile('-redacted', 'pdf')(f, c))) },
  { id: 'audit-pdf', cat: 'pdf', name: 'Check blacked-out text', desc: 'Find words still readable under black boxes before you share.', tags: 'redaction audit leak', accepts: ['pdf'], save: 'none', craft: 'pdfcraft', prio: 34, petal: ['Black boxes', 'Leak check'], run: each((f, o, c) => craft().auditPdf(f, o, c)) },
  { id: 'protect-pdf', cat: 'pdf', name: 'Protect PDF', desc: 'AES-256 password and permissions.', accepts: ['pdf'], ext: 'pdf', suffix: '-protected',
    options: [password('userPassword', 'Password to open', { required: true }), toggle('allowPrint', 'Allow printing', true), toggle('allowCopy', 'Allow copying', true), toggle('allowEdit', 'Allow editing', false)],
    run: each((f, o, c) => pdf().protect(f, o, outFile('-protected', 'pdf')(f, c))) },
  { id: 'unlock-pdf', cat: 'pdf', name: 'Unlock PDF', desc: 'Remove the password from a PDF you can open.', accepts: ['pdf'], ext: 'pdf', suffix: '-unlocked',
    options: [password('password', 'Current password', { required: true })], run: each((f, o, c) => pdf().unlock(f, o, outFile('-unlocked', 'pdf')(f, c))) },
  { id: 'ocr-pdf', cat: 'pdf', name: 'Searchable PDF', desc: 'Recognise text in scans so you can search and copy it.', accepts: ['pdf'], ext: 'pdf', suffix: '-searchable',
    options: [select('lang', 'Language', LANGS), toggle('skipText', 'Skip pages that already have text', true), choice('dpi', 'Quality', [['200', 'Fast'], ['300', 'Accurate']], '300'), pdfPassword],
    run: each((f, o, c) => pdf().ocr(f, o, outFile('-searchable', 'pdf')(f, c), c)) },
  { id: 'pdf-to-pdfa', cat: 'pdf', name: 'Save for archiving', desc: 'A PDF/A copy that opens the same in decades, as courts and archives ask.', tags: 'pdf/a pdfa archive long term', accepts: ['pdf'], ext: 'pdf', suffix: '-pdfa', craft: 'pdfcraft', prio: 14, petal: ['Archive', 'Long-term'],
    options: [choice('level', 'Standard', [['2b', 'PDF/A-2b'], ['3b', 'PDF/A-3b']]), pdfPassword], run: each((f, o, c) => plus().toPdfA(f, o, c)) },
  { id: 'compare-pdf', cat: 'pdf', name: 'Compare PDF', desc: 'Show what changed between two versions. Put the older one first.', accepts: ['pdf'], min: 2, max: 2, ordered: true, ext: 'pdf', suffix: ' - compared', craft: 'pdfcraft', prio: 32, petal: ['Compare', '2 versions'],
    options: [choice('output', 'Result', [['marked', 'Marked-up copy'], ['report', 'List of changes']])], run: async (files, o, c) => [await craft().comparePdf(files, o, c)] },
  { id: 'make-fillable', cat: 'pdf', name: 'Make a fill-in form', desc: 'Blank lines and boxes become fields people can type into.', tags: 'fillable form fields', accepts: ['pdf'], ext: 'pdf', suffix: '-fillable', craft: 'pdfcraft', prio: 16, petal: ['Form', 'Fill-in'], options: [pdfPassword], run: each((f, o, c) => craft().makeFillable(f, o, c)) },
  { id: 'scan-to-pdf', cat: 'pdf', name: 'Scan to PDF', desc: 'Straighten photos of documents into a clean, searchable PDF.', accepts: IMAGE_IN, ordered: true, ext: 'pdf', craft: 'pdfcraft', prio: 36, petal: ['Scan', 'Clean PDF'],
    options: [choice('mode', 'Look', [['greyscale', 'Greyscale'], ['colour', 'Colour'], ['bw', 'Black & white']]), toggle('ocr', 'Make text searchable', true), select('lang', 'Language', LANGS, 'eng', { when: { ocr: true } })],
    run: async (files, o, c) => {
      const out = c.out.file(files[0], `${U.base(files[0])}${files.length > 1 ? ` and ${files.length - 1} more` : ''} - scan.pdf`);
      const tmp = path.join(await U.tmpDir('scan'), 'scan.pdf');
      await pdf().imagesToPdf(files, { pageSize: 'fit', margin: 'none' }, tmp, c);
      const straight = await craft().enhanceScan(tmp, o, c);
      if (o.ocr) await pdf().ocr(tmp, { lang: o.lang || 'eng', dpi: '300', skipText: false }, out, c); else await fsp.copyFile(tmp, out);
      return [{ path: out, note: `${straight} of ${files.length} page${files.length === 1 ? '' : 's'} straightened${o.ocr ? ', text recognised' : ''}` }];
    } },
  { id: 'repair-pdf', cat: 'pdf', name: 'Repair PDF', desc: 'Rebuild damaged PDFs.', accepts: ['pdf'], ext: 'pdf', suffix: '-repaired', options: [pdfPassword], run: each((f, o, c) => plus().repair(f, outFile('-repaired', 'pdf')(f, c), o, c)) },
  { id: 'flatten-pdf', cat: 'pdf', name: 'Flatten PDF', desc: 'Lock forms and annotations into the page.', accepts: ['pdf'], ext: 'pdf', suffix: '-flattened', run: each((f, o, c) => pdf().flatten(f, outFile('-flattened', 'pdf')(f, c))) },
  { id: 'extract-images-pdf', cat: 'pdf', name: 'Extract images', desc: 'Every embedded picture at full quality.', accepts: ['pdf'], save: 'folder', suffix: ' - embedded images',
    options: [choice('format', 'Save as', [['png', 'PNG'], ['jpg', 'JPG']]), pdfPassword], run: each((f, o, c) => pdf().extractImages(f, o, c)) },

  { id: 'convert-image', cat: 'image', name: 'Convert image', desc: 'JPG, PNG, WebP, HEIC, AVIF, GIF, APNG, ICO, ICNS, TIFF and 20 more.', accepts: IMAGE_IN, ext: (o) => o.to,
    options: [select('to', 'Convert to', IMAGE_OUT), range('quality', 'Quality', 88, 30, 100, { unit: '%', when: { to: ['jpg', 'webp', 'avif', 'heic'] } }), choice('hotspot', 'Hotspot', [['topleft', 'Top left'], ['center', 'Centre']], 'topleft', { when: { to: 'cur' } }),
      { ...color('background', 'Fill transparent areas with', '#ffffff'), when: { to: NO_ALPHA_OUT }, advanced: true }, toggle('strip', 'Remove EXIF and GPS', false, { advanced: true })],
    run: each((f, o, c) => {
      if (o.to === 'pdf') return img().toPdf([f], { pageSize: 'fit' }, outFile('', 'pdf')(f, c), c);
      const e = U.ext(f);
      if (o.to === 'psd' || ['psb', 'pcraft'].includes(e)) return craft().photo(f, { ...o, to: o.to === 'tiff' ? 'tif' : o.to }, c);
      if (['psd', 'exr', 'dpx'].includes(e)) return craft().photo(f, { ...o, to: o.to === 'tiff' ? 'tif' : o.to }, c).catch(() => img().convert(f, o, c));
      if (U.groupOf(f) === 'raw' && o.develop !== false && ['jpg', 'png', 'tiff', 'avif', 'webp'].includes(o.to)) return craft().develop(f, { to: o.to === 'tiff' ? 'tif' : o.to, quality: o.quality }, c).catch(() => img().convert(f, o, c));
      return img().convert(f, o, c);
    }) },
  { id: 'develop-raw', cat: 'image', name: 'Develop RAW', desc: 'LightCraft develops camera RAW into a finished photo.', accepts: ['raw', 'image'], craft: 'lightcraft', prio: 8, petal: ['Develop', 'Options'], ext: (o) => o.to,
    options: [select('to', 'Save as', [['jpg', 'JPG'], ['tif', 'TIFF (16-bit)'], ['png', 'PNG'], ['avif', 'AVIF'], ['jxl', 'JPEG XL'], ['dng', 'DNG']]), toggle('auto', 'Auto-adjust light and colour', true), num('size', 'Long edge (px)', '', { placeholder: 'Full size' }), range('quality', 'Quality', 92, 50, 100, { unit: '%' })],
    run: each((f, o, c) => craft().develop(f, o, c)) },
  { id: 'enhance-photo', cat: 'image', name: 'Auto enhance', desc: 'LightCraft balances exposure, contrast and colour.', accepts: ['raw', 'image'], craft: 'lightcraft', prio: 12, petal: ['Enhance', 'Auto'], ext: (o, files) => (['png', 'tif', 'tiff'].includes(U.ext(files[0] || '')) ? 'png' : 'jpg'), suffix: '-enhanced',
    run: each((f, o, c) => craft().develop(f, { to: ['png', 'tif', 'tiff'].includes(U.ext(f)) ? 'png' : 'jpg', auto: true, quality: 92 }, c)) },
  { id: 'hdr-merge', cat: 'image', name: 'HDR merge', desc: 'Blend bracketed exposures into one HDR photo.', accepts: ['raw', 'image'], min: 2, craft: 'lightcraft', prio: 20, petal: ['HDR', 'Merge'], ext: 'jpg', suffix: '-HDR', run: async (files, o, c) => [await craft().merge(files, { mode: 'hdr' }, c)] },
  { id: 'panorama', cat: 'image', name: 'Panorama', desc: 'Stitch overlapping photos into one wide image.', accepts: ['raw', 'image'], min: 2, craft: 'lightcraft', prio: 22, petal: ['Panorama', 'Stitch'], ext: 'jpg', suffix: '-Pano', run: async (files, o, c) => [await craft().merge(files, { mode: 'panorama' }, c)] },
  { id: 'compress-image', cat: 'image', name: 'Compress image', desc: 'Smaller JPG, PNG, WebP and GIF files.', accepts: IMAGE_IN, suffix: '-compressed', ext: (o, files) => { const e = U.ext(files[0] || ''); return ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'tiff', 'tif'].includes(e) ? (e === 'jpeg' ? 'jpg' : e === 'tif' ? 'tiff' : e) : 'jpg'; },
    options: [level(), num('maxSide', 'Longest side (px)', '', { advanced: true, placeholder: 'Keep size' })], run: each((f, o, c) => img().compress(f, o, c)) },
  { id: 'resize-image', cat: 'image', name: 'Resize image', desc: 'Exact pixels or a percentage.', accepts: IMAGE_IN, suffix: '-resized', ext: (o, files) => keepExt(files[0]),
    options: [choice('mode', 'Resize by', [['pixels', 'Pixels'], ['percent', 'Percent']]), num('width', 'Width (px)', 1920, { when: { mode: 'pixels' } }), num('height', 'Height (px)', '', { when: { mode: 'pixels' }, placeholder: 'Auto' }), range('percent', 'Scale', 50, 5, 400, { unit: '%', when: { mode: 'percent' } }), toggle('noEnlarge', 'Don’t enlarge', true)],
    run: each((f, o, c) => img().resize(f, o, c)) },
  { id: 'crop-image', cat: 'image', name: 'Crop image', desc: 'Smart crop to a ratio, or exact pixels.', accepts: IMAGE_IN, suffix: '-cropped', ext: (o, files) => keepExt(files[0]),
    options: [select('aspect', 'Shape', [['1:1', 'Square'], ['4:5', 'Portrait 4:5'], ['3:2', 'Photo 3:2'], ['16:9', 'Wide 16:9'], ['9:16', 'Story 9:16'], ['custom', 'Exact pixels']]), toggle('smart', 'Keep the subject in frame', true, { when: { aspect: ['1:1', '4:5', '3:2', '16:9', '9:16'] } }), num('left', 'Left', 0, { when: { aspect: 'custom' } }), num('top', 'Top', 0, { when: { aspect: 'custom' } }), num('width', 'Width', 1000, { when: { aspect: 'custom' } }), num('height', 'Height', 1000, { when: { aspect: 'custom' } })],
    run: each((f, o, c) => img().crop(f, o, c)) },
  { id: 'remove-background', cat: 'image', name: 'Remove background', desc: 'Cut out the subject to a transparent PNG, on this computer.', tags: 'bg background cutout cut out transparent erase subject', accepts: IMAGE_IN, ext: 'png', suffix: '-cutout',
    options: [select('background', 'Background', [['transparent', 'Transparent'], ['#ffffff', 'White'], ['#000000', 'Black']])],
    run: each((f, o, c) => img().removeBackground(f, o, c)) },
  { id: 'upscale-image', cat: 'image', name: 'Upscale image', desc: 'Enlarge 2×, 3× or 4× with sharp detail.', accepts: IMAGE_IN, suffix: '-upscaled', ext: (o, files) => (keepExt(files[0]) === 'gif' ? 'png' : keepExt(files[0])),
    options: [choice('factor', 'Enlarge', [['2', '2×'], ['3', '3×'], ['4', '4×']], '2')], run: each((f, o, c) => img().upscale(f, { ...o, method: 'classic' }, c)) },
  { id: 'upscale-ai', cat: 'image', name: 'Upscale with AI', model: 'upscale', desc: 'Enlarge 2× or 4× and draw in fine detail, on this computer.', tags: 'ai enlarge bigger super resolution sharpen hd restore esrgan', accepts: IMAGE_IN, suffix: '-upscaled', ext: (o, files) => (keepExt(files[0]) === 'gif' ? 'png' : keepExt(files[0])),
    options: [choice('factor', 'Enlarge', [['2', '2×'], ['4', '4×']], '2'), choice('kind', 'Picture', [['photo', 'Photo'], ['drawing', 'Drawing']])], run: each((f, o, c) => lazy('ai')().upscale(f, o, c)) },
  { id: 'rotate-image', cat: 'image', name: 'Rotate & flip', desc: 'Rotate or mirror.', accepts: IMAGE_IN, suffix: '-rotated', ext: (o, files) => keepExt(files[0]),
    options: [choice('angle', 'Rotate', [['0', 'None'], ['90', '90° right'], ['180', '180°'], ['270', '90° left']], '90'), choice('flip', 'Flip', [['none', 'None'], ['horizontal', 'Mirror'], ['vertical', 'Upside down']])], run: each((f, o, c) => img().rotate(f, o, c)) },
  { id: 'adjust-image', cat: 'image', name: 'Adjust photo', desc: 'Brightness, contrast, colour and filters.', accepts: IMAGE_IN, suffix: '-edited', ext: (o, files) => keepExt(files[0]),
    options: [range('brightness', 'Brightness', 0, -100, 100), range('contrast', 'Contrast', 0, -100, 100), range('saturation', 'Saturation', 0, -100, 100), select('filter', 'Filter', [['none', 'None'], ['grayscale', 'Black & white'], ['sepia', 'Sepia'], ['vintage', 'Vintage'], ['invert', 'Invert']]), range('sharpen', 'Sharpen', 0, 0, 100), range('blur', 'Blur', 0, 0, 100)],
    run: each((f, o, c) => img().adjust(f, o, c)) },
  { id: 'watermark-image', cat: 'image', name: 'Watermark image', desc: 'Text or logo on photos.', accepts: IMAGE_IN, suffix: '-watermarked', ext: (o, files) => keepExt(files[0]),
    options: [choice('kind', 'Watermark', [['text', 'Text'], ['image', 'Logo']]), text('text', 'Text', '© Your name', { when: { kind: 'text' } }), file('image', 'Logo', [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }], { when: { kind: 'image' } }), choice('layout', 'Layout', [['single', 'Once'], ['tiled', 'Tiled']]), select('position', 'Position', [['bottom-right', 'Bottom right'], ['bottom-left', 'Bottom left'], ['top-right', 'Top right'], ['top-left', 'Top left'], ['center', 'Centre']], 'bottom-right', { when: { layout: 'single' } }), range('opacity', 'Opacity', 50, 5, 100, { unit: '%' }), { ...color('color', 'Colour', '#ffffff'), when: { kind: 'text' } }],
    run: each((f, o, c) => img().watermark(f, o, c)) },
  { id: 'meme', cat: 'image', name: 'Meme', desc: 'Bold outlined captions top and bottom, on photos or animated GIFs.', accepts: IMAGE_IN, suffix: '-meme', ext: (o, files) => keepExt(files[0]),
    options: [text('top', 'Top text', '', { placeholder: 'When the build passes' }), text('bottom', 'Bottom text', '', { placeholder: 'on the first try' })], run: each((f, o, c) => img().meme(f, o, c)) },
  { id: 'border-image', cat: 'image', name: 'Add border', desc: 'A coloured frame, rounded corners and a drop shadow.', accepts: IMAGE_IN, suffix: '-framed',
    ext: (o, files) => ((Number(o.radius) || o.shadow) && ['jpg', 'tiff'].includes(keepExt(files[0])) ? 'png' : keepExt(files[0])),
    options: [color('color', 'Colour', '#ffffff'), range('width', 'Width', 4, 0, 25, { unit: '%' }), range('radius', 'Rounded corners', 0, 0, 100, { unit: '%' }), toggle('shadow', 'Drop shadow', false)], run: each((f, o, c) => img().border(f, o, c)) },
  { id: 'blur-faces', cat: 'image', name: 'Blur faces', desc: 'Find faces on this computer and blur or pixelate them.', accepts: IMAGE_IN, suffix: '-faces-hidden', ext: (o, files) => keepExt(files[0]),
    options: [choice('mode', 'Effect', [['blur', 'Blur'], ['pixelate', 'Pixelate']]), range('strength', 'Strength', 60, 10, 100, { unit: '%' })], run: each((f, o, c) => img().blurFaces(f, o, c)) },
  { id: 'animation-speed', cat: 'image', name: 'Animation speed', desc: 'Play an animated GIF, WebP or APNG faster, slower or backwards.', accepts: [], extAccept: ['gif', 'webp', 'apng'], suffix: '-speed', ext: (o, files) => U.ext(files[0] || '') || 'gif',
    options: [select('speed', 'Speed', [['0.25', '0.25×'], ['0.5', '0.5×'], ['0.75', '0.75×'], ['1', 'Unchanged'], ['1.5', '1.5×'], ['2', '2×'], ['4', '4×']], '2'), toggle('reverse', 'Play backwards', false)], run: each((f, o, c) => img().animationSpeed(f, o, c)) },
  { id: 'strip-metadata', cat: 'image', name: 'Remove photo info', desc: 'Strip EXIF, GPS and camera data.', accepts: IMAGE_IN, suffix: '-clean', ext: (o, files) => keepExt(files[0]), run: each((f, o, c) => require('./engines/photoinfo').stripTool(f, c, () => img().strip(f, o, c))) },
  { id: 'collage', cat: 'image', name: 'Collage', desc: 'Photos in a neat grid.', accepts: IMAGE_IN, min: 2, ordered: true, ext: 'jpg', stem: 'Collage',
    options: [num('columns', 'Columns', '', { placeholder: 'Auto' }), range('gap', 'Spacing', 12, 0, 60, { unit: 'px' }), color('background', 'Background', '#ffffff')],
    run: async (files, o, c) => [await img().collage(files, o, c.out.file(files[0], 'Collage.jpg'))] },
  { id: 'images-to-gif', cat: 'image', name: 'Make GIF', desc: 'Animate images into a looping GIF.', accepts: IMAGE_IN, min: 2, ordered: true, ext: 'gif', stem: 'Animation',
    options: [range('seconds', 'Seconds each', 1, 1, 10, { unit: 's' }), num('width', 'Width (px)', 600)], run: async (files, o, c) => [await gif().fromImages(files, o, c)] },
  { id: 'image-to-text', cat: 'image', name: 'Image to text', desc: 'Copy the text out of screenshots, photos and scans.', accepts: IMAGE_IN, ext: 'txt',
    options: [select('lang', 'Language', LANGS)],
    run: each(async (f, o, c) => {
      c.progress(0.15, 'Reading text');
      const buf = ['jpg', 'jpeg', 'png', 'webp', 'tif', 'tiff', 'gif', 'bmp'].includes(U.ext(f)) ? await fsp.readFile(f) : await (await img().open(f)).rotate().png().toBuffer();
      const t = await require('./engines/ocr').imageToText(buf, o.lang || 'eng');
      const out = outFile('', 'txt')(f, c);
      await fsp.writeFile(out, `${t}\n`);
      const words = t.trim() ? t.trim().split(/\s+/).length : 0;
      return { path: out, note: words ? `${words} word${words === 1 ? '' : 's'} found` : 'No text found in this image.', text: t };
    }) },
  { id: 'images-to-cbz', cat: 'image', name: 'Make comic', desc: 'Pictures in order as a CBZ comic book.', accepts: IMAGE_IN, ordered: true, ext: 'cbz', run: async (files, o, c) => [await ebook().imagesToCbz(files, c)] },
  { id: 'screenshot-url', cat: 'image', name: 'Web page to image', desc: 'Full-length screenshot of a web page.', accepts: [], noFiles: true, ext: 'png',
    options: [text('url', 'Web address', '', { placeholder: 'https://example.com', required: true })], run: async (files, o, c) => [await office().urlToPdf(o.url, { format: 'png' }, c)] },

  { id: 'convert-video', cat: 'media', name: 'Convert video', desc: 'MP4, HEVC, MOV, WebM, MKV, AVI, WMV, MPG, GIF, APNG and audio.', accepts: ['video'], ext: mediaExt,
    options: [select('to', 'Convert to', [...VIDEO_OUT, ['mp3', 'MP3 audio'], ['m4a', 'M4A audio'], ['wav', 'WAV audio']]), choice('quality', 'Quality', [['high', 'High'], ['balanced', 'Balanced'], ['small', 'Small']], 'balanced'), select('height', 'Resolution', [['', 'Original'], ['2160', '4K'], ['1080', '1080p'], ['720', '720p'], ['480', '480p']], '', { when: { to: VIDEO_OUT.map(([v]) => v).filter((v) => !['vob', 'dv'].includes(v)) } })],
    run: each((f, o, c) => (o.to === 'gif' ? gif().fromVideo(f, o, c) : media().convertVideo(f, o, c))) },
  { id: 'compress-video', cat: 'media', name: 'Compress video', desc: 'Shrink for email, chat and uploads.', accepts: ['video'], ext: 'mp4', suffix: '-compressed',
    options: [choice('mode', 'Target', [['level', 'Quality'], ['size', 'File size']]), { ...level(), when: { mode: 'level' } }, num('targetMB', 'Target size (MB)', 25, { when: { mode: 'size' } }), select('height', 'Resolution', [['', 'Original'], ['1080', '1080p'], ['720', '720p'], ['480', '480p']])],
    run: each((f, o, c) => media().compressVideo(f, o, c)) },
  { id: 'trim-media', cat: 'media', name: 'Trim', desc: 'Cut a clip by start and end time.', accepts: ['video', 'audio'], suffix: '-trimmed',
    options: [{ key: 'start', type: 'time', label: 'Start', default: '0:00', required: true }, { key: 'end', type: 'time', label: 'End', default: '', placeholder: 'End of file' }, toggle('precise', 'Frame-accurate (slower)', false)],
    run: each((f, o, c) => media().trim(f, o, c)) },
  { id: 'merge-media', cat: 'media', name: 'Merge clips', desc: 'Join clips end to end.', accepts: ['video', 'audio'], min: 2, ordered: true, ext: (o, files) => (files.some((f) => U.groupOf(f) === 'video') ? 'mp4' : o.to || 'mp3'), suffix: ' - merged',
    options: [select('to', 'Audio format', [['mp3', 'MP3'], ['m4a', 'M4A'], ['wav', 'WAV'], ['flac', 'FLAC']])], run: async (files, o, c) => [await media().merge(files, o, c)] },
  { id: 'extract-audio', cat: 'media', name: 'Extract audio', desc: 'Save a video’s soundtrack.', accepts: ['video'], ext: mediaExt,
    options: AUDIO_OPTS('Format'), run: each((f, o, c) => media().extractAudio(f, o, c)) },
  { id: 'extract-subtitles', cat: 'media', name: 'Extract subtitles', desc: 'Save a video’s subtitle track as SRT, VTT or ASS.', accepts: ['video'], ext: (o) => o.to,
    options: [choice('to', 'Format', [['srt', 'SRT'], ['vtt', 'VTT'], ['ass', 'ASS']])], run: each((f, o, c) => media().extractSubtitles(f, o, c)) },
  { id: 'convert-audio', cat: 'media', name: 'Convert audio', desc: 'MP3, M4A, WAV, FLAC, ALAC, OGG, Opus, AIFF, WMA and more.', accepts: ['audio'], ext: mediaExt,
    options: AUDIO_OPTS('Convert to'), run: each((f, o, c) => media().convertAudio(f, o, c)) },
  { id: 'compress-audio', cat: 'media', name: 'Compress audio', desc: 'Lower bitrate, smaller file.', accepts: ['audio'], suffix: '-compressed', ext: (o, files) => (['mp3', 'm4a', 'ogg', 'opus', 'aac'].includes(U.ext(files[0] || '')) ? U.ext(files[0]) : 'mp3'), options: [level()], run: each((f, o, c) => media().compressAudio(f, o, c)) },
  { id: 'video-to-gif', cat: 'media', name: 'Video to GIF', desc: 'A moment as a crisp GIF.', accepts: ['video'], ext: 'gif',
    options: [{ key: 'start', type: 'time', label: 'Start', default: '0:00' }, num('duration', 'Seconds', 5), range('fps', 'Frames per second', 12, 5, 30), num('width', 'Width (px)', 480)],
    run: each((f, o, c) => gif().fromVideo(f, o, c)) },
  { id: 'gif-to-video', cat: 'media', name: 'GIF to video', desc: 'Turn an animated GIF into a much smaller MP4, WebM or MOV.', accepts: [], extAccept: ['gif'], ext: (o) => o.to,
    options: [choice('to', 'Convert to', [['mp4', 'MP4'], ['webm', 'WebM'], ['mov', 'MOV']]), choice('quality', 'Quality', [['high', 'High'], ['balanced', 'Balanced'], ['small', 'Small']], 'balanced')],
    run: each((f, o, c) => media().convertVideo(f, o, c)) },
  { id: 'mute-video', cat: 'media', name: 'Mute video', desc: 'Remove the sound, no re-encode.', accepts: ['video'], suffix: '-muted', run: each((f, o, c) => media().mute(f, o, c)) },
  { id: 'resize-video', cat: 'media', name: 'Resize video', desc: '4K, 1080p, 720p and more.', accepts: ['video'], suffix: '-resized',
    options: [select('height', 'Resolution', [['2160', '4K'], ['1080', '1080p'], ['720', '720p'], ['480', '480p'], ['360', '360p']], '720')], run: each((f, o, c) => media().resizeVideo(f, o, c)) },
  { id: 'rotate-video', cat: 'media', name: 'Rotate video', desc: 'Fix sideways or mirrored video.', accepts: ['video'], suffix: '-rotated',
    options: [choice('angle', 'Rotate', [['90', '90° right'], ['180', '180°'], ['270', '90° left']], '90'), choice('flip', 'Flip', [['none', 'None'], ['horizontal', 'Mirror'], ['vertical', 'Upside down']])], run: each((f, o, c) => media().rotateVideo(f, o, c)) },
  { id: 'speed-media', cat: 'media', name: 'Change speed', desc: 'Faster or slower, pitch kept.', accepts: ['video', 'audio'], suffix: '-speed',
    options: [select('factor', 'Speed', [['0.5', '0.5×'], ['0.75', '0.75×'], ['1.25', '1.25×'], ['1.5', '1.5×'], ['2', '2×'], ['3', '3×']], '1.5')], run: each((f, o, c) => media().speed(f, o, c)) },
  { id: 'video-frames', cat: 'media', name: 'Video to images', desc: 'Frames at an interval, a fixed count or every frame.', accepts: ['video'], save: 'folder', suffix: ' - frames',
    options: [choice('mode', 'Save', [['every', 'Every N seconds'], ['count', 'Fixed number'], ['all', 'Every frame']]), num('every', 'Seconds between', 1, { when: { mode: 'every' } }), num('count', 'Frames', 12, { when: { mode: 'count' } }), choice('format', 'Format', [['jpg', 'JPG'], ['png', 'PNG']])],
    run: each((f, o, c) => media().frames(f, o, c)) },
  { id: 'burn-subtitles', cat: 'media', name: 'Add subtitles', desc: 'Burn SRT, VTT, ASS, SAMI or other captions into video.', accepts: ['video'], suffix: '-subtitled',
    options: [file('subtitles', 'Subtitle file', [{ name: 'Subtitles', extensions: SUB_IN }], { required: true }), range('size', 'Text size', 22, 12, 48)],
    run: each(async (f, o, c) => {
      if (!o.subtitles) return media().burnSubtitles(f, o, c);
      const tmp = await U.tmpDir('subs');
      try { return await media().burnSubtitles(f, { ...o, subtitles: await subs().forFfmpeg(o.subtitles, tmp) }, c); } finally { fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
    }) },
  { id: 'normalize-audio', cat: 'media', name: 'Level loudness', desc: 'Even out volume to −16 LUFS.', accepts: ['audio', 'video'], suffix: '-normalized', run: each((f, o, c) => media().normalize(f, o, c)) },
  { id: 'volume-media', cat: 'media', name: 'Change volume', desc: 'Louder or quieter, without clipping.', accepts: ['audio', 'video'], suffix: '-volume',
    options: [choice('unit', 'Change by', [['db', 'Decibels'], ['percent', 'Percent']]), range('db', 'Volume', 6, -30, 30, { unit: 'dB', when: { unit: 'db' } }), range('percent', 'Volume', 150, 10, 400, { unit: '%', when: { unit: 'percent' } })],
    run: each((f, o, c) => media().volume(f, o, c)) },
  { id: 'fade-audio', cat: 'media', name: 'Fade in & out', desc: 'A smooth start and end for the sound.', accepts: ['audio', 'video'], suffix: '-faded',
    options: [num('fadeIn', 'Fade in (seconds)', 2, { min: 0 }), num('fadeOut', 'Fade out (seconds)', 2, { min: 0 })], run: each((f, o, c) => media().fade(f, o, c)) },
  { id: 'pitch-audio', cat: 'media', name: 'Change pitch', desc: 'Higher or lower, at the same speed.', accepts: ['audio', 'video'], suffix: '-pitch',
    options: [range('semitones', 'Semitones', 2, -12, 12)], run: each((f, o, c) => media().pitch(f, o, c)) },
  { id: 'loop-media', cat: 'media', name: 'Loop', desc: 'Play a clip several times in a row.', accepts: ['video', 'audio'], suffix: '-looped',
    options: [select('times', 'Play', [['2', '2 times'], ['3', '3 times'], ['4', '4 times'], ['5', '5 times'], ['10', '10 times']], '2')], run: each((f, o, c) => media().loop(f, o, c)) },
  { id: 'reverse-media', cat: 'media', name: 'Reverse', desc: 'Play video and sound backwards.', accepts: ['video', 'audio'], suffix: '-reversed', run: each((f, o, c) => media().reverse(f, o, c)) },
  { id: 'crop-video', cat: 'media', name: 'Crop video', desc: 'Square, portrait, story, wide or exact pixels.', accepts: ['video'], suffix: '-cropped',
    options: [select('aspect', 'Shape', [['1:1', 'Square'], ['4:5', 'Portrait 4:5'], ['9:16', 'Story 9:16'], ['16:9', 'Wide 16:9'], ['custom', 'Exact pixels']]), num('left', 'Left', 0, { when: { aspect: 'custom' } }), num('top', 'Top', 0, { when: { aspect: 'custom' } }), num('width', 'Width', 640, { when: { aspect: 'custom' } }), num('height', 'Height', 360, { when: { aspect: 'custom' } })],
    run: each((f, o, c) => media().cropVideo(f, o, c)) },
  { id: 'blur-video', cat: 'media', name: 'Blur area', desc: 'Hide a logo, face or number plate.', accepts: ['video'], suffix: '-blurred',
    options: [choice('mode', 'Effect', [['blur', 'Blur'], ['pixelate', 'Pixelate']]), num('left', 'Left', 20), num('top', 'Top', 20), num('width', 'Width', 200), num('height', 'Height', 100), range('strength', 'Strength', 60, 1, 100)],
    run: each((f, o, c) => media().blurArea(f, o, c)) },
  { id: 'add-audio', cat: 'media', name: 'Add audio to video', desc: 'Replace a video’s sound or mix in music.', accepts: ['video', 'audio'], min: 2, max: 2, suffix: '-with-audio', ext: (o, files) => U.ext(files.find((f) => U.groupOf(f) === 'video') || files[0] || ''),
    options: [choice('mode', 'Audio', [['replace', 'Replace'], ['mix', 'Mix with original']]), toggle('shortest', 'End with the shorter file', false)],
    run: async (files, o, c) => [await media().addAudio(files, o, c)] },
  { id: 'images-to-video', cat: 'media', name: 'Slideshow', desc: 'MP4 from photos, with optional music.', accepts: IMAGE_IN, min: 1, ordered: true, ext: 'mp4', stem: 'Slideshow',
    options: [range('seconds', 'Seconds each', 3, 1, 15, { unit: 's' }), select('size', 'Size', [['1920x1080', '1080p landscape'], ['1080x1920', '1080p portrait'], ['1080x1080', 'Square']]), file('audio', 'Music (optional)', [{ name: 'Audio', extensions: ['mp3', 'm4a', 'wav', 'aac', 'ogg', 'flac'] }])],
    run: async (files, o, c) => [await media().imagesToVideo(files, o, c)] },
  { id: 'convert-subtitles', cat: 'media', name: 'Convert subtitles', desc: 'SRT, VTT, ASS, SAMI, LRC, TTML, MicroDVD and SCC, in any encoding, to UTF-8.', accepts: ['subtitle'], ext: (o) => o.to,
    options: [select('to', 'Convert to', [['srt', 'SRT'], ['vtt', 'WebVTT'], ['ass', 'ASS'], ['smi', 'SAMI'], ['lrc', 'LRC'], ['ttml', 'TTML'], ['sub', 'MicroDVD']])], run: each((f, o, c) => subs().convert(f, o, c)) },
  { id: 'render-motion', cat: 'media', name: 'Render animation', desc: 'EffectCraft renders Lottie and EffectCraft projects to video.', accepts: ['motion'], craft: 'effectcraft', prio: 8, petal: ['Render', 'Video'], ext: (o) => o.to,
    options: [select('to', 'Render as', [['mp4', 'MP4'], ['gif', 'GIF'], ['webm', 'WebM'], ['mov', 'MOV (ProRes)']]), select('resolution', 'Resolution', [['full', 'Full'], ['half', 'Half'], ['quarter', 'Quarter']])],
    run: each((f, o, c) => craft().motion(f, o, c)) },
  { id: 'convert-timeline', cat: 'media', name: 'Convert timeline', desc: 'FilmCraft converts and renders editing timelines.', accepts: ['timeline'], craft: 'filmcraft', prio: 20, petal: ['Convert', 'Timeline'], ext: (o) => o.to,
    options: [select('to', 'Convert to', [['mp4', 'MP4 (render)'], ['fcpxml', 'Final Cut (FCPXML)'], ['xml', 'Premiere / Resolve (XML)'], ['otio', 'OpenTimelineIO'], ['edl', 'EDL'], ['aaf', 'Avid (AAF)']])],
    run: each((f, o, c) => craft().timeline(f, o, c)) },

  { id: 'convert-document', cat: 'docs', name: 'Convert document', desc: 'PDF, Word, Markdown, HTML, EPUB, RTF, text and more.', accepts: ['doc', 'data'], ext: (o) => o.to,
    options: [select('to', 'Convert to', [['pdf', 'PDF'], ['docx', 'Word (DOCX)'], ['md', 'Markdown'], ['html', 'Web page'], ['txt', 'Plain text'], ['epub', 'eBook (EPUB)'], ['rtf', 'Rich text (RTF)'], ['odt', 'OpenDocument']]),
      ...DOC_PRINT.map((o) => ({ ...o, when: { to: ['pdf'], ...o.when } }))],
    run: each((f, o, c) => office().convertDocument(f, o, c)) },
  { id: 'convert-ebook', cat: 'docs', name: 'Convert e-book', desc: 'EPUB, Kobo, MOBI, AZW3 and FB2 to PDF, Word, text and more.', accepts: ['ebook'], ext: (o) => (o.to === 'kepub' ? 'kepub.epub' : o.to),
    options: [select('to', 'Convert to', [['epub', 'EPUB'], ['kepub', 'Kobo (KEPUB)'], ['pdf', 'PDF'], ['docx', 'Word (DOCX)'], ['txt', 'Plain text'], ['md', 'Markdown'], ['html', 'Web page'], ['fb2', 'FictionBook (FB2)'], ['htmlz', 'HTMLZ'], ['txtz', 'TXTZ']])],
    run: each((f, o, c) => ebook().convert(f, o, c)) },
  { id: 'convert-comic', cat: 'docs', name: 'Convert comic', desc: 'CBZ, CBR, CB7, CBT and CBC to PDF, EPUB, CBZ or pictures.', accepts: ['comic'], ext: (o) => o.to, folderWhen: { to: 'images' }, suffix: '',
    options: [select('to', 'Convert to', [['pdf', 'PDF'], ['epub', 'EPUB (fixed layout)'], ['cbz', 'CBZ'], ['images', 'Pictures (folder)']])], run: each((f, o, c) => ebook().convertComic(f, o, c)) },
  { id: 'convert-sheet', cat: 'docs', name: 'Convert spreadsheet', desc: 'XLSX, CSV, JSON, HTML, ODS and PDF.', accepts: ['sheet'], ext: (o) => o.to,
    options: [select('to', 'Convert to', [['xlsx', 'Excel (XLSX)'], ['csv', 'CSV'], ['pdf', 'PDF'], ['json', 'JSON'], ['html', 'HTML'], ['ods', 'OpenDocument'], ['md', 'Markdown'], ['xls', 'Excel 97']]), toggle('allSheets', 'Every sheet (CSV, JSON)', true, { when: { to: ['csv', 'tsv', 'json'] } }),
      ...PRINT_OPTS.map((o) => ({ ...o, when: { to: ['pdf'], ...o.when } }))],
    run: each((f, o, c) => office().convertSheet(f, o.to, c, o)) },
  { id: 'convert-slides', cat: 'docs', name: 'Convert slides', desc: 'PowerPoint and Keynote to PDF, images, HTML and text.', accepts: ['slides'], ext: (o) => o.to, folderWhen: { to: 'png' }, suffix: '',
    options: [select('to', 'Convert to', [['pdf', 'PDF'], ['png', 'Images (PNG)'], ['html', 'Web page'], ['txt', 'Text'], ['md', 'Markdown'], ['pptx', 'PowerPoint']]),
      ...SLIDE_PRINT.map((o) => ({ ...o, when: { to: ['pdf'], ...o.when } }))],
    run: each((f, o, c) => office().convertSlides(f, o.to, c, o)) },
  { id: 'convert-data', cat: 'docs', name: 'Convert data', desc: 'JSON, YAML, TOML, XML, JSON Lines and CSV into each other.', accepts: ['data'], extAccept: ['csv', 'tsv'], ext: (o) => o.to,
    options: [select('to', 'Convert to', [['json', 'JSON'], ['yaml', 'YAML'], ['toml', 'TOML'], ['xml', 'XML'], ['jsonl', 'JSON Lines'], ['csv', 'CSV'], ['xlsx', 'Excel (XLSX)']])], run: each((f, o, c) => data().convert(f, o, c)) },
  { id: 'convert-contacts', cat: 'docs', name: 'Convert contacts', desc: 'vCard to CSV, Excel or JSON, and contact lists to vCard.', accepts: ['contacts'], extAccept: ['csv', 'tsv', 'xlsx', 'xls', 'ods'], ext: (o) => o.to,
    options: [select('to', 'Convert to', [['csv', 'CSV'], ['xlsx', 'Excel (XLSX)'], ['json', 'JSON'], ['vcf', 'vCard']])], run: each((f, o, c) => data().convert(f, o, c)) },
  { id: 'json-to-sheet', cat: 'docs', name: 'JSON to spreadsheet', desc: 'Turn JSON arrays into a table.', accepts: [], extAccept: ['json'], ext: (o) => o.to,
    options: [select('to', 'Convert to', [['xlsx', 'Excel'], ['csv', 'CSV'], ['html', 'HTML'], ['md', 'Markdown']])], run: each((f, o, c) => office().convertSheet(f, o.to, c, o)) },
  { id: 'merge-documents', cat: 'docs', name: 'Merge into one PDF', desc: 'Documents, sheets, slides, drawings, PDFs and images.', accepts: ['doc', 'sheet', 'slides', 'pdf', 'image', 'raw', 'vector', 'cad2d', 'layout', 'ebook'], min: 2, ordered: true, ext: 'pdf', suffix: ' - combined',
    run: async (files, o, c) => {
      const tmp = await U.tmpDir('mergedocs');
      const list = [];
      for (let i = 0; i < files.length; i++) { c.progress((i / files.length) * 0.85, `Converting ${path.basename(files[i])}`); list.push(await anyToPdf(files[i], { ...c, progress: () => {} }, path.join(tmp, `${i}.pdf`))); }
      const out = c.out.file(files[0], `${U.base(files[0])} - combined.pdf`);
      await pdf().merge(list, out, { progress: (f) => c.progress(0.85 + f * 0.15, 'Merging') });
      fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
      return [out];
    } },
  { id: 'merge-sheets', cat: 'docs', name: 'Merge spreadsheets', desc: 'One workbook, or stacked rows.', accepts: ['sheet'], min: 2, ordered: true, ext: 'xlsx', stem: 'Merged workbook',
    options: [choice('mode', 'How', [['sheets', 'Sheet per file'], ['stack', 'Stack rows']]), toggle('skipHeaders', 'Keep one header row', true, { when: { mode: 'stack' } })],
    run: async (files, o, c) => [await office().mergeSheets(files, o, c)] },
  { id: 'compare-docs', cat: 'docs', name: 'Compare documents', desc: 'What changed between two versions, as tracked changes in Word or a marked-up PDF. Put the older one first.', accepts: ['doc'], min: 2, max: 2, ordered: true,
    ext: (o) => (o.output === 'pdf' ? 'pdf' : 'docx'), outName: (files, o) => `${U.base(files[1] || files[0])} - compared.${o.output === 'pdf' ? 'pdf' : 'docx'}`,
    options: [choice('output', 'Result', [['docx', 'Word with tracked changes'], ['pdf', 'Marked-up PDF']]), choice('level', 'Compare by', [['word', 'Word'], ['char', 'Character']]), toggle('ignoreCase', 'Ignore changes of case', false),
      text('author', 'Changes by', '', { advanced: true, placeholder: 'The newer version’s author' })],
    run: async (files, o, c) => [await word().compare(files, o, c)] },
  { id: 'track-changes', cat: 'docs', name: 'Accept or reject changes', desc: 'Accept or reject every tracked change in a Word or OpenDocument file.', accepts: [], extAccept: [...WORD_IN, 'odt'],
    ext: (o, files) => U.ext(files[0] || 'x.docx'), outName: sameExt((o) => (o.action === 'reject' ? '-rejected' : '-accepted')),
    options: [choice('action', 'Changes', [['accept', 'Accept all'], ['reject', 'Reject all']]), toggle('stopTracking', 'Stop tracking changes', true, { advanced: true })], run: each((f, o, c) => word().trackChanges(f, o, c)) },
  { id: 'mail-merge', cat: 'docs', name: 'Mail merge', desc: 'A letter for each row of a spreadsheet: fills «Name» or {{Name}} and Word’s merge fields.', accepts: [], extAccept: WORD_IN, save: 'folder', suffix: ' - merged',
    single: (o) => o.combine === 'one', ext: (o) => (o.to === 'pdf' ? 'pdf' : 'docx'), outName: (files, o) => `${U.base(files[0])} - merged.${o.to === 'pdf' ? 'pdf' : 'docx'}`,
    options: [file('data', 'Names and details (CSV or Excel)', [SHEETS], { required: true }), choice('to', 'Save as', [['docx', 'Word'], ['pdf', 'PDF']]), choice('combine', 'Output', [['each', 'A file for each row'], ['one', 'One file']]),
      text('name', 'File names', '', { placeholder: '{FirstName} {LastName}', when: { combine: 'each' } })],
    run: each((f, o, c) => word().mailMerge(f, o, c)) },
  { id: 'doc-stats', cat: 'docs', name: 'Document statistics', desc: 'Words, characters, pages, reading time and readability.', accepts: ['doc'], extAccept: [...PPTX_IN, 'odp'], save: 'none',
    options: [toggle('save', 'Save a report', false)], run: each((f, o, c) => word().stats(f, o, c)) },
  { id: 'split-doc', cat: 'docs', name: 'Split at headings', desc: 'One Word file for each chapter, cut at the headings you choose.', accepts: ['doc'], save: 'folder', suffix: ' - parts',
    options: [choice('level', 'Split at', [['1', 'Heading 1'], ['2', 'Heading 2'], ['3', 'Heading 3']], '1')], run: each((f, o, c) => word().splitDoc(f, o, c)) },
  { id: 'watermark-doc', cat: 'docs', name: 'Watermark document', desc: 'A watermark like DRAFT or CONFIDENTIAL on every page of a Word file, and page numbers.', accepts: [], extAccept: WORD_IN,
    ext: (o, files) => U.ext(files[0] || 'x.docx'), outName: sameExt('-watermarked'),
    options: [text('text', 'Watermark', 'CONFIDENTIAL'), color('color', 'Colour', '#c0c0c0'), choice('layout', 'Layout', [['diagonal', 'Diagonal'], ['horizontal', 'Horizontal']]), range('opacity', 'Opacity', 50, 10, 100, { unit: '%' }),
      toggle('pageNumbers', 'Page numbers', false), choice('numberAlign', 'Numbers', [['center', 'Centre'], ['right', 'Right']], 'center', { when: { pageNumbers: true } })],
    run: each((f, o, c) => word().watermark(f, o, c)) },
  { id: 'replace-text', cat: 'docs', name: 'Find and replace', desc: 'Replace words in Word, Excel, PowerPoint and OpenDocument files, keeping their formatting.', accepts: [], extAccept: [...OFFICE_IN, 'txt', 'md', 'csv', 'tsv', 'html', 'htm'],
    ext: (o, files) => U.ext(files[0] || 'x.docx'), outName: sameExt('-replaced'),
    options: [text('find', 'Find', '', { required: true }), text('replace', 'Replace with', ''), toggle('matchCase', 'Match case', false), toggle('wholeWords', 'Whole words only', false),
      toggle('regex', 'Regular expression', false, { advanced: true }), toggle('everywhere', 'Headers, footers and notes too', true, { advanced: true })],
    run: each((f, o, c) => kit().replaceText(f, o, c)) },
  { id: 'clean-office', cat: 'docs', name: 'Remove personal info', desc: 'Comments, authors, editing history, hidden text and custom data, like Office’s Document Inspector.', accepts: [], extAccept: OFFICE_IN,
    ext: (o, files) => U.ext(files[0] || 'x.docx'), outName: sameExt('-clean'),
    options: [toggle('comments', 'Comments', true), toggle('properties', 'Authors and personal details', true), toggle('hidden', 'Hidden text and shapes', true), toggle('notes', 'Speaker notes', false)],
    run: each((f, o, c) => kit().clean(f, o, c)) },
  { id: 'office-media', cat: 'docs', name: 'Extract media', desc: 'Every picture, video and sound inside a Word, Excel or PowerPoint file, in order.', accepts: [], extAccept: OFFICE_IN, save: 'folder', suffix: ' - media',
    options: [choice('what', 'Save', [['pictures', 'Pictures'], ['media', 'Pictures, video and sound'], ['all', 'Everything inside']], 'media')], run: each((f, o, c) => kit().extractMedia(f, o, c)) },
  { id: 'compress-office', cat: 'docs', name: 'Compress Office file', desc: 'Smaller Word, Excel and PowerPoint files: the pictures inside are resized and recompressed.', accepts: [], extAccept: OFFICE_IN,
    ext: (o, files) => U.ext(files[0] || 'x.docx'), outName: sameExt('-compressed'),
    options: [choice('size', 'Pictures up to', [['2400', '2400 px (print)'], ['1600', '1600 px (screen)'], ['1024', '1024 px (e-mail)']], '1600'), range('quality', 'JPEG quality', 80, 40, 95, { unit: '%' })],
    run: each((f, o, c) => kit().compressPictures(f, o, c)) },
  { id: 'sheet-values', cat: 'docs', name: 'Formulas to values', desc: 'Keep what every formula shows, without the formulas.', accepts: [], extAccept: [...XLSX_IN, 'ods'],
    ext: (o, files) => U.ext(files[0] || 'x.xlsx'), outName: sameExt('-values'), run: each((f, o, c) => excel().toValues(f, o, c)) },
  { id: 'unhide-sheet', cat: 'docs', name: 'Unhide & unprotect', desc: 'Show hidden sheets, rows and columns, and lift sheet protection that has no password.', accepts: [], extAccept: [...XLSX_IN, 'ods'],
    ext: (o, files) => U.ext(files[0] || 'x.xlsx'), outName: sameExt('-unhidden'),
    options: [toggle('sheets', 'Hidden sheets', true), toggle('rows', 'Hidden rows and columns', true), toggle('protection', 'Protection without a password', true)], run: each((f, o, c) => excel().unhide(f, o, c)) },
  { id: 'split-sheets', cat: 'docs', name: 'Split workbook', desc: 'A workbook for each sheet, with its formatting.', accepts: [], extAccept: [...XLSX_IN, 'ods'], save: 'folder', suffix: ' - sheets',
    options: [toggle('hidden', 'Hidden sheets too', false), toggle('values', 'Formulas using other sheets become values', true)], run: each((f, o, c) => excel().splitSheets(f, o, c)) },
  { id: 'tidy-sheet', cat: 'docs', name: 'Tidy rows', desc: 'Remove duplicate and empty rows and trim extra spaces; formulas keep pointing at the right cells.', accepts: [], extAccept: [...XLSX_IN, 'ods', 'xls', 'xlsb', 'csv', 'tsv'],
    ext: (o, files) => U.ext(files[0] || 'x.xlsx'), outName: sameExt('-tidy'),
    options: [toggle('dedupe', 'Remove duplicate rows', true), toggle('emptyRows', 'Remove empty rows', true), toggle('trim', 'Trim spaces', true), toggle('header', 'First row is a header', true)],
    run: each((f, o, c) => excel().tidy(f, o, c)) },
  { id: 'sheet-formulas', cat: 'docs', name: 'Check formulas', desc: 'Every formula and error, like #REF! and #DIV/0!, and where it is.', accepts: [], extAccept: [...XLSX_IN, 'ods', 'xls', 'xlsb'], save: 'none',
    options: [toggle('save', 'Save the list as a spreadsheet', false)], run: each((f, o, c) => excel().formulas(f, o, c)) },
  { id: 'slide-notes', cat: 'docs', name: 'Speaker notes', desc: 'Notes and slide text as a Word document, Markdown or text, for a script or handout.', accepts: [], extAccept: [...PPTX_IN, 'odp'],
    ext: (o) => o.to || 'docx', outName: (files, o) => `${U.base(files[0])} - ${o.include === 'outline' ? 'outline' : 'notes'}.${o.to || 'docx'}`,
    options: [select('to', 'Save as', [['docx', 'Word'], ['md', 'Markdown'], ['txt', 'Text']]), choice('include', 'Include', [['notes', 'Notes'], ['both', 'Slides and notes'], ['outline', 'Slide text']], 'both')],
    run: each((f, o, c) => slides().exportNotes(f, o, c)) },
  { id: 'merge-slides', cat: 'docs', name: 'Merge presentations', desc: 'One deck from several, each slide keeping its design or taking the first deck’s.', accepts: [], extAccept: PPTX_IN, min: 2, ordered: true,
    ext: (o, files) => U.ext(files[0] || 'x.pptx'), outName: sameExt(' - merged'),
    options: [choice('design', 'Design', [['keep', 'Keep each deck’s'], ['first', 'Use the first deck’s']])], run: async (files, o, c) => [await slides().mergeDecks(files, o, c)] },
  { id: 'pick-slides', cat: 'docs', name: 'Pick slides', desc: 'Keep, reorder or drop slides, and take out hidden ones.', accepts: [], extAccept: PPTX_IN,
    ext: (o, files) => U.ext(files[0] || 'x.pptx'), outName: sameExt('-slides'),
    options: [pages('slides', 'Slides to keep, in order', 'all', { placeholder: '3, 1-2, 5-' }), toggle('dropHidden', 'Remove hidden slides', true)], run: each((f, o, c) => slides().pickSlides(f, o, c)) },
  { id: 'convert-layout', cat: 'docs', name: 'Convert layout', desc: 'DesignCraft exports InDesign IDML and INDD to PDF, images, EPUB or PowerPoint.', accepts: ['layout'], craft: 'designcraft', prio: 8, petal: ['Export', 'PDF & more'], ext: (o) => o.to, folderWhen: { to: 'png' }, suffix: '',
    options: [select('to', 'Export as', [['pdf', 'PDF'], ['png', 'Page images'], ['epub', 'EPUB'], ['pptx', 'PowerPoint'], ['idml', 'IDML']])], run: each((f, o, c) => craft().layout(f, o, c)) },

  { id: 'convert-email', cat: 'docs', name: 'Convert e-mail', desc: 'EML and Outlook MSG to PDF, a web page or text, safely offline.', accepts: ['mail'], ext: (o) => o.to,
    options: [select('to', 'Convert to', [['pdf', 'PDF'], ['html', 'Web page'], ['txt', 'Plain text'], ['eml', 'EML (from Outlook MSG)']])], run: each((f, o, c) => email().convert(f, o, c)) },
  { id: 'email-attachments', cat: 'docs', name: 'Save attachments', desc: 'Every file attached to an e-mail, in a folder.', accepts: ['mail'], save: 'folder', suffix: ' - attachments',
    run: each((f, o, c) => email().convert(f, { to: 'attachments' }, c)) },
  { id: 'convert-mhtml', cat: 'docs', name: 'Convert web archive', desc: 'MHT and MHTML pages to one self-contained page, PDF or text.', accepts: ['webarchive'], ext: (o) => o.to,
    options: [select('to', 'Convert to', [['pdf', 'PDF'], ['html', 'Web page'], ['txt', 'Plain text']])], run: each((f, o, c) => email().convert(f, o, c)) },
  { id: 'convert-font', cat: 'docs', name: 'Convert font', desc: 'TTF, OTF, WOFF, WOFF2 and EOT, every table kept.', accepts: ['font'], ext: (o) => o.to,
    options: [select('to', 'Convert to', [['woff2', 'WOFF2 (web)'], ['woff', 'WOFF'], ['ttf', 'TrueType (TTF)'], ['otf', 'OpenType (OTF)'], ['eot', 'EOT (old IE)']])],
    run: each((f, o, c) => fonts().convert(f, o, c)) },
  { id: 'font-info', cat: 'docs', name: 'Font info', desc: 'Family, style, glyphs, characters and embedding rights.', accepts: ['font'], save: 'none',
    options: [toggle('save', 'Save a report', false)], run: each((f, o, c) => fonts().report(f, o, c)) },

  { id: 'convert-vector', cat: 'cad', name: 'Convert vector', desc: 'VectorCraft converts AI, EPS, SVG, PDF, DXF, EMF and Affinity files.', accepts: ['vector'], extAccept: ['svg', 'svgz', 'pdf', 'dxf'], craft: 'vectorcraft', prio: 8, petal: ['Convert', 'Format'], ext: (o) => o.to,
    options: [select('to', 'Convert to', [['svg', 'SVG'], ['pdf', 'PDF'], ['ai', 'Illustrator (AI)'], ['eps', 'EPS'], ['png', 'PNG'], ['dxf', 'DXF'], ['emf', 'EMF'], ['psd', 'Photoshop (PSD)']]), num('scale', 'Image scale', 2, { when: { to: ['png', 'psd'] }, min: 1 }), toggle('outlineText', 'Text as outlines', false, { when: { to: 'svg' }, advanced: true })],
    run: each((f, o, c) => craft().vector(f, o, c)) },
  { id: 'convert-cad', cat: 'cad', name: 'Convert drawing', desc: 'DWG and DXF to PDF, SVG, PNG, DXF (2000 or R12), AI or EPS.', accepts: ['cad2d'], ext: (o) => o.to,
    options: [select('to', 'Convert to', CAD2D_OUT), select('sheet', 'PDF sheet', [['a3', 'A3'], ['a4', 'A4'], ['tabloid', 'Tabloid'], ['letter', 'Letter']], 'a3', { when: { to: 'pdf' } }), select('dxf', 'DXF version', [['r2000', 'AutoCAD 2000'], ['r12', 'R12, for older machines']], 'r2000', { when: { to: 'dxf' } }), toggle('mono', 'Black lines', false), num('size', 'Image width (px)', 3000, { when: { to: ['png', 'jpg'] } })],
    run: each((f, o, c) => cad().convert(f, o, c)) },
  { id: 'convert-model', cat: 'cad', name: 'Convert 3D model', desc: 'STEP, IGES, BREP, STL, OBJ, FBX, GLB, 3MF, PLY and more, with units.', accepts: ['cad3d'], ext: (o) => o.to,
    options: [select('to', 'Convert to', CAD3D_OUT), toggle('ascii', 'Text STL (ASCII)', false, { when: { to: 'stl' } }), toggle('refine', 'Merge flat faces', true, { when: { to: ['step', 'iges', 'brep'] }, advanced: true }),
      select('units', 'Units', MODEL_UNITS, 'mm', { when: { to: UNIT_OUT }, advanced: true }), ...PLACE_OPTS, toggle('repair', 'Repair mesh', false, { advanced: true }), range('keep', 'Triangles kept (%)', 100, 1, 100, { advanced: true })],
    run: each((f, o, c) => cad().convert(f, o, c)) },
  { id: 'model-drawing', cat: 'cad', name: 'Make drawing', desc: 'Front, top, side and 3D views on a sheet, with hidden lines, a scale and a title block.', accepts: ['cad3d'], suffix: ' - drawing', ext: (o) => o.to,
    options: [select('to', 'Save as', [['pdf', 'PDF'], ['svg', 'SVG'], ['dxf', 'DXF'], ['png', 'PNG']]), select('views', 'Views', [['four', 'Front, top, side and 3D'], ['three', 'Front, top and side'], ['front', 'Front only'], ['iso', '3D only']]),
      toggle('hidden', 'Hidden lines', true), select('sheet', 'Sheet', [['a3', 'A3'], ['a4', 'A4'], ['a2', 'A2'], ['a1', 'A1'], ['tabloid', 'Tabloid'], ['letter', 'Letter']], 'a3'),
      select('scale', 'Scale', [['', 'Largest that fits'], ['1', '1:1'], ['0.5', '1:2'], ['0.2', '1:5'], ['0.1', '1:10'], ['0.05', '1:20'], ['2', '2:1'], ['5', '5:1']], ''),
      select('angle', 'Projection', [['first', 'First angle (ISO)'], ['third', 'Third angle (US)']], 'first', { advanced: true }), text('title', 'Title', '', { advanced: true, placeholder: 'The file name' })],
    run: each((f, o, c) => cad().drawing(f, o, c)) },
  { id: 'repair-model', cat: 'cad', name: 'Repair mesh', desc: 'Merges doubled points, removes broken and doubled triangles and turns every triangle outwards.', accepts: ['cad3d'], suffix: '-repaired', ext: (o, files) => sameModel(files),
    run: each((f, o, c) => cad().repairModel(f, o, c)) },
  { id: 'simplify-model', cat: 'cad', name: 'Simplify model', desc: 'Fewer triangles in the same shape, for big scans and slow prints.', accepts: ['cad3d'], suffix: '-simplified', ext: (o, files) => sameModel(files),
    options: [range('keep', 'Triangles kept (%)', 50, 1, 99)], run: each((f, o, c) => cad().simplifyModel(f, o, c)) },
  { id: 'merge-models', cat: 'cad', name: 'Merge models', desc: 'Several 3D models in one file, each keeping its colours.', accepts: ['cad3d'], min: 2, ordered: true, suffix: ' - merged', ext: (o) => o.to,
    options: [select('to', 'Save as', MERGE_OUT), toggle('arrange', 'Side by side', false), select('units', 'Units', MODEL_UNITS, 'mm', { when: { to: ['stl', 'step', 'obj', '3mf', 'ply'] }, advanced: true })], run: async (files, o, c) => [await cad().mergeModels(files, o, c)] },
  { id: 'cad-info', cat: 'cad', name: 'Measure', desc: 'Size, area, volume, layers and entity counts.', accepts: ['cad2d', 'cad3d'], save: 'none',
    options: [toggle('save', 'Save a report', false)], run: each((f, o, c) => cad().report(f, o, c)) },

  { id: 'extract-archive', cat: 'archive', name: 'Extract', desc: 'ZIP, RAR, 7Z, TAR, GZ, ISO and 40 more.', accepts: ['archive'], save: 'folder', suffix: '',
    options: [password('password', 'Password, if any')], run: each((f, o, c) => arc().extract(f, o, c)) },
  { id: 'create-archive', cat: 'archive', name: 'Compress', desc: 'ZIP, 7Z, TAR, TAR.GZ, TAR.XZ, TAR.BZ2, or GZ for one file.', accepts: ['any'], ext: (o) => o.format || 'zip', suffix: '',
    options: [select('format', 'Format', ARCHIVE_OUT), range('level', 'Level', 5, 0, 9), password('password', 'Password (optional)', { when: { format: ['zip', '7z'] } })],
    run: async (files, o, c) => [await arc().compress(files, o, c)] },
  { id: 'convert-archive', cat: 'archive', name: 'Convert archive', desc: 'Repack as ZIP, 7Z, TAR, TAR.GZ, TAR.XZ or TAR.BZ2.', accepts: ['archive'], ext: (o) => o.format,
    options: [select('format', 'Convert to', ARCHIVE_OUT), password('password', 'Password, if any', { advanced: true })], run: each((f, o, c) => arc().convert(f, o, c)) },
  { id: 'decompress-file', cat: 'archive', name: 'Decompress', desc: 'Unpack the one file inside a .gz, .bz2, .xz, .lzma, .z or .zst.', accepts: [], extAccept: SINGLE_IN, outName: (files) => path.basename(files[0]).replace(/\.[^.]+$/, (e) => (/^\.t(gz|bz2?|xz|zst)$/i.test(e) ? '.tar' : '')),
    options: [password('password', 'Password, if any', { advanced: true })], run: each((f, o, c) => arc().decompress(f, o, c)) },
  { id: 'test-archive', cat: 'archive', name: 'Test archive', desc: 'Check for damage without extracting.', accepts: ['archive'], save: 'none', options: [password('password', 'Password, if any')], run: each((f, o) => arc().test(f, o)) },

  { id: 'file-hash', cat: 'utility', name: 'Checksums', desc: 'MD5, SHA-1, SHA-256 and SHA-512.', accepts: ['any'], save: 'none',
    options: [{ key: 'algos', type: 'multi', label: 'Algorithms', choices: [['md5', 'MD5'], ['sha1', 'SHA-1'], ['sha256', 'SHA-256'], ['sha512', 'SHA-512']], default: ['sha256'] }, text('expected', 'Compare with', '', { placeholder: 'Paste a published checksum' })],
    run: each(async (f, o) => {
      const lines = [];
      for (const a of o.algos?.length ? o.algos : ['sha256']) lines.push(`${a.toUpperCase().replace('SHA', 'SHA-')}  ${await U.hashFile(f, a)}`);
      const exp = String(o.expected || '').trim().toLowerCase();
      const match = exp ? lines.some((l) => l.toLowerCase().endsWith(exp)) : null;
      return { note: match === null ? lines.join('\n') : match ? '✓ Checksum matches' : '✗ Checksum does not match', text: lines.join('\n') };
    }) },
  { id: 'rename-files', cat: 'utility', name: 'Batch rename', desc: 'Rename with a pattern and numbering.', accepts: ['any'], ordered: true, save: 'inplace',
    options: [text('pattern', 'New name', '{name}', { placeholder: '{name} {n} {date}' }), num('start', 'Start at', 1), num('digits', 'Digits', 2), select('case', 'Case', [['keep', 'Keep'], ['lower', 'lowercase'], ['upper', 'UPPERCASE'], ['title', 'Title Case']]), text('find', 'Find', '', { advanced: true }), text('replace', 'Replace with', '', { advanced: true })],
    run: async (files, o) => {
      const out = [];
      const date = new Date().toISOString().slice(0, 10);
      for (let i = 0; i < files.length; i++) {
        const f = files[i], e = path.extname(f);
        let name = String(o.pattern || '{name}').replace(/\{name\}/g, U.base(f)).replace(/\{n\}/g, String((Number(o.start) || 1) + i).padStart(Number(o.digits) || 1, '0')).replace(/\{date\}/g, date).replace(/\{ext\}/g, e.slice(1));
        if (o.find) name = name.split(o.find).join(o.replace || '');
        if (o.case === 'lower') name = name.toLowerCase();
        if (o.case === 'upper') name = name.toUpperCase();
        if (o.case === 'title') name = name.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
        const target = path.join(path.dirname(f), U.sanitize(name) + e);
        const final = target === f ? f : U.uniquePath(target);
        if (final !== f) await fsp.rename(f, final);
        out.push(final);
      }
      return [{ path: out[0], paths: out, note: `Renamed ${out.length} file${out.length === 1 ? '' : 's'}`, inPlace: true }];
    } },
  { id: 'auto-tone', cat: 'image', name: 'Auto tone', desc: 'PhotoCraft fixes dull, flat or colour-cast photos.', accepts: [], extAccept: PHOTO_EXT, craft: 'photocraft', prio: 10, petal: ['Auto tone', 'Fix colour'], ext: photoExt, suffix: '-autotone', run: each((f, o, c) => craft().autoTone(f, o, c)) },
  { id: 'sharpen-photo', cat: 'image', name: 'Sharpen', desc: 'PhotoCraft Smart Sharpen brings back crisp detail.', accepts: [], extAccept: PHOTO_EXT, craft: 'photocraft', prio: 12, petal: ['Sharpen', 'Detail'], ext: photoExt, suffix: '-sharpened',
    options: [range('amount', 'Amount', 120, 50, 300, { unit: '%', advanced: true }), range('radius', 'Radius', 1.5, 0.5, 3, { step: 0.1, unit: 'px', advanced: true })], run: each((f, o, c) => craft().sharpenPhoto(f, o, c)) },
  { id: 'denoise-photo', cat: 'image', name: 'Reduce noise', desc: 'PhotoCraft removes grain and JPEG blocks.', accepts: [], extAccept: PHOTO_EXT, craft: 'photocraft', prio: 14, petal: ['Denoise', 'Grain'], ext: photoExt, suffix: '-denoised',
    options: [range('strength', 'Strength', 10, 1, 10, { advanced: true })], run: each((f, o, c) => craft().denoisePhoto(f, o, c)) },
  { id: 'lift-shadows', cat: 'image', name: 'Lift shadows', desc: 'PhotoCraft brightens dark areas and keeps the sky.', accepts: [], extAccept: PHOTO_EXT, craft: 'photocraft', prio: 16, petal: ['Shadows', 'Lift'], ext: photoExt, suffix: '-shadows',
    options: [range('amount', 'Amount', 50, 0, 100, { unit: '%', advanced: true })], run: each((f, o, c) => craft().liftShadows(f, o, c)) },
  { id: 'paint-photo', cat: 'image', name: 'Paint look', desc: 'Oil, watercolour, poster, ink or coloured pencil, by PhotoCraft.', accepts: [], extAccept: PHOTO_EXT, craft: 'photocraft', prio: 18, petal: ['Paint', 'Looks'], ext: photoExt, outName: (files, o) => `${U.base(files[0])}-${o.look || 'oil'}.${photoExt(o, files)}`,
    options: [choice('look', 'Look', [['oil', 'Oil'], ['watercolor', 'Watercolour'], ['poster', 'Poster'], ['ink', 'Ink'], ['pencil', 'Pencil']])], run: each((f, o, c) => craft().paintPhoto(f, o, c)) },
  { id: 'split-scans', cat: 'image', name: 'Split scans', desc: 'Cut each photo out of a flatbed scan and straighten it.', accepts: [], extAccept: PHOTO_EXT, craft: 'photocraft', prio: 20, petal: ['Split scan', 'Photos'], save: 'folder', suffix: ' - photos', run: each((f, o, c) => craft().straightenScans(f, o, c)) },
  { id: 'export-layers', cat: 'image', name: 'Export layers', desc: 'Each visible layer of a PSD as its own transparent PNG.', accepts: [], extAccept: LAYERED_EXT, craft: 'photocraft', prio: 22, petal: ['Layers', 'Export'], save: 'folder', suffix: ' - layers',
    options: [toggle('hidden', 'Hidden layers too', false, { advanced: true })], run: each((f, o, c) => craft().exportLayers(f, o, c)) },
  { id: 'layer-info', cat: 'image', name: 'Layer list', desc: 'Size, mode and every layer of a PSD, as text.', accepts: [], extAccept: LAYERED_EXT, craft: 'photocraft', prio: 24, petal: ['Layers', 'List'], save: 'none', run: each((f, o, c) => craft().layerInfo(f, o, c)) },

  { id: 'photo-look', cat: 'image', name: 'Apply look', desc: 'One of LightCraft’s 41 looks: film, black & white, golden hour and more.', accepts: ['raw'], extAccept: LIGHT_EXT, craft: 'lightcraft', prio: 10, petal: ['Looks', '41 presets'], ext: lightExt,
    outName: (files, o) => `${U.base(files[0])}-${String(o.preset || 'lc.vivid-pop').replace(/^lc\./, '')}.${lightExt(o, files)}`,
    options: [select('preset', 'Look', LIGHT_LOOK_CHOICES, 'lc.vivid-pop')], run: each((f, o, c) => craft().lookPhoto(f, o, c)) },
  { id: 'smart-bw', cat: 'image', name: 'Smart B&W', desc: 'LightCraft mixes black & white from the photo’s own colours.', accepts: ['raw'], extAccept: LIGHT_EXT, craft: 'lightcraft', prio: 14, petal: ['B&W', 'Smart mix'], ext: lightExt, suffix: '-bw', run: each((f, o, c) => craft().smartBw(f, o, c)) },
  { id: 'straighten-photo', cat: 'image', name: 'Straighten', desc: 'LightCraft levels a tilted horizon and crops the edges.', accepts: ['raw'], extAccept: LIGHT_EXT, craft: 'lightcraft', prio: 16, petal: ['Straighten', 'Level'], ext: lightExt, suffix: '-straight', run: each((f, o, c) => craft().straightenPhoto(f, o, c)) },
  { id: 'remove-dust', cat: 'image', name: 'Remove dust', desc: 'LightCraft finds and heals sensor-dust spots.', accepts: ['raw'], extAccept: LIGHT_EXT, craft: 'lightcraft', prio: 18, petal: ['Dust', 'Remove'], ext: lightExt, suffix: '-clean',
    options: [range('sensitivity', 'Sensitivity', 50, 1, 100, { advanced: true })], run: each((f, o, c) => craft().removeDust(f, o, c)) },
  { id: 'hdr-batch', cat: 'image', name: 'HDR sets', desc: 'Merge every bracketed set in a folder or a pile of shots.', accepts: ['folder', 'raw', 'image'], craft: 'lightcraft', prio: 30, petal: ['HDR sets', 'Folder'], save: 'folder', suffix: ' - HDR',
    ok: (files) => (files.length === 1 && groupOf(files[0]) === 'folder') || (files.length >= 3 && !files.some((f) => groupOf(f) === 'folder')), run: async (files, o, c) => [await craft().hdrBatch(files, o, c)] },

  { id: 'trace-image', cat: 'cad', name: 'Trace to vector', desc: 'VectorCraft turns a picture or logo into clean, scalable shapes.', accepts: [], extAccept: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'tif', 'tiff', 'bmp', 'psd'], craft: 'vectorcraft', prio: 10, ext: (o) => o.to || 'svg', suffix: '',
    petals: [['Trace', 'To SVG', { style: 'auto', to: 'svg' }], ['Trace logo', 'Flat colours', { style: 'logo', to: 'svg' }]],
    options: [select('style', 'Style', [['auto', 'Colour (auto)'], ['logo', 'Flat logo'], ['colors16', '16 colours'], ['bw', 'Black & white'], ['lineart', 'Line art'], ['sketch', 'Sketch'], ['photo', 'Photo (detailed, large)']]), choice('to', 'Save as', [['svg', 'SVG'], ['ai', 'AI'], ['pdf', 'PDF'], ['eps', 'EPS']]), toggle('transparent', 'Drop the white background', false, { advanced: true })],
    run: each((f, o, c) => craft().traceImage(f, o, c)) },
  { id: 'outline-text', cat: 'cad', name: 'Outline text', desc: 'VectorCraft turns text into shapes, so it prints without the fonts.', accepts: [], extAccept: ['ai', 'eps', 'svg', 'pdf'], craft: 'vectorcraft', prio: 12, petal: ['Outline', 'Text'], ext: (o, files) => (['svg', 'ai', 'eps', 'pdf'].includes(U.ext(files[0] || '')) ? U.ext(files[0]) : 'pdf'), suffix: '-outlined', run: each((f, o, c) => craft().outlineText(f, o, c)) },
  { id: 'export-artboards', cat: 'cad', name: 'Export artboards', desc: 'Every artboard as its own picture.', accepts: [], extAccept: ['ai', 'svg', 'pdf', 'eps', 'vectorcraft'], craft: 'vectorcraft', prio: 14, petal: ['Artboards', 'PNG'], save: 'folder', suffix: ' - artboards',
    options: [choice('to', 'Format', [['png', 'PNG'], ['jpg', 'JPG'], ['svg', 'SVG'], ['pdf', 'PDF']]), range('scale', 'Scale', 2, 1, 4, { unit: '×', when: { to: ['png', 'jpg'] }, advanced: true })], run: each((f, o, c) => craft().exportArtboards(f, o, c)) },
  { id: 'logo-package', cat: 'cad', name: 'Logo package', desc: 'SVG, PNG at 1× and 2×, PDF and a print PDF, in one folder.', accepts: [], extAccept: ['ai', 'svg', 'pdf', 'eps', 'vectorcraft'], craft: 'vectorcraft', prio: 16, petal: ['Logo kit', 'All sizes'], save: 'folder', suffix: ' - logo package', run: each((f, o, c) => craft().logoPackage(f, o, c)) },
  { id: 'vector-info', cat: 'cad', name: 'Vector info', desc: 'Artboards, colour mode, objects and fonts, with any that are missing.', accepts: ['vector'], extAccept: ['ai', 'svg', 'pdf', 'eps'], craft: 'vectorcraft', prio: 30, petal: ['Info', 'Fonts'], save: 'none', run: each((f, o, c) => craft().vectorInfo(f, o, c)) },

  { id: 'preflight-layout', cat: 'docs', name: 'Preflight', desc: 'DesignCraft checks for overset text, low-resolution pictures and missing links.', accepts: ['layout'], craft: 'designcraft', prio: 10, petal: ['Print check', 'Before print'], save: 'none',
    options: [num('minPpi', 'Lowest picture resolution (ppi)', 150, { advanced: true })], run: each((f, o, c) => craft().preflightLayout(f, o, c)) },
  { id: 'layout-pdf', cat: 'docs', name: 'Print or web PDF', desc: 'A press-ready PDF/X-4 with bleed and marks, or a small tagged PDF for screens.', accepts: ['layout'], craft: 'designcraft', prio: 12, ext: 'pdf', outName: (files, o) => `${U.base(files[0])}-${o.preset === 'web' ? 'web' : 'print'}.pdf`,
    petals: [['Print PDF', 'Bleed & marks', { preset: 'print' }], ['Web PDF', 'Small', { preset: 'web' }]], options: [choice('preset', 'For', [['print', 'Print'], ['web', 'Screen']])], run: each((f, o, c) => craft().layoutPdf(f, o, c)) },
  { id: 'package-layout', cat: 'docs', name: 'Package', desc: 'The document with its pictures, fonts, an IDML and a PDF, ready to hand over.', accepts: ['layout'], craft: 'designcraft', prio: 14, petal: ['Package', 'Hand over'], save: 'folder', suffix: ' Folder', run: each((f, o, c) => craft().packageLayout(f, o, c)) },
  { id: 'fixed-epub', cat: 'docs', name: 'Fixed-layout EPUB', desc: 'An e-book that keeps every page exactly as designed.', accepts: ['layout'], craft: 'designcraft', prio: 16, petal: ['EPUB', 'Fixed'], ext: 'epub', suffix: '-fixed', run: each((f, o, c) => craft().fixedEpub(f, o, c)) },
  { id: 'booklet-pdf', cat: 'docs', name: 'Booklet', desc: 'Pages put in booklet order: print double-sided, fold and staple.', accepts: ['layout'], craft: 'designcraft', prio: 18, petal: ['Booklet', 'Fold'], ext: 'pdf', suffix: '-booklet', run: each((f, o, c) => craft().bookletPdf(f, o, c)) },

  { id: 'poster-frame', cat: 'media', name: 'Poster frame', desc: 'A still picture from the middle of the animation.', accepts: ['motion'], craft: 'effectcraft', prio: 10, petal: ['Poster', 'PNG'], ext: 'png', suffix: '-poster',
    options: [toggle('transparent', 'Transparent background', true, { advanced: true })], run: each((f, o, c) => craft().posterFrame(f, o, c)) },
  { id: 'alpha-render', cat: 'media', name: 'Transparent video', desc: 'A GIF or ProRes 4444 MOV that keeps the animation’s transparency.', accepts: ['motion'], craft: 'effectcraft', prio: 12, ext: (o) => (o.to === 'mov' ? 'mov' : 'gif'), outName: (files, o) => `${U.base(files[0])}-transparent.${o.to === 'mov' ? 'mov' : 'gif'}`,
    petals: [['Alpha GIF', 'Transparent', { to: 'gif' }], ['Alpha MOV', 'ProRes 4444', { to: 'mov' }]], options: [choice('to', 'Format', [['gif', 'GIF'], ['mov', 'MOV (ProRes 4444)']])], run: each((f, o, c) => craft().alphaRender(f, o, c)) },
  { id: 'frame-sequence', cat: 'media', name: 'PNG frames', desc: 'Every frame as a transparent PNG.', accepts: ['motion'], craft: 'effectcraft', prio: 14, petal: ['Frames', 'PNG'], save: 'folder', suffix: ' - frames',
    options: [select('resolution', 'Size', [['full', 'Full'], ['half', 'Half']], 'full', { advanced: true })], run: each((f, o, c) => craft().frameSequence(f, o, c)) },
  { id: 'motion-info', cat: 'media', name: 'Animation info', desc: 'Size, length, frame rate and layers.', accepts: ['motion'], craft: 'effectcraft', prio: 30, petal: ['Info', 'Layers'], save: 'none', run: each((f, o, c) => craft().motionInfo(f, o, c)) },

  { id: 'split-scenes', cat: 'media', name: 'Split scenes', desc: 'FilmCraft finds each cut and saves every shot as its own clip.', accepts: ['video'], craft: 'filmcraft', prio: 10, petal: ['Scenes', 'Split'], save: 'folder', suffix: ' - scenes',
    options: [range('sensitivity', 'Sensitivity', 50, 1, 100, { advanced: true })], run: each((f, o, c) => craft().splitScenes(f, o, c)) },
  { id: 'clean-voice', cat: 'media', name: 'Clean voice', desc: 'FilmCraft takes background noise and rumble out of speech.', accepts: ['video', 'audio'], craft: 'filmcraft', prio: 12, petal: ['Clean voice', 'Noise'],
    ext: (o, files) => (groupOf(files[0] || '') === 'video' ? 'mp4' : ['wav', 'aif', 'aiff', 'flac'].includes(U.ext(files[0] || '')) ? 'wav' : 'm4a'), suffix: '-clean', run: each((f, o, c) => craft().cleanVoice(f, o, c)) },
  { id: 'video-look', cat: 'media', name: 'Colour grade', desc: 'One of FilmCraft’s film looks, applied to the whole video.', accepts: ['video'], craft: 'filmcraft', prio: 14, petal: ['Colour', 'Looks'], ext: 'mp4', suffix: '-graded',
    options: [select('look', 'Look', VIDEO_LOOK_CHOICES)], run: each((f, o, c) => craft().videoLook(f, o, c)) },
  { id: 'edit-ready', cat: 'media', name: 'Edit-ready copy', desc: 'ProRes or DNxHR, which editing apps play back and scrub smoothly.', accepts: ['video'], craft: 'filmcraft', prio: 16, petal: ['Edit copy', 'ProRes', { codec: 'prores' }], ext: 'mov', outName: (files, o) => `${U.base(files[0])}-${o.codec === 'dnxhr' ? 'dnxhr' : 'prores'}.mov`,
    options: [choice('codec', 'Codec', [['prores', 'ProRes 422'], ['dnxhr', 'DNxHR (Avid)']])], run: each((f, o, c) => craft().editReady(f, o, c)) },
  { id: 'media-info', cat: 'media', name: 'Media info', desc: 'Codecs, size, frame rate, colour and audio tracks.', accepts: ['video', 'audio'], craft: 'filmcraft', prio: 30, petal: ['Info', 'Codecs'], save: 'none', run: each((f, o, c) => craft().mediaInfo(f, o, c)) },

  { id: 'sanitize-pdf', cat: 'pdf', name: 'Remove hidden info', desc: 'Before sharing: removes author, comments, attachments, scripts and hidden layers.', tags: 'sanitize sanitise metadata privacy clean', accepts: ['pdf'], craft: 'pdfcraft', prio: 12, petal: ['Clean up', 'Hidden info'], suffix: '-sanitized', ext: 'pdf', options: [pdfPassword], run: each((f, o, c) => craft().sanitizePdf(f, o, c)) },
  { id: 'bates-pdf', cat: 'pdf', name: 'Legal page IDs (Bates)', desc: 'A unique ID like CASE000001 on every page, as legal documents need.', tags: 'bates legal numbering stamp', accepts: ['pdf'], craft: 'pdfcraft', prio: 18, petal: ['Page IDs', 'Legal'], suffix: '-bates', ext: 'pdf',
    options: [text('prefix', 'Prefix', '', { placeholder: 'ABC' }), num('start', 'First number', 1), num('digits', 'Digits', 6, { advanced: true }), text('suffix', 'Suffix', '', { advanced: true }), choice('position', 'Position', [['right', 'Right'], ['center', 'Centre'], ['left', 'Left']], 'right', { advanced: true }), pdfPassword],
    run: each((f, o, c) => craft().batesPdf(f, o, c)) },
  { id: 'word-count', cat: 'pdf', name: 'Word count', desc: 'Words and characters, page by page.', accepts: ['pdf'], craft: 'pdfcraft', prio: 20, petal: ['Words', 'Count'], save: 'none', options: [pdfPassword], run: each((f, o, c) => craft().wordCount(f, o, c)) },
  { id: 'print-check', cat: 'pdf', name: 'Print check', desc: 'Low-resolution pictures, missing fonts and other print problems.', accepts: ['pdf'], craft: 'pdfcraft', prio: 22, petal: ['Print', 'Check'], save: 'none', options: [pdfPassword], run: each((f, o, c) => craft().printCheck(f, o, c)) },
  { id: 'link-urls', cat: 'pdf', name: 'Link web addresses', desc: 'Make every web and e-mail address in the text clickable.', accepts: ['pdf'], craft: 'pdfcraft', prio: 24, petal: ['Links', 'From URLs'], suffix: '-linked', ext: 'pdf', options: [pdfPassword], run: each((f, o, c) => craft().linkUrls(f, o, c)) },
  { id: 'split-chapters', cat: 'pdf', name: 'Split at bookmarks', desc: 'One PDF per chapter, following the bookmarks.', accepts: ['pdf'], craft: 'pdfcraft', prio: 26, petal: ['Chapters', 'Split'], save: 'folder', suffix: ' - chapters', options: [pdfPassword], run: each((f, o, c) => craft().splitChapters(f, o, c)) },
  { id: 'access-check', cat: 'pdf', name: 'Accessibility check', desc: 'Tags, reading order, alternative text and more, checked.', accepts: ['pdf'], craft: 'pdfcraft', prio: 28, petal: ['Accessible?', 'Check'], save: 'none', options: [pdfPassword], run: each((f, o, c) => craft().accessCheck(f, o, c)) },
  { id: 'comment-summary', cat: 'pdf', name: 'Comment summary', desc: 'Every comment in the PDF, listed by page in a new PDF.', accepts: ['pdf'], craft: 'pdfcraft', prio: 30, petal: ['Comments', 'Summary'], suffix: ' - comments', ext: 'pdf', options: [pdfPassword], run: each((f, o, c) => craft().commentSummary(f, o, c)) },
  { id: 'header-footer-pdf', cat: 'pdf', name: 'Header and footer', desc: 'Text, page numbers and dates at the top and bottom of every page.', accepts: ['pdf'], craft: 'pdfcraft', prio: 38, petal: ['Header', 'Footer'], suffix: '-header', ext: 'pdf',
    options: [text('header_left', 'Header left', ''), text('header_center', 'Header centre', ''), text('header_right', 'Header right', ''), text('footer_left', 'Footer left', ''), text('footer_center', 'Footer centre', 'Page {page} of {pages}', { placeholder: '{page}, {pages}, {date}' }), text('footer_right', 'Footer right', ''),
      range('size', 'Size', 10, 6, 24, { unit: 'pt' }), num('margin', 'Margin (mm)', 12, { min: 0, advanced: true }), num('start', 'First page number', 1, { min: 1, advanced: true }), pages('pages', 'Pages', 'all', { advanced: true }), color('color', 'Colour', '#3b3b3b'), pdfPassword],
    run: each((f, o, c) => craft().headerFooterPdf(f, o, c)) },
  { id: 'background-pdf', cat: 'pdf', name: 'Page background', desc: 'A colour or a picture behind the content of every page.', accepts: ['pdf'], craft: 'pdfcraft', prio: 40, petal: ['Background', 'Colour'], suffix: '-background', ext: 'pdf',
    options: [choice('kind', 'Background', [['color', 'Colour'], ['image', 'Picture']]), { ...color('color', 'Colour', '#fff4ce'), when: { kind: 'color' } }, file('image', 'Picture', [{ name: 'Picture or PDF', extensions: ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'gif', 'bmp', 'pdf'] }], { when: { kind: 'image' } }),
      range('scale', 'Picture size', 100, 5, 100, { unit: '%', when: { kind: 'image' } }), range('opacity', 'Opacity', 100, 5, 100, { unit: '%' }), pages('pages', 'Pages', 'all', { advanced: true }), pdfPassword],
    run: each((f, o, c) => craft().backgroundPdf(f, o, c)) },
  { id: 'pdf-properties', cat: 'pdf', name: 'PDF properties', desc: 'Title, author, subject, keywords and language, and how the file opens.', accepts: ['pdf'], craft: 'pdfcraft', prio: 42, petal: ['Properties', 'Title'], suffix: '-properties', ext: 'pdf',
    options: [text('title', 'Title', ''), text('author', 'Author', ''), text('subject', 'Subject', '', { advanced: true }), text('keywords', 'Keywords', '', { advanced: true, placeholder: 'Separated by commas' }), text('lang', 'Language', '', { placeholder: 'en-GB' }),
      select('navigation', 'Opens with', [['keep', 'As it is'], ['bookmarks', 'Bookmarks panel'], ['pages', 'Pages panel'], ['page', 'Just the page']], 'keep', { advanced: true }), toggle('showTitle', 'Show the title in the window', true), pdfPassword],
    run: each((f, o, c) => craft().pdfProperties(f, o, c)) },
  { id: 'page-labels', cat: 'pdf', name: 'Page labels', desc: 'Number the front pages i, ii, iii, or label pages A-1, A-2, as readers show them.', accepts: ['pdf'], craft: 'pdfcraft', prio: 44, petal: ['Page names', 'i, ii, iii'], suffix: '-labelled', ext: 'pdf',
    options: [num('from', 'From page', 1, { min: 1 }), num('to', 'To page', 2, { min: 1 }), select('style', 'Style', [['lower-roman', 'i, ii, iii'], ['upper-roman', 'I, II, III'], ['decimal', '1, 2, 3'], ['lower-alpha', 'a, b, c'], ['upper-alpha', 'A, B, C'], ['none', 'Prefix only']]), text('prefix', 'Prefix', '', { placeholder: 'A-' }), num('start', 'Start at', 1, { min: 1, advanced: true }), toggle('restart', 'Number the rest 1, 2, 3', true), pdfPassword],
    run: each((f, o, c) => craft().pageLabels(f, o, c)) },
  { id: 'export-form-data', cat: 'pdf', name: 'Export form data', desc: 'What was typed into a form, as a spreadsheet or an XFDF/FDF file.', accepts: ['pdf'], craft: 'pdfcraft', prio: 46, petal: ['Form data', 'Export'], ext: (o) => o.to || 'csv', outName: (files, o) => `${U.base(files[0])} - form data.${o.to || 'csv'}`,
    options: [choice('to', 'Save as', [['csv', 'CSV'], ['xfdf', 'XFDF'], ['fdf', 'FDF'], ['xml', 'XML']]), pdfPassword], run: each((f, o, c) => craft().exportFormData(f, o, c)) },
  { id: 'fill-form-data', cat: 'pdf', name: 'Fill form from data', desc: 'Fill a PDF form from a CSV, XFDF, FDF or XML file.', accepts: ['pdf'], craft: 'pdfcraft', prio: 48, petal: ['Fill form', 'From data'], suffix: '-filled', ext: 'pdf',
    options: [file('data', 'Data file', [{ name: 'Form data', extensions: ['csv', 'txt', 'xfdf', 'fdf', 'xml'] }], { required: true }), pdfPassword], run: each((f, o, c) => craft().importFormData(f, o, c)) },
  { id: 'printer-marks', cat: 'pdf', name: 'Crop marks and bleed', desc: 'Trim marks at the corners and a bleed round every page, for the printer.', accepts: ['pdf'], suffix: '-marks', ext: 'pdf',
    options: [num('bleed', 'Bleed (mm)', 3, { min: 0 }), num('length', 'Mark length (mm)', 6, { min: 2, advanced: true }), num('offset', 'Gap from the trim (mm)', 3, { min: 0, advanced: true }), pdfPassword],
    run: each((f, o, c) => pdf().printerMarks(f, o, outFile('-marks', 'pdf')(f, c))) },
  { id: 'bookmark-headings', cat: 'pdf', name: 'Bookmarks from headings', desc: 'A bookmark for every heading, nested like a table of contents.', accepts: ['pdf'], suffix: '-bookmarked', ext: 'pdf',
    options: [toggle('replace', 'Replace the bookmarks it has', true), pdfPassword], run: each((f, o, c) => pdf().bookmarksFromHeadings(f, o, outFile('-bookmarked', 'pdf')(f, c))) },
  { id: 'cad-dwg', cat: 'cad', name: 'Save as DWG', desc: 'A DWG that AutoCAD opens, with its layers, blocks and dimensions. Pick an older version for older CAD programs.', tags: 'autocad dwg dxf version', accepts: ['cad2d'], craft: 'cadcraft', prio: 8,
    petals: [['DWG', 'AutoCAD', { version: '2018' }], ['DWG 2000', 'Older CAD', { version: '2000' }]], ext: 'dwg', outName: (files, o) => `${U.base(files[0])}${U.ext(files[0]) === 'dwg' ? `-${o.version || 2018}` : ''}.dwg`,
    options: [select('version', 'For AutoCAD', [['2018', '2018 and later'], ['2013', '2013'], ['2010', '2010'], ['2007', '2007'], ['2004', '2004'], ['2000', '2000']], '2018')], run: each((f, o, c) => craft().cadSaveAs(f, { ...o, to: 'dwg' }, c)) },
  { id: 'cad-clean', cat: 'cad', name: 'Clean up drawing', desc: 'Fixes errors, removes unused layers, blocks and styles, and deletes doubled lines.', tags: 'purge audit overkill', accepts: ['cad2d'], craft: 'cadcraft', prio: 10, petal: ['Clean up', 'Unused'],
    ext: (o, files) => (U.ext(files[0] || '') === 'dxf' ? 'dxf' : 'dwg'), suffix: '-clean', run: each((f, o, c) => craft().cadClean(f, o, c)) },
  { id: 'cad-sheets', cat: 'cad', name: 'Print sheets', desc: 'Every sheet of the drawing as a page of one PDF, at its own paper size.', tags: 'layouts plot publish paper space', accepts: ['cad2d'], craft: 'cadcraft', prio: 12, petal: ['Sheets', 'PDF'],
    ext: 'pdf', outName: (files) => `${U.base(files[0])} - sheets.pdf`, run: each((f, o, c) => craft().cadSheets(f, o, c)) },
  { id: 'cad-blocks', cat: 'cad', name: 'Count blocks', desc: 'How many of each block, like doors, windows and fittings, as a spreadsheet.', tags: 'data extraction quantities schedule', accepts: ['cad2d'], craft: 'cadcraft', prio: 14, petal: ['Blocks', 'Count'],
    ext: 'csv', outName: (files) => `${U.base(files[0])} - blocks.csv`, run: each((f, o, c) => craft().cadBlocks(f, o, c)) },
  { id: 'cad-layers', cat: 'cad', name: 'Layer list', desc: 'Every layer, and which are off, frozen or locked, with blocks, sheets and objects.', accepts: ['cad2d'], craft: 'cadcraft', prio: 16, petal: ['Layers', 'List'], save: 'none', run: each((f, o, c) => craft().cadLayers(f, o, c)) },
  { id: 'cad-compare', cat: 'cad', name: 'Compare drawings', desc: 'What was added, removed or changed between two versions. Put the older one first.', accepts: ['cad2d'], min: 2, max: 2, ordered: true, craft: 'cadcraft', prio: 18, petal: ['Compare', '2 versions'], save: 'none',
    run: async (files, o, c) => [await craft().cadCompare(files, o, c)] },

  { id: 'master-audio', cat: 'media', name: 'Master', desc: 'Louder and polished, ready to publish: gentle EQ, compression and a limiter, to the loudness you pick.', tags: 'mastering loudness lufs limiter', accepts: ['audio'], ok: notMidi, craft: 'soundcraft', prio: 8, petal: ['Master', 'Loud & clear'],
    ext: (o, files) => craft().soundExt(files[0] || ''), suffix: '-mastered', options: [select('loudness', 'Loudness', [['-14', 'Streaming (−14 LUFS)'], ['-16', 'Podcast (−16 LUFS)'], ['-9', 'Club (−9 LUFS)'], ['-23', 'Broadcast (−23 LUFS)']], '-14')], run: each((f, o, c) => craft().masterAudio(f, o, c)) },
  { id: 'polish-voice', cat: 'media', name: 'Polish voice', desc: 'Clearer speech: no rumble, a quieter background between words, softer S sounds and an even level.', tags: 'podcast de-ess gate compressor', accepts: ['audio'], ok: notMidi, craft: 'soundcraft', prio: 10, petal: ['Voice', 'Podcast'],
    ext: (o, files) => craft().soundExt(files[0] || ''), suffix: '-voice', run: each((f, o, c) => craft().polishVoice(f, o, c)) },
  { id: 'add-reverb', cat: 'media', name: 'Add reverb', desc: 'The sound of a room or a hall, as if it were recorded there.', tags: 'echo space', accepts: ['audio'], ok: notMidi, craft: 'soundcraft', prio: 12, petal: ['Reverb', 'Room'],
    ext: (o, files) => craft().soundExt(files[0] || ''), suffix: '-reverb', options: [choice('space', 'Space', [['room', 'Room'], ['hall', 'Hall']]), range('amount', 'Amount', 25, 5, 60, { unit: '%' })], run: each((f, o, c) => craft().addReverb(f, o, c)) },
  { id: 'mix-tracks', cat: 'media', name: 'Mix together', desc: 'Several recordings played at once, as one track at streaming loudness.', accepts: ['audio'], ok: notMidi, min: 2, ordered: true, craft: 'soundcraft', prio: 14, petal: ['Mix', 'One track'],
    ext: (o, files) => craft().soundExt(files[0] || ''), outName: (files) => `${U.base(files[0])} - mix.${craft().soundExt(files[0])}`, run: async (files, o, c) => [await craft().mixTracks(files, o, c)] },
  { id: 'session-mix', cat: 'media', name: 'Export mix', desc: 'A SoundCraft session as one mixed WAV.', accepts: [], extAccept: ['scraft'], craft: 'soundcraft', prio: 16, petal: ['Mix', 'WAV'], ext: 'wav', suffix: '', run: each((f, o, c) => craft().sessionBounce(f, { what: 'mix' }, c)) },
  { id: 'session-stems', cat: 'media', name: 'Export stems', desc: 'A WAV for every track of a SoundCraft session.', accepts: [], extAccept: ['scraft'], craft: 'soundcraft', prio: 18, petal: ['Stems', 'Each track'], save: 'folder', suffix: ' - stems', run: each((f, o, c) => craft().sessionBounce(f, { what: 'stems' }, c)) },

  { id: 'doc-markup', cat: 'docs', name: 'PDF with comments', desc: 'A PDF that shows the comments in the margin and the tracked changes, as Word prints them.', tags: 'print markup review', accepts: [], extAccept: WORD_DOCS, craft: 'wordcraft', prio: 8, petal: ['Comments', 'In PDF'],
    ext: 'pdf', outName: (files) => `${U.base(files[0])} - with comments.pdf`, run: each((f, o, c) => craft().wordMarkup(f, o, c)) },
  { id: 'doc-contents', cat: 'docs', name: 'Add contents', desc: 'A table of contents at the start, made from the headings, with page numbers.', tags: 'toc table of contents', accepts: [], extAccept: WORD_EDIT, craft: 'wordcraft', prio: 10, petal: ['Contents', 'Page list'],
    ext: wordExt, suffix: '-contents', options: [text('title', 'Title', 'Contents'), select('levels', 'Heading levels', [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']], '3', { advanced: true })], run: each((f, o, c) => craft().wordContents(f, o, c)) },
  { id: 'doc-password', cat: 'docs', name: 'Lock with password', desc: 'A Word file that asks for the password before it opens.', tags: 'encrypt protect', accepts: [], extAccept: WORD_DOCS, craft: 'wordcraft', prio: 12, petal: ['Password', 'Lock'],
    ext: 'docx', suffix: '-locked', options: [password('password', 'Password', { required: true })], run: each((f, o, c) => craft().wordPassword(f, o, c)) },
  { id: 'doc-fields', cat: 'docs', name: 'Update fields', desc: 'Brings the contents, page numbers, dates and cross-references up to date.', accepts: [], extAccept: WORD_EDIT, craft: 'wordcraft', prio: 14, petal: ['Fields', 'Update'],
    ext: wordExt, suffix: '-updated', run: each((f, o, c) => craft().wordFields(f, o, c)) },
  { id: 'doc-upgrade', cat: 'docs', name: 'Save as DOCX', desc: 'An old Word (.doc), RTF or OpenDocument file as a modern Word document.', accepts: [], extAccept: ['doc', 'rtf', 'odt'], craft: 'wordcraft', prio: 16, petal: ['DOCX', 'Modern Word'],
    ext: 'docx', suffix: '', run: each((f, o, c) => craft().wordUpgrade(f, o, c)) },
  { id: 'doc-pages', cat: 'docs', name: 'Page pictures', desc: 'Each page as a sharp picture, laid out as it prints.', accepts: [], extAccept: WORD_DOCS, craft: 'wordcraft', prio: 18, petal: ['Pages', 'PNG'], save: 'folder', suffix: ' - pages', run: each((f, o, c) => craft().wordPages(f, o, c)) },

  { id: 'sheet-chart', cat: 'docs', name: 'Add a chart', desc: 'A chart of the table, in the kind that suits the data or one you choose.', tags: 'graph plot', accepts: [], extAccept: GRID_IN, craft: 'gridcraft', prio: 8, petal: ['Chart', 'From data'],
    ext: 'xlsx', suffix: '-chart', options: [select('type', 'Chart', [['auto', 'Best fit'], ['column', 'Columns'], ['bar', 'Bars'], ['line', 'Line'], ['pie', 'Pie'], ['area', 'Area'], ['scatter', 'Scatter']], 'auto'), text('title', 'Title', '', { advanced: true })], run: each((f, o, c) => craft().gridChart(f, o, c)) },
  { id: 'sheet-table', cat: 'docs', name: 'Make a table', desc: 'Banded rows, a header row and filter buttons, like Format as Table in Excel.', tags: 'format filter', accepts: [], extAccept: GRID_IN, craft: 'gridcraft', prio: 10, petal: ['Table', 'Filters'], ext: 'xlsx', suffix: '-table', run: each((f, o, c) => craft().gridTable(f, o, c)) },
  { id: 'sheet-recalc', cat: 'docs', name: 'Recalculate', desc: 'Works out every formula again, so the saved results are current.', tags: 'formulas calculate', accepts: [], extAccept: GRID_IN.filter((e) => !CSV_IN.includes(e)), craft: 'gridcraft', prio: 12, petal: ['Recalculate', 'Formulas'], ext: 'xlsx', suffix: '-recalculated', run: each((f, o, c) => craft().gridRecalc(f, o, c)) },
  { id: 'sheet-check', cat: 'docs', name: 'Check calculations', desc: 'Works out every formula again and lists any whose saved result is out of date.', tags: 'formulas audit', accepts: [], extAccept: GRID_IN.filter((e) => !CSV_IN.includes(e)), craft: 'gridcraft', prio: 14, petal: ['Check', 'Formulas'], save: 'none', run: each((f, o, c) => craft().gridCheck(f, o, c)) },

  { id: 'make-slides', cat: 'docs', name: 'Make slides', desc: 'Slides from notes: each heading becomes a slide and the list under it its points.', tags: 'outline markdown presentation', accepts: [], extAccept: ['md', 'markdown', 'txt'], craft: 'deckcraft', prio: 8, petal: ['Slides', 'From notes'],
    ext: 'pptx', suffix: '', options: [select('theme', 'Look', craft().DECK_THEMES.map((t) => [t, t]))], run: each((f, o, c) => craft().deckOutline(f, o, c)) },
  { id: 'slides-gif', cat: 'docs', name: 'Slides to GIF', desc: 'An animated GIF that shows each slide in turn, for chats and web pages.', accepts: [], extAccept: DECK_IN, craft: 'deckcraft', prio: 10, petal: ['GIF', 'Animated'], ext: 'gif', suffix: '',
    options: [range('seconds', 'Seconds per slide', 3, 1, 20, { unit: 's' }), choice('width', 'Size', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']], 'medium')], run: each((f, o, c) => gif().fromSlides(f, o, c)) },
  { id: 'slide-graphics', cat: 'docs', name: 'Slide graphics', desc: 'Each slide as a picture with a see-through background, for videos and overlays.', tags: 'transparent png', accepts: [], extAccept: DECK_IN, craft: 'deckcraft', prio: 12, petal: ['Graphics', 'See-through'], save: 'folder', suffix: ' - slide graphics', run: each((f, o, c) => craft().deckGraphics(f, o, c)) },

  { id: 'format-html', cat: 'docs', name: 'Format HTML', desc: 'Indent a page, stylesheet or script neatly, one element per line.', tags: 'prettify beautify tidy indent', accepts: [], extAccept: WEB_CODE, craft: 'webcraft', prio: 10, petal: ['Format', 'Tidy'], suffix: '-formatted', ext: (o, files) => U.ext(files?.[0] || 'x.html'),
    options: [choice('indent', 'Indent', [['2', '2 spaces'], ['4', '4 spaces'], ['tab', 'Tabs']])], run: each((f, o, c) => web().formatFile(f, o, c)) },
  { id: 'minify-web', cat: 'docs', name: 'Minify', desc: 'The smallest page, stylesheet or script that works the same, for publishing.', tags: 'minify compress html css js', accepts: [], extAccept: WEB_CODE, craft: 'webcraft', prio: 12, petal: ['Minify', 'Smaller'], outName: (files) => `${U.base(files[0]).replace(/\.min$/, '')}.min.${U.ext(files[0])}`,
    run: each((f, o, c) => web().minifyFile(f, o, c)) },
  { id: 'check-links', cat: 'docs', name: 'Check links and images', desc: 'Missing pictures, files and #anchors the page points to.', tags: 'broken links images anchors', accepts: [], extAccept: WEB_PAGE, craft: 'webcraft', prio: 14, petal: ['Links', 'Check'], save: 'none', run: each((f, o, c) => web().checkLinksFile(f, o, c)) },
  { id: 'inline-css', cat: 'docs', name: 'Inline CSS for e-mail', desc: 'Put the styles on each element, as e-mail programs need.', tags: 'email newsletter juice inline styles', accepts: [], extAccept: WEB_PAGE, craft: 'webcraft', prio: 16, petal: ['E-mail', 'Inline CSS'], suffix: '-email', ext: 'html', run: each((f, o, c) => web().inlineCss(f, o, c)) },
  { id: 'web-to-pdf', cat: 'docs', name: 'Page to PDF', desc: 'Print the page to a PDF, with its pictures and styles.', tags: 'html print', accepts: [], extAccept: WEB_PAGE, craft: 'webcraft', prio: 18, petal: ['PDF', 'Print'], ext: 'pdf', suffix: '',
    options: [select('pageSize', 'Page size', [['A4', 'A4'], ['Letter', 'Letter'], ['A3', 'A3'], ['Legal', 'Legal']]), choice('orientation', 'Orientation', [['portrait', 'Portrait'], ['landscape', 'Landscape']])],
    run: each((f, o, c) => web().pageToPdf(f, o, c)) },
  { id: 'web-text', cat: 'docs', name: 'Extract text', desc: 'The words of the page as plain text, without the markup.', accepts: [], extAccept: WEB_PAGE, craft: 'webcraft', prio: 20, petal: ['Text', 'Extract'], ext: 'txt', suffix: '', run: each((f, o, c) => web().extractText(f, o, c)) },
  { id: 'validate-html', cat: 'docs', name: 'Validate', desc: 'Unclosed tags, ids used twice, pictures without alt text and more.', tags: 'validator lint html errors', accepts: [], extAccept: WEB_PAGE, craft: 'webcraft', prio: 22, petal: ['Validate', 'Errors'], save: 'none', run: each((f, o, c) => web().validateFile(f, o, c)) },
];
TOOLS.push(...require('./codectools')({ each, choice, select, text, toggle, color, range, pdfPassword, IMAGE_IN }));
function keepExt(f) { const e = U.ext(f || ''); return ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'tiff', 'tif'].includes(e) ? (e === 'jpeg' ? 'jpg' : e === 'tif' ? 'tiff' : e) : 'png'; }

const W = (tool, label, hint, opts = {}, extra = {}) => ({ tool, label, hint, opts, ...extra });
const CSV_EXT = ['csv', 'tsv'];
const ZIP = W('create-archive', 'ZIP', 'Archive', { format: 'zip' });
const HASH = W('file-hash', 'Checksum', 'Verify');
const WHEELS = {
  pdf: {
    convert: [W('pdf-to-word', 'DOCX', 'Word'), W('pdf-to-jpg', 'JPG', 'Pages', { format: 'jpg' }, { full: true }), W('pdf-to-jpg', 'PNG', 'Pages', { format: 'png' }, { full: true }), W('pdf-to-excel', 'XLSX', 'Excel', { to: 'xlsx' }), W('pdf-to-powerpoint', 'PPTX', 'PowerPoint'), W('pdf-to-text', 'TXT', 'Text'), W('pdf-to-html', 'HTML', 'Web'), W('pdf-to-svg', 'SVG', 'Vector'), W('pdf-to-markdown', 'MD', 'Markdown'), W('pdf-to-tiff', 'TIFF', 'All pages')],
    tools: [W('compress-pdf', 'Compress', 'Smaller'), W('edit-pdf', 'Edit', 'Text & more'), W('sign-pdf', 'Sign', 'Signature'), W('organize-pdf', 'Pages', 'Reorder'), W('split-pdf', 'Split', 'Pages'), W('protect-pdf', 'Protect', 'Password'), W('page-numbers', 'Numbers', 'Pages'), W('watermark-pdf', 'Watermark', 'Text'), W('ocr-pdf', 'Searchable', 'Read scans'), W('rotate-pdf', 'Rotate', '90°')],
  },
  image: {
    tools: [W('remove-background', 'Remove BG', 'Background'), W('compress-image', 'Compress', 'Smaller'), W('resize-image', 'Resize', '50%', { mode: 'percent', percent: 50 }), W('edit-image', 'Edit', 'Crop & adjust'), W('enhance-photo', 'Enhance', 'Auto'), W('upscale-image', 'Upscale', 'Sharper 2×', { factor: '2' }), W('upscale-ai', 'Upscale 2×', 'AI', { factor: '2' }), W('crop-image', 'Square', 'Smart', { aspect: '1:1' }), W('rotate-image', 'Rotate', '90°', { angle: '90', flip: 'none' }), W('image-to-text', 'Text', 'Copy text'), W('strip-metadata', 'Private', 'No location'), W('scan-to-pdf', 'Scan', 'Clean PDF'), W('upscale-ai', 'Upscale 4×', 'AI', { factor: '4' }), W('photo-info', 'Info', 'Camera & place')],
  },
  raw: {
    convert: [W('develop-raw', 'JPG', 'Develop', { to: 'jpg', auto: false }), W('develop-raw', 'TIFF', '16-bit', { to: 'tif', auto: false }), W('develop-raw', 'PNG', 'Lossless', { to: 'png', auto: false }), W('develop-raw', 'AVIF', 'Small', { to: 'avif', auto: false }), W('develop-raw', 'DNG', 'Raw', { to: 'dng', auto: false }), W('convert-image', 'Preview', 'Built-in', { to: 'jpg', develop: false })],
    tools: [W('enhance-photo', 'Enhance', 'Auto'), W('edit-image', 'Edit', 'Develop'), W('develop-raw', 'Develop', 'Options', {}, { ask: true }), W('strip-metadata', 'Private', 'No location'), W('image-to-text', 'Text', 'Copy text')],
  },
  video: {
    convert: [W('convert-video', 'MP4', 'Universal', { to: 'mp4' }), W('convert-video', 'MOV', 'Apple', { to: 'mov' }), W('convert-video', 'WebM', 'Web', { to: 'webm' }), W('video-to-gif', 'GIF', 'Clip', {}, { full: true }), W('extract-audio', 'MP3', 'Audio', { to: 'mp3' }), W('convert-video', 'HEVC', 'Smaller', { to: 'hevc' }), W('convert-video', 'MKV', 'Archive', { to: 'mkv' }), W('extract-audio', 'M4A', 'Audio', { to: 'm4a' }), W('extract-audio', 'WAV', 'Audio', { to: 'wav' })],
    tools: [W('compress-video', 'Compress', 'Smaller'), W('edit-video', 'Edit', 'Trim & more'), W('trim-media', 'Trim', 'Cut'), W('crop-video', 'Crop', 'Shape'), W('mute-video', 'Mute', 'No sound'), W('resize-video', '720p', 'Resize', { height: '720' }), W('rotate-video', 'Rotate', '90°', { angle: '90', flip: 'none' }), W('video-frames', 'Frames', 'Per second'), W('normalize-audio', 'Level', 'Loudness'), W('speed-media', 'Speed', '1.5×', { factor: '1.5' }), W('volume-media', 'Volume', 'Louder')],
  },
  audio: {
    convert: [W('convert-audio', 'MP3', 'Universal', { to: 'mp3' }), W('convert-audio', 'M4A', 'Apple', { to: 'm4a' }), W('convert-audio', 'WAV', 'Studio', { to: 'wav' }), W('convert-audio', 'FLAC', 'Lossless', { to: 'flac' }), W('convert-audio', 'ALAC', 'iTunes', { to: 'alac' }), W('convert-audio', 'AIFF', 'Mac', { to: 'aiff' }), W('convert-audio', 'OGG', 'Open', { to: 'ogg' }), W('convert-audio', 'Opus', 'Voice', { to: 'opus' }), W('convert-audio', 'WMA', 'Windows', { to: 'wma' })],
    tools: [W('compress-audio', 'Compress', 'Smaller'), W('edit-audio', 'Edit', 'Trim & more'), W('normalize-audio', 'Level', 'Loudness'), W('volume-media', 'Volume', 'Louder'), W('trim-media', 'Trim', 'Cut'), W('fade-audio', 'Fade', 'In & out'), W('speed-media', 'Speed', '1.5×', { factor: '1.5' }), W('pitch-audio', 'Pitch', 'Semitones'), W('loop-media', 'Loop', 'Repeat'), W('reverse-media', 'Reverse', 'Backwards')],
  },
  doc: {
    convert: [W('convert-document', 'PDF', 'Document', { to: 'pdf' }), W('convert-document', 'DOCX', 'Word', { to: 'docx' }), W('convert-document', 'MD', 'Markdown', { to: 'md' }), W('convert-document', 'TXT', 'Text', { to: 'txt' }), W('convert-document', 'HTML', 'Web', { to: 'html' }), W('convert-document', 'EPUB', 'eBook', { to: 'epub' }), W('convert-document', 'RTF', 'Rich text', { to: 'rtf' })],
    tools: [W('edit-web', 'Edit', 'Web page', {}, { only: WEB_PAGE }), W('replace-text', 'Replace', 'Find', {}, { ask: true }), W('track-changes', 'Accept', 'All edits', { action: 'accept' }), W('clean-office', 'Clean', 'Personal info'), W('doc-stats', 'Stats', 'Words'), W('watermark-doc', 'Watermark', 'Draft', {}, { ask: true }),
      W('mail-merge', 'Mail merge', 'From a list', {}, { ask: true }), W('split-doc', 'Split', 'Headings'), W('office-media', 'Images', 'Extract'), W('compress-office', 'Compress', 'Pictures'), ZIP, HASH],
  },
  comic: { convert: [W('convert-comic', 'PDF', 'Document', { to: 'pdf' }), W('convert-comic', 'EPUB', 'Fixed layout', { to: 'epub' }), W('convert-comic', 'CBZ', 'Repack', { to: 'cbz' }), W('convert-comic', 'Pages', 'Pictures', { to: 'images' }, { full: true })], tools: [ZIP, HASH] },
  ebook: {
    convert: [W('convert-ebook', 'EPUB', 'eBook', { to: 'epub' }, { not: ['epub'] }), W('convert-ebook', 'KEPUB', 'Kobo', { to: 'kepub' }, { not: ['kepub'] }), W('convert-ebook', 'PDF', 'Document', { to: 'pdf' }), W('convert-ebook', 'DOCX', 'Word', { to: 'docx' }), W('convert-ebook', 'TXT', 'Text', { to: 'txt' }), W('convert-ebook', 'MD', 'Markdown', { to: 'md' }), W('convert-ebook', 'HTML', 'Web', { to: 'html' }), W('convert-ebook', 'FB2', 'FictionBook', { to: 'fb2' }, { not: ['fb2'] }), W('convert-ebook', 'HTMLZ', 'Calibre', { to: 'htmlz' }, { not: ['htmlz'] })],
    tools: [ZIP, HASH],
  },
  mail: {
    convert: [W('convert-email', 'PDF', 'Document', { to: 'pdf' }), W('convert-email', 'HTML', 'Web', { to: 'html' }), W('convert-email', 'TXT', 'Text', { to: 'txt' }), W('email-attachments', 'Files', 'Attachments'), W('convert-email', 'EML', 'Mail', { to: 'eml' }, { not: ['eml'] })],
    tools: [W('email-attachments', 'Attachments', 'Folder'), ZIP, HASH],
  },
  webarchive: { convert: [W('convert-mhtml', 'PDF', 'Document', { to: 'pdf' }), W('convert-mhtml', 'HTML', 'One page', { to: 'html' }), W('convert-mhtml', 'TXT', 'Text', { to: 'txt' })], tools: [ZIP, HASH] },
  font: {
    convert: [W('convert-font', 'WOFF2', 'Web', { to: 'woff2' }, { not: ['woff2'] }), W('convert-font', 'WOFF', 'Web', { to: 'woff' }, { not: ['woff'] }), W('convert-font', 'TTF', 'TrueType', { to: 'ttf' }, { not: ['ttf'] }), W('convert-font', 'OTF', 'OpenType', { to: 'otf' }, { not: ['otf'] }), W('convert-font', 'EOT', 'Old IE', { to: 'eot' }, { not: ['eot'] })],
    tools: [W('font-info', 'Info', 'Glyphs'), ZIP, HASH],
  },
  sheet: {
    convert: [W('convert-sheet', 'XLSX', 'Excel', { to: 'xlsx' }), W('convert-sheet', 'CSV', 'Plain', { to: 'csv' }), W('convert-sheet', 'PDF', 'Print', { to: 'pdf' }, { ask: true }), W('convert-sheet', 'JSON', 'Data', { to: 'json' }), W('convert-sheet', 'HTML', 'Table', { to: 'html' }), W('convert-sheet', 'ODS', 'Open', { to: 'ods' }), W('convert-sheet', 'MD', 'Markdown', { to: 'md' }),
      W('convert-data', 'YAML', 'Data', { to: 'yaml' }, { only: CSV_EXT }), W('convert-data', 'XML', 'Data', { to: 'xml' }, { only: CSV_EXT }), W('convert-contacts', 'vCard', 'Contacts', { to: 'vcf' }, { only: CSV_EXT })],
    tools: [W('sheet-values', 'Values', 'No formulas'), W('tidy-sheet', 'Tidy', 'Duplicates'), W('unhide-sheet', 'Unhide', 'All'), W('split-sheets', 'Split', 'Per sheet'), W('sheet-formulas', 'Formulas', 'Check'),
      W('replace-text', 'Replace', 'Find', {}, { ask: true }), W('clean-office', 'Clean', 'Personal info'), W('compress-office', 'Compress', 'Pictures'), ZIP, HASH],
  },
  slides: {
    convert: [W('convert-slides', 'PDF', 'Document', { to: 'pdf' }), W('convert-slides', 'PNG', 'Slides', { to: 'png' }), W('convert-slides', 'HTML', 'Web', { to: 'html' }), W('convert-slides', 'TXT', 'Text', { to: 'txt' }), W('convert-slides', 'MD', 'Outline', { to: 'md' }), W('convert-slides', 'PPTX', 'PowerPoint', { to: 'pptx' }), W('slide-notes', 'DOCX', 'Notes', { to: 'docx', include: 'both' }), W('slides-gif', 'GIF', 'Animated')],
    tools: [W('slide-notes', 'Notes', 'Word', { to: 'docx', include: 'both' }), W('pick-slides', 'Slides', 'Pick', {}, { ask: true }), W('pick-slides', 'Hidden', 'Remove', { slides: 'all', dropHidden: true }), W('replace-text', 'Replace', 'Find', {}, { ask: true }),
      W('clean-office', 'Clean', 'Personal info'), W('office-media', 'Media', 'Extract'), W('compress-office', 'Compress', 'Pictures'), ZIP, HASH],
  },
  vector: {
    convert: [W('convert-vector', 'SVG', 'Web', { to: 'svg' }), W('convert-vector', 'PDF', 'Document', { to: 'pdf' }), W('convert-vector', 'AI', 'Illustrator', { to: 'ai' }), W('convert-vector', 'EPS', 'Print', { to: 'eps' }), W('convert-vector', 'PNG', 'Image', { to: 'png' }), W('convert-vector', 'DXF', 'CAD', { to: 'dxf' }), W('convert-vector', 'EMF', 'Office', { to: 'emf' }), W('convert-vector', 'PSD', 'Layers', { to: 'psd' })],
    tools: [W('edit-vector', 'Edit', 'VectorCraft'), ZIP, HASH],
  },
  cad2d: {
    convert: [W('convert-cad', 'PDF', 'Sheet', { to: 'pdf' }), W('convert-cad', 'SVG', 'Vector', { to: 'svg' }), W('convert-cad', 'PNG', 'Image', { to: 'png' }), W('cad-dwg', 'DWG', 'AutoCAD', { version: '2018' }), W('convert-cad', 'DXF', 'Exchange', { to: 'dxf' }), W('convert-cad', 'AI', 'Illustrator', { to: 'ai' }), W('convert-cad', 'EPS', 'Print', { to: 'eps' }), W('convert-cad', 'JPG', 'Photo', { to: 'jpg' })],
    tools: [W('cad-info', 'Measure', 'Size'), W('cad-clean', 'Clean up', 'Unused'), W('cad-sheets', 'Sheets', 'PDF'), W('cad-blocks', 'Blocks', 'Count'), W('convert-cad', 'Mono', 'Black PDF', { to: 'pdf', mono: true }), ZIP],
  },
  cad3d: {
    convert: [W('convert-model', 'STL', '3D print', { to: 'stl' }), W('convert-model', 'STEP', 'CAD', { to: 'step' }), W('convert-model', 'OBJ', 'Universal', { to: 'obj' }), W('convert-model', 'GLB', 'Web & AR', { to: 'glb' }), W('convert-model', '3MF', 'Print', { to: '3mf' }),
      W('convert-model', 'IGES', 'Older CAD', { to: 'iges' }), W('convert-model', 'PLY', 'Scan', { to: 'ply' }), W('convert-model', 'PNG', 'Render', { to: 'png' }), W('convert-model', 'PDF', 'Render', { to: 'pdf' })],
    tools: [W('cad-info', 'Measure', 'Volume'), W('model-drawing', 'Drawing', 'Views', { to: 'pdf' }), W('repair-model', 'Repair', 'Mesh'), W('simplify-model', 'Simplify', 'Half', { keep: 50 }), ZIP],
  },
  layout: {
    convert: [W('convert-layout', 'PDF', 'Print', { to: 'pdf' }), W('convert-layout', 'PNG', 'Pages', { to: 'png' }), W('convert-layout', 'EPUB', 'eBook', { to: 'epub' }), W('convert-layout', 'PPTX', 'Slides', { to: 'pptx' }), W('convert-layout', 'IDML', 'InDesign', { to: 'idml' })],
    tools: [W('edit-layout', 'Edit', 'DesignCraft'), ZIP],
  },
  motion: {
    convert: [W('render-motion', 'MP4', 'Video', { to: 'mp4' }), W('render-motion', 'GIF', 'Loop', { to: 'gif' }), W('render-motion', 'WebM', 'Web', { to: 'webm' }), W('render-motion', 'MOV', 'ProRes', { to: 'mov' })],
    tools: [W('edit-motion', 'Edit', 'EffectCraft'), ZIP],
  },
  timeline: {
    convert: [W('convert-timeline', 'MP4', 'Render', { to: 'mp4' }), W('convert-timeline', 'FCPXML', 'Final Cut', { to: 'fcpxml' }), W('convert-timeline', 'XML', 'Premiere', { to: 'xml' }), W('convert-timeline', 'OTIO', 'Open', { to: 'otio' }), W('convert-timeline', 'EDL', 'CMX', { to: 'edl' }), W('convert-timeline', 'AAF', 'Avid', { to: 'aaf' })],
    tools: [W('edit-timeline', 'Edit', 'FilmCraft'), ZIP],
  },
  archive: {
    convert: [W('extract-archive', 'Extract', 'Unpack'), W('decompress-file', 'Decompress', 'One file'), W('convert-archive', 'ZIP', 'Repack', { format: 'zip' }), W('convert-archive', '7Z', 'Repack', { format: '7z' }), W('convert-archive', 'TAR.GZ', 'Repack', { format: 'tar.gz' }), W('convert-archive', 'TAR.XZ', 'Repack', { format: 'tar.xz' }), W('convert-archive', 'TAR.BZ2', 'Repack', { format: 'tar.bz2' })],
    tools: [W('test-archive', 'Test', 'Check'), HASH],
  },
  subtitle: {
    convert: [W('convert-subtitles', 'SRT', 'SubRip', { to: 'srt' }), W('convert-subtitles', 'VTT', 'WebVTT', { to: 'vtt' }), W('convert-subtitles', 'ASS', 'Styled', { to: 'ass' }), W('convert-subtitles', 'SAMI', 'SMI', { to: 'smi' }), W('convert-subtitles', 'LRC', 'Lyrics', { to: 'lrc' }), W('convert-subtitles', 'TTML', 'Timed text', { to: 'ttml' }), W('convert-subtitles', 'SUB', 'MicroDVD', { to: 'sub' })],
    tools: [ZIP],
  },
  data: {
    convert: [W('convert-data', 'JSON', 'Data', { to: 'json' }, { not: ['json'] }), W('convert-data', 'YAML', 'Config', { to: 'yaml' }, { not: ['yaml', 'yml'] }), W('convert-data', 'TOML', 'Config', { to: 'toml' }, { not: ['toml'] }), W('convert-data', 'XML', 'Markup', { to: 'xml' }, { not: ['xml'] }), W('convert-data', 'CSV', 'Table', { to: 'csv' }), W('convert-data', 'XLSX', 'Excel', { to: 'xlsx' }), W('convert-data', 'JSONL', 'Lines', { to: 'jsonl' }, { not: ['jsonl', 'ndjson'] }), W('convert-document', 'PDF', 'Document', { to: 'pdf' }, { not: ['toml', 'jsonl', 'ndjson'] })],
    tools: [ZIP, HASH],
  },
  contacts: { convert: [W('convert-contacts', 'CSV', 'Table', { to: 'csv' }), W('convert-contacts', 'XLSX', 'Excel', { to: 'xlsx' }), W('convert-contacts', 'JSON', 'Data', { to: 'json' })], tools: [ZIP, HASH] },
  folder: { convert: [ZIP, W('create-archive', '7Z', 'Archive', { format: '7z' }), W('create-archive', 'TAR.GZ', 'Archive', { format: 'tar.gz' }), W('create-archive', 'TAR.XZ', 'Archive', { format: 'tar.xz' })], tools: [] },
  any: { convert: [ZIP, W('create-archive', '7Z', 'Archive', { format: '7z' })], tools: [HASH] },
};
const IMAGE_TARGETS = { jpg: ['JPG', 'Photo'], png: ['PNG', 'Lossless'], webp: ['WebP', 'Web'], heic: ['HEIC', 'iPhone'], avif: ['AVIF', 'Smallest'], pdf: ['PDF', 'Document'], tiff: ['TIFF', 'Print'], psd: ['PSD', 'Layers'], gif: ['GIF', 'Classic'], apng: ['APNG', 'Animated'], ico: ['ICO', 'Icon'], icns: ['ICNS', 'Mac icon'], cur: ['CUR', 'Cursor'] };
const IMAGE_RINGS = {
  photo: ['jpg', 'png', 'webp', 'heic', 'avif', 'pdf', 'tiff', 'psd', 'gif', 'ico'],
  graphic: ['png', 'jpg', 'webp', 'ico', 'icns', 'pdf', 'avif', 'tiff', 'gif', 'heic'],
  motion: ['gif', 'webp', 'apng', 'png', 'jpg', 'pdf', 'tiff', 'avif', 'heic', 'ico'],
  icon: ['png', 'ico', 'icns', 'cur', 'jpg', 'webp', 'pdf', 'tiff', 'gif', 'avif'],
};
const RING_KIND = { png: 'graphic', svg: 'graphic', gif: 'motion', apng: 'motion', ico: 'icon', icns: 'icon', cur: 'icon' };
const SAME = { jpeg: 'jpg', jfif: 'jpg', tif: 'tiff', heif: 'heic', hif: 'heic' };
function imageRing(files) {
  const exts = [...new Set(files.map((f) => SAME[U.ext(f)] || U.ext(f)))], kinds = [...new Set(exts.map((e) => RING_KIND[e] || 'photo'))];
  return IMAGE_RINGS[kinds.length === 1 ? kinds[0] : 'photo'].filter((to) => to !== exts[0] || exts.length > 1).slice(0, 9).map((to) => W('convert-image', ...IMAGE_TARGETS[to], { to }));
}
const MULTI = {
  pdf: [W('merge-pdf', 'Merge', 'One PDF'), W('compare-pdf', 'Compare', 'Changes'), W('compress-pdf', 'Compress', 'Each')],
  image: [W('jpg-to-pdf', 'PDF', 'One file', { combine: 'one' }), W('scan-to-pdf', 'Scan', 'Clean PDF'), W('collage', 'Collage', 'Grid'), W('images-to-gif', 'GIF', 'Animate'), W('images-to-video', 'Slideshow', 'MP4'), W('hdr-merge', 'HDR', 'Merge'), W('panorama', 'Panorama', 'Stitch'), W('images-to-cbz', 'CBZ', 'Comic')],
  raw: [W('hdr-merge', 'HDR', 'Merge'), W('panorama', 'Panorama', 'Stitch'), W('jpg-to-pdf', 'PDF', 'One file', { combine: 'one' })],
  cad3d: [W('merge-models', 'Merge', 'One model')],
  cad2d: [W('cad-compare', 'Compare', 'Changes')],
  video: [W('merge-media', 'Merge', 'One video')],
  audio: [W('merge-media', 'Merge', 'One track'), W('mix-tracks', 'Mix', 'Together')],
  sheet: [W('merge-sheets', 'Merge', 'One workbook')],
  doc: [W('compare-docs', 'Compare', 'Changes')],
  slides: [W('merge-slides', 'Merge', 'One deck')],
  mixed: [W('merge-documents', 'One PDF', 'Merge all')],
  media: [W('add-audio', 'Soundtrack', 'Replace', { mode: 'replace' }), W('add-audio', 'Mix', 'Add music', { mode: 'mix' }), W('merge-media', 'Merge', 'One video')],
};
const SINGLE_OUTPUT = new Set(['mix-tracks', 'compare-docs', 'merge-slides', 'hdr-batch', 'scan-to-pdf', 'compare-pdf', 'images-to-cbz', 'create-archive', 'merge-media', 'add-audio', 'merge-pdf', 'merge-documents', 'merge-sheets', 'collage', 'images-to-gif', 'images-to-video', 'hdr-merge', 'panorama', 'merge-models']);

const groupsOf = (files) => [...new Set(files.map(groupOf))];
const EDITOR_FILE = { image: 'imgedit.js', media: 'mediaedit.js', studio: 'studio.js', web: 'vendor/weblibs.js' };
require('./diagramtools').register({ TOOLS, WHEELS, EDITOR_FILE, W, each });
const unshipped = new Set(TOOLS.filter((t) => { const f = EDITOR_FILE[String(t.editor).split(':')[0]]; return f && !require('fs').existsSync(path.join(__dirname, '..', 'renderer', f)); }).map((t) => t.id));
if (unshipped.size) {
  TOOLS.splice(0, TOOLS.length, ...TOOLS.filter((t) => !unshipped.has(t.id)));
  for (const w of Object.values(WHEELS)) for (const k of ['convert', 'tools']) if (w[k]) w[k] = w[k].filter((x) => !unshipped.has(x.tool));
}
const get = (id) => TOOLS.find((t) => t.id === id);
function accepts(t, files) {
  if (!t || t.noFiles) return false;
  if (t.ok && !t.ok(files)) return false;
  if (t.max && files.length > t.max) return false;
  if (t.min && files.length < t.min) return false;
  if (t.extAccept && files.every((f) => t.extAccept.includes(U.ext(f)))) return true;
  if (t.accepts.includes('any')) return true;
  return groupsOf(files).every((g) => t.accepts.includes(g));
}
const toolsFor = (files) => TOOLS.filter((t) => accepts(t, files)).map((t) => t.id);
const extsFor = (t) => (t.accepts.includes('any') ? [] : [...new Set([...t.accepts.flatMap((g) => [...(U.GROUPS[g] || []), ...(MORE_GROUPS[g] || [])]), ...(t.extAccept || [])])]);
const dedupe = (list) => list.filter((w, i) => list.findIndex((x) => x.tool === w.tool && x.label === w.label) === i);
function wheelsFor(files) {
  const gs = groupsOf(files);
  const g = gs.length === 1 ? gs[0] : gs.every((x) => x === 'image' || x === 'raw') ? 'image' : 'mixed';
  const base = g === 'image' ? { ...WHEELS.image, convert: imageRing(files) } : WHEELS[g] || WHEELS.any;
  const norm = (e) => ({ jpeg: 'jpg', tif: 'tiff', htm: 'html', markdown: 'md' })[e] || e;
  const ex = (f) => (/\.kepub\.epub$/i.test(f) ? 'kepub' : U.ext(f));
  const ok = (w) => accepts(get(w.tool), files) && (!w.only || files.every((f) => w.only.includes(ex(f)))) && !(w.not && files.some((f) => w.not.includes(ex(f))))
    && !(/^convert-(document|sheet|slides)$/.test(w.tool) && files.every((f) => norm(U.ext(f)) === norm(w.opts?.to))) && (!FFMPEG_TARGETS.has(w.tool) || !w.opts?.to || media().supports(w.opts.to));
  const quick = (w) => (w.full || w.ask ? w : { ...w, quick: true });
  if (files.length < 2) return { convert: base.convert.filter(ok).map(quick), tools: base.tools.filter(ok) };
  const multi = [...(MULTI[g] || [])];
  if (g === 'mixed' && gs.every((x) => ['doc', 'sheet', 'slides', 'pdf', 'image', 'raw', 'vector', 'cad2d', 'layout', 'ebook'].includes(x))) multi.push(...MULTI.mixed);
  if (g === 'mixed' && gs.every((x) => x === 'video' || x === 'audio')) multi.push(...MULTI.media);
  const all = W('create-archive', 'ZIP', 'All files', { format: 'zip' });
  const convert = g === 'mixed' ? [...multi, all] : [...base.convert.slice(0, 7).map(quick), all];
  const tools = [...multi, ...(g === 'mixed' ? [] : base.tools.filter((w) => !get(w.tool)?.editor).slice(0, 5)), all];
  return { convert: dedupe(convert.filter(ok)).slice(0, 10), tools: dedupe(tools.filter(ok)).slice(0, 10) };
}
const catalog = () => TOOLS.map(({ run, ext, single, outName, ok, ...meta }) => (FFMPEG_TARGETS.has(meta.id) ? { ...meta, options: meta.options.map((o) => (o.key === 'to' ? { ...o, choices: o.choices.filter(([v]) => media().supports(v)) } : o)) } : meta));
function suggest(id, files, opts = {}) {
  const t = get(id);
  if (!t || t.save === 'none' || t.save === 'inplace' || t.editor) return { kind: 'none' };
  const first = files[0];
  const stem = t.stem || (first ? U.base(first) : 'Lime');
  if (files.length > 1 && !SINGLE_OUTPUT.has(t.id) && !(t.id === 'jpg-to-pdf' && opts.combine !== 'each')) return { kind: 'dir' };
  if ((t.save === 'folder' && !t.single?.(opts)) || (t.folderWhen && Object.entries(t.folderWhen).every(([k, v]) => opts[k] === v))) {
    return { kind: 'folder', name: t.id === 'extract-archive' ? arc().stem(first) : `${stem}${t.suffix ?? ''}${t.folderWhen ? ' - pages' : ''}` };
  }
  if (t.outName) { const name = t.outName(files, opts); return { kind: 'file', name, ext: U.ext(name) }; }
  let e = typeof t.ext === 'function' ? t.ext(opts, files) : t.ext;
  if (!e) e = U.ext(first) === 'jpeg' ? 'jpg' : U.ext(first);
  if (e === 'tif') e = 'tiff';
  if (t.id === 'create-archive') return { kind: 'file', name: arc().archiveName(files, e), ext: e };
  if (t.id === 'convert-archive') return { kind: 'file', name: `${['gz', 'bz2', 'xz'].includes(e) ? path.basename(first).replace(/\.[^.]+$/, '') : arc().stem(first)}.${e}`, ext: e };
  const name = t.id === 'create-archive' && files.length > 1 ? path.basename(path.dirname(first)) || 'Archive' : stem;
  const suffix = t.single?.(opts) ? ' - extract' : t.suffix ?? (U.ext(first) === e ? '-converted' : '');
  return { kind: 'file', name: `${name}${suffix}.${e}`, ext: e };
}

module.exports = { TOOLS, WHEELS, MULTI, catalog, get, toolsFor, extsFor, wheelsFor, groupOf, groupsOf, suggest, accepts };
