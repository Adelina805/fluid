import { Color } from 'three';
import {
  COLOR_DEEP,
  COLOR_MID,
  COLOR_SHALLOW,
  WAVE_A,
  WAVE_B,
  WAVE_C,
  WAVE_D,
  NOISE,
  LIGHT,
  OPTICS,
  INTERACTION,
} from '../render/createWaterMesh.js';

/**
 * Relative HSL offsets from the Phase 3–5 deep anchor (#2a7a9c)
 * that reproduce the approved mid / shallow stops at warmCool = 0.
 */
const MID_OFFSET = {
  h: 0.5399449035812672 - 0.5497076023391813,
  s: 0.4898785425101214 - 0.5757575757575758,
  l: 0.4843137254901961 - 0.38823529411764707,
};

const SHALLOW_OFFSET = {
  h: 0.5253968253968254 - 0.5497076023391813,
  s: 0.5497382198952881 - 0.5757575757575758,
  l: 0.6254901960784314 - 0.38823529411764707,
};

/** Scratch colors reused by applyParams (no per-frame allocation). */
const _deep = new Color();
const _mid = new Color();
const _shallow = new Color();
const _light = new Color();
const _ambient = new Color();

/**
 * Stage A / public-candidate tunable state.
 * Defaults match the approved Phase 5 visual + interaction feel exactly
 * (multipliers at 1; absolute values copied from createWaterMesh constants).
 */
export const PARAM_DEFAULTS = Object.freeze({
  // MOTION
  motionSpeed: 1,
  motionAmplitude: 1,
  turbulence: 1,

  // OPTICS
  opticalBalance: OPTICS.opticalBalance,
  fresnelStrength: OPTICS.fresnelStrength,
  fresnelViewContrast: OPTICS.fresnelViewContrast,
  distortionStrength: OPTICS.distortionStrength,
  colorDepthStrength: OPTICS.colorDepthStrength,

  // LIGHT
  lightIntensity: LIGHT.intensity,
  specularStrength: LIGHT.specularStrength,
  specularNarrowStrength: LIGHT.specularNarrowStrength,
  shininess: LIGHT.shininess,
  shininessNarrow: LIGHT.shininessNarrow,
  causticSoftStrength: LIGHT.causticSoftStrength,

  // COLOR
  baseHex: '#2a7a9c',
  warmCool: 0,
  /** 0 = flatter triad · 1 = approved depth separation · >1 = exaggerated. */
  depthMix: 1,

  // INTERACTION
  pointerInfluence: 1,
  velocityResponse: 1,
  rippleStrength: 1,
  rippleSpeed: INTERACTION.rippleSpeed,
  proximityRadius: INTERACTION.proximityRadius,
  proximityHeight: INTERACTION.proximityHeight,
  wakeHeight: INTERACTION.wakeHeight,
});

/**
 * @returns {typeof PARAM_DEFAULTS & { _lastValidHex: string }}
 */
export function createParams() {
  return {
    ...PARAM_DEFAULTS,
    /** Last successfully parsed hex — invalid input never breaks the shader. */
    _lastValidHex: PARAM_DEFAULTS.baseHex,
  };
}

/**
 * Parse #RGB / #RRGGBB (optional leading #). Returns null if invalid.
 * @param {string} value
 * @returns {string | null} normalized #rrggbb lowercase
 */
export function parseHexColor(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(raw);
  if (!m) return null;
  let hex = m[1].toLowerCase();
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  return `#${hex}`;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
  };
}

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) * 0.5;
  if (max === min) {
    return { h: 0, s: 0, l };
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  switch (max) {
    case r:
      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      break;
    case g:
      h = ((b - r) / d + 2) / 6;
      break;
    default:
      h = ((r - g) / d + 4) / 6;
      break;
  }
  return { h, s, l };
}

function hue2rgb(p, q, t) {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    return { r: l, g: l, b: l };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: hue2rgb(p, q, h + 1 / 3),
    g: hue2rgb(p, q, h),
    b: hue2rgb(p, q, h - 1 / 3),
  };
}

function wrap01(x) {
  return x - Math.floor(x);
}

function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

/**
 * Build a three-stop water palette from a hex anchor.
 * Preserves tonal depth for any hue (including red / purple / near-black).
 *
 * @param {string} baseHex normalized #rrggbb
 * @param {number} warmCool -1 warm … 0 neutral … +1 cool
 * @param {number} depthMix triad separation strength (default 1)
 * @returns {{ deep: Color, mid: Color, shallow: Color }}
 */
export function derivePalette(baseHex, warmCool = 0, depthMix = 1) {
  const rgb = hexToRgb(baseHex);
  const base = rgbToHsl(rgb.r, rgb.g, rgb.b);

  // Warm pulls toward amber (~0.08); cool toward cyan (~0.52).
  const warmTarget = 0.08;
  const coolTarget = 0.52;
  const t = clamp(warmCool, -1, 1);
  let hueShift = 0;
  if (t < 0) {
    // Blend base hue toward warm.
    const blend = -t;
    hueShift = (warmTarget - base.h) * blend * 0.35;
  } else if (t > 0) {
    hueShift = (coolTarget - base.h) * t * 0.35;
  }

  const mix = clamp(depthMix, 0, 2);

  function stop(offset, lightFloor, lightCeil, satFloor, satCeil) {
    const h = wrap01(base.h + offset.h * mix + hueShift);
    // Near-gray / near-black anchors: lift saturation so water structure reads.
    const satBoost = base.s < 0.15 ? (0.15 - base.s) * 0.8 : 0;
    const s = clamp(base.s + offset.s * mix + satBoost, satFloor, satCeil);
    // Preserve a readable lightness band even for extreme anchors.
    const l = clamp(base.l + offset.l * mix, lightFloor, lightCeil);
    const out = hslToRgb(h, s, l);
    return new Color(out.r, out.g, out.b);
  }

  // Deep stays near the anchor; mid/shallow climb with calibrated offsets.
  const deep = stop(
    { h: 0, s: 0, l: 0 },
    0.1,
    0.55,
    0.12,
    0.85,
  );
  const mid = stop(MID_OFFSET, 0.18, 0.68, 0.1, 0.9);
  const shallow = stop(SHALLOW_OFFSET, 0.28, 0.82, 0.08, 0.95);

  // Guarantee mid sits between deep and shallow in luminance.
  const deepHsl = { h: 0, s: 0, l: 0 };
  const midHsl = { h: 0, s: 0, l: 0 };
  const shallowHsl = { h: 0, s: 0, l: 0 };
  deep.getHSL(deepHsl);
  mid.getHSL(midHsl);
  shallow.getHSL(shallowHsl);
  if (!(deepHsl.l < midHsl.l && midHsl.l < shallowHsl.l)) {
    const ordered = [deepHsl.l, midHsl.l, shallowHsl.l].sort((a, b) => a - b);
    mid.setHSL(midHsl.h, midHsl.s, ordered[1]);
    shallow.setHSL(shallowHsl.h, shallowHsl.s, Math.max(ordered[2], ordered[1] + 0.04));
  }

  return { deep, mid, shallow };
}

/**
 * Resolve palette from params, updating `_lastValidHex` when parse succeeds.
 * @param {ReturnType<typeof createParams>} params
 */
export function resolvePalette(params) {
  const parsed = parseHexColor(params.baseHex);
  if (parsed) {
    params._lastValidHex = parsed;
  }
  const hex = params._lastValidHex || PARAM_DEFAULTS.baseHex;
  return derivePalette(hex, params.warmCool, params.depthMix);
}

function scaleWave(uniformFreq, uniformAmp, uniformSpeed, base, ampMul, speedMul) {
  uniformFreq.value = base.frequency;
  uniformAmp.value = base.amplitude * ampMul;
  uniformSpeed.value = base.speed * speedMul;
}

/**
 * Push params into live uniforms / scene clear color.
 * Does not rebuild ShaderMaterial.
 *
 * @param {object} options
 * @param {import('three').Mesh} options.water
 * @param {import('three').Scene} options.scene
 * @param {import('three').WebGLRenderer} options.renderer
 * @param {ReturnType<typeof createParams>} options.params
 */
export function applyParams({ water, scene, renderer, params }) {
  const u = water.material.uniforms;
  const speedMul = params.motionSpeed;
  const ampMul = params.motionAmplitude;
  const turb = params.turbulence;

  scaleWave(u.uWaveAFrequency, u.uWaveAAmplitude, u.uWaveASpeed, WAVE_A, ampMul, speedMul);
  scaleWave(u.uWaveBFrequency, u.uWaveBAmplitude, u.uWaveBSpeed, WAVE_B, ampMul, speedMul);
  scaleWave(u.uWaveCFrequency, u.uWaveCAmplitude, u.uWaveCSpeed, WAVE_C, ampMul, speedMul);
  scaleWave(u.uWaveDFrequency, u.uWaveDAmplitude, u.uWaveDSpeed, WAVE_D, ampMul, speedMul);

  u.uNoisePhaseStrength.value = NOISE.phaseStrength * turb;
  u.uNoiseFreqStrength.value = NOISE.freqStrength * turb;
  u.uNoiseHeightAmplitude.value = NOISE.heightAmplitude * ampMul * Math.max(turb, 0.35);
  u.uNoiseWarpStrength.value = NOISE.warpStrength * turb;
  u.uNoiseDriftSpeed.value = NOISE.driftSpeed * speedMul;

  u.uOpticalBalance.value = params.opticalBalance;
  u.uFresnelStrength.value = params.fresnelStrength;
  u.uFresnelViewContrast.value = params.fresnelViewContrast;
  u.uDistortionStrength.value = params.distortionStrength;
  u.uColorDepthStrength.value = params.colorDepthStrength;

  _light.copy(LIGHT.color).multiplyScalar(params.lightIntensity);
  _ambient.copy(LIGHT.ambient).multiplyScalar(LIGHT.ambientStrength);
  u.uLightColor.value.copy(_light);
  u.uAmbient.value.copy(_ambient);
  u.uSpecularStrength.value = params.specularStrength;
  u.uSpecularNarrowStrength.value = params.specularNarrowStrength;
  u.uShininess.value = params.shininess;
  u.uShininessNarrow.value = params.shininessNarrow;
  u.uCausticSoftStrength.value = params.causticSoftStrength;

  const { deep, mid, shallow } = resolvePalette(params);
  _deep.copy(deep);
  _mid.copy(mid);
  _shallow.copy(shallow);
  u.uColorDeep.value.copy(_deep);
  u.uColorMid.value.copy(_mid);
  u.uColorShallow.value.copy(_shallow);

  // Keep page / clear color locked to the deep body tone.
  scene.background.copy(_deep);
  renderer.setClearColor(_deep, 1);

  u.uProximityRadius.value = params.proximityRadius;
  u.uProximityHeight.value = params.proximityHeight * params.pointerInfluence;
  u.uWakeHeight.value = params.wakeHeight * params.velocityResponse;
  u.uRippleSpeed.value = params.rippleSpeed;
}

/**
 * Interaction scales consumed by pointer.js (not all are shader uniforms).
 * @param {ReturnType<typeof createParams>} params
 */
export function getInteractionScales(params) {
  return {
    pointerInfluence: params.pointerInfluence,
    velocityResponse: params.velocityResponse,
    rippleStrength: params.rippleStrength,
  };
}

/** Approved default triad — available for smoke checks. */
export const APPROVED_COLORS = {
  deep: COLOR_DEEP,
  mid: COLOR_MID,
  shallow: COLOR_SHALLOW,
};
