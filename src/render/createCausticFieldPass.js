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
  WebGLRenderTarget,
} from 'three';
import causticsShaderChunk from '../shaders/caustics.glsl?raw';
import causticsFieldPassFragmentShader from '../shaders/causticsFieldPass.frag.glsl?raw';
import fullscreenVertexShader from '../shaders/fullscreen.vert.glsl?raw';
import simSurfaceShaderChunk from '../shaders/sim/simSurface.glsl?raw';

/** Dev E4 modes: full = inline composite (no pass). */
export const CAUSTIC_RES_MODES = ['full', 'half', 'quarter', 'halfHybrid'];

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
 * Stage E4: optional reduced-res caustic field render before the composite.
 * @param {object} options
 * @param {number} options.scale 0.5 (half) or 0.25 (quarter)
 * @param {boolean} options.hybrid distance pass + display-res shaping in composite
 * @param {Record<string, string>} options.defines Caustic defines (match composite)
 * @param {Record<string, { value: unknown }>} options.uniforms Shared caustic + sim uniforms
 * @param {boolean} [options.cubicHeight]
 */
export function createCausticFieldPass({ scale, hybrid, defines, uniforms, cubicHeight = true }) {
  const target = createTarget();
  const material = new ShaderMaterial({
    vertexShader: fullscreenVertexShader,
    fragmentShader: `${simSurfaceShaderChunk}\n${causticsShaderChunk}\n${causticsFieldPassFragmentShader}`,
    uniforms,
    defines: {
      ...(cubicHeight ? { SIM_CUBIC: '' } : {}),
      ...defines,
      ...(hybrid ? { CAUSTIC_PASS_HYBRID: '' } : {}),
    },
    depthTest: false,
    depthWrite: false,
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new Scene();
  scene.add(quad);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  return {
    texture: target.texture,
    scale,
    hybrid,
    /**
     * @param {import('three').WebGLRenderer} renderer
     * @param {number} width drawing buffer width
     * @param {number} height drawing buffer height
     */
    update(renderer, width, height) {
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));
      if (target.width !== w || target.height !== h) target.setSize(w, h);
      const previousTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(previousTarget);
    },
    dispose() {
      material.dispose();
      quad.geometry.dispose();
      target.dispose();
    },
  };
}
