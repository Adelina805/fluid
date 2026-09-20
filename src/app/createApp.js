import { Color, Scene, WebGLRenderer } from 'three';
import { bindResize } from './resize.js';
import { bindVisibility } from './visibility.js';
import { createTopDownCamera } from '../render/camera.js';
import { COLOR_DEEP, createWaterMesh } from '../render/createWaterMesh.js';

/**
 * Phase 1: calm full-screen water surface (layered sine displacement + cool tint).
 * No interaction, Fresnel, refraction, caustics, or public controls.
 * @param {HTMLElement} root
 */
export function createApp(root) {
  const fieldColor = COLOR_DEEP.getHex();

  const scene = new Scene();
  scene.background = new Color(fieldColor);

  const camera = createTopDownCamera();
  const water = createWaterMesh();
  scene.add(water);

  const renderer = new WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(fieldColor, 1);
  root.appendChild(renderer.domElement);

  let frameId = 0;
  let running = false;
  let elapsed = 0;
  let lastFrameTime = performance.now();

  const renderFrame = () => {
    const now = performance.now();
    elapsed += (now - lastFrameTime) * 0.001;
    lastFrameTime = now;
    water.material.uniforms.uTime.value = elapsed;

    renderer.render(scene, camera);
    frameId = requestAnimationFrame(renderFrame);
  };

  const loop = {
    start() {
      if (running) return;
      running = true;
      // Skip wall-clock gap while the tab was hidden so waves do not jump.
      lastFrameTime = performance.now();
      frameId = requestAnimationFrame(renderFrame);
    },
    stop() {
      if (!running) return;
      running = false;
      cancelAnimationFrame(frameId);
    },
  };

  // Cover the frustum; feed the same scale into the shader so waves stay isotropic in world space.
  bindResize(renderer, camera, () => {
    water.scale.set(camera.right, camera.top, 1);
    water.material.uniforms.uWorldScale.value.set(camera.right, camera.top);
  });
  bindVisibility(loop);
  loop.start();

  return {
    scene,
    camera,
    renderer,
    water,
    dispose() {
      loop.stop();
      renderer.dispose();
      water.geometry.dispose();
      water.material.dispose();
      if (renderer.domElement.parentElement === root) {
        root.removeChild(renderer.domElement);
      }
    },
  };
}
