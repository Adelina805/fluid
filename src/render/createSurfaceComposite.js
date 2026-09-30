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
import causticsShaderChunk from '../shaders/caustics.glsl?raw';
import fullscreenVertexShader from '../shaders/fullscreen.vert.glsl?raw';
import simSurfaceShaderChunk from '../shaders/sim/simSurface.glsl?raw';
import surfaceFragmentShader from '../shaders/surface.frag.glsl?raw';

/**
 * Sim height → approved surface-height units (the old `vHeight` range, where the
 * color thresholds `h·9` / `|h|·14` span about ±0.055). Dev only; retuned with idle / controls.
 */
export const SIM_HEIGHT_SCALE = 0.15;

/** Rebuilt caustic network (Stage E): shader chunk, define, uniforms at the approved defaults. */
function createCausticPath() {
  return {
    chunk: causticsShaderChunk,
    defines: { CAUSTICS_NEW: '' },
    uniforms: {
      uCausticNetIntensity: { value: 0 },
      uCausticNetScale: { value: 0 },
      uCausticNetSharpness: { value: 0 },
      uCausticNetWarp: { value: 0 },
      // Written by applyCausticParams; the rebuilt field has no independent animation yet.
      uCausticNetSpeed: { value: 0 },
      uCausticTint: { value: new Color() },
      uCausticHot: { value: new Color() },
    },
    apply: applyCausticParams,
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
 * @param {0 | 1 | 2} [options.causticView] With caustics on: 1 = caustic light only (on black), 2 = raw network.
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
  devCaustics = null,
}) {
  const causticPath = devCaustics ?? (caustics === 'new' ? createCausticPath() : null);
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
  return mesh;
}
