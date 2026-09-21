import { Pane } from 'tweakpane';
import { createParams, PARAM_DEFAULTS } from './params.js';

/**
 * Phase 6 Stage A — temporary developer controls.
 * Mounted only in Vite DEV. Discovers meaningful ranges before Stage B public UI.
 *
 * @param {object} options
 * @param {ReturnType<typeof createParams>} options.params
 * @param {() => void} options.onChange
 * @returns {{ dispose: () => void } | null}
 */
export function createDevGui({ params, onChange }) {
  if (!import.meta.env.DEV) {
    return null;
  }

  const pane = new Pane({
    title: 'Fluid · Stage A',
    expanded: true,
  });

  const notify = () => {
    onChange?.();
  };

  const colorProxy = {
    picker: params.baseHex,
    hex: params.baseHex,
  };

  function syncColorProxyFromParams() {
    colorProxy.picker = params.baseHex;
    colorProxy.hex = params.baseHex;
  }

  // ---- MOTION ----
  const motion = pane.addFolder({ title: 'MOTION', expanded: true });
  motion
    .addBinding(params, 'motionSpeed', {
      label: 'overall speed',
      min: 0,
      max: 2.5,
      step: 0.01,
    })
    .on('change', notify);
  motion
    .addBinding(params, 'motionAmplitude', {
      label: 'amplitude',
      min: 0,
      max: 2.5,
      step: 0.01,
    })
    .on('change', notify);
  motion
    .addBinding(params, 'turbulence', {
      label: 'turbulence',
      min: 0,
      max: 2.5,
      step: 0.01,
    })
    .on('change', notify);

  // ---- OPTICS ----
  const optics = pane.addFolder({ title: 'OPTICS', expanded: true });
  optics
    .addBinding(params, 'opticalBalance', {
      label: 'reflect ↔ translucent',
      min: 0,
      max: 1,
      step: 0.01,
    })
    .on('change', notify);
  optics
    .addBinding(params, 'fresnelStrength', {
      label: 'Fresnel strength',
      min: 0,
      max: 2.5,
      step: 0.01,
    })
    .on('change', notify);
  optics
    .addBinding(params, 'fresnelViewContrast', {
      label: 'Fresnel contrast',
      min: 1,
      max: 24,
      step: 0.1,
    })
    .on('change', notify);
  optics
    .addBinding(params, 'distortionStrength', {
      label: 'distortion',
      min: 0,
      max: 1.2,
      step: 0.01,
    })
    .on('change', notify);
  optics
    .addBinding(params, 'colorDepthStrength', {
      label: 'optical depth',
      min: 0,
      max: 1.5,
      step: 0.01,
    })
    .on('change', notify);

  // ---- LIGHT ----
  const light = pane.addFolder({ title: 'LIGHT', expanded: true });
  light
    .addBinding(params, 'lightIntensity', {
      label: 'intensity',
      min: 0,
      max: 1.8,
      step: 0.01,
    })
    .on('change', notify);
  light
    .addBinding(params, 'specularStrength', {
      label: 'specular',
      min: 0,
      max: 0.8,
      step: 0.005,
    })
    .on('change', notify);
  light
    .addBinding(params, 'specularNarrowStrength', {
      label: 'narrow specular',
      min: 0,
      max: 0.8,
      step: 0.005,
    })
    .on('change', notify);
  light
    .addBinding(params, 'shininess', {
      label: 'highlight soft',
      min: 4,
      max: 80,
      step: 1,
    })
    .on('change', notify);
  light
    .addBinding(params, 'shininessNarrow', {
      label: 'highlight sharp',
      min: 16,
      max: 160,
      step: 1,
    })
    .on('change', notify);
  light
    .addBinding(params, 'causticSoftStrength', {
      label: 'soft caustics',
      min: 0,
      max: 0.5,
      step: 0.005,
    })
    .on('change', notify);

  // ---- COLOR ----
  const color = pane.addFolder({ title: 'COLOR', expanded: true });
  color
    .addBinding(colorProxy, 'picker', {
      label: 'base color',
      view: 'color',
    })
    .on('change', (ev) => {
      const v = ev.value;
      if (typeof v === 'string') {
        params.baseHex = v;
        colorProxy.hex = v;
      } else if (v && typeof v === 'object' && 'r' in v) {
        const toByte = (c) => {
          const unit = c <= 1 ? c : c / 255;
          return Math.round(Math.min(1, Math.max(0, unit)) * 255);
        };
        const hex = `#${[toByte(v.r), toByte(v.g), toByte(v.b)]
          .map((n) => n.toString(16).padStart(2, '0'))
          .join('')}`;
        params.baseHex = hex;
        colorProxy.hex = hex;
        colorProxy.picker = hex;
      }
      notify();
    });

  color
    .addBinding(colorProxy, 'hex', {
      label: 'hex',
    })
    .on('change', (ev) => {
      const raw = String(ev.value ?? '').trim();
      params.baseHex = raw;
      if (/^#?[0-9a-fA-F]{3}$|^#?[0-9a-fA-F]{6}$/.test(raw)) {
        const normalized = raw.startsWith('#') ? raw : `#${raw}`;
        colorProxy.picker = normalized;
      }
      notify();
    });

  color
    .addBinding(params, 'warmCool', {
      label: 'warm ↔ cool',
      min: -1,
      max: 1,
      step: 0.01,
    })
    .on('change', notify);
  color
    .addBinding(params, 'depthMix', {
      label: 'depth mix',
      min: 0,
      max: 2,
      step: 0.01,
    })
    .on('change', notify);

  // ---- INTERACTION ----
  const interaction = pane.addFolder({ title: 'INTERACTION', expanded: true });
  interaction
    .addBinding(params, 'pointerInfluence', {
      label: 'pointer influence',
      min: 0,
      max: 2.5,
      step: 0.01,
    })
    .on('change', notify);
  interaction
    .addBinding(params, 'velocityResponse', {
      label: 'velocity response',
      min: 0,
      max: 2.5,
      step: 0.01,
    })
    .on('change', notify);
  interaction
    .addBinding(params, 'rippleStrength', {
      label: 'ripple strength',
      min: 0,
      max: 2.5,
      step: 0.01,
    })
    .on('change', notify);
  interaction
    .addBinding(params, 'rippleSpeed', {
      label: 'ripple speed',
      min: 1,
      max: 20,
      step: 0.1,
    })
    .on('change', notify);
  interaction
    .addBinding(params, 'proximityRadius', {
      label: 'proximity radius',
      min: 0.1,
      max: 1.5,
      step: 0.01,
    })
    .on('change', notify);
  interaction
    .addBinding(params, 'proximityHeight', {
      label: 'proximity height',
      min: 0,
      max: 0.05,
      step: 0.0005,
    })
    .on('change', notify);
  interaction
    .addBinding(params, 'wakeHeight', {
      label: 'wake height',
      min: 0,
      max: 0.06,
      step: 0.0005,
    })
    .on('change', notify);

  pane.addButton({ title: 'Reset defaults' }).on('click', () => {
    const fresh = createParams();
    for (const key of Object.keys(PARAM_DEFAULTS)) {
      params[key] = fresh[key];
    }
    params._lastValidHex = fresh._lastValidHex;
    syncColorProxyFromParams();
    pane.refresh();
    notify();
  });

  return {
    dispose() {
      pane.dispose();
    },
  };
}
