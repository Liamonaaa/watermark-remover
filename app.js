const MODEL = "gemini-2.5-flash-image-preview";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const els = {
  apiKey: document.getElementById("apiKey"),
  saveKey: document.getElementById("saveKey"),
  dropZone: document.getElementById("dropZone"),
  fileInput: document.getElementById("fileInput"),
  prompt: document.getElementById("prompt"),
  processBtn: document.getElementById("processBtn"),
  resetBtn: document.getElementById("resetBtn"),
  status: document.getElementById("status"),
  resultsSection: document.getElementById("resultsSection"),
  originalImg: document.getElementById("originalImg"),
  resultImg: document.getElementById("resultImg"),
  downloadBtn: document.getElementById("downloadBtn"),
};

let currentFile = null;
let currentDataUrl = null;

const savedKey = localStorage.getItem("gemini_api_key");
if (savedKey) els.apiKey.value = savedKey;

els.saveKey.addEventListener("click", () => {
  const k = els.apiKey.value.trim();
  if (!k) {
    setStatus("הזן מפתח", "error");
    return;
  }
  localStorage.setItem("gemini_api_key", k);
  setStatus("מפתח נשמר", "success");
  setTimeout(() => clearStatus(), 2000);
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
  if (file) handleFile(file);
});

els.fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) handleFile(file);
});

function handleFile(file) {
  if (!file.type.startsWith("image/")) {
    setStatus("רק קבצי תמונה", "error");
    return;
  }
  currentFile = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    currentDataUrl = e.target.result;
    els.dropZone.classList.add("has-file");
    els.dropZone.innerHTML = `<img src="${currentDataUrl}" class="preview-img" alt="תצוגה מקדימה">`;
    els.processBtn.disabled = false;
    clearStatus();
  };
  reader.readAsDataURL(file);
}

els.processBtn.addEventListener("click", processImage);

els.resetBtn.addEventListener("click", () => {
  currentFile = null;
  currentDataUrl = null;
  els.fileInput.value = "";
  els.processBtn.disabled = true;
  els.resultsSection.classList.add("hidden");
  els.dropZone.classList.remove("has-file");
  els.dropZone.innerHTML = `
    <input type="file" id="fileInput" accept="image/*" hidden>
    <div class="drop-content">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/>
        <line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
      <p>גרור תמונה או לחץ לבחירה</p>
      <p class="small">PNG, JPG, WEBP</p>
    </div>
  `;
  els.fileInput = document.getElementById("fileInput");
  els.fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
  });
  clearStatus();
});

async function processImage() {
  const apiKey = els.apiKey.value.trim();
  if (!apiKey) {
    setStatus("חסר מפתח API", "error");
    return;
  }
  if (!currentFile || !currentDataUrl) {
    setStatus("העלה תמונה", "error");
    return;
  }

  els.processBtn.disabled = true;
  setStatus(`מעבד תמונה<span class="spinner"></span>`, "loading");

  try {
    const base64 = currentDataUrl.split(",")[1];
    const mimeType = currentFile.type;
    const userPrompt = els.prompt.value.trim();

    const instruction = userPrompt
      ? `Remove all watermarks, logos, and text overlays from this image. ${userPrompt}. Preserve the original content, composition, colors, and details. Inpaint the watermarked areas naturally to match the surrounding content.`
      : "Remove all watermarks, logos, and text overlays from this image. Preserve the original content, composition, colors, and details. Inpaint the watermarked areas naturally to match the surrounding content.";

    const body = {
      contents: [{
        parts: [
          { text: instruction },
          { inline_data: { mime_type: mimeType, data: base64 } }
        ]
      }],
      generationConfig: {
        responseModalities: ["IMAGE"]
      }
    };

    const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
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

    els.originalImg.src = currentDataUrl;
    els.resultImg.src = outDataUrl;
    els.downloadBtn.href = outDataUrl;
    els.resultsSection.classList.remove("hidden");
    setStatus("הושלם", "success");
  } catch (err) {
    console.error(err);
    setStatus(err.message || "שגיאה", "error");
  } finally {
    els.processBtn.disabled = false;
  }
}

function setStatus(html, kind = "") {
  els.status.className = `status ${kind}`;
  els.status.innerHTML = html;
  els.status.classList.remove("hidden");
}

function clearStatus() {
  els.status.classList.add("hidden");
  els.status.innerHTML = "";
}
