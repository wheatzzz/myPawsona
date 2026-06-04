/* ============================================================
   drawing.js — Slide-by-slide drawing system
   Tools: brush, eraser, fill, undo (Ctrl+Z), redo (Ctrl+Y)
============================================================ */

(function () {
document.addEventListener('DOMContentLoaded', function () {

  /* ----------------------------------------------------------
     SLIDES
  ---------------------------------------------------------- */
  const SLIDES = [
    { key: 'head',   label: 'Head',            hint: 'Draw the face & ears',           template: 'assets/head.png'   },
    { key: 'body',   label: 'Body',            hint: 'Draw the torso',                 template: 'assets/body.png'   },
    { key: 'lf_leg', label: 'Left Front Leg',  hint: 'Draw the front-left leg & paw',  template: 'assets/lf_leg.png' },
    { key: 'rf_leg', label: 'Right Front Leg', hint: 'Draw the front-right leg & paw', template: 'assets/rf_leg.png' },
    { key: 'lb_leg', label: 'Left Back Leg',   hint: 'Draw the back-left leg & paw',   template: 'assets/lb_leg.png' },
    { key: 'rb_leg', label: 'Right Back Leg',  hint: 'Draw the back-right leg & paw',  template: 'assets/rb_leg.png' },
    { key: 'tail',   label: 'Tail',            hint: 'Draw the tail — bottom-left end connects to body', template: 'assets/tail.png' },
  ];

  /* ----------------------------------------------------------
     STATE — all declared at top level
  ---------------------------------------------------------- */
  let currentSlide    = 0;
  let painting        = false;
  let isEraser        = false;
  let isFill          = false;
  let templateVisible = true;

  const partCanvases = {};  // key → offscreen canvas
  const partHistory  = {};  // key → undo stack (ImageData[])
  const partRedo     = {};  // key → redo stack (ImageData[])

  SLIDES.forEach(s => {
    const c = document.createElement('canvas');
    c.width  = 400;
    c.height = 400;
    partCanvases[s.key] = c;
    partHistory[s.key]  = [];
    partRedo[s.key]     = [];
  });

  /* ----------------------------------------------------------
     DOM REFS
  ---------------------------------------------------------- */
  const slideTitle   = document.getElementById('slideTitle');
  const slideHint    = document.getElementById('slideHint');
  const slideCounter = document.getElementById('slideCounter');
  const progressFill = document.getElementById('progressFill');
  const drawCanvas   = document.getElementById('drawingCanvas');
  const ctx          = drawCanvas.getContext('2d', { willReadFrequently: true });
  const templateImg  = document.getElementById('templateOverlay');
  const brushSizeEl  = document.getElementById('brushSize');
  const brushColour  = document.getElementById('brushColour');
  const eraserBtn    = document.getElementById('btnEraser');
  const fillBtn      = document.getElementById('btnFill');
  const undoBtn      = document.getElementById('btnUndo');
  const redoBtn      = document.getElementById('btnRedo');
  const clearBtn     = document.getElementById('btnClear');
  const toggleTplBtn = document.getElementById('btnToggleTemplate');
  const nextBtn      = document.getElementById('btnNext');
  const backBtn      = document.getElementById('btnBack');

  /* ----------------------------------------------------------
     LOAD SLIDE
  ---------------------------------------------------------- */
  function loadSlide(index) {
    // Save current canvas to offscreen store
    if (index !== currentSlide) {
      const saveData = ctx.getImageData(0, 0, 400, 400);
      const nonEmpty = saveData.data.some((v,i) => i%4===3 && v>0);
      console.log(`[SAVE] slide ${currentSlide} (${SLIDES[currentSlide].key}): hasPixels=${nonEmpty}`);
      partCanvases[SLIDES[currentSlide].key]
        .getContext('2d')
        .putImageData(saveData, 0, 0);
    }

    currentSlide = index;
    const slide  = SLIDES[index];

    slideTitle.textContent   = slide.label;
    slideHint.textContent    = slide.hint;
    slideCounter.textContent = `${index + 1} / ${SLIDES.length}`;
    progressFill.style.width = `${((index + 1) / SLIDES.length) * 100}%`;

    // Restore this part's drawing
    ctx.clearRect(0, 0, 400, 400);
    ctx.drawImage(partCanvases[slide.key], 0, 0);

    // Template guide
    templateImg.src = slide.template;
    templateImg.classList.remove('hidden');
    templateVisible          = true;
    toggleTplBtn.textContent = 'Hide guide';

    // Reset tools
    setMode('brush');

    if (backBtn) backBtn.style.visibility = index === 0 ? 'hidden' : 'visible';
    nextBtn.textContent      = index === SLIDES.length - 1 ? 'Preview →' : 'Next →';
  }

  /* ----------------------------------------------------------
     MODE HELPER — sets active tool cleanly
  ---------------------------------------------------------- */
  function setMode(mode) {
    isEraser = mode === 'eraser';
    isFill   = mode === 'fill';
    const isBrush = mode === 'brush';

    // One source of truth — only the active tool gets the active class
    const brushBtn = document.getElementById('btnBrush');
    brushBtn  && brushBtn.classList.toggle('active', isBrush);
    eraserBtn && eraserBtn.classList.toggle('active', isEraser);
    fillBtn   && fillBtn.classList.toggle('active', isFill);

    drawCanvas.style.cursor = 'crosshair';
  }

  /* ----------------------------------------------------------
     UNDO / REDO
  ---------------------------------------------------------- */
  function saveSnapshot() {
    const key = SLIDES[currentSlide].key;
    const h   = partHistory[key];
    if (h.length >= 20) h.shift();
    h.push(ctx.getImageData(0, 0, 400, 400));
    partRedo[key] = []; // new action clears redo
  }

  function doUndo() {
    const key  = SLIDES[currentSlide].key;
    const hist = partHistory[key];
    const redo = partRedo[key];
    if (hist.length === 0) return;
    redo.push(ctx.getImageData(0, 0, 400, 400));
    ctx.putImageData(hist.pop(), 0, 0);
  }

  function doRedo() {
    const key  = SLIDES[currentSlide].key;
    const hist = partHistory[key];
    const redo = partRedo[key];
    if (redo.length === 0) return;
    hist.push(ctx.getImageData(0, 0, 400, 400));
    ctx.putImageData(redo.pop(), 0, 0);
  }

  /* ----------------------------------------------------------
     CANVAS POSITION HELPER
  ---------------------------------------------------------- */
  function getPos(e) {
    const rect   = drawCanvas.getBoundingClientRect();
    const scaleX = drawCanvas.width  / rect.width;
    const scaleY = drawCanvas.height / rect.height;
    const src    = e.touches ? e.touches[0] : e;
    return {
      x: (src.clientX - rect.left) * scaleX,
      y: (src.clientY - rect.top)  * scaleY,
    };
  }

  function brushSize() { return parseInt(brushSizeEl.value, 10); }

  /* ----------------------------------------------------------
     DRAWING — only fires when NOT in fill mode
  ---------------------------------------------------------- */
  function startDraw(e) {
    if (isFill) return;
    e.preventDefault();
    saveSnapshot();
    painting = true;
    const { x, y } = getPos(e);

    // Place a dot on click/tap
    ctx.beginPath();
    ctx.arc(x, y, brushSize() / 2, 0, Math.PI * 2);
    if (isEraser) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = brushColour.value;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function continueDraw(e) {
    if (!painting || isFill) return;
    e.preventDefault();
    const { x, y } = getPos(e);
    ctx.lineWidth = brushSize();
    ctx.lineCap   = 'round';
    ctx.lineJoin  = 'round';
    if (isEraser) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.restore();
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = brushColour.value;
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y);
    }
  }

  function endDraw() {
    if (!painting || isFill) return;
    painting = false;
    ctx.beginPath();
  }

  // Drawing listeners
  drawCanvas.addEventListener('mousedown',  startDraw);
  drawCanvas.addEventListener('mousemove',  continueDraw);
  drawCanvas.addEventListener('mouseup',    endDraw);
  drawCanvas.addEventListener('mouseleave', endDraw);
  drawCanvas.addEventListener('touchstart', startDraw,    { passive: false });
  drawCanvas.addEventListener('touchmove',  continueDraw, { passive: false });
  drawCanvas.addEventListener('touchend',   endDraw);

  /* ----------------------------------------------------------
     FILL — only fires when in fill mode
  ---------------------------------------------------------- */
  drawCanvas.addEventListener('mousedown', (e) => {
    if (!isFill) return;
    e.preventDefault();
    const { x, y } = getPos(e);
    floodFill(Math.round(x), Math.round(y), brushColour.value);
  });

  drawCanvas.addEventListener('touchstart', (e) => {
    if (!isFill) return;
    e.preventDefault();
    const { x, y } = getPos(e);
    floodFill(Math.round(x), Math.round(y), brushColour.value);
  }, { passive: false });

  /* ----------------------------------------------------------
     FLOOD FILL
  ---------------------------------------------------------- */
  function floodFill(startX, startY, fillColour) {
    saveSnapshot();

    const W   = 400;
    const H   = 400;
    const img = ctx.getImageData(0, 0, W, H);
    const d   = img.data;

    // Parse fill colour to RGBA
    const tmp  = document.createElement('canvas');
    tmp.width  = tmp.height = 1;
    const tc   = tmp.getContext('2d');
    tc.fillStyle = fillColour;
    tc.fillRect(0, 0, 1, 1);
    const [fr, fg, fb, fa] = tc.getImageData(0, 0, 1, 1).data;

    // Target colour at click point
    const si = (startY * W + startX) * 4;
    const tr = d[si], tg = d[si+1], tb = d[si+2], ta = d[si+3];

    // Already same colour — nothing to do
    if (tr===fr && tg===fg && tb===fb && ta===fa) return;

    const TOLERANCE = 30;
    function matches(i) {
      return Math.abs(d[i]-tr)   < TOLERANCE &&
             Math.abs(d[i+1]-tg) < TOLERANCE &&
             Math.abs(d[i+2]-tb) < TOLERANCE &&
             Math.abs(d[i+3]-ta) < TOLERANCE;
    }
    function paint(i) { d[i]=fr; d[i+1]=fg; d[i+2]=fb; d[i+3]=fa; }

    const queue   = [startX + startY * W];
    const visited = new Uint8Array(W * H);
    visited[startY * W + startX] = 1;

    while (queue.length) {
      const pos = queue.pop();
      const i   = pos * 4;
      if (!matches(i)) continue;
      paint(i);

      const x = pos % W;
      const y = (pos / W) | 0;
      if (x > 0     && !visited[pos-1])  { visited[pos-1]=1;  queue.push(pos-1);  }
      if (x < W-1   && !visited[pos+1])  { visited[pos+1]=1;  queue.push(pos+1);  }
      if (y > 0     && !visited[pos-W])  { visited[pos-W]=1;  queue.push(pos-W);  }
      if (y < H-1   && !visited[pos+W])  { visited[pos+W]=1;  queue.push(pos+W);  }
    }

    ctx.putImageData(img, 0, 0);
  }

  /* ----------------------------------------------------------
     TOOL BUTTON LISTENERS
  ---------------------------------------------------------- */
  eraserBtn.addEventListener('click', () => {
    setMode(isEraser ? 'brush' : 'eraser');
  });

  fillBtn && fillBtn.addEventListener('click', () => {
    setMode(isFill ? 'brush' : 'fill');
  });

  undoBtn.addEventListener('click', doUndo);
  redoBtn && redoBtn.addEventListener('click', doRedo);

  // Copy last slide's drawing onto current canvas
  const copyLastBtn = document.getElementById('btnCopyLast');
  if (copyLastBtn) {
    copyLastBtn.addEventListener('click', () => {
      if (currentSlide === 0) return; // nothing before slide 0
      const prevKey = SLIDES[currentSlide - 1].key;
      const prevCanvas = partCanvases[prevKey];
      if (!prevCanvas) return;
      saveSnapshot();
      ctx.clearRect(0, 0, 400, 400);
      ctx.drawImage(prevCanvas, 0, 0);
    });
  }

  clearBtn.addEventListener('click', () => {
    saveSnapshot();
    ctx.clearRect(0, 0, 400, 400);
  });

  toggleTplBtn.addEventListener('click', () => {
    templateVisible = !templateVisible;
    templateImg.classList.toggle('hidden', !templateVisible);
    toggleTplBtn.textContent = templateVisible ? 'Hide guide' : 'Show guide';
  });

  /* ----------------------------------------------------------
     KEYBOARD SHORTCUTS
     Ctrl+Z = undo   Ctrl+Y / Ctrl+Shift+Z = redo
     E = eraser      F = fill      D = brush
  ---------------------------------------------------------- */
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault(); doUndo();
    } else if (ctrl && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault(); doRedo();
    } else if (ctrl && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault(); doRedo();
    } else if (!ctrl && (e.key === 'e' || e.key === 'E')) {
      setMode(isEraser ? 'brush' : 'eraser');
    } else if (!ctrl && (e.key === 'f' || e.key === 'F')) {
      setMode(isFill ? 'brush' : 'fill');
    } else if (!ctrl && (e.key === 'd' || e.key === 'D')) {
      setMode('brush');
    }
  });

  /* ----------------------------------------------------------
     NAVIGATION
  ---------------------------------------------------------- */
  nextBtn.addEventListener('click', () => {
    const saveData = ctx.getImageData(0, 0, 400, 400);
    const nonEmpty = saveData.data.some((v,i) => i%4===3 && v>0);
    console.log(`[NEXT] saving slide ${currentSlide} (${SLIDES[currentSlide].key}): hasPixels=${nonEmpty}, canvas size=${ctx.canvas.width}x${ctx.canvas.height}`);
    partCanvases[SLIDES[currentSlide].key]
      .getContext('2d')
      .putImageData(saveData, 0, 0);

    if (currentSlide < SLIDES.length - 1) {
      loadSlide(currentSlide + 1);
    } else {
      showPreview();
    }
  });

  if (backBtn) backBtn.addEventListener('click', () => {
    if (currentSlide === 0) return;
    partCanvases[SLIDES[currentSlide].key]
      .getContext('2d')
      .putImageData(ctx.getImageData(0, 0, 400, 400), 0, 0);
    loadSlide(currentSlide - 1);
  });

  /* ----------------------------------------------------------
     PREVIEW
  ---------------------------------------------------------- */
  function showPreview() {
    const panelContent = document.getElementById('drawingPanelContent');
    const preview      = document.getElementById('previewScreen');
    if (!panelContent || !preview) return;
    panelContent.hidden = true;
    preview.hidden      = false;

    // Build thumbnail strip
    const thumbStrip = document.getElementById('thumbnailStrip');
    if (thumbStrip) {
      thumbStrip.innerHTML = '';
      SLIDES.forEach((slide, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'thumb-wrap';

        const thumb = document.createElement('canvas');
        thumb.width  = 80;
        thumb.height = 80;
        thumb.className = 'thumb-canvas';
        const pc = partCanvases[slide.key];
        if (pc) thumb.getContext('2d').drawImage(pc, 0, 0, 80, 80);

        const lbl = document.createElement('span');
        lbl.className   = 'thumb-label';
        lbl.textContent = slide.label;

        wrap.addEventListener('click', () => goBackToSlide(i));
        wrap.title = 'Click to redraw ' + slide.label;

        wrap.appendChild(thumb);
        wrap.appendChild(lbl);
        thumbStrip.appendChild(wrap);
      });
    }

    // Composite parts using rig SIT layout so preview looks like assembled cat
    const previewCanvas = document.getElementById('previewCanvas');
    if (previewCanvas) {
      const CANVAS_W = 240;
      const CANVAS_H = 240;
      previewCanvas.width  = CANVAS_W;
      previewCanvas.height = CANVAS_H;
      const pCtx = previewCanvas.getContext('2d');
      pCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);

      // SIT layout mirrored from rig.js — anchorX/Y are where the pivot lands on the 240x240 canvas
      // Each part source is 400x400. We scale it down and position by pivot.
      const SCALE = CANVAS_W / 240; // 1.0 at 240
      const PARTS = {
        lb_leg: { anchorX: 88,  anchorY: 145, w: 30,  h: 70,  pivotX: 0.5, pivotY: 0.0, angle:  -4 },
        rb_leg: { anchorX: 152, anchorY: 145, w: 30,  h: 70,  pivotX: 0.5, pivotY: 0.0, angle:   4 },
        tail:   { anchorX: 138, anchorY: 138, w: 28,  h: 56,  pivotX: 0.0, pivotY: 1.0, angle:  35 },
        body:   { anchorX: 120, anchorY: 138, w: 100, h: 90,  pivotX: 0.5, pivotY: 0.5, angle:   0 },
        lf_leg: { anchorX: 108, anchorY: 145, w: 28,  h: 68,  pivotX: 0.5, pivotY: 0.0, angle:  -2 },
        rf_leg: { anchorX: 132, anchorY: 145, w: 28,  h: 68,  pivotX: 0.5, pivotY: 0.0, angle:   2 },
        head:   { anchorX: 120, anchorY: 108, w: 90,  h: 80,  pivotX: 0.5, pivotY: 1.0, angle:   0 },
      };
      const ORDER = ['lb_leg','rb_leg','tail','body','lf_leg','rf_leg','head'];

      ORDER.forEach(key => {
        const pc = partCanvases[key];
        const p  = PARTS[key];
        if (!pc || !p) return;

        const drawW = p.w * SCALE;
        const drawH = p.h * SCALE;
        const offX  = -drawW * p.pivotX;
        const offY  = -drawH * p.pivotY;
        const rad   = (p.angle || 0) * Math.PI / 180;

        pCtx.save();
        pCtx.translate(p.anchorX * SCALE, p.anchorY * SCALE);
        pCtx.rotate(rad);
        pCtx.drawImage(pc, offX, offY, drawW, drawH);
        pCtx.restore();
      });
    }
  }

  function goBackToSlide(index) {
    document.getElementById('previewScreen').hidden       = true;
    document.getElementById('drawingPanelContent').hidden = false;
    loadSlide(index);
  }

  const backToDrawingBtn = document.getElementById('btnBackToDrawing');
  if (backToDrawingBtn) {
    backToDrawingBtn.addEventListener('click', () => goBackToSlide(SLIDES.length - 1));
  }

  /* ----------------------------------------------------------
     PUBLIC API
  ---------------------------------------------------------- */
  function getPartDataURLs() {
    const result = {};
    SLIDES.forEach(s => { result[s.key] = partCanvases[s.key].toDataURL('image/png'); });
    return result;
  }

  window.getPartDataURLs = getPartDataURLs;

  window.clearAllParts = function () {
    SLIDES.forEach(s => {
      partCanvases[s.key].getContext('2d').clearRect(0, 0, 400, 400);
      partHistory[s.key] = [];
      partRedo[s.key]    = [];
    });
    ctx.clearRect(0, 0, 400, 400);
    currentSlide = 0;
    document.getElementById('previewScreen').hidden       = true;
    document.getElementById('drawingPanelContent').hidden = false;
    loadSlide(0);
  };

  window.getDrawingDataURL = function () {
    const c      = partCanvases['body'];
    const pixels = c.getContext('2d').getImageData(0, 0, 400, 400).data;
    return pixels.some((v, i) => i % 4 === 3 && v > 0) ? c.toDataURL('image/png') : null;
  };

  /* ----------------------------------------------------------
     INIT
  ---------------------------------------------------------- */
  loadSlide(0);

}); // end DOMContentLoaded
})();