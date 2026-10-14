// Entry point: load or start a game, pick a renderer, and run the main loop.
(function (AF) {
  'use strict';

  AF.state = AF.load() || AF.newGame();

  // Prefer the 3D view; fall back to the 2D map if Three.js or WebGL is unavailable.
  const canvas = document.getElementById('field');
  const field = canvas.parentElement;
  AF.view = null;
  const wantFlat = new URLSearchParams(location.search).has('flat');
  if (!wantFlat && AF.render3d && AF.render3d.supported()) {
    try {
      AF.render3d.init(canvas);
      AF.view = AF.render3d;
      field.classList.add('three');
    } catch (e) {
      console.error('3D view failed to start, using 2D map.', e);
      const fresh = canvas.cloneNode(false); // a canvas with a WebGL context can't be reused for 2D
      canvas.replaceWith(fresh);
    }
  }
  if (!AF.view) {
    AF.render.init(document.getElementById('field'));
    AF.view = AF.render;
    field.classList.add('flat');
  }

  AF.ui.init();
  AF.ui.setTab('station');

  let last = performance.now();
  let acc = 0;
  let uiTimer = 0;

  function frame(now) {
    const dt = Math.min(250, now - last);
    last = now;
    const s = AF.state;

    const mult = AF.SPEEDS[s.speed] || 0;
    if (mult > 0) {
      acc += (dt / 1000) * AF.MINUTES_PER_SECOND * mult;
      while (acc >= 1 && s.speed > 0) { AF.sim.step(s); acc -= 1; } // stop at once if a raid warning pauses
    }
    acc = Math.min(acc, 0.999); // keep the part-minute through a pause so moving aircraft don't jump back
    AF.gameTime = s.time + Math.min(acc, 0.999); // fractional game minutes, for smooth animation

    AF.view.draw(s, now);

    uiTimer += dt;
    if (uiTimer > 150) AF.ui.updateHeader();
    if (AF.dirty || uiTimer > 600) {
      AF.ui.update();
      AF.dirty = false;
      uiTimer = 0;
    }
    if (AF.wantSave) { AF.save(s); AF.wantSave = false; }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.addEventListener('beforeunload', () => AF.save(AF.state));
})(window.AF);
