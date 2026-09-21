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

  // Only known while this script is first running (it is deferred, so currentScript is set).
  const SCRIPT_SRC = document.currentScript && document.currentScript.src;

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

    // --- Weight and inertia -------------------------------------------------
    // The row follows the page scroll with a critically damped spring, so it can never
    // overshoot or bounce. smoothTime is how long (s) the row takes to close most of the gap
    // to where the scroll says it should be: bigger is heavier.
    smoothTime: 0.45,
    // Top speed of the row, in slot-widths per second, so a hard flick cannot fling it.
    maxSpeedSlots: 6,
    // smoothTime multiplier by input device. Trackpads and touch already carry the OS's own
    // momentum, so they get less of ours; a mouse wheel arrives in steps and gets all of it.
    inputScale: { wheel: 1.15, trackpad: 0.6, touch: 0.65 },
    // Carry the fraction of a pixel that scrollLeft cannot hold (it rounds to whole px) as a
    // transform on the slots, so the slow tail of the ease stays smooth on 1x screens.
    subpixel: true,
    // For hand tuning only (set by the tuning panel): lets the scroll-linked mode run on a
    // machine that asks for reduced motion. Never true for visitors.
    ignoreReducedMotion: false,

    // --- Touch ---------------------------------------------------------------
    // Finger travel (px) before a touch counts as a horizontal drag, not a tap.
    dragSlop: 8,
    // After a drag ends the row coasts on for (release speed x flingTime) px, glided in by the
    // follower. Seconds; bigger coasts further. It never coasts past either end.
    flingTime: 0.3,
    // Slower releases than this (px/s) just stop where they are.
    flingMinSpeed: 150,
    // Longest coast, in slot-widths, so one flick cannot cross the whole row.
    flingMaxSlots: 4,
  };

  // Once the row has travelled this far (px) the scroll cue has done its job.
  const CUE_DISMISS_DISTANCE = 16;

  // The follower is at rest when it is this close to (px) and this slow relative to (px/s)
  // its target; then the animation loop stops.
  const REST_DISTANCE = 0.05;
  const REST_VELOCITY = 0.5;
  // Longest single step the physics will take (s), so a stalled tab cannot cause a lurch.
  const MAX_DT = 0.05;
  // If the animation loop is asked to run in a visible tab and no frame arrives within this
  // long (ms), the scene degrades to direct (unsmoothed) mapping instead of freezing.
  const WATCHDOG_MS = 1000;

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
    if (!CONFIG.ignoreReducedMotion && window.matchMedia(REDUCED_MOTION).matches) {
      return 'reduced-motion';
    }
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
    ctl.scene.removeAttribute('data-seafloor-cue');
    ctl.cueGone = false;
    ctl.onFocus = null;
    ctl.sync = null;
    ctl.jump = null;
    ctl.tick = null;
    ctl.step = null;
    ctl.wake = null;
    ctl.geo = null;
  };

  // Critically damped spring step (the "SmoothDamp" form). Given where the row is, where the
  // page scroll says it should be, and its velocity, returns the next position and velocity.
  // The impulse response of a critically damped system is never negative, so for any target
  // that stays inside [0, travel] the output stays inside it too and only ever approaches:
  // no overshoot, no bounce. The final check guards the last rounding error of the
  // approximation.
  const smoothDamp = (current, target, velocity, smoothTime, maxSpeed, dt) => {
    const time = Math.max(0.0001, smoothTime);
    const omega = 2 / time;
    const x = omega * dt;
    const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);

    const maxChange = maxSpeed * time;
    const change = clamp(current - target, -maxChange, maxChange);
    const clampedTarget = current - change;

    const temp = (velocity + omega * change) * dt;
    let nextVelocity = (velocity - omega * temp) * decay;
    let output = clampedTarget + (change + temp) * decay;

    if (target - current > 0 === output > target) {
      output = target;
      nextVelocity = 0;
    }
    return [output, nextVelocity];
  };

  // scrollLeft rounds to whole pixels, so write the integer part there and hand the leftover
  // fraction to the slots as a transform (see CONFIG.subpixel and the stylesheet).
  const writeRow = (ctl, x) => {
    const whole = Math.round(x);
    ctl.row.scrollLeft = whole;
    if (!ctl.cueGone && x > CUE_DISMISS_DISTANCE) {
      ctl.cueGone = true;
      ctl.scene.setAttribute('data-seafloor-cue', 'gone');
    }
    if (CONFIG.subpixel) {
      ctl.row.style.setProperty('--seafloor-frac', `${(whole - x).toFixed(3)}px`);
    } else {
      ctl.row.style.removeProperty('--seafloor-frac');
    }
  };

  // Guess the input device from a wheel event. Mouse wheels report whole, large steps (or
  // line/page units); trackpads report many small, often fractional, deltas. This is a
  // heuristic, so callers vote (see the wheel listener) rather than flip on one event.
  const classifyWheel = (event) => {
    if (event.deltaMode !== 0) return 'wheel';
    const size = Math.abs(event.deltaY);
    return Number.isInteger(size) && size >= 40 ? 'wheel' : 'trackpad';
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

    // Distance from one slot to the next (piece + gap): the unit the top speed is set in.
    const slots = row.querySelectorAll(SLOT);
    const slotStep =
      slots.length > 1
        ? slots[1].getBoundingClientRect().left - slots[0].getBoundingClientRect().left
        : slots[0].getBoundingClientRect().width;

    ctl.geo = {
      travel,
      frameH,
      dwellStartPx,
      dwellEndPx,
      pinLen,
      S0,
      S1: S0 + pinLen,
      slotStep: slotStep > 0 ? slotStep : 300,
    };
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

      // Follower state. `target` is where the page scroll says the row should be; `pos` is
      // where it is; `vel` is its speed (px/s).
      ctl.pos = 0;
      ctl.target = 0;
      ctl.vel = 0;
      ctl.input = 'wheel';
      ctl.inputVotes = 0;
      ctl.raf = 0;
      ctl.lastTs = 0;
      ctl.lastFrame = performance.now();
      ctl.wakeAt = 0;
      ctl.watchdog = 0;
      ctl.degraded = false;

      // Put the row exactly where the page says, with no easing. Used when the position must
      // not glide: first paint (including a reload or back navigation that restores the
      // scroll position) and resize.
      ctl.jump = () => {
        const target = travelForScroll(ctl, window.scrollY);
        ctl.target = target;
        ctl.pos = target;
        ctl.vel = 0;
        writeRow(ctl, target);
      };
      ctl.sync = ctl.jump;

      // One physics step of dt seconds. Returns true while the row is still moving.
      ctl.tick = (dt) => {
        const target = travelForScroll(ctl, window.scrollY);
        ctl.target = target;

        const smoothTime = Math.max(0.05, CONFIG.smoothTime * (CONFIG.inputScale[ctl.input] || 1));
        const maxSpeed = CONFIG.maxSpeedSlots * ctl.geo.slotStep;
        const [pos, vel] = smoothDamp(ctl.pos, target, ctl.vel, smoothTime, maxSpeed, dt);
        ctl.pos = pos;
        ctl.vel = vel;

        const atRest = Math.abs(target - pos) < REST_DISTANCE && Math.abs(vel) < REST_VELOCITY;
        if (atRest) {
          ctl.pos = target;
          ctl.vel = 0;
        }
        writeRow(ctl, ctl.pos);
        return !atRest;
      };

      ctl.step = guard(ctl, 'frame', (timestamp) => {
        ctl.raf = 0;
        ctl.lastFrame = performance.now();
        const dt = ctl.lastTs ? clamp((timestamp - ctl.lastTs) / 1000, 0, MAX_DT) : 1 / 60;
        ctl.lastTs = timestamp;

        if (ctl.tick(dt)) {
          ctl.raf = window.requestAnimationFrame(ctl.step);
        } else {
          ctl.lastTs = 0;
        }
      });

      // The loop only runs while there is something to animate. If it was asked to run in a
      // visible tab and no frame ever arrives, stop trusting it: degrade to direct mapping
      // (still pinned, still scroll-driven, just unsmoothed) instead of freezing the row.
      const checkWatchdog = guard(ctl, 'watchdog', () => {
        ctl.watchdog = 0;
        if (ctl.mode !== 'enhanced' || !ctl.raf) return;
        if (document.visibilityState !== 'visible' || ctl.lastFrame >= ctl.wakeAt) return;

        window.cancelAnimationFrame(ctl.raf);
        ctl.raf = 0;
        ctl.degraded = true;
        ctl.scene.setAttribute('data-seafloor-degraded', 'true');
        if (window.console && console.warn) {
          console.warn('[seafloor] animation frames stalled; using direct scroll mapping');
        }
        ctl.jump();
      });

      ctl.wake = () => {
        if (ctl.degraded) {
          ctl.jump();
          return;
        }
        if (ctl.raf) return;
        ctl.lastTs = 0;
        ctl.wakeAt = performance.now();
        ctl.raf = window.requestAnimationFrame(ctl.step);
        window.clearTimeout(ctl.watchdog);
        ctl.watchdog = window.setTimeout(checkWatchdog, WATCHDOG_MS);
      };

      // Focus becomes a page scroll: the page scroll owns the row's position, so moving to a
      // slot means scrolling the page to where that slot is fully visible, and the follower
      // glides the row there like any other scroll. The browser's own focus scroll has
      // already snapped scrollLeft by the time this runs (before paint), so put the row back
      // where the follower has it, or the glide would start from the snapped position.
      const holdRow = () => writeRow(ctl, ctl.pos);
      ctl.onFocus = guard(ctl, 'focus', (slot) => {
        const want = travelToReveal(ctl, slot);
        ctl.input = 'wheel';
        ctl.inputVotes = 0;
        if (Math.abs(want - ctl.pos) > 0.5) {
          window.scrollTo({ top: scrollForTravel(ctl, want), behavior: 'instant' });
        }
        holdRow();
        ctl.wake();
        window.setTimeout(
          guard(ctl, 'focus', () => {
            if (ctl.mode === 'enhanced' && !ctl.degraded) holdRow();
          }),
          0
        );
      });

      // Left and Right move focus one piece at a time; the focus handler above does the
      // scrolling. Modified arrows are left to the browser (Alt+Left is Back).
      const onRowKey = guard(ctl, 'arrows', (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const slot = event.target.closest && event.target.closest(SLOT);
        if (!slot) return;
        event.preventDefault();
        const next = event.key === 'ArrowRight' ? slot.nextElementSibling : slot.previousElementSibling;
        const link = next && next.querySelector('a[href]');
        if (link) link.focus({ preventScroll: true });
      });
      listen(ctl, ctl.row, 'keydown', onRowKey);

      // Touch: a horizontal drag anywhere in the frame moves the page scroll (and so the row)
      // by the finger's travel x ratio, so touch, wheel and keys all share one mapping. The
      // stylesheet gives the frame touch-action: pan-y, so vertical swipes stay the browser's
      // own scroll (it cancels our pointer stream when it takes over) and only horizontal
      // drags arrive here. Coasting after release is a scroll target, so the same follower
      // that eases every other input eases this one: no separate momentum loop, no overshoot.
      let drag = null;
      let suppressClickUntil = 0;

      const pinnedNow = () => window.scrollY >= ctl.geo.S0 - 1 && window.scrollY <= ctl.geo.S1;
      const dragScroll = (startY, dx) => {
        const lo = ctl.geo.S0 + ctl.geo.dwellStartPx;
        const hi = Math.max(ctl.geo.S1 - ctl.geo.dwellEndPx, startY);
        return clamp(startY - dx * CONFIG.ratio, lo, hi);
      };

      const onTouchDown = guard(ctl, 'touch-down', (event) => {
        if (event.pointerType !== 'touch' || !event.isPrimary || !pinnedNow()) return;
        // A finger landing on a moving row stops it, as it would a native scroll.
        if (Math.abs(ctl.target - ctl.pos) > 0.5 || Math.abs(ctl.vel) > REST_VELOCITY) {
          window.scrollTo({ top: scrollForTravel(ctl, ctl.pos), behavior: 'instant' });
          ctl.vel = 0;
        }
        drag = {
          id: event.pointerId,
          x: event.clientX,
          startY: window.scrollY,
          active: false,
          samples: [[event.timeStamp, event.clientX]],
        };
      });

      const onTouchMove = guard(ctl, 'touch-move', (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        const dx = event.clientX - drag.x;
        if (!drag.active) {
          if (Math.abs(dx) < CONFIG.dragSlop) return;
          drag.active = true;
        }
        ctl.input = 'touch';
        drag.samples.push([event.timeStamp, event.clientX]);
        if (drag.samples.length > 12) drag.samples.shift();
        window.scrollTo({ top: dragScroll(drag.startY, dx), behavior: 'instant' });
        ctl.wake();
      });

      const onTouchUp = guard(ctl, 'touch-up', (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        const finished = drag;
        drag = null;
        if (!finished.active) return;

        // The click that follows a drag that began on a piece is not a tap on that piece.
        suppressClickUntil = performance.now() + 350;
        if (event.type === 'pointercancel') return;

        // Release speed over the last 100ms before the finger lifted (px/s, finger direction).
        // A finger that paused before lifting leaves too few recent samples, and does not fling.
        const recent = finished.samples.filter((sample) => event.timeStamp - sample[0] <= 100);
        if (recent.length < 2) return;
        const first = recent[0];
        const last = recent[recent.length - 1];
        const elapsed = (last[0] - first[0]) / 1000;
        const speed = elapsed > 0 ? (last[1] - first[1]) / elapsed : 0;
        if (Math.abs(speed) < CONFIG.flingMinSpeed) return;

        const reach = clamp(
          speed * CONFIG.flingTime,
          -CONFIG.flingMaxSlots * ctl.geo.slotStep,
          CONFIG.flingMaxSlots * ctl.geo.slotStep
        );
        // Coast on from where the finger left the scroll (the row itself is still catching up).
        // Released inside the end dwell there is nowhere further to go, so leave it there.
        if (window.scrollY > scrollForTravel(ctl, ctl.geo.travel) + 1) return;
        const travel = clamp(travelForScroll(ctl, window.scrollY) - reach, 0, ctl.geo.travel);
        window.scrollTo({ top: scrollForTravel(ctl, travel), behavior: 'instant' });
        ctl.wake();
      });

      const onClickCapture = guard(ctl, 'touch-click', (event) => {
        if (performance.now() < suppressClickUntil) {
          event.preventDefault();
          event.stopPropagation();
        }
      });

      listen(ctl, ctl.frame, 'pointerdown', onTouchDown, { passive: true });
      listen(ctl, ctl.frame, 'pointermove', onTouchMove, { passive: true });
      listen(ctl, ctl.frame, 'pointerup', onTouchUp, { passive: true });
      listen(ctl, ctl.frame, 'pointercancel', onTouchUp, { passive: true });
      listen(ctl, ctl.frame, 'click', onClickCapture, true);

      const onScroll = guard(ctl, 'scroll', () => ctl.wake());
      const onLayout = guard(ctl, 'layout', () => {
        // fonts.ready cannot be unsubscribed, so this must be inert after teardown.
        if (ctl.mode !== 'enhanced') return;
        refreshGeometry(ctl);
        ctl.jump();
      });
      const onWheel = guard(ctl, 'wheel', (event) => {
        const kind = classifyWheel(event);
        if (kind === ctl.input) {
          ctl.inputVotes = 0;
        } else {
          ctl.inputVotes += 1;
          if (ctl.inputVotes >= 3) {
            ctl.input = kind;
            ctl.inputVotes = 0;
          }
        }
      });
      const onPointerDown = guard(ctl, 'pointer', (event) => {
        if (event.pointerType === 'touch' || event.pointerType === 'pen') ctl.input = 'touch';
      });
      const onKeyDown = guard(ctl, 'key', (event) => {
        // Keyboard scrolling arrives as the browser's own short glide; treat it like a wheel.
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
          ctl.input = 'wheel';
          ctl.inputVotes = 0;
        }
      });

      listen(ctl, window, 'scroll', onScroll, { passive: true });
      listen(ctl, window, 'wheel', onWheel, { passive: true });
      listen(ctl, window, 'pointerdown', onPointerDown, { passive: true });
      listen(ctl, window, 'keydown', onKeyDown, { passive: true });
      listen(ctl, window, 'resize', onLayout);
      listen(ctl, window, 'load', onLayout);
      listen(ctl, window, 'pageshow', onLayout);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(onLayout);

      const rowObserver = new ResizeObserver(onLayout);
      rowObserver.observe(ctl.row);
      ctl.cleanups.push(() => rowObserver.disconnect());
      ctl.cleanups.push(() => {
        window.cancelAnimationFrame(ctl.raf);
        window.clearTimeout(ctl.watchdog);
        ctl.row.style.removeProperty('--seafloor-frac');
        ctl.scene.removeAttribute('data-seafloor-degraded');
      });

      // Last step: only now does the scene claim to be enhanced. Applying the class changes
      // layout (overflow, sticky), so measure once more and put the row where the page says.
      ctl.mode = 'enhanced';
      ctl.scene.removeAttribute('data-seafloor-reason');
      ctl.scene.setAttribute('data-seafloor-mode', 'enhanced');
      ctl.scene.classList.add(ENHANCED_CLASS);
      refreshGeometry(ctl);
      ctl.jump();
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

  // Reduced motion can change while the page is open (an OS setting, or a battery saver), so
  // follow it live: asking for less motion drops every scene back to the plain strip at once,
  // and clearing it brings the scroll-linked mode back.
  const applyMotionPreference = () => {
    const reduced = !CONFIG.ignoreReducedMotion && window.matchMedia(REDUCED_MOTION).matches;
    controllers.forEach((ctl) => {
      try {
        if (reduced && ctl.mode === 'enhanced') {
          teardown(ctl);
          ctl.scene.setAttribute('data-seafloor-reason', 'reduced-motion');
        } else if (!reduced && ctl.mode !== 'enhanced') {
          enhance(ctl);
        }
      } catch (error) {
        failSafe(ctl, 'motion-preference', error);
      }
    });
  };

  if (typeof window.matchMedia === 'function') {
    const motionQuery = window.matchMedia(REDUCED_MOTION);
    if (motionQuery.addEventListener) {
      motionQuery.addEventListener('change', applyMotionPreference);
    } else if (motionQuery.addListener) {
      motionQuery.addListener(applyMotionPreference);
    }
  }

  // Run the physics for `ms` milliseconds in fixed 60Hz steps, synchronously and without
  // waiting for animation frames. For verification only: it makes the follower testable
  // in a page that is not being painted.
  const advance = (ms) => {
    const step = 1000 / 60;
    controllers.forEach((ctl) => {
      if (ctl.mode !== 'enhanced' || !ctl.tick) return;
      for (let left = ms; left > 0; left -= step) ctl.tick(Math.min(step, left) / 1000);
    });
  };

  // The tuning panel changed a setting that shapes the page's geometry (ratio, dwell). Rebuild
  // the geometry and put the row back where it was, so tuning does not fling it elsewhere.
  const retune = () => {
    controllers.forEach((ctl) => {
      if (ctl.mode !== 'enhanced' || !ctl.geo) return;
      guard(ctl, 'retune', () => {
        const travel = ctl.pos;
        refreshGeometry(ctl);
        window.scrollTo({ top: scrollForTravel(ctl, clamp(travel, 0, ctl.geo.travel)), behavior: 'instant' });
        ctl.jump();
      })();
    });
  };

  // Surface used for verification and by the tuning panel.
  window.seafloorRow = {
    controllers,
    config: CONFIG,
    guard,
    failSafe,
    enhance,
    teardown,
    advance,
    smoothDamp,
    applyMotionPreference,
    retune,
  };

  // Hand-tuning panel: only fetched when the address carries ?seafloor-tune, so ordinary
  // visitors never download it. It changes CONFIG live and prints the values to keep.
  if (SCRIPT_SRC && /[?&]seafloor-tune(=|&|$)/.test(window.location.search)) {
    const panel = document.createElement('script');
    panel.src = SCRIPT_SRC.replace('seafloor-row.js', 'seafloor-tune.js');
    panel.defer = true;
    document.head.appendChild(panel);
  }

  init();
  window.addEventListener('resize', measure);
  window.addEventListener('load', measure);
  window.addEventListener('pageshow', measure);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  document.addEventListener('shopify:section:load', init);
})();
