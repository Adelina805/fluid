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
import { CAUSTIC_RES_MODES, createCausticFieldPass } from './createCausticFieldPass.js';
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
  /**
   * Default drift rate per mode: warp-lattice units / s, or cell orbit cycles / s (similar apparent speed).
   * Warp default 0.06 (approved E3.5–E6 stack); override via `causticDriftSpeed=` on `?sim`.
   */
  driftSpeed: { off: 0, warp: 0.06, cells: 0.008 },
};

/** Stage E3 structural variants (dev comparison): 1 = one layer (E2), 2 = one layer + F3, 3 = two layers. */
export const CAUSTIC_VARIANTS = [1, 2, 3];

/**
 * Stage E3 structure constants (dev; live in `__fluidSim.uniforms`). Coupling is shared by all variants.
 */
export const CAUSTIC_STRUCTURE = {
  /** Approved production default (E3 Variant 3). Variant 1 remains via `causticVariant=1`. */
  variant: 3,
  /** Variants 2–3: line width as a fraction of the approved sharpness, hairline → thickest. */
  lineWidth: [0.12, 0.8],
  /** Variant 2: junction-node weight (primary line × its F3 − F2 continuation). */
  nodeGain: 1.4,
  /** Variant 2: secondary-strand weight; fraction of cells they subdivide. */
  strandGain: 0.46,
  strandCells: 0.35,
  /** Variant 3: second-layer lattice scale (legacy ×1.71), weight, and crossing weight (legacy values). */
  layer2Scale: 1.71,
  layer2Gain: 0.46,
  crossGain: 0.9,
};

/**
 * Stage E5 visual tuning — rebuilt caustics, Variant 3 + halfHybrid target only.
 * Applied after `applyCausticParams` (does not change `CAUSTIC_NET` or the public panel / legacy mesh).
 */
/** E5b: line-width span + mild warp only — no lattice coarsening or crossing attenuation. */
export const CAUSTIC_REBUILT_E5 = Object.freeze({
  intensityMul: 1.0,
  scaleMul: 1.0,
  sharpnessMul: 1.0,
  /** Curvier cells without spatial masking. */
  warpMul: 1.08,
  /** Hairline → broad ribbon (fraction of uCausticNetSharpness); structure gains from CAUSTIC_STRUCTURE. */
  lineWidth: Object.freeze([0.5, 1.22]),
});

/** Uniforms of the E3 structural variant (none for variant 1). */
function createStructureUniforms(variant) {
  const s = CAUSTIC_STRUCTURE;
  if (variant === 2) {
    return {
      uCausticLineWidth: { value: new Vector2(...s.lineWidth) },
      uCausticNodeGain: { value: s.nodeGain },
      uCausticStrandGain: { value: s.strandGain },
      uCausticStrandCells: { value: s.strandCells },
    };
  }
  if (variant === 3) {
    return {
      uCausticLineWidth: { value: new Vector2(...s.lineWidth) },
      uCausticLayer2Scale: { value: s.layer2Scale },
      uCausticLayer2Gain: { value: s.layer2Gain },
      uCausticCrossGain: { value: s.crossGain },
    };
  }
  return {};
}

/**
 * Rebuilt caustic network (Stage E): shader chunk, defines, uniforms at the approved defaults.
 * @param {Partial<typeof CAUSTIC_COUPLING> & { driftSpeed?: number }} coupling
 * @param {number} causticView Fold / concentration views (3, 4) also need the curvature.
 * @param {number} variant E3 structural variant (`CAUSTIC_VARIANTS`).
 */
function createCausticPath(coupling, causticView, variant) {
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
      CAUSTIC_VARIANT: String(variant),
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
      uCausticDriftPhase: { value: 0 },
      uCausticCurvature: { value: curvature?.texture ?? null },
      uTime: { value: 0 },
      ...createStructureUniforms(variant),
    },
    apply(u, params) {
      applyCausticParams(u, params);
      if (variant !== 3) return;
      const e5 = CAUSTIC_REBUILT_E5;
      u.uCausticNetIntensity.value *= e5.intensityMul;
      u.uCausticNetScale.value *= e5.scaleMul;
      u.uCausticNetSharpness.value *= e5.sharpnessMul;
      u.uCausticNetWarp.value *= e5.warpMul;
      if (u.uCausticLineWidth) {
        u.uCausticLineWidth.value.set(e5.lineWidth[0], e5.lineWidth[1]);
      }
    },
    curvature,
    summary: { variant, bend, maxTilt, foldLimit, conc, concGain, drift, driftSpeed },
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
 * @param {1 | 2 | 3} [options.causticVariant] E3 structural variant (rebuilt field only).
 * @param {'full' | 'half' | 'quarter' | 'halfHybrid'} [options.causticResolution] E4 field pass (approved default `halfHybrid`).
 * @param {ReturnType<import('../controls/params.js').createParams>} [options.params] Shared tunable state (production panel).
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
  causticVariant = CAUSTIC_STRUCTURE.variant,
  causticResolution = 'halfHybrid',
  devCaustics = null,
  params: externalParams = null,
}) {
  const causticPath = devCaustics
    ?? (caustics === 'new' ? createCausticPath(causticCoupling, causticView, causticVariant) : null);
  const useFieldPass = causticPath && causticResolution !== 'full' && CAUSTIC_RES_MODES.includes(causticResolution);
  const fieldHybrid = causticResolution === 'halfHybrid';
  const fieldScale = causticResolution === 'quarter' ? 0.25 : 0.5;
  if (fieldHybrid && causticVariant === 2) {
    console.warn('[sim] causticRes=halfHybrid falls back to shaped upsample for variant 2 (F3 strand data).');
  }
  const causticChunk = causticPath ? `${causticPath.chunk}\n` : '';
  const causticDefines = causticPath
    ? {
        ...causticPath.defines,
        ...(causticView ? { CAUSTIC_VIEW: String(causticView) } : {}),
        ...(useFieldPass ? { CAUSTIC_FIELD_TEX: '' } : {}),
        ...(useFieldPass && fieldHybrid && causticVariant !== 2 ? { CAUSTIC_PASS_HYBRID: '' } : {}),
      }
    : {};
  const material = new ShaderMaterial({
    vertexShader: fullscreenVertexShader,
    fragmentShader: `${simSurfaceShaderChunk}\n${causticChunk}${surfaceFragmentShader}`,
    uniforms: {
      ...causticPath?.uniforms,
      ...(useFieldPass ? { uCausticField: { value: null } } : {}),
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

  const params = externalParams ?? createParams();
  if (!externalParams) {
    applyPublicControls(createPublicControls(), params);
  }
  const syncShadingParams = (p) => {
    applyShadingParams(material.uniforms, p);
    causticPath?.apply(material.uniforms, p);
  };
  syncShadingParams(params);

  const mesh = new Mesh(new PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.name = 'simWaterComposite';
  const couplingSummary = causticPath?.summary
    ? { ...causticPath.summary, resolution: useFieldPass ? causticResolution : 'full' }
    : null;
  mesh.userData.causticCoupling = couplingSummary;
  mesh.userData.syncShadingParams = syncShadingParams;

  const curvature = causticPath?.curvature ?? null;
  const passUniforms = {
    uState: material.uniforms.uState,
    uGridSize: material.uniforms.uGridSize,
    uPadding: material.uniforms.uPadding,
    uNormalStrength: material.uniforms.uNormalStrength,
    uSimHeightScale: material.uniforms.uSimHeightScale,
    uWorldScale: material.uniforms.uWorldScale,
    ...causticPath?.uniforms,
  };
  const fieldPass = useFieldPass
    ? createCausticFieldPass({
        scale: fieldScale,
        hybrid: fieldHybrid && causticVariant !== 2,
        defines: causticPath.defines,
        uniforms: passUniforms,
        cubicHeight,
      })
    : null;
  if (fieldPass) material.uniforms.uCausticField.value = fieldPass.texture;

  /** Per-frame work before drawing (E2 curvature + optional E4 field pass). */
  mesh.userData.prepare = (renderer, stateTexture) => {
    curvature?.update(renderer, stateTexture);
    if (fieldPass) {
      const size = renderer.getDrawingBufferSize(new Vector2());
      fieldPass.update(renderer, size.x, size.y);
    }
  };
  mesh.userData.dispose = () => {
    curvature?.dispose();
    fieldPass?.dispose();
  };
  return mesh;
}
