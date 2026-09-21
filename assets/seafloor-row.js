/*
  Sizes the seafloor frame to 100svh minus whatever sits above it (announcement bar,
  header, border, header margin) by measuring the frame's own distance from the top of
  the page. The CSS fallback (--seafloor-chrome in seafloor-row.css) covers no-JS.

  Measured synchronously (no requestAnimationFrame): resize and ResizeObserver callbacks
  already run after layout, and rAF is paused in background tabs.

  Also keeps keyboard focus honest: when a piece receives focus, the whole slot (not just
  its title link) is scrolled into the row, so the focus ring and the piece are never left
  half off-screen. Without JS the browser's own focus scrolling still applies; it just may
  leave the half-visible slot at the edge partly cropped.
*/
(() => {
  const FRAME = '.seafloor';
  const ROW = '.seafloor__row';
  const SLOT = '.seafloor-slot';
  const HEADER_GROUP = '.shopify-section-group-header-group';
  let resizeObserver = null;

  const measure = () => {
    document.querySelectorAll(FRAME).forEach((frame) => {
      const chrome = frame.getBoundingClientRect().top + window.scrollY;
      frame.style.setProperty('--seafloor-chrome', `${chrome.toFixed(3)}px`);
    });
  };

  // Scroll the row horizontally until the whole slot sits inside the row's scrollport,
  // keeping the row's scroll-padding on both sides. Only the row's own scrollLeft moves,
  // so the page never jumps. No-op when the slot is already fully inside.
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

  const init = () => {
    measure();
    bindRows();

    if (resizeObserver) resizeObserver.disconnect();
    if ('ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(measure);
      document.querySelectorAll(HEADER_GROUP).forEach((el) => resizeObserver.observe(el));
    }
  };

  init();
  window.addEventListener('resize', measure);
  window.addEventListener('load', measure);
  window.addEventListener('pageshow', measure);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  document.addEventListener('shopify:section:load', init);
})();
