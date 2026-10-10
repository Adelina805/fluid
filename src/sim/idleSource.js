/**
 * Dev idle-motion defaults (low-res velocity forcing). **Frozen E3.5** — do not retune without owner approval.
 * Overrides remain via `idle*` URL params on `?sim&water` for dev comparison only.
 */
export const IDLE_DEFAULTS = {
  /** Per-step velocity kick scale (before uIdleMix and reduced-motion scale). */
  strength: 0.0007,
  /** Broad noise cell size in sim texels (~2–3 cells across a 256-long visible axis). */
  spatial: 96,
  /** Temporal rate multiplier on uIdleTime (sin carriers; ~0.08 ≈ 8–15 s broad beat). */
  speed: 0.08,
  /** 0 disables injection; 1 is full strength. */
  mix: 1,
  /** Weight on the mid-scale layer relative to broad. */
  midWeight: 0.55,
  /** Weight on the fine layer when idleLayers=3. */
  fineWeight: 0.22,
  /** 2 or 3 noise layers in the step shader. */
  layers: 2,
  /** Sim |h| at which idle velocity forcing reaches zero (idle-only saturation). */
  heightCap: 0.12,
};

/** Clamps for `idle*` URL overrides. */
export const IDLE_PARAM_BOUNDS = {
  idleStrength: [0, 0.05],
  idleSpatial: [16, 256],
  idleSpeed: [0, 0.5],
  idleMix: [0, 1],
  idleHeightCap: [0.04, 0.5],
};

/** Match simPointer reduced-motion attenuation. */
export const IDLE_REDUCED_MOTION_SCALE = 0.2;

/**
 * @returns {Record<string, { value: number }>}
 */
export function createIdleUniforms() {
  const d = IDLE_DEFAULTS;
  return {
    uIdleTime: { value: 0 },
    uIdleStrength: { value: d.strength },
    uIdleSpatial: { value: d.spatial },
    uIdleSpeed: { value: d.speed },
    uIdleMix: { value: d.mix },
    uIdleMidWeight: { value: d.midWeight },
    uIdleFineWeight: { value: 0 },
    uIdleHeightCap: { value: d.heightCap },
  };
}

/**
 * @param {import('three').ShaderMaterial} material
 * @param {Partial<typeof IDLE_DEFAULTS>} overrides
 * @param {number} motionScale prefers-reduced-motion scale (1 or IDLE_REDUCED_MOTION_SCALE)
 */
export function applyIdleParams(material, overrides = {}, motionScale = 1) {
  const d = { ...IDLE_DEFAULTS, ...overrides };
  const layers = d.layers === 3 ? 3 : 2;
  const u = material.uniforms;
  u.uIdleStrength.value = d.strength * motionScale;
  u.uIdleSpatial.value = d.spatial;
  u.uIdleSpeed.value = d.speed;
  u.uIdleMix.value = d.mix;
  u.uIdleMidWeight.value = d.midWeight;
  u.uIdleFineWeight.value = layers === 3 ? d.fineWeight * motionScale : 0;
  u.uIdleHeightCap.value = d.heightCap;

  const wantLayer3 = layers === 3;
  const hadLayer3 = material.defines.IDLE_LAYER3 !== undefined;
  if (wantLayer3) material.defines.IDLE_LAYER3 = '';
  else delete material.defines.IDLE_LAYER3;
  if (wantLayer3 !== hadLayer3) material.needsUpdate = true;
}

/**
 * @param {{ value: number }} uIdleTime
 * @param {number} stepCount
 * @param {number} stepHz fixed sim rate (SIM_STEP_HZ)
 */
export function advanceIdleTime(uIdleTime, stepCount, stepHz) {
  if (stepCount > 0) uIdleTime.value += stepCount / stepHz;
}

/**
 * Parse dev URL idle overrides for the water view.
 * @param {URLSearchParams} query
 * @param {boolean} showWater
 * @returns {Partial<typeof IDLE_DEFAULTS>}
 */
export function resolveIdleFromQuery(query, showWater) {
  if (!showWater) return { mix: 0 };

  const overrides = { ...IDLE_DEFAULTS };
  if (query.has('idle')) {
    const flag = query.get('idle');
    if (flag === 'off' || flag === '0' || flag === 'false') overrides.mix = 0;
    else if (flag === 'on' || flag === '1' || flag === 'true') overrides.mix = 1;
    else console.warn('[sim] idle= expects on | off; default kept.');
  }

  for (const [name, [min, max]] of Object.entries(IDLE_PARAM_BOUNDS)) {
    if (!query.has(name)) continue;
    const value = Number(query.get(name));
    const key = name.replace(/^idle/, '').replace(/^./, (c) => c.toLowerCase());
    if (!Number.isFinite(value)) {
      console.warn(`[sim] ${name}=${query.get(name)} is not a number; ignored.`);
      continue;
    }
    overrides[key] = Math.min(Math.max(value, min), max);
  }

  if (query.has('idleLayers')) {
    const layers = Math.round(Number(query.get('idleLayers')));
    if (layers === 2 || layers === 3) overrides.layers = layers;
    else console.warn('[sim] idleLayers= expects 2 | 3; default kept.');
  }

  if (query.has('idleHeightCap')) {
    const value = Number(query.get('idleHeightCap'));
    if (Number.isFinite(value)) {
      const [min, max] = IDLE_PARAM_BOUNDS.idleHeightCap;
      overrides.heightCap = Math.min(Math.max(value, min), max);
    }
  }

  return overrides;
}
