import './style.css';
import { createApp } from './app/createApp.js';
import { createSimApp } from './app/createSimApp.js';

const root = document.querySelector('#app');

if (!root) {
  throw new Error('Fluid: #app root element not found');
}

const query = new URLSearchParams(window.location.search);

// Dev harness: height / normals / water A/B (`?sim`, `?sim&water`, …).
if (query.has('sim')) {
  import('./app/createSimDebugApp.js').then(({ createSimDebugApp }) => createSimDebugApp(root));
} else if (query.has('legacy')) {
  // Pre–Stage D analytic surface + Phase 6.5 legacy caustics (comparison only).
  createApp(root);
} else {
  // Production: E3.5–E6 approved sim surface + rebuilt caustics (V3 + halfHybrid).
  createSimApp(root);
}
