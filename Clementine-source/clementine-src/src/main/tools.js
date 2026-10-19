'use strict';
// The tool catalog. Metadata is sent to the UI (forms are generated from `options`); `run` executes in an engine worker.
const U = require('./engines/util');
const { fsp, path } = U;

const lazy = (name) => () => require(`./engines/${name}`);
const pdf = lazy('pdf'), img = lazy('image'), media = lazy('media'), arc = lazy('archive'), office = lazy('office');

/* ---------- option helpers ---------- */
const choice = (key, label, choices, def, extra = {}) => ({ key, type: 'choice', label, choices, default: def ?? choices[0][0], ...extra });
const select = (key, label, choices, def, extra = {}) => ({ key, type: 'select', label, choices, default: def ?? choices[0][0], ...extra });
const text = (key, label, def = '', extra = {}) => ({ key, type: 'text', label, default: def, ...extra });
const num = (key, label, def, extra = {}) => ({ key, type: 'number', label, default: def, ...extra });
const range = (key, label, def, min, max, extra = {}) => ({ key, type: 'range', label, default: def, min, max, step: 1, ...extra });
const toggle = (key, label, def = false, extra = {}) => ({ key, type: 'toggle', label, default: def, ...extra });
const pages = (key = 'pages', label = 'Pages', def = 'all', extra = {}) => ({ key, type: 'pages', label, default: def, placeholder: 'e.g. 1-3, 5, 8-', ...extra });
const color = (key, label, def) => ({ key, type: 'color', label, default: def });
const password = (key, label, extra = {}) => ({ key, type: 'password', label, default: '', ...extra });
const file = (key, label, filters, extra = {}) => ({ key, type: 'file', label, filters, default: '', ...extra });
const level = (def = 'recommended') => choice('level', 'Compression', [['low', 'Light', 'Best quality'], ['recommended', 'Recommended', 'Good balance'], ['extreme', 'Strong', 'Smallest file']], def);
const pdfPassword = password('password', 'Password (if the PDF is locked)', { advanced: true });

/** Wrap a per-file engine call. */
const each = (fn) => async (files, opts, ctx) => {
  const out = [];
  for (let i = 0; i < files.length; i++) {
    const sub = { ...ctx, progress: (f, l) => ctx.progress((i + (f || 0)) / files.length, files.length > 1 ? `${l || 'Working'} · file ${i + 1} of ${files.length}` : l) };
    out.push(await fn(files[i], opts, sub));
  }
  return out;
};
const outFile = (suffix, e) => (f, ctx) => ctx.out.file(f, `${U.base(f)}${suffix}.${e}`);

const IMAGE_IN = ['image', 'raw'];
const DOC_IN = ['doc', 'sheet', 'slides', 'vector'];

/* ---------- the catalog ---------- */
const TOOLS = [
  /* ===== PDF ===== */
  { id: 'edit-pdf', cat: 'pdf', name: 'Edit PDF', desc: 'Change or delete existing text, add text, images, shapes and highlights.', icon: 'edit', accepts: ['pdf'], max: 1, editor: 'edit', featured: true },
  { id: 'merge-pdf', cat: 'pdf', name: 'Merge PDF', desc: 'Combine PDFs and images into one PDF, in the order you choose.', icon: 'merge', accepts: ['pdf', 'image'], min: 2, ordered: true, featured: true,
    options: [toggle('bookmarks', 'Add a bookmark for each file', false, { advanced: true })],
    run: async (files, opts, ctx) => {
      const tmp = await U.tmpDir('merge');
      const pdfs = [];
      for (const f of files) {
        if (U.groupOf(f) === 'pdf') pdfs.push(f);
        else { const p = path.join(tmp, `${pdfs.length}.pdf`); await pdf().imagesToPdf([f], { pageSize: 'fit' }, p); pdfs.push(p); }
      }
      const out = ctx.out.file(files[0], `${U.base(files[0])} - merged.pdf`);
      await pdf().merge(pdfs, out, ctx);
      fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
      return [out];
    } },
  { id: 'split-pdf', cat: 'pdf', name: 'Split PDF', desc: 'Separate pages into individual PDFs or split by page ranges.', icon: 'split', accepts: ['pdf'], featured: true,
    options: [choice('mode', 'Split', [['all', 'Every page'], ['ranges', 'By ranges'], ['every', 'Every N pages']]), text('ranges', 'Ranges', '1-3, 4-6', { when: { mode: 'ranges' }, placeholder: 'e.g. 1-3, 4-6, 7-' }), toggle('mergeRanges', 'Save all ranges as one PDF', false, { when: { mode: 'ranges' } }), num('every', 'Pages per file', 2, { when: { mode: 'every' }, min: 1 })],
    run: each((f, o, c) => pdf().split(f, o, c)) },
  { id: 'compress-pdf', cat: 'pdf', name: 'Compress PDF', desc: 'Shrink PDFs by recompressing images and rebuilding the file.', icon: 'compress', accepts: ['pdf'], featured: true,
    options: [level(), pdfPassword], run: each((f, o, c) => pdf().compress(f, o, outFile('-compressed', 'pdf')(f, c), c)) },
  { id: 'pdf-to-word', cat: 'pdf', name: 'PDF to Word', desc: 'Turn PDFs into editable DOCX documents.', icon: 'word', accepts: ['pdf'], featured: true,
    options: [choice('engine', 'Method', [['builtin', 'Editable text', 'Clean paragraphs and headings'], ['libreoffice', 'Keep layout', 'Positions preserved (needs LibreOffice)']]), pdfPassword],
    run: each(async (f, o, c) => (o.engine === 'libreoffice' ? office().viaLibreOffice(f, 'docx', c, { infilter: 'writer_pdf_import' }) : pdf().toWord(f, o, outFile('', 'docx')(f, c), c))) },
  { id: 'pdf-to-powerpoint', cat: 'pdf', name: 'PDF to PowerPoint', desc: 'Make a PPTX with one slide per page and the page text in the notes.', icon: 'powerpoint', accepts: ['pdf'],
    options: [toggle('notes', 'Put page text in speaker notes', true), pdfPassword], run: each((f, o, c) => pdf().toPowerPoint(f, o, outFile('', 'pptx')(f, c), c)) },
  { id: 'pdf-to-excel', cat: 'pdf', name: 'PDF to Excel', desc: 'Rebuild tables from PDFs into spreadsheet rows and columns.', icon: 'excel', accepts: ['pdf'],
    options: [choice('to', 'Format', [['xlsx', 'Excel (XLSX)'], ['csv', 'CSV']]), pdfPassword], run: each((f, o, c) => pdf().toExcel(f, o, outFile('', o.to || 'xlsx')(f, c))) },
  { id: 'pdf-to-jpg', cat: 'pdf', name: 'PDF to JPG', desc: 'Save each page as a picture.', icon: 'image', accepts: ['pdf'], featured: true,
    options: [choice('format', 'Format', [['jpg', 'JPG'], ['png', 'PNG']]), choice('dpi', 'Resolution', [['96', 'Screen', '96 dpi'], ['150', 'Standard', '150 dpi'], ['300', 'Print', '300 dpi']], '150'), pages(), pdfPassword],
    run: each((f, o, c) => pdf().toImages(f, o, c)) },
  { id: 'pdf-to-text', cat: 'pdf', name: 'PDF to Text', desc: 'Pull all text into a plain-text file.', icon: 'text', accepts: ['pdf'], options: [pdfPassword], run: each((f, o, c) => pdf().toText(f, o, outFile('', 'txt')(f, c))) },
  { id: 'pdf-to-html', cat: 'pdf', name: 'PDF to HTML', desc: 'Convert pages into a web page that keeps the layout.', icon: 'code', accepts: ['pdf'], options: [pdfPassword], run: each((f, o, c) => pdf().toHtml(f, o, outFile('', 'html')(f, c))) },
  { id: 'word-to-pdf', cat: 'pdf', name: 'Word to PDF', desc: 'Convert DOCX, DOC, ODT and RTF documents to PDF.', icon: 'word', accepts: ['doc'], featured: true,
    options: [toggle('pdfa', 'Save as PDF/A for archiving', false, { advanced: true })], run: each((f, o, c) => office().convertDocument(f, { ...o, to: 'pdf' }, c)) },
  { id: 'powerpoint-to-pdf', cat: 'pdf', name: 'PowerPoint to PDF', desc: 'Convert PPTX, PPT and ODP presentations to PDF.', icon: 'powerpoint', accepts: ['slides'], run: each((f, o, c) => office().convertDocument(f, { to: 'pdf' }, c)) },
  { id: 'excel-to-pdf', cat: 'pdf', name: 'Excel to PDF', desc: 'Convert spreadsheets to PDF, one section per sheet.', icon: 'excel', accepts: ['sheet'], run: each((f, o, c) => office().convertSheet(f, 'pdf', c)) },
  { id: 'jpg-to-pdf', cat: 'pdf', name: 'JPG to PDF', desc: 'Turn images into a PDF. Works with PNG, HEIC, WebP and more.', icon: 'image_pdf', accepts: IMAGE_IN, ordered: true, featured: true,
    options: [choice('combine', 'Output', [['one', 'One PDF'], ['each', 'One PDF per image']]), select('pageSize', 'Page size', [['fit', 'Same as image'], ['a4', 'A4'], ['letter', 'Letter'], ['legal', 'Legal'], ['a3', 'A3']]), choice('orientation', 'Orientation', [['auto', 'Auto'], ['portrait', 'Portrait'], ['landscape', 'Landscape']], 'auto', { when: { pageSize: ['a4', 'letter', 'legal', 'a3'] } }), choice('margin', 'Margin', [['none', 'None'], ['small', 'Small'], ['large', 'Large']])],
    run: async (files, o, c) => (o.combine === 'each' ? each((f, oo, cc) => pdf().imagesToPdf([f], oo, outFile('', 'pdf')(f, cc), cc))(files, o, c) : [await pdf().imagesToPdf(files, o, c.out.file(files[0], files.length > 1 ? `${U.base(files[0])} and ${files.length - 1} more.pdf` : `${U.base(files[0])}.pdf`), c)]) },
  { id: 'html-to-pdf', cat: 'pdf', name: 'HTML to PDF', desc: 'Save a web page or HTML file as a PDF.', icon: 'globe', accepts: ['doc'], extAccept: ['html', 'htm', 'xhtml'], allowNoFiles: true,
    options: [text('url', 'Web address', '', { placeholder: 'https://example.com', when: { $noFiles: true } }), select('pageSize', 'Page size', [['A4', 'A4'], ['Letter', 'Letter'], ['Legal', 'Legal'], ['A3', 'A3']]), toggle('landscape', 'Landscape')],
    run: async (files, o, c) => (files.length ? each(async (f, oo, cc) => { const out = outFile('', 'pdf')(f, cc); await cc.host('htmlToPdf', { file: f, out, landscape: oo.landscape, pageSize: oo.pageSize }); return out; })(files, o, c) : [await office().urlToPdf(o.url, o, c)]) },
  { id: 'organize-pdf', cat: 'pdf', name: 'Organize PDF', desc: 'Reorder, rotate, delete and insert pages visually.', icon: 'grid', accepts: ['pdf'], max: 1, editor: 'pages' },
  { id: 'remove-pages', cat: 'pdf', name: 'Remove pages', desc: 'Delete the pages you don’t need.', icon: 'delete', accepts: ['pdf'],
    options: [pages('pages', 'Pages to remove', '', { required: true })], run: each((f, o, c) => pdf().removePages(f, o.pages, outFile('-trimmed', 'pdf')(f, c))) },
  { id: 'extract-pages', cat: 'pdf', name: 'Extract pages', desc: 'Copy selected pages into a new PDF.', icon: 'extract', accepts: ['pdf'],
    options: [pages('pages', 'Pages to keep', '1', { required: true })], run: each((f, o, c) => pdf().extract(f, o.pages, outFile(`-pages ${String(o.pages).replace(/\s+/g, '')}`, 'pdf')(f, c))) },
  { id: 'rotate-pdf', cat: 'pdf', name: 'Rotate PDF', desc: 'Turn pages the right way up.', icon: 'rotate', accepts: ['pdf'],
    options: [choice('angle', 'Rotate', [['90', '90° right'], ['180', '180°'], ['270', '90° left']], '90'), pages()], run: each((f, o, c) => pdf().rotate(f, o, outFile('-rotated', 'pdf')(f, c))) },
  { id: 'page-numbers', cat: 'pdf', name: 'Add page numbers', desc: 'Number pages with your choice of position and style.', icon: 'number',
    accepts: ['pdf'], options: [select('position', 'Position', [['bottom-center', 'Bottom centre'], ['bottom-right', 'Bottom right'], ['bottom-left', 'Bottom left'], ['top-center', 'Top centre'], ['top-right', 'Top right'], ['top-left', 'Top left']]), select('format', 'Format', [['{n}', '1'], ['Page {n}', 'Page 1'], ['Page {n} of {total}', 'Page 1 of 9'], ['{n} / {total}', '1 / 9'], ['- {n} -', '- 1 -']]), num('start', 'First number', 1), range('size', 'Text size', 11, 6, 36, { unit: 'pt' }), pages(), color('color', 'Colour', '#333333')],
    run: each((f, o, c) => pdf().pageNumbers(f, o, outFile('-numbered', 'pdf')(f, c))) },
  { id: 'watermark-pdf', cat: 'pdf', name: 'Watermark PDF', desc: 'Stamp text or an image over your pages.', icon: 'stamp', accepts: ['pdf'],
    options: [choice('kind', 'Watermark', [['text', 'Text'], ['image', 'Image']]), text('text', 'Text', 'CONFIDENTIAL', { when: { kind: 'text' } }), file('image', 'Image', [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }], { when: { kind: 'image' } }), choice('layout', 'Layout', [['single', 'Once'], ['tiled', 'Tiled']]), select('position', 'Position', [['center', 'Centre'], ['top-left', 'Top left'], ['top-right', 'Top right'], ['bottom-left', 'Bottom left'], ['bottom-right', 'Bottom right']], 'center', { when: { layout: 'single' } }), range('opacity', 'Opacity', 30, 5, 100, { unit: '%' }), range('rotation', 'Angle', 45, -90, 90, { unit: '°' }), color('color', 'Colour', '#d13438'), range('scale', 'Image size', 40, 5, 100, { unit: '%', when: { kind: 'image' } }), pages()],
    run: each((f, o, c) => pdf().watermark(f, o, outFile('-watermarked', 'pdf')(f, c))) },
  { id: 'crop-pdf', cat: 'pdf', name: 'Crop PDF', desc: 'Trim page margins.', icon: 'crop', accepts: ['pdf'],
    options: [num('top', 'Top (mm)', 10, { min: 0 }), num('bottom', 'Bottom (mm)', 10, { min: 0 }), num('left', 'Left (mm)', 10, { min: 0 }), num('right', 'Right (mm)', 10, { min: 0 }), pages()],
    run: each((f, o, c) => pdf().crop(f, o, outFile('-cropped', 'pdf')(f, c))) },
  { id: 'sign-pdf', cat: 'pdf', name: 'Sign PDF', desc: 'Draw, type or upload a signature and place it.', icon: 'signature', accepts: ['pdf'], max: 1, editor: 'sign', featured: true },
  { id: 'redact-pdf', cat: 'pdf', name: 'Redact PDF', desc: 'Permanently remove sensitive words, emails or numbers.', icon: 'redact', accepts: ['pdf'],
    options: [{ key: 'terms', type: 'textarea', label: 'Words or phrases (one per line)', default: '' }, { key: 'patterns', type: 'multi', label: 'Also find', choices: [['email', 'Email addresses'], ['phone', 'Phone numbers'], ['card', 'Card numbers'], ['ssn', 'US SSNs'], ['iban', 'IBANs']], default: [] }, toggle('boxes', 'Cover with black boxes', true), pdfPassword],
    run: each((f, o, c) => pdf().redact(f, o, outFile('-redacted', 'pdf')(f, c))) },
  { id: 'protect-pdf', cat: 'pdf', name: 'Protect PDF', desc: 'Encrypt with a password (AES-256) and limit printing or copying.', icon: 'lock', accepts: ['pdf'],
    options: [password('userPassword', 'Password to open', { required: true }), toggle('allowPrint', 'Allow printing', true), toggle('allowCopy', 'Allow copying text', true), toggle('allowEdit', 'Allow editing', false), password('ownerPassword', 'Separate permissions password', { advanced: true })],
    run: each((f, o, c) => pdf().protect(f, o, outFile('-protected', 'pdf')(f, c))) },
  { id: 'unlock-pdf', cat: 'pdf', name: 'Unlock PDF', desc: 'Remove the password and restrictions from a PDF you can open.', icon: 'unlock', accepts: ['pdf'],
    options: [password('password', 'Current password')], run: each((f, o, c) => pdf().unlock(f, o, outFile('-unlocked', 'pdf')(f, c))) },
  { id: 'ocr-pdf', cat: 'pdf', name: 'OCR PDF', desc: 'Make scanned PDFs searchable and selectable.', icon: 'scan', accepts: ['pdf'], featured: true,
    options: [select('lang', 'Document language', [['eng', 'English'], ['spa', 'Spanish'], ['fra', 'French'], ['deu', 'German'], ['ita', 'Italian'], ['por', 'Portuguese'], ['nld', 'Dutch'], ['pol', 'Polish'], ['rus', 'Russian'], ['tur', 'Turkish'], ['ara', 'Arabic'], ['hin', 'Hindi'], ['jpn', 'Japanese'], ['chi_sim', 'Chinese (Simplified)'], ['kor', 'Korean'], ['eng+spa', 'English + Spanish']]), toggle('skipText', 'Skip pages that already have text', true), choice('dpi', 'Scan quality', [['200', 'Fast'], ['300', 'Accurate']], '300'), pdfPassword],
    run: each((f, o, c) => pdf().ocr(f, o, outFile('-searchable', 'pdf')(f, c), c)) },
  { id: 'repair-pdf', cat: 'pdf', name: 'Repair PDF', desc: 'Rebuild damaged PDFs so they open again.', icon: 'wrench', accepts: ['pdf'], run: each((f, o, c) => pdf().repair(f, outFile('-repaired', 'pdf')(f, c))) },
  { id: 'flatten-pdf', cat: 'pdf', name: 'Flatten PDF', desc: 'Lock form fields and annotations into the page.', icon: 'layers', accepts: ['pdf'], run: each((f, o, c) => pdf().flatten(f, outFile('-flattened', 'pdf')(f, c))) },
  { id: 'pdf-metadata', cat: 'pdf', name: 'Edit PDF properties', desc: 'Change title, author, subject and keywords.', icon: 'tag', accepts: ['pdf'], max: 1, prefill: 'pdfMetadata',
    options: [text('title', 'Title'), text('author', 'Author'), text('subject', 'Subject'), text('keywords', 'Keywords', '', { placeholder: 'Comma separated' }), toggle('clear', 'Remove creator and producer info')],
    run: each((f, o, c) => pdf().metadata(f, o, outFile('', 'pdf')(f, c))) },
  { id: 'extract-images-pdf', cat: 'pdf', name: 'Extract images', desc: 'Save every picture embedded in a PDF at full quality.', icon: 'images', accepts: ['pdf'],
    options: [choice('format', 'Save as', [['png', 'PNG'], ['jpg', 'JPG']]), pdfPassword], run: each((f, o, c) => pdf().extractImages(f, o, c)) },

  /* ===== Images ===== */
  { id: 'compress-image', cat: 'image', name: 'Compress image', desc: 'Make JPG, PNG, WebP and GIF files smaller.', icon: 'compress', accepts: IMAGE_IN, featured: true,
    options: [level(), num('maxSide', 'Longest side (px, optional)', '', { advanced: true, placeholder: 'Keep size' })], run: each((f, o, c) => img().compress(f, o, c)) },
  { id: 'resize-image', cat: 'image', name: 'Resize image', desc: 'Set exact pixels or scale by percentage.', icon: 'resize', accepts: IMAGE_IN, featured: true,
    options: [choice('mode', 'Resize by', [['pixels', 'Pixels'], ['percent', 'Percentage']]), num('width', 'Width (px)', 1920, { when: { mode: 'pixels' } }), num('height', 'Height (px)', '', { when: { mode: 'pixels' }, placeholder: 'Auto' }), toggle('keepRatio', 'Keep proportions', true, { when: { mode: 'pixels' } }), range('percent', 'Scale', 50, 5, 400, { unit: '%', when: { mode: 'percent' } }), toggle('noEnlarge', 'Don’t enlarge smaller images', true)],
    run: each((f, o, c) => img().resize(f, o, c)) },
  { id: 'crop-image', cat: 'image', name: 'Crop image', desc: 'Crop to a ratio with smart subject detection, or exact pixels.', icon: 'crop', accepts: IMAGE_IN,
    options: [select('aspect', 'Shape', [['1:1', 'Square 1:1'], ['4:5', 'Portrait 4:5'], ['4:3', 'Classic 4:3'], ['3:2', 'Photo 3:2'], ['16:9', 'Widescreen 16:9'], ['9:16', 'Story 9:16'], ['custom', 'Exact pixels']]), toggle('smart', 'Keep the subject in frame', true, { when: { aspect: ['1:1', '4:5', '4:3', '3:2', '16:9', '9:16'] } }), num('left', 'Left', 0, { when: { aspect: 'custom' } }), num('top', 'Top', 0, { when: { aspect: 'custom' } }), num('width', 'Width', 1000, { when: { aspect: 'custom' } }), num('height', 'Height', 1000, { when: { aspect: 'custom' } })],
    run: each((f, o, c) => img().crop(f, o, c)) },
  { id: 'convert-image', cat: 'image', name: 'Convert image', desc: 'Convert between JPG, PNG, WebP, AVIF, HEIC, TIFF, GIF, BMP, ICO and more.', icon: 'convert', accepts: IMAGE_IN, featured: true,
    options: [select('to', 'Convert to', [['jpg', 'JPG'], ['png', 'PNG'], ['webp', 'WebP'], ['avif', 'AVIF'], ['tiff', 'TIFF'], ['gif', 'GIF'], ['bmp', 'BMP'], ['ico', 'ICO (Windows icon)'], ['pdf', 'PDF'], ['jxl', 'JPEG XL']]), range('quality', 'Quality', 88, 30, 100, { unit: '%', when: { to: ['jpg', 'webp', 'avif'] } })],
    run: each((f, o, c) => (o.to === 'pdf' ? pdf().imagesToPdf([f], { pageSize: 'fit' }, outFile('', 'pdf')(f, c), c) : img().convert(f, o, c))) },
  { id: 'remove-background', cat: 'image', name: 'Remove background', desc: 'Cut out people, products and objects automatically, on this PC.', icon: 'cutout', accepts: IMAGE_IN, featured: true,
    options: [choice('quality', 'Quality', [['best', 'Best'], ['fast', 'Fast']]), select('background', 'New background', [['transparent', 'Transparent'], ['#ffffff', 'White'], ['#000000', 'Black'], ['#f3f3f3', 'Light grey']])],
    run: each((f, o, c) => img().removeBackground(f, o, c)) },
  { id: 'upscale-image', cat: 'image', name: 'Upscale image', desc: 'Enlarge images 2× or 4× with AI detail recovery.', icon: 'upscale', accepts: IMAGE_IN,
    options: [choice('factor', 'Enlarge', [['2', '2×'], ['3', '3×'], ['4', '4×']], '2'), choice('content', 'Content', [['photo', 'Photo'], ['anime', 'Illustration']]), choice('method', 'Method', [['ai', 'AI (Real-ESRGAN)'], ['classic', 'Classic (Lanczos)']], 'ai', { advanced: true })],
    run: each((f, o, c) => img().upscale(f, o, c)) },
  { id: 'rotate-image', cat: 'image', name: 'Rotate & flip', desc: 'Rotate or mirror images.', icon: 'rotate', accepts: IMAGE_IN,
    options: [choice('angle', 'Rotate', [['0', 'None'], ['90', '90° right'], ['180', '180°'], ['270', '90° left']], '90'), choice('flip', 'Flip', [['none', 'None'], ['horizontal', 'Mirror'], ['vertical', 'Upside down']])], run: each((f, o, c) => img().rotate(f, o, c)) },
  { id: 'adjust-image', cat: 'image', name: 'Photo editor', desc: 'Brightness, contrast, colour, filters, sharpen and blur.', icon: 'sliders', accepts: IMAGE_IN, preview: 'image',
    options: [range('brightness', 'Brightness', 0, -100, 100), range('contrast', 'Contrast', 0, -100, 100), range('saturation', 'Saturation', 0, -100, 100), range('hue', 'Hue', 0, -180, 180, { unit: '°' }), select('filter', 'Filter', [['none', 'None'], ['grayscale', 'Black & white'], ['sepia', 'Sepia'], ['vintage', 'Vintage'], ['invert', 'Invert']]), range('sharpen', 'Sharpen', 0, 0, 100), range('blur', 'Blur', 0, 0, 100)],
    run: each((f, o, c) => img().adjust(f, o, c)) },
  { id: 'watermark-image', cat: 'image', name: 'Watermark image', desc: 'Add a text or logo watermark to photos.', icon: 'stamp', accepts: IMAGE_IN,
    options: [choice('kind', 'Watermark', [['text', 'Text'], ['image', 'Logo']]), text('text', 'Text', '© Your name', { when: { kind: 'text' } }), file('image', 'Logo', [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }], { when: { kind: 'image' } }), choice('layout', 'Layout', [['single', 'Once'], ['tiled', 'Tiled']]), select('position', 'Position', [['bottom-right', 'Bottom right'], ['bottom-left', 'Bottom left'], ['top-right', 'Top right'], ['top-left', 'Top left'], ['center', 'Centre']], 'bottom-right', { when: { layout: 'single' } }), range('opacity', 'Opacity', 50, 5, 100, { unit: '%' }), range('size', 'Text size', 6, 2, 30, { unit: '%', when: { kind: 'text' } }), range('scale', 'Logo size', 25, 5, 80, { unit: '%', when: { kind: 'image' } }), color('color', 'Colour', '#ffffff')],
    run: each((f, o, c) => img().watermark(f, o, c)) },
  { id: 'meme', cat: 'image', name: 'Meme generator', desc: 'Add classic top and bottom captions.', icon: 'emoji', accepts: IMAGE_IN, max: 1,
    options: [text('top', 'Top text', ''), text('bottom', 'Bottom text', '')], run: each((f, o, c) => img().meme(f, o, c)) },
  { id: 'strip-metadata', cat: 'image', name: 'Remove photo info', desc: 'Strip EXIF, GPS location and camera details before sharing.', icon: 'shield', accepts: IMAGE_IN, run: each((f, o, c) => img().strip(f, o, c)) },
  { id: 'collage', cat: 'image', name: 'Photo collage', desc: 'Arrange photos in a neat grid.', icon: 'grid', accepts: IMAGE_IN, min: 2, ordered: true,
    options: [num('columns', 'Columns', '', { placeholder: 'Auto' }), range('gap', 'Spacing', 12, 0, 60, { unit: 'px' }), color('background', 'Background', '#ffffff')],
    run: async (files, o, c) => [await img().collage(files, o, c.out.file(files[0], 'Collage.jpg'))] },
  { id: 'images-to-gif', cat: 'image', name: 'Make GIF', desc: 'Animate a set of images into a looping GIF.', icon: 'gif', accepts: IMAGE_IN, min: 2, ordered: true,
    options: [range('seconds', 'Seconds per image', 1, 1, 10, { unit: 's', step: 0.5 }), num('width', 'Width (px)', 600)], run: async (files, o, c) => [await media().imagesToGif(files, o, c)] },
  { id: 'image-to-text', cat: 'image', name: 'Image to text (OCR)', desc: 'Copy the text out of screenshots, photos and scans.', icon: 'scan', accepts: IMAGE_IN,
    options: [select('lang', 'Language', [['eng', 'English'], ['spa', 'Spanish'], ['fra', 'French'], ['deu', 'German'], ['ita', 'Italian'], ['por', 'Portuguese'], ['rus', 'Russian'], ['jpn', 'Japanese'], ['chi_sim', 'Chinese (Simplified)'], ['ara', 'Arabic'], ['hin', 'Hindi']])],
    run: each(async (f, o, c) => {
      const png = await (await img().open(f)).rotate().png().toBuffer();
      const t = await require('./engines/ocr').imageToText(png, o.lang || 'eng');
      const out = outFile('', 'txt')(f, c);
      await fsp.writeFile(out, `\ufeff${t}`);
      return { path: out, note: t.trim() ? `${t.trim().split(/\s+/).length} words found` : 'No text found in this image.', text: t };
    }) },
  { id: 'screenshot-url', cat: 'image', name: 'Web page to image', desc: 'Capture a full-length screenshot of any web page.', icon: 'globe', accepts: [], allowNoFiles: true, noFiles: true,
    options: [text('url', 'Web address', '', { placeholder: 'https://example.com', required: true })], run: async (files, o, c) => [await office().urlToPdf(o.url, { format: 'png' }, c)] },

  /* ===== Video & audio ===== */
  { id: 'convert-video', cat: 'media', name: 'Convert video', desc: 'MP4, WebM, MOV, MKV, AVI, HEVC, GIF and audio formats.', icon: 'video', accepts: ['video'], featured: true,
    options: [select('to', 'Convert to', [['mp4', 'MP4 (H.264)'], ['hevc', 'MP4 (HEVC, smaller)'], ['webm', 'WebM (VP9)'], ['mov', 'MOV'], ['mkv', 'MKV'], ['avi', 'AVI'], ['wmv', 'WMV'], ['gif', 'GIF'], ['mp3', 'MP3 (audio only)'], ['m4a', 'M4A (audio only)'], ['wav', 'WAV (audio only)']]), choice('quality', 'Quality', [['high', 'High'], ['balanced', 'Balanced'], ['small', 'Small file']], 'balanced'), select('height', 'Resolution', [['', 'Keep original'], ['2160', '4K (2160p)'], ['1440', '1440p'], ['1080', '1080p'], ['720', '720p'], ['480', '480p']])],
    run: each((f, o, c) => media().convertVideo(f, o, c)) },
  { id: 'compress-video', cat: 'media', name: 'Compress video', desc: 'Shrink videos for email, chat and upload limits.', icon: 'compress', accepts: ['video'], featured: true,
    options: [choice('mode', 'Target', [['level', 'Quality level'], ['size', 'File size']]), level(), num('targetMB', 'Target size (MB)', 25, { when: { mode: 'size' } }), select('height', 'Resolution', [['', 'Keep original'], ['1080', '1080p'], ['720', '720p'], ['480', '480p']]), choice('codec', 'Codec', [['h264', 'H.264 (plays everywhere)'], ['hevc', 'HEVC (smaller)']], 'h264', { advanced: true })],
    run: each((f, o, c) => media().compressVideo(f, o, c)) },
  { id: 'trim-media', cat: 'media', name: 'Trim video or audio', desc: 'Cut a clip by start and end time.', icon: 'cut', accepts: ['video', 'audio'], preview: 'media',
    options: [{ key: 'start', type: 'time', label: 'Start', default: '0:00' }, { key: 'end', type: 'time', label: 'End', default: '' , placeholder: 'End of file' }, toggle('precise', 'Frame-accurate cut (re-encodes)', false)],
    run: each((f, o, c) => media().trim(f, o, c)) },
  { id: 'merge-media', cat: 'media', name: 'Merge videos or audio', desc: 'Join clips end to end, even with different sizes.', icon: 'merge', accepts: ['video', 'audio'], min: 2, ordered: true,
    options: [select('to', 'Audio format (audio only)', [['mp3', 'MP3'], ['m4a', 'M4A'], ['wav', 'WAV'], ['flac', 'FLAC']])], run: async (files, o, c) => [await media().merge(files, o, c)] },
  { id: 'extract-audio', cat: 'media', name: 'Extract audio', desc: 'Save the soundtrack of a video.', icon: 'music', accepts: ['video'], featured: true,
    options: [select('to', 'Format', [['mp3', 'MP3'], ['m4a', 'M4A (AAC)'], ['wav', 'WAV'], ['flac', 'FLAC'], ['ogg', 'OGG'], ['opus', 'Opus']]), select('bitrate', 'Quality', [['320k', '320 kbps'], ['192k', '192 kbps'], ['128k', '128 kbps']], '192k')],
    run: each((f, o, c) => media().extractAudio(f, o, c)) },
  { id: 'convert-audio', cat: 'media', name: 'Convert audio', desc: 'MP3, M4A, WAV, FLAC, OGG, Opus, AIFF, WMA and more.', icon: 'music', accepts: ['audio', 'video'],
    options: [select('to', 'Convert to', [['mp3', 'MP3'], ['m4a', 'M4A (AAC)'], ['wav', 'WAV'], ['flac', 'FLAC (lossless)'], ['ogg', 'OGG Vorbis'], ['opus', 'Opus'], ['aiff', 'AIFF'], ['wma', 'WMA'], ['ac3', 'AC3']]), select('bitrate', 'Quality', [['320k', '320 kbps'], ['256k', '256 kbps'], ['192k', '192 kbps'], ['128k', '128 kbps'], ['96k', '96 kbps']], '192k'), select('rate', 'Sample rate', [['', 'Keep'], ['48000', '48 kHz'], ['44100', '44.1 kHz'], ['22050', '22 kHz']], '', { advanced: true }), toggle('mono', 'Mix to mono', false, { advanced: true })],
    run: each((f, o, c) => media().convertAudio(f, o, c)) },
  { id: 'compress-audio', cat: 'media', name: 'Compress audio', desc: 'Lower the bitrate to save space.', icon: 'compress', accepts: ['audio'], options: [level()], run: each((f, o, c) => media().compressAudio(f, o, c)) },
  { id: 'video-to-gif', cat: 'media', name: 'Video to GIF', desc: 'Turn a moment into a high-quality GIF.', icon: 'gif', accepts: ['video'], preview: 'media',
    options: [{ key: 'start', type: 'time', label: 'Start', default: '0:00' }, num('duration', 'Length (seconds)', 5), range('fps', 'Frames per second', 12, 5, 30), num('width', 'Width (px)', 480)],
    run: each((f, o, c) => media().toGif(f, o, c)) },
  { id: 'mute-video', cat: 'media', name: 'Mute video', desc: 'Remove the sound track without re-encoding.', icon: 'mute', accepts: ['video'], run: each((f, o, c) => media().mute(f, o, c)) },
  { id: 'resize-video', cat: 'media', name: 'Resize video', desc: 'Change resolution to 4K, 1080p, 720p and more.', icon: 'resize', accepts: ['video'],
    options: [select('height', 'Resolution', [['2160', '4K (2160p)'], ['1440', '1440p'], ['1080', '1080p'], ['720', '720p'], ['480', '480p'], ['360', '360p']], '720')], run: each((f, o, c) => media().resizeVideo(f, o, c)) },
  { id: 'rotate-video', cat: 'media', name: 'Rotate video', desc: 'Fix sideways or mirrored videos.', icon: 'rotate', accepts: ['video'],
    options: [choice('angle', 'Rotate', [['0', 'None'], ['90', '90° right'], ['180', '180°'], ['270', '90° left']], '90'), choice('flip', 'Flip', [['none', 'None'], ['horizontal', 'Mirror'], ['vertical', 'Upside down']])], run: each((f, o, c) => media().rotateVideo(f, o, c)) },
  { id: 'speed-media', cat: 'media', name: 'Change speed', desc: 'Speed up or slow down video and audio, keeping pitch.', icon: 'speed', accepts: ['video', 'audio'],
    options: [select('factor', 'Speed', [['0.25', '0.25×'], ['0.5', '0.5×'], ['0.75', '0.75×'], ['1.25', '1.25×'], ['1.5', '1.5×'], ['2', '2×'], ['3', '3×'], ['4', '4×']], '1.5')], run: each((f, o, c) => media().speed(f, o, c)) },
  { id: 'video-frames', cat: 'media', name: 'Video to images', desc: 'Save frames at an interval or a fixed count.', icon: 'images', accepts: ['video'],
    options: [choice('mode', 'Save', [['every', 'Every N seconds'], ['count', 'A fixed number']]), num('every', 'Seconds between frames', 1, { when: { mode: 'every' } }), num('count', 'Number of frames', 12, { when: { mode: 'count' } }), choice('format', 'Format', [['jpg', 'JPG'], ['png', 'PNG']])],
    run: each((f, o, c) => media().frames(f, o, c)) },
  { id: 'burn-subtitles', cat: 'media', name: 'Add subtitles', desc: 'Burn SRT, VTT or ASS captions into a video.', icon: 'captions', accepts: ['video'],
    options: [file('subtitles', 'Subtitle file', [{ name: 'Subtitles', extensions: ['srt', 'vtt', 'ass', 'ssa'] }], { required: true }), range('size', 'Text size', 22, 12, 48)], run: each((f, o, c) => media().burnSubtitles(f, o, c)) },
  { id: 'normalize-audio', cat: 'media', name: 'Level loudness', desc: 'Even out quiet and loud audio to streaming loudness (−16 LUFS).', icon: 'volume', accepts: ['audio', 'video'], run: each((f, o, c) => media().normalize(f, o, c)) },
  { id: 'images-to-video', cat: 'media', name: 'Slideshow video', desc: 'Make an MP4 from photos, with optional music.', icon: 'slideshow', accepts: IMAGE_IN, min: 1, ordered: true,
    options: [range('seconds', 'Seconds per photo', 3, 1, 15, { unit: 's' }), select('size', 'Size', [['1920x1080', '1080p landscape'], ['1080x1920', '1080p portrait'], ['1080x1080', 'Square'], ['3840x2160', '4K']]), file('audio', 'Music (optional)', [{ name: 'Audio', extensions: ['mp3', 'm4a', 'wav', 'aac', 'ogg', 'flac'] }])],
    run: async (files, o, c) => [await media().imagesToVideo(files, o, c)] },
  { id: 'convert-subtitles', cat: 'media', name: 'Convert subtitles', desc: 'SRT, VTT and ASS caption files.', icon: 'captions', accepts: ['subtitle'],
    options: [choice('to', 'Convert to', [['srt', 'SRT'], ['vtt', 'VTT'], ['ass', 'ASS']])], run: each((f, o, c) => media().convertSubtitles(f, o, c)) },

  /* ===== Documents & spreadsheets ===== */
  { id: 'convert-document', cat: 'docs', name: 'Convert document', desc: 'Word, ODT, RTF, Markdown, HTML, EPUB, text and PowerPoint formats.', icon: 'document', accepts: ['doc', 'slides', 'vector'], featured: true,
    options: [select('to', 'Convert to', [['pdf', 'PDF'], ['docx', 'Word (DOCX)'], ['doc', 'Word 97 (DOC)'], ['odt', 'OpenDocument (ODT)'], ['rtf', 'Rich text (RTF)'], ['txt', 'Plain text'], ['html', 'Web page (HTML)'], ['md', 'Markdown'], ['epub', 'eBook (EPUB)'], ['pptx', 'PowerPoint (PPTX)'], ['odp', 'OpenDocument slides (ODP)']]), toggle('pdfa', 'PDF/A for long-term archiving', false, { when: { to: 'pdf' }, advanced: true })],
    run: each((f, o, c) => office().convertDocument(f, o, c)) },
  { id: 'convert-sheet', cat: 'docs', name: 'Convert spreadsheet', desc: 'XLSX, XLS, ODS, CSV, TSV, JSON, HTML and PDF.', icon: 'excel', accepts: ['sheet'], featured: true,
    options: [select('to', 'Convert to', [['xlsx', 'Excel (XLSX)'], ['xls', 'Excel 97 (XLS)'], ['ods', 'OpenDocument (ODS)'], ['csv', 'CSV'], ['tsv', 'TSV'], ['json', 'JSON'], ['html', 'HTML table'], ['pdf', 'PDF']]), toggle('allSheets', 'Save every sheet (CSV, TSV, JSON)', true, { when: { to: ['csv', 'tsv', 'json'] } })],
    run: each((f, o, c) => office().convertSheet(f, o.to, c, o)) },
  { id: 'merge-documents', cat: 'docs', name: 'Merge documents', desc: 'Combine Word, Excel, PowerPoint, PDFs and images into one PDF.', icon: 'merge', accepts: ['doc', 'sheet', 'slides', 'pdf', 'image', 'vector'], min: 2, ordered: true, featured: true,
    run: async (files, o, c) => {
      const tmp = await U.tmpDir('mergedocs');
      const pdfs = [];
      for (let i = 0; i < files.length; i++) {
        c.progress(i / files.length * 0.85, `Converting ${path.basename(files[i])}`);
        const target = path.join(tmp, `${i}.pdf`);
        pdfs.push(await office().anyToPdf(files[i], c, target));
      }
      const out = c.out.file(files[0], `${U.base(files[0])} - combined.pdf`);
      await pdf().merge(pdfs, out, { progress: (f) => c.progress(0.85 + f * 0.15, 'Merging') });
      fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
      return [out];
    } },
  { id: 'merge-sheets', cat: 'docs', name: 'Merge spreadsheets', desc: 'Put workbooks into one file, or stack rows into a single table.', icon: 'table', accepts: ['sheet'], min: 2, ordered: true,
    options: [choice('mode', 'How', [['sheets', 'One sheet per file'], ['stack', 'Stack rows into one sheet']]), toggle('skipHeaders', 'Keep only the first header row', true, { when: { mode: 'stack' } })],
    run: async (files, o, c) => [await office().mergeSheets(files, o, c)] },

  /* ===== Archives ===== */
  { id: 'extract-archive', cat: 'archive', name: 'Extract archive', desc: 'Unpack ZIP, RAR, 7Z, TAR, GZ, ISO, CAB and 40 more formats.', icon: 'unzip', accepts: ['archive'], featured: true,
    options: [password('password', 'Password (if any)'), toggle('nested', 'Also unpack .tar inside .gz', true, { advanced: true })], run: each((f, o, c) => arc().extract(f, o, c)) },
  { id: 'create-archive', cat: 'archive', name: 'Compress to archive', desc: 'Zip files and folders, with optional AES-256 password.', icon: 'zip', accepts: ['any'], featured: true,
    options: [choice('format', 'Format', [['zip', 'ZIP'], ['7z', '7Z'], ['tar.gz', 'TAR.GZ'], ['tar.xz', 'TAR.XZ']]), range('level', 'Compression level', 5, 0, 9), password('password', 'Password (optional)', { when: { format: ['zip', '7z'] } }), num('splitMB', 'Split into parts of (MB)', '', { advanced: true, placeholder: 'Don’t split', when: { format: ['zip', '7z'] } }), text('name', 'Archive name', '', { advanced: true, placeholder: 'Automatic' })],
    run: async (files, o, c) => [await arc().compress(files, o, c)] },
  { id: 'convert-archive', cat: 'archive', name: 'Convert archive', desc: 'Repack RAR, 7Z or TAR as ZIP (or any other format).', icon: 'convert', accepts: ['archive'],
    options: [choice('format', 'Convert to', [['zip', 'ZIP'], ['7z', '7Z'], ['tar.gz', 'TAR.GZ']]), range('level', 'Compression level', 5, 0, 9), password('password', 'Password (if any)', { advanced: true })],
    run: each((f, o, c) => arc().convert(f, o, c)) },
  { id: 'test-archive', cat: 'archive', name: 'Test archive', desc: 'Check an archive for damage without extracting it.', icon: 'check', accepts: ['archive'],
    options: [password('password', 'Password (if any)')], run: each((f, o) => arc().test(f, o)) },

  /* ===== File utilities ===== */
  { id: 'file-hash', cat: 'utility', name: 'Checksums', desc: 'MD5, SHA-1, SHA-256 and SHA-512 for verifying downloads.', icon: 'fingerprint', accepts: ['any'],
    options: [{ key: 'algos', type: 'multi', label: 'Algorithms', choices: [['md5', 'MD5'], ['sha1', 'SHA-1'], ['sha256', 'SHA-256'], ['sha512', 'SHA-512']], default: ['sha256'] }, text('expected', 'Compare with (optional)', '', { placeholder: 'Paste a published checksum' }), toggle('save', 'Save a .txt report next to the file', false)],
    run: each(async (f, o, c) => {
      const algos = o.algos?.length ? o.algos : ['sha256'];
      const lines = [];
      for (const a of algos) lines.push(`${a.toUpperCase().replace('SHA', 'SHA-')}  ${await U.hashFile(f, a)}`);
      const exp = String(o.expected || '').trim().toLowerCase();
      const match = exp ? lines.some((l) => l.toLowerCase().endsWith(exp)) : null;
      let p;
      if (o.save) { p = c.out.file(f, `${path.basename(f)}.checksums.txt`); await fsp.writeFile(p, `${path.basename(f)}\n${lines.join('\n')}\n`); }
      return { path: p, note: match === null ? lines.join('\n') : match ? '✓ Checksum matches' : '✗ Checksum does NOT match', text: lines.join('\n') };
    }) },
  { id: 'rename-files', cat: 'utility', name: 'Batch rename', desc: 'Rename many files with a pattern and numbering.', icon: 'rename', accepts: ['any'], min: 1, ordered: true,
    options: [text('pattern', 'New name', '{name}', { placeholder: '{name}, {n}, {date}, {ext}' }), num('start', 'Start numbering at', 1), num('digits', 'Digits', 2), select('case', 'Letter case', [['keep', 'Keep'], ['lower', 'lowercase'], ['upper', 'UPPERCASE'], ['title', 'Title Case']]), text('find', 'Find (optional)', '', { advanced: true }), text('replace', 'Replace with', '', { advanced: true })],
    run: async (files, o, c) => {
      const out = [];
      const date = new Date().toISOString().slice(0, 10);
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const e = path.extname(f);
        let name = String(o.pattern || '{name}').replace(/\{name\}/g, U.base(f)).replace(/\{n\}/g, String((Number(o.start) || 1) + i).padStart(Number(o.digits) || 1, '0')).replace(/\{date\}/g, date).replace(/\{ext\}/g, e.slice(1));
        if (o.find) name = name.split(o.find).join(o.replace || '');
        if (o.case === 'lower') name = name.toLowerCase();
        if (o.case === 'upper') name = name.toUpperCase();
        if (o.case === 'title') name = name.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
        const target = U.uniquePath(path.join(path.dirname(f), U.sanitize(name) + e));
        if (target !== f) await fsp.rename(f, target);
        out.push(target);
      }
      return [{ path: out[0], paths: out, note: `Renamed ${out.length} file${out.length === 1 ? '' : 's'}`, inPlace: true }];
    } },
];

/* ---------- wheel presets: what Shift (convert) and Ctrl (tools) show for each kind of file ---------- */
const W = (tool, label, hint, opts = {}, extra = {}) => ({ tool, label, hint, opts, ...extra });
const WHEELS = {
  pdf: {
    convert: [W('pdf-to-word', 'Word', 'DOCX'), W('pdf-to-jpg', 'JPG', 'Pages', { format: 'jpg' }), W('pdf-to-excel', 'Excel', 'XLSX'), W('pdf-to-powerpoint', 'PowerPoint', 'PPTX'), W('pdf-to-jpg', 'PNG', 'Pages', { format: 'png' }), W('pdf-to-text', 'Text', 'TXT'), W('pdf-to-html', 'HTML', 'Web page'), W('ocr-pdf', 'Searchable', 'OCR')],
    tools: [W('compress-pdf', 'Compress', 'Smaller'), W('edit-pdf', 'Edit', 'Text & more', {}, { open: true }), W('split-pdf', 'Split', 'Every page'), W('rotate-pdf', 'Rotate', '90° right', { angle: '90' }), W('sign-pdf', 'Sign', 'Signature', {}, { open: true }), W('protect-pdf', 'Protect', 'Password', {}, { open: true }), W('extract-images-pdf', 'Images', 'Extract'), W('repair-pdf', 'Repair', 'Fix file')],
  },
  image: {
    convert: [W('convert-image', 'JPG', 'Photo', { to: 'jpg' }), W('convert-image', 'PNG', 'Lossless', { to: 'png' }), W('convert-image', 'WebP', 'Web', { to: 'webp' }), W('jpg-to-pdf', 'PDF', 'Document'), W('convert-image', 'AVIF', 'Smallest', { to: 'avif' }), W('convert-image', 'ICO', 'Icon', { to: 'ico' }), W('convert-image', 'TIFF', 'Print', { to: 'tiff' }), W('convert-image', 'GIF', 'Classic', { to: 'gif' })],
    tools: [W('compress-image', 'Compress', 'Smaller'), W('remove-background', 'Cut out', 'No background'), W('resize-image', 'Resize', '50%', { mode: 'percent', percent: 50 }), W('upscale-image', 'Upscale', '2×'), W('rotate-image', 'Rotate', '90° right', { angle: '90', flip: 'none' }), W('crop-image', 'Square', 'Smart crop', { aspect: '1:1' }), W('strip-metadata', 'Clean', 'Remove EXIF'), W('image-to-text', 'Text', 'OCR')],
  },
  raw: {
    convert: [W('convert-image', 'JPG', 'Preview', { to: 'jpg' }), W('convert-image', 'PNG', 'Preview', { to: 'png' }), W('convert-image', 'TIFF', 'Preview', { to: 'tiff' })],
    tools: [W('compress-image', 'Compress', 'JPG'), W('strip-metadata', 'Clean', 'Remove EXIF')],
  },
  video: {
    convert: [W('convert-video', 'MP4', 'Plays anywhere', { to: 'mp4' }), W('convert-video', 'WebM', 'Web', { to: 'webm' }), W('convert-video', 'MOV', 'Apple', { to: 'mov' }), W('video-to-gif', 'GIF', 'First 5 s'), W('extract-audio', 'MP3', 'Audio', { to: 'mp3' }), W('convert-video', 'MKV', 'Archive', { to: 'mkv' }), W('convert-video', 'HEVC', 'Smaller', { to: 'hevc' }), W('extract-audio', 'WAV', 'Audio', { to: 'wav' })],
    tools: [W('compress-video', 'Compress', 'Smaller'), W('trim-media', 'Trim', 'Cut', {}, { open: true }), W('mute-video', 'Mute', 'No sound'), W('resize-video', '720p', 'Resize', { height: '720' }), W('rotate-video', 'Rotate', '90° right', { angle: '90', flip: 'none' }), W('video-frames', 'Frames', 'Every second'), W('normalize-audio', 'Level', 'Loudness'), W('speed-media', 'Speed', '1.5×', { factor: '1.5' })],
  },
  audio: {
    convert: [W('convert-audio', 'MP3', 'Universal', { to: 'mp3' }), W('convert-audio', 'M4A', 'Apple', { to: 'm4a' }), W('convert-audio', 'WAV', 'Uncompressed', { to: 'wav' }), W('convert-audio', 'FLAC', 'Lossless', { to: 'flac' }), W('convert-audio', 'OGG', 'Open', { to: 'ogg' }), W('convert-audio', 'Opus', 'Voice', { to: 'opus' })],
    tools: [W('compress-audio', 'Compress', 'Smaller'), W('normalize-audio', 'Level', 'Loudness'), W('trim-media', 'Trim', 'Cut', {}, { open: true }), W('speed-media', 'Speed', '1.5×', { factor: '1.5' })],
  },
  doc: {
    convert: [W('convert-document', 'PDF', 'Document', { to: 'pdf' }), W('convert-document', 'Word', 'DOCX', { to: 'docx' }), W('convert-document', 'Text', 'TXT', { to: 'txt' }), W('convert-document', 'HTML', 'Web page', { to: 'html' }), W('convert-document', 'ODT', 'Open', { to: 'odt' }), W('convert-document', 'Markdown', 'MD', { to: 'md' }), W('convert-document', 'EPUB', 'eBook', { to: 'epub' }), W('convert-document', 'RTF', 'Rich text', { to: 'rtf' })],
    tools: [W('create-archive', 'ZIP', 'Archive', { format: 'zip' })],
  },
  sheet: {
    convert: [W('convert-sheet', 'Excel', 'XLSX', { to: 'xlsx' }), W('convert-sheet', 'CSV', 'Plain', { to: 'csv' }), W('excel-to-pdf', 'PDF', 'Document'), W('convert-sheet', 'ODS', 'Open', { to: 'ods' }), W('convert-sheet', 'JSON', 'Data', { to: 'json' }), W('convert-sheet', 'HTML', 'Table', { to: 'html' })],
    tools: [W('create-archive', 'ZIP', 'Archive', { format: 'zip' })],
  },
  slides: {
    convert: [W('powerpoint-to-pdf', 'PDF', 'Document'), W('convert-document', 'PPTX', 'PowerPoint', { to: 'pptx' }), W('convert-document', 'ODP', 'Open', { to: 'odp' })],
    tools: [W('create-archive', 'ZIP', 'Archive', { format: 'zip' })],
  },
  vector: { convert: [W('convert-document', 'PDF', 'Document', { to: 'pdf' })], tools: [] },
  archive: {
    convert: [W('extract-archive', 'Extract', 'Here'), W('convert-archive', 'ZIP', 'Repack', { format: 'zip' }), W('convert-archive', '7Z', 'Repack', { format: '7z' }), W('convert-archive', 'TAR.GZ', 'Repack', { format: 'tar.gz' })],
    tools: [W('test-archive', 'Test', 'Check'), W('file-hash', 'Hash', 'SHA-256')],
  },
  subtitle: { convert: [W('convert-subtitles', 'SRT', 'SubRip', { to: 'srt' }), W('convert-subtitles', 'VTT', 'WebVTT', { to: 'vtt' }), W('convert-subtitles', 'ASS', 'Styled', { to: 'ass' })], tools: [] },
  folder: { convert: [W('create-archive', 'ZIP', 'Archive', { format: 'zip' }), W('create-archive', '7Z', 'Archive', { format: '7z' }), W('create-archive', 'TAR.GZ', 'Archive', { format: 'tar.gz' })], tools: [] },
  any: { convert: [W('create-archive', 'ZIP', 'Archive', { format: 'zip' }), W('create-archive', '7Z', 'Archive', { format: '7z' })], tools: [W('file-hash', 'Hash', 'SHA-256')] },
};
const MULTI = {
  pdf: [W('merge-pdf', 'Merge', 'One PDF'), W('compress-pdf', 'Compress', 'Each')],
  image: [W('jpg-to-pdf', 'PDF', 'One file'), W('collage', 'Collage', 'Grid'), W('images-to-gif', 'GIF', 'Animate'), W('images-to-video', 'Slideshow', 'MP4')],
  video: [W('merge-media', 'Merge', 'One video'), W('compress-video', 'Compress', 'Each')],
  audio: [W('merge-media', 'Merge', 'One track')],
  sheet: [W('merge-sheets', 'Merge', 'One workbook')],
  mixed: [W('merge-documents', 'One PDF', 'Merge all')],
};

function groupsOf(files) { return [...new Set(files.map(U.groupOf))]; }
/** Which tools accept this set of files (for the "what can I do with this?" panel). */
function toolsFor(files) {
  const gs = groupsOf(files);
  return TOOLS.filter((t) => {
    if (t.noFiles) return false;
    if (t.max && files.length > t.max) return false;
    if (t.extAccept) return files.every((f) => t.extAccept.includes(U.ext(f)));
    if (t.accepts.includes('any')) return true;
    return gs.every((g) => t.accepts.includes(g));
  }).map((t) => t.id);
}
function wheelFor(files, group) {
  const gs = groupsOf(files);
  const g = gs.length === 1 ? gs[0] : 'mixed';
  if (files.length > 1) {
    const multi = [...(MULTI[g] || [])];
    const docLike = gs.every((x) => ['doc', 'sheet', 'slides', 'pdf', 'image', 'vector'].includes(x));
    if (g === 'mixed' && docLike) multi.push(...MULTI.mixed);
    const per = (WHEELS[g] || WHEELS.any)[group === 'tools' ? 'tools' : 'convert'];
    const zip = W('create-archive', 'ZIP', 'All files', { format: 'zip' });
    if (group === 'convert') return g === 'mixed' ? [...multi, zip] : [...per.slice(0, 6), zip];
    return [...multi, ...(g === 'mixed' ? [] : per.filter((w) => !w.open).slice(0, 4)), zip].slice(0, 10);
  }
  return ((WHEELS[g] || WHEELS.any)[group] || []).slice(0, 10);
}
function catalog() {
  return TOOLS.map(({ run, ...meta }) => meta);
}
function get(id) { return TOOLS.find((t) => t.id === id); }

module.exports = { TOOLS, catalog, get, toolsFor, wheelFor, groupsOf };
