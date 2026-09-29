// Temporary sim debug views: height as grayscale around mid-gray (Stage A), or
// RGB-encoded surface normals (Stage C). Prepended with sim/simSurface.glsl.

uniform sampler2D uState;
// Full grid size in texels, including the sponge margin.
uniform vec2 uGridSize;
// Sponge margin width in texels.
uniform float uPadding;
// Height → brightness multiplier.
uniform float uGain;
// 0 = visible area only; 1 = whole grid with the sponge margin tinted.
uniform float uShowPadding;
// 0 = height, 1 = normals.
uniform int uView;
// Slope (height per sim texel) → normal tilt multiplier.
uniform float uNormalStrength;

varying vec2 vUv;

void main() {
  vec2 padUv = vec2(uPadding) / uGridSize;
  vec2 uv = uShowPadding > 0.5 ? vUv : padUv + vUv * (1.0 - 2.0 * padUv);

  vec3 color;
  if (uView == 1) {
    // Flat water encodes as (0.5, 0.5, 1.0); normals facing right read redder, facing up greener.
    color = simNormal(uState, uv, uGridSize, uNormalStrength) * 0.5 + 0.5;
  } else {
    float h = texture2D(uState, uv).r;
    color = vec3(clamp(0.5 + h * uGain, 0.0, 1.0));
  }

  if (uShowPadding > 0.5) {
    bool inMargin = any(lessThan(uv, padUv)) || any(greaterThan(uv, 1.0 - padUv));
    if (inMargin) {
      color *= vec3(1.0, 0.78, 0.78);
    }
  }

  gl_FragColor = vec4(color, 1.0);
}
