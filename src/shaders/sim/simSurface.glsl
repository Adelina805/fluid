// Surface shape from the simulation state (R = height). The sim is the only
// source of surface geometry; sample at any resolution with visible-area-mapped uv.
// Define SIM_CUBIC for cubic B-spline height (C1-smooth normals, 4× the fetches).

float simHeight(sampler2D state, vec2 uv, vec2 gridSize) {
#ifdef SIM_CUBIC
  // Cubic B-spline from 4 bilinear taps (weights folded into the tap offsets).
  vec2 p = uv * gridSize - 0.5;
  vec2 base = floor(p);
  vec2 f = p - base;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1;
  vec2 g1 = w2 + w3;
  vec2 t0 = (base - 0.5 + w1 / g0) / gridSize;
  vec2 t1 = (base + 1.5 + w3 / g1) / gridSize;
  return g0.y * (g0.x * texture2D(state, vec2(t0.x, t0.y)).r + g1.x * texture2D(state, vec2(t1.x, t0.y)).r) +
         g1.y * (g0.x * texture2D(state, vec2(t0.x, t1.y)).r + g1.x * texture2D(state, vec2(t1.x, t1.y)).r);
#else
  return texture2D(state, uv).r;
#endif
}

// Central differences one texel apart. Each tap is filtered, so the slope varies
// continuously across texel cells (no blocks or stair-steps when magnified).
// `strength` scales slope (height per sim texel) before normalizing; z is up.
vec3 simNormal(sampler2D state, vec2 uv, vec2 gridSize, float strength) {
  vec2 texel = 1.0 / gridSize;
  float hL = simHeight(state, uv - vec2(texel.x, 0.0), gridSize);
  float hR = simHeight(state, uv + vec2(texel.x, 0.0), gridSize);
  float hD = simHeight(state, uv - vec2(0.0, texel.y), gridSize);
  float hU = simHeight(state, uv + vec2(0.0, texel.y), gridSize);
  vec2 slope = 0.5 * vec2(hR - hL, hU - hD);
  return normalize(vec3(-strength * slope, 1.0));
}
