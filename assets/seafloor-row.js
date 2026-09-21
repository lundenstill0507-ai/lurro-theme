/*
  Sizes the seafloor frame to 100svh minus whatever sits above it (announcement bar,
  header, border, header margin) by measuring the frame's own distance from the top of
  the page. The CSS fallback (--seafloor-chrome in seafloor-row.css) covers no-JS.

  Measured synchronously (no requestAnimationFrame): resize and ResizeObserver callbacks
  already run after layout, and rAF is paused in background tabs.
*/
(() => {
  const FRAME = '.seafloor';
  const HEADER_GROUP = '.shopify-section-group-header-group';
  let resizeObserver = null;

  const measure = () => {
    document.querySelectorAll(FRAME).forEach((frame) => {
      const chrome = frame.getBoundingClientRect().top + window.scrollY;
      frame.style.setProperty('--seafloor-chrome', `${chrome.toFixed(3)}px`);
    });
  };

  const init = () => {
    measure();

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
