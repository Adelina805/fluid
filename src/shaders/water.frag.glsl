uniform float uTime;

uniform vec3 uColorDeep;
uniform vec3 uColorMid;
uniform vec3 uColorShallow;
uniform float uSlopeInfluence;
uniform float uNoiseColorInfluence;

// Phase 3 — directional Blinn-Phong lighting (world space).
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uAmbient;
uniform vec3 uSpecularColor;
uniform float uSpecularStrength;
uniform float uShininess;
uniform float uShininessNarrow;
uniform float uSpecularNarrowStrength;
uniform vec3 uCameraPosition;
uniform float uCausticSoftStrength;

// Phase 4 — Fresnel + optical blend + soft refraction-like distortion.
uniform float uFresnelF0;
uniform float uFresnelPower;
uniform float uFresnelStrength;
uniform float uFresnelViewContrast;
uniform float uOpticalBalance;
uniform float uDistortionStrength;
uniform float uColorDepthStrength;
// 0 = full composite; 1 = Fresnel; 2 = distortion; 3 = base color; 4 = lighting only.
uniform float uDebugOptics;

// Phase 6.5 — fine caustic network (DEV-tunable).
uniform float uCausticNetIntensity;
uniform float uCausticNetScale;
uniform float uCausticNetSharpness;
uniform float uCausticNetWarp;
uniform float uCausticNetSpeed;

varying float vHeight;
varying float vNoiseVary;
varying vec3 vNormal;
varying vec3 vWorldPos;

/** Compact hash / value noise for caustic domain warp (fragment-local). */
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

/**
 * Animated Worley F1/F2. Cell centers drift slowly so ridges bend, merge,
 * and reform — not a translating texture.
 */
vec2 worleyF1F2(vec2 p, float t) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;

  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = causticHash22(n + g);
      // Organic cell motion from seeded phase (avoids uniform slide).
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

/**
 * Phase 6.5 fine caustic network.
 * Dual-scale Worley edge ridges (F2−F1), domain-warped by procedural noise
 * and existing surface normal / height so the web rides the water.
 */
float causticNetwork(vec2 worldXY) {
  float t = uTime * uCausticNetSpeed;

  vec2 warpNoise = vec2(
    causticValueNoise(worldXY * 1.65 + vec2(t * 0.29, -t * 0.21)),
    causticValueNoise(worldXY * 1.65 + vec2(11.4, -4.8) + vec2(-t * 0.18, t * 0.25))
  ) * 2.0 - 1.0;

  vec2 p = worldXY * uCausticNetScale;
  p += warpNoise * uCausticNetWarp;
  // Tie to underlying water: ridge tilt + height/noise bend the domain.
  p += vNormal.xy * (uCausticNetWarp * 1.85);
  p += vec2(vHeight * 14.0, vNoiseVary) * (uCausticNetWarp * 0.55);
  // Very slow residual drift — evolution is mostly cell motion + warp.
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

  // Primary + finer secondary; product brightens branch intersections.
  float network = line1 * 0.70 + line2 * 0.46 + line1 * line2 * 0.90;
  float nodes = pow(line1 * line2, 1.25);
  network += nodes * 0.50;

  // Local brightness variation so the web is not uniformly lit.
  float pulse = mix(
    0.62,
    1.18,
    causticValueNoise(worldXY * 0.85 + vec2(t * 0.07, t * 0.055))
  );
  return clamp(network * pulse, 0.0, 2.8);
}

/** Three-stop cool albedo from a scalar tone + slope pull (Phase 2 color model). */
vec3 albedoFromTone(float tone, float slopeTerm) {
  vec3 lowBand = mix(uColorDeep, uColorMid, smoothstep(0.0, 0.6, tone));
  vec3 albedo = mix(lowBand, uColorShallow, smoothstep(0.3, 1.0, tone));
  albedo = mix(albedo, uColorMid, slopeTerm * 0.5);
  albedo = mix(albedo, uColorShallow, slopeTerm * 0.22);
  return albedo;
}

void main() {
  // --- Phase 2 base tone (cool height / noise / slope) ---
  float heightMix = clamp(vHeight * 9.0 + 0.50, 0.0, 1.0);
  float noiseMix = clamp(0.5 + vNoiseVary * uNoiseColorInfluence, 0.0, 1.0);

  float slope = 1.0 - clamp(vNormal.z, 0.0, 1.0);
  float slopeTerm = clamp(slope * uSlopeInfluence, 0.0, 0.4);

  float tone = clamp(heightMix * 0.62 + noiseMix * 0.38, 0.0, 1.0);
  vec3 baseAlbedo = albedoFromTone(tone, slopeTerm);
  vec3 albedo = baseAlbedo;

  // --- Lighting vectors ---
  vec3 N = normalize(vNormal);
  vec3 L = normalize(uLightDir);
  vec3 V = normalize(uCameraPosition - vWorldPos);
  vec3 H = normalize(L + V);

  float NdotL = max(dot(N, L), 0.0);
  float NdotH = max(dot(N, H), 0.0);
  float NdotV = max(dot(N, V), 0.0);

  vec2 nxy = N.xy;
  float tiltMag = length(nxy);
  vec2 tiltDir = nxy / max(tiltMag, 1e-4);
  vec2 lightXY = normalize(L.xy + vec2(1e-4));
  float tiltAlign = abs(dot(tiltDir, lightXY));
  float tiltCross = abs(tiltDir.x * lightXY.y - tiltDir.y * lightXY.x);

  // --- Phase 4: Schlick Fresnel with top-down view contrast ---
  // Under strict top-down, N·V lives in a tiny band near 1.0. Raising N·V to
  // uFresnelViewContrast expands mild ridge tilts into a usable Schlick range
  // without tilting the camera or going metallic.
  float ndvArt = pow(NdotV, max(uFresnelViewContrast, 1.0));
  float fresnel = uFresnelF0 + (1.0 - uFresnelF0) * pow(max(1.0 - ndvArt, 0.0), uFresnelPower);
  fresnel = clamp(fresnel * uFresnelStrength, 0.0, 1.0);

  // Reflective ↔ translucent: ridges glassier; face-on keeps rich water body.
  float reflectW = clamp(fresnel * mix(0.55, 0.95, uOpticalBalance), 0.0, 1.0);
  float transW = 1.0 - reflectW;
  // Pale accents only on stronger Fresnel — avoids washing the whole frame.
  float paleMask = smoothstep(0.22, 0.58, fresnel);

  // --- Refraction-like distortion of the analytic color field ---
  vec2 offset = nxy * uDistortionStrength;
  float toneDistort = clamp(tone + offset.x * 0.85 + offset.y * 0.65, 0.0, 1.0);
  vec3 refracted = albedoFromTone(toneDistort, slopeTerm);
  // Mild opposite R/B shift — liquid, not psychedelic.
  float toneR = clamp(toneDistort - offset.x * 0.45, 0.0, 1.0);
  float toneB = clamp(toneDistort + offset.y * 0.45, 0.0, 1.0);
  refracted.r = mix(refracted.r, albedoFromTone(toneR, slopeTerm).r, 0.45);
  refracted.b = mix(refracted.b, albedoFromTone(toneB, slopeTerm).b, 0.45);
  // Distortion mainly in transmitted regions.
  albedo = mix(albedo, refracted, transW * 0.92);

  // --- Optical color depth (balanced: rich mid-blue dominant, pale accent only) ---
  // Looking INTO water: restore saturated deep/mid blues under the glass.
  // Looking OFF water: subtle cooler lift; near-white only via paleMask.
  vec3 deepBody = mix(uColorDeep * 0.94, uColorMid * 0.92, 0.28);
  vec3 midBody = uColorMid;
  vec3 transmitCyan = mix(uColorShallow, vec3(0.55, 0.78, 0.86), 0.22);
  vec3 paleSheen = mix(uSpecularColor, vec3(0.82, 0.92, 0.96), 0.28);

  float depthAmt = uColorDepthStrength;
  // Pull albedo back toward mid cerulean so the field stays blue-dominant.
  albedo = mix(albedo, midBody, transW * depthAmt * 0.22);
  float thick = depthAmt * transW * mix(0.5, 1.0, 1.0 - heightMix) * mix(0.75, 1.0, NdotV);
  albedo = mix(albedo, deepBody, thick * 0.62);
  float clarity = depthAmt * transW * mix(0.25, 0.85, heightMix) * NdotV;
  albedo = mix(albedo, transmitCyan, clarity * 0.26);
  albedo = mix(albedo, paleSheen, reflectW * depthAmt * 0.26 * paleMask);

  // Soft diffuse
  vec3 diffuse = uAmbient + uLightColor * NdotL;
  vec3 color = albedo * diffuse;

  // --- Dual-lobe specular — localized; less blown-out white ---
  float specScale = mix(0.48, 0.88, uOpticalBalance) * mix(0.7, 1.05, reflectW);

  float softSpec = pow(NdotH, uShininess) * uSpecularStrength;
  softSpec *= mix(0.7, 1.05, NdotL);

  float concentrate = smoothstep(0.18, 0.52, slope)
    * smoothstep(0.45, 0.92, NdotL)
    * mix(0.35, 1.0, tiltAlign);
  float structureGate = mix(0.4, 1.0, clamp(abs(vNoiseVary), 0.0, 1.0))
    * mix(0.55, 1.0, smoothstep(0.15, 0.55, abs(vHeight) * 14.0));
  float narrowSpec = pow(NdotH, uShininessNarrow)
    * uSpecularNarrowStrength
    * concentrate
    * structureGate;
  // Default strength (0.24) keeps the original gate. Higher values open it
  // so the narrow-specular slider is actually visible under top-down lighting.
  float narrowOpen = clamp((uSpecularNarrowStrength - 0.24) * 0.22, 0.0, 0.82);
  narrowSpec = mix(narrowSpec, pow(NdotH, uShininessNarrow) * uSpecularNarrowStrength * max(concentrate, 0.42), narrowOpen);

  float spec = (softSpec + narrowSpec) * specScale;
  float hot = smoothstep(0.12, 0.42, narrowSpec);
  // Keep specular tinted cyan so underlying blue shows through.
  vec3 specTint = mix(uSpecularColor, vec3(0.90, 0.96, 0.99), hot * 0.4);
  color += specTint * spec;

  // Fresnel glassy contribution — restrained; pale only where paleMask is high.
  vec3 fresnelTint = mix(uColorShallow, uSpecularColor, 0.55);
  color += fresnelTint * reflectW * mix(0.10, 0.22, uOpticalBalance);
  color += mix(uSpecularColor, vec3(0.92, 0.97, 1.0), 0.35) * reflectW * paleMask * 0.12;

  // Transmission: slight depth absorb; minimal cyan lift (avoid frost wash).
  color *= mix(0.94, 1.0, mix(transW, 1.0, 0.65));
  color += transmitCyan * transW * NdotV * 0.035;
  color += deepBody * transW * (1.0 - heightMix) * 0.06;

  // --- Soft caustic-like streaks (hint only; Phase 3 macro layer) ---
  float softBand = smoothstep(0.28, 0.78, NdotL) * smoothstep(0.04, 0.32, slope);

  float medCore = smoothstep(0.32, 0.88, NdotL)
    * smoothstep(0.08, 0.48, tiltMag)
    * mix(0.55, 1.0, tiltCross * 0.65 + tiltAlign * 0.35);
  float widthVar = mix(1.35, 0.75, smoothstep(0.1, 0.45, tiltMag));
  float medBand = pow(medCore, widthVar)
    * mix(0.45, 1.0, clamp(0.5 + vNoiseVary * 0.55, 0.0, 1.0))
    * mix(0.6, 1.0, abs(heightMix - 0.5) * 1.6);

  float intersect = softBand * medBand * concentrate;
  float brightKnot = pow(intersect, 1.15) * mix(0.8, 1.35, structureGate);

  float ribbon = narrowSpec * 2.2 * smoothstep(0.1, 0.4, tiltMag);

  float streak = (softBand * 0.35 + medBand * 0.75 + brightKnot * 1.1 + ribbon * 0.55)
    * uCausticSoftStrength;

  vec3 streakTint = mix(mix(albedo, uSpecularColor, 0.35), vec3(0.88, 0.95, 0.98), brightKnot * 0.3);
  color += streakTint * streak;

  // --- Phase 6.5: fine interconnected caustic network (micro layer) ---
  // Kept separate from softCaustics — do not "fix" soft streaks by raising them.
  float net = causticNetwork(vWorldPos.xy);
  // Soft gate so lines concentrate on lit / gently sloping water, not a flat overlay.
  float netGate = mix(0.52, 1.0, softBand) * mix(0.68, 1.05, NdotL);
  net *= netGate * uCausticNetIntensity;
  float netHot = smoothstep(0.35, 1.15, net);
  // Pale cyan → blue-white at rare strong nodes; blue body remains visible.
  vec3 netTint = mix(
    mix(vec3(0.48, 0.78, 0.88), uSpecularColor, 0.35),
    vec3(0.90, 0.97, 1.0),
    netHot * 0.72
  );
  color += netTint * net * 0.42;

  color = clamp(color, 0.0, 1.0);

  // --- Internal diagnostic modes (no UI; set uDebugOptics in createWaterMesh) ---
  int dbg = int(uDebugOptics + 0.5);
  if (dbg == 1) {
    // Fresnel only — dark blue → pale cyan maps F.
    color = mix(vec3(0.05, 0.12, 0.22), vec3(0.85, 0.95, 1.0), fresnel);
  } else if (dbg == 2) {
    // Distortion only — show refracted vs base difference amplified.
    vec3 delta = refracted - baseAlbedo;
    color = vec3(0.5) + delta * 4.0;
  } else if (dbg == 3) {
    // Base / optical albedo only (no lighting).
    color = albedo;
  } else if (dbg == 4) {
    // Lighting only on flat mid color.
    color = uColorMid * diffuse + specTint * spec;
  }

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
