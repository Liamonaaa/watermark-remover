const els = {
  uploadSection: document.getElementById("uploadSection"),
  editorSection: document.getElementById("editorSection"),
  dropZone: document.getElementById("dropZone"),
  fileInput: document.getElementById("fileInput"),
  imgCanvas: document.getElementById("imgCanvas"),
  maskCanvas: document.getElementById("maskCanvas"),
  brushSize: document.getElementById("brushSize"),
  brushSizeVal: document.getElementById("brushSizeVal"),
  inpaintRadius: document.getElementById("inpaintRadius"),
  inpaintRadiusVal: document.getElementById("inpaintRadiusVal"),
  algo: document.getElementById("algo"),
  clearMaskBtn: document.getElementById("clearMaskBtn"),
  undoBtn: document.getElementById("undoBtn"),
  processBtn: document.getElementById("processBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  resetBtn: document.getElementById("resetBtn"),
  status: document.getElementById("status"),
};

const imgCtx = els.imgCanvas.getContext("2d");
const maskCtx = els.maskCanvas.getContext("2d");

let cvReady = false;
let originalImageData = null;
let maskHistory = [];
let drawing = false;
let lastPoint = null;

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

els.brushSize.addEventListener("input", () => {
  els.brushSizeVal.textContent = els.brushSize.value;
});
els.inpaintRadius.addEventListener("input", () => {
  els.inpaintRadiusVal.textContent = els.inpaintRadius.value;
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
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY
  };
}

function startDraw(e) {
  e.preventDefault();
  drawing = true;
  maskHistory.push(maskCtx.getImageData(0, 0, els.maskCanvas.width, els.maskCanvas.height));
  if (maskHistory.length > 20) maskHistory.shift();
  lastPoint = getCanvasPoint(e);
  drawDot(lastPoint);
}

function drawMove(e) {
  if (!drawing) return;
  e.preventDefault();
  const p = getCanvasPoint(e);
  drawLine(lastPoint, p);
  lastPoint = p;
}

function endDraw() {
  drawing = false;
  lastPoint = null;
}

function drawDot(p) {
  const size = parseInt(els.brushSize.value, 10);
  maskCtx.fillStyle = "#ff3366";
  maskCtx.beginPath();
  maskCtx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
  maskCtx.fill();
}

function drawLine(a, b) {
  const size = parseInt(els.brushSize.value, 10);
  maskCtx.strokeStyle = "#ff3366";
  maskCtx.fillStyle = "#ff3366";
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
  maskHistory.push(maskCtx.getImageData(0, 0, els.maskCanvas.width, els.maskCanvas.height));
  maskCtx.clearRect(0, 0, els.maskCanvas.width, els.maskCanvas.height);
});

els.undoBtn.addEventListener("click", () => {
  if (maskHistory.length === 0) return;
  const prev = maskHistory.pop();
  maskCtx.putImageData(prev, 0, 0);
});

els.processBtn.addEventListener("click", processInpaint);

els.resetBtn.addEventListener("click", () => {
  els.uploadSection.classList.remove("hidden");
  els.editorSection.classList.add("hidden");
  els.fileInput.value = "";
  imgCtx.clearRect(0, 0, els.imgCanvas.width, els.imgCanvas.height);
  maskCtx.clearRect(0, 0, els.maskCanvas.width, els.maskCanvas.height);
  maskHistory = [];
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
    setStatus("צבע על סימן המים עם המברשת", "error");
    return;
  }

  els.processBtn.disabled = true;
  setStatus(`מעבד<span class="spinner"></span>`, "loading");

  await new Promise(r => setTimeout(r, 30));

  let src = null, mask = null, dst = null;
  try {
    src = cv.imread(els.imgCanvas);
    cv.cvtColor(src, src, cv.COLOR_RGBA2RGB);

    const maskImageData = maskCtx.getImageData(0, 0, els.maskCanvas.width, els.maskCanvas.height);
    mask = new cv.Mat(maskImageData.height, maskImageData.width, cv.CV_8UC1);
    const maskData = maskImageData.data;
    for (let i = 0, j = 0; i < maskData.length; i += 4, j++) {
      mask.data[j] = maskData[i + 3] > 0 ? 255 : 0;
    }

    dst = new cv.Mat();
    const radius = parseInt(els.inpaintRadius.value, 10);
    const flag = els.algo.value === "ns" ? cv.INPAINT_NS : cv.INPAINT_TELEA;
    cv.inpaint(src, mask, dst, radius, flag);

    cv.cvtColor(dst, dst, cv.COLOR_RGB2RGBA);
    cv.imshow(els.imgCanvas, dst);

    maskCtx.clearRect(0, 0, els.maskCanvas.width, els.maskCanvas.height);
    maskHistory = [];

    els.downloadBtn.classList.remove("hidden");
    setStatus("הושלם. ניתן לצבוע שוב לתיקון נוסף", "success");
  } catch (err) {
    console.error(err);
    setStatus(`שגיאה: ${err.message || err}`, "error");
  } finally {
    if (src) src.delete();
    if (mask) mask.delete();
    if (dst) dst.delete();
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
