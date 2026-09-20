/**
 * Pause the animation loop while the tab is hidden.
 * @param {{ start: () => void, stop: () => void }} loop
 */
export function bindVisibility(loop) {
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      loop.stop();
    } else {
      loop.start();
    }
  };

  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
