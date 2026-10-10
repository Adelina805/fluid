// Stage E — rebuilt caustic field (`?sim&water&caustics=new`).
// Same visual design as the legacy Phase 6.5 network (domain-warped Worley F2−F1 ridges,
// noise-varied thickness, brightness pulse) at a fraction of the cost: no trigonometry,
// one Worley pass, two vec2 value-noise lookups (E1).
// E2 couples it to the simulated surface, each part compiled in only when enabled:
//   CAUSTIC_BEND   — refraction-style lookup offset from the composite's sim normal;
//   CAUSTIC_CONC   — light concentration from the smoothed sim-height curvature;
//   CAUSTIC_DRIFT  — 1 = slow warp-domain drift, 2 = slow cell-site motion (comparison only).
// E3 structural variants (dev comparison, CAUSTIC_VARIANT; coupling identical in all three):
//   1 — one Worley layer, E1 / E2 line model (unchanged baseline);
//   2 — one Worley layer + F3 from the same 3×3 search: junction nodes and secondary strands;
//   3 — two Worley layers (second at ×1.71, independent cells) with crossing / node terms.
//   Variants 2 and 3 share the E3 line model (wider hairline ↔ thick range from the same detail noise).
// Prepended to surface.frag.glsl after sim/simSurface.glsl.

#ifndef CAUSTIC_VARIANT
#define CAUSTIC_VARIANT 1
#endif

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
// Accumulated ∫ speed dt, so retuning the drift rate never jumps the pattern.
uniform float uCausticDriftPhase;

#ifdef CAUSTIC_FIELD_TEX
uniform sampler2D uCausticField;
#endif

#if CAUSTIC_VARIANT >= 2
// E3 line model: line width as a fraction of uCausticNetSharpness, hairline (x) → thickest (y).
uniform vec2 uCausticLineWidth;
#endif
#if CAUSTIC_VARIANT == 2
// Junction-node weight (primary line × its F3 − F2 continuation through the vertex).
uniform float uCausticNodeGain;
// Secondary F3 − F2 strands: weight, and the fraction of cells they subdivide.
uniform float uCausticStrandGain;
uniform float uCausticStrandCells;
#endif
#if CAUSTIC_VARIANT == 3
// Second layer: lattice scale relative to the first, weight, and crossing weight.
uniform float uCausticLayer2Scale;
uniform float uCausticLayer2Gain;
uniform float uCausticCrossGain;
#endif

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
      float phase = uCausticDriftPhase + dot(s, vec2(1.7, 2.3));
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

#if CAUSTIC_VARIANT == 2
/**
 * Same static 3×3 search as causticWorley, also keeping F3 and a random value for the F1 cell.
 * Returns (F1, F2, F3, cell random). F3 is occasionally too large where the true third site lies
 * outside the 3×3 block (~1.7% of pixels with this jitter); it only feeds the weaker node / strand terms.
 */
vec4 causticWorley3(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float d1 = 64.0;
  float d2 = 64.0;
  float d3 = 64.0;
  float cell = 0.0;

  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 s = causticHash22(n + g) - 0.5;
      vec2 site = 0.5 + 4.0 * s * (1.0 - 2.0 * abs(s));
      vec2 r = g + site - f;
      float d = dot(r, r);
      cell = d < d1 ? fract(dot(s, vec2(13.7, 7.3))) : cell;
      d3 = min(d3, max(d2, d));
      d2 = min(d2, max(d1, d));
      d1 = min(d1, d);
    }
  }

  return vec4(sqrt(vec3(d1, d2, d3)), cell);
}
#endif

#if CAUSTIC_VARIANT >= 2
/**
 * E5 luminous line profile on an F-difference `e` (0 on the line). `tw` = thickness class, 0 hairline … 1 thick.
 * Bright core plus an optical halo on every line: hairlines get a narrow, faint feather, thick lines a
 * broad soft falloff. The halo fades under the core so the peak stays near 1. Core never narrower than ~1.5 px.
 */
float causticLineE3(float e, float width, float tw) {
  float px = fwidth(e);
  float w = max(width, 1.5 * px);
  float coreW = max(w * mix(0.6, 0.85, tw), 2.25 * px);
  float core = 1.0 - smoothstep(0.0, coreW, e);
  core = pow(max(core, 0.0), mix(0.95, 1.4, tw));
  // Hairline halos would collapse to sub-pixel width; keep a few pixels of feather.
  float halo = 1.0 - smoothstep(0.0, max(w * mix(2.4, 5.5, tw), 6.5 * px), e);
  halo = pow(max(halo, 0.0), 1.7) * mix(0.26, 0.44, tw);
  return core + halo * (1.0 - core * 0.6);
}
#endif

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
 * Bend + domain warp → Worley sample position `p` and thickness / macro-brightness noise.
 * `detail.x` = layer-1 thickness; `thickL2` = independent layer-2 thickness (legacy ×3.05);
 * `macroPulse` = low-frequency brightness (legacy ×0.85), separate from thickness.
 */
void causticFieldPrep(
  vec2 worldXY,
  vec2 tilt,
  vec2 simUv,
  float foldScale,
  float surfHeight,
  out float lap,
  out vec2 q,
  out vec2 p,
  out vec2 detail,
  out float thickL2,
  out float macroPulse
) {
  lap = causticCurvature(simUv);
  q = causticLookup(worldXY, tilt, lap, foldScale);
  vec2 warpUv = q * 1.65;
#if defined(CAUSTIC_DRIFT) && CAUSTIC_DRIFT == 1
  warpUv += uCausticDriftPhase * vec2(0.83, -0.56);
#endif
  vec2 warp = causticNoise2(warpUv) * 2.0 - 1.0;
  p = q * uCausticNetScale + warp * uCausticNetWarp;
  p += vec2(surfHeight * 14.0, 0.0) * (uCausticNetWarp * 0.55);
  detail = causticNoise2(q * 2.15 + vec2(23.7, -41.3));
  thickL2 = causticNoise2(q * 3.05 + vec2(-17.2, 31.4)).x;
  macroPulse = causticNoise2(q * 0.85 + vec2(5.1, -8.3)).x;
}

/** Worley F2−F1 distances at `p` (E4 reduced-res pass / hybrid composite; variants 1 and 3). */
vec2 causticFieldEdgeDistances(vec2 p, vec2 detail) {
#if CAUSTIC_VARIANT == 1
  vec2 edge = causticWorley(p);
  return vec2(edge.y - edge.x, 0.0);
#else
  vec2 edge1 = causticWorley(p);
  vec2 p2 = p * uCausticLayer2Scale + vec2(119.3, -87.6) + (detail - 0.5) * 0.7;
  vec2 edge2 = causticWorley(p2);
  return vec2(edge1.y - edge1.x, edge2.y - edge2.x);
#endif
}

/**
 * Display-res line shaping from edge distances (hybrid path: distances upsampled, shaping here).
 * `edges` = (e1, e2); variant 2 uses e2 as F3−F2 continuation when hybrid pass stored it.
 */
float causticFieldShape(vec2 edges, vec2 detail, float thickL2, float macroPulse, float lap) {
  float widthScale = 1.0;
  float gain = 1.0;
  float glow = 0.0;
#ifdef CAUSTIC_CONC
  float conc = causticConcentration(lap) * uCausticConc;
  widthScale = max(1.0 + 0.3 * conc, 0.55);
  gain = max(1.0 + 0.5 * conc, 0.4);
  glow = 0.18 * max(conc, 0.0);
#endif

  // E5c luminance: higher floor keeps the field readable; ceiling preserves contrast.
  float pulse = mix(0.74, 1.22, macroPulse);

#if CAUSTIC_VARIANT == 1
  float e = edges.x;
  float thick = mix(0.52, 1.38, detail.x);
  float width = max(max(uCausticNetSharpness, 0.015) * thick * widthScale, 2.0 * fwidth(e));
  float line = 1.0 - smoothstep(0.0, width, e);
  line = pow(max(line, 0.0), mix(1.35, 2.15, 1.0 - thick * 0.32));
  return min(line * 0.70 * pulse * gain + glow, 2.8);
#else
  float sharp = max(uCausticNetSharpness, 0.015) * widthScale;
  float tw = smoothstep(0.18, 0.88, detail.x);
  // Fixed hairline floor thickens fine strands; the softer tw curve lets medium strands widen sooner.
  float hairline = sharp * 0.045;
  float line1Width = sharp * mix(uCausticLineWidth.x, uCausticLineWidth.y, pow(tw, 1.6)) + hairline;
  float line1 = causticLineE3(edges.x, line1Width, tw);
  float tw2 = smoothstep(0.22, 0.88, thickL2);
  float thickB = mix(0.65, 1.25, thickL2);
  float line2Width = sharp * mix(uCausticLineWidth.x, uCausticLineWidth.y * 0.6, pow(tw2, 1.6)) * thickB * 0.85
    + hairline * 0.01;
  float line2 = causticLineE3(edges.y, line2Width, tw2);
  float crossing = line1 * line2;
  // Geometric mean of the two feathered lines: a rounded corona around crossings, peaking on the node.
  float crossBloom = sqrt(max(crossing, 0.0));
  float crossCore = mix(crossing, crossBloom, 0.3);
  float crossW = uCausticCrossGain * mix(0.92, 1.0, smoothstep(0.3, 0.7, macroPulse));
  // Nodes flare where both strands are thick, so bright spots stay sparse and varied.
  float nodeW = mix(0.45, 0.99, smoothstep(0.15, 0.6, tw * tw2));
  float network = line1 * mix(0.66, 0.98, tw) + line2 * uCausticLayer2Gain
    + crossCore * crossW + pow(crossing, 1.25) * nodeW
    + crossBloom * mix(0.22, 0.34, macroPulse);
  float pool = pow(max(network, 0.0), 0.62) * mix(0.07, 0.12, macroPulse);
  return min(network * pulse * gain + glow + pool, 2.8);
#endif
}

/**
 * Single-layer caustic network, 0–~0.83 at rest (legacy primary-layer weight and ranges).
 * `tilt` = surface normal xy; `simUv` locates the smoothed curvature (fold limit, concentration);
 * `foldScale` = normal strength × sim texels per world unit.
 */
float causticField(vec2 worldXY, vec2 tilt, vec2 simUv, float foldScale, float surfHeight) {
  float lap;
  vec2 q;
  vec2 p;
  vec2 detail;
  float thickL2;
  float macroPulse;
  causticFieldPrep(worldXY, tilt, simUv, foldScale, surfHeight, lap, q, p, detail, thickL2, macroPulse);

#if CAUSTIC_VARIANT == 2
  float widthScale = 1.0;
  float gain = 1.0;
  float glow = 0.0;
#ifdef CAUSTIC_CONC
  float conc = causticConcentration(lap) * uCausticConc;
  widthScale = max(1.0 + 0.3 * conc, 0.55);
  gain = max(1.0 + 0.5 * conc, 0.4);
  glow = 0.12 * max(conc, 0.0);
#endif
  float pulse = mix(0.74, 1.22, macroPulse);
  float sharp = max(uCausticNetSharpness, 0.015) * widthScale;
  float tw = smoothstep(0.22, 0.85, detail.x);
  float line1Width = sharp * mix(uCausticLineWidth.x, uCausticLineWidth.y, tw * tw);
  vec4 w = causticWorley3(p);
  float line1 = causticLineE3(w.y - w.x, line1Width, tw);
  float e23 = w.z - w.y;
  float strand = causticLineE3(e23, sharp * mix(uCausticLineWidth.x, uCausticLineWidth.y * 0.22, tw), 0.0);
  strand *= step(1.0 - uCausticStrandCells, w.w);
  float node = pow(line1 * causticLineE3(e23, line1Width, tw), 1.25) * smoothstep(0.42, 0.75, thickL2);
  float network = line1 * mix(0.7, 0.9, tw) + strand * uCausticStrandGain + node * uCausticNodeGain;
  return min(network * pulse * gain + glow, 2.8);
#else
  vec2 edges = causticFieldEdgeDistances(p, detail);
  return causticFieldShape(edges, detail, thickL2, macroPulse, lap);
#endif
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
