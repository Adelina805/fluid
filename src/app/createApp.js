import { Color, Scene, WebGLRenderer } from 'three';
import { bindResize } from './resize.js';
import { bindVisibility } from './visibility.js';
import { createTopDownCamera } from '../render/camera.js';
import { COLOR_DEEP, createWaterMesh } from '../render/createWaterMesh.js';
import { MAX_RIPPLES, createPointerInteraction } from '../interaction/pointer.js';
import {
  applyParams,
  createParams,
  getInteractionScales,
} from '../controls/params.js';

/**
 * Phase 6 Stage A: calm water + pointer interaction + DEV-only Tweakpane.
 * No public panel yet. No GPGPU, hold effects, or settings persistence.
 * @param {HTMLElement} root
 */
export function createApp(root) {
  const params = createParams();
  const fieldColor = COLOR_DEEP.getHex();

  const scene = new Scene();
  scene.background = new Color(fieldColor);

  const camera = createTopDownCamera();
  const water = createWaterMesh();
  // Static top-down camera — feed once for view-dependent brightness / specular.
  water.material.uniforms.uCameraPosition.value.copy(camera.position);
  scene.add(water);

  const renderer = new WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(fieldColor, 1);
  root.appendChild(renderer.domElement);

  const syncParams = () => {
    applyParams({ water, scene, renderer, params });
  };
  // Seed uniforms from centralized params (must match Phase 5 defaults).
  syncParams();

  const pointer = createPointerInteraction({
    canvas: renderer.domElement,
    getWorldExtents: () => ({
      right: camera.right,
      top: camera.top,
    }),
    getInteractionScales: () => getInteractionScales(params),
  });

  const rippleUniforms = [
    water.material.uniforms.uRipple0,
    water.material.uniforms.uRipple1,
    water.material.uniforms.uRipple2,
    water.material.uniforms.uRipple3,
  ];

  /** Push pointer / ripple state into shader uniforms. */
  function syncInteractionUniforms() {
    const state = pointer.getState();
    const u = water.material.uniforms;

    u.uPointerPos.value.set(state.x, state.y);
    u.uPointerStrength.value = state.strength;
    u.uPointerVelocity.value.set(state.velocityX, state.velocityY);
    u.uPointerWake.value = state.wake;

    for (let i = 0; i < MAX_RIPPLES; i += 1) {
      const ripple = state.ripples[i];
      const target = rippleUniforms[i].value;
      if (ripple) {
        target.set(ripple.x, ripple.y, ripple.birth, ripple.amp);
      } else {
        target.set(0, 0, 0, 0);
      }
    }
  }

  let frameId = 0;
  let running = false;
  let elapsed = 0;
  let lastFrameTime = performance.now();

  const renderFrame = () => {
    const now = performance.now();
    const dt = (now - lastFrameTime) * 0.001;
    elapsed += dt;
    lastFrameTime = now;

    pointer.update(dt, elapsed);
    syncInteractionUniforms();
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

  /** @type {{ dispose: () => void } | null} */
  let devGui = null;
  if (import.meta.env.DEV) {
    // Dynamic import keeps Tweakpane out of production bundles.
    import('../controls/devGui.js').then(({ createDevGui }) => {
      devGui = createDevGui({
        params,
        onChange: syncParams,
      });
    });
  }

  return {
    scene,
    camera,
    renderer,
    water,
    params,
    dispose() {
      loop.stop();
      devGui?.dispose();
      pointer.dispose();
      renderer.dispose();
      water.geometry.dispose();
      water.material.dispose();
      if (renderer.domElement.parentElement === root) {
        root.removeChild(renderer.domElement);
      }
    },
  };
}
