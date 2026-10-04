// Stage E2 — smoothed sim-height curvature for the caustic coupling (sim resolution, two passes).
// Separable Laplacian of Gaussian: ∇²(G∗h) = G''x·Gy∗h + Gx·G''y∗h.
//   PASS_X: R = Gx∗h, G = G''x∗h (from the sim state's height channel).
//   PASS_Y: R = G''y∗R + Gy∗G = smoothed Laplacian, per sim texel².
// The Gaussian removes drag beading and dispersive trains (2–4 texels) that a small stencil
// passes as harsh stripes, while keeping tap rings and wakes. Only the caustics read it.

uniform sampler2D uSource;
// One texel along the pass axis (uv units).
uniform vec2 uStep;
// Symmetric kernel taps 0…KERNEL_RADIUS: Gaussian and its second derivative.
uniform float uGauss[KERNEL_RADIUS + 1];
uniform float uGauss2[KERNEL_RADIUS + 1];

varying vec2 vUv;

void main() {
#ifdef PASS_X
  float h = texture2D(uSource, vUv).r;
  float g = uGauss[0] * h;
  float g2 = uGauss2[0] * h;
  for (int i = 1; i <= KERNEL_RADIUS; i++) {
    vec2 offset = uStep * float(i);
    float pair = texture2D(uSource, vUv + offset).r + texture2D(uSource, vUv - offset).r;
    g += uGauss[i] * pair;
    g2 += uGauss2[i] * pair;
  }
  gl_FragColor = vec4(g, g2, 0.0, 1.0);
#else
  vec2 s = texture2D(uSource, vUv).rg;
  float lap = uGauss2[0] * s.x + uGauss[0] * s.y;
  for (int i = 1; i <= KERNEL_RADIUS; i++) {
    vec2 offset = uStep * float(i);
    vec2 pair = texture2D(uSource, vUv + offset).rg + texture2D(uSource, vUv - offset).rg;
    lap += uGauss2[i] * pair.x + uGauss[i] * pair.y;
  }
  gl_FragColor = vec4(lap, 0.0, 0.0, 1.0);
#endif
}
