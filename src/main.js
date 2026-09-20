import './style.css';
import { createApp } from './app/createApp.js';

const root = document.querySelector('#app');

if (!root) {
  throw new Error('Fluid: #app root element not found');
}

createApp(root);
