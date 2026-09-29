// Stage A — one wave-equation step on the low-res heightfield.
// State texel: R = height, G = vertical velocity (per step).

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
// Gaussian test impulse: xy = center (texels), z = radius (texels), w = amplitude (0 = none).
uniform vec4 uImpulse;

vec2 fetchState(ivec2 p, ivec2 size) {
  return texelFetch(uState, clamp(p, ivec2(0), size - 1), 0).rg;
}

void main() {
  ivec2 size = ivec2(uGridSize);
  ivec2 p = ivec2(gl_FragCoord.xy);

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
  h = (h + v) * heightRelax;

  if (uImpulse.w != 0.0) {
    vec2 offset = vec2(p) + 0.5 - uImpulse.xy;
    h += uImpulse.w * exp(-dot(offset, offset) / (uImpulse.z * uImpulse.z));
  }

  h = clamp(h, -uStateClamp, uStateClamp);
  v = clamp(v, -uStateClamp, uStateClamp);

  gl_FragColor = vec4(h, v, 0.0, 1.0);
}
