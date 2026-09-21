/*
  Seafloor row.

  Baseline (works with no JS): the row is a native horizontal scroller, every piece is a
  real link, and the frame is sized by CSS. This file only ever ADDS to that:

  1. Sizes the frame to 100svh minus whatever sits above it, by measuring.
  2. Keeps keyboard focus honest in the strip: the whole slot is scrolled into the row.
  3. Scroll-linked mode ("enhanced"): the page scroll drives the row (built up in steps).

  Enhanced mode is strictly opt-in and reversible. It is switched on as the LAST step of
  init, only when every check passes, and any error anywhere tears it down and leaves the
  plain strip. Measured synchronously (no requestAnimationFrame for layout): resize and
  ResizeObserver callbacks already run after layout, and rAF is paused in background tabs.
*/
(() => {
  'use strict';

  const SCENE = '[data-seafloor-scene]';
  const FRAME = '.seafloor';
  const ROW = '.seafloor__row';
  const SLOT = '.seafloor-slot';
  const HEADER_GROUP = '.shopify-section-group-header-group';
  const ENHANCED_CLASS = 'seafloor-scene--enhanced';
  const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

  const CONFIG = {
    // Below this many pieces there is nothing worth pinning for; the row stays a plain strip.
    minPieces: 5,
  };

  const controllers = [];
  let resizeObserver = null;

  // ---------------------------------------------------------------------------
  // Fail-safe plumbing
  // ---------------------------------------------------------------------------

  const failSafe = (ctl, label, error) => {
    try {
      teardown(ctl);
    } catch (teardownError) {
      // Nothing left to do: the class is removed first thing in teardown.
    }
    ctl.scene.setAttribute('data-seafloor-mode', 'strip');
    ctl.scene.setAttribute('data-seafloor-reason', `error:${label}`);
    if (!ctl.warned && window.console && console.warn) {
      ctl.warned = true;
      console.warn(`[seafloor] fell back to the plain strip (${label})`, error);
    }
  };

  // Wrap a function so any throw drops this controller back to the strip instead of
  // breaking the page.
  const guard = (ctl, label, fn) => (...args) => {
    try {
      return fn(...args);
    } catch (error) {
      failSafe(ctl, label, error);
      return undefined;
    }
  };

  // Register a listener with its own undo, so teardown can fully unwind enhanced mode.
  const listen = (ctl, target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    ctl.cleanups.push(() => target.removeEventListener(type, handler, options));
  };

  // ---------------------------------------------------------------------------
  // Chrome measurement (frame = 100svh minus everything above the scene)
  // ---------------------------------------------------------------------------

  const measure = () => {
    document.querySelectorAll(FRAME).forEach((frame) => {
      // Measure the (never sticky) scene wrapper, not the frame: once the frame is pinned
      // its own top no longer says how much sits above it.
      const anchor = frame.closest(SCENE) || frame;
      const chrome = anchor.getBoundingClientRect().top + window.scrollY;
      frame.style.setProperty('--seafloor-chrome', `${chrome.toFixed(3)}px`);
    });
  };

  // ---------------------------------------------------------------------------
  // Strip-mode keyboard focus: scroll the whole slot (not just its link) into the row
  // ---------------------------------------------------------------------------

  const revealSlot = (row, slot) => {
    const rowRect = row.getBoundingClientRect();
    const slotRect = slot.getBoundingClientRect();
    const style = window.getComputedStyle(row);
    const left = rowRect.left + (parseFloat(style.scrollPaddingLeft) || 0);
    const right = rowRect.right - (parseFloat(style.scrollPaddingRight) || 0);

    if (slotRect.width >= right - left || slotRect.left < left) {
      row.scrollLeft += slotRect.left - left;
    } else if (slotRect.right > right) {
      row.scrollLeft += slotRect.right - right;
    }
  };

  const onFocusIn = (event) => {
    const slot = event.target.closest && event.target.closest(SLOT);
    const row = slot && slot.closest(ROW);
    if (!row) return;

    revealSlot(row, slot);
    // The browser may run its own focus scroll after this event; check again once it has.
    window.setTimeout(() => revealSlot(row, slot), 0);
  };

  const bindRows = () => {
    document.querySelectorAll(ROW).forEach((row) => {
      if (row.dataset.seafloorFocusBound) return;
      row.dataset.seafloorFocusBound = 'true';
      row.addEventListener('focusin', onFocusIn);
    });
  };

  // ---------------------------------------------------------------------------
  // Controller: one per scene, strip <-> enhanced
  // ---------------------------------------------------------------------------

  const supported = () =>
    typeof window.matchMedia === 'function' &&
    'ResizeObserver' in window &&
    'requestAnimationFrame' in window &&
    !!(window.CSS && CSS.supports && CSS.supports('position', 'sticky'));

  // Returns why this scene must stay a plain strip, or null when it may be enhanced.
  const ineligibleReason = (ctl) => {
    if (!ctl.frame || !ctl.row) return 'missing-markup';
    if (!supported()) return 'unsupported';
    if (window.matchMedia(REDUCED_MOTION).matches) return 'reduced-motion';
    if (ctl.row.querySelectorAll(SLOT).length < CONFIG.minPieces) return 'few-pieces';
    return null;
  };

  const teardown = (ctl) => {
    // Class first: whatever else goes wrong below, the layout is back to the strip.
    ctl.scene.classList.remove(ENHANCED_CLASS);
    ctl.mode = 'strip';
    ctl.scene.setAttribute('data-seafloor-mode', 'strip');

    while (ctl.cleanups.length) {
      const undo = ctl.cleanups.pop();
      try {
        undo();
      } catch (error) {
        // Keep unwinding.
      }
    }
    ctl.scene.style.removeProperty('--seafloor-scene-h');
  };

  const enhance = (ctl) => {
    if (ctl.mode === 'enhanced') return;

    const reason = ineligibleReason(ctl);
    if (reason) {
      ctl.scene.setAttribute('data-seafloor-mode', 'strip');
      ctl.scene.setAttribute('data-seafloor-reason', reason);
      return;
    }

    guard(ctl, 'enhance', () => {
      // (Later steps wire geometry, the scroll mapping and input handling here.)

      // Last step: only now does the scene claim to be enhanced.
      ctl.mode = 'enhanced';
      ctl.scene.removeAttribute('data-seafloor-reason');
      ctl.scene.setAttribute('data-seafloor-mode', 'enhanced');
      ctl.scene.classList.add(ENHANCED_CLASS);
    })();
  };

  const createController = (scene) => ({
    scene,
    frame: scene.querySelector(FRAME),
    row: scene.querySelector(ROW),
    mode: 'strip',
    cleanups: [],
    warned: false,
  });

  const init = () => {
    measure();
    bindRows();

    controllers.splice(0).forEach((ctl) => {
      try {
        teardown(ctl);
      } catch (error) {
        // Fresh controllers are created below.
      }
    });
    document.querySelectorAll(SCENE).forEach((scene) => {
      const ctl = createController(scene);
      controllers.push(ctl);
      enhance(ctl);
    });

    if (resizeObserver) resizeObserver.disconnect();
    if ('ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(measure);
      document.querySelectorAll(HEADER_GROUP).forEach((el) => resizeObserver.observe(el));
    }
  };

  // Read-only-ish surface used for verification and, later, the tuning panel.
  window.seafloorRow = { controllers, config: CONFIG, guard, failSafe, enhance, teardown };

  init();
  window.addEventListener('resize', measure);
  window.addEventListener('load', measure);
  window.addEventListener('pageshow', measure);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  document.addEventListener('shopify:section:load', init);
})();
