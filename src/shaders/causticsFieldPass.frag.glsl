// Stage E4 — reduced-resolution caustic field pass (`causticRes=half|quarter|halfHybrid`).
// Prepended with sim/simSurface.glsl and caustics.glsl (same defines as the composite).
// CAUSTIC_PASS_HYBRID: R = e1, G = e2 (display-res shaping in the composite).
// Otherwise: R = shaped netRaw (upsample in the composite).

uniform sampler2D uState;
uniform vec2 uGridSize;
uniform float uPadding;
uniform float uNormalStrength;
uniform float uSimHeightScale;
uniform vec2 uWorldScale;

varying vec2 vUv;

void main() {
  vec2 padUv = vec2(uPadding) / uGridSize;
  vec2 simUv = padUv + vUv * (1.0 - 2.0 * padUv);
  vec3 surfNormal = simNormal(uState, simUv, uGridSize, uNormalStrength);
  vec2 worldXY = (vUv * 2.0 - 1.0) * uWorldScale;
  float surfHeight = simHeight(uState, simUv, uGridSize) * uSimHeightScale;
  float foldScale = uNormalStrength * (uGridSize.y - 2.0 * uPadding) / (2.0 * uWorldScale.y);

  float lap;
  vec2 q;
  vec2 p;
  vec2 detail;
  float thickL2;
  float macroPulse;
  causticFieldPrep(worldXY, surfNormal.xy, simUv, foldScale, surfHeight, lap, q, p, detail, thickL2, macroPulse);

#ifdef CAUSTIC_PASS_HYBRID
#if CAUSTIC_VARIANT == 2
  gl_FragColor = vec4(causticField(worldXY, surfNormal.xy, simUv, foldScale, surfHeight), 0.0, 0.0, 1.0);
#else
  vec2 edges = causticFieldEdgeDistances(p, detail);
  gl_FragColor = vec4(edges, 0.0, 1.0);
#endif
#else
  float net = causticField(worldXY, surfNormal.xy, simUv, foldScale, surfHeight);
  gl_FragColor = vec4(net, 0.0, 0.0, 1.0);
#endif
}
