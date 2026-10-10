import { Color, Scene, WebGLRenderer } from 'three';
import { bindResize } from './resize.js';
import { bindVisibility } from './visibility.js';
import { createTopDownCamera } from '../render/camera.js';
import { COLOR_DEEP } from '../render/createWaterMesh.js';
import { CAUSTIC_COUPLING, createSurfaceComposite } from '../render/createSurfaceComposite.js';
import { createSimPointer } from '../interaction/simPointer.js';
import {
  applyPublicControls,
  createParams,
  createPublicControls,
  deriveCalmRestlessCausticDriftMul,
  deriveCalmRestlessIdle,
} from '../controls/params.js';
import { createControlPanel } from '../controls/panel.js';
import {
  IDLE_DEFAULTS,
  IDLE_REDUCED_MOTION_SCALE,
  advanceIdleTime,
} from '../sim/idleSource.js';
import {
  MAX_STEPS_PER_FRAME,
  SIM_EDGE_PADDING,
  SIM_STEP_HZ,
  createWaterSim,
  supportsSimTargets,
} from '../sim/createWaterSim.js';

/** Matches the approved `?sim&water` composite (Stage C normal strength). */
const SURFACE_NORMAL_STRENGTH = 6;

/** Largest frame delta fed to the accumulator (seconds). */
const MAX_FRAME_DT = 0.1;

/** Resize settle time before the sim grid is rebuilt (ms). */
const RESIZE_DEBOUNCE_MS = 150;

/** E-folding time for calm↔restless idle retargeting (seconds). */
const IDLE_TARGET_SMOOTH_TAU = 0.5;

/** Caustic Mode B drift eases slower — abrupt slider moves stay soft on the field. */
const CAUSTIC_DRIFT_SMOOTH_TAU = 2.8;

/** Max |drift speed| change per second while easing (warp-lattice units / s²). */
const CAUSTIC_DRIFT_MAX_STEP_PER_S = 0.22;

/**
 * Hidden pre-roll: ~one idle beat of sim steps, spread across rAF with a per-frame GPU budget
 * (avoids a single long synchronous hitch on mobile).
 */
const WARMUP_SIM_SECONDS = 12;
const WARMUP_FRAME_BUDGET_MS = 10;

/**
 * @param {number} calmRestless
 */
/**
 * @param {number} calmRestless
 * @param {number} baseDriftSpeed CAUSTIC_COUPLING warp default
 */
function idleTargetsFromSlider(calmRestless, baseDriftSpeed) {
  const idleMul = deriveCalmRestlessIdle(calmRestless);
  const idle = IDLE_DEFAULTS;
  return {
    strength: idle.strength * idleMul.strengthMul,
    mix: idle.mix * idleMul.mixMul,
    speed: idle.speed * idleMul.speedMul,
    heightCap: idle.heightCap * idleMul.heightCapMul,
    driftMul: deriveCalmRestlessCausticDriftMul(calmRestless, baseDriftSpeed),
  };
}

/**
 * Production Fluid app (E3.5–E6 approved stack): persistent sim + rebuilt caustics on `/`.
 * Legacy analytic surface remains at `?legacy`; dev harness at `?sim`.
 *
 * @param {HTMLElement} root
 */
export function createSimApp(root) {
  const params = createParams();
  const publicControls = createPublicControls();

  const reducedMotionQuery =
    typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reducedMotion = reducedMotionQuery?.matches ?? false;
  const motionScale = reducedMotion ? IDLE_REDUCED_MOTION_SCALE : 1;

  let causticCoupling = {};
  if (reducedMotion && CAUSTIC_COUPLING.drift !== 'off') {
    const drift = CAUSTIC_COUPLING.drift;
    causticCoupling = {
      driftSpeed: CAUSTIC_COUPLING.driftSpeed[drift] * motionScale,
    };
  }

  const camera = createTopDownCamera();
  const scene = new Scene();
  scene.background = new Color(COLOR_DEEP.getHex());
  const renderer = new WebGLRenderer({
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(COLOR_DEEP.getHex(), 1);
  root.appendChild(renderer.domElement);

  if (!supportsSimTargets(renderer)) {
    console.error(
      '[fluid] Half-float render targets are not supported on this device. Showing a static background.',
    );
    bindResize(renderer, camera, () => renderer.render(scene, camera));
    return {
      renderer,
      dispose: () => {
        renderer.dispose();
        if (renderer.domElement.parentElement === root) root.removeChild(renderer.domElement);
      },
    };
  }

  const sim = createWaterSim(renderer, { idleSource: true });
  const idleTimeUniform = sim.getStepMaterial().uniforms.uIdleTime;

  const viewMesh = createSurfaceComposite({
    padding: SIM_EDGE_PADDING,
    normalStrength: SURFACE_NORMAL_STRENGTH,
    cubicHeight: true,
    caustics: 'new',
    causticVariant: 3,
    causticResolution: 'halfHybrid',
    causticCoupling,
    params,
  });
  viewMesh.material.uniforms.uCameraPosition.value.copy(camera.position);
  scene.add(viewMesh);

  const viewUniforms = viewMesh.material.uniforms;
  const baseCausticDriftSpeed = CAUSTIC_COUPLING.driftSpeed[CAUSTIC_COUPLING.drift];

  let idleTarget = idleTargetsFromSlider(publicControls.calmRestless, baseCausticDriftSpeed);
  let causticDriftTarget = baseCausticDriftSpeed * idleTarget.driftMul * motionScale;
  const idleLive = {
    strength: idleTarget.strength,
    mix: idleTarget.mix,
    speed: idleTarget.speed,
    heightCap: idleTarget.heightCap,
  };
  let causticDriftLive = causticDriftTarget;

  const pushIdleToSim = () => {
    sim.applyIdle(
      {
        strength: idleLive.strength,
        mix: idleLive.mix,
        speed: idleLive.speed,
        heightCap: idleLive.heightCap,
      },
      motionScale,
    );
    if (viewUniforms.uCausticDriftSpeed) {
      viewUniforms.uCausticDriftSpeed.value = causticDriftLive;
    }
  };

  const syncParams = () => {
    applyPublicControls(publicControls, params);
    idleTarget = idleTargetsFromSlider(publicControls.calmRestless, baseCausticDriftSpeed);
    causticDriftTarget = baseCausticDriftSpeed * idleTarget.driftMul * motionScale;
    viewMesh.userData.syncShadingParams(params);
    scene.background.copy(viewUniforms.uColorDeep.value);
    renderer.setClearColor(viewUniforms.uColorDeep.value, 1);
  };
  syncParams();
  pushIdleToSim();

  const pointer = createSimPointer({ canvas: renderer.domElement, sim });

  const rebuildSim = () => {
    sim.resize(window.innerWidth, window.innerHeight);
    const { width, height } = sim.getGridSize();
    viewUniforms.uGridSize.value.set(width, height);
  };

  let warmupStepsRemaining = 0;
  let warmupFrameId = 0;
  let ambientWarmupComplete = false;

  const finishAmbientWarmup = () => {
    ambientWarmupComplete = true;
    renderer.domElement.style.visibility = '';
    loop.start();
  };

  const runAmbientWarmupFrame = () => {
    const frameStart = performance.now();
    while (warmupStepsRemaining > 0 && performance.now() - frameStart < WARMUP_FRAME_BUDGET_MS) {
      sim.advance(1);
      warmupStepsRemaining -= 1;
    }
    if (warmupStepsRemaining > 0) {
      warmupFrameId = requestAnimationFrame(runAmbientWarmupFrame);
      return;
    }
    finishAmbientWarmup();
  };

  const beginAmbientWarmup = () => {
    advanceIdleTime(idleTimeUniform, Math.round(SIM_STEP_HZ * WARMUP_SIM_SECONDS), SIM_STEP_HZ);
    idleLive.strength = idleTarget.strength;
    idleLive.mix = idleTarget.mix;
    idleLive.speed = idleTarget.speed;
    idleLive.heightCap = idleTarget.heightCap;
    causticDriftLive = causticDriftTarget;
    pushIdleToSim();

    warmupStepsRemaining = Math.round(SIM_STEP_HZ * WARMUP_SIM_SECONDS);
    renderer.domElement.style.visibility = 'hidden';
    warmupFrameId = requestAnimationFrame(runAmbientWarmupFrame);
  };

  let resizeTimer = 0;
  let initialized = false;
  const unbindResize = bindResize(renderer, camera, () => {
    viewUniforms.uWorldScale.value.set(camera.right, camera.top);
    if (!initialized) {
      initialized = true;
      rebuildSim();
      beginAmbientWarmup();
      return;
    }
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(rebuildSim, RESIZE_DEBOUNCE_MS);
  });

  const stepDt = 1 / SIM_STEP_HZ;
  let accumulator = 0;
  let frameId = 0;
  let running = false;
  let lastFrameTime = 0;
  let elapsed = 0;

  const smoothIdleTowardTargets = (dt) => {
    const idleAlpha = 1 - Math.exp(-dt / IDLE_TARGET_SMOOTH_TAU);
    idleLive.strength += (idleTarget.strength - idleLive.strength) * idleAlpha;
    idleLive.mix += (idleTarget.mix - idleLive.mix) * idleAlpha;
    idleLive.speed += (idleTarget.speed - idleLive.speed) * idleAlpha;
    idleLive.heightCap += (idleTarget.heightCap - idleLive.heightCap) * idleAlpha;

    const driftAlpha = 1 - Math.exp(-dt / CAUSTIC_DRIFT_SMOOTH_TAU);
    let driftStep = (causticDriftTarget - causticDriftLive) * driftAlpha;
    const driftCap = CAUSTIC_DRIFT_MAX_STEP_PER_S * dt;
    if (Math.abs(driftStep) > driftCap) {
      driftStep = Math.sign(driftStep) * driftCap;
    }
    causticDriftLive += driftStep;

    pushIdleToSim();
  };

  const renderFrame = (now) => {
    frameId = requestAnimationFrame(renderFrame);

    const dt = Math.min(Math.max((now - lastFrameTime) * 0.001, 0), MAX_FRAME_DT);
    lastFrameTime = now;

    if (ambientWarmupComplete) {
      smoothIdleTowardTargets(dt);
    }

    accumulator += dt;
    let steps = 0;
    while (accumulator >= stepDt && steps < MAX_STEPS_PER_FRAME) {
      accumulator -= stepDt;
      steps += 1;
    }
    if (accumulator >= stepDt) accumulator = 0;

    if (steps > 0) sim.advance(steps);

    viewUniforms.uState.value = sim.getTexture();
    elapsed += dt;
    if (viewUniforms.uTime) viewUniforms.uTime.value = elapsed;
    viewMesh.userData.prepare?.(renderer, sim.getTexture());
    renderer.render(scene, camera);
  };

  const loop = {
    start() {
      if (running) return;
      running = true;
      lastFrameTime = performance.now();
      frameId = requestAnimationFrame(renderFrame);
    },
    stop() {
      if (!running) return;
      running = false;
      cancelAnimationFrame(frameId);
    },
  };

  const unbindVisibility = bindVisibility(loop);

  const panel = createControlPanel({
    root,
    publicControls,
    onChange: syncParams,
    onUiEngage: (active) => {
      pointer.setSuppressed(active);
    },
  });

  return {
    scene,
    camera,
    renderer,
    sim,
    params,
    publicControls,
    dispose() {
      loop.stop();
      cancelAnimationFrame(warmupFrameId);
      panel.dispose();
      pointer.dispose();
      unbindResize();
      unbindVisibility();
      clearTimeout(resizeTimer);
      sim.dispose();
      viewMesh.userData.dispose?.();
      viewMesh.geometry.dispose();
      viewMesh.material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === root) {
        root.removeChild(renderer.domElement);
      }
    },
  };
}
