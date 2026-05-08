const els = {
  uploadSection: document.getElementById("uploadSection"),
  editorSection: document.getElementById("editorSection"),
  dropZone: document.getElementById("dropZone"),
  fileInput: document.getElementById("fileInput"),
  imgCanvas: document.getElementById("imgCanvas"),
  maskCanvas: document.getElementById("maskCanvas"),
  setSourceBtn: document.getElementById("setSourceBtn"),
  sourceStatus: document.getElementById("sourceStatus"),
  wandTolerance: document.getElementById("wandTolerance"),
  wandToleranceVal: document.getElementById("wandToleranceVal"),
  wandContiguous: document.getElementById("wandContiguous"),
  maskDilate: document.getElementById("maskDilate"),
  maskDilateVal: document.getElementById("maskDilateVal"),
  featherSize: document.getElementById("featherSize"),
  featherSizeVal: document.getElementById("featherSizeVal"),
  undoBtn: document.getElementById("undoBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  resetBtn: document.getElementById("resetBtn"),
  status: document.getElementById("status"),
  apiKey: document.getElementById("apiKey"),
  saveKeyBtn: document.getElementById("saveKeyBtn"),
  aiProcessBtn: document.getElementById("aiProcessBtn"),
  aiPrompt: document.getElementById("aiPrompt"),
  toggleAiBtn: document.getElementById("toggleAiBtn"),
  aiBody: document.getElementById("aiBody"),
};

const GEMINI_MODEL = "gemini-2.5-flash-image";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const savedKey = localStorage.getItem("gemini_api_key");
if (savedKey) els.apiKey.value = savedKey;

const imgCtx = els.imgCanvas.getContext("2d", { willReadFrequently: true });
const maskCtx = els.maskCanvas.getContext("2d", { willReadFrequently: true });

let stampSource = null;
let stampPickMode = false;
let imageHistory = [];
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
  stampSource = null;
  stampPickMode = false;
  els.sourceStatus.textContent = "לא נבחר מקור";
  els.sourceStatus.style.color = "";
  els.maskCanvas.style.cursor = "pointer";
  els.downloadBtn.classList.add("hidden");
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

els.setSourceBtn.addEventListener("click", () => {
  stampPickMode = true;
  els.sourceStatus.textContent = "לחץ על אזור נקי בתמונה...";
  els.sourceStatus.style.color = "var(--primary)";
  els.maskCanvas.style.cursor = "copy";
});

function colorDistance(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function buildWandMask(sx, sy) {
  const w = els.imgCanvas.width;
  const h = els.imgCanvas.height;
  const imgData = imgCtx.getImageData(0, 0, w, h);
  const data = imgData.data;
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

function showMaskPreview(mask, w, h) {
  const out = maskCtx.createImageData(w, h);
  const od = out.data;
  const [mr, mg, mb] = MASK_COLOR;
  for (let i = 0, j = 0; i < mask.length; i++, j += 4) {
    if (mask[i]) {
      od[j] = mr; od[j + 1] = mg; od[j + 2] = mb; od[j + 3] = 180;
    }
  }
  maskCtx.putImageData(out, 0, 0);
}

function applyCloneFill(mask, alpha, clickPoint) {
  const w = els.imgCanvas.width;
  const h = els.imgCanvas.height;
  const offsetX = stampSource.x - clickPoint.x;
  const offsetY = stampSource.y - clickPoint.y;

  const imgData = imgCtx.getImageData(0, 0, w, h);
  const d = imgData.data;
  const srcCopy = new Uint8ClampedArray(d);

  let painted = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = alpha[i];
      if (a <= 0) continue;
      const sx = x + offsetX;
      const sy = y + offsetY;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const di = i * 4;
      const si = (sy * w + sx) * 4;
      d[di]     = srcCopy[si]     * a + d[di]     * (1 - a);
      d[di + 1] = srcCopy[si + 1] * a + d[di + 1] * (1 - a);
      d[di + 2] = srcCopy[si + 2] * a + d[di + 2] * (1 - a);
      painted++;
    }
  }
  imgCtx.putImageData(imgData, 0, 0);
  return painted;
}

els.maskCanvas.addEventListener("click", (e) => {
  const p = getCanvasPoint(e);

  if (stampPickMode) {
    stampSource = { x: p.x, y: p.y };
    stampPickMode = false;
    els.sourceStatus.textContent = `מקור: (${p.x}, ${p.y})`;
    els.sourceStatus.style.color = "var(--success)";
    els.maskCanvas.style.cursor = "pointer";

    const w = els.imgCanvas.width;
    const h = els.imgCanvas.height;
    maskCtx.clearRect(0, 0, w, h);
    maskCtx.fillStyle = "rgba(74, 222, 128, 0.9)";
    maskCtx.beginPath();
    maskCtx.arc(p.x, p.y, 12, 0, Math.PI * 2);
    maskCtx.fill();
    maskCtx.strokeStyle = "white";
    maskCtx.lineWidth = 2;
    maskCtx.stroke();
    setTimeout(() => {
      maskCtx.clearRect(0, 0, w, h);
    }, 1500);
    return;
  }

  if (!stampSource) {
    setStatus("בחר אזור מקור תחילה (שלב 1)", "error");
    return;
  }

  const w = els.imgCanvas.width;
  const h = els.imgCanvas.height;

  let mask = buildWandMask(p.x, p.y);
  let count = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) count++;
  if (count === 0) {
    setStatus("לא זוהה אזור — נסה להגדיל טולרנס", "error");
    return;
  }

  const dilateAmount = parseInt(els.maskDilate.value, 10);
  mask = dilateMask(mask, w, h, dilateAmount);

  const featherAmount = parseInt(els.featherSize.value, 10);
  const alpha = featherMask(mask, w, h, featherAmount);

  showMaskPreview(mask, w, h);

  setTimeout(() => {
    pushImageHistory();
    const painted = applyCloneFill(mask, alpha, p);
    maskCtx.clearRect(0, 0, w, h);
    els.downloadBtn.classList.remove("hidden");
    setStatus(`הוסר אזור של ${painted.toLocaleString()} פיקסלים`, "success");
  }, 120);
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
  stampSource = null;
  stampPickMode = false;
  els.sourceStatus.textContent = "לא נבחר מקור";
  els.sourceStatus.style.color = "";
  clearStatus();
});

els.saveKeyBtn.addEventListener("click", () => {
  const k = els.apiKey.value.trim();
  if (!k) {
    setStatus("הזן מפתח", "error");
    return;
  }
  localStorage.setItem("gemini_api_key", k);
  setStatus("מפתח נשמר", "success");
  setTimeout(() => clearStatus(), 1500);
});

els.toggleAiBtn.addEventListener("click", () => {
  els.aiBody.classList.toggle("hidden");
});

els.aiProcessBtn.addEventListener("click", processWithAI);

async function processWithAI() {
  const apiKey = els.apiKey.value.trim();
  if (!apiKey) {
    setStatus("הזן מפתח Gemini API", "error");
    return;
  }

  const w = els.imgCanvas.width;
  const h = els.imgCanvas.height;
  if (w === 0 || h === 0) {
    setStatus("טען תמונה תחילה", "error");
    return;
  }

  els.aiProcessBtn.disabled = true;
  setStatus(`Gemini מעבד תמונה<span class="spinner"></span>`, "loading");

  try {
    const dataUrl = els.imgCanvas.toDataURL("image/png");
    const base64 = dataUrl.split(",")[1];
    const userExtra = els.aiPrompt.value.trim();

    const instruction = userExtra
      ? `Remove all watermarks, logos, and text overlays from this image. ${userExtra}. Preserve the original content, composition, colors, and details. Inpaint the watermarked areas naturally to match the surrounding content.`
      : "Remove all watermarks, logos, and text overlays from this image. Preserve the original content, composition, colors, and details. Inpaint the watermarked areas naturally to match the surrounding content.";

    const body = {
      contents: [{
        parts: [
          { text: instruction },
          { inline_data: { mime_type: "image/png", data: base64 } }
        ]
      }],
      generationConfig: { responseModalities: ["IMAGE"] }
    };

    const res = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      let errMsg = `שגיאת API ${res.status}`;
      try {
        const errJson = JSON.parse(errText);
        if (errJson.error?.message) errMsg += `: ${errJson.error.message}`;
      } catch {}
      throw new Error(errMsg);
    }

    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find(p => p.inline_data || p.inlineData);

    if (!imagePart) {
      const textPart = parts.find(p => p.text);
      throw new Error(textPart?.text || "המודל לא החזיר תמונה");
    }

    const imgData = imagePart.inline_data || imagePart.inlineData;
    const outMime = imgData.mime_type || imgData.mimeType || "image/png";
    const outDataUrl = `data:${outMime};base64,${imgData.data}`;

    const newImg = new Image();
    newImg.onload = () => {
      pushImageHistory();
      els.imgCanvas.width = newImg.naturalWidth;
      els.imgCanvas.height = newImg.naturalHeight;
      els.maskCanvas.width = newImg.naturalWidth;
      els.maskCanvas.height = newImg.naturalHeight;
      imgCtx.drawImage(newImg, 0, 0);
      maskCtx.clearRect(0, 0, newImg.naturalWidth, newImg.naturalHeight);
      els.downloadBtn.classList.remove("hidden");
      setStatus("AI סיים. ניתן לחדד עם Magic Wand", "success");
    };
    newImg.onerror = () => setStatus("שגיאה בטעינת תוצאה", "error");
    newImg.src = outDataUrl;
  } catch (err) {
    console.error(err);
    setStatus(err.message || "שגיאה", "error");
  } finally {
    els.aiProcessBtn.disabled = false;
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
