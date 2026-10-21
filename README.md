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

Lime waits as a small lime tucked into the right edge of the screen. The wheel is frosted glass: each slice is one thing your files can become. The first time it runs, a short welcome shows the four things worth knowing; **How Lime works** in the menu (and in Settings › About) brings it back.

| Do this | What happens |
|---|---|
| Drag files and hold **Shift** | The wheel opens beside the pointer, already showing what those files can become, and follows the drag: it trails the pointer as you carry the files, and holds still when you move toward it. Drop on a slice to run it in one go, or drop in the middle to see every choice. |
| While dragging, hold **Option** (Windows: **Alt**) or **Control** | Shows the Tools or More ring instead. You can also hold the file over a tab at the top for half a second. |
| Drag files onto the lime at the edge, or into the bottom-left corner | The wheel blooms there; drop the files on it. |
| Click the lime | Opens the wheel with the seven ArtCraft apps around it, plus **Recent**. Click an app for its own ring: **Open**, or the app's mark in the middle, starts the full app, and its one-click actions ask for files and run right there. Click the middle to choose files. |
| Click a slice | Runs it. If the tool has settings (pages, quality, a password, the order of files), a card asks first. Right-click a slice for every setting. |
| **Convert · Tools · Apps · More** | Switches the ring (or press Tab). **Apps** shows the apps that open these files and each app's actions; **Tools** ends with the likeliest app, so a PDF offers PdfCraft and a photo offers PhotoCraft. **More** lists every tool that fits, with search. Esc steps back out of an app. |
| Press and drag anywhere on the wheel | Moves it, with or without files. A click still picks a slice; only the middle of a finished job drags its results out instead. |
| Drag the middle after a job | Drags the results into any app or folder. **Edit in …** opens the result in the app that suits it. |
| **Control + Option + L** (Windows: **Ctrl + Alt + L**) | Shows or hides the wheel. On a Mac with files selected in Finder, opens them in the wheel. |
| Menu bar / tray icon | Show the wheel, choose files, open any of the seven apps, recent results, settings. **Float Above Windows** keeps the wheel above other apps, other always-on-top windows included. |
| Sounds | A tick as you pass each slice, a thud when files land, a chime when a job is done. **Sounds** in Settings switches them off. |
| Optional helpers | Lime converts Office documents on its own. For LibreOffice's exact layouts and Pandoc's LaTeX, reStructuredText and Org files, **Download…** in Settings fetches either from its makers into Lime's own folder, with no installer and no administrator rights. |

On a Mac, Lime reads the dragged files straight from the drag, so the right choices appear for files from any app; no permission is needed. On Windows they appear for files dragged from File Explorer or the desktop; from other apps, drop first and pick a slice. Trackpads with Force Touch give a light tick as the highlight moves.

Lime asks where to save each result. To save next to the original instead, switch this off in Settings. Originals are never changed.

## What it does (175 tools)

**PDF** — edit text by line or by paragraph (any font on your computer, plus bold, italic, underline, strikethrough, lists, background colour, alignment and spacing; edited lines keep the shading behind them), select and remove pictures, tables, drawings and text blocks, replace, crop and flip pictures (with alternative text), sticky notes, replies and a comments panel, highlights, shapes, drawings and measurements kept as comments or flattened, stamps (Approved, Draft, Confidential and more), ticks, crosses and today's date, links, bookmarks, fill in and build forms (text, tick box, choice, drop-down, date and signature fields), redact areas, words or every e-mail or phone number, crop pages, headers and footers, page and Bates numbers, watermarks and backgrounds with a live preview, page labels, properties, passwords, recognise text in scans, accessibility and print checks, find and replace, sign, organise pages, merge, split, compress, optimise, rotate, crop, change page size, pages per sheet, overlay a letterhead or another PDF, grayscale, page numbers, watermark, redact and check redactions, protect and unlock, searchable PDF (OCR), PDF/A, compare two versions, make fillable forms, scan to PDF, repair, flatten, extract images. PDF to Word rebuilds paragraphs, headings, columns, ruled tables and pictures; also PDF to PowerPoint, Excel (tables into cells), images, TIFF, comic book (CBZ), Markdown, text, HTML and SVG, and anything to PDF.

**Images** — convert between 30 formats, including real HEIC, AVIF, WebP, JPEG XL, JPEG 2000, APNG, ICO, ICNS, cursors, TIFF (every page), PSD, TGA, QOI and DDS, keeping the colour profile and Exif. Also RAW, EXR and HDR in; develop RAW, auto-enhance, HDR merge, panorama, compress, resize, crop, remove background and blur faces (both on-device AI), upscale, rotate, adjust, watermark, memes, borders, animation speed and reverse for GIF/WebP/APNG, remove photo info, collage, GIF maker, and image to text (OCR in 13 languages).

**Edit image** opens photos and RAW files in an editor: LightCraft's light, colour, curve, colour mixer, grading, detail and effects sliders and its 41 looks, crop and straighten, resize and canvas, spot removal, healing and red eye, PhotoCraft's fixes and paint effects, cut-out, face blur and upscale, then text, arrows and shapes on top. Every step can be undone until you save, and saving keeps the format, Exif and colour profile.

**Video and audio** — convert to 21 video formats (MP4, HEVC, AV1, MOV, WebM, MKV, AVI, WMV, MPG, TS, M2TS, VOB, OGV, 3GP, MXF, GIF, APNG and more) and 23 audio formats (MP3, M4A, WAV, FLAC, ALAC, AIFF, OGG, Opus, WMA, AC3, WavPack, CAF and more), copying streams without re-encoding when they already fit. Compress, trim, merge, crop, resize, rotate, speed, reverse, loop, fade, volume, pitch, loudness, blur an area, add or mix in a soundtrack, extract audio or subtitles, burn subtitles, video to GIF or frames, GIF to video, and slideshows. Lottie animations and edit timelines (OTIO, FCPXML) render to video. **Edit video** and **Edit audio** open a timeline editor: trim, split and cut, crop, turn, resize, speed, FilmCraft looks, titles, fades, music, noise and silence removal, loudness and EQ, seen and heard live and saved in one pass.

**Documents** — Word, ODT, RTF, Markdown, HTML, text; spreadsheets (XLSX, XLS, ODS, CSV with encoding detection), which print to PDF the way Excel does: the whole workbook, the active sheet or cells you pick on the sheet, fit to one page, all columns or all rows, orientation, paper size, margins, gridlines, headings, print areas, repeated titles, headers and footers; slides (PowerPoint); page layouts (IDML) to PDF, EPUB or PowerPoint; merge documents into one PDF. On a Mac with Pages, Numbers or Keynote installed, their files convert too. Office's whole-file jobs work without LibreOffice, on the files' own XML: compare two versions into tracked changes or a marked-up PDF, accept or reject every change (Word and ODT), mail merge from a spreadsheet, find and replace that keeps formatting, remove comments and personal details, statistics and readability, split at headings, watermarks and page numbers, extract media, compress pictures; formulas to values, unhide and unprotect (never a password), one file per sheet, tidy duplicate and empty rows with formulas kept pointing right, check formulas for errors; speaker notes to Word, merge presentations, and pick, reorder or drop slides.

**E-books, e-mail and fonts** — EPUB, KEPUB, MOBI, AZW/AZW3, FB2, HTMLZ and TXTZ; comics (CBZ, CBR, CB7) to PDF, EPUB or pictures. E-mail (EML, Outlook MSG) and web archives (MHT) to PDF, HTML or text, with attachments saved. Fonts (TTF, OTF, WOFF, WOFF2, EOT, TTC) convert between each other, plus font info.

**Data and subtitles** — JSON, JSON Lines, YAML, TOML, XML, CSV and XLSX convert into each other; vCard contacts to and from spreadsheets. Subtitles (SRT, VTT, ASS, SAMI, LRC, TTML, MicroDVD, SCC) convert between formats.

**CAD** — DWG, DXF, STEP, IGES, BREP, STL, OBJ (with MTL colours), PLY, OFF, GLB/glTF, 3MF and FBX (read only). Drawings convert to PDF, SVG, PNG, DXF (AutoCAD 2000 with layers, colours, lineweights and exact arcs, or R12), AI, EPS or EMF. 3D models save as STEP, IGES and BREP (exact from STEP, IGES and BREP through Open CASCADE; meshes become faceted solids the way FreeCAD's “Shape from mesh” makes them), STL (binary or ASCII), OBJ, GLB/glTF, 3MF, PLY, OFF, AMF, VRML, X3D and Collada, in the units you pick, with part colours, centred or scaled, and as rendered images. Make drawing lays out front, top, side and 3D views with hidden lines, a standard scale and a title block on a PDF, SVG, DXF or PNG sheet, like FreeCAD's TechDraw; plus mesh repair, simplify, merge and measurements. Vector art (SVG, AI, EPS, PDF, EMF, Affinity) converts between formats.

**Archives** — extract 40+ formats including RAR, 7Z and ISO, with checks against unsafe paths and archive bombs; create ZIP, 7Z, TAR, TAR.GZ, TAR.XZ or TAR.BZ2 with passwords; decompress single GZ/BZ2/XZ files; convert and test archives.

**Utilities** — checksums, batch rename.

## The seven apps on the wheel

Click the lime and pick an app, or drop files and open **Apps**. **Open** starts the full app; the rest run its engine right there, with no window:

- **PhotoCraft** — auto tone, sharpen, reduce noise, lift shadows, paint looks (oil, watercolour, poster, ink, pencil), split a scan into photos, export PSD layers, layer list.
- **LightCraft** — 41 looks, smart black & white, straighten, remove dust, develop RAW, auto enhance, HDR, panorama, HDR sets for a whole folder.
- **VectorCraft** — trace a picture or logo to SVG/AI/PDF/EPS, outline text, export artboards, a logo package (SVG, PNG 1×/2×, PDF, print PDF), vector info. **Edit** opens SVG, AI, EPS, PDF and VectorCraft files in Lime: select and move objects, recolour the artwork, align, flip, outline strokes, simplify, combine shapes, live effects, text, layers, artboards and image trace.
- **DesignCraft** — preflight, print PDF (PDF/X-4, bleed, marks) or web PDF, package for hand-over, fixed-layout EPUB, booklet. **Edit** opens IDML and DesignCraft layouts: edit stories, find and change (with GREP), swatches, fonts, page size, margins and pages, picture fitting, and preflight with fixes.
- **EffectCraft** — poster frame, transparent GIF or ProRes 4444 MOV, PNG frames, animation info, render to video. **Edit** opens Lottie and EffectCraft projects with a frame monitor and a layer timeline: text, colours, speed, trim, frame size, effects, transparency, then Lottie, MP4, GIF, WebM, ProRes or PNG frames.
- **FilmCraft** — split into scenes, clean up voices, film-look colour grades, edit-ready ProRes/DNxHR copies, media info, timeline conversion. **Edit** opens OTIO, FCPXML, XML, EDL and AAF timelines on a track view: trim, split, reorder, remove, speed, transitions, effects, looks, titles, markers and sequence settings, then MP4 or any of those formats.
- **PdfCraft** — optimise, remove hidden data, PDF/A, fillable forms, check redactions, Bates numbers, word count, print check, link web addresses, split at bookmarks, accessibility check, comment summary, compare, header and footer, page background, properties, page labels, export form data and fill a form from data. Lime adds crop marks and bleed, and bookmarks from headings.

## The editors

The PDF, image, video and audio editors and the four app editors work the same way:

- **Save** writes `<name> (edited).<ext>` beside the original (or where Save as… last put it). **Save as…** asks where, suggesting the same name; the original file is never written over. After Save as…, the window shows the new name.
- The PDF editor's **History** tab (in the side panel) names every step applied, such as "Replaced text on page 2", "Stamp APPROVED on page 1" or "Redacted 3 areas", and takes you back to any of them; the steps after it stay until you make a new change.
- Unsaved edits are kept in Lime's own folder every two minutes. If the window goes before you save (a crash, a power cut), opening the same file again offers them back.
- Each editor remembers the tool and zoom you last used for that kind of file, and the PDF editor its side panel. A fillable PDF still opens in Select so its fields can be filled in.
- Dropping a file onto an editor window opens it there, in the editor for its kind; unsaved edits are asked about first.
- **?** (or the Help button in the top bar) lists the keys of the editor you are in. The same keys mean the same everywhere:

| Keys | What |
|---|---|
| Ctrl/⌘ S · Ctrl/⌘ Shift S | Save · Save as… |
| Ctrl/⌘ Z · Ctrl/⌘ Y | Undo · Redo |
| Ctrl/⌘ W | Close (asks about unsaved edits) |
| + · − · 0 (with or without Ctrl/⌘) | Zoom in · out · fit |
| Esc | Deselect, or back to the first tool |
| V E T X N H P R O A L M C · K J Y D | Select, Edit text, Text, Erase, Note, Mark up, Draw, Box, Oval, Arrow, Line, Measure, Crop · Mask, Heal, Red eye, Adjust (the image editor) |
| Space · J K L · I O S | Play or pause · back, pause, faster · trim start, trim end, split (video and audio) |

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
