# Wimager

Wimager is a lightweight, fully client-side image upscaler built with **HTML + CSS + JavaScript**.

It lets you upload an image, choose a scaling multiplier, preview changes instantly, and export the upscaled result — all in the browser (no server upload).

## Live Demo
https://wimager.netlify.app/

## Features
- ✅ Drag & drop / file upload
- ✅ Multiplier slider (1× to 8×) with live preview
- ✅ Side-by-side preview (Original vs Result)
- ✅ Resize algorithms:
  - Progressive Canvas scaling (fast)
  - Lanczos-3 resampling (sharper, slower, pure JS)
- ✅ Sharpening:
  - Unsharp mask
  - Edge-aware sharpening (reduces halos)
- ✅ Contrast boost (improves color look)
- ✅ Export formats: PNG / JPEG / WEBP
- ✅ Runs fully offline after loading

## How it works (simple)
1. Load image into memory (browser decodes it)
2. Compute target size (multiplier or preset/custom)
3. Upscale using Progressive or Lanczos-3
4. Post-process with Contrast + Sharpen
5. Export full resolution as a downloadable file

## Project Structure
