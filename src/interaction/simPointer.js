/**
 * Stage B — pointer / touch input for the `?sim` water simulation.
 *
 * Event plumbing mirrors `pointer.js` (Pointer Events + Touch Events fallback,
 * single touch, suppression, reduced motion) but, instead of analytic state,
 * every sample is written straight into the sim as a disturbance splat.
 * Positions are never smoothed; only the speed that sets strength is, briefly.
 *
 * Hold behavior is intentionally unresolved: a still pointer adds nothing.
 */

/** Sign of injected disturbances: −1 pushes the surface down, like a fingertip. */
const DISTURBANCE_SIGN = -1;

/** Speed (visible long-axis screens per second) that maps to a curve value of 1. */
const V_REF = 1.0;

/** Curve value added at any speed so slow movement stays visible. */
const STRENGTH_FLOOR = 0.6;

/** < 1 spreads slow speeds apart while still growing through fast ones. */
const SPEED_EXPONENT = 0.65;

/** Soft ceiling on the curve (tanh knee); only extreme flicks approach it. */
const MAX_RAW = 3.0;

/** Total vertical velocity per texel on the path at a curve value of 1 (contact). */
const WAKE_GAIN = 0.1;

/** Strength multiplier while hovering (desktop) vs in contact (press / touch). */
const HOVER_GAIN = 0.35;
const CONTACT_GAIN = 1.0;

/** Time constants (ms) for easing between hover and contact strength. */
const CONTACT_ATTACK_MS = 25;
const CONTACT_RELEASE_MS = 80;

/** Brush radius across travel (texels), from slow to fast. */
const BASE_RADIUS = 3.5;
const FAST_RADIUS = 4.5;

/** Contact widens the brush slightly so drags read fuller, not only brighter. */
const CONTACT_RADIUS_SCALE = 1.15;

/**
 * Brush radius along travel (texels). Kept narrow so each texel is kicked in the
 * few steps the pointer takes to cross it: slow strokes then leave a spreading
 * wake instead of a dimple that just follows the cursor.
 */
const ALONG_RADIUS = 0.5;

/** Along-travel radius multiplier at high speed; softens stroke ends. */
const MAX_STRETCH = 1.6;

/** Speed (screens/s) around which radius and along-radius approach their fast values. */
const SHAPE_SPEED = 1.5;

/** Time constant (ms) of the speed smoothing — kept short for immediacy. */
const SPEED_SMOOTH_MS = 10;

/** Floor on the time between samples (ms) so equal timestamps don't spike speed. */
const MIN_SAMPLE_DT_MS = 4;

/** Press-down impulse: restrained so starting a drag is not a splash. */
const TAP_AMPLITUDE = 0.4;
const TAP_RADIUS = 5;

/** Everything is scaled by this under `prefers-reduced-motion`. */
const REDUCED_MOTION_SCALE = 0.2;

/**
 * Velocity curve value for a speed in screens per second.
 * @param {number} speed
 */
function speedCurve(speed) {
  const raw = STRENGTH_FLOOR + Math.pow(Math.max(speed, 0) / V_REF, SPEED_EXPONENT);
  return MAX_RAW * Math.tanh(raw / MAX_RAW);
}

/**
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {{
 *   addSegment: (ax: number, ay: number, bx: number, by: number, shape: { radius: number, alongRadius: number, strength: number }) => void,
 *   addImpulse: (x: number, y: number, radius: number, amplitude: number) => void,
 * }} options.sim
 */
export function createSimPointer({ canvas, sim }) {
  canvas.style.touchAction = 'none';
  canvas.style.userSelect = 'none';
  canvas.style.webkitUserSelect = 'none';

  const reducedMotionQuery =
    typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reducedMotion = reducedMotionQuery?.matches ?? false;
  const onReducedMotionChange = (event) => {
    reducedMotion = event.matches;
  };
  reducedMotionQuery?.addEventListener?.('change', onReducedMotionChange);

  let suppressed = false;
  /** @type {number | null} */
  let activePointerId = null;
  /** 'pointer' | 'touch' | null — prevents double-handling when both APIs fire. */
  let inputSource = null;
  let isDown = false;

  /** Last sample of the current stroke, in visible-area UV (y up). */
  const trail = { u: 0, v: 0, time: 0, valid: false };
  let smoothedSpeed = 0;
  let contact = HOVER_GAIN;
  let contactTime = 0;
  let inputCpuMs = 0;

  const motionScale = () => (reducedMotion ? REDUCED_MOTION_SCALE : 1);

  function resetTrail() {
    trail.valid = false;
    smoothedSpeed = 0;
  }

  /** Ease the hover ↔ contact multiplier up to `time` (event clock, ms). */
  function updateContact(time) {
    const dt = Math.max(time - contactTime, 0);
    contactTime = time;
    const target = isDown ? CONTACT_GAIN : HOVER_GAIN;
    const tau = target > contact ? CONTACT_ATTACK_MS : CONTACT_RELEASE_MS;
    contact += (target - contact) * (1 - Math.exp(-dt / tau));
  }

  /**
   * Extend the stroke to a new sample and emit the segment it adds.
   * @param {DOMRect} rect
   * @param {number} clientX
   * @param {number} clientY
   * @param {number} time event timestamp (ms)
   */
  function addSample(rect, clientX, clientY, time) {
    const w = Math.max(rect.width, 1);
    const h = Math.max(rect.height, 1);
    const u = (clientX - rect.left) / w;
    const v = 1 - (clientY - rect.top) / h;

    if (!trail.valid) {
      Object.assign(trail, { u, v, time, valid: true });
      return;
    }

    const distance = Math.hypot((u - trail.u) * w, (v - trail.v) * h) / Math.max(w, h);
    const dtMs = Math.max(time - trail.time, MIN_SAMPLE_DT_MS);
    const blend = 1 - Math.exp(-dtMs / SPEED_SMOOTH_MS);
    smoothedSpeed += (distance / (dtMs / 1000) - smoothedSpeed) * blend;
    updateContact(time);

    if (distance > 0) {
      const growth = 1 - Math.exp(-smoothedSpeed / SHAPE_SPEED);
      const contactMix = (contact - HOVER_GAIN) / (CONTACT_GAIN - HOVER_GAIN);
      const radius =
        (BASE_RADIUS + (FAST_RADIUS - BASE_RADIUS) * growth) * (1 + (CONTACT_RADIUS_SCALE - 1) * contactMix);
      const alongRadius = ALONG_RADIUS * (1 + (MAX_STRETCH - 1) * growth);
      const strength = DISTURBANCE_SIGN * WAKE_GAIN * speedCurve(smoothedSpeed) * contact * motionScale();
      sim.addSegment(trail.u, trail.v, u, v, { radius, alongRadius, strength });
    }

    Object.assign(trail, { u, v, time });
  }

  /** Feed a pointer event, including browser-coalesced samples for fast strokes. */
  function addPointerSamples(event) {
    const rect = canvas.getBoundingClientRect();
    const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
    const samples = coalesced.length > 0 ? coalesced : [event];
    for (const s of samples) addSample(rect, s.clientX, s.clientY, s.timeStamp);
  }

  /**
   * @param {number} clientX
   * @param {number} clientY
   * @param {number} time
   * @param {number} id
   * @param {'pointer' | 'touch'} source
   * @param {boolean} continuesHover true when a hovering mouse presses mid-stroke
   */
  function beginContact(clientX, clientY, time, id, source, continuesHover) {
    updateContact(time);
    activePointerId = id;
    inputSource = source;
    isDown = true;
    if (!continuesHover) {
      // Touch has no hover phase: start at full contact strength.
      contact = CONTACT_GAIN;
      resetTrail();
    }

    const rect = canvas.getBoundingClientRect();
    addSample(rect, clientX, clientY, time);
    sim.addImpulse(trail.u, trail.v, TAP_RADIUS, DISTURBANCE_SIGN * TAP_AMPLITUDE * motionScale());
  }

  /** @param {number} time */
  function endContact(time) {
    updateContact(time);
    isDown = false;
    activePointerId = null;
    inputSource = null;
  }

  const isMouseLike = (event) => event.pointerType === 'mouse' || event.pointerType === 'pen';

  function isInsideCanvas(event) {
    const rect = canvas.getBoundingClientRect();
    return (
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    );
  }

  /** @param {Touch[] | TouchList} touches */
  function findActiveTouch(touches) {
    for (let i = 0; i < touches.length; i += 1) {
      if (touches[i].identifier === activePointerId) return touches[i];
    }
    return null;
  }

  // --- Pointer Events (desktop + modern mobile) ---

  function onPointerDown(event) {
    if (suppressed || inputSource === 'touch') return;
    if (activePointerId !== null && event.pointerId !== activePointerId) return;
    if (isMouseLike(event) && event.button !== 0) return;
    if (event.pointerType === 'touch') event.preventDefault();

    beginContact(event.clientX, event.clientY, event.timeStamp, event.pointerId, 'pointer', isMouseLike(event));

    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Capture optional; window listeners still track the drag.
    }
  }

  function onPointerMove(event) {
    if (suppressed || inputSource === 'touch') return;

    if (activePointerId === null) {
      if (!isMouseLike(event)) return;
      if (isInsideCanvas(event)) addPointerSamples(event);
      else resetTrail();
      return;
    }

    if (event.pointerId !== activePointerId) return;
    if (event.pointerType === 'touch') event.preventDefault();
    addPointerSamples(event);
  }

  function onPointerUp(event) {
    if (inputSource === 'touch') return;
    if (activePointerId === null || event.pointerId !== activePointerId) return;
    if (event.pointerType === 'touch') event.preventDefault();

    endContact(event.timeStamp);
    try {
      if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    if (!isMouseLike(event)) resetTrail();
  }

  function onPointerLeave(event) {
    if (isMouseLike(event) && activePointerId === null) resetTrail();
  }

  // --- Touch Events fallback (iOS / browsers where the pointer path is flaky) ---

  function onTouchStart(event) {
    // Always block browser gestures on the canvas (scroll / zoom / refresh).
    event.preventDefault();
    if (suppressed || inputSource === 'pointer') return;
    // Single touch only — ignore additional fingers.
    if (isDown && inputSource === 'touch') return;

    const touch = event.changedTouches[0];
    if (!touch) return;
    beginContact(touch.clientX, touch.clientY, event.timeStamp, touch.identifier, 'touch', false);
  }

  function onTouchMove(event) {
    event.preventDefault();
    if (inputSource !== 'touch' || !isDown) return;
    const touch = findActiveTouch(event.changedTouches);
    if (!touch) return;
    addSample(canvas.getBoundingClientRect(), touch.clientX, touch.clientY, event.timeStamp);
  }

  function onTouchEnd(event) {
    event.preventDefault();
    if (inputSource !== 'touch') return;
    if (!findActiveTouch(event.changedTouches)) return;
    endContact(event.timeStamp);
    resetTrail();
  }

  /**
   * Accumulate handler CPU time for dev stats.
   * @template {(event: any) => void} T
   * @param {T} handler
   */
  const timed = (handler) => (event) => {
    const start = performance.now();
    handler(event);
    inputCpuMs += performance.now() - start;
  };

  const opts = { passive: false };
  const listeners = [
    [canvas, 'pointerdown', timed(onPointerDown), opts],
    // Window-level move / up so drags keep working if capture fails (common on mobile).
    [window, 'pointermove', timed(onPointerMove), opts],
    [window, 'pointerup', timed(onPointerUp), opts],
    [window, 'pointercancel', timed(onPointerUp), opts],
    [canvas, 'pointerleave', onPointerLeave, undefined],
    [canvas, 'touchstart', timed(onTouchStart), opts],
    [canvas, 'touchmove', timed(onTouchMove), opts],
    [canvas, 'touchend', timed(onTouchEnd), opts],
    [canvas, 'touchcancel', timed(onTouchEnd), opts],
  ];
  for (const [target, type, handler, options] of listeners) target.addEventListener(type, handler, options);

  /**
   * Suppress water interaction while UI is being used.
   * @param {boolean} value
   */
  function setSuppressed(value) {
    suppressed = !!value;
    if (suppressed) {
      isDown = false;
      activePointerId = null;
      inputSource = null;
      resetTrail();
    }
  }

  /** Handler CPU time (ms) since the last call. */
  function takeInputCpuMs() {
    const ms = inputCpuMs;
    inputCpuMs = 0;
    return ms;
  }

  function dispose() {
    for (const [target, type, handler, options] of listeners) target.removeEventListener(type, handler, options);
    reducedMotionQuery?.removeEventListener?.('change', onReducedMotionChange);
  }

  return { setSuppressed, takeInputCpuMs, dispose };
}
