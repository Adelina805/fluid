import { OrthographicCamera } from 'three';

/**
 * Strict top-down orthographic camera looking at the XY plane.
 * Frustum is finalized by resize handling.
 */
export function createTopDownCamera() {
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.set(0, 0, 2);
  camera.lookAt(0, 0, 0);
  camera.up.set(0, 1, 0);
  return camera;
}
