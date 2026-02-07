(() => {
  const $ = (id) => document.getElementById(id);

  // screens
  const uploaderScreen = $("uploaderScreen");
  const editor = $("editor");

  // uploader
  const dropArea = $("dropArea");
  const fileInput = $("fileInput");
  const selectBtn = $("selectBtn");

  // preview
  const previewOrig = $("previewOrig");
  const origEmpty = $("origEmpty");

  const canvas = $("canvas");
  const resEmpty = $("resEmpty");
  const liveBadge = $("liveBadge");
  const ctx = canvas.getContext("2d", { alpha: true });

  // options
  const preset = $("preset");
  const wEl = $("w");
  const hEl = $("h");
  const lockAR = $("lockAR");

  const multSlider = $("multSlider");
  const multVal = $("multVal");

  const resizeAlg = $("resizeAlg");

  const sharpenOn = $("sharpenOn");
  const sharpenType = $("sharpenType");
  const sharpenAmt = $("sharpenAmt");
  const sharpenVal = $("sharpenVal");

  const contrastOn = $("contrastOn");
  const contrastAmt = $("contrastAmt");
  const contrastVal = $("contrastVal");

  const format = $("format");
  const qualityRow = $("qualityRow");
  const quality = $("quality");
  const qVal = $("qVal");

  const btnExport = $("btnExport");
  const btnDownload = $("btnDownload");
  const btnClear = $("btnClear");
  const btnBack = $("btnBack");

  // meta
  const fileNameEl = $("fileName");
  const origDimEl = $("origDim");
  const outDimEl = $("outDim");

  // state
  let img = new Image();
  let hasImage = false;
  let origW = 0, origH = 0, aspect = 1;
  let currentUrl = null;
  let baseName = "image";

  let multiplier = 2;
  let rafPending = false;

  // limits
  const MAX_EXPORT_PIXELS = 80_000_000;
  const MAX_EXPORT_SIDE = 16384;
  const MAX_PREVIEW_SIDE = 1400;

  function clampInt(v, min = 1, max = 30000) {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    const i = Math.round(n);
    return Math.min(max, Math.max(min, i));
  }

  function clampNum(v, min, max) {
    const n = Number(v);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function updateQualityUI() {
    const lossy = (format.value === "image/jpeg" || format.value === "image/webp");
    qualityRow.style.display = lossy ? "flex" : "none";
  }

  function setOutText(w, h) {
    outDimEl.textContent = (w && h) ? `${w} × ${h}` : "—";
  }

  function setInputs(w, h) {
    wEl.value = String(w);
    hEl.value = String(h);
    setOutText(w, h);
  }

  function getTargetDimsFromUI() {
    if (!hasImage) return { w: null, h: null };

    const mode = preset.value;

    if (mode === "multiplier") {
      return {
        w: Math.max(1, Math.round(origW * multiplier)),
        h: Math.max(1, Math.round(origH * multiplier))
      };
    }

    if (mode === "original") return { w: origW, h: origH };

    if (mode.startsWith("longedge-")) {
      const longEdge = clampInt(mode.split("-")[1], 1, 30000);
      const landscape = origW >= origH;
      const w = landscape ? longEdge : Math.round(longEdge * aspect);
      const h = landscape ? Math.round(longEdge / aspect) : longEdge;
      return { w, h };
    }

    const cw = clampInt(wEl.value, 1, 30000);
    const ch = clampInt(hEl.value, 1, 30000);
    if (!cw || !ch) return { w: origW, h: origH };
    return { w: cw, h: ch };
  }

  function lockAspect(changed) {
    if (!hasImage || !lockAR.checked) return;

    const w = clampInt(wEl.value);
    const h = clampInt(hEl.value);
    if (!w || !h) return;

    if (changed === "w") {
      const nh = Math.max(1, Math.round(w / aspect));
      hEl.value = String(nh);
      setOutText(w, nh);
    } else if (changed === "h") {
      const nw = Math.max(1, Math.round(h * aspect));
      wEl.value = String(nw);
      setOutText(nw, h);
    }
  }

  function resetDownload() {
    btnDownload.classList.add("disabled");
    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
      currentUrl = null;
    }
  }

  function resetResultCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.style.display = "none";
    resEmpty.style.display = "grid";
    liveBadge.classList.add("hidden");
  }

  // -------------------------
  // Contrast (simple)
  // -------------------------
  function applyContrast(canvasCtx, w, h, amount) {
    if (amount === 1) return;

    const imgData = canvasCtx.getImageData(0, 0, w, h);
    const d = imgData.data;

    for (let i = 0; i < d.length; i += 4) {
      d[i]     = Math.max(0, Math.min(255, (d[i]     - 128) * amount + 128));
      d[i + 1] = Math.max(0, Math.min(255, (d[i + 1] - 128) * amount + 128));
      d[i + 2] = Math.max(0, Math.min(255, (d[i + 2] - 128) * amount + 128));
    }

    canvasCtx.putImageData(imgData, 0, 0);
  }

  // -------------------------
  // Sharpening
  // -------------------------
  function gaussianBlur3x3(src, w, h) {
    const out = new Uint8ClampedArray(src.length);
    const s = src;

    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - 1), y1 = y, y2 = Math.min(h - 1, y + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - 1), x1 = x, x2 = Math.min(w - 1, x + 1);

        const i00 = (y0 * w + x0) * 4, i01 = (y0 * w + x1) * 4, i02 = (y0 * w + x2) * 4;
        const i10 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4, i12 = (y1 * w + x2) * 4;
        const i20 = (y2 * w + x0) * 4, i21 = (y2 * w + x1) * 4, i22 = (y2 * w + x2) * 4;

        const o = (y * w + x) * 4;

        for (let c = 0; c < 3; c++) {
          const v =
            (s[i00 + c] * 1 + s[i01 + c] * 2 + s[i02 + c] * 1 +
             s[i10 + c] * 2 + s[i11 + c] * 4 + s[i12 + c] * 2 +
             s[i20 + c] * 1 + s[i21 + c] * 2 + s[i22 + c] * 1) / 16;

          out[o + c] = v;
        }
        out[o + 3] = s[o + 3];
      }
    }
    return out;
  }

  function edgeMagnitude(src, w, h) {
    const mag = new Float32Array(w * h);
    const lum = (i) => 0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2];

    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - 1), y2 = Math.min(h - 1, y + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - 1), x2 = Math.min(w - 1, x + 1);

        const i00 = (y0 * w + x0) * 4, i01 = (y0 * w + x) * 4, i02 = (y0 * w + x2) * 4;
        const i10 = (y * w + x0) * 4,  i12 = (y * w + x2) * 4;
        const i20 = (y2 * w + x0) * 4, i21 = (y2 * w + x) * 4, i22 = (y2 * w + x2) * 4;

        const gx = (-1 * lum(i00)) + (1 * lum(i02)) +
                   (-2 * lum(i10)) + (2 * lum(i12)) +
                   (-1 * lum(i20)) + (1 * lum(i22));

        const gy = (-1 * lum(i00)) + (-2 * lum(i01)) + (-1 * lum(i02)) +
                   ( 1 * lum(i20)) + ( 2 * lum(i21)) + ( 1 * lum(i22));

        mag[y * w + x] = Math.sqrt(gx * gx + gy * gy);
      }
    }
    return mag;
  }

  function applyUnsharp(canvasCtx, w, h, amount, edgeAware) {
    if (amount <= 0) return;

    const imgData = canvasCtx.getImageData(0, 0, w, h);
    const src = imgData.data;
    const blurred = gaussianBlur3x3(src, w, h);

    let edges = null;
    if (edgeAware) edges = edgeMagnitude(src, w, h);

    const low = 12, high = 90, high2 = 220;

    for (let i = 0; i < src.length; i += 4) {
      let k = amount;

      if (edgeAware && edges) {
        const p = i / 4;
        const g = edges[p];

        let mask = (g - low) / (high - low);
        mask = Math.max(0, Math.min(1, mask));

        let fade = (high2 - g) / (high2 - high);
        fade = Math.max(0, Math.min(1, fade));

        k = amount * mask * fade;
      }

      for (let c = 0; c < 3; c++) {
        const o = src[i + c];
        const b = blurred[i + c];
        const v = o + k * (o - b);
        src[i + c] = Math.max(0, Math.min(255, v));
      }
    }

    canvasCtx.putImageData(imgData, 0, 0);
  }

  // -------------------------
  // Resize algorithms
  // -------------------------
  function progressiveScaleTo(targetW, targetH, destCtx) {
    const tmp = document.createElement("canvas");
    const tctx = tmp.getContext("2d");

    let cw = img.naturalWidth;
    let ch = img.naturalHeight;

    tmp.width = cw;
    tmp.height = ch;

    tctx.imageSmoothingEnabled = true;
    tctx.imageSmoothingQuality = "high";
    tctx.drawImage(img, 0, 0);

    while (cw * 2 < targetW && ch * 2 < targetH) {
      const nw = Math.floor(cw * 2);
      const nh = Math.floor(ch * 2);

      const step = document.createElement("canvas");
      step.width = nw;
      step.height = nh;
      const sctx = step.getContext("2d");
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = "high";
      sctx.drawImage(tmp, 0, 0, cw, ch, 0, 0, nw, nh);

      tmp.width = nw; tmp.height = nh;
      tctx.clearRect(0, 0, nw, nh);
      tctx.drawImage(step, 0, 0);

      cw = nw; ch = nh;
    }

    destCtx.imageSmoothingEnabled = true;
    destCtx.imageSmoothingQuality = "high";
    destCtx.clearRect(0, 0, targetW, targetH);
    destCtx.drawImage(tmp, 0, 0, cw, ch, 0, 0, targetW, targetH);
  }

  function sinc(x) {
    if (x === 0) return 1;
    const px = Math.PI * x;
    return Math.sin(px) / px;
  }
  function lanczosKernel(x, a) {
    const ax = Math.abs(x);
    if (ax >= a) return 0;
    return sinc(x) * sinc(x / a);
  }

  function lanczosResizeTo(targetW, targetH, destCtx, a = 3) {
    const srcCanvas = document.createElement("canvas");
    srcCanvas.width = origW;
    srcCanvas.height = origH;
    const sctx = srcCanvas.getContext("2d", { willReadFrequently: true });
    sctx.drawImage(img, 0, 0);

    const srcImg = sctx.getImageData(0, 0, origW, origH);
    const src = srcImg.data;

    // horizontal pass
    const tmp = new Float32Array(targetW * origH * 4);

    for (let y = 0; y < origH; y++) {
      for (let x = 0; x < targetW; x++) {
        const center = (x + 0.5) * (origW / targetW) - 0.5;
        const left = Math.floor(center - a + 1);

        let wsum = 0;
        const wts = new Float32Array(2 * a);
        for (let i = 0; i < 2 * a; i++) {
          const sx = left + i;
          const w = lanczosKernel(center - sx, a);
          wts[i] = w;
          wsum += w;
        }
        if (wsum === 0) wsum = 1;

        let r = 0, g = 0, b = 0, al = 0;
        for (let i = 0; i < 2 * a; i++) {
          let sx = left + i;
          if (sx < 0) sx = 0;
          if (sx >= origW) sx = origW - 1;

          const w = wts[i] / wsum;
          const si = (y * origW + sx) * 4;
          r += src[si] * w;
          g += src[si + 1] * w;
          b += src[si + 2] * w;
          al += src[si + 3] * w;
        }

        const ti = (y * targetW + x) * 4;
        tmp[ti] = r;
        tmp[ti + 1] = g;
        tmp[ti + 2] = b;
        tmp[ti + 3] = al;
      }
    }

    // vertical pass
    const out = new Uint8ClampedArray(targetW * targetH * 4);

    for (let y = 0; y < targetH; y++) {
      const center = (y + 0.5) * (origH / targetH) - 0.5;
      const top = Math.floor(center - a + 1);

      let wsum = 0;
      const wts = new Float32Array(2 * a);
      for (let i = 0; i < 2 * a; i++) {
        const sy = top + i;
        const w = lanczosKernel(center - sy, a);
        wts[i] = w;
        wsum += w;
      }
      if (wsum === 0) wsum = 1;

      for (let x = 0; x < targetW; x++) {
        let r = 0, g = 0, b = 0, al = 0;
        for (let i = 0; i < 2 * a; i++) {
          let sy = top + i;
          if (sy < 0) sy = 0;
          if (sy >= origH) sy = origH - 1;

          const w = wts[i] / wsum;
          const si = (sy * targetW + x) * 4;
          r += tmp[si] * w;
          g += tmp[si + 1] * w;
          b += tmp[si + 2] * w;
          al += tmp[si + 3] * w;
        }

        const di = (y * targetW + x) * 4;
        out[di] = Math.max(0, Math.min(255, r));
        out[di + 1] = Math.max(0, Math.min(255, g));
        out[di + 2] = Math.max(0, Math.min(255, b));
        out[di + 3] = Math.max(0, Math.min(255, al));
      }
    }

    destCtx.clearRect(0, 0, targetW, targetH);
    destCtx.putImageData(new ImageData(out, targetW, targetH), 0, 0);
  }

  function renderToCanvas(destCtx, w, h) {
    const alg = resizeAlg.value;

    if (alg === "lanczos3") {
      lanczosResizeTo(w, h, destCtx, 3);
    } else {
      progressiveScaleTo(w, h, destCtx);
    }

    // contrast before sharpening
    if (contrastOn.checked) {
      const c = clampNum(contrastAmt.value, 0.6, 1.6);
      applyContrast(destCtx, w, h, c);
    }

    if (sharpenOn.checked) {
      const amt = clampNum(sharpenAmt.value, 0, 1);
      const edgeAware = (sharpenType.value === "edgeAware");
      applyUnsharp(destCtx, w, h, amt, edgeAware);
    }
  }

  function fitToPreview(targetW, targetH) {
    const maxSide = MAX_PREVIEW_SIDE;
    const maxDim = Math.max(targetW, targetH);
    if (maxDim <= maxSide) return { w: targetW, h: targetH };

    const scale = maxSide / maxDim;
    return {
      w: Math.max(1, Math.round(targetW * scale)),
      h: Math.max(1, Math.round(targetH * scale))
    };
  }

  function scheduleLivePreview() {
    if (!hasImage) return;
    if (rafPending) return;
    rafPending = true;

    requestAnimationFrame(() => {
      rafPending = false;
      renderLivePreview();
    });
  }

  function renderLivePreview() {
    if (!hasImage) return;

    const { w: targetW, h: targetH } = getTargetDimsFromUI();
    setOutText(targetW, targetH);

    const pv = fitToPreview(targetW, targetH);

    canvas.width = pv.w;
    canvas.height = pv.h;

    renderToCanvas(ctx, pv.w, pv.h);

    canvas.style.display = "block";
    resEmpty.style.display = "none";
    liveBadge.classList.remove("hidden");

    resetDownload(); // live preview isn't downloadable
  }

  async function exportFull() {
    if (!hasImage) return;

    const { w: targetW, h: targetH } = getTargetDimsFromUI();
    if (!targetW || !targetH) return alert("Invalid target size.");

    if (targetW > MAX_EXPORT_SIDE || targetH > MAX_EXPORT_SIDE) {
      return alert(`Too large. Try <= ${MAX_EXPORT_SIDE}px per side.`);
    }
    if (targetW * targetH > MAX_EXPORT_PIXELS) {
      return alert("Too large for this browser/device. Reduce multiplier.");
    }

    const out = document.createElement("canvas");
    out.width = targetW;
    out.height = targetH;
    const octx = out.getContext("2d", { willReadFrequently: true });

    renderToCanvas(octx, targetW, targetH);

    const mime = format.value;
    const q = Number(quality.value);

    const blob = await new Promise((resolve) => {
      out.toBlob((b) => resolve(b), mime, q);
    });

    if (!blob) return alert("Export failed. Try another format.");

    const ext = (mime === "image/png") ? "png" : (mime === "image/jpeg" ? "jpg" : "webp");

    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = URL.createObjectURL(blob);

    btnDownload.href = currentUrl;
    btnDownload.download = `${baseName}_${targetW}x${targetH}.${ext}`;
    btnDownload.classList.remove("disabled");

    alert("Export ready. Click Download.");
  }

  function showEditor() {
    uploaderScreen.classList.add("hidden");
    editor.classList.remove("hidden");
  }

  function showUploader() {
    editor.classList.add("hidden");
    uploaderScreen.classList.remove("hidden");
  }

  async function loadFile(f) {
    if (!f || !f.type.startsWith("image/")) return alert("Please choose an image file.");

    resetDownload();
    resetResultCanvas();

    baseName = (f.name || "image").replace(/\.[^.]+$/, "") || "image";
    fileNameEl.textContent = f.name || "image";

    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(f);
    });

    img = new Image();
    img.onload = () => {
      hasImage = true;
      origW = img.naturalWidth;
      origH = img.naturalHeight;
      aspect = origW / origH;

      origDimEl.textContent = `${origW} × ${origH}`;

      previewOrig.src = dataUrl;
      previewOrig.style.display = "block";
      origEmpty.style.display = "none";

      preset.value = "multiplier";
      multiplier = 2;
      multSlider.value = "2";
      multVal.textContent = "2.0";

      const tw = Math.round(origW * multiplier);
      const th = Math.round(origH * multiplier);
      setInputs(tw, th);

      updateQualityUI();
      showEditor();
      scheduleLivePreview();
    };
    img.onerror = () => alert("Could not load this image.");
    img.src = dataUrl;
  }

  // uploader
  selectBtn.addEventListener("click", (e) => { e.preventDefault(); fileInput.click(); });
  fileInput.addEventListener("change", () => {
    const f = fileInput.files && fileInput.files[0];
    if (f) loadFile(f);
  });

  // drag/drop
  ["dragenter", "dragover"].forEach((evt) => {
    dropArea.addEventListener(evt, (e) => { e.preventDefault(); dropArea.classList.add("drag"); });
  });
  ["dragleave", "drop"].forEach((evt) => {
    dropArea.addEventListener(evt, (e) => { e.preventDefault(); dropArea.classList.remove("drag"); });
  });
  dropArea.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });
  dropArea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") fileInput.click();
  });

  // multiplier slider
  multSlider.addEventListener("input", () => {
    multiplier = clampNum(multSlider.value, 1, 8);
    multVal.textContent = multiplier.toFixed(1);
    preset.value = "multiplier";

    const tw = Math.max(1, Math.round(origW * multiplier));
    const th = Math.max(1, Math.round(origH * multiplier));
    setInputs(tw, th);

    scheduleLivePreview();
  });

  // presets
  preset.addEventListener("change", () => {
    if (!hasImage) return;

    const v = preset.value;
    if (v === "multiplier") {
      setInputs(Math.round(origW * multiplier), Math.round(origH * multiplier));
    } else if (v === "original") {
      setInputs(origW, origH);
    } else if (v.startsWith("longedge-")) {
      const longEdge = clampInt(v.split("-")[1], 1, 30000);
      const landscape = origW >= origH;
      const tw = landscape ? longEdge : Math.round(longEdge * aspect);
      const th = landscape ? Math.round(longEdge / aspect) : longEdge;
      setInputs(tw, th);
    }
    scheduleLivePreview();
  });

  // custom dims
  wEl.addEventListener("input", () => { preset.value = "custom"; lockAspect("w"); scheduleLivePreview(); });
  hEl.addEventListener("input", () => { preset.value = "custom"; lockAspect("h"); scheduleLivePreview(); });
  lockAR.addEventListener("change", () => scheduleLivePreview());

  // instant preview options
  resizeAlg.addEventListener("change", () => scheduleLivePreview());

  sharpenOn.addEventListener("change", () => scheduleLivePreview());
  sharpenType.addEventListener("change", () => scheduleLivePreview());
  sharpenAmt.addEventListener("input", () => {
    sharpenVal.textContent = Number(sharpenAmt.value).toFixed(2);
    scheduleLivePreview();
  });

  contrastOn.addEventListener("change", () => scheduleLivePreview());
  contrastAmt.addEventListener("input", () => {
    contrastVal.textContent = Number(contrastAmt.value).toFixed(2);
    scheduleLivePreview();
  });

  // export settings
  format.addEventListener("change", () => { updateQualityUI(); resetDownload(); });
  quality.addEventListener("input", () => { qVal.textContent = Number(quality.value).toFixed(2); resetDownload(); });

  // export
  btnExport.addEventListener("click", exportFull);

  // back / clear
  btnBack.addEventListener("click", () => {
    resetDownload();
    resetResultCanvas();
    showUploader();
  });

  btnClear.addEventListener("click", () => {
    fileInput.value = "";
    hasImage = false;
    origW = origH = 0;

    fileNameEl.textContent = "—";
    origDimEl.textContent = "—";
    outDimEl.textContent = "—";

    previewOrig.removeAttribute("src");
    previewOrig.style.display = "none";
    origEmpty.style.display = "grid";

    resetDownload();
    resetResultCanvas();
  });

  // init
  updateQualityUI();
  qVal.textContent = Number(quality.value).toFixed(2);
  sharpenVal.textContent = Number(sharpenAmt.value).toFixed(2);
  contrastVal.textContent = Number(contrastAmt.value).toFixed(2);
})();
