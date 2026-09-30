// Stage E0 — dev-only comparison port of the legacy Phase 6.5 caustic network.
// Math is copied unchanged from `causticNetwork` in water.frag.glsl (fract(sin) hashes,
// two animated Worley passes, five value-noise calls). Only prepended to the sim composite
// for `?sim&water&caustics=legacy`; never part of a production shader.
// The legacy varyings become arguments: vNormal → surfNormal, vHeight → surfHeight,
// vNoiseVary → noiseVary.

uniform float uTime;
uniform float uCausticNetIntensity;
uniform float uCausticNetScale;
uniform float uCausticNetSharpness;
uniform float uCausticNetWarp;
uniform float uCausticNetSpeed;
uniform vec3 uCausticTint;
uniform vec3 uCausticHot;

float causticHash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec2 causticHash22(vec2 p) {
  return fract(
    sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453
  );
}

float causticValueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = causticHash21(i);
  float b = causticHash21(i + vec2(1.0, 0.0));
  float c = causticHash21(i + vec2(0.0, 1.0));
  float d = causticHash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

vec2 worleyF1F2(vec2 p, float t) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;

  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = causticHash22(n + g);
      vec2 cell = 0.5 + 0.5 * sin(vec2(t) + 6.2831853 * o);
      vec2 r = g + cell - f;
      float dist = length(r);
      if (dist < f1) {
        f2 = f1;
        f1 = dist;
      } else if (dist < f2) {
        f2 = dist;
      }
    }
  }

  return vec2(f1, f2);
}

float causticNetwork(vec2 worldXY, vec3 surfNormal, float surfHeight, float noiseVary) {
  float t = uTime * uCausticNetSpeed;

  vec2 warpNoise = vec2(
    causticValueNoise(worldXY * 1.65 + vec2(t * 0.29, -t * 0.21)),
    causticValueNoise(worldXY * 1.65 + vec2(11.4, -4.8) + vec2(-t * 0.18, t * 0.25))
  ) * 2.0 - 1.0;

  vec2 p = worldXY * uCausticNetScale;
  p += warpNoise * uCausticNetWarp;
  p += surfNormal.xy * (uCausticNetWarp * 1.85);
  p += vec2(surfHeight * 14.0, noiseVary) * (uCausticNetWarp * 0.55);
  p += vec2(t * 0.045, -t * 0.033);

  vec2 w1 = worleyF1F2(p, t * 0.82);
  vec2 w2 = worleyF1F2(p * 1.71 + vec2(19.3, -7.6), t * 1.05 + 2.4);

  float sharp = max(uCausticNetSharpness, 0.015);
  float thickA = mix(0.52, 1.38, causticValueNoise(worldXY * 2.15 + t * 0.12));
  float thickB = mix(0.65, 1.25, causticValueNoise(worldXY * 3.05 - t * 0.09));

  float e1 = w1.y - w1.x;
  float e2 = w2.y - w2.x;

  float line1 = 1.0 - smoothstep(0.0, sharp * thickA, e1);
  float line2 = 1.0 - smoothstep(0.0, sharp * thickB * 0.85, e2);
  line1 = pow(max(line1, 0.0), mix(1.35, 2.15, 1.0 - thickA * 0.32));
  line2 = pow(max(line2, 0.0), 1.75);

  float network = line1 * 0.70 + line2 * 0.46 + line1 * line2 * 0.90;
  float nodes = pow(line1 * line2, 1.25);
  network += nodes * 0.50;

  float pulse = mix(
    0.62,
    1.18,
    causticValueNoise(worldXY * 0.85 + vec2(t * 0.07, t * 0.055))
  );
  return clamp(network * pulse, 0.0, 2.8);
}
