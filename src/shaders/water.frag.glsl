uniform vec3 uColorDeep;
uniform vec3 uColorMid;
uniform vec3 uColorShallow;
uniform float uSlopeInfluence;
uniform float uNoiseColorInfluence;

varying float vHeight;
varying float vNoiseVary;
varying vec3 vNormal;

void main() {
  // Softer height remap — reduces hard iso-height “camouflage” blob edges.
  float heightMix = clamp(vHeight * 9.0 + 0.50, 0.0, 1.0);

  // Independent noise breaks color regions that would otherwise match height blobs.
  float noiseMix = clamp(0.5 + vNoiseVary * uNoiseColorInfluence, 0.0, 1.0);

  float slope = 1.0 - clamp(vNormal.z, 0.0, 1.0);
  float slopeTerm = clamp(slope * uSlopeInfluence, 0.0, 0.4);

  // Blend height + noise so neither alone dominates the pattern.
  float tone = clamp(heightMix * 0.62 + noiseMix * 0.38, 0.0, 1.0);

  vec3 lowBand = mix(uColorDeep, uColorMid, smoothstep(0.0, 0.6, tone));
  vec3 color = mix(lowBand, uColorShallow, smoothstep(0.3, 1.0, tone));

  // Slope adds smaller-scale tonal shifts without white caustics.
  color = mix(color, uColorMid, slopeTerm * 0.5);
  color = mix(color, uColorShallow, slopeTerm * 0.22);

  gl_FragColor = vec4(color, 1.0);
}
