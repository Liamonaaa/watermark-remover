# Watermark Remover

100% client-side watermark removal. No AI, no API key, no signup, no upload — runs entirely in your browser using OpenCV.js classical inpainting (Telea / Navier-Stokes).

## Live demo

https://liamonaaa.github.io/watermark-remover/

## Usage

1. Upload an image.
2. Paint over the watermark with the brush.
3. Click "Remove watermark".
4. Repeat if needed, then download.

## How it works

- Image and mask live on two stacked HTML canvases.
- On submit, the mask alpha channel is converted to a binary `cv.Mat`.
- `cv.inpaint(src, mask, dst, radius, flag)` fills the masked region from surrounding pixels.
  - **Telea**: Fast Marching Method. Faster.
  - **Navier-Stokes**: Fluid dynamics analogy. Slower, often smoother on textured regions.

Best on thin or semi-transparent watermarks over relatively uniform backgrounds. Less effective on opaque logos covering complex texture.

## Tech

- Vanilla HTML / CSS / JS.
- [OpenCV.js](https://docs.opencv.org/4.x/opencv.js) loaded from CDN.
- Hosted on GitHub Pages.

## Local development

Open `index.html` directly in a browser. No build step.

## Legal

Use only on images you own or have permission to edit. Removing watermarks from third-party content may violate copyright.
