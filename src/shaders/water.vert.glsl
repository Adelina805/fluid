uniform float uTime;
uniform vec2 uWorldScale;

uniform vec2 uWaveADir;
uniform float uWaveAFrequency;
uniform float uWaveAAmplitude;
uniform float uWaveASpeed;
uniform float uWaveAPhase;

uniform vec2 uWaveBDir;
uniform float uWaveBFrequency;
uniform float uWaveBAmplitude;
uniform float uWaveBSpeed;
uniform float uWaveBPhase;

uniform vec2 uWaveCDir;
uniform float uWaveCFrequency;
uniform float uWaveCAmplitude;
uniform float uWaveCSpeed;
uniform float uWaveCPhase;

varying float vHeight;
varying vec2 vUv;

float wave(vec2 pos, vec2 dir, float frequency, float amplitude, float speed, float phase) {
  return amplitude * sin(dot(pos, dir) * frequency + uTime * speed + phase);
}

void main() {
  vUv = uv;

  // Wave math in world XY so non-uniform plane scale does not stretch the pattern.
  vec2 worldXY = position.xy * uWorldScale;

  float h = 0.0;
  h += wave(worldXY, uWaveADir, uWaveAFrequency, uWaveAAmplitude, uWaveASpeed, uWaveAPhase);
  h += wave(worldXY, uWaveBDir, uWaveBFrequency, uWaveBAmplitude, uWaveBSpeed, uWaveBPhase);
  h += wave(worldXY, uWaveCDir, uWaveCFrequency, uWaveCAmplitude, uWaveCSpeed, uWaveCPhase);

  vHeight = h;

  vec3 displaced = position;
  displaced.z += h;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
