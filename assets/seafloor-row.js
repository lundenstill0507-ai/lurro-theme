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
    // ...and below this much horizontal travel there is nothing to scroll through.
    minTravel: 8,
    // Vertical px of page scroll per horizontal px of row travel. Above 1 is slower and more
    // deliberate, and it sets how tall the page gets (runway = travel * ratio).
    ratio: 1.2,
    // Extra pinned scroll before the row starts moving / after it reaches its end, as a
    // fraction of the frame's height. The end dwell is what makes the exit unhurried; the
    // start dwell only matters if the scene is not at the very top of the page.
    dwellStart: 0,
    dwellEnd: 0.25,
  };

  const controllers = [];
  let resizeObserver = null;

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

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

      // Where the pinned frame sits: directly below the (always-visible) header.
      const header = document.querySelector('.section-header');
      const pinTop = header ? header.offsetHeight : chrome;
      frame.style.setProperty('--seafloor-pin-top', `${pinTop}px`);
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

    // In scroll-linked mode the page scroll owns the row's position, so focus is turned into
    // a page scroll instead (see moveToSlot). Only the plain strip scrolls the row directly.
    const ctl = controllers.find((c) => c.row === row);
    if (ctl && ctl.mode === 'enhanced' && ctl.onFocus) {
      ctl.onFocus(slot);
      return;
    }

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
    ctl.onFocus = null;
    ctl.sync = null;
    ctl.geo = null;
  };

  // Pin geometry. The scene is a tall runway; the frame is pinned for `pinLen` px of page
  // scroll, starting when the scene's top reaches the pin line (S0) and ending at S1. The row
  // moves only inside that window; before it the row is at its start, after it at its end.
  const refreshGeometry = (ctl) => {
    const { scene, frame, row } = ctl;
    const travel = Math.max(0, row.scrollWidth - row.clientWidth);
    const frameH = frame.offsetHeight;
    const dwellStartPx = CONFIG.dwellStart * frameH;
    const dwellEndPx = CONFIG.dwellEnd * frameH;
    const pinLen = dwellStartPx + travel * CONFIG.ratio + dwellEndPx;
    const sceneTop = scene.getBoundingClientRect().top + window.scrollY;
    const pinTop = parseFloat(frame.style.getPropertyValue('--seafloor-pin-top')) || 0;
    const S0 = sceneTop - pinTop;

    ctl.geo = { travel, frameH, dwellStartPx, dwellEndPx, pinLen, S0, S1: S0 + pinLen };
    scene.style.setProperty('--seafloor-scene-h', `${(frameH + pinLen).toFixed(2)}px`);
  };

  // Page scroll position -> row travel in px, clamped to the row's ends.
  const travelForScroll = (ctl, y) =>
    clamp((y - ctl.geo.S0 - ctl.geo.dwellStartPx) / CONFIG.ratio, 0, ctl.geo.travel);

  // Row travel in px -> page scroll position (the inverse of the above).
  const scrollForTravel = (ctl, travel) =>
    ctl.geo.S0 + ctl.geo.dwellStartPx + travel * CONFIG.ratio;

  // Where the row has to be for `slot` to sit fully inside it (honoring scroll-padding),
  // starting from where it is now. Measured in content space, so it does not matter where
  // the browser's own focus scroll has left scrollLeft.
  const travelToReveal = (ctl, slot) => {
    const { row, geo } = ctl;
    const rowRect = row.getBoundingClientRect();
    const slotRect = slot.getBoundingClientRect();
    const style = window.getComputedStyle(row);
    const padLeft = parseFloat(style.scrollPaddingLeft) || 0;
    const padRight = parseFloat(style.scrollPaddingRight) || 0;
    const slotLeft = slotRect.left - rowRect.left + row.scrollLeft;
    const slotRight = slotLeft + slotRect.width;
    const view = row.clientWidth;
    const now = ctl.pos;

    let want = now;
    if (slotRect.width >= view - padLeft - padRight || slotLeft < now + padLeft) {
      want = slotLeft - padLeft;
    } else if (slotRight > now + view - padRight) {
      want = slotRight - (view - padRight);
    }
    return clamp(want, 0, geo.travel);
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
      refreshGeometry(ctl);
      if (ctl.geo.travel < CONFIG.minTravel) {
        ctl.scene.style.removeProperty('--seafloor-scene-h');
        ctl.scene.setAttribute('data-seafloor-mode', 'strip');
        ctl.scene.setAttribute('data-seafloor-reason', 'no-travel');
        return;
      }

      ctl.pos = 0;

      ctl.sync = () => {
        ctl.pos = travelForScroll(ctl, window.scrollY);
        ctl.row.scrollLeft = ctl.pos;
      };

      // Focus becomes a page scroll: the page scroll owns the row's position, so moving to a
      // slot means scrolling the page to where that slot is fully visible. The browser's own
      // focus scroll may already have nudged scrollLeft, which sync() then puts right.
      ctl.onFocus = guard(ctl, 'focus', (slot) => {
        const want = travelToReveal(ctl, slot);
        if (Math.abs(want - ctl.pos) > 0.5) {
          window.scrollTo({ top: scrollForTravel(ctl, want), behavior: 'instant' });
        }
        ctl.sync();
        window.setTimeout(
          guard(ctl, 'focus', () => {
            if (ctl.sync) ctl.sync();
          }),
          0
        );
      });

      const onScroll = guard(ctl, 'scroll', () => ctl.sync());
      const onLayout = guard(ctl, 'layout', () => {
        // fonts.ready cannot be unsubscribed, so this must be inert after teardown.
        if (ctl.mode !== 'enhanced') return;
        refreshGeometry(ctl);
        ctl.sync();
      });

      listen(ctl, window, 'scroll', onScroll, { passive: true });
      listen(ctl, window, 'resize', onLayout);
      listen(ctl, window, 'load', onLayout);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(onLayout);

      const rowObserver = new ResizeObserver(onLayout);
      rowObserver.observe(ctl.row);
      ctl.cleanups.push(() => rowObserver.disconnect());

      // Last step: only now does the scene claim to be enhanced. Applying the class changes
      // layout (overflow, sticky), so measure once more and put the row where the page says.
      ctl.mode = 'enhanced';
      ctl.scene.removeAttribute('data-seafloor-reason');
      ctl.scene.setAttribute('data-seafloor-mode', 'enhanced');
      ctl.scene.classList.add(ENHANCED_CLASS);
      refreshGeometry(ctl);
      ctl.sync();
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
