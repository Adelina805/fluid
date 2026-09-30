import { Mesh, PlaneGeometry, Scene, ShaderMaterial, Vector2, WebGLRenderer } from 'three';
import { bindResize } from './resize.js';
import { bindVisibility } from './visibility.js';
import { createTopDownCamera } from '../render/camera.js';
import { COLOR_DEEP } from '../render/createWaterMesh.js';
import { SIM_HEIGHT_SCALE, createSurfaceComposite } from '../render/createSurfaceComposite.js';
import { createLegacyCausticsDev } from '../render/legacyCausticsDev.js';
import { createSimPointer } from '../interaction/simPointer.js';
import {
  MAX_STEPS_PER_FRAME,
  SIM_EDGE_PADDING,
  SIM_STEP_HZ,
  createWaterSim,
  supportsSimTargets,
} from '../sim/createWaterSim.js';
import fullscreenVertexShader from '../shaders/fullscreen.vert.glsl?raw';
import simSurfaceShaderChunk from '../shaders/sim/simSurface.glsl?raw';
import simDebugFragmentShader from '../shaders/simDebug.frag.glsl?raw';

/** Height → grayscale multiplier for the debug view (`?gain=` overrides). */
const DEBUG_GAIN = 2.5;

/**
 * Slope (height per sim texel) → normal tilt in the normal view (`?normalStrength=` overrides).
 * Dev only; retuned when lighting returns.
 */
const DEBUG_NORMAL_STRENGTH = 6;

/** Safe range for the normal-strength override. */
const MAX_NORMAL_STRENGTH = 16;

/** Seconds between console stat lines. */
const STATS_INTERVAL = 2;

/** Largest frame delta fed to the accumulator (seconds). */
const MAX_FRAME_DT = 0.1;

/** Resize settle time before the sim grid is rebuilt (ms). */
const RESIZE_DEBOUNCE_MS = 150;

/**
 * Stage A test disturbances, replayed only with `?testImpulses`.
 * `delay` in seconds of sim time; `x` / `y` in visible-area UV (y up); `radius` in texels.
 */
const TEST_IMPULSES = [
  { delay: 0, x: 0.5, y: 0.5, radius: 6, amplitude: 1.0 },
  { delay: 1.5, x: 0.63, y: 0.4, radius: 6, amplitude: 1.0 },
];

/**
 * `caustics=` for the water view. `new` is reserved for Stage E1 and falls back to `off` until then.
 * @param {URLSearchParams} query
 * @param {boolean} showWater
 * @returns {'off' | 'legacy'}
 */
function resolveCausticMode(query, showWater) {
  if (!query.has('caustics')) return 'off';
  const requested = query.get('caustics');
  if (!showWater) {
    console.warn('[sim] caustics= applies only to the water view (`?sim&water`); ignored.');
    return 'off';
  }
  if (requested === 'off' || requested === 'legacy') return requested;
  if (requested === 'new') {
    console.warn('[sim] caustics=new is reserved for Stage E1 and not implemented yet; caustics off.');
  } else {
    console.warn(`[sim] unknown caustics=${requested} (use off | legacy | new); caustics off.`);
  }
  return 'off';
}

/**
 * GPU pass timing via EXT_disjoint_timer_query_webgl2 (dev only).
 * @param {WebGL2RenderingContext} gl
 */
function createGpuTimer(gl) {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return null;

  /** @type {{ query: WebGLQuery, label: string }[]} */
  const pending = [];
  /** @type {Record<string, { sum: number, count: number }>} */
  let totals = {};

  return {
    /** @param {string} label */
    begin(label) {
      const query = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
      pending.push({ query, label });
    },
    end() {
      gl.endQuery(ext.TIME_ELAPSED_EXT);
    },
    poll() {
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      while (pending.length > 0) {
        const { query, label } = pending[0];
        if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
        if (!disjoint) {
          const ms = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
          const total = (totals[label] ??= { sum: 0, count: 0 });
          total.sum += ms;
          total.count += 1;
        }
        gl.deleteQuery(query);
        pending.shift();
      }
    },
    /** Average ms per labelled pass since the last call. */
    takeAverages() {
      const averages = {};
      for (const [label, { sum, count }] of Object.entries(totals)) {
        averages[label] = count > 0 ? sum / count : null;
      }
      totals = {};
      return averages;
    },
  };
}

/**
 * `?sim` entry: low-res wave simulation shown as a grayscale height view (or, with
 * `normals`, RGB-encoded sim normals; with `water`, the approved shading driven by the sim),
 * disturbed by pointer / touch (Stage B). Independent of the approved water mesh and control panel.
 *
 * Dev URL options: `water` (sim-driven water composite, Stage D), `optics=<1–4>` (water: Fresnel /
 * distortion / albedo / lighting only; cubic B-spline height by default, `bilinear` to compare),
 * `caustics=off|legacy|new` (water: Stage E comparison; `off` default, `legacy` = legacy Phase 6.5
 * network on the sim surface, `new` reserved for E1), `causticView` (caustic light only, on black) or
 * `causticView=raw` (raw network before gate / intensity),
 * `normals` (normal view), `cubic` (B-spline height sampling in the height / normal views),
 * `normalStrength=<n>`, `debugPadding` (show sponge margin), `gain=<n>`, `simFps=<n>` (throttle render loop),
 * `testImpulses` (replay the Stage A impulses). Console: `__fluidSim.impulse(x, y, amplitude, radius)`.
 * @param {HTMLElement} root
 */
export function createSimDebugApp(root) {
  const query = new URLSearchParams(window.location.search);
  const showPadding = query.has('debugPadding');
  const gain = Number(query.get('gain')) || DEBUG_GAIN;
  const showWater = query.has('water');
  const debugOptics = Math.min(Math.max(Math.round(Number(query.get('optics')) || 0), 0), 4);
  const showNormals = query.has('normals');
  const cubicHeight = showWater ? !query.has('bilinear') : query.has('cubic');
  const requestedStrength = Number(query.get('normalStrength'));
  const normalStrength = query.has('normalStrength') && Number.isFinite(requestedStrength)
    ? Math.min(Math.max(requestedStrength, 0), MAX_NORMAL_STRENGTH)
    : DEBUG_NORMAL_STRENGTH;
  const throttleFps = Number(query.get('simFps')) || 0;
  const replayTestImpulses = query.has('testImpulses');
  const caustics = resolveCausticMode(query, showWater);
  const causticView = caustics !== 'off' && query.has('causticView')
    ? (query.get('causticView') === 'raw' ? 2 : 1)
    : 0;
  if (query.has('causticView') && !causticView) {
    console.warn('[sim] causticView needs `water&caustics=legacy`; ignored.');
  }

  const camera = createTopDownCamera();
  const renderer = new WebGLRenderer({
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(COLOR_DEEP.getHex(), 1);
  root.appendChild(renderer.domElement);

  if (!supportsSimTargets(renderer)) {
    console.error(
      '[sim] Half-float render targets are not supported (needs EXT_color_buffer_float or EXT_color_buffer_half_float). The simulation cannot run on this device.',
    );
    bindResize(renderer, camera, () => renderer.render(new Scene(), camera));
    return { renderer, dispose: () => renderer.dispose() };
  }

  const sim = createWaterSim(renderer);
  const pointer = createSimPointer({ canvas: renderer.domElement, sim });

  const pendingTestImpulses = replayTestImpulses ? [...TEST_IMPULSES] : [];

  const samplingLabel = cubicHeight ? 'cubic B-spline' : 'bilinear';
  let viewMesh;
  if (showWater) {
    const devCaustics = caustics === 'legacy' ? createLegacyCausticsDev({ view: causticView }) : null;
    viewMesh = createSurfaceComposite({
      padding: SIM_EDGE_PADDING,
      normalStrength,
      debugOptics,
      cubicHeight,
      devCaustics,
    });
    viewMesh.material.uniforms.uCameraPosition.value.copy(camera.position);
    const viewLabel = ['', ', caustic light only', ', raw caustic network'][causticView];
    console.info(
      `[sim] view: water composite (normal strength ${normalStrength}, ${samplingLabel} height` +
        `, height scale ${SIM_HEIGHT_SCALE}${debugOptics ? `, optics debug ${debugOptics}` : ''}` +
        `; caustics ${caustics}${viewLabel})`,
    );
  } else {
    const debugMaterial = new ShaderMaterial({
      vertexShader: fullscreenVertexShader,
      fragmentShader: `${simSurfaceShaderChunk}\n${simDebugFragmentShader}`,
      uniforms: {
        uState: { value: null },
        uGridSize: { value: new Vector2(1, 1) },
        uPadding: { value: SIM_EDGE_PADDING },
        uGain: { value: gain },
        uShowPadding: { value: showPadding ? 1 : 0 },
        uView: { value: showNormals ? 1 : 0 },
        uNormalStrength: { value: normalStrength },
      },
      defines: cubicHeight ? { SIM_CUBIC: '' } : {},
      depthTest: false,
      depthWrite: false,
    });
    viewMesh = new Mesh(new PlaneGeometry(2, 2), debugMaterial);
    viewMesh.frustumCulled = false;
    console.info(
      showNormals ? `[sim] view: normals (strength ${normalStrength}, ${samplingLabel} height)` : '[sim] view: height',
    );
  }
  const viewUniforms = viewMesh.material.uniforms;
  const viewScene = new Scene();
  viewScene.add(viewMesh);

  window.__fluidSim = {
    sim,
    /** Dev-only: live view uniforms (e.g. `uSimHeightScale`, `uNormalStrength`) for tuning. */
    uniforms: viewUniforms,
    /** Dev-only manual impulse; UV coordinates, y up. */
    impulse: (x = 0.5, y = 0.5, amplitude = 1.0, radius = 6) => sim.addImpulse(x, y, radius, amplitude),
    /** Dev-only: draw the current state immediately (for scripted captures). */
    render: () => {
      viewUniforms.uState.value = sim.getTexture();
      renderer.render(viewScene, camera);
    },
  };

  const rebuildSim = () => {
    sim.resize(window.innerWidth, window.innerHeight);
    const { width, height, visibleWidth, visibleHeight } = sim.getGridSize();
    viewUniforms.uGridSize.value.set(width, height);
    console.info(
      `[sim] grid ${visibleWidth}×${visibleHeight} visible + ${SIM_EDGE_PADDING}px sponge = ${width}×${height} texels (RGBA half-float)`,
    );
  };

  let resizeTimer = 0;
  let initialized = false;
  const unbindResize = bindResize(renderer, camera, () => {
    viewUniforms.uWorldScale?.value.set(camera.right, camera.top);
    if (!initialized) {
      initialized = true;
      rebuildSim();
      return;
    }
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(rebuildSim, RESIZE_DEBOUNCE_MS);
  });

  const gpuTimer = createGpuTimer(renderer.getContext());
  if (!gpuTimer) console.info('[sim] EXT_disjoint_timer_query_webgl2 unavailable — GPU timings skipped.');

  const stepDt = 1 / SIM_STEP_HZ;
  let accumulator = 0;
  let frameId = 0;
  let running = false;
  let lastFrameTime = 0;
  /** Visible seconds (skips hidden time), like the legacy app's `uTime`. */
  let elapsed = 0;
  let statsClock = 0;
  let framesSinceStats = 0;
  let stepsSinceStats = 0;
  /** Frames / steps split by whether the frame's first step carried queued input. */
  let idleSimFrames = 0;
  let idleSimSteps = 0;
  let inputSimFrames = 0;
  let inputSimSteps = 0;

  function logStats(seconds) {
    const readIndex = sim.getReadIndex();
    const stepCount = sim.getStepCount();
    const alternating = readIndex === stepCount % 2;
    const gpu = gpuTimer ? gpuTimer.takeAverages() : {};
    const { maxHeight, maxVelocity, energy, nanCount } = sim.readStats();
    const inputCounts = sim.takeInputCounts();
    const perStep = (frameMs, frames, steps) => (frameMs != null && steps > 0 ? (frameMs * frames) / steps : null);
    const stats = {
      fps: framesSinceStats / seconds,
      stepsPerSecond: stepsSinceStats / seconds,
      stepCount,
      reading: readIndex === 0 ? 'A' : 'B',
      alternating,
      gpuSimMsPerStep: perStep(gpu.sim, idleSimFrames, idleSimSteps),
      gpuSimInputMsPerStep: perStep(gpu.simInput, inputSimFrames, inputSimSteps),
      gpuDebugMs: gpu.debug ?? null,
      segmentsPerSecond: inputCounts.segments / seconds,
      impulsesPerSecond: inputCounts.impulses / seconds,
      inputCpuMsPerSecond: pointer.takeInputCpuMs() / seconds,
      maxHeight,
      maxVelocity,
      energy,
      nanCount,
    };
    window.__fluidSimStats = stats;

    const ms = (value) => (value == null ? 'n/a' : `${value.toFixed(3)} ms`);
    console.info(
      `[sim] fps ${stats.fps.toFixed(1)} | steps/s ${stats.stepsPerSecond.toFixed(1)} | step #${stepCount}` +
        ` | reading ${stats.reading} (${alternating ? 'ping-pong ok' : 'PING-PONG MISMATCH'})` +
        // The first query of a frame also absorbs frame-start overhead, so these are upper bounds.
        ` | GPU sim ≤${ms(stats.gpuSimMsPerStep)}/step idle, ≤${ms(stats.gpuSimInputMsPerStep)}/step with input` +
        `, debug ${ms(stats.gpuDebugMs)}` +
        ` | input ${stats.segmentsPerSecond.toFixed(0)} seg/s ${stats.impulsesPerSecond.toFixed(1)} imp/s` +
        ` cpu ${stats.inputCpuMsPerSecond.toFixed(3)} ms/s` +
        ` | max|h| ${maxHeight.toFixed(4)} max|v| ${maxVelocity.toFixed(4)} energy ${energy.toExponential(2)} NaN ${nanCount}`,
    );
    idleSimFrames = 0;
    idleSimSteps = 0;
    inputSimFrames = 0;
    inputSimSteps = 0;
  }

  const renderFrame = (now) => {
    frameId = requestAnimationFrame(renderFrame);
    if (throttleFps > 0 && now - lastFrameTime < 1000 / throttleFps - 2) return;

    const dt = Math.min(Math.max((now - lastFrameTime) * 0.001, 0), MAX_FRAME_DT);
    lastFrameTime = now;

    accumulator += dt;
    let steps = 0;
    while (accumulator >= stepDt && steps < MAX_STEPS_PER_FRAME) {
      accumulator -= stepDt;
      steps += 1;
    }
    if (accumulator >= stepDt) accumulator = 0;

    if (steps > 0) {
      const stepCount = sim.getStepCount();
      while (pendingTestImpulses.length > 0 && Math.round(pendingTestImpulses[0].delay * SIM_STEP_HZ) <= stepCount) {
        const { x, y, radius, amplitude } = pendingTestImpulses.shift();
        sim.addImpulse(x, y, radius, amplitude);
      }

      const withInput = sim.hasQueuedInput();
      gpuTimer?.begin(withInput ? 'simInput' : 'sim');
      sim.advance(steps);
      gpuTimer?.end();
      if (withInput) {
        inputSimFrames += 1;
        inputSimSteps += steps;
      } else {
        idleSimFrames += 1;
        idleSimSteps += steps;
      }
    }

    viewUniforms.uState.value = sim.getTexture();
    elapsed += dt;
    if (viewUniforms.uTime) viewUniforms.uTime.value = elapsed;
    gpuTimer?.begin('debug');
    renderer.render(viewScene, camera);
    gpuTimer?.end();
    gpuTimer?.poll();

    framesSinceStats += 1;
    stepsSinceStats += steps;
    statsClock += dt;
    if (statsClock >= STATS_INTERVAL) {
      logStats(statsClock);
      statsClock = 0;
      framesSinceStats = 0;
      stepsSinceStats = 0;
    }
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
  loop.start();

  return {
    renderer,
    sim,
    dispose() {
      loop.stop();
      pointer.dispose();
      delete window.__fluidSim;
      unbindResize();
      unbindVisibility();
      clearTimeout(resizeTimer);
      sim.dispose();
      viewMesh.geometry.dispose();
      viewMesh.material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === root) {
        root.removeChild(renderer.domElement);
      }
    },
  };
}
