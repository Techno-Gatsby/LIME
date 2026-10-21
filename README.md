# Lime

A drop-anything converter that lives on your desktop as a small wheel. Drop files on it, spin or click a petal, and Lime converts, compresses or edits them. Everything runs on your computer; nothing is uploaded.

## Install

### Mac (Apple silicon)

1. Open `Lime-1.0.0-arm64.dmg` and drag **Lime** onto **Applications**.
2. Open Lime from Applications or Launchpad. The wheel appears on your desktop and a lime icon appears in the menu bar.

Apple hasn't notarised Lime yet, so macOS blocks the first launch:

- **macOS 15 and later:** open Lime once and click **Done**. Then go to **System Settings › Privacy & Security**, scroll down and click **Open Anyway**.
- **macOS 13–14:** right-click Lime in Applications › **Open** › **Open**.
- If macOS says Lime "is damaged", run this once in Terminal: `xattr -dr com.apple.quarantine /Applications/Lime.app`

### Windows 10 / 11 (64-bit)

Run `Lime-Setup-1.0.0-x64.exe`. It installs for your account only, with no admin rights needed. It adds Start menu and desktop shortcuts, plus **Convert with Lime** in the File Explorer right-click menu.

The installer isn't code-signed yet, so SmartScreen shows a warning: click **More info › Run anyway**. On a managed work laptop, IT policy may block unsigned apps entirely; if so, ask IT to allow `Lime.exe`.

## Using the wheel

Lime waits as a small lime tucked into the right edge of the screen. The wheel is frosted glass: each slice is one thing your files can become.

| Do this | What happens |
|---|---|
| Drag files and hold **Shift** | The wheel opens beside the pointer, already showing what those files can become, and follows the drag: it trails the pointer as you carry the files, and holds still when you move toward it. Drop on a slice to run it in one go, or drop in the middle to see every choice. |
| While dragging, hold **Option** (Windows: **Alt**) or **Control** | Shows the Tools or More ring instead. You can also hold the file over a tab at the top for half a second. |
| Drag files onto the lime at the edge, or into the bottom-left corner | The wheel blooms there; drop the files on it. |
| Click the lime | Opens the wheel with the seven ArtCraft apps around it, plus **Recent**. Click an app for its own ring: **Open** starts the full app, and its one-click actions ask for files and run right there. Click the middle to choose files. |
| Click a slice | Runs it. If the tool has settings (pages, quality, a password, the order of files), a card asks first. Right-click a slice for every setting. |
| **Convert · Tools · Apps · More** | Switches the ring (or press Tab). **Apps** shows the apps that open these files and each app's actions; **Tools** ends with the likeliest app, so a PDF offers PdfCraft and a photo offers PhotoCraft. **More** lists every tool that fits, with search. Esc steps back out of an app. |
| Press and drag anywhere on the wheel | Moves it, with or without files. A click still picks a slice; only the middle of a finished job drags its results out instead. |
| Drag the middle after a job | Drags the results into any app or folder. **Edit in …** opens the result in the app that suits it. |
| **Control + Option + L** (Windows: **Ctrl + Alt + L**) | Shows or hides the wheel. On a Mac with files selected in Finder, opens them in the wheel. |
| Menu bar / tray icon | Show the wheel, choose files, open any of the seven apps, recent results, settings. **Float Above Windows** keeps the wheel above other apps, other always-on-top windows included. |

On a Mac, Lime reads the dragged files straight from the drag, so the right choices appear for files from any app; no permission is needed. On Windows they appear for files dragged from File Explorer or the desktop; from other apps, drop first and pick a slice. Trackpads with Force Touch give a light tick as the highlight moves.

Lime asks where to save each result. To save next to the original instead, switch this off in Settings. Originals are never changed.

## What it does (157 tools)

**PDF** — edit text (any font on your computer, plus bold, italic, underline, strikethrough, background colour, alignment and spacing; edited lines keep the shading behind them), select and remove pictures, tables, drawings and text blocks, highlight, underline or strike out text, stamps (Approved, Draft, Confidential and more), ticks, crosses and today's date, boxes, arrows and freehand drawing, find and replace, sign, organise pages, merge, split, compress, optimise, rotate, crop, change page size, pages per sheet, overlay a letterhead or another PDF, grayscale, page numbers, watermark, redact and check redactions, protect and unlock, searchable PDF (OCR), PDF/A, compare two versions, make fillable forms, scan to PDF, repair, flatten, extract images. PDF to Word rebuilds paragraphs, headings, columns, ruled tables and pictures; also PDF to PowerPoint, Excel (tables into cells), images, TIFF, comic book (CBZ), Markdown, text, HTML and SVG, and anything to PDF.

**Images** — convert between 30 formats, including real HEIC, AVIF, WebP, JPEG XL, JPEG 2000, APNG, ICO, ICNS, cursors, TIFF (every page), PSD, TGA, QOI and DDS, keeping the colour profile and Exif. Also RAW, EXR and HDR in; develop RAW, auto-enhance, HDR merge, panorama, compress, resize, crop, remove background and blur faces (both on-device AI), upscale, rotate, adjust, watermark, memes, borders, animation speed and reverse for GIF/WebP/APNG, remove photo info, collage, GIF maker, and image to text (OCR in 13 languages).

**Video and audio** — convert to 21 video formats (MP4, HEVC, AV1, MOV, WebM, MKV, AVI, WMV, MPG, TS, M2TS, VOB, OGV, 3GP, MXF, GIF, APNG and more) and 23 audio formats (MP3, M4A, WAV, FLAC, ALAC, AIFF, OGG, Opus, WMA, AC3, WavPack, CAF and more), copying streams without re-encoding when they already fit. Compress, trim, merge, crop, resize, rotate, speed, reverse, loop, fade, volume, pitch, loudness, blur an area, add or mix in a soundtrack, extract audio or subtitles, burn subtitles, video to GIF or frames, GIF to video, and slideshows. Lottie animations and edit timelines (OTIO, FCPXML) render to video.

**Documents** — Word, ODT, RTF, Markdown, HTML, text; spreadsheets (XLSX, XLS, ODS, CSV with encoding detection), which print to PDF the way Excel does: the whole workbook, the active sheet or cells you pick on the sheet, fit to one page, all columns or all rows, orientation, paper size, margins, gridlines, headings, print areas, repeated titles, headers and footers; slides (PowerPoint); page layouts (IDML) to PDF, EPUB or PowerPoint; merge documents into one PDF. On a Mac with Pages, Numbers or Keynote installed, their files convert too.

**E-books, e-mail and fonts** — EPUB, KEPUB, MOBI, AZW/AZW3, FB2, HTMLZ and TXTZ; comics (CBZ, CBR, CB7) to PDF, EPUB or pictures. E-mail (EML, Outlook MSG) and web archives (MHT) to PDF, HTML or text, with attachments saved. Fonts (TTF, OTF, WOFF, WOFF2, EOT, TTC) convert between each other, plus font info.

**Data and subtitles** — JSON, JSON Lines, YAML, TOML, XML, CSV and XLSX convert into each other; vCard contacts to and from spreadsheets. Subtitles (SRT, VTT, ASS, SAMI, LRC, TTML, MicroDVD, SCC) convert between formats.

**CAD** — DWG, DXF, STEP, IGES, BREP, STL, OBJ (with MTL colours), PLY, GLB/glTF, 3MF and FBX (read only). Drawings convert to PDF, SVG, PNG, DXF, AI, EPS or EMF; 3D models convert between formats with real units and part colours, and to rendered images; plus measurements. Vector art (SVG, AI, EPS, PDF, EMF, Affinity) converts between formats.

**Archives** — extract 40+ formats including RAR, 7Z and ISO, with checks against unsafe paths and archive bombs; create ZIP, 7Z, TAR, TAR.GZ, TAR.XZ or TAR.BZ2 with passwords; decompress single GZ/BZ2/XZ files; convert and test archives.

**Utilities** — checksums, batch rename.

## The seven apps on the wheel

Click the lime and pick an app, or drop files and open **Apps**. **Open** starts the full app; the rest run its engine right there, with no window:

- **PhotoCraft** — auto tone, sharpen, reduce noise, lift shadows, paint looks (oil, watercolour, poster, ink, pencil), split a scan into photos, export PSD layers, layer list.
- **LightCraft** — 41 looks, smart black & white, straighten, remove dust, develop RAW, auto enhance, HDR, panorama, HDR sets for a whole folder.
- **VectorCraft** — trace a picture or logo to SVG/AI/PDF/EPS, outline text, export artboards, a logo package (SVG, PNG 1×/2×, PDF, print PDF), vector info.
- **DesignCraft** — preflight, print PDF (PDF/X-4, bleed, marks) or web PDF, package for hand-over, fixed-layout EPUB, booklet.
- **EffectCraft** — poster frame, transparent GIF or ProRes 4444 MOV, PNG frames, animation info, render to video.
- **FilmCraft** — split into scenes, clean up voices, film-look colour grades, edit-ready ProRes/DNxHR copies, media info, timeline conversion.
- **PdfCraft** — optimise, remove hidden data, PDF/A, fillable forms, check redactions, Bates numbers, word count, print check, link web addresses, split at bookmarks, accessibility check, comment summary, compare.

## Engines

Bundled, all offline: MuPDF and pdf-lib, libvips (sharp), FFmpeg 6.1, 7-Zip 26, Tesseract, IMG.LY background removal, LibreDWG, Open CASCADE, and the command-line engines of the seven ArtCraft apps (PhotoCraft, LightCraft, VectorCraft, DesignCraft, EffectCraft, FilmCraft, PdfCraft). If LibreOffice is installed, Lime uses it for the most faithful Office conversions.

## Build from source

```sh
npm install
npm run engines            # engines for this computer
npm start                  # run in development
npm test                   # run every tool on generated samples (add a packaged app folder to test that build)
npm run dist:mac           # dist/Lime-1.0.0-arm64.dmg
npm run dist:win           # dist/Lime-Setup-1.0.0-x64.exe (needs 7-Zip; NSIS too when not on Windows)
```

The ArtCraft source code is linked under `crafts/` at the exact versions Lime bundles (`git submodule update --init` fetches it). Builds use the projects' official signed release binaries.

Building the Mac DMG on Linux needs `rcodesign`, `mkfs.hfsplus`, and the `hfsplus` and `dmg` tools from libdmg-hfsplus; set `RCODESIGN`, `HFSPLUS` and `DMG` if they aren't on PATH. Set `LIME_ELECTRON_ZIPS` to a folder of Electron zips to build offline.

## Licence

AGPL-3.0-or-later. See `LICENSES/THIRD-PARTY-NOTICES.txt` for the components Lime is built on.
