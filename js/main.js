/* ============================================================
   main.js — Pawsona
   - Continuous walk synced to CSS transition
   - Pickup drag with physics (leg/tail sway from velocity)
   - Toy interactions: eat / reach / rollplay
   - play.mp3 plays 3 loops, then idle + 3s cooldown
============================================================ */
document.addEventListener('DOMContentLoaded', () => {

  const drawingPanel     = document.getElementById('drawingPanel');
  const panelTab         = document.getElementById('panelTab');
  const panelTabIcon     = document.getElementById('panelTabIcon');
  const interactiveSpace = document.getElementById('interactiveSpace');
  const stageControls    = document.getElementById('stageControls');
  const catNameInput     = document.getElementById('catName');
  const submitBtn        = document.getElementById('btnSubmit');
  const btnPetAll        = document.getElementById('btnPetAll');
  const btnWebcam        = document.getElementById('btnWebcam');
  const webcamPill       = document.getElementById('webcamPill');
  const btnDevClear      = document.getElementById('btnDevClear');

  let panelOpen = true;
  let webcamOn  = false;
  const liveCats = [];
  window._liveCats = liveCats;

  const SPEED      = 100;
  const MIN_TRAVEL = 1800;
  const IDLE_MIN   = 800;
  const IDLE_MAX   = 2800;
  const CAT_SIZE   = 216;  // 192 * 1.25 * 0.9
  const MIN_Y      = 100;
  const PAD        = 12;
  const COOLDOWN   = 3000;

  /* ── Audio: play N loops then call onDone ── */
  function playNLoops(loops, onDone) {
    const audioEl = document.getElementById('pawsonaAudio');
    if (!audioEl) { onDone && onDone(); return null; }
    // Clone the element so multiple interactions can't fight
    const audio = new Audio(audioEl.src);
    let count = 0;
    audio.addEventListener('ended', () => {
      count++;
      if (count < loops) {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      } else {
        onDone && onDone();
      }
    });
    audio.addEventListener('error', () => { onDone && onDone(); });
    audio.play().catch(() => { onDone && onDone(); });
    return audio;
  }

  /* ----------------------------------------------------------  PANEL  */
  function setPanelOpen(open) {
    panelOpen = open;
    if (drawingPanel)     drawingPanel.classList.toggle('closed', !open);
    if (panelTab)         panelTab.classList.toggle('panel-closed', !open);
    if (interactiveSpace) interactiveSpace.classList.toggle('panel-closed', !open);
    if (panelTabIcon)     panelTabIcon.textContent = open ? 'x' : 'draw';
  }
  if (panelTab) panelTab.addEventListener('click', () => setPanelOpen(!panelOpen));
  setPanelOpen(true);

  /* ----------------------------------------------------------  SUBMIT  */
  if (submitBtn) submitBtn.addEventListener('click', () => {
    const name = catNameInput ? catNameInput.value.trim() : '';
    if (!name) { if (catNameInput) { catNameInput.focus(); catNameInput.placeholder = 'Give your cat a name first!'; } return; }
    const parts = window.getPartDataURLs ? window.getPartDataURLs() : null;
    if (!parts) { alert('Draw your cat first!'); return; }
    submitBtn.disabled = true; submitBtn.textContent = 'Building...';
    const catData = { name, parts, imageData: parts.body || null, date: new Date().toISOString() };
    if (window.addCatToGallery) window.addCatToGallery(catData);
    spawnCat(catData);
    catNameInput.value = ''; catNameInput.placeholder = 'Name your cat...';
    submitBtn.disabled = false; submitBtn.textContent = 'Add to world →';
    if (window.clearAllParts) window.clearAllParts();
    setPanelOpen(false);
    window.dispatchEvent(new CustomEvent('pawsona:catSubmitted', { detail: { name } }));
    setTimeout(() => { window.location.href = 'play.html'; }, 400);
  });

  /* ----------------------------------------------------------  SPAWN  */
  function spawnCat(catData) {
    if (!interactiveSpace) return;
    const spaceW = interactiveSpace.offsetWidth  || 600;
    const spaceH = interactiveSpace.offsetHeight || 400;
    const startX = clampX(rand(PAD, spaceW - CAT_SIZE - PAD), spaceW);
    const startY = clampY(rand(MIN_Y, spaceH - CAT_SIZE - PAD), spaceH);

    const entity = document.createElement('div');
    entity.className  = 'cat-entity';
    entity.style.left = startX + 'px';
    entity.style.top  = startY + 'px';

    const canvas = document.createElement('canvas');
    canvas.width = 240; canvas.height = 240;

    const nameLabel = document.createElement('span');
    nameLabel.className = 'cat-entity-name';
    nameLabel.textContent = catData.name;

    const reactionEl = document.createElement('span');
    reactionEl.className = 'cat-reaction';

    entity.appendChild(reactionEl);
    entity.appendChild(canvas);
    entity.appendChild(nameLabel);
    interactiveSpace.appendChild(entity);

    let rig = null;
    if (catData.parts && window.buildRig) {
      rig = window.buildRig(canvas, catData.parts, 'idle');
    } else if (window.renderCatOnCanvas) {
      window.renderCatOnCanvas(canvas, catData.imageData, 'idle');
    }

    const cat = {
      id: Date.now() + Math.random(), name: catData.name,
      parts: catData.parts, imageData: catData.imageData,
      el: entity, canvas, rig, reactionEl,
      x: startX, y: startY,
      _walking: false, _walkTimer: null, _reactionTimer: null,
      _interacting: false, _cooldownUntil: 0,
      _audio: null, _interactTimeout: null,
      walkInterval: null,
    };
    liveCats.push(cat);
    makeCatDraggable(cat);
    startWalking(cat);
  }

  /* ----------------------------------------------------------  WALK  */
  function startWalking(cat) {
    if (cat._walking || cat._interacting) return;
    cat._walking = true;
    scheduleWalk(cat, rand(300, 1200));
  }
  function stopWalking(cat) {
    cat._walking = false;
    clearTimeout(cat._walkTimer);
  }
  function scheduleWalk(cat, ms) {
    clearTimeout(cat._walkTimer);
    cat._walkTimer = setTimeout(() => walkStep(cat), ms);
  }
  function walkStep(cat) {
    if (!cat._walking || cat._interacting) return;
    const spaceW = interactiveSpace.offsetWidth  || 600;
    const spaceH = interactiveSpace.offsetHeight || 400;
    const dest = pickDest(cat, spaceW, spaceH);
    const dist = Math.hypot(dest.x - cat.x, dest.y - cat.y);
    const travelMs = Math.max(MIN_TRAVEL, (dist / SPEED) * 1000);
    cat.el.classList.toggle('facing-left', dest.x < cat.x);
    cat.el.style.transition = 'left ' + travelMs + 'ms linear, top ' + travelMs + 'ms linear';
    cat.x = dest.x; cat.y = dest.y;
    cat.el.style.left = dest.x + 'px'; cat.el.style.top = dest.y + 'px';
    setRigState(cat, 'walk');
    clearTimeout(cat._walkTimer);
    cat._walkTimer = setTimeout(() => {
      if (!cat._walking || cat._interacting) return;
      setRigState(cat, 'idle');
      scheduleWalk(cat, rand(IDLE_MIN, IDLE_MAX));
    }, travelMs);
  }
  window._restartCatWalking = cat => { stopWalking(cat); startWalking(cat); };

  function pickDest(cat, spaceW, spaceH) {
    const candidates = Array.from({ length: 20 }, () => ({
      x: clampX(rand(PAD, spaceW - CAT_SIZE - PAD), spaceW),
      y: clampY(rand(MIN_Y, spaceH - CAT_SIZE - PAD), spaceH),
    }));
    const others = liveCats.filter(c => c !== cat);
    if (!others.length) return candidates[0];
    let best = candidates[0], bestScore = -1;
    for (const pos of candidates) {
      const cx = pos.x + CAT_SIZE / 2, cy = pos.y + CAT_SIZE / 2;
      let minDist = Infinity;
      for (const o of others) {
        const d = Math.hypot((o.x + CAT_SIZE / 2) - cx, (o.y + CAT_SIZE / 2) - cy);
        if (d < minDist) minDist = d;
      }
      if (minDist > bestScore) { bestScore = minDist; best = pos; }
    }
    return best;
  }

  /* ----------------------------------------------------------  RIG  */
  function setRigState(cat, state) {
    if (cat.rig) cat.rig.setState(state);
    else if (window.triggerCatState) window.triggerCatState(cat.canvas, cat.parts || cat.imageData, state);
  }

  /* ----------------------------------------------------------  DRAG WITH PHYSICS  */
  function makeCatDraggable(cat) {
    const el = cat.el;
    let startX, startY, origX, origY, active = false;
    let prevCX = 0, velX = 0, physRaf = null;

    function onStart(e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (cat._interacting) return;
      e.preventDefault(); e.stopPropagation();
      active = true;
      el.classList.add('cat-dragging');
      el.style.transition = 'none';
      stopWalking(cat);
      setRigState(cat, 'pickup');

      const pt = e.touches ? e.touches[0] : e;
      startX = pt.clientX; startY = pt.clientY;
      prevCX = pt.clientX; velX = 0;
      origX = parseInt(el.style.left) || 0;
      origY = parseInt(el.style.top)  || 0;
      cat.x = origX; cat.y = origY;

      function physLoop() {
        if (!active) return;
        const sway = Math.max(-40, Math.min(40, velX * 2.0));
        if (cat.rig && cat.rig.setPhysics) cat.rig.setPhysics(sway, 0);
        // Decay velocity each frame so legs settle when still
        velX *= 0.82;
        physRaf = requestAnimationFrame(physLoop);
      }
      physRaf = requestAnimationFrame(physLoop);

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup',   onEnd);
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend',  onEnd);
    }

    function onMove(e) {
      if (!active) return;
      e.preventDefault();
      const pt = e.touches ? e.touches[0] : e;
      velX = pt.clientX - prevCX;
      prevCX = pt.clientX;
      const maxX = interactiveSpace.offsetWidth  - el.offsetWidth;
      const maxY = interactiveSpace.offsetHeight - el.offsetHeight;
      const nx = Math.max(0, Math.min(maxX, origX + pt.clientX - startX));
      const ny = Math.max(0, Math.min(maxY, origY + pt.clientY - startY));
      el.style.left = nx + 'px'; el.style.top = ny + 'px';
      cat.x = nx; cat.y = ny;
    }

    function onEnd() {
      if (!active) return;
      active = false;
      cancelAnimationFrame(physRaf);
      if (cat.rig && cat.rig.setPhysics) cat.rig.setPhysics(0, 0);
      el.classList.remove('cat-dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onEnd);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend',  onEnd);
      setRigState(cat, 'idle');
      checkCatToyOverlap(cat);
      startWalking(cat);
    }

    el.addEventListener('mousedown',  onStart);
    el.addEventListener('touchstart', onStart, { passive: false });
  }

  /* ----------------------------------------------------------  INTERACTIONS  */
  const HIT_RADIUS = 150;  // slightly bigger for larger cat

  // Per-toy snap positions relative to cat centre
  // snapOffset = where toy centre goes, relative to cat centre
  // Snap positions: where the toy CENTRE goes relative to catCX/catCY
  // Head is ~10px above catCY, feet are ~74px below catCY
  // x: positive = push toward face side (handled by facing direction below)
  const TOY_CFG = {
    toyFood:      { anim: 'eat',      snap: { x: 85,  y: -8  } },  // beside head
    toyButterfly: { anim: 'reach',    snap: { x:  0,  y: -95 } },  // above head
    toyYarn:      { anim: 'rollplay', snap: { x:  0,  y:  70 } },  // at feet level
  };

  function checkCatToyOverlap(cat) {
    if (!interactiveSpace || cat._interacting) return;
    if (Date.now() < cat._cooldownUntil) return;
    interactiveSpace.querySelectorAll('.play-toy').forEach(toy => {
      if (!cat._interacting && catNearToy(cat, toy)) triggerInteraction(cat, toy);
    });
  }

  function catNearToy(cat, toyEl) {
    const sr = interactiveSpace.getBoundingClientRect();
    const tr = toyEl.getBoundingClientRect();
    const toyCX = tr.left - sr.left + tr.width  / 2;
    const toyCY = tr.top  - sr.top  + tr.height / 2;
    return Math.hypot((cat.x + CAT_SIZE / 2) - toyCX, (cat.y + CAT_SIZE / 2) - toyCY) < HIT_RADIUS;
  }

  window._checkToyDrop = toyEl => {
    liveCats.forEach(cat => {
      if (!cat._interacting && Date.now() >= cat._cooldownUntil && catNearToy(cat, toyEl))
        triggerInteraction(cat, toyEl);
    });
  };

  function triggerInteraction(cat, toyEl) {
    if (cat._interacting) return;
    if (Date.now() < cat._cooldownUntil) return;
    const cfg = TOY_CFG[toyEl.id];
    if (!cfg) return;

    cat._interacting = true;
    stopWalking(cat);

    /* Snap toy to correct position relative to cat */
    const catCX = cat.x + CAT_SIZE / 2;
    const catCY = cat.y + CAT_SIZE / 2;
    const toyW  = toyEl.offsetWidth  || 90;
    const toyH  = toyEl.offsetHeight || 90;

    // CSS default: canvas scaleX(-1) so skeleton RIGHT = visual LEFT
    // facing-left class = cat visually faces right (scaleX(1))
    // facing-left class = cat visually faces left → food snaps left (negative x)
    // no class = cat faces right → food snaps right (positive x)
    const facingLeft = cat.el.classList.contains('facing-left');
    const snapX = catCX + (facingLeft ? -cfg.snap.x : cfg.snap.x) - toyW / 2;
    const snapY = catCY + cfg.snap.y - toyH / 2;

    toyEl.style.transition = 'left 0.3s cubic-bezier(0.34,1.56,0.64,1), top 0.3s cubic-bezier(0.34,1.56,0.64,1)';
    toyEl.style.left = snapX + 'px';
    toyEl.style.top  = snapY + 'px';
    toyEl.dataset.locked = '1';

    /* Set interaction animation */
    setRigState(cat, cfg.anim);

    /* Per-toy extras */
    if (toyEl.id === 'toyFood') {
      showReaction(cat, 'nom nom~', cat.y < 140);
    }
    if (toyEl.id === 'toyButterfly') {
      // Bob butterfly up and down while reach anim plays
      let bobDir = 1, bobY = snapY, bobRaf;
      function bobButterfly() {
        bobY += bobDir * 0.6;
        const topY  = snapY - 18;
        const botY  = snapY + 8;
        if (bobY > botY)  { bobY = botY;  bobDir = -1; }
        if (bobY < topY)  { bobY = topY;  bobDir =  1; }
        toyEl.style.top = bobY + 'px';
        bobRaf = requestAnimationFrame(bobButterfly);
      }
      bobRaf = requestAnimationFrame(bobButterfly);
      // Store so endInteraction can cancel it
      cat._toyBobRaf = bobRaf;
      cat._toyBobCancel = () => { cancelAnimationFrame(bobRaf); cat._toyBobRaf = null; };
    }

    window.dispatchEvent(new CustomEvent('pawsona:interaction', {
      detail: { cat, toyEl, toyType: toyEl.id }
    }));

    /* Play sound 3× then end */
    if (cat._audio) { try { cat._audio.pause(); } catch(e){} }
    cat._audio = playNLoops(3, () => endInteraction(cat, toyEl));
    /* Safety fallback: max 15 seconds regardless */
    clearTimeout(cat._interactTimeout);
    cat._interactTimeout = setTimeout(() => endInteraction(cat, toyEl), 15000);
  }

  function endInteraction(cat, toyEl) {
    if (!cat._interacting) return;
    clearTimeout(cat._interactTimeout);
    cat._interacting   = false;
    cat._cooldownUntil = Date.now() + COOLDOWN;
    if (toyEl) toyEl.dataset.locked = '';
    if (cat._toyBobCancel) { cat._toyBobCancel(); cat._toyBobCancel = null; }
    setRigState(cat, 'idle');
    startWalking(cat);
  }

  /* ----------------------------------------------------------  REACTIONS  */
  function showReaction(cat, text, below) {
    cat.reactionEl.classList.toggle('below', !!below);
    cat.reactionEl.textContent = text;
    cat.reactionEl.classList.remove('show');
    void cat.reactionEl.offsetWidth;
    cat.reactionEl.classList.add('show');
    cat.reactionEl.addEventListener('animationend',
      () => cat.reactionEl.classList.remove('show'), { once: true });
  }

  function fleeCats() {
    const spaceW = interactiveSpace.offsetWidth  || 600;
    const spaceH = interactiveSpace.offsetHeight || 400;
    const n = liveCats.length; if (!n) return;
    const cx = spaceW / 2, cy = spaceH / 2;
    liveCats.forEach((cat, i) => {
      const angle = (2 * Math.PI / n) * i + (Math.random() - 0.5) * 0.4;
      const fx = clampX(cx + Math.cos(angle) * spaceW * 0.36, spaceW);
      const fy = clampY(cy + Math.sin(angle) * spaceH * 0.30, spaceH);
      const travelMs = Math.max(800, (Math.hypot(fx - cat.x, fy - cat.y) / SPEED) * 1000);
      cat.el.classList.toggle('facing-left', fx < cat.x);
      cat.el.style.transition = 'left ' + travelMs + 'ms linear, top ' + travelMs + 'ms linear';
      cat.x = fx; cat.y = fy;
      cat.el.style.left = fx + 'px'; cat.el.style.top = fy + 'px';
    });
  }

  function triggerAll(state) {
    const texts = { pet: 'purrrr~', hiss: '(=ↀωↀ=)\nHSSSS!!' };
    if (state === 'hiss') fleeCats();
    liveCats.forEach(cat => {
      if (cat._interacting) return;
      setRigState(cat, state);
      clearTimeout(cat._reactionTimer);
      cat._reactionTimer = setTimeout(() => setRigState(cat, 'idle'), state === 'hiss' ? 3200 : 2500);
      if (texts[state]) showReaction(cat, texts[state], cat.y < 140);
    });
  }
  window.triggerReaction = triggerAll;

  /* ----------------------------------------------------------  BUTTONS  */
  if (btnPetAll) btnPetAll.addEventListener('click', () => { if (liveCats.length) triggerAll('pet'); });

  if (btnWebcam) btnWebcam.addEventListener('click', async () => {
    if (webcamOn) {
      if (window.stopWebcam) window.stopWebcam();
      webcamOn = false; if (webcamPill) webcamPill.hidden = true;
      btnWebcam.classList.remove('active'); btnWebcam.textContent = 'Webcam';
    } else {
      if (window.startWebcam) await window.startWebcam();
      webcamOn = true; if (webcamPill) webcamPill.hidden = false;
      btnWebcam.classList.add('active'); btnWebcam.textContent = 'Stop webcam';
    }
  });

  if (btnDevClear) btnDevClear.addEventListener('click', () => {
    if (!confirm('Clear ALL cats? Cannot be undone.')) return;
    localStorage.removeItem('pawsona_cats_v1');
    liveCats.forEach(cat => {
      stopWalking(cat);
      clearTimeout(cat._reactionTimer); clearTimeout(cat._interactTimeout);
      if (cat._audio) try { cat._audio.pause(); } catch(e){}
      if (cat.rig) cat.rig.stop();
      cat.el.remove();
    });
    liveCats.length = 0;
    if (stageControls) stageControls.hidden = true;
    if (webcamPill) webcamPill.hidden = true;
    if (webcamOn && window.stopWebcam) window.stopWebcam();
    webcamOn = false;
  });

  document.addEventListener('keydown', e => {
    if ((e.key === 'p' || e.key === 'P') && liveCats.length) triggerAll('pet');
    if ((e.key === 'h' || e.key === 'H') && liveCats.length) triggerAll('hiss');
  });

  /* ----------------------------------------------------------  HELPERS  */
  function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function clampX(x, w)   { return Math.max(PAD,   Math.min(x, (w || 600) - CAT_SIZE - PAD)); }
  function clampY(y, h)   { return Math.max(MIN_Y, Math.min(y, (h || 400) - CAT_SIZE - PAD)); }

  /* ----------------------------------------------------------  RESTORE  */
  function restoreSavedCats() {
    if (!window.loadCatsFromStorage) return;
    const saved = window.loadCatsFromStorage();
    if (saved && saved.length) {
        saved.forEach((cat, i) => setTimeout(() => spawnCat(cat), i * 200));
    }
  }
  if (document.readyState === 'complete') setTimeout(restoreSavedCats, 0);
  else window.addEventListener('load', restoreSavedCats);

});