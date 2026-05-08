# Watermark Remover

Static web app that removes watermarks from images using Google's Gemini 2.5 Flash Image model.

## Live demo

Deployed via GitHub Pages.

## Usage

1. Get a free Gemini API key at [Google AI Studio](https://aistudio.google.com/apikey).
2. Paste the key and click Save (stored in `localStorage`, never sent anywhere except Google's API).
3. Upload an image.
4. Click "Remove watermark".
5. Download the result.

## How it works

- Pure client-side HTML/CSS/JS. No backend.
- Calls `gemini-2.5-flash-image-preview` via the Generative Language API directly from the browser.
- Sends the image inline as base64 with a watermark-removal prompt.

## Local development

Open `index.html` in a browser. That's it.

## Security note

API key lives in `localStorage` and is exposed in network requests from the browser. Fine for personal use. Do not embed your own key in the HTML or share the deployed URL with your key prefilled.

## Legal

Use only on images you own or have permission to edit. Removing watermarks from third-party content may violate copyright.
