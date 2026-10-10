import './style.css';

const root = document.querySelector('#app');

if (!root) {
  throw new Error('Fluid: #app root element not found');
}

const query = new URLSearchParams(window.location.search);
const isProduction = !query.has('sim') && !query.has('legacy');

/** @type {HTMLElement | null} */
const productionPlaceholder = document.getElementById('fluid-placeholder');

if (!isProduction) {
  productionPlaceholder?.remove();
} else if (productionPlaceholder instanceof HTMLElement) {
  productionPlaceholder.hidden = false;
}

// Dev harness: height / normals / water A/B (`?sim`, `?sim&water`, …).
if (query.has('sim')) {
  import('./app/createSimDebugApp.js').then(({ createSimDebugApp }) => createSimDebugApp(root));
} else if (query.has('legacy')) {
  import('./app/createApp.js').then(({ createApp }) => createApp(root));
} else {
  // Defer the Three.js bundle so the HTML placeholder can paint first.
  const boot = () => {
    import('./app/createSimApp.js').then(({ createSimApp }) =>
      createSimApp(root, { placeholder: productionPlaceholder }),
    );
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(boot);
  } else {
    boot();
  }
}
