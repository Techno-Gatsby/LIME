# Clementine

An offline file converter, PDF editor and media toolkit for Windows. Drag a file, tap a key, drop: a wheel opens under your pointer with the formats and tools that fit that file. Everything runs on your PC; nothing is uploaded.

## Install

- **Installer:** run `Clementine-Setup-1.0.0.exe`. Per-user install, no admin rights. Adds “Convert with Clementine” to the File Explorer right-click menu and to Send To.
- **Portable:** unzip `Clementine-1.0.0-x64-portable.zip` anywhere and run `Clementine.exe`. Turn on the Explorer menu in Settings › Quick wheel.

Windows 10 or 11, 64-bit. The installer isn’t code-signed yet, so SmartScreen will warn: choose **More info › Run anyway**.

## Using it

| Where | How |
|---|---|
| In the window | Drop files on Home to see every tool that fits, or open a tool from the sidebar. |
| Quick wheel | While dragging, tap **Shift** (convert), **Ctrl** (tools) or **Alt** (actions). Drop on a slice. |
| File Explorer | Right-click › **Convert with Clementine** (Windows 11: *Show more options*), or select files and press **Ctrl+Shift+Space**. |
| Drop dock | Settings › Drop dock: a small target above the taskbar. |

Results save next to the original with a new name (or to one folder of your choice). Originals are never changed.

## What it does (67 tools)

**PDF** — edit existing text (true removal, not white boxes), add text, images, shapes, highlights, drawing, signatures; merge, split, compress (real image recompression), rotate, crop, organise pages, remove/extract pages, page numbers, watermark, redact (words and patterns like emails, phone and card numbers), protect (AES-256) and unlock, OCR (searchable PDFs), repair, flatten, metadata, extract images; PDF ↔ Word, PowerPoint, Excel, JPG/PNG, text, HTML; Word/PowerPoint/Excel/HTML/images → PDF.

**Images** — convert (JPG, PNG, WebP, AVIF, HEIC in, TIFF, GIF, BMP, ICO, JPEG XL, PSD in, RAW previews), compress, resize, smart crop, background removal (on-device AI), upscale (AI with Real-ESRGAN), rotate/flip, photo adjustments and filters, watermark, meme, strip EXIF/GPS, collage, GIF maker, OCR, web page screenshots.

**Video & audio** — convert (MP4/H.264, HEVC, WebM, MOV, MKV, AVI, WMV, GIF; MP3, M4A, WAV, FLAC, OGG, Opus, AIFF, WMA), compress (by quality or target size), trim, merge (mixed sizes OK), extract audio, mute, resize, rotate, speed, video to GIF, frames, burn subtitles, loudness levelling, photo slideshows, subtitle conversion.

**Documents** — Word, ODT, RTF, Markdown, HTML, EPUB, text, PowerPoint formats; spreadsheets (XLSX, XLS, ODS, CSV, TSV, JSON, HTML, PDF); merge any mix of documents into one PDF; merge workbooks.

**Archives** — extract 40+ formats including RAR/RAR5, 7Z, ISO, CAB, TAR.GZ; create ZIP/7Z/TAR.GZ/TAR.XZ with AES-256 passwords and split volumes; convert and test archives.

**Utilities** — checksums (MD5/SHA-1/SHA-256/SHA-512 with compare), batch rename.

**Studio apps** — installs, updates and launches the seven open-source ArtCraft Crafting Apps (PhotoCraft, VectorCraft, FilmCraft, LightCraft, PdfCraft, EffectCraft, DesignCraft) from their official releases, and opens your files in them.

## Engines

Bundled: MuPDF + pdf-lib, libvips (sharp), FFmpeg 8.1, 7-Zip 26, Tesseract, IMG.LY background removal.
Optional, one click in Settings › Engines: **LibreOffice** (best Office fidelity), **Pandoc** (EPUB/markup), **Real-ESRGAN** (AI upscaling, needs a Vulkan GPU).

## Known limits

- PDF text editing replaces whole lines using a matched standard font (Noto/Helvetica family), not the document’s embedded font. Rotated or vertical text can’t be edited in place; erase it and add new text.
- PDF → Word rebuilds paragraphs, headings and images; complex layouts won’t match exactly. Choose “Keep layout” (needs LibreOffice) for positional fidelity.
- Office ↔ PDF without LibreOffice uses built-in converters that handle text and simple formatting; install LibreOffice for complex documents and all PowerPoint conversions.
- On Windows 11 the right-click entry sits under “Show more options”.
- Not code-signed.

## Build from source

```
npm install
npm run fetch-engines      # FFmpeg, 7-Zip, OCR model, fonts → vendor/
npm start                  # run in development
npm test                   # end-to-end engine tests (43 cases)
npm run dist               # Windows installer + zip in dist/ (on Linux, needs Wine)
```
`.github/workflows/build-windows.yml` builds the installer on a Windows runner.

## Licence

AGPL-3.0-or-later (required by MuPDF). Third-party notices: `LICENSES/THIRD-PARTY-NOTICES.txt`.
