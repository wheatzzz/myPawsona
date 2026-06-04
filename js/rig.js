/* ============================================================
   rig.js — Pawsona puppet rig v4

   TWO SKELETON LAYOUTS:
   
   SITTING (idle, pet, hiss) — front-facing:
     Head:    centred above body, pivot at bottom-centre of head
     Body:    centre of canvas, anchor at centre
     lb_leg:  bottom-left of body, BEHIND body (drawn first)
     rb_leg:  bottom-right of body, BEHIND body (drawn first)
     lf_leg:  bottom-centre-left, IN FRONT of body
     rf_leg:  bottom-centre-right, IN FRONT of body
     tail:    top-right of body, diagonal upward-right, pivot bottom-left

   WALKING (walk state) — side-facing:
     Body:    horizontal, centre of canvas
     Head:    left edge of body, slightly above centre, pivot bottom-centre of head
              so neck sits naturally on body's left-top
     lb_leg:  bottom of body, back-left, BEHIND body
     rb_leg:  bottom of body, back-right, BEHIND body
     lf_leg:  bottom of body, front-left, IN FRONT of body
     rf_leg:  bottom of body, front-right, IN FRONT of body
     tail:    right edge of body, diagonal upward-right, pivot bottom-left

   DRAW ORDERS:
     Sitting: lb_leg → rb_leg → tail → body → lf_leg → rf_leg → head
     Walking: lb_leg → rb_leg → tail → body → lf_leg → rf_leg → head

   OUTPUT CANVAS: 240×240
============================================================ */

(function () {

  /* ----------------------------------------------------------
     SITTING SKELETON
     Front-facing. Body centred. Head on top.
     Back legs behind body (wider, outside).
     Front legs in front (closer together, inside).
     Tail top-right, angled upward.
  ---------------------------------------------------------- */
  const SIT = {
    body: {
      anchorX: 120, anchorY: 138,
      w: 100, h: 90,
      pivotX: 0.5, pivotY: 0.5,
      restAngle: 0,
    },
    head: {
      // Bottom-centre of head overlaps INTO body top by ~15px — tight neck join
      anchorX: 120, anchorY: 108,
      w: 90,  h: 80,
      pivotX: 0.5, pivotY: 1.0,
      restAngle: 0,
    },
    // Back legs — wider apart, behind body, heavily overlapping body bottom
    lb_leg: {
      anchorX: 88,  anchorY: 145,
      w: 30, h: 70,
      pivotX: 0.5, pivotY: 0.0,
      restAngle: -4,
    },
    rb_leg: {
      anchorX: 152, anchorY: 145,
      w: 30, h: 70,
      pivotX: 0.5, pivotY: 0.0,
      restAngle: 4,
    },
    // Front legs — closer together, in front of body, heavily overlapping
    lf_leg: {
      anchorX: 108, anchorY: 145,
      w: 28, h: 68,
      pivotX: 0.5, pivotY: 0.0,
      restAngle: -2,
    },
    rf_leg: {
      anchorX: 132, anchorY: 145,
      w: 28, h: 68,
      pivotX: 0.5, pivotY: 0.0,
      restAngle: 2,
    },
    tail: {
      // Upper-right of body, closer in. 25% smaller than before.
      anchorX: 138, anchorY: 138,
      h: 56,
      pivotX: 0.0, pivotY: 1.0,
      restAngle: 35,
      preserveAspect: true,
    },
  };

  /* ----------------------------------------------------------
     WALKING SKELETON
     Side-facing. Body horizontal. Head at left, slightly above.
     Back legs behind body. Front legs in front.
     Tail at right end, angled upward.
  ---------------------------------------------------------- */
  const WALK = {
    // Body rotated -90° so its "top" (where head connects) points LEFT
    // toward the head, lying horizontal. Width/height stay the SAME as sit —
    // the rotation does all the orientation work.
    body: {
      anchorX: 125, anchorY: 145,
      w: 100, h: 90,           // same proportions as SIT
      pivotX: 0.5, pivotY: 0.5,
      restAngle: -90,           // rotated so body top → left (head side)
    },
    head: {
      // Head further left + lower — hangs off front of body like walking profile
      anchorX: 58,  anchorY: 165,
      w: 88, h: 78,
      pivotX: 0.5, pivotY: 1.0,
      restAngle: 0,
    },
    // Back legs — RIGHT side of body (back of cat when walking left-to-right view)
    lb_leg: {
      anchorX: 158, anchorY: 165,
      w: 28, h: 68,
      pivotX: 0.5, pivotY: 0.0,
      restAngle: 4,
    },
    rb_leg: {
      anchorX: 178, anchorY: 165,
      w: 28, h: 68,
      pivotX: 0.5, pivotY: 0.0,
      restAngle: 4,
    },
    // Front legs — LEFT side of body (front of cat, under head)
    lf_leg: {
      anchorX: 88,  anchorY: 165,
      w: 28, h: 68,
      pivotX: 0.5, pivotY: 0.0,
      restAngle: -4,
    },
    rf_leg: {
      anchorX: 108, anchorY: 165,
      w: 28, h: 68,
      pivotX: 0.5, pivotY: 0.0,
      restAngle: -4,
    },
    tail: {
      // Right end of body, closer in. 25% smaller.
      anchorX: 160, anchorY: 145,
      h: 52,
      pivotX: 0.0, pivotY: 1.0,
      restAngle: 30,
      preserveAspect: true,
    },
  };

  /* ----------------------------------------------------------
     DRAW ORDERS
  ---------------------------------------------------------- */
  const SIT_ORDER  = ['lb_leg','rb_leg','tail','body','lf_leg','rf_leg','head'];
  const WALK_ORDER = ['lb_leg','rb_leg','tail','body','lf_leg','rf_leg','head'];

  /* ----------------------------------------------------------
     ANIMATIONS
     Returns DELTA degrees added to restAngle. t = seconds.
     
     Sitting animations use SIT skeleton.
     Walk animation uses WALK skeleton.
  ---------------------------------------------------------- */
  const ANIMS = {

    idle: {
      // Gentle breathing, slow tail sway, subtle leg shifts
      body:   t =>  Math.sin(t * 0.8)  *  1.5,
      head:   t =>  Math.sin(t * 0.6)  *  2,
      tail:   t =>  Math.sin(t * 1.0)  * 10,
      lf_leg: t =>  Math.sin(t * 0.8)  *  2,
      rf_leg: t =>  Math.sin(t * 0.8 + Math.PI) * 2,
      lb_leg: t =>  Math.sin(t * 0.7)  *  1.5,
      rb_leg: t =>  Math.sin(t * 0.7 + Math.PI) * 1.5,
    },

    // Hand is hovering over cat — sits still, tail wags 180 degrees
    hover: {
      body:   t =>  Math.sin(t * 1.2)  *  2,
      head:   t =>  Math.sin(t * 1.0)  *  4,
      tail:   t =>  Math.sin(t * 4.0)  * 55,  // restAngle 35 ± 55 = -20 to 90 deg sweep
      lf_leg: t =>  Math.sin(t * 1.0)  *  3,
      rf_leg: t =>  Math.sin(t * 1.0 + Math.PI) * 3,
      lb_leg: t =>  0,
      rb_leg: t =>  0,
    },

    walk: {
      // Full gait — legs alternate in pairs
      // Front-left and back-right swing together, opposite to front-right/back-left
      body:   t =>  Math.sin(t * 4.5) *  2.5,
      head:   t =>  Math.sin(t * 4.5) *  3,    // slight forward nod with stride
      tail:   t =>  Math.sin(t * 3.5) * 20,    // swings opposite to body
      lf_leg: t =>  Math.sin(t * 4.5)             * 30,
      rf_leg: t =>  Math.sin(t * 4.5 + Math.PI)   * 30,
      lb_leg: t =>  Math.sin(t * 4.5 + Math.PI)   * 26,  // in phase with rf
      rb_leg: t =>  Math.sin(t * 4.5)             * 26,  // in phase with lf
    },

    pet: {
      // Happy sitting — fast tail wag, body rises and bounces,
      // front paws knead, head tilts side to side
      body:   t =>  Math.sin(t * 5)   *  5 - 4,
      head:   t =>  Math.sin(t * 3.5) *  8,
      tail:   t =>  Math.sin(t * 7)   * 32 + 8,
      lf_leg: t =>  Math.sin(t * 5)             * 20 + 16,
      rf_leg: t =>  Math.sin(t * 5 + Math.PI)   * 20 + 16,
      lb_leg: t =>  Math.sin(t * 4)   *  5,
      rb_leg: t =>  Math.sin(t * 4 + Math.PI)   *  5,
    },

    hiss: {
      // Aggressive sitting — body shakes, tail hard up,
      // front legs brace wide, head pulls back
      body:   _t => (Math.random() - 0.5) * 7,
      head:   _t => (Math.random() - 0.5) * 5 - 10,
      tail:   t  =>  Math.sin(t * 14) * 5 - 55,   // hard up
      lf_leg: _t => -22 + (Math.random() - 0.5) * 4,
      rf_leg: _t =>  22 + (Math.random() - 0.5) * 4,
      lb_leg: _t => -10 + (Math.random() - 0.5) * 3,
      rb_leg: _t =>  10 + (Math.random() - 0.5) * 3,
    },


    // PICKUP: head+body still, legs/tail get physDeltaX injected each frame
    pickup: {
      body:   _t => 0,
      head:   _t => 0,
      lf_leg: _t => 0,
      rf_leg: _t => 0,
      lb_leg: _t => 0,
      rb_leg: _t => 0,
      tail:   _t => 0,
    },

    // EAT: head bobs forward (down toward bowl), body slight lean, legs planted
    eat: {
      body:   t =>  Math.sin(t * 3.0) *  3,
      // Positive angle = nod FORWARD/down (toward bowl), range 0 to +30 so always dipping
      head:   t =>  Math.sin(t * 4.5) * 16 + 14,
      tail:   t =>  Math.sin(t * 2.0) * 10,
      lf_leg: _t =>  0,
      rf_leg: _t =>  0,
      lb_leg: _t =>  0,
      rb_leg: _t =>  0,
    },

    // REACH: front paws reach HIGH above head to swipe at butterfly
    // pivotY=0.0 = pivot at TOP of leg bone, so negative = foot swings UP
    // -140 base puts feet well above head anchor (anchorY=108 vs leg anchor=145)
    reach: {
      body:   t =>  Math.sin(t * 0.9) *  2 - 4,
      head:   t =>  Math.sin(t * 0.9) *  3 + 15,  // look up high
      tail:   t =>  Math.sin(t * 1.6) *  8 - 20,
      lf_leg: t =>  Math.sin(t * 3.5)             * 55 - 140,  // sweeping above head
      rf_leg: t =>  Math.sin(t * 3.5 + Math.PI)   * 55 - 140,
      lb_leg: _t =>  10,
      rb_leg: _t => -10,
    },

    // ROLLPLAY: cat bats at yarn that is just above its feet
    // Legs swing forward/back in walking cadence but lower amplitude
    // Net result: playful pawing at the yarn sitting in front of feet
    rollplay: {
      body:   t =>  Math.sin(t * 2.0) *  5,        // excited wiggle
      head:   t =>  Math.sin(t * 1.8) *  8 - 5,    // looks down at yarn
      tail:   t =>  Math.sin(t * 5.0) * 22,        // rapid happy swish
      // Front legs bat forward alternately at the yarn
      lf_leg: t =>  Math.sin(t * 6.0)             * 28 - 20,
      rf_leg: t =>  Math.sin(t * 6.0 + Math.PI)   * 28 - 20,
      lb_leg: t =>  Math.sin(t * 4.0)             * 10,
      rb_leg: t =>  Math.sin(t * 4.0 + Math.PI)   * 10,
    },

    yell: {
      // FULL CHAOS — front legs windmill in the air, body convulses,
      // head thrashes side to side, tail whips violently
      body:   _t => (Math.random() - 0.5) * 14,
      head:   t  =>  Math.sin(t * 9)  * 18 + (Math.random() - 0.5) * 6,
      tail:   t  =>  Math.sin(t * 11) * 50,         // full wild sweep
      lf_leg: t  =>  Math.sin(t * 8)             * 70 - 40,  // swings way up high
      rf_leg: t  =>  Math.sin(t * 8 + Math.PI)   * 70 - 40,  // alternates
      lb_leg: _t => (Math.random() - 0.5) * 18,
      rb_leg: _t => (Math.random() - 0.5) * 18,
    },
  };

  /* ----------------------------------------------------------
     State durations before auto-returning to idle
  ---------------------------------------------------------- */
  const DURATIONS = { pet: 2500, hiss: 3200 };

  /* ----------------------------------------------------------
     Per-canvas registry
  ---------------------------------------------------------- */
  const rigs = new WeakMap();

  /* ----------------------------------------------------------
     getTightCrop(canvas) → canvas
     Finds the bounding box of non-transparent pixels and returns
     a new canvas cropped tightly to that content.
     If canvas is blank, returns the original unchanged.
  ---------------------------------------------------------- */
  function getTightCrop(sourceCanvas) {
    const ctx    = sourceCanvas.getContext('2d', { willReadFrequently: true });
    const w      = sourceCanvas.width;
    const h      = sourceCanvas.height;
    const data   = ctx.getImageData(0, 0, w, h).data;

    let minX = w, minY = h, maxX = 0, maxY = 0;
    let found = false;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const alpha = data[(y * w + x) * 4 + 3];
        if (alpha > 10) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          found = true;
        }
      }
    }

    if (!found) return sourceCanvas; // blank — return as-is

    // Add a small padding so edges aren't clipped
    const PAD = 4;
    minX = Math.max(0, minX - PAD);
    minY = Math.max(0, minY - PAD);
    maxX = Math.min(w - 1, maxX + PAD);
    maxY = Math.min(h - 1, maxY + PAD);

    const cropW = maxX - minX;
    const cropH = maxY - minY;

    if (cropW < 2 || cropH < 2) return sourceCanvas;

    const cropped    = document.createElement('canvas');
    cropped.width    = cropW;
    cropped.height   = cropH;
    cropped.getContext('2d').drawImage(sourceCanvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);
    return cropped;
  }

  /* ----------------------------------------------------------
     loadParts(partDataURLs) → Promise<ImageBitmaps>
     Tight-crops each part before creating the bitmap so the
     user's drawing fills the bone fully when rendered.
  ---------------------------------------------------------- */
  function loadParts(partDataURLs) {
    const bitmaps  = {};
    const promises = Object.entries(partDataURLs).map(([key, url]) =>
      new Promise((resolve, reject) => {
        const img  = new Image();
        img.onload = () => {
          // Draw onto offscreen canvas so we can pixel-read it
          const tmp    = document.createElement('canvas');
          tmp.width    = img.width  || 400;
          tmp.height   = img.height || 400;
          tmp.getContext('2d').drawImage(img, 0, 0);

          // Tight-crop to actual content
          const cropped = getTightCrop(tmp);

          createImageBitmap(cropped)
            .then(bmp => { bitmaps[key] = bmp; resolve(); })
            .catch(reject);
        };
        img.onerror = reject;
        img.src     = url;
      })
    );
    return Promise.all(promises).then(() => bitmaps);
  }

  /* ----------------------------------------------------------
     drawBone — renders one part scaled to fill bone size exactly,
     rotated around its pivot. User's drawing always fills the bone
     regardless of how small or off-centre they drew it.
  ---------------------------------------------------------- */
  function drawBone(ctx, bone, bitmap, deltaAngle) {
    const totalAngle = (bone.restAngle + deltaAngle) * Math.PI / 180;

    // Calculate width and height — if preserveAspect, width follows from bitmap aspect
    let drawW, drawH;
    if (bone.preserveAspect && bitmap.width && bitmap.height) {
      drawH = bone.h;
      drawW = bone.h * (bitmap.width / bitmap.height);
    } else {
      drawW = bone.w;
      drawH = bone.h;
    }

    ctx.save();
    ctx.translate(bone.anchorX, bone.anchorY);
    ctx.rotate(totalAngle);
    ctx.drawImage(
      bitmap,
      -drawW * bone.pivotX,
      -drawH * bone.pivotY,
      drawW,
      drawH
    );
    ctx.restore();
  }

  /* ----------------------------------------------------------
     buildRig(canvas, partDataURLs, initialState) → handle
  ---------------------------------------------------------- */
  window.buildRig = function (canvas, partDataURLs, initialState) {
    stopRig(canvas);

    const ctx     = canvas.getContext('2d');
    const startT  = performance.now();
    let   state   = initialState || 'idle';
    let   running = true;
    let   rafId;
    let   bitmaps    = null;
    let   physDeltaX = 0;  // injected by drag for 'pickup' state
    let   physDeltaY = 0;

    loadParts(partDataURLs).then(loaded => {
      bitmaps = loaded;

      function loop(now) {
        if (!running) return;
        rafId = requestAnimationFrame(loop);

        const t      = (now - startT) / 1000;
        const anim   = ANIMS[state]  || ANIMS.idle;
        const isWalk = state === 'walk';
        const SK     = isWalk ? WALK    : SIT;
        const ORDER  = isWalk ? WALK_ORDER : SIT_ORDER;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Scale and centre rig to fit any canvas size
        // Skeleton is designed for 240×240
        const DESIGN = 240;
        const scale  = Math.min(canvas.width, canvas.height) / DESIGN;
        const offX   = (canvas.width  - DESIGN * scale) / 2;
        const offY   = (canvas.height - DESIGN * scale) / 2;

        ctx.save();
        ctx.translate(offX, offY);
        ctx.scale(scale, scale);

        ORDER.forEach(key => {
          const bone   = SK[key];
          const bitmap = bitmaps[key];
          if (!bone || !bitmap) return;
          let delta = anim[key] ? anim[key](t) : 0;
          // Physics override for pickup drag state
          if (state === 'pickup') {
            if (key === 'lf_leg') delta = -physDeltaX * 0.9 + Math.sin(t * 2.0) * 4;
            if (key === 'rf_leg') delta = -physDeltaX * 0.7 + Math.sin(t * 2.0 + 1.0) * 4;
            if (key === 'lb_leg') delta =  physDeltaX * 0.8 + Math.sin(t * 2.0 + 0.5) * 4;
            if (key === 'rb_leg') delta =  physDeltaX * 0.6 + Math.sin(t * 2.0 + 1.5) * 4;
            if (key === 'tail')   delta = -physDeltaX * 1.2 + Math.sin(t * 1.5) * 8 - 10;
          }
          drawBone(ctx, bone, bitmap, delta);
        });

        ctx.restore();
      }

      rafId = requestAnimationFrame(loop);
    }).catch(err => {
      console.warn('Pawsona: rig load failed', err);
    });

    const handle = {
      setState:    s       => { state = ANIMS[s] ? s : 'idle'; },
      setPhysics:  (dx, dy) => { physDeltaX = dx; physDeltaY = dy; },
      getState: () => state,
      stop:     ()  => { running = false; if (rafId) cancelAnimationFrame(rafId); },
    };

    rigs.set(canvas, handle);
    return handle;
  };

  /* ----------------------------------------------------------
     triggerCatState
  ---------------------------------------------------------- */
  window.triggerCatState = function (canvas, partDataURLs, state) {
    const rig = rigs.get(canvas);
    if (rig) {
      rig.setState(state);
    } else if (partDataURLs) {
      window.buildRig(canvas, partDataURLs, state);
    }
    const dur = DURATIONS[state];
    if (dur) {
      setTimeout(() => {
        const r = rigs.get(canvas);
        if (r) r.setState('idle');
      }, dur);
    }
  };

  /* ----------------------------------------------------------
     renderCatOnCanvas — legacy / gallery interface
  ---------------------------------------------------------- */
  window.renderCatOnCanvas = function (canvas, partsOrString, state) {
    if (typeof partsOrString === 'string') {
      fallbackAnimate(canvas, partsOrString);
      return;
    }
    window.buildRig(canvas, partsOrString, state || 'idle');
  };

  /* ----------------------------------------------------------
     stopRig
  ---------------------------------------------------------- */
  function stopRig(canvas) {
    const r = rigs.get(canvas);
    if (r) r.stop();
    rigs.delete(canvas);
  }

  /* ----------------------------------------------------------
     Fallback plain bob for legacy flat-image cats
  ---------------------------------------------------------- */
  function fallbackAnimate(canvas, imageDataURL) {
    const ctx = canvas.getContext('2d');
    const img = new Image();
    let f = 0;
    img.onload = () => {
      (function loop() {
        requestAnimationFrame(loop);
        f++;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2 + Math.sin(f * 0.03) * 2);
        ctx.drawImage(img, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height);
        ctx.restore();
      })();
    };
    img.src = imageDataURL;
  }

})();