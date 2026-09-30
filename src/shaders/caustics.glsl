// Stage E1 — rebuilt caustic field (prototype, `?sim&water&caustics=new`).
// Same visual design as the legacy Phase 6.5 network (domain-warped Worley F2−F1 ridges,
// noise-varied thickness, brightness pulse) at a fraction of the cost: no trigonometry,
// one Worley pass, two vec2 value-noise lookups. Not yet coupled to the simulated surface.
// Prepended to surface.frag.glsl after sim/simSurface.glsl.

uniform float uCausticNetIntensity;
uniform float uCausticNetScale;
uniform float uCausticNetSharpness;
uniform float uCausticNetWarp;
uniform vec3 uCausticTint;
uniform vec3 uCausticHot;

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

// Static Worley F1 / F2 (3×3 search). Jitter uses a parabolic sine, 8t(1 − 2|t|), so cell
// sites keep the legacy 0.5 + 0.5·sin(2π·hash) distribution (bunched toward cell borders,
// which gives the irregular cell sizes). Squared distances in the loop; two sqrt at the end.
vec2 causticWorley(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float d1 = 64.0;
  float d2 = 64.0;

  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 s = causticHash22(n + g) - 0.5;
      vec2 site = 0.5 + 4.0 * s * (1.0 - 2.0 * abs(s));
      vec2 r = g + site - f;
      float d = dot(r, r);
      d2 = min(d2, max(d1, d));
      d1 = min(d1, d);
    }
  }

  return sqrt(vec2(d1, d2));
}

/** Single-layer caustic network, 0–~0.83 (legacy primary-layer weight and ranges). */
float causticField(vec2 worldXY) {
  vec2 warp = causticNoise2(worldXY * 1.65) * 2.0 - 1.0;
  vec2 p = worldXY * uCausticNetScale + warp * uCausticNetWarp;

  vec2 edge = causticWorley(p);
  float e = edge.y - edge.x;

  // x → line thickness (legacy thickA scale), y → brightness pulse.
  vec2 detail = causticNoise2(worldXY * 2.15 + vec2(23.7, -41.3));
  float thick = mix(0.52, 1.38, detail.x);

  // Never narrower than ~2 px, whatever the DPR or local compression of the web.
  float width = max(max(uCausticNetSharpness, 0.015) * thick, 2.0 * fwidth(e));
  float line = 1.0 - smoothstep(0.0, width, e);
  line = pow(max(line, 0.0), mix(1.35, 2.15, 1.0 - thick * 0.32));

  float pulse = mix(0.62, 1.18, detail.y);
  return line * 0.70 * pulse;
}
