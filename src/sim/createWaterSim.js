import {
  ClampToEdgeWrapping,
  Color,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector4,
  WebGLRenderTarget,
} from 'three';
import fullscreenVertexShader from '../shaders/fullscreen.vert.glsl?raw';
import simStepFragmentShader from '../shaders/sim/simStep.frag.glsl?raw';
import { advanceIdleTime, applyIdleParams, createIdleUniforms } from './idleSource.js';

/** Visible sim texels on the long screen axis; the short axis is aspect-matched. */
export const SIM_RESOLUTION = 256;

/** Off-screen absorbing margin (texels) on every side of the visible area. */
export const SIM_EDGE_PADDING = 48;

/** Fixed simulation rate; independent of display refresh. */
export const SIM_STEP_HZ = 60;

/** Upper bound on catch-up steps in one frame; excess time is dropped. */
export const MAX_STEPS_PER_FRAME = 4;

/** Wave-front travel in texels per step. Stability limit ≈ 0.86 for the 9-point stencil. */
export const WAVE_COURANT = 0.5;

/** Per-step velocity multiplier in the visible area. */
export const VELOCITY_DAMPING = 0.996;

/** Per-step height multiplier pulling the surface back to rest. */
export const HEIGHT_RELAX = 0.9995;

/**
 * Per-step height/velocity multiplier at the outermost sponge texel. Stronger
 * values reflect off the ramp; weaker ones let waves bounce off the grid edge.
 */
export const SPONGE_DAMPING = 0.96;

/** NaN/Inf containment bound on |height| and |velocity|. */
export const STATE_CLAMP = 8;

/** Movement segments applied per step; must match `MAX_SEGMENTS` in the step shader. */
export const MAX_SEGMENTS = 16;

/** Height impulses applied per step; extras carry over to the next step. */
export const MAX_IMPULSES = 4;

/**
 * Rim radius / brush radius. Each disturbance is a push-down core with a wider,
 * shallower raised rim of equal volume, so input never adds net water.
 */
export const RIM_SCALE = 2.0;

/**
 * Movement brushes add less where the surface is already displaced their way by
 * more than this × their strength (limits resonance at about wave speed).
 */
export const PUSH_DEPTH = 2.0;

/** Endpoints closer than this (texels) count as the same point when joining segments. */
const JOIN_EPSILON = 1e-3;

/**
 * Queued input older than this (ms) is dropped at flush. If the step loop stalls
 * while events keep arriving, a backlog would otherwise land in one step all at once.
 */
const MAX_INPUT_AGE_MS = 250;

/** Hard cap on queued segments (oldest dropped first); bounds memory during stalls. */
const MAX_QUEUED_SEGMENTS = 512;

/**
 * @param {import('three').WebGLRenderer} renderer
 */
export function supportsSimTargets(renderer) {
  return (
    renderer.extensions.has('EXT_color_buffer_float') ||
    renderer.extensions.has('EXT_color_buffer_half_float')
  );
}

function createStateTarget(width, height) {
  return new WebGLRenderTarget(width, height, {
    type: HalfFloatType,
    format: RGBAFormat,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    wrapS: ClampToEdgeWrapping,
    wrapT: ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  });
}

/**
 * Low-res ping-pong heightfield (R = height, G = velocity).
 * @param {import('three').WebGLRenderer} renderer
 * @param {{ idleSource?: boolean }} [options] compile idle velocity forcing (dev water view)
 */
export function createWaterSim(renderer, options = {}) {
  const compileIdleSource = options.idleSource === true;
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const stepUniforms = {
      uState: { value: null },
      uGridSize: { value: new Vector2(1, 1) },
      uPadding: { value: SIM_EDGE_PADDING },
      uCourant2: { value: WAVE_COURANT * WAVE_COURANT },
      uVelocityDamping: { value: VELOCITY_DAMPING },
      uHeightRelax: { value: HEIGHT_RELAX },
      uSpongeDamping: { value: SPONGE_DAMPING },
      uStateClamp: { value: STATE_CLAMP },
      uSegmentEnds: { value: Array.from({ length: MAX_SEGMENTS }, () => new Vector4()) },
      uSegmentShape: { value: Array.from({ length: MAX_SEGMENTS }, () => new Vector4(1, 1, 0, 0)) },
      uSegmentCount: { value: 0 },
      uImpulses: { value: Array.from({ length: MAX_IMPULSES }, () => new Vector4(0, 0, 1, 0)) },
      uImpulseCount: { value: 0 },
      uRimScale: { value: RIM_SCALE },
      uPushDepth: { value: PUSH_DEPTH },
  };
  if (compileIdleSource) Object.assign(stepUniforms, createIdleUniforms());

  const material = new ShaderMaterial({
    vertexShader: fullscreenVertexShader,
    fragmentShader: simStepFragmentShader,
    uniforms: stepUniforms,
    defines: {
      MAX_SEGMENTS,
      MAX_IMPULSES,
      ...(compileIdleSource ? { IDLE_SOURCE: '' } : {}),
    },
    depthTest: false,
    depthWrite: false,
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new Scene();
  scene.add(quad);

  /** @type {WebGLRenderTarget[]} */
  let targets = [];
  let readIndex = 0;
  let stepCount = 0;
  let width = 1;
  let height = 1;
  let visibleWidth = 1;
  let visibleHeight = 1;
  /** @type {Uint16Array | null} */
  let readbackBuffer = null;

  /**
   * Disturbances waiting for the next step. Positions are visible-area UV (y up);
   * `time` is when the item was queued (ms).
   * @type {{ ax: number, ay: number, bx: number, by: number, radius: number, alongRadius: number, strength: number, time: number }[]}
   */
  let segmentQueue = [];
  /** @type {{ x: number, y: number, radius: number, amplitude: number, time: number }[]} */
  let impulseQueue = [];
  let segmentsApplied = 0;
  let impulsesApplied = 0;

  const savedClearColor = new Color();

  function clearTargets() {
    const previousTarget = renderer.getRenderTarget();
    renderer.getClearColor(savedClearColor);
    const savedClearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    for (const target of targets) {
      renderer.setRenderTarget(target);
      renderer.clear(true, false, false);
    }
    renderer.setClearColor(savedClearColor, savedClearAlpha);
    renderer.setRenderTarget(previousTarget);
  }

  /**
   * Rebuild the grid for a new viewport aspect; state resets to flat water.
   * @param {number} viewWidth
   * @param {number} viewHeight
   */
  function resize(viewWidth, viewHeight) {
    const aspect = viewWidth / Math.max(viewHeight, 1);
    if (aspect >= 1) {
      visibleWidth = SIM_RESOLUTION;
      visibleHeight = Math.max(1, Math.round(SIM_RESOLUTION / aspect));
    } else {
      visibleHeight = SIM_RESOLUTION;
      visibleWidth = Math.max(1, Math.round(SIM_RESOLUTION * aspect));
    }
    width = visibleWidth + 2 * SIM_EDGE_PADDING;
    height = visibleHeight + 2 * SIM_EDGE_PADDING;

    for (const target of targets) target.dispose();
    targets = [createStateTarget(width, height), createStateTarget(width, height)];
    readIndex = 0;
    stepCount = 0;
    readbackBuffer = new Uint16Array(width * height * 4);
    material.uniforms.uGridSize.value.set(width, height);
    clearTargets();
    segmentQueue = [];
    impulseQueue = [];
  }

  /**
   * Queue a movement segment. Each texel along the path receives `strength` of
   * vertical velocity in total, however the path is split into segments.
   * @param {number} ax start, visible-area UV
   * @param {number} ay
   * @param {number} bx end, visible-area UV
   * @param {number} by
   * @param {{ radius: number, alongRadius: number, strength: number }} shape
   *   Brush radii across and along travel, in texels.
   */
  function addSegment(ax, ay, bx, by, { radius, alongRadius, strength }) {
    segmentQueue.push({ ax, ay, bx, by, radius, alongRadius, strength, time: performance.now() });
    if (segmentQueue.length > MAX_QUEUED_SEGMENTS) segmentQueue.shift();
  }

  /**
   * Queue a Gaussian height impulse (click / tap).
   * @param {number} x visible-area UV
   * @param {number} y
   * @param {number} radius texels
   * @param {number} amplitude height at the center
   */
  function addImpulse(x, y, radius, amplitude) {
    impulseQueue.push({ x, y, radius, amplitude, time: performance.now() });
  }

  const toTexelX = (u) => SIM_EDGE_PADDING + u * visibleWidth;
  const toTexelY = (v) => SIM_EDGE_PADDING + v * visibleHeight;

  /**
   * Fit the shader budget in one pass: consecutive connected segments are joined
   * into chords, in evenly sized groups; strength is length-weighted. If separate
   * strokes still overflow, the oldest are dropped.
   * @param {{ ax: number, ay: number, bx: number, by: number, radius: number, alongRadius: number, strength: number, length: number }[]} segments
   */
  function fitSegmentBudget(segments) {
    if (segments.length <= MAX_SEGMENTS) return segments;

    const groupSize = Math.ceil(segments.length / MAX_SEGMENTS);
    const joined = [];
    let group = null;
    let groupCount = 0;
    let weightedStrength = 0;
    let pathLength = 0;

    const closeGroup = () => {
      if (!group) return;
      group.strength = pathLength > 1e-6 ? weightedStrength / pathLength : group.strength;
      joined.push(group);
    };

    for (const s of segments) {
      const connects =
        group &&
        groupCount < groupSize &&
        Math.abs(group.bx - s.ax) < JOIN_EPSILON &&
        Math.abs(group.by - s.ay) < JOIN_EPSILON;
      if (connects) {
        group.bx = s.bx;
        group.by = s.by;
        group.radius = Math.max(group.radius, s.radius);
        group.alongRadius = Math.max(group.alongRadius, s.alongRadius);
        groupCount += 1;
      } else {
        closeGroup();
        group = { ...s };
        groupCount = 1;
        weightedStrength = 0;
        pathLength = 0;
      }
      weightedStrength += s.strength * s.length;
      pathLength += s.length;
    }
    closeGroup();

    return joined.length > MAX_SEGMENTS ? joined.slice(-MAX_SEGMENTS) : joined;
  }

  /** Move queued disturbances into the step uniforms (empties the segment queue). */
  function flushQueues() {
    const uniforms = material.uniforms;
    const oldest = performance.now() - MAX_INPUT_AGE_MS;
    segmentQueue = segmentQueue.filter((s) => s.time >= oldest);
    impulseQueue = impulseQueue.filter((p) => p.time >= oldest);

    const segments = fitSegmentBudget(
      segmentQueue.map((s) => {
        const ax = toTexelX(s.ax);
        const ay = toTexelY(s.ay);
        const bx = toTexelX(s.bx);
        const by = toTexelY(s.by);
        return { ...s, ax, ay, bx, by, length: Math.hypot(bx - ax, by - ay) };
      }),
    );
    segmentQueue = [];
    segments.forEach((s, i) => {
      uniforms.uSegmentEnds.value[i].set(s.ax, s.ay, s.bx, s.by);
      uniforms.uSegmentShape.value[i].set(s.radius, s.alongRadius, s.strength, 0);
    });
    uniforms.uSegmentCount.value = segments.length;
    segmentsApplied += segments.length;

    const impulses = impulseQueue.slice(0, MAX_IMPULSES);
    impulseQueue = impulseQueue.slice(MAX_IMPULSES);
    impulses.forEach((p, i) => {
      uniforms.uImpulses.value[i].set(toTexelX(p.x), toTexelY(p.y), p.radius, p.amplitude);
    });
    uniforms.uImpulseCount.value = impulses.length;
    impulsesApplied += impulses.length;
  }

  function clearStepUniforms() {
    material.uniforms.uSegmentCount.value = 0;
    material.uniforms.uImpulseCount.value = 0;
  }

  const hasQueuedInput = () => segmentQueue.length > 0 || impulseQueue.length > 0;

  /** Advance one fixed step: read → write, then swap. */
  function step() {
    const read = targets[readIndex];
    const write = targets[1 - readIndex];
    material.uniforms.uState.value = read.texture;
    renderer.setRenderTarget(write);
    renderer.render(scene, camera);

    readIndex = 1 - readIndex;
    stepCount += 1;
  }

  /**
   * Run `count` fixed steps. Queued input lands on the first one only, so
   * catch-up frames do not multiply the injected energy.
   * @param {number} count
   */
  function advance(count) {
    if (count <= 0) return;
    const previousTarget = renderer.getRenderTarget();
    for (let i = 0; i < count; i += 1) {
      if (i === 0 || impulseQueue.length > 0) flushQueues();
      step();
      clearStepUniforms();
      if (compileIdleSource) advanceIdleTime(material.uniforms.uIdleTime, 1, SIM_STEP_HZ);
    }
    renderer.setRenderTarget(previousTarget);
  }

  /** Segments / impulses applied since the last call (dev stats). */
  function takeInputCounts() {
    const counts = { segments: segmentsApplied, impulses: impulsesApplied };
    segmentsApplied = 0;
    impulsesApplied = 0;
    return counts;
  }

  /**
   * Dev-only synchronous readback of the current state (stalls the GPU).
   * Energy is the discrete wave energy: velocity² + C²·|∇h|².
   */
  function readStats() {
    renderer.readRenderTargetPixels(targets[readIndex], 0, 0, width, height, readbackBuffer);
    const c2 = WAVE_COURANT * WAVE_COURANT;
    let maxHeight = 0;
    let maxVelocity = 0;
    let energy = 0;
    let nanCount = 0;
    const heightAt = (x, y) => DataUtils.fromHalfFloat(readbackBuffer[(y * width + x) * 4]);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        const h = DataUtils.fromHalfFloat(readbackBuffer[i]);
        const v = DataUtils.fromHalfFloat(readbackBuffer[i + 1]);
        if (!Number.isFinite(h) || !Number.isFinite(v)) {
          nanCount += 1;
          continue;
        }
        maxHeight = Math.max(maxHeight, Math.abs(h));
        maxVelocity = Math.max(maxVelocity, Math.abs(v));
        const dx = x + 1 < width ? heightAt(x + 1, y) - h : 0;
        const dy = y + 1 < height ? heightAt(x, y + 1) - h : 0;
        energy += v * v + c2 * (dx * dx + dy * dy);
      }
    }
    return { maxHeight, maxVelocity, energy, nanCount };
  }

  return {
    resize,
    advance,
    addSegment,
    addImpulse,
    hasQueuedInput,
    takeInputCounts,
    readStats,
    /** Dev: tune idle forcing (requires `idleSource: true` at creation). */
    applyIdle(overrides, motionScale = 1) {
      if (!compileIdleSource) return;
      applyIdleParams(material, overrides, motionScale);
    },
    getStepMaterial: () => material,
    getTexture: () => targets[readIndex].texture,
    getReadIndex: () => readIndex,
    getStepCount: () => stepCount,
    getGridSize: () => ({ width, height, visibleWidth, visibleHeight }),
    dispose() {
      for (const target of targets) target.dispose();
      quad.geometry.dispose();
      material.dispose();
    },
  };
}
