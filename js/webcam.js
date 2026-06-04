/* ============================================================
   webcam.js — Pawsona Hand Cursor System
   
   AUTO-STARTS on every page. No button needed.
   
   GESTURES:
   - Open hand  → claw_open.gif cursor (navigation/hover)
   - Fist/grab  → claw_grab.gif cursor (click/drag)
   - Wave       → pet cats (horizontal palm velocity)
   
   MECHANICS:
   - Hides OS cursor site-wide, replaces with claw GIF
   - Fist synthesises pointerdown/pointermove/pointerup events
     so existing drag code in main.js + play.html just works
   - Cursor is position:fixed on body, works on all pages
   
   Hand cursor system for Pawsona
============================================================ */

(function () {

  /* ----------------------------------------------------------
     State
  ---------------------------------------------------------- */
  let stream      = null;
  let handModel   = null;
  let detecting     = false;
  let webcamReady   = false;  // blocks grab/click until fully live
  let rafId       = null;

  // Grab/drag state
  let isGrabbing        = false;
  let grabTarget        = null;
  let grabStartX        = 0;
  let grabStartY        = 0;
  let lastSpaceX        = 0;
  let lastSpaceY        = 0;
  let isDrawingOnCanvas = false;
  let fistFrames        = 0;     // consecutive frames of fist detected
  let openFrames        = 0;     // consecutive frames of open hand
  const FIST_CONFIRM    = 6;     // frames needed to confirm a fist (≈200ms at 30fps)
  const OPEN_CONFIRM    = 4;     // frames of open hand before releasing grab

  // Wave / pet detection
  let waveHistory   = [];     // recent palm X values
  const WAVE_LEN    = 12;     // frames of history
  let waveCooldown  = false;
  let petCooldown   = false;

  // Curl smoothing
  const curlHistory   = [];
  const CURL_HIST_LEN = 10;   // more frames = smoother, less twitchy

  // Face / yell state (kept from original)
  let faceModel         = null;
  let faceDetecting     = false;
  let faceRafId         = null;
  let eyesClosedSince   = null;
  let faceGoneSince     = null;
  let yellActive        = false;
  let yellSwearInterval = null;
  const YELL_TRIGGER_MS = 5000;

  /* Only trigger yell behaviour on play.html */
  function isPlayPage() {
    return window.location.pathname.endsWith('play.html');
  }

  /* ----------------------------------------------------------
     DOM elements
  ---------------------------------------------------------- */
  const video = document.getElementById('webcamFeed');
  let clawCursor  = null;

  /* ----------------------------------------------------------
     CLAW CURSOR — fixed on body, works on every page
  ---------------------------------------------------------- */
  function createClawCursor() {
    if (clawCursor) return;

    // Hide OS cursor on entire page
    const hideStyle = document.createElement('style');
    hideStyle.id = 'pawsona-hide-cursor';
    hideStyle.textContent = '* { cursor: none !important; }';
    document.head.appendChild(hideStyle);

    clawCursor = document.createElement('img');
    clawCursor.id  = 'clawCursor';
    clawCursor.src = 'assets/claw_open.gif';
    clawCursor.style.cssText = `
      position: fixed;
      width: 126px;
      height: auto;
      pointer-events: none;
      display: none;
      z-index: 999999;
      transform: translate(-30%, -20%);
      image-rendering: -webkit-optimize-contrast;
      filter: drop-shadow(0 0 0px #000)
              drop-shadow(-2px -2px 0px #000)
              drop-shadow( 2px -2px 0px #000)
              drop-shadow(-2px  2px 0px #000)
              drop-shadow( 2px  2px 0px #000);
    `;
    document.body.appendChild(clawCursor);
  }

  /* ----------------------------------------------------------
     WEBCAM STATUS OVERLAYS
     Full-screen GIF shown during loading and when live.
     Fades out after 2s once webcam is confirmed ON.
  ---------------------------------------------------------- */
  let statusOverlay = null;

  function createStatusOverlay() {
    if (statusOverlay) return;
    statusOverlay = document.createElement('div');
    statusOverlay.id = 'webcamStatusOverlay';
    statusOverlay.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 999998;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.55);
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.3s;
    `;
    const img = document.createElement('img');
    img.id = 'webcamStatusImg';
    img.style.cssText = `
      width: 75vw;
      height: 75vh;
      object-fit: contain;
      image-rendering: -webkit-optimize-contrast;
    `;
    statusOverlay.appendChild(img);
    document.body.appendChild(statusOverlay);
  }

  function showStatusOverlay(gifSrc) {
    createStatusOverlay();
    const img = document.getElementById('webcamStatusImg');
    if (img) img.src = gifSrc + '?t=' + Date.now(); // restart GIF
    statusOverlay.style.opacity = '1';
    statusOverlay.style.display = 'flex';
  }

  function hideStatusOverlay() {
    if (!statusOverlay) return;
    statusOverlay.style.opacity = '0';
    setTimeout(() => {
      if (statusOverlay) statusOverlay.style.display = 'none';
    }, 400);
  }

  function showClaw(x, y) {
    if (!clawCursor) return;
    clawCursor.style.display = 'block';
    clawCursor.style.left    = x + 'px';
    clawCursor.style.top     = y + 'px';
  }

  function hideClaw() {
    if (!clawCursor) return;
    clawCursor.style.display = 'none';
  }

  function setClawGrab(grabbing) {
    if (!clawCursor) return;
    const t = Date.now();
    clawCursor.src = grabbing
      ? 'assets/claw_grab.gif?t=' + t
      : 'assets/claw_open.gif?t=' + t;
  }

  /* ----------------------------------------------------------
     COORDINATE MAPPING
     Maps webcam landmark coords → page (viewport) coords
     AND → interactiveSpace local coords (for cat/toy hit tests)
  ---------------------------------------------------------- */
  // Smoothed cursor position (lerped toward target each frame)
  let smoothX = window.innerWidth  / 2;
  let smoothY = window.innerHeight / 2;
  const SMOOTH = 0.18;  // 0 = frozen, 1 = instant — lower = smoother

  // Amplification: hand only needs to move through centre 60% of frame
  // but cursor covers the full screen
  const AMPLIFY = 1 / 0.6;

  function mapToViewport(vx, vy) {
    const vw = video.videoWidth  || 640;
    const vh = video.videoHeight || 480;

    // Normalise to 0–1, mirror X
    const nx = 1 - vx / vw;
    const ny =     vy / vh;

    // Remap: treat 0.2–0.8 of frame as full screen range
    const ax = (nx - 0.2) * AMPLIFY;
    const ay = (ny - 0.2) * AMPLIFY;

    const rawX = Math.max(0, Math.min(1, ax)) * window.innerWidth;
    const rawY = Math.max(0, Math.min(1, ay)) * window.innerHeight;

    // Smooth lerp toward raw position
    smoothX += (rawX - smoothX) * SMOOTH;
    smoothY += (rawY - smoothY) * SMOOTH;

    return { x: smoothX, y: smoothY };
  }

  function viewportToSpace(vpx, vpy) {
    const space = document.getElementById('interactiveSpace');
    if (!space) return { x: vpx, y: vpy };
    const r = space.getBoundingClientRect();
    return { x: vpx - r.left, y: vpy - r.top };
  }

  /* ----------------------------------------------------------
     LANDMARK MATH
  ---------------------------------------------------------- */
  function dist(a, b) {
    return Math.sqrt(Math.pow(a[0]-b[0],2) + Math.pow(a[1]-b[1],2));
  }

  function measureCurl(lm) {
    // Average fingertip-to-MCP distance; low = fist, high = open
    const pairs = [
      [lm[8],  lm[5]],
      [lm[12], lm[9]],
      [lm[16], lm[13]],
      [lm[20], lm[17]],
    ];
    const avg = pairs.reduce((s, [t, m]) => s + dist(t, m), 0) / pairs.length;
    return 1 - Math.min(avg / 100, 1);  // 0 = open, 1 = fist
  }

  function measureWave(spaceX) {
    // Returns true if palm has swept fast enough horizontally = wave gesture
    waveHistory.push(spaceX);
    if (waveHistory.length > WAVE_LEN) waveHistory.shift();
    if (waveHistory.length < WAVE_LEN) return false;

    // Check for direction reversal with sufficient amplitude (= wave)
    const min = Math.min(...waveHistory);
    const max = Math.max(...waveHistory);
    const range = max - min;
    if (range < 80) return false;  // not enough sweep

    // Must change direction at least once in the window
    let reversals = 0;
    for (let i = 2; i < waveHistory.length; i++) {
      const prev = waveHistory[i-1] - waveHistory[i-2];
      const curr = waveHistory[i]   - waveHistory[i-1];
      if (prev * curr < 0) reversals++;
    }
    return reversals >= 1;
  }

  /* ----------------------------------------------------------
     ELEMENT UNDER CLAW
     Uses elementsFromPoint (all layers) and skips the claw
     cursor itself and the dev overlay, so we always get the
     real interactive element underneath.
  ---------------------------------------------------------- */
  function getElementUnderClaw(clientX, clientY) {
    const all = document.elementsFromPoint(clientX, clientY);
    for (const el of all) {
      if (el === clawCursor) continue;
      if (el === document.body) continue;
      if (el === document.documentElement) continue;
      if (el.id === 'clawCursor') continue;
      if (el.id === 'pawsona-hide-cursor') continue;
      return el;
    }
    return document.body;
  }

  /* ----------------------------------------------------------
     SYNTHETIC EVENTS
     For navigation (links, buttons): fire click on grab-end
     For dragging (cat-entity, play-toy): fire mousedown/move/up
     so existing drag code in main.js + play.html just works.
  ---------------------------------------------------------- */
  function isDraggable(el) {
    if (!el) return false;
    let node = el;
    while (node && node !== document.body) {
      if (node.classList && (
        node.classList.contains('cat-entity') ||
        node.classList.contains('play-toy')   ||
        node.classList.contains('shelter-cat')
      )) return true;
      node = node.parentElement;
    }
    return false;
  }

  function isClickable(el) {
    if (!el) return false;
    let node = el;
    while (node && node !== document.body) {
      const tag = node.tagName;
      if (tag === 'A' || tag === 'BUTTON') return true;
      if (node.getAttribute && node.getAttribute('role') === 'button') return true;
      if (node.onclick) return true;
      node = node.parentElement;
    }
    return false;
  }

  function fireOn(type, el, clientX, clientY) {
    if (!el) return;
    const opts = { bubbles: true, cancelable: true, clientX, clientY,
                   button: 0, buttons: type === 'mouseup' ? 0 : 1 };
    el.dispatchEvent(new MouseEvent(type, opts));
  }

  /* ----------------------------------------------------------
     DRAWING CANVAS SUPPORT
     When fist is over the drawingCanvas in app.html,
     synthesise mousedown/mousemove/mouseup so drawing.js draws.
  ---------------------------------------------------------- */
  function getDrawingCanvas() {
    return document.getElementById('drawingCanvas');
  }

  function isOverDrawingCanvas(clientX, clientY) {
    const dc = getDrawingCanvas();
    if (!dc) return false;
    const r = dc.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right &&
           clientY >= r.top  && clientY <= r.bottom;
  }

  function fireDrawEvent(type, clientX, clientY) {
    const dc = getDrawingCanvas();
    if (!dc) return;
    dc.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true,
      clientX, clientY,
      buttons: type === 'mouseup' ? 0 : 1,
      button:  type === 'mousedown' ? 0 : -1,
    }));
  }

  function onGrabStart(clientX, clientY) {
    if (!webcamReady) return;
    if (isGrabbing) return;
    isGrabbing = true;
    grabStartX = clientX;
    grabStartY = clientY;
    setClawGrab(true);

    // Drawing canvas takes priority
    if (isOverDrawingCanvas(clientX, clientY)) {
      isDrawingOnCanvas = true;
      fireDrawEvent('mousedown', clientX, clientY);
      return;
    }

    grabTarget = getElementUnderClaw(clientX, clientY);

    // Walk up from grabTarget to find draggable ancestor
    let draggableEl = null;
    let node = grabTarget;
    while (node && node !== document.body) {
      if (node.classList && (
        node.classList.contains('cat-entity') ||
        node.classList.contains('play-toy')   ||
        node.classList.contains('shelter-cat')
      )) { draggableEl = node; break; }
      node = node.parentElement;
    }

    // Fallback: if elementsFromPoint missed (filter stacking contexts can break it),
    // scan all draggable elements by bounding rect
    if (!draggableEl) {
      const candidates = document.querySelectorAll('.cat-entity, .play-toy, .shelter-cat');
      for (const c of candidates) {
        const r = c.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right &&
            clientY >= r.top  && clientY <= r.bottom) {
          draggableEl = c;
          break;
        }
      }
    }

    if (draggableEl) {
      fireOn('mousedown', draggableEl, clientX, clientY);
    }

    // Notify pages that listen for hand fist directly
    if (window._onHandFist) window._onHandFist(clientX, clientY);
  }

  function onGrabMove(clientX, clientY) {
    if (!isGrabbing) return;
    if (isDrawingOnCanvas) {
      // If still over canvas, draw; if moved off, end draw stroke
      if (isOverDrawingCanvas(clientX, clientY)) {
        fireDrawEvent('mousemove', clientX, clientY);
      } else {
        fireDrawEvent('mouseup', clientX, clientY);
        isDrawingOnCanvas = false;
      }
      return;
    }
    window.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, cancelable: true, clientX, clientY, buttons: 1
    }));
  }

  function onGrabEnd(clientX, clientY) {
    if (!isGrabbing) return;
    isGrabbing = false;
    setClawGrab(false);

    // End drawing stroke
    if (isDrawingOnCanvas) {
      isDrawingOnCanvas = false;
      fireDrawEvent('mouseup', clientX, clientY);
      return;
    }

    const dx = clientX - grabStartX;
    const dy = clientY - grabStartY;
    const moved = Math.hypot(dx, dy);

    // Fire mouseup on window for drag release
    window.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true, cancelable: true, clientX, clientY, buttons: 0
    }));

    // Direct stamp check — fires even if element lookup misses
    if (moved < 20 && window._tryStamp && window._tryStamp(clientX, clientY)) return;

    // If the hand barely moved, treat it as a click
    if (moved < 20 && grabTarget) {
      const clickEvt = new MouseEvent('click', {
        bubbles: true, cancelable: true,
        clientX, clientY,   // ← real coords so handlers using e.clientX work
        view: window,
      });

      // Walk up to find a native clickable element (link/button)
      // and call dispatchEvent on it with real coords (NOT bare .click()
      // which creates a zero-coord event)
      let clickNode = grabTarget;
      let fired = false;
      while (clickNode && clickNode !== document.body) {
        const tag = clickNode.tagName;
        if (tag === 'A' || tag === 'BUTTON' ||
            (clickNode.getAttribute && clickNode.getAttribute('role') === 'button')) {
          clickNode.dispatchEvent(clickEvt);
          fired = true;
          break;
        }
        clickNode = clickNode.parentElement;
      }

      // Fire on the original target too (covers divs with click listeners
      // like contractSignArea — event bubbles up to the listener)
      if (!fired) {
        grabTarget.dispatchEvent(new MouseEvent('click', {
          bubbles: true, cancelable: true,
          clientX, clientY, view: window,
        }));
      }
    }

    grabTarget = null;
  }

  /* ----------------------------------------------------------
     PET / WAVE TRIGGER
  ---------------------------------------------------------- */
  const purrSound = new Audio('assets/purr.mp3');
  purrSound.volume = 0.6;
  purrSound.loop   = true;

  function triggerPet(spaceX, spaceY) {
    if (petCooldown || waveCooldown) return;
    const cat = getCatUnderPoint(spaceX, spaceY);
    // Only pet if the claw is actually over a cat — no broadcast petting
    if (!cat) return;

    petCooldown = true;
    waveCooldown = true;
    if (cat.rig) cat.rig.setState('pet');
    purrSound.currentTime = 0;
    purrSound.play().catch(() => {});

    // Bounce the cat
    const startY = cat.y;
    let frame = 0;
    const bounce = setInterval(() => {
      frame++;
      if (!cat.el) { clearInterval(bounce); return; }
      cat.el.style.top = (startY + Math.sin(frame * 0.55) * 22) + 'px';
    }, 16);

    if (cat.reactionEl) {
      cat.reactionEl.classList.toggle('below', cat.y < 140);
      cat.reactionEl.textContent = 'purrrr~';
      cat.reactionEl.classList.remove('show');
      void cat.reactionEl.offsetWidth;
      cat.reactionEl.classList.add('show');
      cat.reactionEl.addEventListener('animationend',
        () => cat.reactionEl.classList.remove('show'), { once: true });
    }

    setTimeout(() => {
      clearInterval(bounce);
      if (cat.el) cat.el.style.top = cat.y + 'px';
      purrSound.pause();
      purrSound.currentTime = 0;
      if (cat.rig) cat.rig.setState('idle');
      petCooldown = false;
    }, 1800);

    setTimeout(() => { waveCooldown = false; }, 2200);
  }

  /* ----------------------------------------------------------
     HIT TEST — find cat under a space-local point
  ---------------------------------------------------------- */
  function getCatUnderPoint(spaceX, spaceY) {
    if (!window._liveCats) return null;
    const CAT_W = 192, CAT_H = 192;
    for (const cat of window._liveCats) {
      if (!cat.el) continue;
      if (spaceX >= cat.x && spaceX <= cat.x + CAT_W &&
          spaceY >= cat.y && spaceY <= cat.y + CAT_H) return cat;
    }
    return null;
  }

  /* ----------------------------------------------------------
     DETECTION LOOP
  ---------------------------------------------------------- */
  async function detectionLoop() {
    if (!detecting || !handModel) return;

    try {
      const predictions = await handModel.estimateHands(video);
      if (!webcamReady) {
        webcamReady = true;
        window._webcamLive = true;  // signals intro.html it's safe to proceed
      }

      if (predictions.length > 0) {
        const lm     = predictions[0].landmarks;
        const palmX  = (lm[0][0] + lm[9][0]) / 2;
        const palmY  = (lm[0][1] + lm[9][1]) / 2;

        // Map to viewport (fixed) coords for claw + pointer events
        const vp = mapToViewport(palmX, palmY);
        showClaw(vp.x, vp.y);

        // Map to space-local coords for cat/toy hit tests
        const sp = viewportToSpace(vp.x, vp.y);
        lastSpaceX = sp.x;
        lastSpaceY = sp.y;
        // Expose viewport velocity for throw detection
        window._clawVX = vp.x - (window._lastClawX || vp.x);
        window._clawVY = vp.y - (window._lastClawY || vp.y);
        window._lastClawX = vp.x;
        window._lastClawY = vp.y;

        // Curl smoothing
        const raw = measureCurl(lm);
        curlHistory.push(raw);
        if (curlHistory.length > CURL_HIST_LEN) curlHistory.shift();
        const curl = curlHistory.reduce((a, b) => a + b, 0) / curlHistory.length;

        // ── GRAB / RELEASE ──
        const isFist = curl > 0.62;

        if (isFist) {
          fistFrames++;
          openFrames = 0;
        } else {
          openFrames++;
          fistFrames = 0;
        }

        // Only start grab after holding fist for FIST_CONFIRM consecutive frames
        if (isFist && !isGrabbing && fistFrames >= FIST_CONFIRM) {
          onGrabStart(vp.x, vp.y);
        // Only release after open hand held for OPEN_CONFIRM consecutive frames
        } else if (!isFist && isGrabbing && openFrames >= OPEN_CONFIRM) {
          onGrabEnd(vp.x, vp.y);
        } else if (isGrabbing) {
          onGrabMove(vp.x, vp.y);
        }

        // ── WAVE = PET (only when hand is open) ──
        if (!isFist && !isGrabbing) {
          const waved = measureWave(sp.x);
          if (waved && webcamReady) triggerPet(sp.x, sp.y);
        } else {
          // Reset wave history while fist is closed
          waveHistory.length = 0;
        }


      } else {
        hideClaw();
        // Hand left frame — silently reset state WITHOUT firing click/mouseup events
        // (onGrabEnd fires synthetic clicks which would advance the intro)
        if (isGrabbing) {
          isGrabbing = false;
          setClawGrab(false);
          grabTarget = null;
          isDrawingOnCanvas = false;
        }
        fistFrames = 0;
        openFrames = 0;
        waveHistory.length = 0;
        curlHistory.length = 0;
      }

    } catch (_) {}

    rafId = requestAnimationFrame(detectionLoop);
  }

  /* ----------------------------------------------------------
     START / STOP (called automatically on load)
  ---------------------------------------------------------- */
  async function start() {
    createClawCursor();
    showStatusOverlay('assets/webcam_loading.gif');

    // Hard timeout — if model doesn't load in 25s, fall back to mouse-only claw
    let modelLoaded = false;
    const loadTimeout = setTimeout(() => {
      if (!modelLoaded) {
        console.warn('Pawsona: handpose timed out — falling back to mouse cursor');
        hideStatusOverlay();
        enableMouseFallback();
      }
    }, 25000);

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, facingMode: 'user' }, // smaller = faster init
        audio: false,
      });
      video.srcObject = stream;
      await video.play();


      if (!handModel) {
        // Wait for handpose CDN — max 15s
        let waited = 0;
        while (typeof window.handpose === 'undefined' && waited < 15000) {
          await new Promise(r => setTimeout(r, 200));
          waited += 200;
        }
        if (typeof window.handpose === 'undefined') {
          clearTimeout(loadTimeout);
          console.warn('Pawsona: handpose CDN not loaded — falling back to mouse cursor');
          hideStatusOverlay();
          enableMouseFallback();
          return;
        }
        // Race model load against a 20s timeout
        handModel = await Promise.race([
          window.handpose.load({ detectionConfidence: 0.7, maxHands: 1 }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('model load timeout')), 20000))
        ]);
      }

      modelLoaded = true;
      clearTimeout(loadTimeout);
      detecting = true;
      detectionLoop();
      startFaceDetection();

      // Webcam is live — show ON notice then fade out
      showStatusOverlay('assets/webcam_on.gif');
      setTimeout(hideStatusOverlay, 2000);

    } catch (err) {
      clearTimeout(loadTimeout);
      console.warn('Pawsona: webcam error', err);
      hideStatusOverlay();
      enableMouseFallback();
    }
  }

  /* Mouse fallback — if hand detection fails/times out, 
     claw still works driven by mouse so site is fully usable */
  function enableMouseFallback() {
    if (window._mouseFallbackActive) return;
    window._mouseFallbackActive = true;
    createClawCursor();
    const claw = document.getElementById('clawCursor');
    if (!claw) return;
    claw.style.display = 'block';
    window.addEventListener('mousemove', e => {
      claw.style.left = e.clientX + 'px';
      claw.style.top  = e.clientY + 'px';
    });
    window.addEventListener('mousedown', () => {
      claw.src = 'assets/claw_grab.gif?t=' + Date.now();
    });
    window.addEventListener('mouseup', () => {
      claw.src = 'assets/claw_open.gif?t=' + Date.now();
    });
  }

  function stop() {
    detecting = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    if (video) video.srcObject = null;
    webcamReady = false;
    hideClaw();
    hideStatusOverlay();
    if (isGrabbing) { isGrabbing = false; setClawGrab(false); }
    purrSound.pause();
    stopFaceDetection();
  }

  // Expose for play.html buttons (kept for compat, now auto-called)
  window.startWebcam = start;
  window.stopWebcam  = stop;

  /* ----------------------------------------------------------
     AUTO-START when page + scripts are ready
  ---------------------------------------------------------- */
  function tryAutoStart() {
    const vid = document.getElementById('webcamFeed');
    if (!vid) {
      const v = document.createElement('video');
      v.id = 'webcamFeed';
      v.autoplay = true; v.playsinline = true;
      v.muted = true; v.hidden = true;
      document.body.appendChild(v);
    }
    // Reassure user after 8s that loading is still in progress (model is ~12MB)
    setTimeout(() => {
      const img = document.getElementById('webcamStatusImg');
      if (img && !webcamReady) {
        // Add a note under the loading gif
        let note = document.getElementById('webcamLoadNote');
        if (!note) {
          note = document.createElement('p');
          note.id = 'webcamLoadNote';
          note.style.cssText = 'color:#fff;font-family:sans-serif;font-size:14px;margin-top:12px;text-align:center;opacity:0.8;';
          note.textContent = 'loading hand detection model (~12MB) — this only happens once...';
          const overlay = document.getElementById('webcamStatusOverlay');
          if (overlay) overlay.appendChild(note);
        }
      }
    }, 8000);
    start();
  }

  if (document.readyState === 'complete') {
    setTimeout(tryAutoStart, 500);
  } else {
    window.addEventListener('load', () => setTimeout(tryAutoStart, 500));
  }


  /* ----------------------------------------------------------
     YELL STATE (face gone / eyes closed) — kept from original
  ---------------------------------------------------------- */
  const screechSound = new Audio('assets/purr.mp3');
  screechSound.volume = 0.8;
  screechSound.loop   = true;

  const SWEAR_SYMBOLS = ['@#$%!','*&@!!','!#@$','%@#!','&*$!','#@!!','$%^&','!@#$%'];

  function spawnSwearBubble(cat) {
    if (!cat || !cat.el) return;
    const b = document.createElement('div');
    b.className = 'swear-bubble';
    b.textContent = SWEAR_SYMBOLS[Math.floor(Math.random() * SWEAR_SYMBOLS.length)];
    const ox = (Math.random() - 0.5) * 220;
    const oy = (Math.random() - 0.5) * 180 - 60;
    b.style.setProperty('--ox', ox + 'px');
    b.style.setProperty('--oy', oy + 'px');
    cat.el.appendChild(b);
    b.addEventListener('animationend', () => b.remove(), { once: true });
  }

  function startYell() {
    if (yellActive) return;
    yellActive = true;
    screechSound.currentTime = 0;
    screechSound.play().catch(() => {});
    yellSwearInterval = setInterval(() => {
      if (!window._liveCats) return;
      window._liveCats.forEach(cat => { if (Math.random() < 0.6) spawnSwearBubble(cat); });
    }, 380);
    if (!window._liveCats) return;
    window._liveCats.forEach(cat => {
      clearInterval(cat.walkInterval); cat.walkInterval = null;
      clearTimeout(cat._walkEndTimer);
      cat.el.style.transition = 'none';
      cat.el.classList.add('yelling');
      if (cat.rig) cat.rig.setState('yell');
    });
  }

  function stopYell() {
    if (!yellActive) return;
    yellActive = false;
    screechSound.pause(); screechSound.currentTime = 0;
    clearInterval(yellSwearInterval); yellSwearInterval = null;
    document.querySelectorAll('.swear-bubble').forEach(b => b.remove());
    if (!window._liveCats) return;
    window._liveCats.forEach(cat => {
      cat.el.classList.remove('yelling');
      requestAnimationFrame(() => { cat.el.style.transition = ''; });
      if (cat.rig) cat.rig.setState('idle');
      if (window._restartCatWalking) setTimeout(() => window._restartCatWalking(cat), 300);
    });
  }

  /* ----------------------------------------------------------
     FACE DETECTION
  ---------------------------------------------------------- */
  const EYE_CLOSE_THRESH = 0.18;

  function eyeAspectRatio(lm, u, lo, l, r) {
    const [up, dn, lt, rt] = [lm[u], lm[lo], lm[l], lm[r]];
    if (!up || !dn || !lt || !rt) return 1;
    const h = Math.hypot(up.x-dn.x, up.y-dn.y, up.z-dn.z);
    const w = Math.hypot(lt.x-rt.x, lt.y-rt.y, lt.z-rt.z);
    return w > 0 ? h / w : 1;
  }

  function handleFaceResults(results) {
    const now   = Date.now();
    const faces = results.multiFaceLandmarks;
    if (!faces || !faces.length) {
      eyesClosedSince = null;
      if (!isPlayPage()) return;  // face-gone yell only on play.html
      if (!faceGoneSince) faceGoneSince = now;
      if (now - faceGoneSince >= YELL_TRIGGER_MS) startYell();
      return;
    }
    faceGoneSince = null;
    const lm = faces[0];
    const leftClosed  = eyeAspectRatio(lm, 159, 145,  33, 133) < EYE_CLOSE_THRESH;
    const rightClosed = eyeAspectRatio(lm, 386, 374, 263, 362) < EYE_CLOSE_THRESH;
    if (leftClosed && rightClosed) {
      if (!isPlayPage()) return;  // eyes-closed yell only on play.html
      if (!eyesClosedSince) eyesClosedSince = now;
      if (now - eyesClosedSince >= YELL_TRIGGER_MS) startYell();
    } else {
      eyesClosedSince = null;
      if (yellActive) stopYell();
    }
  }

  async function startFaceDetection() {
    if (faceDetecting) return;
    faceDetecting = true;
    if (!faceModel) {
      try {
        let waited = 0;
        while (typeof FaceMesh === 'undefined' && waited < 8000) {
          await new Promise(r => setTimeout(r, 100)); waited += 100;
        }
        if (typeof FaceMesh === 'undefined') { faceDetecting = false; return; }
        faceModel = new FaceMesh({ locateFile: f => `https://unpkg.com/@mediapipe/face_mesh@0.4/${f}` });
        faceModel.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
        faceModel.onResults(handleFaceResults);
        await faceModel.initialize().catch(() => {});
      } catch (e) { faceDetecting = false; return; }
    }
    async function faceLoop() {
      if (!faceDetecting) return;
      try { if (video && video.readyState >= 2) await faceModel.send({ image: video }); } catch (_) {}
      faceRafId = requestAnimationFrame(faceLoop);
    }
    faceRafId = requestAnimationFrame(faceLoop);
  }

  function stopFaceDetection() {
    faceDetecting = false;
    if (faceRafId) { cancelAnimationFrame(faceRafId); faceRafId = null; }
    eyesClosedSince = faceGoneSince = null;
    stopYell();
  }

})();
