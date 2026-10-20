'use strict';
const U = require('./engines/util');
const { fsp, path } = U;

const lazy = (name) => () => require(`./engines/${name}`);
const pdf = lazy('pdf'), img = lazy('image'), media = lazy('media'), arc = lazy('archive'), office = lazy('office'), cad = lazy('cad'), craft = lazy('crafts');

const choice = (key, label, choices, def, extra = {}) => ({ key, type: 'choice', label, choices, default: def ?? choices[0][0], ...extra });
const select = (key, label, choices, def, extra = {}) => ({ key, type: 'select', label, choices, default: def ?? choices[0][0], ...extra });
const text = (key, label, def = '', extra = {}) => ({ key, type: 'text', label, default: def, ...extra });
const num = (key, label, def, extra = {}) => ({ key, type: 'number', label, default: def, ...extra });
const range = (key, label, def, min, max, extra = {}) => ({ key, type: 'range', label, default: def, min, max, step: 1, ...extra });
const toggle = (key, label, def = false, extra = {}) => ({ key, type: 'toggle', label, default: def, ...extra });
const pages = (key = 'pages', label = 'Pages', def = 'all', extra = {}) => ({ key, type: 'pages', label, default: def, placeholder: '1-3, 5, 8-', ...extra });
const color = (key, label, def) => ({ key, type: 'color', label, default: def });
const password = (key, label, extra = {}) => ({ key, type: 'password', label, default: '', ...extra });
const file = (key, label, filters, extra = {}) => ({ key, type: 'file', label, filters, default: '', ...extra });
const level = (def = 'recommended') => choice('level', 'Compression', [['low', 'Light'], ['recommended', 'Balanced'], ['extreme', 'Strong']], def);
const pdfPassword = password('password', 'Password, if locked', { advanced: true });

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
const LANGS = [['eng', 'English'], ['spa', 'Spanish'], ['fra', 'French'], ['deu', 'German'], ['ita', 'Italian'], ['por', 'Portuguese'], ['nld', 'Dutch'], ['rus', 'Russian'], ['ara', 'Arabic'], ['hin', 'Hindi'], ['jpn', 'Japanese'], ['chi_sim', 'Chinese'], ['kor', 'Korean']];
const CAD2D_OUT = [['pdf', 'PDF'], ['svg', 'SVG'], ['png', 'PNG'], ['jpg', 'JPG'], ['dxf', 'DXF (R12)'], ['ai', 'Illustrator (AI)'], ['eps', 'EPS'], ['emf', 'EMF']];
const CAD3D_OUT = [['stl', 'STL'], ['obj', 'OBJ'], ['glb', 'GLB'], ['3mf', '3MF'], ['ply', 'PLY'], ['png', 'PNG render'], ['pdf', 'PDF render']];

const TOOLS = [
  { id: 'edit-pdf', cat: 'pdf', name: 'Edit PDF', desc: 'Change text, add text, images, shapes and highlights.', accepts: ['pdf'], max: 1, editor: 'edit' },
  { id: 'sign-pdf', cat: 'pdf', name: 'Sign PDF', desc: 'Draw, type or place a signature.', accepts: ['pdf'], max: 1, editor: 'sign' },
  { id: 'organize-pdf', cat: 'pdf', name: 'Organize pages', desc: 'Reorder, rotate, delete and insert pages.', accepts: ['pdf'], max: 1, editor: 'pages' },
  { id: 'merge-pdf', cat: 'pdf', name: 'Merge PDF', desc: 'Combine PDFs and images into one PDF.', accepts: ['pdf', 'image'], min: 2, ordered: true, ext: 'pdf', suffix: ' - merged',
    run: async (files, opts, ctx) => {
      const tmp = await U.tmpDir('merge');
      const list = [];
      for (const f of files) { if (U.groupOf(f) === 'pdf') list.push(f); else { const p = path.join(tmp, `${list.length}.pdf`); await pdf().imagesToPdf([f], { pageSize: 'fit' }, p); list.push(p); } }
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
    options: [level(), pdfPassword], run: each((f, o, c) => pdf().compress(f, o, outFile('-compressed', 'pdf')(f, c), c)) },
  { id: 'optimize-pdf', cat: 'pdf', name: 'Optimize PDF', desc: 'PdfCraft rebuilds and slims the file.', accepts: ['pdf'], ext: 'pdf', suffix: '-optimized', craft: 'pdfcraft',
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
    options: [choice('dpi', 'Resolution', [['96', 'Small'], ['150', 'Standard'], ['300', 'Sharp']], '150'), pages(), pdfPassword], run: each((f, o, c) => pdf().toComic(f, o, outFile('', 'cbz')(f, c), c)) },
  { id: 'pdf-to-markdown', cat: 'pdf', name: 'PDF to Markdown', desc: 'Headings, paragraphs, lists and pictures as Markdown.', accepts: ['pdf'], ext: 'md', options: [pdfPassword], run: each((f, o, c) => pdf().toMarkdown(f, o, outFile('', 'md')(f, c), c)) },
  { id: 'pdf-to-text', cat: 'pdf', name: 'PDF to text', desc: 'All text as a plain-text file.', accepts: ['pdf'], ext: 'txt', options: [pdfPassword], run: each((f, o, c) => pdf().toText(f, o, outFile('', 'txt')(f, c))) },
  { id: 'pdf-to-html', cat: 'pdf', name: 'PDF to HTML', desc: 'A web page that keeps the layout.', accepts: ['pdf'], ext: 'html', options: [pdfPassword], run: each((f, o, c) => pdf().toHtml(f, o, outFile('', 'html')(f, c))) },
  { id: 'pdf-to-svg', cat: 'pdf', name: 'PDF to SVG', desc: 'Vector artwork via VectorCraft.', accepts: ['pdf'], ext: 'svg', craft: 'vectorcraft', run: each((f, o, c) => craft().vector(f, { to: 'svg' }, c)) },
  { id: 'to-pdf', cat: 'pdf', name: 'Make PDF', desc: 'Documents, slides, sheets, drawings or images to PDF.', accepts: ['doc', 'sheet', 'slides', 'vector', 'cad2d', 'layout', 'image', 'raw'], ext: 'pdf',
    run: each((f, o, c) => office().anyToPdf(f, c)) },
  { id: 'jpg-to-pdf', cat: 'pdf', name: 'Images to PDF', desc: 'One PDF from photos, scans or screenshots.', accepts: IMAGE_IN, ordered: true, ext: 'pdf',
    options: [choice('combine', 'Output', [['one', 'One PDF'], ['each', 'One per image']]), select('pageSize', 'Page size', [['fit', 'Same as image'], ['a4', 'A4'], ['letter', 'Letter'], ['legal', 'Legal'], ['a3', 'A3']]), choice('orientation', 'Orientation', [['auto', 'Auto'], ['portrait', 'Portrait'], ['landscape', 'Landscape']], 'auto', { when: { pageSize: ['a4', 'letter', 'legal', 'a3'] } }), choice('margin', 'Margin', [['none', 'None'], ['small', 'Small'], ['large', 'Large']])],
    run: async (files, o, c) => (o.combine === 'each' ? each((f, oo, cc) => pdf().imagesToPdf([f], oo, outFile('', 'pdf')(f, cc), cc))(files, o, c) : [await pdf().imagesToPdf(files, o, c.out.file(files[0], files.length > 1 ? `${U.base(files[0])} and ${files.length - 1} more.pdf` : `${U.base(files[0])}.pdf`), c)]) },
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
    options: [choice('kind', 'Watermark', [['text', 'Text'], ['image', 'Image']]), text('text', 'Text', 'CONFIDENTIAL', { when: { kind: 'text' } }), file('image', 'Image', [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }], { when: { kind: 'image' } }), choice('layout', 'Layout', [['single', 'Once'], ['tiled', 'Tiled']]), range('opacity', 'Opacity', 30, 5, 100, { unit: '%' }), range('rotation', 'Angle', 45, -90, 90, { unit: '°' }), color('color', 'Colour', '#d13438'), range('scale', 'Image size', 40, 5, 100, { unit: '%', when: { kind: 'image' } }), pages()],
    run: each((f, o, c) => pdf().watermark(f, o, outFile('-watermarked', 'pdf')(f, c))) },
  { id: 'crop-pdf', cat: 'pdf', name: 'Crop PDF', desc: 'Trim page margins.', accepts: ['pdf'], ext: 'pdf', suffix: '-cropped',
    options: [num('top', 'Top (mm)', 10, { min: 0 }), num('bottom', 'Bottom (mm)', 10, { min: 0 }), num('left', 'Left (mm)', 10, { min: 0 }), num('right', 'Right (mm)', 10, { min: 0 }), pages()],
    run: each((f, o, c) => pdf().crop(f, o, outFile('-cropped', 'pdf')(f, c))) },
  { id: 'redact-pdf', cat: 'pdf', name: 'Redact PDF', desc: 'Permanently remove words, emails and numbers.', accepts: ['pdf'], ext: 'pdf', suffix: '-redacted',
    options: [{ key: 'terms', type: 'textarea', label: 'Words or phrases, one per line', default: '' }, { key: 'patterns', type: 'multi', label: 'Also find', choices: [['email', 'Emails'], ['phone', 'Phones'], ['card', 'Cards'], ['iban', 'IBANs']], default: [] }, toggle('boxes', 'Black boxes', true), pdfPassword],
    run: each((f, o, c) => pdf().redact(f, o, outFile('-redacted', 'pdf')(f, c))) },
  { id: 'audit-pdf', cat: 'pdf', name: 'Check redactions', desc: 'PdfCraft finds text hidden under black boxes.', accepts: ['pdf'], save: 'none', craft: 'pdfcraft', run: each((f, o, c) => craft().auditPdf(f, o, c)) },
  { id: 'protect-pdf', cat: 'pdf', name: 'Protect PDF', desc: 'AES-256 password and permissions.', accepts: ['pdf'], ext: 'pdf', suffix: '-protected',
    options: [password('userPassword', 'Password to open', { required: true }), toggle('allowPrint', 'Allow printing', true), toggle('allowCopy', 'Allow copying', true), toggle('allowEdit', 'Allow editing', false)],
    run: each((f, o, c) => pdf().protect(f, o, outFile('-protected', 'pdf')(f, c))) },
  { id: 'unlock-pdf', cat: 'pdf', name: 'Unlock PDF', desc: 'Remove the password from a PDF you can open.', accepts: ['pdf'], ext: 'pdf', suffix: '-unlocked',
    options: [password('password', 'Current password', { required: true })], run: each((f, o, c) => pdf().unlock(f, o, outFile('-unlocked', 'pdf')(f, c))) },
  { id: 'ocr-pdf', cat: 'pdf', name: 'Searchable PDF', desc: 'Recognise text in scans so you can search and copy it.', accepts: ['pdf'], ext: 'pdf', suffix: '-searchable',
    options: [select('lang', 'Language', LANGS), toggle('skipText', 'Skip pages that already have text', true), choice('dpi', 'Quality', [['200', 'Fast'], ['300', 'Accurate']], '300'), pdfPassword],
    run: each((f, o, c) => pdf().ocr(f, o, outFile('-searchable', 'pdf')(f, c), c)) },
  { id: 'repair-pdf', cat: 'pdf', name: 'Repair PDF', desc: 'Rebuild damaged PDFs.', accepts: ['pdf'], ext: 'pdf', suffix: '-repaired', run: each((f, o, c) => pdf().repair(f, outFile('-repaired', 'pdf')(f, c))) },
  { id: 'flatten-pdf', cat: 'pdf', name: 'Flatten PDF', desc: 'Lock forms and annotations into the page.', accepts: ['pdf'], ext: 'pdf', suffix: '-flattened', run: each((f, o, c) => pdf().flatten(f, outFile('-flattened', 'pdf')(f, c))) },
  { id: 'extract-images-pdf', cat: 'pdf', name: 'Extract images', desc: 'Every embedded picture at full quality.', accepts: ['pdf'], save: 'folder', suffix: ' - embedded images',
    options: [choice('format', 'Save as', [['png', 'PNG'], ['jpg', 'JPG']]), pdfPassword], run: each((f, o, c) => pdf().extractImages(f, o, c)) },

  { id: 'convert-image', cat: 'image', name: 'Convert image', desc: 'JPG, PNG, WebP, AVIF, HEIC in, TIFF, GIF, BMP, ICO, PSD and more.', accepts: IMAGE_IN, ext: (o) => o.to,
    options: [select('to', 'Convert to', [['jpg', 'JPG'], ['png', 'PNG'], ['webp', 'WebP'], ['avif', 'AVIF'], ['tiff', 'TIFF'], ['gif', 'GIF'], ['bmp', 'BMP'], ['ico', 'ICO'], ['psd', 'Photoshop (PSD)'], ['pdf', 'PDF'], ['jxl', 'JPEG XL']]), range('quality', 'Quality', 88, 30, 100, { unit: '%', when: { to: ['jpg', 'webp', 'avif'] } })],
    run: each((f, o, c) => {
      if (o.to === 'pdf') return pdf().imagesToPdf([f], { pageSize: 'fit' }, outFile('', 'pdf')(f, c), c);
      const e = U.ext(f);
      if (o.to === 'psd' || ['psb', 'pcraft', 'exr', 'dpx'].includes(e)) return craft().photo(f, { ...o, to: o.to === 'tiff' ? 'tif' : o.to }, c);
      if (e === 'psd') return craft().photo(f, { ...o, to: o.to === 'tiff' ? 'tif' : o.to }, c).catch(() => img().convert(f, o, c));
      if (U.groupOf(f) === 'raw' && o.develop !== false && ['jpg', 'png', 'tiff', 'avif', 'webp'].includes(o.to)) return craft().develop(f, { to: o.to === 'tiff' ? 'tif' : o.to, quality: o.quality }, c).catch(() => img().convert(f, o, c));
      return img().convert(f, o, c);
    }) },
  { id: 'develop-raw', cat: 'image', name: 'Develop RAW', desc: 'LightCraft develops camera RAW into a finished photo.', accepts: ['raw', 'image'], craft: 'lightcraft', ext: (o) => o.to,
    options: [select('to', 'Save as', [['jpg', 'JPG'], ['tif', 'TIFF (16-bit)'], ['png', 'PNG'], ['avif', 'AVIF'], ['jxl', 'JPEG XL'], ['dng', 'DNG']]), toggle('auto', 'Auto-adjust light and colour', true), num('size', 'Long edge (px)', '', { placeholder: 'Full size' }), range('quality', 'Quality', 92, 50, 100, { unit: '%' })],
    run: each((f, o, c) => craft().develop(f, o, c)) },
  { id: 'enhance-photo', cat: 'image', name: 'Auto enhance', desc: 'LightCraft balances exposure, contrast and colour.', accepts: ['raw', 'image'], craft: 'lightcraft', ext: (o, files) => (['png', 'tif', 'tiff'].includes(U.ext(files[0] || '')) ? 'png' : 'jpg'), suffix: '-enhanced',
    run: each((f, o, c) => craft().develop(f, { to: ['png', 'tif', 'tiff'].includes(U.ext(f)) ? 'png' : 'jpg', auto: true, quality: 92 }, c)) },
  { id: 'hdr-merge', cat: 'image', name: 'HDR merge', desc: 'Blend bracketed exposures into one HDR photo.', accepts: ['raw', 'image'], min: 2, craft: 'lightcraft', ext: 'jpg', suffix: '-HDR', run: async (files, o, c) => [await craft().merge(files, { mode: 'hdr' }, c)] },
  { id: 'panorama', cat: 'image', name: 'Panorama', desc: 'Stitch overlapping photos into one wide image.', accepts: ['raw', 'image'], min: 2, craft: 'lightcraft', ext: 'jpg', suffix: '-Pano', run: async (files, o, c) => [await craft().merge(files, { mode: 'panorama' }, c)] },
  { id: 'compress-image', cat: 'image', name: 'Compress image', desc: 'Smaller JPG, PNG, WebP and GIF files.', accepts: IMAGE_IN, suffix: '-compressed', ext: (o, files) => { const e = U.ext(files[0] || ''); return ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'tiff', 'tif'].includes(e) ? (e === 'jpeg' ? 'jpg' : e === 'tif' ? 'tiff' : e) : 'jpg'; },
    options: [level(), num('maxSide', 'Longest side (px)', '', { advanced: true, placeholder: 'Keep size' })], run: each((f, o, c) => img().compress(f, o, c)) },
  { id: 'resize-image', cat: 'image', name: 'Resize image', desc: 'Exact pixels or a percentage.', accepts: IMAGE_IN, suffix: '-resized', ext: (o, files) => keepExt(files[0]),
    options: [choice('mode', 'Resize by', [['pixels', 'Pixels'], ['percent', 'Percent']]), num('width', 'Width (px)', 1920, { when: { mode: 'pixels' } }), num('height', 'Height (px)', '', { when: { mode: 'pixels' }, placeholder: 'Auto' }), range('percent', 'Scale', 50, 5, 400, { unit: '%', when: { mode: 'percent' } }), toggle('noEnlarge', 'Don’t enlarge', true)],
    run: each((f, o, c) => img().resize(f, o, c)) },
  { id: 'crop-image', cat: 'image', name: 'Crop image', desc: 'Smart crop to a ratio, or exact pixels.', accepts: IMAGE_IN, suffix: '-cropped', ext: (o, files) => keepExt(files[0]),
    options: [select('aspect', 'Shape', [['1:1', 'Square'], ['4:5', 'Portrait 4:5'], ['3:2', 'Photo 3:2'], ['16:9', 'Wide 16:9'], ['9:16', 'Story 9:16'], ['custom', 'Exact pixels']]), toggle('smart', 'Keep the subject in frame', true, { when: { aspect: ['1:1', '4:5', '3:2', '16:9', '9:16'] } }), num('left', 'Left', 0, { when: { aspect: 'custom' } }), num('top', 'Top', 0, { when: { aspect: 'custom' } }), num('width', 'Width', 1000, { when: { aspect: 'custom' } }), num('height', 'Height', 1000, { when: { aspect: 'custom' } })],
    run: each((f, o, c) => img().crop(f, o, c)) },
  { id: 'remove-background', cat: 'image', name: 'Remove background', desc: 'Cut out the subject, on device.', accepts: IMAGE_IN, ext: 'png', suffix: '-cutout',
    options: [choice('quality', 'Quality', [['best', 'Best'], ['fast', 'Fast']]), select('background', 'Background', [['transparent', 'Transparent'], ['#ffffff', 'White'], ['#000000', 'Black']])],
    run: each((f, o, c) => img().removeBackground(f, o, c)) },
  { id: 'upscale-image', cat: 'image', name: 'Upscale image', desc: 'Enlarge 2×, 3× or 4× with sharp detail.', accepts: IMAGE_IN, suffix: '-upscaled', ext: (o, files) => (keepExt(files[0]) === 'gif' ? 'png' : keepExt(files[0])),
    options: [choice('factor', 'Enlarge', [['2', '2×'], ['3', '3×'], ['4', '4×']], '2')], run: each((f, o, c) => img().upscale(f, { ...o, method: 'classic' }, c)) },
  { id: 'rotate-image', cat: 'image', name: 'Rotate & flip', desc: 'Rotate or mirror.', accepts: IMAGE_IN, suffix: '-rotated', ext: (o, files) => keepExt(files[0]),
    options: [choice('angle', 'Rotate', [['0', 'None'], ['90', '90° right'], ['180', '180°'], ['270', '90° left']], '90'), choice('flip', 'Flip', [['none', 'None'], ['horizontal', 'Mirror'], ['vertical', 'Upside down']])], run: each((f, o, c) => img().rotate(f, o, c)) },
  { id: 'adjust-image', cat: 'image', name: 'Adjust photo', desc: 'Brightness, contrast, colour and filters.', accepts: IMAGE_IN, suffix: '-edited', ext: (o, files) => keepExt(files[0]),
    options: [range('brightness', 'Brightness', 0, -100, 100), range('contrast', 'Contrast', 0, -100, 100), range('saturation', 'Saturation', 0, -100, 100), select('filter', 'Filter', [['none', 'None'], ['grayscale', 'Black & white'], ['sepia', 'Sepia'], ['vintage', 'Vintage'], ['invert', 'Invert']]), range('sharpen', 'Sharpen', 0, 0, 100), range('blur', 'Blur', 0, 0, 100)],
    run: each((f, o, c) => img().adjust(f, o, c)) },
  { id: 'watermark-image', cat: 'image', name: 'Watermark image', desc: 'Text or logo on photos.', accepts: IMAGE_IN, suffix: '-watermarked', ext: (o, files) => keepExt(files[0]),
    options: [choice('kind', 'Watermark', [['text', 'Text'], ['image', 'Logo']]), text('text', 'Text', '© Your name', { when: { kind: 'text' } }), file('image', 'Logo', [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }], { when: { kind: 'image' } }), choice('layout', 'Layout', [['single', 'Once'], ['tiled', 'Tiled']]), select('position', 'Position', [['bottom-right', 'Bottom right'], ['bottom-left', 'Bottom left'], ['top-right', 'Top right'], ['top-left', 'Top left'], ['center', 'Centre']], 'bottom-right', { when: { layout: 'single' } }), range('opacity', 'Opacity', 50, 5, 100, { unit: '%' }), color('color', 'Colour', '#ffffff')],
    run: each((f, o, c) => img().watermark(f, o, c)) },
  { id: 'strip-metadata', cat: 'image', name: 'Remove photo info', desc: 'Strip EXIF, GPS and camera data.', accepts: IMAGE_IN, suffix: '-clean', ext: (o, files) => keepExt(files[0]), run: each((f, o, c) => img().strip(f, o, c)) },
  { id: 'collage', cat: 'image', name: 'Collage', desc: 'Photos in a neat grid.', accepts: IMAGE_IN, min: 2, ordered: true, ext: 'jpg', stem: 'Collage',
    options: [num('columns', 'Columns', '', { placeholder: 'Auto' }), range('gap', 'Spacing', 12, 0, 60, { unit: 'px' }), color('background', 'Background', '#ffffff')],
    run: async (files, o, c) => [await img().collage(files, o, c.out.file(files[0], 'Collage.jpg'))] },
  { id: 'images-to-gif', cat: 'image', name: 'Make GIF', desc: 'Animate images into a looping GIF.', accepts: IMAGE_IN, min: 2, ordered: true, ext: 'gif', stem: 'Animation',
    options: [range('seconds', 'Seconds each', 1, 1, 10, { unit: 's' }), num('width', 'Width (px)', 600)], run: async (files, o, c) => [await media().imagesToGif(files, o, c)] },
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
  { id: 'screenshot-url', cat: 'image', name: 'Web page to image', desc: 'Full-length screenshot of a web page.', accepts: [], noFiles: true, ext: 'png',
    options: [text('url', 'Web address', '', { placeholder: 'https://example.com', required: true })], run: async (files, o, c) => [await office().urlToPdf(o.url, { format: 'png' }, c)] },

  { id: 'convert-video', cat: 'media', name: 'Convert video', desc: 'MP4, MOV, WebM, MKV, HEVC, GIF and audio.', accepts: ['video'], ext: (o) => (o.to === 'hevc' ? 'mp4' : o.to),
    options: [select('to', 'Convert to', [['mp4', 'MP4 (H.264)'], ['hevc', 'MP4 (HEVC)'], ['mov', 'MOV'], ['webm', 'WebM'], ['mkv', 'MKV'], ['avi', 'AVI'], ['gif', 'GIF'], ['mp3', 'MP3 audio'], ['m4a', 'M4A audio'], ['wav', 'WAV audio']]), choice('quality', 'Quality', [['high', 'High'], ['balanced', 'Balanced'], ['small', 'Small']], 'balanced'), select('height', 'Resolution', [['', 'Original'], ['2160', '4K'], ['1080', '1080p'], ['720', '720p'], ['480', '480p']])],
    run: each((f, o, c) => media().convertVideo(f, o, c)) },
  { id: 'compress-video', cat: 'media', name: 'Compress video', desc: 'Shrink for email, chat and uploads.', accepts: ['video'], ext: 'mp4', suffix: '-compressed',
    options: [choice('mode', 'Target', [['level', 'Quality'], ['size', 'File size']]), level(), num('targetMB', 'Target size (MB)', 25, { when: { mode: 'size' } }), select('height', 'Resolution', [['', 'Original'], ['1080', '1080p'], ['720', '720p'], ['480', '480p']])],
    run: each((f, o, c) => media().compressVideo(f, o, c)) },
  { id: 'trim-media', cat: 'media', name: 'Trim', desc: 'Cut a clip by start and end time.', accepts: ['video', 'audio'], suffix: '-trimmed',
    options: [{ key: 'start', type: 'time', label: 'Start', default: '0:00', required: true }, { key: 'end', type: 'time', label: 'End', default: '', placeholder: 'End of file' }, toggle('precise', 'Frame-accurate (slower)', false)],
    run: each((f, o, c) => media().trim(f, o, c)) },
  { id: 'merge-media', cat: 'media', name: 'Merge clips', desc: 'Join clips end to end.', accepts: ['video', 'audio'], min: 2, ordered: true, ext: (o, files) => (files.some((f) => U.groupOf(f) === 'video') ? 'mp4' : o.to || 'mp3'), suffix: ' - merged',
    options: [select('to', 'Audio format', [['mp3', 'MP3'], ['m4a', 'M4A'], ['wav', 'WAV'], ['flac', 'FLAC']])], run: async (files, o, c) => [await media().merge(files, o, c)] },
  { id: 'extract-audio', cat: 'media', name: 'Extract audio', desc: 'Save a video’s soundtrack.', accepts: ['video'], ext: (o) => o.to,
    options: [select('to', 'Format', [['mp3', 'MP3'], ['m4a', 'M4A'], ['wav', 'WAV'], ['flac', 'FLAC'], ['ogg', 'OGG'], ['opus', 'Opus']]), select('bitrate', 'Quality', [['320k', '320 kbps'], ['192k', '192 kbps'], ['128k', '128 kbps']], '192k')],
    run: each((f, o, c) => media().extractAudio(f, o, c)) },
  { id: 'convert-audio', cat: 'media', name: 'Convert audio', desc: 'MP3, M4A, WAV, FLAC, OGG, Opus, AIFF and more.', accepts: ['audio'], ext: (o) => o.to,
    options: [select('to', 'Convert to', [['mp3', 'MP3'], ['m4a', 'M4A'], ['wav', 'WAV'], ['flac', 'FLAC'], ['ogg', 'OGG'], ['opus', 'Opus'], ['aiff', 'AIFF'], ['wma', 'WMA'], ['ac3', 'AC3']]), select('bitrate', 'Quality', [['320k', '320 kbps'], ['256k', '256 kbps'], ['192k', '192 kbps'], ['128k', '128 kbps']], '192k'), toggle('mono', 'Mono', false, { advanced: true })],
    run: each((f, o, c) => media().convertAudio(f, o, c)) },
  { id: 'compress-audio', cat: 'media', name: 'Compress audio', desc: 'Lower bitrate, smaller file.', accepts: ['audio'], suffix: '-compressed', ext: (o, files) => (['mp3', 'm4a', 'ogg', 'opus', 'aac'].includes(U.ext(files[0] || '')) ? U.ext(files[0]) : 'mp3'), options: [level()], run: each((f, o, c) => media().compressAudio(f, o, c)) },
  { id: 'video-to-gif', cat: 'media', name: 'Video to GIF', desc: 'A moment as a crisp GIF.', accepts: ['video'], ext: 'gif',
    options: [{ key: 'start', type: 'time', label: 'Start', default: '0:00' }, num('duration', 'Seconds', 5), range('fps', 'Frames per second', 12, 5, 30), num('width', 'Width (px)', 480)],
    run: each((f, o, c) => media().toGif(f, o, c)) },
  { id: 'mute-video', cat: 'media', name: 'Mute video', desc: 'Remove the sound, no re-encode.', accepts: ['video'], suffix: '-muted', run: each((f, o, c) => media().mute(f, o, c)) },
  { id: 'resize-video', cat: 'media', name: 'Resize video', desc: '4K, 1080p, 720p and more.', accepts: ['video'], suffix: '-resized',
    options: [select('height', 'Resolution', [['2160', '4K'], ['1080', '1080p'], ['720', '720p'], ['480', '480p'], ['360', '360p']], '720')], run: each((f, o, c) => media().resizeVideo(f, o, c)) },
  { id: 'rotate-video', cat: 'media', name: 'Rotate video', desc: 'Fix sideways or mirrored video.', accepts: ['video'], suffix: '-rotated',
    options: [choice('angle', 'Rotate', [['90', '90° right'], ['180', '180°'], ['270', '90° left']], '90'), choice('flip', 'Flip', [['none', 'None'], ['horizontal', 'Mirror'], ['vertical', 'Upside down']])], run: each((f, o, c) => media().rotateVideo(f, o, c)) },
  { id: 'speed-media', cat: 'media', name: 'Change speed', desc: 'Faster or slower, pitch kept.', accepts: ['video', 'audio'], suffix: '-speed',
    options: [select('factor', 'Speed', [['0.5', '0.5×'], ['0.75', '0.75×'], ['1.25', '1.25×'], ['1.5', '1.5×'], ['2', '2×'], ['3', '3×']], '1.5')], run: each((f, o, c) => media().speed(f, o, c)) },
  { id: 'video-frames', cat: 'media', name: 'Video to images', desc: 'Frames at an interval or a fixed count.', accepts: ['video'], save: 'folder', suffix: ' - frames',
    options: [choice('mode', 'Save', [['every', 'Every N seconds'], ['count', 'Fixed number']]), num('every', 'Seconds between', 1, { when: { mode: 'every' } }), num('count', 'Frames', 12, { when: { mode: 'count' } }), choice('format', 'Format', [['jpg', 'JPG'], ['png', 'PNG']])],
    run: each((f, o, c) => media().frames(f, o, c)) },
  { id: 'burn-subtitles', cat: 'media', name: 'Add subtitles', desc: 'Burn SRT, VTT or ASS captions into video.', accepts: ['video'], suffix: '-subtitled',
    options: [file('subtitles', 'Subtitle file', [{ name: 'Subtitles', extensions: ['srt', 'vtt', 'ass', 'ssa'] }], { required: true }), range('size', 'Text size', 22, 12, 48)], run: each((f, o, c) => media().burnSubtitles(f, o, c)) },
  { id: 'normalize-audio', cat: 'media', name: 'Level loudness', desc: 'Even out volume to −16 LUFS.', accepts: ['audio', 'video'], suffix: '-normalized', run: each((f, o, c) => media().normalize(f, o, c)) },
  { id: 'images-to-video', cat: 'media', name: 'Slideshow', desc: 'MP4 from photos, with optional music.', accepts: IMAGE_IN, min: 1, ordered: true, ext: 'mp4', stem: 'Slideshow',
    options: [range('seconds', 'Seconds each', 3, 1, 15, { unit: 's' }), select('size', 'Size', [['1920x1080', '1080p landscape'], ['1080x1920', '1080p portrait'], ['1080x1080', 'Square']]), file('audio', 'Music (optional)', [{ name: 'Audio', extensions: ['mp3', 'm4a', 'wav', 'aac', 'ogg', 'flac'] }])],
    run: async (files, o, c) => [await media().imagesToVideo(files, o, c)] },
  { id: 'convert-subtitles', cat: 'media', name: 'Convert subtitles', desc: 'SRT, VTT and ASS.', accepts: ['subtitle'], ext: (o) => o.to,
    options: [choice('to', 'Convert to', [['srt', 'SRT'], ['vtt', 'VTT'], ['ass', 'ASS']])], run: each((f, o, c) => media().convertSubtitles(f, o, c)) },
  { id: 'render-motion', cat: 'media', name: 'Render animation', desc: 'EffectCraft renders Lottie and EffectCraft projects to video.', accepts: ['motion'], craft: 'effectcraft', ext: (o) => o.to,
    options: [select('to', 'Render as', [['mp4', 'MP4'], ['gif', 'GIF'], ['webm', 'WebM'], ['mov', 'MOV (ProRes)']]), select('resolution', 'Resolution', [['full', 'Full'], ['half', 'Half'], ['quarter', 'Quarter']])],
    run: each((f, o, c) => craft().motion(f, o, c)) },
  { id: 'convert-timeline', cat: 'media', name: 'Convert timeline', desc: 'FilmCraft converts and renders editing timelines.', accepts: ['timeline'], craft: 'filmcraft', ext: (o) => o.to,
    options: [select('to', 'Convert to', [['mp4', 'MP4 (render)'], ['fcpxml', 'Final Cut (FCPXML)'], ['xml', 'Premiere / Resolve (XML)'], ['otio', 'OpenTimelineIO'], ['edl', 'EDL'], ['aaf', 'Avid (AAF)']])],
    run: each((f, o, c) => craft().timeline(f, o, c)) },

  { id: 'convert-document', cat: 'docs', name: 'Convert document', desc: 'PDF, Word, Markdown, HTML, EPUB, RTF, text and more.', accepts: ['doc', 'data'], ext: (o) => o.to,
    options: [select('to', 'Convert to', [['pdf', 'PDF'], ['docx', 'Word (DOCX)'], ['md', 'Markdown'], ['html', 'Web page'], ['txt', 'Plain text'], ['epub', 'eBook (EPUB)'], ['rtf', 'Rich text (RTF)'], ['odt', 'OpenDocument']])],
    run: each((f, o, c) => office().convertDocument(f, o, c)) },
  { id: 'convert-sheet', cat: 'docs', name: 'Convert spreadsheet', desc: 'XLSX, CSV, JSON, HTML, ODS and PDF.', accepts: ['sheet'], ext: (o) => o.to,
    options: [select('to', 'Convert to', [['xlsx', 'Excel (XLSX)'], ['csv', 'CSV'], ['pdf', 'PDF'], ['json', 'JSON'], ['html', 'HTML'], ['ods', 'OpenDocument'], ['md', 'Markdown'], ['xls', 'Excel 97']]), toggle('allSheets', 'Every sheet (CSV, JSON)', true, { when: { to: ['csv', 'tsv', 'json'] } })],
    run: each((f, o, c) => office().convertSheet(f, o.to, c, o)) },
  { id: 'convert-slides', cat: 'docs', name: 'Convert slides', desc: 'PowerPoint and Keynote to PDF, images, HTML and text.', accepts: ['slides'], ext: (o) => o.to, folderWhen: { to: 'png' }, suffix: '',
    options: [select('to', 'Convert to', [['pdf', 'PDF'], ['png', 'Images (PNG)'], ['html', 'Web page'], ['txt', 'Text'], ['md', 'Markdown'], ['pptx', 'PowerPoint']])],
    run: each((f, o, c) => office().convertSlides(f, o.to, c)) },
  { id: 'json-to-sheet', cat: 'docs', name: 'JSON to spreadsheet', desc: 'Turn JSON arrays into a table.', accepts: [], extAccept: ['json'], ext: (o) => o.to,
    options: [select('to', 'Convert to', [['xlsx', 'Excel'], ['csv', 'CSV'], ['html', 'HTML'], ['md', 'Markdown']])], run: each((f, o, c) => office().convertSheet(f, o.to, c, o)) },
  { id: 'merge-documents', cat: 'docs', name: 'Merge into one PDF', desc: 'Documents, sheets, slides, drawings, PDFs and images.', accepts: ['doc', 'sheet', 'slides', 'pdf', 'image', 'raw', 'vector', 'cad2d', 'layout'], min: 2, ordered: true, ext: 'pdf', suffix: ' - combined',
    run: async (files, o, c) => {
      const tmp = await U.tmpDir('mergedocs');
      const list = [];
      for (let i = 0; i < files.length; i++) { c.progress((i / files.length) * 0.85, `Converting ${path.basename(files[i])}`); list.push(await office().anyToPdf(files[i], { ...c, progress: () => {} }, path.join(tmp, `${i}.pdf`))); }
      const out = c.out.file(files[0], `${U.base(files[0])} - combined.pdf`);
      await pdf().merge(list, out, { progress: (f) => c.progress(0.85 + f * 0.15, 'Merging') });
      fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
      return [out];
    } },
  { id: 'merge-sheets', cat: 'docs', name: 'Merge spreadsheets', desc: 'One workbook, or stacked rows.', accepts: ['sheet'], min: 2, ordered: true, ext: 'xlsx', stem: 'Merged workbook',
    options: [choice('mode', 'How', [['sheets', 'Sheet per file'], ['stack', 'Stack rows']]), toggle('skipHeaders', 'Keep one header row', true, { when: { mode: 'stack' } })],
    run: async (files, o, c) => [await office().mergeSheets(files, o, c)] },
  { id: 'convert-layout', cat: 'docs', name: 'Convert layout', desc: 'DesignCraft exports InDesign IDML and INDD to PDF, images, EPUB or PowerPoint.', accepts: ['layout'], craft: 'designcraft', ext: (o) => o.to, folderWhen: { to: 'png' }, suffix: '',
    options: [select('to', 'Export as', [['pdf', 'PDF'], ['png', 'Page images'], ['epub', 'EPUB'], ['pptx', 'PowerPoint'], ['idml', 'IDML']])], run: each((f, o, c) => craft().layout(f, o, c)) },

  { id: 'convert-vector', cat: 'cad', name: 'Convert vector', desc: 'VectorCraft converts AI, EPS, SVG, PDF, DXF, EMF and Affinity files.', accepts: ['vector'], extAccept: ['svg', 'svgz', 'pdf', 'dxf'], craft: 'vectorcraft', ext: (o) => o.to,
    options: [select('to', 'Convert to', [['svg', 'SVG'], ['pdf', 'PDF'], ['ai', 'Illustrator (AI)'], ['eps', 'EPS'], ['png', 'PNG'], ['dxf', 'DXF'], ['emf', 'EMF'], ['psd', 'Photoshop (PSD)']]), num('scale', 'Image scale', 2, { when: { to: ['png', 'psd'] }, min: 1 }), toggle('outlineText', 'Text as outlines', false, { when: { to: 'svg' }, advanced: true })],
    run: each((f, o, c) => craft().vector(f, o, c)) },
  { id: 'convert-cad', cat: 'cad', name: 'Convert drawing', desc: 'DWG and DXF to PDF, SVG, PNG, DXF, AI or EPS.', accepts: ['cad2d'], ext: (o) => o.to,
    options: [select('to', 'Convert to', CAD2D_OUT), select('sheet', 'PDF sheet', [['a3', 'A3'], ['a4', 'A4'], ['tabloid', 'Tabloid'], ['letter', 'Letter']], 'a3', { when: { to: 'pdf' } }), toggle('mono', 'Black lines', false), num('size', 'Image width (px)', 3000, { when: { to: ['png', 'jpg'] } })],
    run: each((f, o, c) => cad().convert(f, o, c)) },
  { id: 'convert-model', cat: 'cad', name: 'Convert 3D model', desc: 'STEP, IGES, STL, OBJ, GLB, 3MF and PLY.', accepts: ['cad3d'], ext: (o) => o.to,
    options: [select('to', 'Convert to', CAD3D_OUT)], run: each((f, o, c) => cad().convert(f, o, c)) },
  { id: 'cad-info', cat: 'cad', name: 'Measure', desc: 'Size, area, volume, layers and entity counts.', accepts: ['cad2d', 'cad3d'], save: 'none',
    options: [toggle('save', 'Save a report', false)], run: each((f, o, c) => cad().report(f, o, c)) },

  { id: 'extract-archive', cat: 'archive', name: 'Extract', desc: 'ZIP, RAR, 7Z, TAR, GZ, ISO and 40 more.', accepts: ['archive'], save: 'folder', suffix: '',
    options: [password('password', 'Password, if any')], run: each((f, o, c) => arc().extract(f, o, c)) },
  { id: 'create-archive', cat: 'archive', name: 'Compress', desc: 'ZIP, 7Z or TAR with an optional password.', accepts: ['any'], ext: (o) => o.format || 'zip', suffix: '',
    options: [choice('format', 'Format', [['zip', 'ZIP'], ['7z', '7Z'], ['tar.gz', 'TAR.GZ'], ['tar.xz', 'TAR.XZ']]), range('level', 'Level', 5, 0, 9), password('password', 'Password (optional)', { when: { format: ['zip', '7z'] } })],
    run: async (files, o, c) => [await arc().compress(files, o, c)] },
  { id: 'convert-archive', cat: 'archive', name: 'Convert archive', desc: 'Repack as ZIP, 7Z or TAR.GZ.', accepts: ['archive'], ext: (o) => o.format,
    options: [choice('format', 'Convert to', [['zip', 'ZIP'], ['7z', '7Z'], ['tar.gz', 'TAR.GZ']]), password('password', 'Password, if any', { advanced: true })], run: each((f, o, c) => arc().convert(f, o, c)) },
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
];
function keepExt(f) { const e = U.ext(f || ''); return ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'tiff', 'tif'].includes(e) ? (e === 'jpeg' ? 'jpg' : e === 'tif' ? 'tiff' : e) : 'png'; }

const W = (tool, label, hint, opts = {}, extra = {}) => ({ tool, label, hint, opts, ...extra });
const ZIP = W('create-archive', 'ZIP', 'Archive', { format: 'zip' });
const HASH = W('file-hash', 'SHA-256', 'Checksum');
const WHEELS = {
  pdf: {
    convert: [W('pdf-to-word', 'DOCX', 'Word'), W('pdf-to-jpg', 'JPG', 'Pages', { format: 'jpg' }, { full: true }), W('pdf-to-jpg', 'PNG', 'Pages', { format: 'png' }, { full: true }), W('pdf-to-excel', 'XLSX', 'Excel', { to: 'xlsx' }), W('pdf-to-powerpoint', 'PPTX', 'PowerPoint'), W('pdf-to-text', 'TXT', 'Text'), W('pdf-to-html', 'HTML', 'Web'), W('pdf-to-svg', 'SVG', 'Vector'), W('pdf-to-markdown', 'MD', 'Markdown'), W('pdf-to-tiff', 'TIFF', 'All pages')],
    tools: [W('compress-pdf', 'Compress', 'Smaller'), W('edit-pdf', 'Edit', 'Text & more'), W('sign-pdf', 'Sign', 'Signature'), W('organize-pdf', 'Pages', 'Organize'), W('ocr-pdf', 'OCR', 'Searchable'), W('protect-pdf', 'Protect', 'Password'), W('optimize-pdf', 'Optimize', 'Rebuild'), W('split-pdf', 'Split', 'Pages')],
  },
  image: {
    convert: [W('convert-image', 'JPG', 'Photo', { to: 'jpg' }), W('convert-image', 'PNG', 'Lossless', { to: 'png' }), W('convert-image', 'WebP', 'Web', { to: 'webp' }), W('convert-image', 'AVIF', 'Smallest', { to: 'avif' }), W('convert-image', 'PDF', 'Document', { to: 'pdf' }), W('convert-image', 'PSD', 'Layers', { to: 'psd' }), W('convert-image', 'TIFF', 'Print', { to: 'tiff' }), W('convert-image', 'GIF', 'Classic', { to: 'gif' }), W('convert-image', 'ICO', 'Icon', { to: 'ico' })],
    tools: [W('compress-image', 'Compress', 'Smaller'), W('remove-background', 'Cut out', 'Subject'), W('image-to-text', 'Text', 'Copy text'), W('enhance-photo', 'Enhance', 'Auto'), W('resize-image', 'Resize', '50%', { mode: 'percent', percent: 50 }), W('upscale-image', 'Upscale', '2×', { factor: '2' }), W('crop-image', 'Square', 'Smart', { aspect: '1:1' }), W('rotate-image', 'Rotate', '90°', { angle: '90', flip: 'none' }), W('strip-metadata', 'Clean', 'No EXIF')],
  },
  raw: {
    convert: [W('develop-raw', 'JPG', 'Develop', { to: 'jpg', auto: false }), W('develop-raw', 'TIFF', '16-bit', { to: 'tif', auto: false }), W('develop-raw', 'PNG', 'Lossless', { to: 'png', auto: false }), W('develop-raw', 'AVIF', 'Small', { to: 'avif', auto: false }), W('develop-raw', 'DNG', 'Raw', { to: 'dng', auto: false }), W('convert-image', 'Preview', 'Built-in', { to: 'jpg', develop: false })],
    tools: [W('enhance-photo', 'Enhance', 'Auto'), W('develop-raw', 'Develop', 'Options', {}, { ask: true }), W('strip-metadata', 'Clean', 'No EXIF'), W('image-to-text', 'Text', 'OCR')],
  },
  video: {
    convert: [W('convert-video', 'MP4', 'Universal', { to: 'mp4' }), W('convert-video', 'MOV', 'Apple', { to: 'mov' }), W('convert-video', 'WebM', 'Web', { to: 'webm' }), W('video-to-gif', 'GIF', 'Clip', {}, { full: true }), W('extract-audio', 'MP3', 'Audio', { to: 'mp3' }), W('convert-video', 'HEVC', 'Smaller', { to: 'hevc' }), W('convert-video', 'MKV', 'Archive', { to: 'mkv' }), W('extract-audio', 'WAV', 'Audio', { to: 'wav' })],
    tools: [W('compress-video', 'Compress', 'Smaller'), W('trim-media', 'Trim', 'Cut'), W('mute-video', 'Mute', 'No sound'), W('resize-video', '720p', 'Resize', { height: '720' }), W('rotate-video', 'Rotate', '90°', { angle: '90', flip: 'none' }), W('video-frames', 'Frames', 'Per second'), W('normalize-audio', 'Level', 'Loudness'), W('speed-media', 'Speed', '1.5×', { factor: '1.5' })],
  },
  audio: {
    convert: [W('convert-audio', 'MP3', 'Universal', { to: 'mp3' }), W('convert-audio', 'M4A', 'Apple', { to: 'm4a' }), W('convert-audio', 'WAV', 'Studio', { to: 'wav' }), W('convert-audio', 'FLAC', 'Lossless', { to: 'flac' }), W('convert-audio', 'AIFF', 'Mac', { to: 'aiff' }), W('convert-audio', 'OGG', 'Open', { to: 'ogg' }), W('convert-audio', 'Opus', 'Voice', { to: 'opus' })],
    tools: [W('compress-audio', 'Compress', 'Smaller'), W('normalize-audio', 'Level', 'Loudness'), W('trim-media', 'Trim', 'Cut'), W('speed-media', 'Speed', '1.5×', { factor: '1.5' })],
  },
  doc: {
    convert: [W('convert-document', 'PDF', 'Document', { to: 'pdf' }), W('convert-document', 'DOCX', 'Word', { to: 'docx' }), W('convert-document', 'MD', 'Markdown', { to: 'md' }), W('convert-document', 'TXT', 'Text', { to: 'txt' }), W('convert-document', 'HTML', 'Web', { to: 'html' }), W('convert-document', 'EPUB', 'eBook', { to: 'epub' }), W('convert-document', 'RTF', 'Rich text', { to: 'rtf' })],
    tools: [ZIP, HASH],
  },
  sheet: {
    convert: [W('convert-sheet', 'XLSX', 'Excel', { to: 'xlsx' }), W('convert-sheet', 'CSV', 'Plain', { to: 'csv' }), W('convert-sheet', 'PDF', 'Document', { to: 'pdf' }), W('convert-sheet', 'JSON', 'Data', { to: 'json' }), W('convert-sheet', 'HTML', 'Table', { to: 'html' }), W('convert-sheet', 'ODS', 'Open', { to: 'ods' }), W('convert-sheet', 'MD', 'Markdown', { to: 'md' })],
    tools: [ZIP, HASH],
  },
  slides: {
    convert: [W('convert-slides', 'PDF', 'Document', { to: 'pdf' }), W('convert-slides', 'PNG', 'Slides', { to: 'png' }), W('convert-slides', 'HTML', 'Web', { to: 'html' }), W('convert-slides', 'TXT', 'Text', { to: 'txt' }), W('convert-slides', 'MD', 'Outline', { to: 'md' }), W('convert-slides', 'PPTX', 'PowerPoint', { to: 'pptx' })],
    tools: [ZIP, HASH],
  },
  vector: {
    convert: [W('convert-vector', 'SVG', 'Web', { to: 'svg' }), W('convert-vector', 'PDF', 'Document', { to: 'pdf' }), W('convert-vector', 'AI', 'Illustrator', { to: 'ai' }), W('convert-vector', 'EPS', 'Print', { to: 'eps' }), W('convert-vector', 'PNG', 'Image', { to: 'png' }), W('convert-vector', 'DXF', 'CAD', { to: 'dxf' }), W('convert-vector', 'EMF', 'Office', { to: 'emf' }), W('convert-vector', 'PSD', 'Layers', { to: 'psd' })],
    tools: [ZIP, HASH],
  },
  cad2d: {
    convert: [W('convert-cad', 'PDF', 'Sheet', { to: 'pdf' }), W('convert-cad', 'SVG', 'Vector', { to: 'svg' }), W('convert-cad', 'PNG', 'Image', { to: 'png' }), W('convert-cad', 'DXF', 'R12', { to: 'dxf' }), W('convert-cad', 'AI', 'Illustrator', { to: 'ai' }), W('convert-cad', 'EPS', 'Print', { to: 'eps' }), W('convert-cad', 'JPG', 'Photo', { to: 'jpg' })],
    tools: [W('cad-info', 'Measure', 'Size'), W('convert-cad', 'Mono', 'Black PDF', { to: 'pdf', mono: true }), ZIP],
  },
  cad3d: {
    convert: [W('convert-model', 'STL', '3D print', { to: 'stl' }), W('convert-model', 'OBJ', 'Universal', { to: 'obj' }), W('convert-model', 'GLB', 'Web & AR', { to: 'glb' }), W('convert-model', '3MF', 'Print', { to: '3mf' }), W('convert-model', 'PLY', 'Scan', { to: 'ply' }), W('convert-model', 'PNG', 'Render', { to: 'png' }), W('convert-model', 'PDF', 'Render', { to: 'pdf' })],
    tools: [W('cad-info', 'Measure', 'Volume'), ZIP],
  },
  layout: {
    convert: [W('convert-layout', 'PDF', 'Print', { to: 'pdf' }), W('convert-layout', 'PNG', 'Pages', { to: 'png' }), W('convert-layout', 'EPUB', 'eBook', { to: 'epub' }), W('convert-layout', 'PPTX', 'Slides', { to: 'pptx' }), W('convert-layout', 'IDML', 'InDesign', { to: 'idml' })],
    tools: [ZIP],
  },
  motion: {
    convert: [W('render-motion', 'MP4', 'Video', { to: 'mp4' }), W('render-motion', 'GIF', 'Loop', { to: 'gif' }), W('render-motion', 'WebM', 'Web', { to: 'webm' }), W('render-motion', 'MOV', 'ProRes', { to: 'mov' })],
    tools: [ZIP],
  },
  timeline: {
    convert: [W('convert-timeline', 'MP4', 'Render', { to: 'mp4' }), W('convert-timeline', 'FCPXML', 'Final Cut', { to: 'fcpxml' }), W('convert-timeline', 'XML', 'Premiere', { to: 'xml' }), W('convert-timeline', 'OTIO', 'Open', { to: 'otio' }), W('convert-timeline', 'EDL', 'CMX', { to: 'edl' }), W('convert-timeline', 'AAF', 'Avid', { to: 'aaf' })],
    tools: [ZIP],
  },
  archive: {
    convert: [W('extract-archive', 'Extract', 'Unpack'), W('convert-archive', 'ZIP', 'Repack', { format: 'zip' }), W('convert-archive', '7Z', 'Repack', { format: '7z' }), W('convert-archive', 'TAR.GZ', 'Repack', { format: 'tar.gz' })],
    tools: [W('test-archive', 'Test', 'Check'), HASH],
  },
  subtitle: { convert: [W('convert-subtitles', 'SRT', 'SubRip', { to: 'srt' }), W('convert-subtitles', 'VTT', 'WebVTT', { to: 'vtt' }), W('convert-subtitles', 'ASS', 'Styled', { to: 'ass' })], tools: [ZIP] },
  data: { convert: [W('json-to-sheet', 'XLSX', 'Excel', { to: 'xlsx' }), W('json-to-sheet', 'CSV', 'Table', { to: 'csv' }), W('convert-document', 'PDF', 'Document', { to: 'pdf' }), W('convert-document', 'TXT', 'Text', { to: 'txt' })], tools: [ZIP, HASH] },
  folder: { convert: [ZIP, W('create-archive', '7Z', 'Archive', { format: '7z' }), W('create-archive', 'TAR.GZ', 'Archive', { format: 'tar.gz' })], tools: [] },
  any: { convert: [ZIP, W('create-archive', '7Z', 'Archive', { format: '7z' })], tools: [HASH] },
};
const MULTI = {
  pdf: [W('merge-pdf', 'Merge', 'One PDF'), W('compress-pdf', 'Compress', 'Each')],
  image: [W('jpg-to-pdf', 'PDF', 'One file', { combine: 'one' }), W('collage', 'Collage', 'Grid'), W('images-to-gif', 'GIF', 'Animate'), W('images-to-video', 'Slideshow', 'MP4'), W('hdr-merge', 'HDR', 'Merge'), W('panorama', 'Panorama', 'Stitch')],
  raw: [W('hdr-merge', 'HDR', 'Merge'), W('panorama', 'Panorama', 'Stitch'), W('jpg-to-pdf', 'PDF', 'One file', { combine: 'one' })],
  video: [W('merge-media', 'Merge', 'One video')],
  audio: [W('merge-media', 'Merge', 'One track')],
  sheet: [W('merge-sheets', 'Merge', 'One workbook')],
  mixed: [W('merge-documents', 'One PDF', 'Merge all')],
};
const SINGLE_OUTPUT = new Set(['create-archive', 'merge-media', 'merge-pdf', 'merge-documents', 'merge-sheets', 'collage', 'images-to-gif', 'images-to-video', 'hdr-merge', 'panorama']);

const groupsOf = (files) => [...new Set(files.map(U.groupOf))];
const get = (id) => TOOLS.find((t) => t.id === id);
function accepts(t, files) {
  if (!t || t.noFiles) return false;
  if (t.max && files.length > t.max) return false;
  if (t.min && files.length < t.min) return false;
  if (t.extAccept && files.every((f) => t.extAccept.includes(U.ext(f)))) return true;
  if (t.accepts.includes('any')) return true;
  return groupsOf(files).every((g) => t.accepts.includes(g));
}
const toolsFor = (files) => TOOLS.filter((t) => accepts(t, files)).map((t) => t.id);
const dedupe = (list) => list.filter((w, i) => list.findIndex((x) => x.tool === w.tool && x.label === w.label) === i);
function wheelsFor(files) {
  const gs = groupsOf(files);
  const g = gs.length === 1 ? gs[0] : gs.every((x) => x === 'image' || x === 'raw') ? 'image' : 'mixed';
  const base = WHEELS[g] || WHEELS.any;
  const norm = (e) => ({ jpeg: 'jpg', tif: 'tiff', htm: 'html', markdown: 'md' })[e] || e;
  const ok = (w) => accepts(get(w.tool), files) && !(/^convert-(document|sheet|slides)$/.test(w.tool) && files.every((f) => norm(U.ext(f)) === norm(w.opts?.to)));
  const quick = (w) => (w.full || w.ask ? w : { ...w, quick: true });
  if (files.length < 2) return { convert: base.convert.filter(ok).map(quick), tools: base.tools.filter(ok) };
  const multi = [...(MULTI[g] || [])];
  if (g === 'mixed' && gs.every((x) => ['doc', 'sheet', 'slides', 'pdf', 'image', 'raw', 'vector', 'cad2d', 'layout'].includes(x))) multi.push(...MULTI.mixed);
  const all = W('create-archive', 'ZIP', 'All files', { format: 'zip' });
  const convert = g === 'mixed' ? [...multi, all] : [...base.convert.slice(0, 7).map(quick), all];
  const tools = [...multi, ...(g === 'mixed' ? [] : base.tools.filter((w) => !get(w.tool)?.editor).slice(0, 5)), all];
  return { convert: dedupe(convert.filter(ok)).slice(0, 10), tools: dedupe(tools.filter(ok)).slice(0, 10) };
}
const catalog = () => TOOLS.map(({ run, ext, single, ...meta }) => meta);
function archiveStem(f) { return path.basename(f).replace(/\.(tar\.(gz|bz2|xz|zst)|t[gbx]z|tbz2|[^.]+)$/i, '') || 'Extracted'; }
function suggest(id, files, opts = {}) {
  const t = get(id);
  if (!t || t.save === 'none' || t.save === 'inplace' || t.editor) return { kind: 'none' };
  const first = files[0];
  const stem = t.stem || (first ? U.base(first) : 'Lime');
  if (files.length > 1 && !SINGLE_OUTPUT.has(t.id) && !(t.id === 'jpg-to-pdf' && opts.combine !== 'each')) return { kind: 'dir' };
  if ((t.save === 'folder' && !t.single?.(opts)) || (t.folderWhen && Object.entries(t.folderWhen).every(([k, v]) => opts[k] === v))) {
    return { kind: 'folder', name: t.id === 'extract-archive' ? archiveStem(first) : `${stem}${t.suffix ?? ''}${t.folderWhen ? ' - pages' : ''}` };
  }
  let e = typeof t.ext === 'function' ? t.ext(opts, files) : t.ext;
  if (!e) e = U.ext(first) === 'jpeg' ? 'jpg' : U.ext(first);
  if (e === 'tif') e = 'tiff';
  const name = t.id === 'create-archive' && files.length > 1 ? path.basename(path.dirname(first)) || 'Archive' : stem;
  const suffix = t.single?.(opts) ? ' - extract' : t.suffix ?? (U.ext(first) === e ? '-converted' : '');
  return { kind: 'file', name: `${name}${suffix}.${e}`, ext: e };
}

module.exports = { TOOLS, catalog, get, toolsFor, wheelsFor, groupsOf, suggest, accepts };
