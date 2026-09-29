// Stage A — temporary debug view: height as grayscale around mid-gray.

uniform sampler2D uState;
// Full grid size in texels, including the sponge margin.
uniform vec2 uGridSize;
// Sponge margin width in texels.
uniform float uPadding;
// Height → brightness multiplier.
uniform float uGain;
// 0 = visible area only; 1 = whole grid with the sponge margin tinted.
uniform float uShowPadding;

varying vec2 vUv;

void main() {
  vec2 padUv = vec2(uPadding) / uGridSize;
  vec2 uv = uShowPadding > 0.5 ? vUv : padUv + vUv * (1.0 - 2.0 * padUv);

  float h = texture2D(uState, uv).r;
  vec3 color = vec3(clamp(0.5 + h * uGain, 0.0, 1.0));

  if (uShowPadding > 0.5) {
    bool inMargin = any(lessThan(uv, padUv)) || any(greaterThan(uv, 1.0 - padUv));
    if (inMargin) {
      color *= vec3(1.0, 0.78, 0.78);
    }
  }

  gl_FragColor = vec4(color, 1.0);
}
