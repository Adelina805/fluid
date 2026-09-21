import {
  applyPublicControls,
  createPublicControls,
  parseHexColor,
  PUBLIC_DEFAULTS,
} from './params.js';

/**
 * Phase 6 Stage B — minimal public control panel.
 * Collapsed by default. Opens via corner icon or `C`. Escape closes.
 * No persistence. Settings reset every page load.
 *
 * @param {object} options
 * @param {HTMLElement} options.root
 * @param {ReturnType<typeof createPublicControls>} [options.publicControls]
 * @param {(publicControls: ReturnType<typeof createPublicControls>) => void} options.onChange
 * @param {(suppressed: boolean) => void} [options.onUiEngage]
 * @returns {{ dispose: () => void, isOpen: () => boolean, setOpen: (open: boolean) => void }}
 */
export function createControlPanel({
  root,
  publicControls = createPublicControls(),
  onChange,
  onUiEngage,
}) {
  const ui = document.createElement('div');
  ui.className = 'fluid-ui';
  ui.innerHTML = `
    <button
      type="button"
      class="fluid-ui__toggle"
      aria-label="Open controls"
      aria-expanded="false"
      aria-controls="fluid-controls-panel"
    >
      <span class="fluid-ui__toggle-mark" aria-hidden="true"></span>
    </button>
    <div
      id="fluid-controls-panel"
      class="fluid-ui__panel"
      role="dialog"
      aria-label="Fluid controls"
      aria-hidden="true"
      hidden
      inert
    >
      <div class="fluid-ui__panel-inner">
        <header class="fluid-ui__header">
          <h2 class="fluid-ui__title">Fluid</h2>
          <button type="button" class="fluid-ui__close" aria-label="Close controls">
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div class="fluid-ui__fields">
          <label class="fluid-ui__axis">
            <span class="fluid-ui__axis-ends">
              <span>Calm</span><span>Restless</span>
            </span>
            <input
              type="range"
              class="fluid-ui__range"
              data-key="calmRestless"
              min="0"
              max="1"
              step="0.001"
              aria-label="Calm to restless"
            />
          </label>

          <label class="fluid-ui__axis">
            <span class="fluid-ui__axis-ends">
              <span>Glassy</span><span>Turbulent</span>
            </span>
            <input
              type="range"
              class="fluid-ui__range"
              data-key="glassyTurbulent"
              min="0"
              max="1"
              step="0.001"
              aria-label="Glassy to turbulent"
            />
          </label>

          <label class="fluid-ui__axis">
            <span class="fluid-ui__axis-ends">
              <span>Reflective</span><span>Translucent</span>
            </span>
            <input
              type="range"
              class="fluid-ui__range"
              data-key="reflectiveTranslucent"
              min="0"
              max="1"
              step="0.001"
              aria-label="Reflective to translucent"
            />
          </label>

          <label class="fluid-ui__axis">
            <span class="fluid-ui__axis-ends">
              <span>Low light</span><span>Bright</span>
            </span>
            <input
              type="range"
              class="fluid-ui__range"
              data-key="light"
              min="0"
              max="1"
              step="0.001"
              aria-label="Light intensity"
            />
          </label>

          <div class="fluid-ui__color">
            <span class="fluid-ui__color-label" id="fluid-color-label">Color</span>
            <div class="fluid-ui__color-row">
              <input
                type="color"
                class="fluid-ui__swatch"
                data-key="colorHex"
                aria-labelledby="fluid-color-label"
                value="${PUBLIC_DEFAULTS.colorHex}"
              />
              <input
                type="text"
                class="fluid-ui__hex"
                data-key="colorHexText"
                aria-label="Color hex value"
                spellcheck="false"
                autocomplete="off"
                maxlength="7"
                value="${PUBLIC_DEFAULTS.colorHex}"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  root.appendChild(ui);

  const toggle = ui.querySelector('.fluid-ui__toggle');
  const panel = ui.querySelector('.fluid-ui__panel');
  const closeBtn = ui.querySelector('.fluid-ui__close');
  const ranges = ui.querySelectorAll('.fluid-ui__range');
  const swatch = ui.querySelector('.fluid-ui__swatch');
  const hexInput = ui.querySelector('.fluid-ui__hex');

  let open = false;
  let uiPointerDown = false;

  function setUiEngage(active) {
    onUiEngage?.(active);
  }

  function syncInputsFromState() {
    ranges.forEach((input) => {
      const key = input.dataset.key;
      input.value = String(publicControls[key] ?? 0);
    });
    const hex = publicControls._lastValidHex || publicControls.colorHex;
    swatch.value = parseHexColor(hex) || PUBLIC_DEFAULTS.colorHex;
    if (document.activeElement !== hexInput) {
      hexInput.value = swatch.value;
    }
  }

  function emitChange() {
    onChange?.(publicControls);
  }

  function setOpen(next) {
    open = !!next;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('aria-label', open ? 'Close controls' : 'Open controls');
    panel.classList.toggle('is-open', open);
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    panel.inert = !open;
    if (open) {
      panel.hidden = false;
      // Allow CSS transition to run after un-hiding.
      requestAnimationFrame(() => {
        panel.classList.add('is-visible');
      });
    } else {
      panel.classList.remove('is-visible');
      const reduce =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      if (reduce) {
        panel.hidden = true;
      } else {
        window.setTimeout(() => {
          if (!open) panel.hidden = true;
        }, 180);
      }
      setUiEngage(false);
      uiPointerDown = false;
    }
  }

  function onToggleClick(event) {
    event.preventDefault();
    event.stopPropagation();
    setOpen(!open);
  }

  function onCloseClick(event) {
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    toggle.focus();
  }

  function onRangeInput(event) {
    const input = event.currentTarget;
    const key = input.dataset.key;
    publicControls[key] = Number(input.value);
    emitChange();
  }

  function onSwatchInput() {
    const parsed = parseHexColor(swatch.value);
    if (!parsed) return;
    publicControls.colorHex = parsed;
    publicControls._lastValidHex = parsed;
    hexInput.value = parsed;
    emitChange();
  }

  function onHexInput() {
    const raw = hexInput.value.trim();
    publicControls.colorHex = raw;
    const parsed = parseHexColor(raw);
    if (parsed) {
      publicControls._lastValidHex = parsed;
      publicControls.colorHex = parsed;
      swatch.value = parsed;
      hexInput.classList.remove('is-invalid');
    } else {
      hexInput.classList.add('is-invalid');
    }
    emitChange();
  }

  function onHexBlur() {
    const parsed = parseHexColor(hexInput.value);
    if (parsed) {
      hexInput.value = parsed;
      hexInput.classList.remove('is-invalid');
    } else {
      hexInput.value = publicControls._lastValidHex || PUBLIC_DEFAULTS.colorHex;
      hexInput.classList.remove('is-invalid');
      publicControls.colorHex = hexInput.value;
    }
  }

  function isTypingTarget(el) {
    if (!el || !(el instanceof Element)) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return el.isContentEditable;
  }

  function onKeyDown(event) {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      toggle.focus();
      return;
    }

    if (event.key === 'c' || event.key === 'C') {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      setOpen(!open);
    }
  }

  function engageUi(event) {
    event.stopPropagation();
    uiPointerDown = true;
    setUiEngage(true);
  }

  function releaseUi() {
    if (!uiPointerDown) return;
    uiPointerDown = false;
    // Keep suppressed while pointer remains over the chrome.
    const overUi = ui.matches(':hover');
    if (!overUi) setUiEngage(false);
  }

  function onUiEnter() {
    setUiEngage(true);
  }

  function onUiLeave() {
    if (!uiPointerDown) setUiEngage(false);
  }

  syncInputsFromState();
  emitChange();

  toggle.addEventListener('click', onToggleClick);
  closeBtn.addEventListener('click', onCloseClick);
  ranges.forEach((input) => input.addEventListener('input', onRangeInput));
  swatch.addEventListener('input', onSwatchInput);
  hexInput.addEventListener('input', onHexInput);
  hexInput.addEventListener('blur', onHexBlur);
  window.addEventListener('keydown', onKeyDown);

  ui.addEventListener('pointerdown', engageUi);
  ui.addEventListener('pointerenter', onUiEnter);
  ui.addEventListener('pointerleave', onUiLeave);
  window.addEventListener('pointerup', releaseUi);
  window.addEventListener('pointercancel', releaseUi);

  // Block touch scrolling / water interaction bubbling from chrome.
  ui.addEventListener(
    'touchstart',
    (event) => {
      event.stopPropagation();
      setUiEngage(true);
    },
    { passive: true },
  );

  return {
    isOpen: () => open,
    setOpen,
    dispose() {
      setUiEngage(false);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerup', releaseUi);
      window.removeEventListener('pointercancel', releaseUi);
      ui.remove();
    },
  };
}
