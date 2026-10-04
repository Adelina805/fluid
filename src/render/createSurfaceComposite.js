import { Color, Mesh, PlaneGeometry, ShaderMaterial, Vector2, Vector3 } from 'three';
import {
  LIGHT,
  NOISE_COLOR_INFLUENCE,
  OPTICS,
  SLOPE_INFLUENCE,
} from './createWaterMesh.js';
import {
  applyCausticParams,
  applyPublicControls,
  applyShadingParams,
  createParams,
  createPublicControls,
} from '../controls/params.js';
import { createCausticCurvature } from './createCausticCurvature.js';
import causticsShaderChunk from '../shaders/caustics.glsl?raw';
import fullscreenVertexShader from '../shaders/fullscreen.vert.glsl?raw';
import simSurfaceShaderChunk from '../shaders/sim/simSurface.glsl?raw';
import surfaceFragmentShader from '../shaders/surface.frag.glsl?raw';

/**
 * Sim height → approved surface-height units (the old `vHeight` range, where the
 * color thresholds `h·9` / `|h|·14` span about ±0.055). Dev only; retuned with idle / controls.
 */
export const SIM_HEIGHT_SCALE = 0.15;

/** Independent caustic animation (Stage E2): none, slow warp-domain drift, slow cell motion. */
export const CAUSTIC_DRIFT_MODES = ['off', 'warp', 'cells'];

/**
 * Stage E2 surface coupling of the rebuilt caustics (dev defaults; `caustic*=` URL overrides).
 * A zero bend / concentration or drift `off` compiles that part out (all off = the E1 field).
 */
export const CAUSTIC_COUPLING = {
  /**
   * Lookup offset in Worley-cell units per unit of sim-normal tilt (N.xy). Above ~0.2 the fine
   * dispersive trains / drag beading in the normal fold the web along wake rims (flipped bands).
   */
  bend: 0.2,
  /** Tilt the bend saturates toward (|N.xy| ≈ 0.34 for a fresh tap ring, ≈ 0.67 for a fast stroke). */
  maxTilt: 0.3,
  /** Largest |1 − det J| from smoothed curvature before the offset is scaled down (narrow wakes, fresh taps). */
  foldLimit: 0.7,
  /** Concentration strength: converging water → brighter / wider lines, diverging → weaker. */
  conc: 2.0,
  /** Smoothed sim-height Laplacian (per texel²) → concentration signal before its soft clamp. */
  concGain: 120,
  drift: 'warp',
  /** Default drift rate per mode: warp-lattice units / s, or cell orbit cycles / s (similar apparent speed). */
  driftSpeed: { off: 0, warp: 0.015, cells: 0.008 },
};

/**
 * Rebuilt caustic network (Stage E): shader chunk, defines, uniforms at the approved defaults.
 * @param {Partial<typeof CAUSTIC_COUPLING> & { driftSpeed?: number }} coupling
 * @param {number} causticView Fold / concentration views (3, 4) also need the curvature.
 */
function createCausticPath(coupling, causticView) {
  const { bend, maxTilt, foldLimit, conc, concGain, drift } = { ...CAUSTIC_COUPLING, ...coupling };
  const driftSpeed = typeof coupling.driftSpeed === 'number'
    ? coupling.driftSpeed
    : CAUSTIC_COUPLING.driftSpeed[drift];
  const driftIndex = Math.max(CAUSTIC_DRIFT_MODES.indexOf(drift), 0);
  const curvature = bend > 0 || conc > 0 || causticView >= 3 ? createCausticCurvature() : null;
  return {
    chunk: causticsShaderChunk,
    defines: {
      CAUSTICS_NEW: '',
      ...(bend > 0 ? { CAUSTIC_BEND: '' } : {}),
      ...(conc > 0 ? { CAUSTIC_CONC: '' } : {}),
      ...(driftIndex > 0 ? { CAUSTIC_DRIFT: String(driftIndex) } : {}),
    },
    uniforms: {
      uCausticNetIntensity: { value: 0 },
      uCausticNetScale: { value: 0 },
      uCausticNetSharpness: { value: 0 },
      uCausticNetWarp: { value: 0 },
      // Written by applyCausticParams; unused by the rebuilt field (drift has its own rate).
      uCausticNetSpeed: { value: 0 },
      uCausticTint: { value: new Color() },
      uCausticHot: { value: new Color() },
      uCausticBend: { value: bend },
      uCausticMaxTilt: { value: maxTilt },
      uCausticFoldLimit: { value: foldLimit },
      uCausticConc: { value: conc },
      uCausticConcGain: { value: concGain },
      uCausticDriftSpeed: { value: driftSpeed },
      uCausticCurvature: { value: curvature?.texture ?? null },
      uTime: { value: 0 },
    },
    apply: applyCausticParams,
    curvature,
    summary: { bend, maxTilt, foldLimit, conc, concGain, drift, driftSpeed },
  };
}

/**
 * Full-screen water composite driven by the persistent simulation (Stage D, `?sim&water`).
 * Shading uniforms come from the same public-default mapping as the legacy water mesh.
 *
 * @param {object} options
 * @param {number} options.padding Sponge margin width in texels.
 * @param {number} options.normalStrength Shared with the normal debug view.
 * @param {number} [options.debugOptics] 0 = composite; 1–4 = Fresnel / distortion / albedo / lighting.
 * @param {boolean} [options.cubicHeight] Cubic B-spline height sampling (default); false = bilinear.
 * @param {'off' | 'new'} [options.caustics] Rebuilt caustic network (Stage E); off by default.
 * @param {0 | 1 | 2 | 3 | 4} [options.causticView] With caustics on: 1 = caustic light only (on black),
 *   2 = raw network; rebuilt field only: 3 = fold view, 4 = concentration view.
 * @param {object} [options.causticCoupling] Overrides for `CAUSTIC_COUPLING` (rebuilt field only).
 * @param {{ chunk: string, defines: object, uniforms: object, apply: Function }} [options.devCaustics]
 *   Dev-only caustic comparison path (Stage E0 harness); replaces `caustics`; absent in normal use.
 */
export function createSurfaceComposite({
  padding,
  normalStrength,
  debugOptics = 0,
  cubicHeight = true,
  caustics = 'off',
  causticView = 0,
  causticCoupling = {},
  devCaustics = null,
}) {
  const causticPath = devCaustics ?? (caustics === 'new' ? createCausticPath(causticCoupling, causticView) : null);
  const causticChunk = causticPath ? `${causticPath.chunk}\n` : '';
  const causticDefines = causticPath
    ? { ...causticPath.defines, ...(causticView ? { CAUSTIC_VIEW: String(causticView) } : {}) }
    : {};
  const material = new ShaderMaterial({
    vertexShader: fullscreenVertexShader,
    fragmentShader: `${simSurfaceShaderChunk}\n${causticChunk}${surfaceFragmentShader}`,
    uniforms: {
      ...causticPath?.uniforms,
      uState: { value: null },
      uGridSize: { value: new Vector2(1, 1) },
      uPadding: { value: padding },
      uNormalStrength: { value: normalStrength },
      uSimHeightScale: { value: SIM_HEIGHT_SCALE },
      uWorldScale: { value: new Vector2(1, 1) },

      uColorDeep: { value: new Color() },
      uColorMid: { value: new Color() },
      uColorShallow: { value: new Color() },
      uSlopeInfluence: { value: SLOPE_INFLUENCE },
      uNoiseColorInfluence: { value: NOISE_COLOR_INFLUENCE },

      uLightDir: { value: LIGHT.dir.clone() },
      uLightColor: { value: new Color() },
      uAmbient: { value: new Color() },
      uSpecularColor: { value: LIGHT.specularColor.clone() },
      uSpecularStrength: { value: LIGHT.specularStrength },
      uShininess: { value: LIGHT.shininess },
      uShininessNarrow: { value: LIGHT.shininessNarrow },
      uSpecularNarrowStrength: { value: LIGHT.specularNarrowStrength },
      uCameraPosition: { value: new Vector3(0, 0, 2) },
      uCausticSoftStrength: { value: LIGHT.causticSoftStrength },

      uFresnelF0: { value: OPTICS.fresnelF0 },
      uFresnelPower: { value: OPTICS.fresnelPower },
      uFresnelStrength: { value: OPTICS.fresnelStrength },
      uFresnelViewContrast: { value: OPTICS.fresnelViewContrast },
      uOpticalBalance: { value: OPTICS.opticalBalance },
      uDistortionStrength: { value: OPTICS.distortionStrength },
      uColorDepthStrength: { value: OPTICS.colorDepthStrength },
      uDebugOptics: { value: debugOptics },
    },
    defines: { ...(cubicHeight ? { SIM_CUBIC: '' } : {}), ...causticDefines },
    depthTest: false,
    depthWrite: false,
  });

  const params = createParams();
  applyPublicControls(createPublicControls(), params);
  applyShadingParams(material.uniforms, params);
  causticPath?.apply(material.uniforms, params);

  const mesh = new Mesh(new PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.name = 'simWaterComposite';
  mesh.userData.causticCoupling = causticPath?.summary ?? null;
  const curvature = causticPath?.curvature ?? null;
  /** Per-frame work before drawing (Stage E2 curvature from the current sim state). */
  mesh.userData.prepare = (renderer, stateTexture) => curvature?.update(renderer, stateTexture);
  mesh.userData.dispose = () => curvature?.dispose();
  return mesh;
}
