const els = {
  uploadSection: document.getElementById("uploadSection"),
  editorSection: document.getElementById("editorSection"),
  dropZone: document.getElementById("dropZone"),
  fileInput: document.getElementById("fileInput"),
  imgCanvas: document.getElementById("imgCanvas"),
  maskCanvas: document.getElementById("maskCanvas"),
  brushSize: document.getElementById("brushSize"),
  brushSizeVal: document.getElementById("brushSizeVal"),
  wandTolerance: document.getElementById("wandTolerance"),
  wandToleranceVal: document.getElementById("wandToleranceVal"),
  wandContiguous: document.getElementById("wandContiguous"),
  autoColor: document.getElementById("autoColor"),
  autoTolerance: document.getElementById("autoTolerance"),
  autoToleranceVal: document.getElementById("autoToleranceVal"),
  autoDetectBtn: document.getElementById("autoDetectBtn"),
  maskDilate: document.getElementById("maskDilate"),
  maskDilateVal: document.getElementById("maskDilateVal"),
  inpaintRadius: document.getElementById("inpaintRadius"),
  inpaintRadiusVal: document.getElementById("inpaintRadiusVal"),
  algo: document.getElementById("algo"),
  clearMaskBtn: document.getElementById("clearMaskBtn"),
  undoBtn: document.getElementById("undoBtn"),
  processBtn: document.getElementById("processBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  resetBtn: document.getElementById("resetBtn"),
  status: document.getElementById("status"),
  tabs: document.querySelectorAll(".tab"),
  setSourceBtn: document.getElementById("setSourceBtn"),
  sourceStatus: document.getElementById("sourceStatus"),
  stampSize: document.getElementById("stampSize"),
  stampSizeVal: document.getElementById("stampSizeVal"),
  stampHardness: document.getElementById("stampHardness"),
  stampHardnessVal: document.getElementById("stampHardnessVal"),
};

const imgCtx = els.imgCanvas.getContext("2d", { willReadFrequently: true });
const maskCtx = els.maskCanvas.getContext("2d", { willReadFrequently: true });

let cvReady = false;
let originalImageData = null;
let maskHistory = [];
let drawing = false;
let lastPoint = null;
let currentTool = "brush";
const MASK_COLOR = [255, 51, 102];

window.addEventListener("load", () => {
  if (window.cv && window.cv.Mat) {
    cvReady = true;
  } else {
    setStatus(`טוען OpenCV<span class="spinner"></span>`, "loading");
    const check = setInterval(() => {
      if (window.cv && window.cv.Mat) {
        cvReady = true;
        clearInterval(check);
        clearStatus();
      }
    }, 200);
  }
});

const bindRange = (input, label) => {
  input.addEventListener("input", () => { label.textContent = input.value; });
};
bindRange(els.brushSize, els.brushSizeVal);
bindRange(els.wandTolerance, els.wandToleranceVal);
bindRange(els.autoTolerance, els.autoToleranceVal);
bindRange(els.maskDilate, els.maskDilateVal);
bindRange(els.inpaintRadius, els.inpaintRadiusVal);
bindRange(els.stampSize, els.stampSizeVal);
bindRange(els.stampHardness, els.stampHardnessVal);

let stampSource = null;
let stampPickMode = false;
let stampClickPoint = null;
let imageHistory = [];

els.setSourceBtn.addEventListener("click", () => {
  stampPickMode = true;
  els.sourceStatus.textContent = "לחץ על נקודה בתמונה...";
  els.sourceStatus.style.color = "var(--primary)";
  els.maskCanvas.style.cursor = "copy";
});

function pushImageHistory() {
  const w = els.imgCanvas.width;
  const h = els.imgCanvas.height;
  imageHistory.push(imgCtx.getImageData(0, 0, w, h));
  if (imageHistory.length > 10) imageHistory.shift();
}

function applyStamp(targetX, targetY) {
  if (!stampSource || !stampClickPoint) return;
  const size = parseInt(els.stampSize.value, 10);
  const hardness = parseInt(els.stampHardness.value, 10) / 100;
  const radius = size / 2;
  const w = els.imgCanvas.width;
  const h = els.imgCanvas.height;

  const offsetX = stampSource.x - stampClickPoint.x;
  const offsetY = stampSource.y - stampClickPoint.y;
  const srcX = Math.round(targetX + offsetX);
  const srcY = Math.round(targetY + offsetY);

  const x0 = Math.max(0, Math.round(targetX - radius));
  const y0 = Math.max(0, Math.round(targetY - radius));
  const x1 = Math.min(w, Math.round(targetX + radius));
  const y1 = Math.min(h, Math.round(targetY + radius));
  if (x1 <= x0 || y1 <= y0) return;

  const tw = x1 - x0;
  const th = y1 - y0;

  const sx0 = srcX - (Math.round(targetX) - x0);
  const sy0 = srcY - (Math.round(targetY) - y0);
  if (sx0 < 0 || sy0 < 0 || sx0 + tw > w || sy0 + th > h) return;

  const target = imgCtx.getImageData(x0, y0, tw, th);
  const source = imgCtx.getImageData(sx0, sy0, tw, th);
  const td = target.data;
  const sd = source.data;

  for (let yy = 0; yy < th; yy++) {
    for (let xx = 0; xx < tw; xx++) {
      const dx = (x0 + xx) - targetX;
      const dy = (y0 + yy) - targetY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) continue;
      const t = dist / radius;
      const falloff = t < hardness ? 1 : Math.pow(1 - (t - hardness) / (1 - hardness + 0.0001), 2);
      const alpha = Math.max(0, Math.min(1, falloff));
      const i = (yy * tw + xx) * 4;
      td[i]     = sd[i]     * alpha + td[i]     * (1 - alpha);
      td[i + 1] = sd[i + 1] * alpha + td[i + 1] * (1 - alpha);
      td[i + 2] = sd[i + 2] * alpha + td[i + 2] * (1 - alpha);
    }
  }
  imgCtx.putImageData(target, x0, y0);
}

els.tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    els.tabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    currentTool = tab.dataset.tool;
    document.querySelectorAll(".tool-panel").forEach(p => p.classList.add("hidden"));
    document.getElementById(`panel-${currentTool}`).classList.remove("hidden");
    if (currentTool === "brush") els.maskCanvas.style.cursor = "crosshair";
    else if (currentTool === "stamp") els.maskCanvas.style.cursor = stampSource ? "crosshair" : "pointer";
    else els.maskCanvas.style.cursor = "pointer";
  });
});

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
  originalImageData = imgCtx.getImageData(0, 0, w, h);
  maskCtx.clearRect(0, 0, w, h);
  maskHistory = [];
  els.downloadBtn.classList.add("hidden");
  els.processBtn.disabled = false;
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

function pushHistory() {
  maskHistory.push(maskCtx.getImageData(0, 0, els.maskCanvas.width, els.maskCanvas.height));
  if (maskHistory.length > 20) maskHistory.shift();
}

function startDraw(e) {
  e.preventDefault();
  const p = getCanvasPoint(e);
  if (currentTool === "brush") {
    drawing = true;
    pushHistory();
    lastPoint = p;
    drawDot(p);
  } else if (currentTool === "wand") {
    pushHistory();
    magicWand(p.x, p.y);
  } else if (currentTool === "stamp") {
    if (stampPickMode) {
      stampSource = { x: p.x, y: p.y };
      stampPickMode = false;
      els.sourceStatus.textContent = `מקור: (${p.x}, ${p.y})`;
      els.sourceStatus.style.color = "var(--success)";
      els.maskCanvas.style.cursor = "crosshair";
      return;
    }
    if (!stampSource) {
      setStatus("בחר מקור תחילה", "error");
      return;
    }
    drawing = true;
    pushImageHistory();
    stampClickPoint = { x: p.x, y: p.y };
    lastPoint = p;
    applyStamp(p.x, p.y);
  }
}

function drawMove(e) {
  if (!drawing) return;
  e.preventDefault();
  const p = getCanvasPoint(e);
  if (currentTool === "brush") {
    drawLine(lastPoint, p);
    lastPoint = p;
  } else if (currentTool === "stamp") {
    const steps = Math.max(1, Math.round(Math.hypot(p.x - lastPoint.x, p.y - lastPoint.y) / 2));
    for (let i = 1; i <= steps; i++) {
      const ix = lastPoint.x + (p.x - lastPoint.x) * (i / steps);
      const iy = lastPoint.y + (p.y - lastPoint.y) * (i / steps);
      applyStamp(ix, iy);
    }
    lastPoint = p;
  }
}

function endDraw() {
  drawing = false;
  lastPoint = null;
}

function drawDot(p) {
  const size = parseInt(els.brushSize.value, 10);
  maskCtx.fillStyle = `rgb(${MASK_COLOR.join(",")})`;
  maskCtx.beginPath();
  maskCtx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
  maskCtx.fill();
}

function drawLine(a, b) {
  const size = parseInt(els.brushSize.value, 10);
  maskCtx.strokeStyle = `rgb(${MASK_COLOR.join(",")})`;
  maskCtx.lineWidth = size;
  maskCtx.lineCap = "round";
  maskCtx.lineJoin = "round";
  maskCtx.beginPath();
  maskCtx.moveTo(a.x, a.y);
  maskCtx.lineTo(b.x, b.y);
  maskCtx.stroke();
}

els.maskCanvas.addEventListener("mousedown", startDraw);
els.maskCanvas.addEventListener("mousemove", drawMove);
window.addEventListener("mouseup", endDraw);
els.maskCanvas.addEventListener("touchstart", startDraw, { passive: false });
els.maskCanvas.addEventListener("touchmove", drawMove, { passive: false });
els.maskCanvas.addEventListener("touchend", endDraw);

els.clearMaskBtn.addEventListener("click", () => {
  pushHistory();
  maskCtx.clearRect(0, 0, els.maskCanvas.width, els.maskCanvas.height);
});

els.undoBtn.addEventListener("click", () => {
  if (currentTool === "stamp") {
    if (imageHistory.length === 0) return;
    const prev = imageHistory.pop();
    imgCtx.putImageData(prev, 0, 0);
    return;
  }
  if (maskHistory.length === 0) return;
  const prev = maskHistory.pop();
  maskCtx.putImageData(prev, 0, 0);
});

function colorDistance(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function magicWand(sx, sy) {
  const w = els.imgCanvas.width;
  const h = els.imgCanvas.height;
  const imgData = imgCtx.getImageData(0, 0, w, h);
  const data = imgData.data;
  const idx = (sy * w + sx) * 4;
  const tr = data[idx], tg = data[idx + 1], tb = data[idx + 2];
  const tolerance = parseInt(els.wandTolerance.value, 10);
  const contiguous = els.wandContiguous.checked;

  const maskData = maskCtx.getImageData(0, 0, w, h);
  const md = maskData.data;
  const [mr, mg, mb] = MASK_COLOR;

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
      md[di] = mr; md[di + 1] = mg; md[di + 2] = mb; md[di + 3] = 255;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  } else {
    for (let i = 0; i < data.length; i += 4) {
      const dist = colorDistance(data[i], data[i + 1], data[i + 2], tr, tg, tb);
      if (dist <= tolerance) {
        md[i] = mr; md[i + 1] = mg; md[i + 2] = mb; md[i + 3] = 255;
      }
    }
  }
  maskCtx.putImageData(maskData, 0, 0);
}

els.autoDetectBtn.addEventListener("click", () => {
  pushHistory();
  const w = els.imgCanvas.width;
  const h = els.imgCanvas.height;
  const imgData = imgCtx.getImageData(0, 0, w, h);
  const data = imgData.data;
  const hex = els.autoColor.value;
  const tr = parseInt(hex.slice(1, 3), 16);
  const tg = parseInt(hex.slice(3, 5), 16);
  const tb = parseInt(hex.slice(5, 7), 16);
  const tolerance = parseInt(els.autoTolerance.value, 10);

  const maskData = maskCtx.getImageData(0, 0, w, h);
  const md = maskData.data;
  const [mr, mg, mb] = MASK_COLOR;
  let matched = 0;

  for (let i = 0; i < data.length; i += 4) {
    const dist = colorDistance(data[i], data[i + 1], data[i + 2], tr, tg, tb);
    if (dist <= tolerance) {
      md[i] = mr; md[i + 1] = mg; md[i + 2] = mb; md[i + 3] = 255;
      matched++;
    }
  }
  maskCtx.putImageData(maskData, 0, 0);
  setStatus(`סומנו ${matched.toLocaleString()} פיקסלים`, "success");
});

els.processBtn.addEventListener("click", processInpaint);

els.resetBtn.addEventListener("click", () => {
  els.uploadSection.classList.remove("hidden");
  els.editorSection.classList.add("hidden");
  els.fileInput.value = "";
  imgCtx.clearRect(0, 0, els.imgCanvas.width, els.imgCanvas.height);
  maskCtx.clearRect(0, 0, els.maskCanvas.width, els.maskCanvas.height);
  maskHistory = [];
  imageHistory = [];
  stampSource = null;
  stampPickMode = false;
  els.sourceStatus.textContent = "לא נבחר מקור";
  els.sourceStatus.style.color = "";
  originalImageData = null;
  clearStatus();
});

function maskHasContent() {
  const data = maskCtx.getImageData(0, 0, els.maskCanvas.width, els.maskCanvas.height).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) return true;
  }
  return false;
}

async function processInpaint() {
  if (!cvReady) {
    setStatus("OpenCV עדיין נטען, נסה שוב בעוד רגע", "error");
    return;
  }
  if (!maskHasContent()) {
    setStatus("סמן את סימן המים תחילה", "error");
    return;
  }

  els.processBtn.disabled = true;
  setStatus(`מעבד<span class="spinner"></span>`, "loading");
  await new Promise(r => setTimeout(r, 30));

  let src = null, mask = null, dst = null, kernel = null;
  try {
    src = cv.imread(els.imgCanvas);
    cv.cvtColor(src, src, cv.COLOR_RGBA2RGB);

    const maskImageData = maskCtx.getImageData(0, 0, els.maskCanvas.width, els.maskCanvas.height);
    mask = new cv.Mat(maskImageData.height, maskImageData.width, cv.CV_8UC1);
    const maskData = maskImageData.data;
    for (let i = 0, j = 0; i < maskData.length; i += 4, j++) {
      mask.data[j] = maskData[i + 3] > 0 ? 255 : 0;
    }

    const dilateAmount = parseInt(els.maskDilate.value, 10);
    if (dilateAmount > 0) {
      const ksize = dilateAmount * 2 + 1;
      kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(ksize, ksize));
      cv.dilate(mask, mask, kernel);
    }

    dst = new cv.Mat();
    const radius = parseInt(els.inpaintRadius.value, 10);
    const flag = els.algo.value === "ns" ? cv.INPAINT_NS : cv.INPAINT_TELEA;
    cv.inpaint(src, mask, dst, radius, flag);

    cv.cvtColor(dst, dst, cv.COLOR_RGB2RGBA);
    pushImageHistory();
    cv.imshow(els.imgCanvas, dst);

    maskCtx.clearRect(0, 0, els.maskCanvas.width, els.maskCanvas.height);
    maskHistory = [];
    els.downloadBtn.classList.remove("hidden");
    setStatus("הושלם. ניתן לעבד שוב לתיקון נוסף", "success");
  } catch (err) {
    console.error(err);
    setStatus(`שגיאה: ${err.message || err}`, "error");
  } finally {
    if (src) src.delete();
    if (mask) mask.delete();
    if (dst) dst.delete();
    if (kernel) kernel.delete();
    els.processBtn.disabled = false;
  }
}

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
