// One wave-equation step on the low-res heightfield, plus queued disturbances.
// State texel: R = height, G = vertical velocity (per step).
// MAX_SEGMENTS / MAX_IMPULSES are injected as defines by createWaterSim.js.

uniform sampler2D uState;
// Full grid size in texels, including the off-screen sponge margin.
uniform vec2 uGridSize;
// Sponge margin width in texels on every side.
uniform float uPadding;
// Courant number squared (texels per step)^2. Stable while <= 0.75 for this stencil.
uniform float uCourant2;
// Per-step multiplier on velocity in the visible area.
uniform float uVelocityDamping;
// Per-step pull of height toward rest (removes leftover volume).
uniform float uHeightRelax;
// Per-step multiplier on height and velocity at the outermost sponge texel.
uniform float uSpongeDamping;
// Safety bound on |height| and |velocity|; never reached in normal operation.
uniform float uStateClamp;

// Pointer movement since the last step, as straight segments in texels.
// Ends: xy = start, zw = end.
uniform vec4 uSegmentEnds[MAX_SEGMENTS];
// Shape: x = radius across travel, y = radius along travel (texels),
// z = total velocity each texel on the path receives (negative pushes down).
uniform vec4 uSegmentShape[MAX_SEGMENTS];
uniform int uSegmentCount;
// A brush adds less where the surface is already pushed its way by more than
// uPushDepth × its own strength. Stops resonant pile-up when the pointer moves
// at about wave speed (it would otherwise ride its own bow wave and keep growing).
uniform float uPushDepth;

// Click / tap height impulses: xy = center (texels), z = radius (texels), w = amplitude.
uniform vec4 uImpulses[MAX_IMPULSES];
uniform int uImpulseCount;

// Rim radius as a multiple of the brush radius. Every disturbance subtracts an
// equal-volume wider Gaussian so it adds no net water; otherwise pushed-down
// volume piles up into a slow screen-wide depression.
uniform float uRimScale;

#ifdef IDLE_SOURCE
// Slow macro forcing (dedicated idle-motion stage); pointer splats unchanged below.
uniform float uIdleTime;
uniform float uIdleStrength;
uniform float uIdleSpatial;
uniform float uIdleSpeed;
uniform float uIdleMix;
uniform float uIdleMidWeight;
uniform float uIdleFineWeight;
// Softly tapers idle kicks where |h| is already large (idle-only; not pointer headroom).
uniform float uIdleHeightCap;

float idleHash21(vec2 p) {
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p + 33.33);
  return fract(p.x * p.y);
}

float idleValueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = idleHash21(i);
  float b = idleHash21(i + vec2(1.0, 0.0));
  float c = idleHash21(i + vec2(0.0, 1.0));
  float d = idleHash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Zero-mean in time at each texel (sin carriers) with slow spatial phase / rate variation.
float idleOscillator(vec2 texelPos, float cellSize, float rateMul, float phaseMul) {
  vec2 p = texelPos / max(cellSize, 1.0);
  float seed = idleValueNoise(p);
  float seed2 = idleValueNoise(p + vec2(41.7, -19.2));
  float phase = (seed * 2.0 - 1.0) * 3.14159265 * phaseMul;
  float rate = mix(0.62, 1.38, seed2) * rateMul;
  return sin(uIdleTime * uIdleSpeed * rate + phase);
}

float idleVelocityForcing(vec2 texelPos, float sponge, float height) {
  if (uIdleMix <= 0.0 || sponge >= 1.0) return 0.0;
  float broad = idleOscillator(texelPos, uIdleSpatial, 1.0, 1.0);
  float mid = idleOscillator(texelPos, uIdleSpatial * 0.42, 1.31, 1.7);
  float force = broad + uIdleMidWeight * mid;
#ifdef IDLE_LAYER3
  float fine = idleOscillator(texelPos, uIdleSpatial * 0.18, 2.05, 2.4);
  force += uIdleFineWeight * fine;
#endif
  float headroom = clamp(1.0 - abs(height) / max(uIdleHeightCap, 1e-4), 0.0, 1.0);
  return uIdleStrength * uIdleMix * (1.0 - sponge) * headroom * force;
}
#endif

vec2 fetchState(ivec2 p, ivec2 size) {
  return texelFetch(uState, clamp(p, ivec2(0), size - 1), 0).rg;
}

// Winitzki approximation of erf, |error| < 2e-4.
float erfApprox(float x) {
  float x2 = x * x;
  float t = x2 * (1.2732395 + 0.147 * x2) / (1.0 + 0.147 * x2);
  return sign(x) * sqrt(1.0 - exp(-t));
}

// Velocity a texel receives from a Gaussian brush swept from start to end.
// `coverage` is the share of the brush's along-travel profile the segment spans,
// so consecutive segments sum to exactly `strength` along the path — no beads at
// joints, independent of pointer event rate — and a still pointer adds nothing.
float segmentDeposit(vec2 p, vec4 ends, vec4 shape) {
  vec2 travel = ends.zw - ends.xy;
  float len = length(travel);
  if (len < 1e-4) return 0.0;

  vec2 dir = travel / len;
  vec2 offset = p - ends.xy;
  float along = dot(offset, dir);
  float across = dot(offset, vec2(-dir.y, dir.x));

  float a2 = across * across;
  float rimRadius = shape.x * uRimScale;
  if (a2 > 9.0 * rimRadius * rimRadius) return 0.0;
  if (along < -3.0 * shape.y || along > len + 3.0 * shape.y) return 0.0;
  // Zero-volume across-profile: core minus a wider rim of equal 1D mass.
  float acrossFalloff = exp(-a2 / (shape.x * shape.x)) - exp(-a2 / (rimRadius * rimRadius)) / uRimScale;

  float coverage = 0.5 * (erfApprox((len - along) / shape.y) + erfApprox(along / shape.y));
  return shape.z * acrossFalloff * coverage;
}

void main() {
  ivec2 size = ivec2(uGridSize);
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 center = vec2(p) + 0.5;

  vec2 state = fetchState(p, size);
  float h = state.r;
  float v = state.g;

  float edges =
    fetchState(p + ivec2(1, 0), size).r +
    fetchState(p + ivec2(-1, 0), size).r +
    fetchState(p + ivec2(0, 1), size).r +
    fetchState(p + ivec2(0, -1), size).r;
  float diagonals =
    fetchState(p + ivec2(1, 1), size).r +
    fetchState(p + ivec2(-1, 1), size).r +
    fetchState(p + ivec2(1, -1), size).r +
    fetchState(p + ivec2(-1, -1), size).r;

  // Isotropic 9-point Laplacian (rounder rings than the 5-point stencil).
  float laplacian = (4.0 * edges + diagonals - 20.0 * h) / 6.0;

  // 0 inside the visible area, rising quadratically to 1 at the outer grid edge.
  float edgeDistance = float(min(min(p.x, size.x - 1 - p.x), min(p.y, size.y - 1 - p.y)));
  float sponge = clamp(1.0 - edgeDistance / uPadding, 0.0, 1.0);
  sponge *= sponge;

  float velocityDamping = mix(uVelocityDamping, uSpongeDamping, sponge);
  float heightRelax = mix(uHeightRelax, uSpongeDamping, sponge);

  // Symplectic Euler: velocity first, then height with the new velocity.
  v = (v + uCourant2 * laplacian) * velocityDamping;

#ifdef IDLE_SOURCE
  v += idleVelocityForcing(center, sponge, h);
#endif

  for (int i = 0; i < MAX_SEGMENTS; i++) {
    if (i >= uSegmentCount) break;
    vec4 shape = uSegmentShape[i];
    float deposit = segmentDeposit(center, uSegmentEnds[i], shape);
    float pushedDepth = state.r * sign(shape.z);
    float headroom = clamp(1.0 - pushedDepth / (uPushDepth * abs(shape.z) + 1e-6), 0.0, 1.0);
    v += deposit * headroom;
  }

  h = (h + v) * heightRelax;

  for (int i = 0; i < MAX_IMPULSES; i++) {
    if (i >= uImpulseCount) break;
    vec4 impulse = uImpulses[i];
    vec2 offset = center - impulse.xy;
    float d2 = dot(offset, offset);
    float rimRadius = impulse.z * uRimScale;
    if (d2 > 9.0 * rimRadius * rimRadius) continue;
    // Zero-volume: core minus a wider rim of equal 2D mass.
    float profile = exp(-d2 / (impulse.z * impulse.z)) - exp(-d2 / (rimRadius * rimRadius)) / (uRimScale * uRimScale);
    h += impulse.w * profile;
  }

  h = clamp(h, -uStateClamp, uStateClamp);
  v = clamp(v, -uStateClamp, uStateClamp);

  gl_FragColor = vec4(h, v, 0.0, 1.0);
}
