import { Color, Mesh, PlaneGeometry, ShaderMaterial, Vector2, Vector3, Vector4 } from 'three';
import vertexShader from '../shaders/water.vert.glsl?raw';
import fragmentShader from '../shaders/water.frag.glsl?raw';

/** Cool deep blue — depth without near-navy troughs. */
export const COLOR_DEEP = new Color(0x2a7a9c);

/** Mid cerulean — bridges troughs and crests. */
export const COLOR_MID = new Color(0x3f9bb8);

/** Soft cyan / slight turquoise crests — cooler than bright aqua. */
export const COLOR_SHALLOW = new Color(0x6bc4d4);

/**
 * Four sine layers with incommensurate scales and skewed directions.
 * Domain-warped noise (Phase 2) further breaks regular interference.
 */
export const WAVE_A = {
  // Broad, slow sweep
  dir: new Vector2(0.91, 0.42).normalize(),
  frequency: 5.5,
  amplitude: 0.017,
  speed: 0.28,
  phase: 0.37,
};

export const WAVE_B = {
  // Mid-scale, strongly oblique to A
  dir: new Vector2(-0.55, 0.83).normalize(),
  frequency: 12.5,
  amplitude: 0.012,
  speed: 0.21,
  phase: 2.15,
};

export const WAVE_C = {
  // Finer detail, third angle
  dir: new Vector2(0.28, -0.96).normalize(),
  frequency: 21.5,
  amplitude: 0.007,
  speed: 0.34,
  phase: 4.82,
};

export const WAVE_D = {
  // Extra mid-fine layer on a fourth non-harmonic angle (breaks diamond cells)
  dir: new Vector2(-0.95, -0.31).normalize(),
  frequency: 9.0,
  amplitude: 0.008,
  speed: 0.19,
  phase: 1.08,
};

/**
 * Stronger modulation + domain warp to dissolve camouflage / blob repetition.
 * Still sine-led and calm — not turbulent foam.
 */
export const NOISE = {
  /** Phase push on wave layers. */
  phaseStrength: 1.55,
  /** Fractional frequency warp. */
  freqStrength: 0.14,
  /** Extra height from noise (multi-scale, still modest). */
  heightAmplitude: 0.007,
  /** Domain warp of wave sample positions (key anti-repetition lever). */
  warpStrength: 0.16,
  /** Broad / mid / fine FBM domains — intentionally incommensurate. */
  scaleBroad: 0.58,
  scaleMid: 1.55,
  scaleFine: 3.6,
  /** Faster drift so the field feels alive without looking stormy. */
  driftSpeed: 0.055,
};

/** World-space epsilon for finite-difference normals. */
export const NORMAL_EPS = 0.022;

/** How strongly slope shifts color (0–~2). */
export const SLOPE_INFLUENCE = 1.7;

/** How strongly independent noise reshapes color vs pure height. */
export const NOISE_COLOR_INFLUENCE = 0.42;

/**
 * Phase 3 lighting — soft daylight Blinn-Phong (refined).
 * Dual specular lobes + surface-tilt streak variation; Phase 2 displacement untouched.
 */
export const LIGHT = {
  /** World-space direction from surface toward the light (slightly more angled for form). */
  dir: new Vector3(0.48, 0.22, 0.84).normalize(),
  /** Soft daylight tint (slightly warm so blues stay rich). */
  color: new Color(0xe8f4ff),
  /** Diffuse intensity — a touch more directional than the first pass. */
  intensity: 0.78,
  /** Ambient floor — lower than first pass so form reads; still never black. */
  ambient: new Color(0x6a9eb0),
  ambientStrength: 0.40,
  /** Pale cyan specular tint (hottest hits stay tinted, not blown white). */
  specularColor: new Color(0xe2f6fb),
  /** Broad soft lobe — balanced pass: less blown-out highlight. */
  specularStrength: 0.17,
  /** Soft Blinn-Phong exponent — broad water sheen. */
  shininess: 28.0,
  /** Narrow lobe exponent — occasional concentrated glints. */
  shininessNarrow: 72.0,
  /** Narrow lobe — localized only. */
  specularNarrowStrength: 0.24,
  /** Soft caustic-like streaks — hint level. */
  causticSoftStrength: 0.13,
};

/**
 * Phase 6.5 — approved fine caustic network baseline (user-tuned).
 * Public semantic controls derive offsets around these values; do not overwrite lightly.
 * Dual-scale domain-warped Worley F2−F1 ridges.
 */
export const CAUSTIC_NET = Object.freeze({
  /** Overall additive strength. */
  intensity: 1.1,
  /** Spatial density (higher = finer cells). Locked internal — not public. */
  scale: 2.0,
  /** Ridge thinness (lower = sharper/thinner lines). */
  sharpness: 0.375,
  /** Domain warp from noise + surface normals. */
  warp: 0.42,
  /** Cell drift / evolution speed (tied to uTime). */
  speed: 0,
});

/** Safe visual clamps for derived caustic params. */
export const CAUSTIC_CLAMPS = Object.freeze({
  intensity: Object.freeze({ min: 0.28, max: 1.6 }),
  scale: Object.freeze({ min: 2.0, max: 2.0 }),
  sharpness: Object.freeze({ min: 0.22, max: 0.48 }),
  warp: Object.freeze({ min: 0.15, max: 0.85 }),
  speed: Object.freeze({ min: 0, max: 0.4 }),
});

/**
 * Phase 4 optics — balanced midpoint: rich blue body + subtle glass.
 * Keeps view-contrast Fresnel visibility; reduces pale wash / overall brightening.
 *
 * Debug: set `debugOptics` temporarily to 1–4 (Fresnel / distortion / albedo / lighting).
 * Leave at 0 for the normal composite (no UI).
 */
export const OPTICS = {
  /** Schlick F0 — water-like dielectric (not metal). */
  fresnelF0: 0.04,
  /** Slightly steeper falloff — pale response on stronger tilts only. */
  fresnelPower: 2.05,
  /** Overall Fresnel scale — reduced from overcorrected 1.35. */
  fresnelStrength: 1.0,
  /**
   * Expands the near-1 N·V band under top-down so ridge tilts separate.
   * Slightly lower than diagnostic peak so Fresnel does not flood the frame.
   */
  fresnelViewContrast: 11.5,
  /** 0 = translucent, 1 = reflective. Lean back toward rich water body. */
  opticalBalance: 0.42,
  /**
   * Normal-tied analytic tone offset — left unchanged this balancing pass.
   */
  distortionStrength: 0.30,
  /** Optical thickness / clarity — enough depth, less frost lift. */
  colorDepthStrength: 0.62,
  /** 0 = full; 1 = Fresnel; 2 = distortion; 3 = albedo; 4 = lighting. */
  debugOptics: 0,
};

/**
 * Phase 5 interaction tuning — clearly perceptible, still calm (not arcade).
 * Interaction-only; Phase 2–4 visuals unchanged.
 */
export const INTERACTION = {
  /** Soft influence radius in world units — readable presence without a hard disk. */
  proximityRadius: 0.55,
  /** Local height under the pointer — clearly perceptible presence. */
  proximityHeight: 0.0125,
  /** Velocity wake height — stronger fast move, still controlled. */
  wakeHeight: 0.018,
  /** Spatial frequency of analytic tap ripples. */
  rippleSpatialFreq: 11.5,
  /** Outward travel speed of ripple phase — responsive propagation. */
  rippleSpeed: 9.5,
  /** Distance falloff — lower so the crest travels farther before dying. */
  rippleSpatialDecay: 1.55,
  /** Time falloff — smooth return; slightly faster than before so it stays lively. */
  rippleTemporalDecay: 0.95,
};

/** Enough segments for soft sine displacement; not over-subdivided. */
const SEGMENTS = 80;

/**
 * Full-field water plane: Phase 2–6 visuals + Phase 6.5 fine caustic network.
 * Phase 6 Stage A/B: uniforms are seeded/overwritten by controls/params.applyParams
 * so defaults stay identical on load.
 */
export function createWaterMesh() {
  const geometry = new PlaneGeometry(2, 2, SEGMENTS, SEGMENTS);

  const lightColor = LIGHT.color.clone().multiplyScalar(LIGHT.intensity);
  const ambient = LIGHT.ambient.clone().multiplyScalar(LIGHT.ambientStrength);

  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uWorldScale: { value: new Vector2(1, 1) },

      uWaveADir: { value: WAVE_A.dir.clone() },
      uWaveAFrequency: { value: WAVE_A.frequency },
      uWaveAAmplitude: { value: WAVE_A.amplitude },
      uWaveASpeed: { value: WAVE_A.speed },
      uWaveAPhase: { value: WAVE_A.phase },

      uWaveBDir: { value: WAVE_B.dir.clone() },
      uWaveBFrequency: { value: WAVE_B.frequency },
      uWaveBAmplitude: { value: WAVE_B.amplitude },
      uWaveBSpeed: { value: WAVE_B.speed },
      uWaveBPhase: { value: WAVE_B.phase },

      uWaveCDir: { value: WAVE_C.dir.clone() },
      uWaveCFrequency: { value: WAVE_C.frequency },
      uWaveCAmplitude: { value: WAVE_C.amplitude },
      uWaveCSpeed: { value: WAVE_C.speed },
      uWaveCPhase: { value: WAVE_C.phase },

      uWaveDDir: { value: WAVE_D.dir.clone() },
      uWaveDFrequency: { value: WAVE_D.frequency },
      uWaveDAmplitude: { value: WAVE_D.amplitude },
      uWaveDSpeed: { value: WAVE_D.speed },
      uWaveDPhase: { value: WAVE_D.phase },

      uNoisePhaseStrength: { value: NOISE.phaseStrength },
      uNoiseFreqStrength: { value: NOISE.freqStrength },
      uNoiseHeightAmplitude: { value: NOISE.heightAmplitude },
      uNoiseWarpStrength: { value: NOISE.warpStrength },
      uNoiseScaleBroad: { value: NOISE.scaleBroad },
      uNoiseScaleMid: { value: NOISE.scaleMid },
      uNoiseScaleFine: { value: NOISE.scaleFine },
      uNoiseDriftSpeed: { value: NOISE.driftSpeed },
      uNormalEps: { value: NORMAL_EPS },

      uColorDeep: { value: COLOR_DEEP.clone() },
      uColorMid: { value: COLOR_MID.clone() },
      uColorShallow: { value: COLOR_SHALLOW.clone() },
      uSlopeInfluence: { value: SLOPE_INFLUENCE },
      uNoiseColorInfluence: { value: NOISE_COLOR_INFLUENCE },

      // Phase 3 lighting
      uLightDir: { value: LIGHT.dir.clone() },
      uLightColor: { value: lightColor },
      uAmbient: { value: ambient },
      uSpecularColor: { value: LIGHT.specularColor.clone() },
      uSpecularStrength: { value: LIGHT.specularStrength },
      uShininess: { value: LIGHT.shininess },
      uShininessNarrow: { value: LIGHT.shininessNarrow },
      uSpecularNarrowStrength: { value: LIGHT.specularNarrowStrength },
      uCameraPosition: { value: new Vector3(0, 0, 2) },
      uCausticSoftStrength: { value: LIGHT.causticSoftStrength },

      // Phase 6.5 — fine caustic network
      uCausticNetIntensity: { value: CAUSTIC_NET.intensity },
      uCausticNetScale: { value: CAUSTIC_NET.scale },
      uCausticNetSharpness: { value: CAUSTIC_NET.sharpness },
      uCausticNetWarp: { value: CAUSTIC_NET.warp },
      uCausticNetSpeed: { value: CAUSTIC_NET.speed },
      // Palette-derived caustic tints (overwritten by applyParams).
      uCausticTint: { value: new Color(0x7ac8dc) },
      uCausticHot: { value: new Color(0xe6f7fc) },

      // Phase 4 optics
      uFresnelF0: { value: OPTICS.fresnelF0 },
      uFresnelPower: { value: OPTICS.fresnelPower },
      uFresnelStrength: { value: OPTICS.fresnelStrength },
      uFresnelViewContrast: { value: OPTICS.fresnelViewContrast },
      uOpticalBalance: { value: OPTICS.opticalBalance },
      uDistortionStrength: { value: OPTICS.distortionStrength },
      uColorDepthStrength: { value: OPTICS.colorDepthStrength },
      uDebugOptics: { value: OPTICS.debugOptics },

      // Phase 5 — pointer / ripple (updated each frame from interaction/pointer.js)
      uPointerPos: { value: new Vector2(0, 0) },
      uPointerStrength: { value: 0 },
      uPointerVelocity: { value: new Vector2(0, 0) },
      uPointerWake: { value: 0 },
      uProximityRadius: { value: INTERACTION.proximityRadius },
      uProximityHeight: { value: INTERACTION.proximityHeight },
      uWakeHeight: { value: INTERACTION.wakeHeight },
      uRippleSpatialFreq: { value: INTERACTION.rippleSpatialFreq },
      uRippleSpeed: { value: INTERACTION.rippleSpeed },
      uRippleSpatialDecay: { value: INTERACTION.rippleSpatialDecay },
      uRippleTemporalDecay: { value: INTERACTION.rippleTemporalDecay },
      uRipple0: { value: new Vector4(0, 0, 0, 0) },
      uRipple1: { value: new Vector4(0, 0, 0, 0) },
      uRipple2: { value: new Vector4(0, 0, 0, 0) },
      uRipple3: { value: new Vector4(0, 0, 0, 0) },
    },
  });

  const mesh = new Mesh(geometry, material);
  mesh.name = 'waterSurface';
  return mesh;
}
