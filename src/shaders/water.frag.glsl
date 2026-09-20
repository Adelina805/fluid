uniform vec3 uColorDeep;
uniform vec3 uColorShallow;

varying float vHeight;
varying vec2 vUv;

void main() {
  // Height drives the mix; keep the range soft so troughs stay mid-blue, not navy.
  float heightMix = clamp(vHeight * 14.0 + 0.52, 0.0, 1.0);

  vec3 color = mix(uColorDeep, uColorShallow, heightMix);
  gl_FragColor = vec4(color, 1.0);
}
