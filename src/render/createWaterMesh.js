import { Color, Mesh, PlaneGeometry, ShaderMaterial, Vector2 } from 'three';
import vertexShader from '../shaders/water.vert.glsl?raw';
import fragmentShader from '../shaders/water.frag.glsl?raw';

/** Medium cool blue — depth without near-navy troughs. */
export const COLOR_DEEP = new Color(0x2f86a8);

/** Soft cyan crests — cooler than bright turquoise. */
export const COLOR_SHALLOW = new Color(0x5eb8cc);

/**
 * Three sine layers with staggered scales, skewed directions, and
 * mismatched rates so interference stays irregular (still no noise).
 */
export const WAVE_A = {
  // Broader, slow-leaning sweep
  dir: new Vector2(0.84, 0.54).normalize(),
  frequency: 5.2,
  amplitude: 0.017,
  speed: 0.20,
  phase: 0.37,
};

export const WAVE_B = {
  // Mid-scale, oblique to A (not perpendicular)
  dir: new Vector2(-0.71, 0.61).normalize(),
  frequency: 12.6,
  amplitude: 0.010,
  speed: 0.13,
  phase: 2.15,
};

export const WAVE_C = {
  // Finer detail on a third non-symmetric angle
  dir: new Vector2(0.39, -0.92).normalize(),
  frequency: 19.4,
  amplitude: 0.006,
  speed: 0.27,
  phase: 4.82,
};

/** Enough segments for soft sine displacement; not over-subdivided. */
const SEGMENTS = 80;

/**
 * Full-field water plane with layered sine displacement + cool blue/cyan tint.
 */
export function createWaterMesh() {
  const geometry = new PlaneGeometry(2, 2, SEGMENTS, SEGMENTS);

  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      // Updated on resize to match mesh scale (world-space wave coordinates).
      uWorldScale: { value: new Vector2(1, 1) },

      uWaveADir: { value: WAVE_A.dir.clone() },
      uWaveAFrequency: { value: WAVE_A.frequency },
      uWaveAAmplitude: { value: WAVE_A.amplitude },
      uWaveASpeed: { value: WAVE_A.speed },
      uWaveAPhase: { value: WAVE_A.phase },

      uWaveBDir: { value: WAVE_B.dir.clone() },
      uWaveBFrequency: { value: WAVE_B.frequency },
      uWaveBAmplitude: { value: WAVE_B.amplitude },
      uWaveBSpeed: { value: WAVE_B.speed },
      uWaveBPhase: { value: WAVE_B.phase },

      uWaveCDir: { value: WAVE_C.dir.clone() },
      uWaveCFrequency: { value: WAVE_C.frequency },
      uWaveCAmplitude: { value: WAVE_C.amplitude },
      uWaveCSpeed: { value: WAVE_C.speed },
      uWaveCPhase: { value: WAVE_C.phase },

      uColorDeep: { value: COLOR_DEEP.clone() },
      uColorShallow: { value: COLOR_SHALLOW.clone() },
    },
  });

  const mesh = new Mesh(geometry, material);
  mesh.name = 'waterSurface';
  return mesh;
}
