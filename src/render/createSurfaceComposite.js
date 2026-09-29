import { Color, Mesh, PlaneGeometry, ShaderMaterial, Vector2, Vector3 } from 'three';
import {
  LIGHT,
  NOISE_COLOR_INFLUENCE,
  OPTICS,
  SLOPE_INFLUENCE,
} from './createWaterMesh.js';
import {
  applyPublicControls,
  applyShadingParams,
  createParams,
  createPublicControls,
} from '../controls/params.js';
import fullscreenVertexShader from '../shaders/fullscreen.vert.glsl?raw';
import simSurfaceShaderChunk from '../shaders/sim/simSurface.glsl?raw';
import surfaceFragmentShader from '../shaders/surface.frag.glsl?raw';

/**
 * Sim height → approved surface-height units (the old `vHeight` range, where the
 * color thresholds `h·9` / `|h|·14` span about ±0.055). Dev only; retuned with idle / controls.
 */
export const SIM_HEIGHT_SCALE = 0.15;

/**
 * Full-screen water composite driven by the persistent simulation (Stage D, `?sim&water`).
 * Shading uniforms come from the same public-default mapping as the legacy water mesh.
 *
 * @param {object} options
 * @param {number} options.padding Sponge margin width in texels.
 * @param {number} options.normalStrength Shared with the normal debug view.
 * @param {number} [options.debugOptics] 0 = composite; 1–4 = Fresnel / distortion / albedo / lighting.
 * @param {boolean} [options.cubicHeight] Cubic B-spline height sampling (default); false = bilinear.
 */
export function createSurfaceComposite({ padding, normalStrength, debugOptics = 0, cubicHeight = true }) {
  const material = new ShaderMaterial({
    vertexShader: fullscreenVertexShader,
    fragmentShader: `${simSurfaceShaderChunk}\n${surfaceFragmentShader}`,
    uniforms: {
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
    defines: cubicHeight ? { SIM_CUBIC: '' } : {},
    depthTest: false,
    depthWrite: false,
  });

  const params = createParams();
  applyPublicControls(createPublicControls(), params);
  applyShadingParams(material.uniforms, params);

  const mesh = new Mesh(new PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.name = 'simWaterComposite';
  return mesh;
}
