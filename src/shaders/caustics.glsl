// Stage E — rebuilt caustic field (`?sim&water&caustics=new`).
// Same visual design as the legacy Phase 6.5 network (domain-warped Worley F2−F1 ridges,
// noise-varied thickness, brightness pulse) at a fraction of the cost: no trigonometry,
// one Worley pass, two vec2 value-noise lookups (E1).
// E2 couples it to the simulated surface, each part compiled in only when enabled:
//   CAUSTIC_BEND   — refraction-style lookup offset from the composite's sim normal;
//   CAUSTIC_CONC   — light concentration from the smoothed sim-height curvature;
//   CAUSTIC_DRIFT  — 1 = slow warp-domain drift, 2 = slow cell-site motion (comparison only).
// Prepended to surface.frag.glsl after sim/simSurface.glsl.

uniform float uCausticNetIntensity;
uniform float uCausticNetScale;
uniform float uCausticNetSharpness;
uniform float uCausticNetWarp;
uniform vec3 uCausticTint;
uniform vec3 uCausticHot;

// Lookup offset in Worley-cell units per unit of normal tilt (N.xy).
uniform float uCausticBend;
// Tilt magnitude the bend saturates toward (bounds the offset on fast strokes).
uniform float uCausticMaxTilt;
// Largest |1 − det J| of the bent lookup from the smoothed curvature (below 1: no broad folds).
// Fine trains / drag beading below the smoothing scale are not limited; uCausticBend bounds those.
uniform float uCausticFoldLimit;
// Concentration strength (0 = none) and Laplacian → signal gain (per sim height / texel²).
uniform float uCausticConc;
uniform float uCausticConcGain;
// Smoothed sim-height Laplacian (R, per texel²), same layout as the sim state.
uniform sampler2D uCausticCurvature;
// Drift rate: warp-lattice units / s (mode 1) or orbit cycles / s (mode 2).
uniform float uCausticDriftSpeed;
uniform float uTime;

// "Hash without Sine" (Dave Hoskins, MIT): multiply-add + fract only, identical on every
// fp32 GPU. Inputs are integer cell coordinates of modest size.
vec2 causticHash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// Two independent value-noise channels from one set of four corner hashes.
vec2 causticNoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 a = causticHash22(i);
  vec2 b = causticHash22(i + vec2(1.0, 0.0));
  vec2 c = causticHash22(i + vec2(0.0, 1.0));
  vec2 d = causticHash22(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Parabolic sine: ≈ sin(2π·x) for any x, multiply-add only.
float causticPsin(float x) {
  float t = fract(x + 0.5) - 0.5;
  return 8.0 * t * (1.0 - 2.0 * abs(t));
}

// Static Worley F1 / F2 (3×3 search). Jitter uses a parabolic sine, 8t(1 − 2|t|), so cell
// sites approximate the legacy 0.5 + 0.5·sin(2π·hash) distribution (bunched toward cell
// borders, which gives the irregular cell sizes). Squared distances in the loop; two sqrt at the end.
vec2 causticWorley(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float d1 = 64.0;
  float d2 = 64.0;

  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 s = causticHash22(n + g) - 0.5;
#if defined(CAUSTIC_DRIFT) && CAUSTIC_DRIFT == 2
      // Sites shrink toward the cell center to make room for a small orbit; still inside
      // [0, 1], so the 3×3 search stays exact.
      float phase = uTime * uCausticDriftSpeed + dot(s, vec2(1.7, 2.3));
      vec2 orbit = vec2(causticPsin(phase), causticPsin(phase + 0.25));
      vec2 site = 0.5 + 2.8 * s * (1.0 - 2.0 * abs(s)) + 0.15 * orbit;
#else
      vec2 site = 0.5 + 4.0 * s * (1.0 - 2.0 * abs(s));
#endif
      vec2 r = g + site - f;
      float d = dot(r, r);
      d2 = min(d2, max(d1, d));
      d1 = min(d1, d);
    }
  }

  return sqrt(vec2(d1, d2));
}

/** Smoothed sim-height Laplacian (per texel², createCausticCurvature.js) at visible-area-mapped uv. */
float causticCurvature(vec2 simUv) {
#if defined(CAUSTIC_BEND) || defined(CAUSTIC_CONC) || (defined(CAUSTIC_VIEW) && CAUSTIC_VIEW >= 3)
  return texture2D(uCausticCurvature, simUv).r;
#else
  return 0.0;
#endif
}

/**
 * Refraction-style lookup position: the whole field (lines, thickness, pulse) is displaced
 * coherently by the surface tilt, saturating toward uCausticMaxTilt.
 * Fold limit: with N.xy ≈ −strength·∇h, det J ≈ 1 − k·foldScale·∇²h, where k is the world offset per
 * unit tilt and foldScale = normal strength × sim texels per world unit. Where the smoothed
 * curvature would push det J toward 1 ± uCausticFoldLimit (narrow wakes, a fresh tap), the offset
 * is smoothly scaled down. The curvature is smooth, so the scale factor adds few folds of its own,
 * unless the limit is so small that it varies steeply (folding rose at both 0.4 and 1.0 vs 0.7).
 */
vec2 causticLookup(vec2 worldXY, vec2 tilt, float lap, float foldScale) {
#ifdef CAUSTIC_BEND
  float m = length(tilt);
  vec2 limited = tilt / sqrt(1.0 + (m * m) / (uCausticMaxTilt * uCausticMaxTilt));
  float k = uCausticBend / uCausticNetScale;
  float stretch = k * foldScale * lap / uCausticFoldLimit;
  return worldXY + limited * (k * inversesqrt(1.0 + stretch * stretch));
#else
  return worldXY;
#endif
}

/** Light concentration from curvature, −1 (diverging) … +1 (converging); crests act as converging lenses. */
float causticConcentration(float lap) {
  float k = -lap * uCausticConcGain;
  return k / (1.0 + abs(k));
}

/**
 * Single-layer caustic network, 0–~0.83 at rest (legacy primary-layer weight and ranges).
 * `tilt` = surface normal xy; `simUv` locates the smoothed curvature (fold limit, concentration);
 * `foldScale` = normal strength × sim texels per world unit.
 */
float causticField(vec2 worldXY, vec2 tilt, vec2 simUv, float foldScale) {
  float lap = causticCurvature(simUv);
  vec2 q = causticLookup(worldXY, tilt, lap, foldScale);

  vec2 warpUv = q * 1.65;
#if defined(CAUSTIC_DRIFT) && CAUSTIC_DRIFT == 1
  warpUv += uTime * uCausticDriftSpeed * vec2(0.83, -0.56);
#endif
  vec2 warp = causticNoise2(warpUv) * 2.0 - 1.0;
  vec2 p = q * uCausticNetScale + warp * uCausticNetWarp;

  vec2 edge = causticWorley(p);
  float e = edge.y - edge.x;

  // x → line thickness (legacy thickA scale), y → brightness pulse.
  vec2 detail = causticNoise2(q * 2.15 + vec2(23.7, -41.3));
  float thick = mix(0.52, 1.38, detail.x);

  // Concentration: converging water → brighter, wider lines plus a faint focused glow between
  // them; diverging → weaker lines. Zero on flat water.
  float widthScale = 1.0;
  float gain = 1.0;
  float glow = 0.0;
#ifdef CAUSTIC_CONC
  float conc = causticConcentration(lap) * uCausticConc;
  widthScale = max(1.0 + 0.3 * conc, 0.55);
  gain = max(1.0 + 0.5 * conc, 0.4);
  glow = 0.12 * max(conc, 0.0);
#endif

  // Never narrower than ~2 px, whatever the DPR or local compression of the web.
  float width = max(max(uCausticNetSharpness, 0.015) * thick * widthScale, 2.0 * fwidth(e));
  float line = 1.0 - smoothstep(0.0, width, e);
  line = pow(max(line, 0.0), mix(1.35, 2.15, 1.0 - thick * 0.32));

  float pulse = mix(0.62, 1.18, detail.y);
  return line * 0.70 * pulse * gain + glow;
}

/**
 * Dev-only coupling views (`causticView=fold|conc`), drawn over the dimmed raw field.
 * 3 = fold: Jacobian of the bent lookup — red folded (det < 0), yellow near-fold stretch
 *     (det < 0.3), blue strong compression / pinching (det > 2), gray stable.
 * 4 = concentration: red converging, blue diverging (independent of `causticConc` strength).
 */
vec3 causticDebugView(int mode, float netRaw, vec2 worldXY, vec2 tilt, vec2 simUv, float foldScale) {
  vec3 base = vec3(netRaw * 0.35 + 0.06);
  float lap = causticCurvature(simUv);
  if (mode == 3) {
    vec2 q = causticLookup(worldXY, tilt, lap, foldScale);
    vec2 qx = dFdx(q);
    vec2 qy = dFdy(q);
    vec2 wx = dFdx(worldXY);
    vec2 wy = dFdy(worldXY);
    float det = (qx.x * qy.y - qx.y * qy.x) / (wx.x * wy.y - wx.y * wy.x);
    vec3 c = base;
    c = mix(c, vec3(0.15, 0.35, 1.0), smoothstep(1.6, 2.4, det) * 0.85);
    c = mix(c, vec3(1.0, 0.85, 0.1), (1.0 - smoothstep(0.1, 0.4, det)) * 0.85);
    c = mix(c, vec3(1.0, 0.1, 0.05), step(det, 0.0));
    return c;
  }
  float s = causticConcentration(lap);
  return base + vec3(max(s, 0.0), 0.0, max(-s, 0.0)) * 0.9;
}
