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
uniform float uViewBrightness;
uniform float uCausticSoftStrength;

varying float vHeight;
varying float vNoiseVary;
varying vec3 vNormal;
varying vec3 vWorldPos;

void main() {
  // --- Phase 2 albedo (cool height / noise / slope tint) ---
  float heightMix = clamp(vHeight * 9.0 + 0.50, 0.0, 1.0);
  float noiseMix = clamp(0.5 + vNoiseVary * uNoiseColorInfluence, 0.0, 1.0);

  float slope = 1.0 - clamp(vNormal.z, 0.0, 1.0);
  float slopeTerm = clamp(slope * uSlopeInfluence, 0.0, 0.4);

  float tone = clamp(heightMix * 0.62 + noiseMix * 0.38, 0.0, 1.0);

  vec3 lowBand = mix(uColorDeep, uColorMid, smoothstep(0.0, 0.6, tone));
  vec3 albedo = mix(lowBand, uColorShallow, smoothstep(0.3, 1.0, tone));
  albedo = mix(albedo, uColorMid, slopeTerm * 0.5);
  albedo = mix(albedo, uColorShallow, slopeTerm * 0.22);

  // --- Lighting vectors ---
  vec3 N = normalize(vNormal);
  vec3 L = normalize(uLightDir);
  vec3 V = normalize(uCameraPosition - vWorldPos);
  vec3 H = normalize(L + V);

  float NdotL = max(dot(N, L), 0.0);
  float NdotH = max(dot(N, H), 0.0);
  float NdotV = max(dot(N, V), 0.0);

  // Local tilt of the surface in the XY plane (from existing normals — no new noise).
  vec2 nxy = N.xy;
  float tiltMag = length(nxy);
  vec2 tiltDir = nxy / max(tiltMag, 1e-4);
  vec2 lightXY = normalize(L.xy + vec2(1e-4));
  // How the local ridge orientation relates to the light — breaks parallel banding.
  float tiltAlign = abs(dot(tiltDir, lightXY));
  float tiltCross = abs(tiltDir.x * lightXY.y - tiltDir.y * lightXY.x);

  // Soft diffuse — slightly more directional contrast than the first pass.
  vec3 diffuse = uAmbient + uLightColor * NdotL;
  vec3 color = albedo * diffuse;

  // --- Dual-lobe specular: broad soft + occasional narrower concentrations ---
  // Soft lobe: glossy water sheen, still calm.
  float softSpec = pow(NdotH, uShininess) * uSpecularStrength;
  softSpec *= mix(0.7, 1.05, NdotL);

  // Narrow lobe: only where lit ridges / tilt peaks concentrate (not everywhere).
  float concentrate = smoothstep(0.18, 0.52, slope)
    * smoothstep(0.45, 0.92, NdotL)
    * mix(0.35, 1.0, tiltAlign);
  // Existing height + noise-vary gates so concentrations break, merge, and skip flats.
  float structureGate = mix(0.4, 1.0, clamp(abs(vNoiseVary), 0.0, 1.0))
    * mix(0.55, 1.0, smoothstep(0.15, 0.55, abs(vHeight) * 14.0));
  float narrowSpec = pow(NdotH, uShininessNarrow)
    * uSpecularNarrowStrength
    * concentrate
    * structureGate;

  float spec = softSpec + narrowSpec;
  // Strongest hits lean pale cyan → near-white; soft sheen stays tinted.
  float hot = smoothstep(0.08, 0.35, narrowSpec);
  vec3 specTint = mix(uSpecularColor, vec3(0.96, 0.99, 1.0), hot * 0.72);
  color += specTint * spec;

  // Subtle top-down view lift (not Fresnel).
  float viewLift = pow(NdotV, 1.45) * uViewBrightness;
  color += albedo * viewLift * 0.5;
  color += uSpecularColor * viewLift * 0.12;

  // --- Soft caustic-like streaks (hint only — not sharp webs) ---
  // Broad soft illumination band (daylight fill on tilted faces).
  float softBand = smoothstep(0.28, 0.78, NdotL) * smoothstep(0.04, 0.32, slope);

  // Medium curved streaks follow local tilt; mix align + cross so they are not parallel.
  float medCore = smoothstep(0.32, 0.88, NdotL)
    * smoothstep(0.08, 0.48, tiltMag)
    * mix(0.55, 1.0, tiltCross * 0.65 + tiltAlign * 0.35);
  // Width varies with tilt magnitude; continuity breaks via height / noise structure.
  float widthVar = mix(1.35, 0.75, smoothstep(0.1, 0.45, tiltMag));
  float medBand = pow(medCore, widthVar)
    * mix(0.45, 1.0, clamp(0.5 + vNoiseVary * 0.55, 0.0, 1.0))
    * mix(0.6, 1.0, abs(heightMix - 0.5) * 1.6);

  // Occasional brighter knots where soft + medium + narrow conditions meet (intersections).
  float intersect = softBand * medBand * concentrate;
  float brightKnot = pow(intersect, 1.15) * mix(0.8, 1.35, structureGate);

  // Weaker secondary ribbon from narrow specular — broken, not a uniform grid.
  float ribbon = narrowSpec * 2.2 * smoothstep(0.1, 0.4, tiltMag);

  float streak = (softBand * 0.35 + medBand * 0.75 + brightKnot * 1.1 + ribbon * 0.55)
    * uCausticSoftStrength;

  // Streak color: mostly pale cyan; knots push nearer white without washing the field.
  vec3 streakTint = mix(mix(albedo, uSpecularColor, 0.5), vec3(0.94, 0.98, 1.0), brightKnot * 0.55);
  color += streakTint * streak;

  color = clamp(color, 0.0, 1.0);

  gl_FragColor = vec4(color, 1.0);
}
