import { Color, Scene, WebGLRenderer } from 'three';
import { bindResize } from './resize.js';
import { bindVisibility } from './visibility.js';
import { createTopDownCamera } from '../render/camera.js';
import { createTestPlane } from '../render/createTestPlane.js';

/**
 * Phase 0 bootstrap: scene, camera, renderer, plain test plane, loop.
 * No water shaders, interaction, or controls yet.
 * @param {HTMLElement} root
 */
export function createApp(root) {
  // Match clear/background to the test plane so any sub-pixel gaps stay invisible.
  const fieldColor = 0x0367A6;

  const scene = new Scene();
  scene.background = new Color(fieldColor);

  const camera = createTopDownCamera();
  const plane = createTestPlane();
  scene.add(plane);

  const renderer = new WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(fieldColor, 1);
  root.appendChild(renderer.domElement);

  let frameId = 0;
  let running = false;

  const renderFrame = () => {
    renderer.render(scene, camera);
    frameId = requestAnimationFrame(renderFrame);
  };

  const loop = {
    start() {
      if (running) return;
      running = true;
      frameId = requestAnimationFrame(renderFrame);
    },
    stop() {
      if (!running) return;
      running = false;
      cancelAnimationFrame(frameId);
    },
  };

  // Keep the plane larger than the frustum so the darker clear color never shows as "borders".
  bindResize(renderer, camera, () => {
    plane.scale.set(camera.right, camera.top, 1);
  });
  bindVisibility(loop);
  loop.start();

  return {
    scene,
    camera,
    renderer,
    plane,
    dispose() {
      loop.stop();
      renderer.dispose();
      plane.geometry.dispose();
      plane.material.dispose();
      if (renderer.domElement.parentElement === root) {
        root.removeChild(renderer.domElement);
      }
    },
  };
}
