'use strict';
// Tools built on the small codecs: QR codes and barcodes, photo info and fast web view.
const U = require('./engines/util');

// Make QR code starts from a dropped note, link or contact card; Wi-Fi and typed text ignore what's in it.
const QR_IN = ['txt', 'md', 'url', 'webloc', 'csv'];
const barcode = () => require('./engines/barcode'), photo = () => require('./engines/photoinfo'), plus = () => require('./engines/pdfplus');

module.exports = ({ each, choice, select, text, toggle, color, range, pdfPassword, IMAGE_IN }) => [
  { id: 'pdf-web-view', cat: 'pdf', name: 'Fast web view', desc: 'Shows page one straight away when opened from a website, while the rest loads.', tags: 'linearize linearise web optimize optimise fast qpdf', accepts: ['pdf'], ext: 'pdf', suffix: '-web',
    options: [pdfPassword], run: each((f, o, c) => plus().webView(f, c.out.file(f, `${U.base(f)}-web.pdf`), o)) },
  { id: 'read-codes', cat: 'image', name: 'Read QR code', desc: 'The text, link or number in QR codes and barcodes, in pictures and PDFs.', tags: 'qr barcode scan decode ean upc data matrix pdf417 aztec', accepts: [...IMAGE_IN, 'pdf'], save: 'none',
    options: [pdfPassword], run: async (files, o, c) => [await barcode().read(files, o, c)] },
  { id: 'make-qr', cat: 'image', name: 'Make QR code', desc: 'A QR code or barcode for a link, some text, a Wi-Fi network or a contact card.', tags: 'qr barcode generator wifi vcard contact ean upc code128 data matrix', accepts: ['contacts'], extAccept: QR_IN, ext: (o) => (o.format === 'svg' ? 'svg' : 'png'), suffix: ' - QR',
    options: [choice('kind', 'What', [['file', 'The file’s text'], ['text', 'Text or link'], ['wifi', 'Wi-Fi'], ['contact', 'Contact']]),
      text('text', 'Text or link', '', { when: { kind: 'text' }, required: true, placeholder: 'https://example.com' }),
      select('type', 'Kind of code', [['qr', 'QR code'], ['code128', 'Barcode (Code 128)'], ['ean13', 'EAN-13 (product)'], ['upca', 'UPC-A (product)'], ['code39', 'Code 39'], ['datamatrix', 'Data Matrix'], ['pdf417', 'PDF417'], ['aztec', 'Aztec']], 'qr', { when: { kind: ['file', 'text'] } }),
      text('ssid', 'Network name', '', { when: { kind: 'wifi' }, required: true }), text('password', 'Password', '', { when: { kind: 'wifi' } }),
      choice('security', 'Security', [['WPA', 'WPA'], ['WEP', 'WEP'], ['none', 'None']], 'WPA', { when: { kind: 'wifi' } }), toggle('hidden', 'Hidden network', false, { when: { kind: 'wifi' }, advanced: true }),
      text('name', 'Name', '', { when: { kind: 'contact' } }), text('phone', 'Phone', '', { when: { kind: 'contact' } }), text('email', 'Email', '', { when: { kind: 'contact' } }),
      text('org', 'Company', '', { when: { kind: 'contact' }, advanced: true }), text('url', 'Website', '', { when: { kind: 'contact' }, advanced: true }),
      choice('format', 'Save as', [['png', 'PNG'], ['svg', 'SVG']]), range('scale', 'Size', 10, 2, 30, { advanced: true }), color('color', 'Colour', '#000000'), toggle('transparent', 'See-through background', false, { advanced: true })],
    run: each((f, o, c) => barcode().make(f, o, c)) },
  { id: 'photo-info', cat: 'image', name: 'Photo info', desc: 'Everything stored in a photo: camera, settings, date, place and copyright.', tags: 'exif metadata gps location camera date iptc xmp details properties', accepts: [...IMAGE_IN], save: 'none',
    run: each((f) => photo().view(f)) },
  { id: 'edit-photo-info', cat: 'image', name: 'Edit photo info', desc: 'Change the date, author, copyright or place in a JPG, PNG or WebP. The picture itself isn’t touched.', tags: 'exif metadata gps location date author copyright artist', accepts: [], extAccept: photo().EDITABLE, suffix: '-edited', ext: (o, files) => (U.ext(files[0] || '') === 'jpeg' ? 'jpg' : U.ext(files[0] || '') || 'jpg'),
    options: [text('date', 'Date taken', '', { placeholder: '2024-05-31 14:30' }), text('author', 'Author', ''), text('copyright', 'Copyright', '', { placeholder: '© 2024 Your Name' }),
      text('place', 'Place (latitude, longitude)', '', { placeholder: '51.5007, -0.1246' }), toggle('noPlace', 'Remove the place', false)],
    run: each((f, o, c) => photo().edit(f, o, c)) },
];
