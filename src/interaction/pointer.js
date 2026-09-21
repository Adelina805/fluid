/** Maximum simultaneous analytic ripples (fixed pool — no unbounded growth). */
export const MAX_RIPPLES = 4;

/** Ripple lifetime in seconds before it is removed from the pool. */
const RIPPLE_LIFETIME = 3.6;

/**
 * Max pointer travel (world units) between down and up to count as a tap.
 * Slightly looser than desktop-only so finger jitter still counts as a tap.
 */
const TAP_MOVE_THRESHOLD = 0.16;

/** World-space speed clamp — prevents violent wakes from fast mouse flicks. */
const MAX_VELOCITY = 2.2;

/**
 * Exponential smoothing rate for velocity (higher = snappier / less lag).
 * Tuned up so slow movement does not feel delayed behind the cursor.
 */
const VELOCITY_SMOOTH = 22.0;

/** Presence ease rates — fast attack so proximity reads immediately. */
const PRESENCE_ATTACK = 22.0;
const PRESENCE_RELEASE = 3.2;

/** Base ripple amplitude range (scaled again under reduced motion). */
const RIPPLE_AMP_MIN = 0.013;
const RIPPLE_AMP_SPAN = 0.005;

/**
 * Phase 5 — pointer input separated from rendering.
 * Normalizes mouse/touch into world XY matching the water height field,
 * tracks smoothed velocity, proximity presence, and a small ripple pool.
 *
 * Hold behavior: only down/up for tap detection — no sustained hold effect.
 *
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {() => { right: number, top: number }} options.getWorldExtents
 *   Returns current orthographic half-extents (camera.right, camera.top).
 * @param {() => { pointerInfluence?: number, velocityResponse?: number, rippleStrength?: number }} [options.getInteractionScales]
 *   Phase 6 — live scales from centralized params (defaults to 1).
 */
export function createPointerInteraction({ canvas, getWorldExtents, getInteractionScales }) {
  const readScales = () => {
    const s = typeof getInteractionScales === 'function' ? getInteractionScales() : null;
    return {
      pointerInfluence: s?.pointerInfluence ?? 1,
      velocityResponse: s?.velocityResponse ?? 1,
      rippleStrength: s?.rippleStrength ?? 1,
    };
  };
  // Critical for mobile: CSS alone is not always enough on WebGL canvases.
  canvas.style.touchAction = 'none';
  canvas.style.userSelect = 'none';
  canvas.style.webkitUserSelect = 'none';

  const reducedMotionQuery =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;

  let reducedMotion = reducedMotionQuery?.matches ?? false;
  /** When true, ignore pointer/touch so UI interaction does not disturb water. */
  let suppressed = false;

  const onReducedMotionChange = (event) => {
    reducedMotion = event.matches;
  };
  reducedMotionQuery?.addEventListener?.('change', onReducedMotionChange);

  /** @type {number | null} */
  let activePointerId = null;
  /** 'pointer' | 'touch' | null — prevents double-handling when both APIs fire. */
  let inputSource = null;
  let pointerOver = false;
  let worldX = 0;
  let worldY = 0;
  let prevWorldX = 0;
  let prevWorldY = 0;
  let hasPrevSample = false;

  let velocityX = 0;
  let velocityY = 0;
  let presence = 0;

  /** @type {{ x: number, y: number, birth: number, amp: number }[]} */
  const ripples = [];

  /** Press tracking for tap (not hold effects). */
  let pressX = 0;
  let pressY = 0;
  let pressMoved = 0;
  let isDown = false;

  // Bound once; elapsed is injected via a ref updated each frame.
  let elapsedRef = 0;

  /**
   * Client pixel → world XY using the same space as
   * `worldXY = position.xy * uWorldScale` with mesh scale (right, top, 1).
   */
  function clientToWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(rect.width, 1);
    const h = Math.max(rect.height, 1);
    const nx = ((clientX - rect.left) / w) * 2 - 1;
    const ny = -(((clientY - rect.top) / h) * 2 - 1);
    const { right, top } = getWorldExtents();
    return {
      x: nx * right,
      y: ny * top,
    };
  }

  function setWorldPosition(x, y) {
    worldX = x;
    worldY = y;
  }

  function spawnRipple(x, y, elapsed) {
    const { rippleStrength } = readScales();
    const motionScale = reducedMotion ? 0.12 : 1.0;
    const amp =
      (RIPPLE_AMP_MIN + Math.random() * RIPPLE_AMP_SPAN) * motionScale * rippleStrength;
    if (amp < 1e-5) return;

    if (ripples.length >= MAX_RIPPLES) {
      let oldest = 0;
      for (let i = 1; i < ripples.length; i += 1) {
        if (ripples[i].birth < ripples[oldest].birth) oldest = i;
      }
      ripples.splice(oldest, 1);
    }

    ripples.push({ x, y, birth: elapsed, amp });
  }

  function pruneRipples(elapsed) {
    for (let i = ripples.length - 1; i >= 0; i -= 1) {
      if (elapsed - ripples[i].birth > RIPPLE_LIFETIME) {
        ripples.splice(i, 1);
      }
    }
  }

  function beginContact(clientX, clientY, id, source) {
    if (suppressed) return;
    activePointerId = id;
    inputSource = source;
    pointerOver = true;
    isDown = true;

    const pos = clientToWorld(clientX, clientY);
    setWorldPosition(pos.x, pos.y);
    pressX = pos.x;
    pressY = pos.y;
    pressMoved = 0;
    // Seed previous sample at contact so the next move is not a huge spike,
    // but the first move still produces velocity immediately.
    prevWorldX = pos.x;
    prevWorldY = pos.y;
    hasPrevSample = true;
    // Snap presence so touch (no hover) reads on the first frame.
    presence = Math.max(presence, reducedMotion ? 0.2 : 0.92);
  }

  function moveContact(clientX, clientY) {
    if (suppressed) return;
    pointerOver = true;
    const pos = clientToWorld(clientX, clientY);
    setWorldPosition(pos.x, pos.y);

    if (isDown) {
      const dx = pos.x - pressX;
      const dy = pos.y - pressY;
      pressMoved = Math.max(pressMoved, Math.hypot(dx, dy));
    }
  }

  function endContact(clientX, clientY, isCancel) {
    const pos = clientToWorld(clientX, clientY);
    setWorldPosition(pos.x, pos.y);

    if (!isCancel && isDown && pressMoved <= TAP_MOVE_THRESHOLD) {
      spawnRipple(pos.x, pos.y, elapsedRef);
    }

    isDown = false;
    activePointerId = null;
    inputSource = null;
    // Touch leaves the surface; mouse may still hover (handled by caller).
    return pos;
  }

  // --- Pointer Events (desktop + modern mobile) ---

  function onPointerDown(event) {
    if (suppressed || inputSource === 'touch') return;
    if (activePointerId !== null && event.pointerId !== activePointerId) {
      return;
    }

    if (event.pointerType === 'touch') {
      event.preventDefault();
    }

    beginContact(event.clientX, event.clientY, event.pointerId, 'pointer');

    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Capture optional; window listeners still track the drag.
    }
  }

  function onPointerMove(event) {
    if (suppressed || inputSource === 'touch') return;

    // Hover (mouse) without press, or the active captured pointer.
    if (event.pointerType === 'mouse' && activePointerId === null) {
      pointerOver = true;
      const pos = clientToWorld(event.clientX, event.clientY);
      setWorldPosition(pos.x, pos.y);
      return;
    }

    if (activePointerId === null || event.pointerId !== activePointerId) {
      return;
    }

    if (event.pointerType === 'touch') {
      event.preventDefault();
    }

    moveContact(event.clientX, event.clientY);
  }

  function onPointerUp(event) {
    if (inputSource === 'touch') return;
    if (activePointerId !== null && event.pointerId !== activePointerId) {
      return;
    }

    if (event.pointerType === 'touch') {
      event.preventDefault();
    }

    endContact(event.clientX, event.clientY, false);

    try {
      if (canvas.hasPointerCapture?.(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    } catch {
      // ignore
    }

    if (event.pointerType !== 'mouse') {
      pointerOver = false;
      hasPrevSample = false;
    }
  }

  function onPointerCancel(event) {
    if (inputSource === 'touch') return;
    if (activePointerId !== null && event.pointerId !== activePointerId) {
      return;
    }

    endContact(event.clientX, event.clientY, true);
    pointerOver = event.pointerType === 'mouse' ? pointerOver : false;
    hasPrevSample = false;
  }

  function onPointerEnter(event) {
    if (suppressed) return;
    if (event.pointerType === 'mouse' && !isDown) {
      pointerOver = true;
      const pos = clientToWorld(event.clientX, event.clientY);
      setWorldPosition(pos.x, pos.y);
    }
  }

  function onPointerLeave(event) {
    if (event.pointerType === 'mouse' && activePointerId === null) {
      pointerOver = false;
      hasPrevSample = false;
    }
  }

  // --- Touch Events fallback (iOS / browsers where pointer path is flaky) ---

  function onTouchStart(event) {
    // Always block browser gestures on the canvas (scroll/zoom/refresh).
    event.preventDefault();
    if (suppressed || inputSource === 'pointer') return;
    if (event.touches.length === 0) return;

    // Single-touch only — ignore additional fingers.
    if (isDown && inputSource === 'touch') {
      return;
    }

    const touch = event.changedTouches[0];
    if (!touch) return;

    beginContact(touch.clientX, touch.clientY, touch.identifier, 'touch');
  }

  function onTouchMove(event) {
    event.preventDefault();
    if (inputSource !== 'touch' || !isDown) return;

    let touch = null;
    for (let i = 0; i < event.changedTouches.length; i += 1) {
      if (event.changedTouches[i].identifier === activePointerId) {
        touch = event.changedTouches[i];
        break;
      }
    }
    if (!touch) return;

    moveContact(touch.clientX, touch.clientY);
  }

  function onTouchEnd(event) {
    if (inputSource !== 'touch') {
      // Pointer path already handled; still block ghost clicks where needed.
      event.preventDefault();
      return;
    }

    let touch = null;
    for (let i = 0; i < event.changedTouches.length; i += 1) {
      if (event.changedTouches[i].identifier === activePointerId) {
        touch = event.changedTouches[i];
        break;
      }
    }
    if (!touch) return;

    event.preventDefault();
    endContact(touch.clientX, touch.clientY, false);
    pointerOver = false;
    hasPrevSample = false;
  }

  function onTouchCancel(event) {
    event.preventDefault();
    if (inputSource !== 'touch') return;

    let touch = null;
    for (let i = 0; i < event.changedTouches.length; i += 1) {
      if (event.changedTouches[i].identifier === activePointerId) {
        touch = event.changedTouches[i];
        break;
      }
    }
    if (!touch) return;

    endContact(touch.clientX, touch.clientY, true);
    pointerOver = false;
    hasPrevSample = false;
  }

  const pointerOpts = { passive: false };
  const touchOpts = { passive: false };

  canvas.addEventListener('pointerdown', onPointerDown, pointerOpts);
  // Window-level move/up so drags keep working if capture fails (common on mobile).
  window.addEventListener('pointermove', onPointerMove, pointerOpts);
  window.addEventListener('pointerup', onPointerUp, pointerOpts);
  window.addEventListener('pointercancel', onPointerCancel, pointerOpts);
  canvas.addEventListener('pointerenter', onPointerEnter);
  canvas.addEventListener('pointerleave', onPointerLeave);

  canvas.addEventListener('touchstart', onTouchStart, touchOpts);
  canvas.addEventListener('touchmove', onTouchMove, touchOpts);
  canvas.addEventListener('touchend', onTouchEnd, touchOpts);
  canvas.addEventListener('touchcancel', onTouchCancel, touchOpts);

  /**
   * Advance smoothing / decay. Call once per animation frame.
   * @param {number} dt seconds
   * @param {number} elapsed seconds since app start
   */
  function update(dt, elapsed) {
    elapsedRef = elapsed;
    const safeDt = Math.min(Math.max(dt, 0), 0.05);

    let sampleVx = 0;
    let sampleVy = 0;
    if (pointerOver && hasPrevSample && safeDt > 1e-5) {
      sampleVx = (worldX - prevWorldX) / safeDt;
      sampleVy = (worldY - prevWorldY) / safeDt;
    }

    const speed = Math.hypot(sampleVx, sampleVy);
    if (speed > MAX_VELOCITY) {
      const s = MAX_VELOCITY / speed;
      sampleVx *= s;
      sampleVy *= s;
    }

    const velBlend = 1 - Math.exp(-VELOCITY_SMOOTH * safeDt);
    velocityX += (sampleVx - velocityX) * velBlend;
    velocityY += (sampleVy - velocityY) * velBlend;

    const targetPresence = pointerOver ? 1 : 0;
    const presenceRate = targetPresence > presence ? PRESENCE_ATTACK : PRESENCE_RELEASE;
    const presenceBlend = 1 - Math.exp(-presenceRate * safeDt);
    presence += (targetPresence - presence) * presenceBlend;

    prevWorldX = worldX;
    prevWorldY = worldY;
    hasPrevSample = pointerOver;

    pruneRipples(elapsed);
  }

  function getState() {
    const { pointerInfluence, velocityResponse } = readScales();
    const motionScale = reducedMotion ? 0.08 : 1.0;
    const speed = Math.hypot(velocityX, velocityY);
    // Clearer slow / medium / fast bands: soft floor for slow move,
    // reaches near-full wake sooner, still hard-capped.
    const t = Math.min(speed / MAX_VELOCITY, 1);
    const wake =
      Math.min(1, Math.pow(t, 0.52) * 1.2) * motionScale * velocityResponse;

    return {
      x: worldX,
      y: worldY,
      velocityX: velocityX * motionScale * velocityResponse,
      velocityY: velocityY * motionScale * velocityResponse,
      strength: presence * motionScale * pointerInfluence,
      wake,
      reducedMotion,
      ripples: ripples.map((r) => ({ ...r })),
    };
  }

  function dispose() {
    canvas.removeEventListener('pointerdown', onPointerDown, pointerOpts);
    window.removeEventListener('pointermove', onPointerMove, pointerOpts);
    window.removeEventListener('pointerup', onPointerUp, pointerOpts);
    window.removeEventListener('pointercancel', onPointerCancel, pointerOpts);
    canvas.removeEventListener('pointerenter', onPointerEnter);
    canvas.removeEventListener('pointerleave', onPointerLeave);

    canvas.removeEventListener('touchstart', onTouchStart, touchOpts);
    canvas.removeEventListener('touchmove', onTouchMove, touchOpts);
    canvas.removeEventListener('touchend', onTouchEnd, touchOpts);
    canvas.removeEventListener('touchcancel', onTouchCancel, touchOpts);

    reducedMotionQuery?.removeEventListener?.('change', onReducedMotionChange);
    ripples.length = 0;
  }

  /**
   * Suppress water interaction while the control UI is being used.
   * @param {boolean} value
   */
  function setSuppressed(value) {
    suppressed = !!value;
    if (suppressed) {
      pointerOver = false;
      isDown = false;
      activePointerId = null;
      inputSource = null;
      hasPrevSample = false;
      velocityX = 0;
      velocityY = 0;
    }
  }

  return {
    update,
    getState,
    setSuppressed,
    dispose,
    MAX_RIPPLES,
  };
}
