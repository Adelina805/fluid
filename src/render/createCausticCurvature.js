import {
  ClampToEdgeWrapping,
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
} from 'three';
import curvatureFragmentShader from '../shaders/causticCurvature.frag.glsl?raw';
import fullscreenVertexShader from '../shaders/fullscreen.vert.glsl?raw';

/** Gaussian width of the curvature smoothing, in sim texels. */
export const CURVATURE_SIGMA = 2;

/** Kernel half-width in texels (3σ). */
const KERNEL_RADIUS = 6;

/**
 * Discrete Gaussian G (sum 1) and second-derivative kernel G'' (sum 0, Σ G''·i² = 2, so a
 * quadratic's curvature comes out exact), taps 0…KERNEL_RADIUS.
 */
function createKernels(sigma) {
  const s2 = sigma * sigma;
  const g = [];
  for (let i = 0; i <= KERNEL_RADIUS; i += 1) g.push(Math.exp(-(i * i) / (2 * s2)));
  const sum = g.reduce((total, w, i) => total + (i === 0 ? w : 2 * w), 0);
  const gauss = g.map((w) => w / sum);

  // G'' ∝ G·(i² − σ²) plus a constant·G term, solved so Σ = 0 and Σ i² = 2.
  const moment = (fn) => gauss.reduce((total, w, i) => total + (i === 0 ? 1 : 2) * w * fn(i), 0);
  const m0 = 1;
  const m2 = moment((i) => i * i);
  const m4 = moment((i) => i ** 4);
  // a·(m2 − σ²·m0) + b·m0 = 0 ;  a·(m4 − σ²·m2) + b·m2 = 2
  const a = 2 / (m4 - s2 * m2 - (m2 - s2 * m0) * (m2 / m0));
  const b = -a * (m2 - s2 * m0) / m0;
  const gauss2 = gauss.map((w, i) => w * (a * (i * i - s2) + b));
  return { gauss, gauss2 };
}

function createTarget() {
  return new WebGLRenderTarget(1, 1, {
    type: HalfFloatType,
    format: RGBAFormat,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    wrapS: ClampToEdgeWrapping,
    wrapT: ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  });
}

/**
 * Stage E2: smoothed curvature (Laplacian of Gaussian of sim height) at sim resolution, for the
 * caustic bend fold limit and light concentration. Two cheap passes per frame; the composite then
 * needs one fetch per pixel. Reads the sim state only.
 */
export function createCausticCurvature() {
  const { gauss, gauss2 } = createKernels(CURVATURE_SIGMA);
  const makeMaterial = (pass) =>
    new ShaderMaterial({
      vertexShader: fullscreenVertexShader,
      fragmentShader: curvatureFragmentShader,
      uniforms: {
        uSource: { value: null },
        uStep: { value: new Vector2() },
        uGauss: { value: gauss },
        uGauss2: { value: gauss2 },
      },
      defines: { KERNEL_RADIUS, [pass]: '' },
      depthTest: false,
      depthWrite: false,
    });
  const passX = makeMaterial('PASS_X');
  const passY = makeMaterial('PASS_Y');
  const quad = new Mesh(new PlaneGeometry(2, 2), passX);
  quad.frustumCulled = false;
  const scene = new Scene();
  scene.add(quad);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const intermediate = createTarget();
  const output = createTarget();

  return {
    texture: output.texture,
    /**
     * @param {import('three').WebGLRenderer} renderer
     * @param {import('three').Texture} stateTexture Sim state (R = height).
     */
    update(renderer, stateTexture) {
      const { width, height } = stateTexture.image;
      if (output.width !== width || output.height !== height) {
        intermediate.setSize(width, height);
        output.setSize(width, height);
      }
      const previousTarget = renderer.getRenderTarget();
      quad.material = passX;
      passX.uniforms.uSource.value = stateTexture;
      passX.uniforms.uStep.value.set(1 / width, 0);
      renderer.setRenderTarget(intermediate);
      renderer.render(scene, camera);
      quad.material = passY;
      passY.uniforms.uSource.value = intermediate.texture;
      passY.uniforms.uStep.value.set(0, 1 / height);
      renderer.setRenderTarget(output);
      renderer.render(scene, camera);
      renderer.setRenderTarget(previousTarget);
    },
    dispose() {
      passX.dispose();
      passY.dispose();
      quad.geometry.dispose();
      intermediate.dispose();
      output.dispose();
    },
  };
}
