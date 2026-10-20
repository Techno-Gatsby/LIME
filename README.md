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
| Drag files and hold **Shift** | The wheel opens under the pointer, already showing what those files can become. Drop on a slice to run it in one go, or drop in the middle to see every choice. |
| While dragging, hold **Option** (Windows: **Alt**) or **Control** | Shows the Tools or More ring instead. You can also hold the file over a tab at the top for half a second. |
| Drag files onto the lime at the edge, or into the bottom-left corner | The wheel blooms there; drop the files on it. |
| Click the lime | Opens the wheel; click the middle to choose files. |
| Click a slice | Runs it. If the tool has settings (pages, quality, a password, the order of files), a card asks first. Right-click a slice for every setting. |
| **Convert · Tools · More** | Switches the ring (or press Tab). **More** lists every tool that fits, with search. |
| Drag the middle after a job | Drags the results into any app or folder. |
| **Control + Option + L** (Windows: **Ctrl + Alt + L**) | Shows or hides the wheel. On a Mac with files selected in Finder, opens them in the wheel. |
| Menu bar / tray icon | Show the wheel, choose files, recent results, settings. |

On a Mac, Lime reads the dragged files straight from the drag, so the right choices appear for files from any app; no permission is needed. On Windows they appear for files dragged from File Explorer or the desktop; from other apps, drop first and pick a slice. Trackpads with Force Touch give a light tick as the highlight moves.

Lime asks where to save each result. To save next to the original instead, switch this off in Settings. Originals are never changed.

## What it does (85 tools)

**PDF** — edit text, sign, organise pages, merge, split, compress, optimise, rotate, crop, page numbers, watermark, redact and check redactions, protect and unlock, searchable PDF (OCR), repair, flatten, extract images. Also PDF to Word, PowerPoint, Excel, images, text, HTML and SVG, and anything to PDF.

**Images** — convert (HEIC, RAW, PSD/PSB, EXR, WebP, AVIF, JPEG XL, TIFF and more), develop RAW, auto-enhance, HDR merge, panorama, compress, resize, crop, remove background (on-device AI), upscale, rotate, adjust, watermark, remove photo info, collage, GIF maker, and image to text (OCR in 13 languages).

**Video and audio** — convert (MP4, MOV, HEVC, WebM, MKV, AVI, GIF; MP3, M4A, WAV, FLAC, OGG, Opus), compress, trim, merge, extract audio, mute, resize, rotate, speed, video to GIF or frames, subtitles, loudness and slideshows. Lottie animations and edit timelines (OTIO, FCPXML) render to video.

**Documents** — Word, ODT, RTF, Markdown, HTML, EPUB and text; spreadsheets (XLSX, XLS, ODS, CSV, JSON); slides (PowerPoint); page layouts (IDML) to PDF, EPUB or PowerPoint; merge documents into one PDF. On a Mac with Pages, Numbers or Keynote installed, their files convert too.

**CAD** — DWG, DXF, STEP, IGES, BREP, STL, OBJ, PLY, GLB, 3MF and FBX (read only). Drawings convert to PDF, SVG, PNG, DXF, AI, EPS or EMF; 3D models convert between formats and to rendered images; plus measurements. Vector art (SVG, AI, EPS, PDF, EMF, Affinity) converts between formats.

**Archives** — extract 40+ formats including RAR, 7Z and ISO; create ZIP, 7Z or TAR.GZ with passwords; convert and test archives.

**Utilities** — checksums, batch rename.

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
