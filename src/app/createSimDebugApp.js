import { Mesh, PlaneGeometry, Scene, ShaderMaterial, Vector2, WebGLRenderer } from 'three';
import { bindResize } from './resize.js';
import { bindVisibility } from './visibility.js';
import { createTopDownCamera } from '../render/camera.js';
import { COLOR_DEEP } from '../render/createWaterMesh.js';
import {
  MAX_STEPS_PER_FRAME,
  SIM_EDGE_PADDING,
  SIM_STEP_HZ,
  createWaterSim,
  supportsSimTargets,
} from '../sim/createWaterSim.js';
import fullscreenVertexShader from '../shaders/fullscreen.vert.glsl?raw';
import simDebugFragmentShader from '../shaders/simDebug.frag.glsl?raw';

/** Height → grayscale multiplier for the debug view (`?gain=` overrides). */
const DEBUG_GAIN = 2.5;

/** Seconds between console stat lines. */
const STATS_INTERVAL = 2;

/** Largest frame delta fed to the accumulator (seconds). */
const MAX_FRAME_DT = 0.1;

/** Resize settle time before the sim grid is rebuilt (ms). */
const RESIZE_DEBOUNCE_MS = 150;

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
 * Stage A `?sim` entry: low-res wave simulation shown as a grayscale height view.
 * Independent of the approved water mesh, pointer, and control panel.
 *
 * Dev URL options: `debugPadding` (show sponge margin), `gain=<n>`, `simFps=<n>` (throttle render loop).
 * @param {HTMLElement} root
 */
export function createSimDebugApp(root) {
  const query = new URLSearchParams(window.location.search);
  const showPadding = query.has('debugPadding');
  const gain = Number(query.get('gain')) || DEBUG_GAIN;
  const throttleFps = Number(query.get('simFps')) || 0;

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

  const debugMaterial = new ShaderMaterial({
    vertexShader: fullscreenVertexShader,
    fragmentShader: simDebugFragmentShader,
    uniforms: {
      uState: { value: null },
      uGridSize: { value: new Vector2(1, 1) },
      uPadding: { value: SIM_EDGE_PADDING },
      uGain: { value: gain },
      uShowPadding: { value: showPadding ? 1 : 0 },
    },
    depthTest: false,
    depthWrite: false,
  });
  const debugQuad = new Mesh(new PlaneGeometry(2, 2), debugMaterial);
  debugQuad.frustumCulled = false;
  const debugScene = new Scene();
  debugScene.add(debugQuad);

  const rebuildSim = () => {
    sim.resize(window.innerWidth, window.innerHeight);
    const { width, height, visibleWidth, visibleHeight } = sim.getGridSize();
    debugMaterial.uniforms.uGridSize.value.set(width, height);
    console.info(
      `[sim] grid ${visibleWidth}×${visibleHeight} visible + ${SIM_EDGE_PADDING}px sponge = ${width}×${height} texels (RGBA half-float)`,
    );
  };

  let resizeTimer = 0;
  let initialized = false;
  const unbindResize = bindResize(renderer, camera, () => {
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
  let statsClock = 0;
  let framesSinceStats = 0;
  let stepsSinceStats = 0;
  let simFramesSinceStats = 0;

  function logStats(seconds) {
    const readIndex = sim.getReadIndex();
    const stepCount = sim.getStepCount();
    const alternating = readIndex === stepCount % 2;
    const gpu = gpuTimer ? gpuTimer.takeAverages() : {};
    const { maxHeight, maxVelocity, energy, nanCount } = sim.readStats();
    const stats = {
      fps: framesSinceStats / seconds,
      stepsPerSecond: stepsSinceStats / seconds,
      stepCount,
      reading: readIndex === 0 ? 'A' : 'B',
      alternating,
      gpuSimMsPerFrame: gpu.sim ?? null,
      gpuSimMsPerStep: gpu.sim != null ? (gpu.sim * simFramesSinceStats) / Math.max(stepsSinceStats, 1) : null,
      gpuDebugMs: gpu.debug ?? null,
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
        // The first query of a frame also absorbs frame-start overhead, so this is an upper bound.
        ` | GPU sim ≤${ms(stats.gpuSimMsPerStep)}/step, debug ${ms(stats.gpuDebugMs)}` +
        ` | max|h| ${maxHeight.toFixed(4)} max|v| ${maxVelocity.toFixed(4)} energy ${energy.toExponential(2)} NaN ${nanCount}`,
    );
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
      gpuTimer?.begin('sim');
      sim.advance(steps);
      gpuTimer?.end();
      simFramesSinceStats += 1;
    }

    debugMaterial.uniforms.uState.value = sim.getTexture();
    gpuTimer?.begin('debug');
    renderer.render(debugScene, camera);
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
      simFramesSinceStats = 0;
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
      unbindResize();
      unbindVisibility();
      clearTimeout(resizeTimer);
      sim.dispose();
      debugQuad.geometry.dispose();
      debugMaterial.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === root) {
        root.removeChild(renderer.domElement);
      }
    },
  };
}
