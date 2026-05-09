const els = {
  uploadSection: document.getElementById("uploadSection"),
  editorSection: document.getElementById("editorSection"),
  dropZone: document.getElementById("dropZone"),
  fileInput: document.getElementById("fileInput"),
  imgCanvas: document.getElementById("imgCanvas"),
  maskCanvas: document.getElementById("maskCanvas"),
  wandTolerance: document.getElementById("wandTolerance"),
  wandToleranceVal: document.getElementById("wandToleranceVal"),
  wandContiguous: document.getElementById("wandContiguous"),
  maskDilate: document.getElementById("maskDilate"),
  maskDilateVal: document.getElementById("maskDilateVal"),
  featherSize: document.getElementById("featherSize"),
  featherSizeVal: document.getElementById("featherSizeVal"),
  clearMaskBtn: document.getElementById("clearMaskBtn"),
  undoBtn: document.getElementById("undoBtn"),
  removeBtn: document.getElementById("removeBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  resetBtn: document.getElementById("resetBtn"),
  status: document.getElementById("status"),
  aiStatus: document.getElementById("aiStatus"),
  aiOverlay: document.getElementById("aiOverlay"),
  aiOverlaySub: document.getElementById("aiOverlaySub"),
};

const GEMINI_MODEL = "gemini-2.5-flash-image";
const GEMINI_KEY_STORAGE = "gemini_api_key";

function getGeminiKey() {
  let key = localStorage.getItem(GEMINI_KEY_STORAGE);
  if (!key) {
    key = prompt("הכנס Gemini API key (נשמר מקומית בדפדפן):");
    if (key) {
      key = key.trim();
      localStorage.setItem(GEMINI_KEY_STORAGE, key);
    }
  }
  return key;
}

function geminiUrl(key) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
}

function showAiOverlay(sub) {
  if (sub) els.aiOverlaySub.textContent = sub;
  els.aiOverlay.classList.remove("hidden");
}

function hideAiOverlay() {
  els.aiOverlay.classList.add("hidden");
}

const imgCtx = els.imgCanvas.getContext("2d", { willReadFrequently: true });
const maskCtx = els.maskCanvas.getContext("2d", { willReadFrequently: true });

let imageHistory = [];
let currentMask = null;
let isDragging = false;
let lastWandPos = null;
const MASK_COLOR = [255, 51, 102];
const HISTORY_LIMIT = 15;

const bindRange = (input, label) => {
  input.addEventListener("input", () => { label.textContent = input.value; });
};
bindRange(els.wandTolerance, els.wandToleranceVal);
bindRange(els.maskDilate, els.maskDilateVal);
bindRange(els.featherSize, els.featherSizeVal);

els.dropZone.addEventListener("click", () => els.fileInput.click());
els.dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  els.dropZone.classList.add("dragover");
});
els.dropZone.addEventListener("dragleave", () => {
  els.dropZone.classList.remove("dragover");
});
els.dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  els.dropZone.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (file) loadImage(file);
});
els.fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) loadImage(file);
});

function loadImage(file) {
  if (!file.type.startsWith("image/")) {
    setStatus("רק קבצי תמונה", "error");
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      setupCanvas(img);
      els.uploadSection.classList.add("hidden");
      els.editorSection.classList.remove("hidden");
      clearStatus();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function setupCanvas(img) {
  const maxSide = 1600;
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (Math.max(w, h) > maxSide) {
    const scale = maxSide / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }
  els.imgCanvas.width = w;
  els.imgCanvas.height = h;
  els.maskCanvas.width = w;
  els.maskCanvas.height = h;
  imgCtx.drawImage(img, 0, 0, w, h);
  maskCtx.clearRect(0, 0, w, h);
  imageHistory = [];
  currentMask = null;
  els.maskCanvas.style.cursor = "pointer";
  els.downloadBtn.classList.add("hidden");
  els.removeBtn.disabled = true;
}

function getCanvasPoint(e) {
  const rect = els.maskCanvas.getBoundingClientRect();
  const scaleX = els.maskCanvas.width / rect.width;
  const scaleY = els.maskCanvas.height / rect.height;
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: Math.round((clientX - rect.left) * scaleX),
    y: Math.round((clientY - rect.top) * scaleY)
  };
}

function pushImageHistory() {
  const w = els.imgCanvas.width;
  const h = els.imgCanvas.height;
  imageHistory.push(imgCtx.getImageData(0, 0, w, h));
  if (imageHistory.length > HISTORY_LIMIT) imageHistory.shift();
}

function colorDistance(r1, g1, b1, r2, g2, b2) {
  const rmean = (r1 + r2) / 2;
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt(
    (((512 + rmean) * dr * dr) / 256) +
    4 * dg * dg +
    (((767 - rmean) * db * db) / 256)
  );
}

function buildWandMask(sx, sy) {
  const w = els.imgCanvas.width;
  const h = els.imgCanvas.height;
  const imgData = imgCtx.getImageData(0, 0, w, h);
  const data = imgData.data;
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;
  const idx = (sy * w + sx) * 4;
  const tr = data[idx], tg = data[idx + 1], tb = data[idx + 2];
  const tolerance = parseInt(els.wandTolerance.value, 10);
  const contiguous = els.wandContiguous.checked;

  const mask = new Uint8Array(w * h);

  if (contiguous) {
    const visited = new Uint8Array(w * h);
    const stack = [[sx, sy]];
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const pi = y * w + x;
      if (visited[pi]) continue;
      visited[pi] = 1;
      const di = pi * 4;
      const dist = colorDistance(data[di], data[di + 1], data[di + 2], tr, tg, tb);
      if (dist > tolerance) continue;
      mask[pi] = 255;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  } else {
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      const dist = colorDistance(data[i], data[i + 1], data[i + 2], tr, tg, tb);
      if (dist <= tolerance) mask[j] = 255;
    }
  }
  return mask;
}

function dilateMask(mask, w, h, radius) {
  if (radius <= 0) return mask;
  let cur = mask;
  for (let r = 0; r < radius; r++) {
    const next = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (cur[i]) { next[i] = 255; continue; }
        if (
          (x > 0 && cur[i - 1]) ||
          (x < w - 1 && cur[i + 1]) ||
          (y > 0 && cur[i - w]) ||
          (y < h - 1 && cur[i + w])
        ) {
          next[i] = 255;
        }
      }
    }
    cur = next;
  }
  return cur;
}

function erodeMask(mask, w, h, radius) {
  if (radius <= 0) return mask;
  let cur = mask;
  for (let r = 0; r < radius; r++) {
    const next = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!cur[i]) continue;
        if (
          (x === 0 || cur[i - 1]) &&
          (x === w - 1 || cur[i + 1]) &&
          (y === 0 || cur[i - w]) &&
          (y === h - 1 || cur[i + w])
        ) {
          next[i] = 255;
        }
      }
    }
    cur = next;
  }
  return cur;
}

function closeMask(mask, w, h, radius) {
  return erodeMask(dilateMask(mask, w, h, radius), w, h, radius);
}

function featherMask(mask, w, h, radius) {
  if (radius <= 0) {
    const out = new Float32Array(w * h);
    for (let i = 0; i < mask.length; i++) out[i] = mask[i] / 255;
    return out;
  }
  const dist = new Float32Array(w * h);
  for (let i = 0; i < mask.length; i++) dist[i] = mask[i] ? 0 : Infinity;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (dist[i] === 0) continue;
      let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + 1);
      if (y > 0) d = Math.min(d, dist[i - w] + 1);
      if (x > 0 && y > 0) d = Math.min(d, dist[i - w - 1] + 1.41421356);
      if (x < w - 1 && y > 0) d = Math.min(d, dist[i - w + 1] + 1.41421356);
      dist[i] = d;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let d = dist[i];
      if (x < w - 1) d = Math.min(d, dist[i + 1] + 1);
      if (y < h - 1) d = Math.min(d, dist[i + w] + 1);
      if (x < w - 1 && y < h - 1) d = Math.min(d, dist[i + w + 1] + 1.41421356);
      if (x > 0 && y < h - 1) d = Math.min(d, dist[i + w - 1] + 1.41421356);
      dist[i] = d;
    }
  }

  const alpha = new Float32Array(w * h);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      alpha[i] = 1;
    } else if (dist[i] >= radius) {
      alpha[i] = 0;
    } else {
      const t = 1 - dist[i] / radius;
      alpha[i] = t * t * (3 - 2 * t);
    }
  }
  return alpha;
}

function renderMaskOverlay() {
  const w = els.imgCanvas.width;
  const h = els.imgCanvas.height;
  if (!currentMask) {
    maskCtx.clearRect(0, 0, w, h);
    return;
  }
  const out = maskCtx.createImageData(w, h);
  const od = out.data;
  const [mr, mg, mb] = MASK_COLOR;
  for (let i = 0, j = 0; i < currentMask.length; i++, j += 4) {
    if (currentMask[i]) {
      od[j] = mr; od[j + 1] = mg; od[j + 2] = mb; od[j + 3] = 180;
    }
  }
  maskCtx.putImageData(out, 0, 0);
}

function addWandAt(x, y) {
  const newMask = buildWandMask(x, y);
  if (!newMask) return 0;
  const w = els.imgCanvas.width;
  const h = els.imgCanvas.height;
  if (!currentMask) currentMask = new Uint8Array(w * h);
  let added = 0;
  for (let i = 0; i < newMask.length; i++) {
    if (newMask[i] && !currentMask[i]) { currentMask[i] = 255; added++; }
  }
  return added;
}

// ---------- Gemini inpaint ----------

function canvasToBase64Png(canvas) {
  // Returns base64 (no prefix)
  const dataUrl = canvas.toDataURL("image/png");
  return dataUrl.split(",")[1];
}

function buildMaskedImage(maskU8, w, h) {
  // Composite: original image with bright magenta highlight on masked pixels,
  // so Gemini can see exactly which area to replace.
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const cx = c.getContext("2d");
  cx.drawImage(els.imgCanvas, 0, 0);
  const imgData = cx.getImageData(0, 0, w, h);
  const d = imgData.data;
  for (let i = 0, j = 0; i < maskU8.length; i++, j += 4) {
    if (maskU8[i]) {
      // Solid magenta marker
      d[j]     = 255;
      d[j + 1] = 0;
      d[j + 2] = 255;
      d[j + 3] = 255;
    }
  }
  cx.putImageData(imgData, 0, 0);
  return c;
}

function buildMaskOnlyImage(maskU8, w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const cx = c.getContext("2d");
  const imgData = cx.createImageData(w, h);
  const d = imgData.data;
  for (let i = 0, j = 0; i < maskU8.length; i++, j += 4) {
    const v = maskU8[i] ? 255 : 0;
    d[j] = v; d[j + 1] = v; d[j + 2] = v; d[j + 3] = 255;
  }
  cx.putImageData(imgData, 0, 0);
  return c;
}

async function inpaintWithGemini(maskU8) {
  const key = getGeminiKey();
  if (!key) throw new Error("חסר API key");

  const W = els.imgCanvas.width;
  const H = els.imgCanvas.height;

  const originalB64 = canvasToBase64Png(els.imgCanvas);
  const maskedCanvas = buildMaskedImage(maskU8, W, H);
  const maskedB64 = canvasToBase64Png(maskedCanvas);

  const prompt = `You are an expert photo editor. The SECOND image shows the FIRST image with a solid bright magenta (#FF00FF) overlay marking a watermark/logo/text that must be removed.

Task: Output the FIRST image with EXACTLY that magenta-marked region removed and seamlessly inpainted to match the surrounding pixels (textures, lighting, shadows, gradients).

Strict rules:
- Do NOT change any pixel outside the magenta-marked region.
- Do NOT include any magenta in the output.
- Do NOT add new objects, text, or watermarks.
- Keep original resolution, aspect ratio, and image quality.
- Output ONLY the cleaned image, nothing else.`;

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: "image/png", data: originalB64 } },
        { inline_data: { mime_type: "image/png", data: maskedB64 } }
      ]
    }],
    generationConfig: {
      responseModalities: ["IMAGE"]
    }
  };

  const res = await fetch(geminiUrl(key), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      if (errJson?.error?.message) msg = errJson.error.message;
    } catch {}
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      localStorage.removeItem(GEMINI_KEY_STORAGE);
    }
    throw new Error(msg);
  }

  const json = await res.json();
  const parts = json?.candidates?.[0]?.content?.parts || [];
  let imgPart = null;
  for (const p of parts) {
    if (p.inline_data?.data || p.inlineData?.data) { imgPart = p; break; }
  }
  if (!imgPart) {
    const txt = parts.map(p => p.text).filter(Boolean).join(" ");
    throw new Error(txt || "Gemini לא החזיר תמונה");
  }
  const inline = imgPart.inline_data || imgPart.inlineData;
  const mime = inline.mime_type || inline.mimeType || "image/png";
  const b64 = inline.data;

  const img = await loadImageFromDataUrl(`data:${mime};base64,${b64}`);

  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const ocx = out.getContext("2d");
  ocx.imageSmoothingEnabled = true;
  ocx.imageSmoothingQuality = "high";
  ocx.drawImage(img, 0, 0, W, H);
  return ocx.getImageData(0, 0, W, H);
}

function loadImageFromDataUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function blendInpainted(originalImageData, inpaintedImageData, alpha, w, h) {
  const od = originalImageData.data;
  const id = inpaintedImageData.data;
  for (let i = 0; i < w * h; i++) {
    const a = alpha[i];
    if (a <= 0) continue;
    const di = i * 4;
    od[di]     = id[di]     * a + od[di]     * (1 - a);
    od[di + 1] = id[di + 1] * a + od[di + 1] * (1 - a);
    od[di + 2] = id[di + 2] * a + od[di + 2] * (1 - a);
  }
}

function startSelect(e) {
  e.preventDefault();
  isDragging = true;
  const p = getCanvasPoint(e);
  lastWandPos = p;
  const added = addWandAt(p.x, p.y);
  if (added > 0) {
    renderMaskOverlay();
    els.removeBtn.disabled = false;
  }
}

function moveSelect(e) {
  if (!isDragging) return;
  e.preventDefault();
  const p = getCanvasPoint(e);
  const dist = lastWandPos ? Math.hypot(p.x - lastWandPos.x, p.y - lastWandPos.y) : Infinity;
  if (dist < 8) return;
  lastWandPos = p;
  const added = addWandAt(p.x, p.y);
  if (added > 0) {
    renderMaskOverlay();
    els.removeBtn.disabled = false;
  }
}

function endSelect() {
  isDragging = false;
  lastWandPos = null;
}

els.maskCanvas.addEventListener("mousedown", startSelect);
els.maskCanvas.addEventListener("mousemove", moveSelect);
window.addEventListener("mouseup", endSelect);
els.maskCanvas.addEventListener("touchstart", startSelect, { passive: false });
els.maskCanvas.addEventListener("touchmove", moveSelect, { passive: false });
els.maskCanvas.addEventListener("touchend", endSelect);

els.clearMaskBtn.addEventListener("click", () => {
  currentMask = null;
  renderMaskOverlay();
  els.removeBtn.disabled = true;
  clearStatus();
});

els.removeBtn.addEventListener("click", async () => {
  if (!currentMask) {
    setStatus("סמן את סימן המים תחילה", "error");
    return;
  }

  const w = els.imgCanvas.width;
  const h = els.imgCanvas.height;

  let mask = closeMask(currentMask, w, h, 2);

  const dilateAmount = parseInt(els.maskDilate.value, 10);
  if (dilateAmount > 0) mask = dilateMask(mask, w, h, dilateAmount);

  let count = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) count++;
  if (count === 0) {
    setStatus("מסכה ריקה", "error");
    return;
  }

  const featherAmount = parseInt(els.featherSize.value, 10);
  const alpha = featherMask(mask, w, h, featherAmount);

  els.removeBtn.disabled = true;
  showAiOverlay(`שולח ל-Gemini אזור של ${count.toLocaleString()} פיקסלים...`);
  setStatus(`AI מעבד<span class="spinner"></span>`, "loading");
  await new Promise(r => setTimeout(r, 50));

  try {
    const inpainted = await inpaintWithGemini(mask);
    pushImageHistory();
    const original = imgCtx.getImageData(0, 0, w, h);
    blendInpainted(original, inpainted, alpha, w, h);
    imgCtx.putImageData(original, 0, 0);
    currentMask = null;
    renderMaskOverlay();
    els.downloadBtn.classList.remove("hidden");
    setStatus(`הוסר ${count.toLocaleString()} פיקסלים`, "success");
  } catch (err) {
    console.error(err);
    setStatus(`שגיאת AI: ${err.message}`, "error");
    els.removeBtn.disabled = false;
  } finally {
    hideAiOverlay();
  }
});

els.undoBtn.addEventListener("click", () => {
  if (imageHistory.length === 0) {
    setStatus("אין צעד לבטל", "error");
    return;
  }
  const prev = imageHistory.pop();
  imgCtx.putImageData(prev, 0, 0);
  setStatus("בוטל", "success");
});

els.resetBtn.addEventListener("click", () => {
  els.uploadSection.classList.remove("hidden");
  els.editorSection.classList.add("hidden");
  els.fileInput.value = "";
  imgCtx.clearRect(0, 0, els.imgCanvas.width, els.imgCanvas.height);
  maskCtx.clearRect(0, 0, els.maskCanvas.width, els.maskCanvas.height);
  imageHistory = [];
  currentMask = null;
  els.removeBtn.disabled = true;
  clearStatus();
});

els.downloadBtn.addEventListener("click", () => {
  els.imgCanvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cleaned.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
});

function setStatus(html, kind = "") {
  els.status.className = `status ${kind}`;
  els.status.innerHTML = html;
  els.status.classList.remove("hidden");
}

function clearStatus() {
  els.status.classList.add("hidden");
  els.status.innerHTML = "";
}
