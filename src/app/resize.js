/** Max device pixel ratio — keeps GPU load predictable on retina displays. */
const MAX_PIXEL_RATIO = 2;

/**
 * Bind window resize to renderer + camera.
 * @param {import('three').WebGLRenderer} renderer
 * @param {import('three').OrthographicCamera} camera
 * @param {(width: number, height: number) => void} [onResize]
 */
export function bindResize(renderer, camera, onResize) {
  const apply = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);

    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, true);

    const aspect = width / height;
    const viewSize = 1;

    if (aspect >= 1) {
      camera.left = -viewSize * aspect;
      camera.right = viewSize * aspect;
      camera.top = viewSize;
      camera.bottom = -viewSize;
    } else {
      // Portrait: expand vertically so the plane stays edge-to-edge without naive crop.
      camera.left = -viewSize;
      camera.right = viewSize;
      camera.top = viewSize / aspect;
      camera.bottom = -viewSize / aspect;
    }

    camera.updateProjectionMatrix();
    onResize?.(width, height);
  };

  apply();
  window.addEventListener('resize', apply);

  return () => {
    window.removeEventListener('resize', apply);
  };
}
