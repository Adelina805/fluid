uniform float uTime;
uniform vec2 uWorldScale;

uniform vec2 uWaveADir;
uniform float uWaveAFrequency;
uniform float uWaveAAmplitude;
uniform float uWaveASpeed;
uniform float uWaveAPhase;

uniform vec2 uWaveBDir;
uniform float uWaveBFrequency;
uniform float uWaveBAmplitude;
uniform float uWaveBSpeed;
uniform float uWaveBPhase;

uniform vec2 uWaveCDir;
uniform float uWaveCFrequency;
uniform float uWaveCAmplitude;
uniform float uWaveCSpeed;
uniform float uWaveCPhase;

uniform vec2 uWaveDDir;
uniform float uWaveDFrequency;
uniform float uWaveDAmplitude;
uniform float uWaveDSpeed;
uniform float uWaveDPhase;

// Procedural irregularity (Phase 2). Value noise warps sample domain, modulates
// sine phase/frequency, and adds a small height contribution — not stormy raw noise.
uniform float uNoisePhaseStrength;
uniform float uNoiseFreqStrength;
uniform float uNoiseHeightAmplitude;
uniform float uNoiseWarpStrength;
uniform float uNoiseScaleBroad;
uniform float uNoiseScaleMid;
uniform float uNoiseScaleFine;
uniform float uNoiseDriftSpeed;
uniform float uNormalEps;

varying float vHeight;
varying float vNoiseVary;
varying vec3 vNormal;
varying vec3 vWorldPos;

float wave(vec2 pos, vec2 dir, float frequency, float amplitude, float speed, float phase) {
  return amplitude * sin(dot(pos, dir) * frequency + uTime * speed + phase);
}

// Compact 2D value noise: hash cell corners, hermite-smooth bilinear blend.
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);

  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));

  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Two octaves — organic variation without high-frequency shimmer.
float fbm2(vec2 p) {
  float n = 0.0;
  n += 0.62 * valueNoise(p);
  n += 0.38 * valueNoise(p * 2.13 + vec2(17.3, 9.1));
  return n;
}

/**
 * Shared height field: sine foundation + domain warp + multi-scale noise.
 * Used for both displacement and finite-difference normals.
 */
float surfaceHeight(vec2 worldXY) {
  vec2 drift = vec2(uTime * uNoiseDriftSpeed * 0.41, -uTime * uNoiseDriftSpeed * 0.27);

  // Three incommensurate noise scales break regular interference cells.
  float nBroad = fbm2(worldXY * uNoiseScaleBroad + drift) * 2.0 - 1.0;
  float nMid = fbm2(worldXY * uNoiseScaleMid + drift * 1.25 + vec2(-23.4, 51.8)) * 2.0 - 1.0;
  float nFine = fbm2(worldXY * uNoiseScaleFine + drift * 1.55 + vec2(41.2, -19.7)) * 2.0 - 1.0;

  // Domain warp: sample waves on a gently bent coordinate field so crests
  // cannot form even diamonds / camouflage cells.
  vec2 warp = vec2(
    nBroad * 0.7 + nMid * 0.35,
    nMid * 0.65 + nFine * 0.25
  ) * uNoiseWarpStrength;
  vec2 sampleXY = worldXY + warp;

  float phaseA = uWaveAPhase + nBroad * uNoisePhaseStrength * 0.55 + nMid * uNoisePhaseStrength * 0.2;
  float phaseB = uWaveBPhase + nBroad * uNoisePhaseStrength * 0.75 + nMid * uNoisePhaseStrength * 0.55;
  float phaseC = uWaveCPhase + nMid * uNoisePhaseStrength * 0.7 + nFine * uNoisePhaseStrength * 0.9;
  float phaseD = uWaveDPhase + nFine * uNoisePhaseStrength * 0.6 + nBroad * uNoisePhaseStrength * 0.35;

  float freqA = uWaveAFrequency * (1.0 + nBroad * uNoiseFreqStrength * 0.55);
  float freqB = uWaveBFrequency * (1.0 + nMid * uNoiseFreqStrength * 0.85);
  float freqC = uWaveCFrequency * (1.0 + nFine * uNoiseFreqStrength);
  float freqD = uWaveDFrequency * (1.0 + nMid * uNoiseFreqStrength * 0.45 + nFine * uNoiseFreqStrength * 0.35);

  float h = 0.0;
  h += wave(sampleXY, uWaveADir, freqA, uWaveAAmplitude, uWaveASpeed, phaseA);
  h += wave(sampleXY, uWaveBDir, freqB, uWaveBAmplitude, uWaveBSpeed, phaseB);
  h += wave(sampleXY, uWaveCDir, freqC, uWaveCAmplitude, uWaveCSpeed, phaseC);
  h += wave(sampleXY, uWaveDDir, freqD, uWaveDAmplitude, uWaveDSpeed, phaseD);

  // Small multi-scale height contribution (still low — structure, not foam).
  h += nBroad * uNoiseHeightAmplitude;
  h += nMid * uNoiseHeightAmplitude * 0.55;
  h += nFine * uNoiseHeightAmplitude * 0.28;

  return h;
}

/** Noise field for color variation (independent of height isobands). */
float surfaceNoiseVary(vec2 worldXY) {
  vec2 drift = vec2(uTime * uNoiseDriftSpeed * 0.41, -uTime * uNoiseDriftSpeed * 0.27);
  float nMid = fbm2(worldXY * uNoiseScaleMid + drift * 1.25 + vec2(-23.4, 51.8)) * 2.0 - 1.0;
  float nFine = fbm2(worldXY * uNoiseScaleFine * 0.72 + drift * 0.9 + vec2(8.4, 33.1)) * 2.0 - 1.0;
  return nMid * 0.65 + nFine * 0.35;
}

/**
 * Approximate surface normal from the height field via central differences.
 * Phase 3 lights with these; Phase 2 also used slope for color nuance.
 */
vec3 surfaceNormal(vec2 worldXY) {
  float eps = uNormalEps;
  float hL = surfaceHeight(worldXY - vec2(eps, 0.0));
  float hR = surfaceHeight(worldXY + vec2(eps, 0.0));
  float hD = surfaceHeight(worldXY - vec2(0.0, eps));
  float hU = surfaceHeight(worldXY + vec2(0.0, eps));
  return normalize(vec3(hL - hR, hD - hU, 2.0 * eps));
}

void main() {
  vec2 worldXY = position.xy * uWorldScale;

  float h = surfaceHeight(worldXY);
  vHeight = h;
  vNoiseVary = surfaceNoiseVary(worldXY);
  vNormal = surfaceNormal(worldXY);
  // World-space position for view direction (mesh scale matches uWorldScale).
  vWorldPos = vec3(worldXY, h);

  vec3 displaced = position;
  displaced.z += h;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
