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
  loadLamaBtn: document.getElementById("loadLamaBtn"),
  aiStatus: document.getElementById("aiStatus"),
  loadProgress: document.getElementById("loadProgress"),
  progressFill: document.getElementById("progressFill"),
  progressText: document.getElementById("progressText"),
};

const imgCtx = els.imgCanvas.getContext("2d", { willReadFrequently: true });
const maskCtx = els.maskCanvas.getContext("2d", { willReadFrequently: true });

let imageHistory = [];
let currentMask = null;
let isDragging = false;
let lastWandPos = null;
const MASK_COLOR = [255, 51, 102];
const HISTORY_LIMIT = 15;

let lamaSession = null;
let lamaLoading = false;
const LAMA_MODEL_URL = "https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx";
const ORT_VERSION = "1.18.0";
const ORT_SCRIPT = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort.min.js`;
const ORT_WASM_PATH = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;

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

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function fetchModelWithProgress(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} בהורדת המודל`);
  const total = parseInt(res.headers.get("content-length") || "0", 10);
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total > 0) {
      const pct = Math.round((received / total) * 100);
      els.progressFill.style.width = `${pct}%`;
      els.progressText.textContent = `${pct}% (${(received / 1048576).toFixed(1)}MB)`;
    } else {
      els.progressText.textContent = `${(received / 1048576).toFixed(1)}MB`;
    }
  }
  const buf = new Uint8Array(received);
  let pos = 0;
  for (const c of chunks) { buf.set(c, pos); pos += c.length; }
  return buf.buffer;
}

els.loadLamaBtn.addEventListener("click", loadLama);

async function loadLama() {
  if (lamaSession || lamaLoading) return;
  lamaLoading = true;
  els.loadLamaBtn.disabled = true;
  els.aiStatus.textContent = "טוען...";
  els.aiStatus.className = "ai-status loading";
  els.loadProgress.classList.remove("hidden");
  els.progressText.textContent = "טוען ONNX runtime...";

  try {
    await loadScript(ORT_SCRIPT);
    if (!window.ort) throw new Error("ONNX runtime לא נטען");
    ort.env.wasm.wasmPaths = ORT_WASM_PATH;

    els.progressText.textContent = "מוריד מודל LaMa...";
    const modelBuf = await fetchModelWithProgress(LAMA_MODEL_URL);

    els.progressText.textContent = "מאתחל מודל...";
    let providers = ["wasm"];
    try {
      if (navigator.gpu) providers = ["webgpu", "wasm"];
    } catch {}

    lamaSession = await ort.InferenceSession.create(modelBuf, {
      executionProviders: providers,
      graphOptimizationLevel: "all"
    });

    els.aiStatus.textContent = "מוכן ✓";
    els.aiStatus.className = "ai-status ready";
    els.loadLamaBtn.textContent = "✓ מודל נטען";
    els.loadProgress.classList.add("hidden");
    setStatus("מודל LaMa מוכן. סמן את סימן המים ולחץ הסר", "success");
  } catch (err) {
    console.error(err);
    els.aiStatus.textContent = "כשל בטעינה";
    els.aiStatus.className = "ai-status error";
    els.loadLamaBtn.disabled = false;
    setStatus(`שגיאה: ${err.message}`, "error");
    els.loadProgress.classList.add("hidden");
  } finally {
    lamaLoading = false;
  }
}

const LAMA_SIZE = 512;

function maskBoundingBox(maskU8, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (maskU8[y * w + x]) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

async function inpaintWithLama(maskU8) {
  const W = els.imgCanvas.width;
  const H = els.imgCanvas.height;
  const S = LAMA_SIZE;
  const plane = S * S;

  const bbox = maskBoundingBox(maskU8, W, H);
  if (!bbox) throw new Error("מסכה ריקה");

  const margin = Math.max(64, Math.round(Math.max(bbox.w, bbox.h) * 1.5));
  let cropX = Math.max(0, bbox.x - margin);
  let cropY = Math.max(0, bbox.y - margin);
  let cropEndX = Math.min(W, bbox.x + bbox.w + margin);
  let cropEndY = Math.min(H, bbox.y + bbox.h + margin);
  let cropW = cropEndX - cropX;
  let cropH = cropEndY - cropY;

  const sideMax = Math.max(cropW, cropH);
  const padW = sideMax - cropW;
  const padH = sideMax - cropH;
  const padLeft = Math.min(cropX, Math.floor(padW / 2));
  const padTop = Math.min(cropY, Math.floor(padH / 2));
  cropX -= padLeft;
  cropY -= padTop;
  cropW = Math.min(W - cropX, sideMax);
  cropH = Math.min(H - cropY, sideMax);

  const imgSmall = document.createElement("canvas");
  imgSmall.width = S;
  imgSmall.height = S;
  const imgSmallCtx = imgSmall.getContext("2d");
  imgSmallCtx.imageSmoothingEnabled = true;
  imgSmallCtx.imageSmoothingQuality = "high";
  imgSmallCtx.drawImage(els.imgCanvas, cropX, cropY, cropW, cropH, 0, 0, S, S);
  const smallImgData = imgSmallCtx.getImageData(0, 0, S, S).data;

  const maskBig = document.createElement("canvas");
  maskBig.width = W;
  maskBig.height = H;
  const maskBigCtx = maskBig.getContext("2d");
  const maskBigImg = maskBigCtx.createImageData(W, H);
  for (let i = 0, j = 0; i < maskU8.length; i++, j += 4) {
    const v = maskU8[i] > 0 ? 255 : 0;
    maskBigImg.data[j] = v;
    maskBigImg.data[j + 1] = v;
    maskBigImg.data[j + 2] = v;
    maskBigImg.data[j + 3] = 255;
  }
  maskBigCtx.putImageData(maskBigImg, 0, 0);

  const maskSmall = document.createElement("canvas");
  maskSmall.width = S;
  maskSmall.height = S;
  const maskSmallCtx = maskSmall.getContext("2d");
  maskSmallCtx.imageSmoothingEnabled = false;
  maskSmallCtx.drawImage(maskBig, cropX, cropY, cropW, cropH, 0, 0, S, S);
  const smallMaskData = maskSmallCtx.getImageData(0, 0, S, S).data;

  const imgArr = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    imgArr[i]             = smallImgData[i * 4]     / 255;
    imgArr[plane + i]     = smallImgData[i * 4 + 1] / 255;
    imgArr[2 * plane + i] = smallImgData[i * 4 + 2] / 255;
  }

  const maskArr = new Float32Array(plane);
  for (let i = 0; i < plane; i++) {
    maskArr[i] = smallMaskData[i * 4] > 127 ? 1.0 : 0.0;
  }

  const imgTensor = new ort.Tensor("float32", imgArr, [1, 3, S, S]);
  const maskTensor = new ort.Tensor("float32", maskArr, [1, 1, S, S]);

  const inputNames = lamaSession.inputNames;
  const feeds = {};
  feeds[inputNames[0]] = imgTensor;
  feeds[inputNames[1]] = maskTensor;

  const results = await lamaSession.run(feeds);
  const outKey = lamaSession.outputNames[0];
  const out = results[outKey];
  const outArr = out.data;

  const outSmall = document.createElement("canvas");
  outSmall.width = S;
  outSmall.height = S;
  const outSmallCtx = outSmall.getContext("2d");
  const outSmallImg = outSmallCtx.createImageData(S, S);
  const osd = outSmallImg.data;
  let maxV = 0;
  for (let i = 0; i < outArr.length; i++) {
    if (outArr[i] > maxV) maxV = outArr[i];
  }
  const scale = maxV <= 1.5 ? 255 : 1;
  for (let i = 0; i < plane; i++) {
    osd[i * 4]     = Math.max(0, Math.min(255, outArr[i]             * scale));
    osd[i * 4 + 1] = Math.max(0, Math.min(255, outArr[plane + i]     * scale));
    osd[i * 4 + 2] = Math.max(0, Math.min(255, outArr[2 * plane + i] * scale));
    osd[i * 4 + 3] = 255;
  }
  outSmallCtx.putImageData(outSmallImg, 0, 0);

  const outFull = document.createElement("canvas");
  outFull.width = W;
  outFull.height = H;
  const outFullCtx = outFull.getContext("2d");
  outFullCtx.drawImage(els.imgCanvas, 0, 0);
  outFullCtx.imageSmoothingEnabled = true;
  outFullCtx.imageSmoothingQuality = "high";
  outFullCtx.drawImage(outSmall, 0, 0, S, S, cropX, cropY, cropW, cropH);

  return outFullCtx.getImageData(0, 0, W, H);
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
  if (!lamaSession) {
    setStatus("טען את מודל ה-AI תחילה", "error");
    return;
  }
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
  setStatus(`AI מעבד<span class="spinner"></span>`, "loading");
  await new Promise(r => setTimeout(r, 30));

  try {
    const inpainted = await inpaintWithLama(mask);
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
