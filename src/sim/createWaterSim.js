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

/**
 * Hard-coded Stage A test disturbances, each fired once.
 * `delay` in seconds of sim time; `x` / `y` in visible-area UV (y up); `radius` in texels.
 */
export const TEST_IMPULSES = [
  { delay: 0, x: 0.5, y: 0.5, radius: 6, amplitude: 1.0 },
  { delay: 1.5, x: 0.63, y: 0.4, radius: 6, amplitude: 1.0 },
];

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
 */
export function createWaterSim(renderer) {
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const material = new ShaderMaterial({
    vertexShader: fullscreenVertexShader,
    fragmentShader: simStepFragmentShader,
    uniforms: {
      uState: { value: null },
      uGridSize: { value: new Vector2(1, 1) },
      uPadding: { value: SIM_EDGE_PADDING },
      uCourant2: { value: WAVE_COURANT * WAVE_COURANT },
      uVelocityDamping: { value: VELOCITY_DAMPING },
      uHeightRelax: { value: HEIGHT_RELAX },
      uSpongeDamping: { value: SPONGE_DAMPING },
      uStateClamp: { value: STATE_CLAMP },
      uImpulse: { value: new Vector4(0, 0, 1, 0) },
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
  }

  function scheduledImpulse() {
    for (const impulse of TEST_IMPULSES) {
      if (Math.round(impulse.delay * SIM_STEP_HZ) === stepCount) return impulse;
    }
    return null;
  }

  /** Advance one fixed step: read → write, then swap. */
  function step() {
    const impulse = scheduledImpulse();
    const impulseUniform = material.uniforms.uImpulse.value;
    if (impulse) {
      impulseUniform.set(
        SIM_EDGE_PADDING + impulse.x * visibleWidth,
        SIM_EDGE_PADDING + impulse.y * visibleHeight,
        impulse.radius,
        impulse.amplitude,
      );
    } else {
      impulseUniform.w = 0;
    }

    const read = targets[readIndex];
    const write = targets[1 - readIndex];
    material.uniforms.uState.value = read.texture;
    renderer.setRenderTarget(write);
    renderer.render(scene, camera);

    readIndex = 1 - readIndex;
    stepCount += 1;
  }

  /** @param {number} count */
  function advance(count) {
    if (count <= 0) return;
    const previousTarget = renderer.getRenderTarget();
    for (let i = 0; i < count; i += 1) step();
    renderer.setRenderTarget(previousTarget);
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
    readStats,
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
