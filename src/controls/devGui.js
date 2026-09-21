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

  // ---- MOTION ----
  const motion = pane.addFolder({ title: 'MOTION', expanded: true });
  motion
    .addBinding(params, 'motionSpeed', {
      label: 'calm ↔ restless',
      min: 0.25,
      max: 6.0,
      step: 0.01,
    })
    .on('change', notify);
  motion
    .addBinding(params, 'motionAmplitude', {
      label: 'amplitude',
      min: 0.5,
      max: 5.0,
      step: 0.01,
    })
    .on('change', notify);
  motion
    .addBinding(params, 'turbulence', {
      label: 'glassy ↔ turbulent',
      min: 0.35,
      max: 5.0,
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
      max: 2.0,
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
      max: 1.6,
      step: 0.005,
    })
    .on('change', notify);
  light
    .addBinding(params, 'shininess', {
      label: 'highlight soft',
      min: 4,
      max: 96,
      step: 1,
    })
    .on('change', notify);
  light
    .addBinding(params, 'shininessNarrow', {
      label: 'highlight sharp',
      min: 12,
      max: 200,
      step: 1,
    })
    .on('change', notify);
  light
    .addBinding(params, 'causticSoftStrength', {
      label: 'soft caustics',
      min: 0,
      max: 1.4,
      step: 0.005,
    })
    .on('change', notify);

  // ---- COLOR ----
  // One control only: Tweakpane color view on the hex string (picker + text).
  const color = pane.addFolder({ title: 'COLOR', expanded: true });
  color
    .addBinding(params, 'baseHex', {
      label: 'color',
      view: 'color',
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
    pane.refresh();
    notify();
  });

  return {
    dispose() {
      pane.dispose();
    },
  };
}

/**
 * Phase 6.5 — caustic study Tweakpane (not mounted by default).
 * Public semantic controls own caustic derivation. Remount temporarily
 * from createApp if baseline retuning is needed.
 *
 * @param {object} options
 * @param {ReturnType<typeof createParams>} options.params
 * @param {() => void} options.onChange
 * @param {() => void} [options.onReset] — restore baseline via public re-derive
 * @returns {{ dispose: () => void, refresh: () => void } | null}
 */
export function createCausticStudyGui({ params, onChange, onReset }) {
  if (!import.meta.env.DEV) {
    return null;
  }

  const pane = new Pane({
    title: 'Phase 6.5 · Caustic Study (live / derived)',
    expanded: true,
  });

  const notify = () => {
    onChange?.();
  };

  const folder = pane.addFolder({
    title: 'FINE CAUSTIC NETWORK',
    expanded: true,
  });
  folder
    .addBinding(params, 'causticNetIntensity', {
      label: 'intensity',
      min: 0,
      max: 1.8,
      step: 0.01,
    })
    .on('change', notify);
  folder
    .addBinding(params, 'causticNetScale', {
      label: 'density / scale',
      min: 0.5,
      max: 22,
      step: 0.1,
    })
    .on('change', notify);
  folder
    .addBinding(params, 'causticNetSharpness', {
      label: 'sharpness',
      min: 0.03,
      max: 0.55,
      step: 0.005,
    })
    .on('change', notify);
  folder
    .addBinding(params, 'causticNetWarp', {
      label: 'distortion / warp',
      min: 0,
      max: 1.4,
      step: 0.01,
    })
    .on('change', notify);
  folder
    .addBinding(params, 'causticNetSpeed', {
      label: 'animation speed',
      min: 0,
      max: 2.0,
      step: 0.001,
    })
    .on('change', notify);
  folder
    .addBinding(params, 'causticSoftStrength', {
      label: 'soft caustics (macro)',
      min: 0,
      max: 1.4,
      step: 0.005,
    })
    .on('change', notify);

  pane.addButton({ title: 'Reset caustic defaults' }).on('click', () => {
    // Re-derive from current public sliders around approved baseline.
    onReset?.();
    pane.refresh();
    notify();
  });

  return {
    dispose() {
      pane.dispose();
    },
    refresh() {
      pane.refresh();
    },
  };
}
