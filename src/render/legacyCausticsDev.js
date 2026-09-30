import { Color } from 'three';
import { applyCausticParams } from '../controls/params.js';
import causticsLegacyChunk from '../shaders/causticsLegacy.glsl?raw';

/**
 * Stage E0 comparison harness (dev only, `?sim&water&caustics=legacy`): the legacy Phase 6.5
 * caustic network ported onto the sim composite at the approved default parameters.
 * Imported only by the `?sim` debug app; retired together with the legacy pipeline.
 *
 * @param {object} options
 * @param {0 | 1 | 2} [options.view] 0 = composite; 1 = caustic light only; 2 = raw network.
 */
export function createLegacyCausticsDev({ view = 0 } = {}) {
  const defines = { CAUSTICS_LEGACY: '' };
  if (view) defines.CAUSTIC_VIEW = String(view);

  return {
    chunk: causticsLegacyChunk,
    defines,
    uniforms: {
      uTime: { value: 0 },
      uCausticNetIntensity: { value: 0 },
      uCausticNetScale: { value: 0 },
      uCausticNetSharpness: { value: 0 },
      uCausticNetWarp: { value: 0 },
      uCausticNetSpeed: { value: 0 },
      uCausticTint: { value: new Color() },
      uCausticHot: { value: new Color() },
    },
    /** Same mapping as the legacy mesh (`applyParams`); expects palette uniforms already set. */
    apply: applyCausticParams,
  };
}
