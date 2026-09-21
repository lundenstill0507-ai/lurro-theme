/*
  Seafloor tuning panel. Hand tuning only.

  Loaded by seafloor-row.js when the page address carries ?seafloor-tune, and never
  otherwise. It changes the live CONFIG in seafloor-row.js so the scroll feel can be judged
  by hand, remembers the values in this browser, and prints them in the form to paste back.
  Nothing here is saved to the theme.
*/
(() => {
  'use strict';

  const api = window.seafloorRow;
  if (!api || document.getElementById('seafloor-tune')) return;

  const config = api.config;
  const STORE = 'seafloor-tune-v1';

  // geometry: true means the change reshapes the page (runway length), so the row is rebuilt
  // in place and put back where it was.
  const FIELDS = [
    { group: 'Scroll to travel' },
    {
      key: 'ratio',
      label: 'Ratio',
      min: 0.5,
      max: 3,
      step: 0.05,
      geometry: true,
      help: 'Page scroll per pixel of row travel. Higher is slower and makes the page taller.',
    },
    {
      key: 'dwellEnd',
      label: 'End dwell',
      min: 0,
      max: 1,
      step: 0.05,
      geometry: true,
      help: 'Extra pinned scroll after the last piece, as a share of the frame height.',
    },
    {
      key: 'dwellStart',
      label: 'Start dwell',
      min: 0,
      max: 1,
      step: 0.05,
      geometry: true,
      help: 'Extra pinned scroll before the row starts moving.',
    },
    { group: 'Weight' },
    {
      key: 'smoothTime',
      label: 'Smooth time (s)',
      min: 0.05,
      max: 1.5,
      step: 0.01,
      help: 'How long the row takes to catch up. Bigger is heavier.',
    },
    {
      key: 'maxSpeedSlots',
      label: 'Top speed (pieces/s)',
      min: 1,
      max: 20,
      step: 0.5,
      help: 'Ceiling on row speed so a hard flick cannot fling it.',
    },
    { group: 'Smoothing by device (multiplies smooth time)' },
    { key: 'inputScale.wheel', label: 'Mouse wheel', min: 0.1, max: 2, step: 0.05 },
    { key: 'inputScale.trackpad', label: 'Trackpad', min: 0.1, max: 2, step: 0.05 },
    { key: 'inputScale.touch', label: 'Touch', min: 0.1, max: 2, step: 0.05 },
    { group: 'Touch release' },
    {
      key: 'flingTime',
      label: 'Coast time (s)',
      min: 0,
      max: 1,
      step: 0.05,
      help: 'How far the row coasts after a swipe: release speed times this.',
    },
    { key: 'flingMinSpeed', label: 'Min coast speed (px/s)', min: 0, max: 600, step: 10 },
    { key: 'flingMaxSlots', label: 'Longest coast (pieces)', min: 0.5, max: 10, step: 0.5 },
    { group: 'Switches' },
    {
      key: 'subpixel',
      label: 'Sub-pixel smoothing',
      type: 'checkbox',
      help: 'Turn off to see the row step in whole pixels.',
    },
    {
      key: 'ignoreReducedMotion',
      label: 'Ignore reduced-motion setting',
      type: 'checkbox',
      tuningOnly: true,
      help: 'Tuning only. Lets this machine show the scroll-linked mode even if its system asks for less motion. Not saved and never applies to visitors.',
    },
  ];

  const read = (key) => key.split('.').reduce((node, part) => node[part], config);
  const write = (key, value) => {
    const parts = key.split('.');
    const last = parts.pop();
    parts.reduce((node, part) => node[part], config)[last] = value;
  };

  const defaults = {};
  FIELDS.forEach((field) => {
    if (field.key) defaults[field.key] = read(field.key);
  });

  const safeStorage = {
    get() {
      try {
        return JSON.parse(window.localStorage.getItem(STORE) || 'null');
      } catch (error) {
        return null;
      }
    },
    set(value) {
      try {
        window.localStorage.setItem(STORE, JSON.stringify(value));
      } catch (error) {
        // Values still apply for this page view; they just will not survive a reload.
      }
    },
    clear() {
      try {
        window.localStorage.removeItem(STORE);
      } catch (error) {
        // Nothing stored.
      }
    },
  };

  const current = () => {
    const values = {};
    FIELDS.forEach((field) => {
      if (field.key && !field.tuningOnly) values[field.key] = read(field.key);
    });
    return values;
  };

  const round = (value) => Number(Number(value).toFixed(3));

  const printable = () => {
    const values = current();
    const num = (key) => round(values[key]);
    return [
      `ratio: ${num('ratio')},`,
      `dwellStart: ${num('dwellStart')},`,
      `dwellEnd: ${num('dwellEnd')},`,
      `smoothTime: ${num('smoothTime')},`,
      `maxSpeedSlots: ${num('maxSpeedSlots')},`,
      `inputScale: { wheel: ${num('inputScale.wheel')}, trackpad: ${num('inputScale.trackpad')}, touch: ${num('inputScale.touch')} },`,
      `subpixel: ${values.subpixel},`,
      `flingTime: ${num('flingTime')},`,
      `flingMinSpeed: ${num('flingMinSpeed')},`,
      `flingMaxSlots: ${num('flingMaxSlots')},`,
    ].join('\n');
  };

  // Apply stored values before building the panel, then rebuild geometry once.
  const stored = safeStorage.get();
  if (stored && typeof stored === 'object') {
    Object.keys(stored).forEach((key) => {
      if (key in defaults && typeof stored[key] === typeof defaults[key]) write(key, stored[key]);
    });
    api.retune();
  }

  // ---------------------------------------------------------------------------
  // Panel
  // ---------------------------------------------------------------------------

  const style = document.createElement('style');
  style.textContent = `
    #seafloor-tune { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; width: 340px; max-width: calc(100vw - 32px); font: 14px/1.4 system-ui, sans-serif; color: #f5f3ed; }
    #seafloor-tune * { box-sizing: border-box; }
    #seafloor-tune .st-toggle { display: block; margin-left: auto; min-height: 44px; padding: 0 16px; border: 1px solid #f5f3ed; border-radius: 8px; background: #0a0f14; color: #f5f3ed; font: inherit; font-weight: 600; cursor: pointer; }
    #seafloor-tune .st-body { display: none; max-height: calc(100vh - 96px); margin-top: 8px; padding: 16px; overflow-y: auto; overscroll-behavior: contain; border: 1px solid #5f7f7e; border-radius: 8px; background: #0a0f14; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5); }
    #seafloor-tune.st-open .st-body { display: block; }
    #seafloor-tune h2 { margin: 16px 0 8px; font: 600 14px/1.4 system-ui, sans-serif; color: #d8c9b3; }
    #seafloor-tune h2:first-child { margin-top: 0; }
    #seafloor-tune .st-row { margin-bottom: 12px; }
    #seafloor-tune .st-line { display: flex; align-items: center; gap: 8px; }
    #seafloor-tune label { display: block; flex: 1 1 100%; margin-bottom: 4px; }
    #seafloor-tune .st-line label { margin: 0; }
    #seafloor-tune input[type='range'] { flex: 1 1 auto; min-width: 0; height: 32px; accent-color: #b89b6b; }
    #seafloor-tune input[type='number'] { flex: 0 0 76px; min-height: 36px; padding: 0 8px; border: 1px solid #5f7f7e; border-radius: 4px; background: #13212b; color: #f5f3ed; font: inherit; }
    #seafloor-tune input[type='checkbox'] { flex: 0 0 auto; width: 24px; height: 24px; accent-color: #b89b6b; }
    #seafloor-tune .st-help { margin: 4px 0 0; color: #b8c4c3; font-size: 12px; }
    #seafloor-tune button.st-action { min-height: 44px; margin: 0 8px 8px 0; padding: 0 16px; border: 1px solid #f5f3ed; border-radius: 8px; background: #13212b; color: #f5f3ed; font: inherit; cursor: pointer; }
    #seafloor-tune textarea { width: 100%; height: 190px; padding: 8px; border: 1px solid #5f7f7e; border-radius: 4px; background: #13212b; color: #f5f3ed; font: 12px/1.5 ui-monospace, Consolas, monospace; resize: vertical; }
    #seafloor-tune .st-status { margin: 0 0 16px; padding: 8px; border-radius: 4px; background: #13212b; font: 12px/1.5 ui-monospace, Consolas, monospace; white-space: pre-wrap; }
    #seafloor-tune .st-note { margin: 0 0 16px; color: #b8c4c3; font-size: 12px; }
    #seafloor-tune button:focus-visible, #seafloor-tune input:focus-visible, #seafloor-tune textarea:focus-visible { outline: 2px solid #f5f3ed; outline-offset: 2px; }
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'seafloor-tune';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'st-toggle';
  toggle.textContent = 'Tuning';
  toggle.setAttribute('aria-expanded', 'false');

  const body = document.createElement('div');
  body.className = 'st-body';
  body.setAttribute('role', 'group');
  body.setAttribute('aria-label', 'Seafloor scroll tuning');

  const note = document.createElement('p');
  note.className = 'st-note';
  note.textContent =
    'Changes apply live and are remembered in this browser. Nothing is saved to the theme. Copy the values at the bottom and send them back when the feel is right.';
  body.appendChild(note);

  const status = document.createElement('p');
  status.className = 'st-status';
  status.setAttribute('aria-hidden', 'true');
  body.appendChild(status);

  const output = document.createElement('textarea');
  output.readOnly = true;
  output.setAttribute('aria-label', 'Current values');

  const controls = {};
  let uid = 0;

  const save = () => {
    safeStorage.set(current());
    output.value = printable();
  };

  const applyChange = (field, value) => {
    write(field.key, value);
    if (field.geometry) api.retune();
    if (field.key === 'ignoreReducedMotion') api.applyMotionPreference();
    save();
  };

  FIELDS.forEach((field) => {
    if (field.group) {
      const heading = document.createElement('h2');
      heading.textContent = field.group;
      body.appendChild(heading);
      return;
    }

    uid += 1;
    const id = `st-${uid}`;
    const row = document.createElement('div');
    row.className = 'st-row';

    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = field.label;

    if (field.type === 'checkbox') {
      const line = document.createElement('div');
      line.className = 'st-line';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.id = id;
      box.checked = !!read(field.key);
      box.addEventListener('change', () => applyChange(field, box.checked));
      line.append(box, label);
      row.appendChild(line);
      controls[field.key] = (value) => {
        box.checked = !!value;
      };
    } else {
      const line = document.createElement('div');
      line.className = 'st-line';
      const range = document.createElement('input');
      range.type = 'range';
      const number = document.createElement('input');
      number.type = 'number';
      number.id = id;
      [range, number].forEach((input) => {
        input.min = field.min;
        input.max = field.max;
        input.step = field.step;
        input.value = read(field.key);
      });
      range.setAttribute('aria-label', `${field.label} slider`);
      const sync = (from) => {
        const value = parseFloat(from.value);
        if (Number.isNaN(value)) return;
        range.value = value;
        number.value = value;
        applyChange(field, value);
      };
      range.addEventListener('input', () => sync(range));
      number.addEventListener('change', () => sync(number));
      row.appendChild(label);
      line.append(range, number);
      row.appendChild(line);
      controls[field.key] = (value) => {
        range.value = value;
        number.value = value;
      };
    }

    if (field.help) {
      const help = document.createElement('p');
      help.className = 'st-help';
      help.textContent = field.help;
      row.appendChild(help);
    }
    body.appendChild(row);
  });

  const actions = document.createElement('div');

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'st-action';
  copy.textContent = 'Copy values';
  copy.addEventListener('click', () => {
    output.value = printable();
    const done = () => {
      copy.textContent = 'Copied';
      window.setTimeout(() => {
        copy.textContent = 'Copy values';
      }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(output.value).then(done, () => {
        output.select();
      });
    } else {
      output.select();
      try {
        document.execCommand('copy');
        done();
      } catch (error) {
        // The text is selected; copy it by hand.
      }
    }
  });

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'st-action';
  reset.textContent = 'Reset to start values';
  reset.addEventListener('click', () => {
    Object.keys(defaults).forEach((key) => {
      write(key, defaults[key]);
      if (controls[key]) controls[key](defaults[key]);
    });
    safeStorage.clear();
    api.retune();
    api.applyMotionPreference();
    output.value = printable();
  });

  actions.append(copy, reset);
  body.append(actions, output);
  output.value = printable();

  root.append(toggle, body);
  document.body.appendChild(root);

  toggle.addEventListener('click', () => {
    const open = root.classList.toggle('st-open');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? 'Close tuning' : 'Tuning';
  });

  // Live readout of what the follower is doing, so a feel can be described with numbers.
  const tick = () => {
    if (!root.classList.contains('st-open')) return;
    const ctl = api.controllers[0];
    if (!ctl) return;
    const lines = [`mode: ${ctl.mode}${ctl.degraded ? ' (degraded: no animation frames)' : ''}`];
    const reason = ctl.scene.getAttribute('data-seafloor-reason');
    if (ctl.mode !== 'enhanced' && reason) lines.push(`why not: ${reason}`);
    if (ctl.mode === 'enhanced') {
      lines.push(`device guess: ${ctl.input}`);
      lines.push(`row: ${Math.round(ctl.pos)} of ${Math.round(ctl.geo.travel)} px`);
      lines.push(`speed: ${Math.round(ctl.vel)} px/s`);
      lines.push(`runway: ${Math.round(ctl.geo.pinLen)} px of scroll`);
    }
    status.textContent = lines.join('\n');
  };
  window.setInterval(tick, 200);

  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    note.textContent +=
      ' This machine asks for reduced motion, so the scroll-linked mode is off until you tick "Ignore reduced-motion setting" below.';
  }
})();
