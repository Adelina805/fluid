import './style.css';
import { createApp } from './app/createApp.js';

const root = document.querySelector('#app');

if (!root) {
  throw new Error('Fluid: #app root element not found');
}

// Replacement Stages A–C live behind `?sim`; the approved app stays the default.
if (new URLSearchParams(window.location.search).has('sim')) {
  import('./app/createSimDebugApp.js').then(({ createSimDebugApp }) => createSimDebugApp(root));
} else {
  createApp(root);
}
