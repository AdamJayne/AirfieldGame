// Procedural canvas textures for the 3D view. All UVs in the 3D scene are in metres,
// so each texture's repeat is set from the real-world size of one tile.
(function (AF) {
  'use strict';
  if (!window.THREE) return;

  const T = (AF.tex = {});
  const cache = {};

  T.rng = function (seed) {
    let a = seed | 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  // opts.tile: metres covered by one repeat of the texture (omit for clamp/no-repeat textures)
  T.make = function (key, w, h, draw, opts = {}) {
    if (cache[key]) return cache[key];
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h, T.rng(hash(key)));
    const t = new THREE.CanvasTexture(c);
    if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
    if (opts.tile) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      const [tx, ty] = Array.isArray(opts.tile) ? opts.tile : [opts.tile, opts.tile];
      t.repeat.set(1 / tx, 1 / ty);
    }
    t.anisotropy = 16; // clamped to the GPU maximum; sharp ground textures at grazing angles without shimmer
    cache[key] = t;
    return t;
  };

  // Speckle noise over a base colour; palette entries are [r,g,b].
  function speckle(g, w, h, rnd, base, palette, count, size = [1, 3], alpha = 0.35) {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < count; i++) {
      const [r, gg, b] = palette[Math.floor(rnd() * palette.length)];
      g.fillStyle = `rgba(${r},${gg},${b},${alpha * (0.4 + rnd() * 0.6)})`;
      const s = size[0] + rnd() * (size[1] - size[0]);
      g.fillRect(rnd() * w, rnd() * h, s, s);
    }
  }

  // Soft large-scale blotches so tiles don't look uniform.
  function blotches(g, w, h, rnd, n, colors, rmin, rmax) {
    for (let i = 0; i < n; i++) {
      const x = rnd() * w, y = rnd() * h, r = rmin + rnd() * (rmax - rmin);
      const col = colors[Math.floor(rnd() * colors.length)];
      for (const [dx, dy] of [[0, 0], [w, 0], [-w, 0], [0, h], [0, -h]]) { // wrap for seamless tiling
        const grd = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        grd.addColorStop(0, col);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd;
        g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      }
    }
  }

  T.grass = () => T.make('grass', 512, 512, (g, w, h, rnd) => {
    g.fillStyle = '#56742f';
    g.fillRect(0, 0, w, h);
    // soft and faint: strong blotches repeat visibly every tile (the grass mesh's vertex colours
    // supply the large-scale variation)
    blotches(g, w, h, rnd, 26, ['rgba(120,140,60,0.07)', 'rgba(40,64,22,0.07)', 'rgba(110,118,58,0.06)'], 80, 200);
    // Low-contrast blades: high-contrast detail repeats visibly and shimmers as the camera moves.
    const pal = ['#4b6a2a', '#50702c', '#5f7e34', '#66853a', '#56742f', '#6a8840', '#4e6d2b'];
    for (let i = 0; i < 26000; i++) {
      g.strokeStyle = pal[Math.floor(rnd() * pal.length)];
      g.globalAlpha = 0.25 + rnd() * 0.35;
      g.lineWidth = 0.6 + rnd() * 0.9;
      const x = rnd() * w, y = rnd() * h, a = -Math.PI / 2 + (rnd() - 0.5) * 1.3, l = 2 + rnd() * 5;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    g.globalAlpha = 1;
  }, { tile: 14 });

  // Mowing stripes run along the texture's x axis (the runway's length).
  // Neutral leafy speckle; tree colour comes from per-instance tint.
  T.foliage = () => T.make('foliage', 256, 256, (g, w, h, rnd) => {
    g.fillStyle = '#b8b8b8';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 7000; i++) {
      const v = Math.round(90 + rnd() * 165);
      g.fillStyle = `rgba(${v},${v},${v},${0.5 + rnd() * 0.5})`;
      g.beginPath();
      g.ellipse(rnd() * w, rnd() * h, 1.5 + rnd() * 3, 1 + rnd() * 2, rnd() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
  }, { tile: 1 });

  T.mown = () => T.make('mown', 512, 256, (g, w, h, rnd) => {
    g.fillStyle = '#6b8a3c';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(160,180,90,0.22)';
    g.fillRect(0, 0, w, h / 2);
    const pal = [[70, 100, 40], [120, 150, 70], [95, 125, 50]];
    for (let i = 0; i < 9000; i++) {
      const [r, gg, b] = pal[Math.floor(rnd() * pal.length)];
      g.fillStyle = `rgba(${r},${gg},${b},${0.3 + rnd() * 0.4})`;
      g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 2 + rnd() * 4);
    }
  }, { tile: [48, 24] });

  T.dirt = () => T.make('dirt', 256, 256, (g, w, h, rnd) => {
    speckle(g, w, h, rnd, '#7a684b', [[60, 48, 32], [140, 120, 90], [100, 85, 60], [90, 100, 50]], 7000, [1, 4], 0.45);
    blotches(g, w, h, rnd, 10, ['rgba(60,50,30,0.25)', 'rgba(150,130,95,0.25)'], 20, 70);
  }, { tile: 6 });

  T.gravel = () => T.make('gravel', 256, 256, (g, w, h, rnd) => {
    speckle(g, w, h, rnd, '#8f8572', [[60, 55, 48], [180, 170, 150], [120, 110, 95], [200, 195, 180]], 12000, [1, 3], 0.6);
  }, { tile: 4 });

  T.concrete = () => T.make('concrete', 512, 512, (g, w, h, rnd) => {
    speckle(g, w, h, rnd, '#a6a397', [[80, 78, 72], [170, 168, 160], [120, 115, 105]], 22000, [1, 2], 0.25);
    blotches(g, w, h, rnd, 14, ['rgba(70,65,55,0.08)', 'rgba(200,198,190,0.1)', 'rgba(110,100,70,0.07)'], 30, 110);
    g.strokeStyle = 'rgba(50,48,42,0.35)';
    g.lineWidth = 1.5;
    for (let i = 0; i <= 2; i++) { // expansion joints: 5 m slabs on a 10 m tile
      g.beginPath(); g.moveTo(0, i * h / 2); g.lineTo(w, i * h / 2); g.stroke();
      g.beginPath(); g.moveTo(i * w / 2, 0); g.lineTo(i * w / 2, h); g.stroke();
    }
    // oil stains
    blotches(g, w, h, rnd, 2, ['rgba(30,28,25,0.12)'], 8, 20);
  }, { tile: 10 });

  T.asphalt = () => T.make('asphalt', 512, 512, (g, w, h, rnd) => {
    speckle(g, w, h, rnd, '#4b4b48', [[30, 30, 30], [110, 108, 102], [70, 70, 66], [140, 136, 128]], 30000, [1, 2], 0.4);
    blotches(g, w, h, rnd, 14, ['rgba(20,20,20,0.18)', 'rgba(120,118,110,0.12)'], 30, 110);
  }, { tile: 14 });

  T.brick = () => T.make('brick', 256, 256, (g, w, h, rnd) => {
    g.fillStyle = '#a89b84';
    g.fillRect(0, 0, w, h);
    const bw = 32, bh = 10;
    const cols = ['#8b4434', '#7d3b2d', '#93503b', '#6f3428', '#86493a', '#9a5a44'];
    for (let row = 0; row * bh < h; row++) {
      const off = row % 2 ? bw / 2 : 0;
      for (let x = -bw; x < w + bw; x += bw) {
        g.fillStyle = cols[Math.floor(rnd() * cols.length)];
        g.fillRect(x + off + 1, row * bh + 1, bw - 2, bh - 2);
        g.fillStyle = `rgba(0,0,0,${rnd() * 0.12})`;
        g.fillRect(x + off + 1, row * bh + 1, bw - 2, bh - 2);
      }
    }
  }, { tile: 1.8 });

  T.render = () => T.make('render', 256, 256, (g, w, h, rnd) => {
    speckle(g, w, h, rnd, '#d6d0c0', [[180, 172, 155], [235, 230, 220], [160, 150, 130]], 9000, [1, 3], 0.3);
    blotches(g, w, h, rnd, 8, ['rgba(120,110,90,0.12)'], 20, 60);
  }, { tile: 4 });

  T.tiles = () => T.make('tiles', 256, 256, (g, w, h, rnd) => {
    g.fillStyle = '#5a2c22';
    g.fillRect(0, 0, w, h);
    const tw = 16, th = 12;
    for (let row = 0; row * th < h; row++) {
      const off = row % 2 ? tw / 2 : 0;
      for (let x = -tw; x < w + tw; x += tw) {
        const v = 0.75 + rnd() * 0.35;
        g.fillStyle = `rgb(${Math.round(128 * v)},${Math.round(62 * v)},${Math.round(46 * v)})`;
        g.fillRect(x + off, row * th, tw - 1, th - 2);
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.fillRect(x + off, row * th + th - 3, tw - 1, 2);
      }
    }
  }, { tile: 2.5 });

  T.slate = () => T.make('slate', 256, 256, (g, w, h, rnd) => {
    g.fillStyle = '#3c4146';
    g.fillRect(0, 0, w, h);
    const tw = 20, th = 12;
    for (let row = 0; row * th < h; row++) {
      const off = row % 2 ? tw / 2 : 0;
      for (let x = -tw; x < w + tw; x += tw) {
        const v = 0.8 + rnd() * 0.35;
        g.fillStyle = `rgb(${Math.round(70 * v)},${Math.round(76 * v)},${Math.round(84 * v)})`;
        g.fillRect(x + off, row * th, tw - 1, th - 2);
      }
    }
  }, { tile: 2.5 });

  // Corrugated sheet in neutral grey, tinted by material colour.
  T.corrugated = () => T.make('corrugated', 64, 256, (g, w, h, rnd) => {
    // near-white, so the material colour sets the tone (a dark texture times a dark green reads as black)
    for (let y = 0; y < h; y++) {
      const v = 0.8 + 0.2 * Math.sin((y / 8) * Math.PI * 2);
      const c = Math.round(250 * v);
      g.fillStyle = `rgb(${c},${c},${c})`;
      g.fillRect(0, y, w, 1);
    }
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(${rnd() < 0.5 ? '90,70,50' : '255,255,255'},${rnd() * 0.12})`;
      g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 6, 1 + rnd() * 3);
    }
  }, { tile: [2, 4] });

  T.timber = () => T.make('timber', 256, 256, (g, w, h, rnd) => {
    const ph = 16;
    for (let y = 0; y < h; y += ph) {
      const v = 0.85 + rnd() * 0.25;
      g.fillStyle = `rgb(${Math.round(78 * v)},${Math.round(62 * v)},${Math.round(44 * v)})`;
      g.fillRect(0, y, w, ph);
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(0, y + ph - 2, w, 2);
      for (let i = 0; i < 40; i++) {
        g.fillStyle = `rgba(30,20,10,${rnd() * 0.25})`;
        g.fillRect(rnd() * w, y + rnd() * ph, 10 + rnd() * 30, 1);
      }
    }
  }, { tile: 3 });

  T.canvasCloth = () => T.make('cloth', 128, 128, (g, w, h, rnd) => {
    speckle(g, w, h, rnd, '#cdc4a2', [[150, 140, 110], [220, 215, 195]], 3000, [1, 2], 0.3);
    blotches(g, w, h, rnd, 5, ['rgba(110,100,70,0.2)'], 10, 40);
  }, { tile: 3 });

  T.felt = () => T.make('felt', 128, 128, (g, w, h, rnd) => {
    speckle(g, w, h, rnd, '#38393a', [[20, 20, 20], [80, 80, 78]], 4000, [1, 2], 0.4);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 2, h);
  }, { tile: 3 });

  T.earth = () => T.make('earth', 128, 128, (g, w, h, rnd) => {
    speckle(g, w, h, rnd, '#5d6b38', [[90, 70, 45], [70, 95, 40], [110, 120, 60]], 5000, [1, 3], 0.5);
  }, { tile: 5 });

  T.sandbag = () => T.make('sandbag', 128, 64, (g, w, h, rnd) => {
    g.fillStyle = '#6e6448';
    g.fillRect(0, 0, w, h);
    for (let row = 0; row < 4; row++) {
      for (let x = (row % 2) * -16; x < w; x += 32) {
        g.fillStyle = `rgb(${170 + rnd() * 20},${155 + rnd() * 20},${115 + rnd() * 15})`;
        g.beginPath();
        g.ellipse(x + 16, row * 16 + 8, 15, 7, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
  }, { tile: [1.6, 0.8] });

  // RAF Temperate Land Scheme: Dark Earth / Dark Green disruptive pattern.
  // Broad, flowing areas of each colour, about half and half, with tight sprayed edges: a smooth
  // tileable field (sines with whole-number periods across the tile) split at zero.
  T.camo = () => T.make('camo', 512, 512, (g, w, h, rnd) => {
    const waves = [];
    for (let i = 0; i < 9; i++) {
      const k = 1 + Math.floor(rnd() * 4), l = Math.floor(rnd() * 5) - 2;
      waves.push([k * (rnd() < 0.5 ? 1 : -1), l, rnd() * Math.PI * 2, 1 / (k + Math.abs(l))]);
    }
    const img = g.createImageData(w, h);
    const green = [75, 86, 52], earth = [110, 91, 62];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let f = 0;
        for (const [k, l, ph, a] of waves) f += a * Math.sin(((k * x) / w + (l * y) / h) * Math.PI * 2 + ph);
        const t = Math.min(1, Math.max(0, f * 9 + 0.5)); // ~3 px soft edge
        const i = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) img.data[i + c] = green[c] + (earth[c] - green[c]) * t;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // weathering
    for (let i = 0; i < 5000; i++) {
      g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,230'},${rnd() * 0.07})`;
      g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 3);
    }
    g.strokeStyle = 'rgba(0,0,0,0.12)'; // panel lines
    g.lineWidth = 1;
    for (let x = 0; x < w; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y < h; y += 96) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  }, { tile: 7 });

  // Luftwaffe RLM 70/71 angular splinter scheme.
  T.luftCamo = () => T.make('luftCamo', 512, 512, (g, w, h, rnd) => {
    g.fillStyle = '#4b5638';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#323b2c';
    for (let i = 0; i < 14; i++) {
      const cx = rnd() * w, cy = rnd() * h, r = 50 + rnd() * 80;
      for (const [dx, dy] of [[0, 0], [w, 0], [-w, 0], [0, h], [0, -h]]) {
        g.beginPath();
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2 + rnd() * 0.8;
          const px = cx + dx + Math.cos(a) * r, py = cy + dy + Math.sin(a) * r * 0.8;
          k ? g.lineTo(px, py) : g.moveTo(px, py);
        }
        g.fill();
      }
    }
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,230'},${rnd() * 0.06})`;
      g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 3);
    }
  }, { tile: 7 });

  T.balkenkreuz = () => T.make('balkenkreuz', 128, 128, (g, w) => {
    const c = w / 2;
    g.fillStyle = '#f2f0e8';
    g.fillRect(c - 50, c - 16, 100, 32);
    g.fillRect(c - 16, c - 50, 32, 100);
    g.fillStyle = '#151515';
    g.fillRect(c - 42, c - 8, 84, 16);
    g.fillRect(c - 8, c - 42, 16, 84);
  });

  T.luftCodes = (code) => T.make('lcodes:' + code, 512, 128, (g, w, h) => {
    const [a, b] = code.split('+');
    const c = w / 2, m = h / 2;
    g.fillStyle = '#f2f0e8';
    g.fillRect(c - 46, m - 15, 92, 30);
    g.fillRect(c - 15, m - 46, 30, 92);
    g.fillStyle = '#151515';
    g.fillRect(c - 38, m - 7, 76, 14);
    g.fillRect(c - 7, m - 38, 14, 76);
    g.font = 'bold 80px "Arial Narrow", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(a, w * 0.2, m + 4);
    g.fillText(b, w * 0.8, m + 4);
  });

  T.crater = () => T.make('crater', 128, 128, (g, w, h, rnd) => {
    const c = w / 2;
    const rim = g.createRadialGradient(c, c, 0, c, c, c);
    rim.addColorStop(0, 'rgba(38,30,22,1)');
    rim.addColorStop(0.45, 'rgba(70,55,38,1)');
    rim.addColorStop(0.62, 'rgba(120,100,72,0.95)');
    rim.addColorStop(0.8, 'rgba(95,80,58,0.5)');
    rim.addColorStop(1, 'rgba(90,75,55,0)');
    g.fillStyle = rim;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) { // thrown clods
      const a = rnd() * Math.PI * 2, d = c * (0.5 + rnd() * 0.5);
      g.fillStyle = `rgba(${60 + rnd() * 40},${50 + rnd() * 30},${35 + rnd() * 20},${0.5 + rnd() * 0.5})`;
      g.fillRect(c + Math.cos(a) * d, c + Math.sin(a) * d, 2 + rnd() * 4, 2 + rnd() * 4);
    }
  });

  T.trainer = () => T.make('trainer', 128, 128, (g, w, h, rnd) => {
    speckle(g, w, h, rnd, '#d6ae38', [[180, 140, 40], [235, 200, 90]], 1500, [1, 3], 0.25);
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    for (let x = 0; x < w; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  }, { tile: 2 });

  function roundelRings(g, cx, cy, r, rings) {
    for (const [frac, col] of rings) {
      g.fillStyle = col;
      g.beginPath(); g.arc(cx, cy, r * frac, 0, Math.PI * 2); g.fill();
    }
  }
  const RAF_BLUE = '#1f3a6b', RAF_RED = '#b02a23', RAF_YELLOW = '#e2b72e', RAF_WHITE = '#ece8dc';

  // Type B roundel (upper wings, 1940)
  T.roundelB = () => T.make('roundelB', 128, 128, (g, w) => {
    roundelRings(g, w / 2, w / 2, w / 2 - 1, [[1, RAF_BLUE], [0.4, RAF_RED]]);
  });

  // Fuselage side: squadron code, Type A1 roundel, aircraft letter.
  T.fuselageCodes = (code) => T.make('codes:' + code, 512, 128, (g, w, h) => {
    const [sq, letter] = code.split('-');
    roundelRings(g, w / 2, h / 2, h / 2 - 2, [[1, RAF_YELLOW], [0.86, RAF_BLUE], [0.6, RAF_WHITE], [0.34, RAF_RED]]);
    g.font = 'bold 84px "Arial Narrow", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#b4b7ae';
    g.fillText(sq, w * 0.2, h / 2 + 4);
    g.fillText(letter, w * 0.8, h / 2 + 4);
  });

  T.finFlash = () => T.make('finflash', 96, 128, (g, w, h) => {
    g.fillStyle = RAF_RED; g.fillRect(0, 0, w / 3, h);
    g.fillStyle = RAF_WHITE; g.fillRect(w / 3, 0, w / 3, h);
    g.fillStyle = RAF_BLUE; g.fillRect((2 * w) / 3, 0, w / 3, h);
  });

  T.ensign = () => T.make('ensign', 256, 128, (g, w, h) => {
    g.fillStyle = '#7ea6c9';
    g.fillRect(0, 0, w, h);
    // simplified union canton
    g.fillStyle = '#1f3a6b'; g.fillRect(0, 0, w / 2, h / 2);
    g.strokeStyle = '#ece8dc'; g.lineWidth = 10;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(w / 2, h / 2); g.moveTo(w / 2, 0); g.lineTo(0, h / 2); g.stroke();
    g.strokeStyle = RAF_RED; g.lineWidth = 4; g.stroke();
    g.fillStyle = '#ece8dc'; g.fillRect(w / 4 - 9, 0, 18, h / 2); g.fillRect(0, h / 4 - 9, w / 2, 18);
    g.fillStyle = RAF_RED; g.fillRect(w / 4 - 5, 0, 10, h / 2); g.fillRect(0, h / 4 - 5, w / 2, 10);
    roundelRings(g, w * 0.75, h * 0.62, h * 0.24, [[1, RAF_BLUE], [0.66, RAF_WHITE], [0.33, RAF_RED]]);
  });

  T.windowPane = () => T.make('window', 64, 64, (g, w, h) => {
    g.fillStyle = '#e4dfd2';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#28323a';
    const p = 6, m = 4;
    const cw = (w - 2 * p - m) / 2, ch = (h - 2 * p - 2 * m) / 3;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) g.fillRect(p + i * (cw + m), p + j * (ch + m), cw, ch);
    g.fillStyle = 'rgba(255,255,255,0.18)'; // reflection
    g.fillRect(p, p, cw * 0.4, h - 2 * p);
    // blackout tape crosses
    g.strokeStyle = 'rgba(220,210,180,0.55)'; g.lineWidth = 1.5;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) {
      const x = p + i * (cw + m), y = p + j * (ch + m);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + cw, y + ch); g.moveTo(x + cw, y); g.lineTo(x, y + ch); g.stroke();
    }
  });

  T.windowGlow = () => T.make('windowGlow', 64, 64, (g, w, h) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff';
    const p = 6, m = 4;
    const cw = (w - 2 * p - m) / 2, ch = (h - 2 * p - 2 * m) / 3;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) g.fillRect(p + i * (cw + m), p + j * (ch + m), cw, ch);
  }, { srgb: false });

  T.runwayNumber = (txt) => T.make('rwy:' + txt, 128, 256, (g, w, h) => {
    g.fillStyle = '#ecebe4';
    g.font = 'bold 120px "Arial Narrow", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.save();
    g.translate(w / 2, h / 2);
    g.scale(1, 1.9);
    g.fillText(txt, 0, 0);
    g.restore();
  });

  T.site = () => T.make('site', 256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,248,220,0.1)';
    g.fillRect(0, 0, w, h);
    g.setLineDash([18, 12]);
    g.strokeStyle = 'rgba(255,248,220,0.9)';
    g.lineWidth = 6;
    g.strokeRect(5, 5, w - 10, h - 10);
    g.setLineDash([]);
    g.lineWidth = 10;
    g.beginPath();
    g.moveTo(w / 2 - 26, h / 2); g.lineTo(w / 2 + 26, h / 2);
    g.moveTo(w / 2, h / 2 - 26); g.lineTo(w / 2, h / 2 + 26);
    g.stroke();
  });

  T.cloud = (n) => T.make('cloud' + n, 256, 128, (g, w, h, rnd) => {
    for (let i = 0; i < 26; i++) {
      const x = w * (0.2 + rnd() * 0.6), y = h * (0.35 + rnd() * 0.35), r = 18 + rnd() * 34;
      const grd = g.createRadialGradient(x, y - r * 0.2, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.85)');
      grd.addColorStop(0.6, 'rgba(240,242,245,0.45)');
      grd.addColorStop(1, 'rgba(230,232,238,0)');
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // flat-ish darker base
    const base = g.createLinearGradient(0, h * 0.4, 0, h);
    base.addColorStop(0, 'rgba(0,0,0,0)');
    base.addColorStop(1, 'rgba(120,128,140,0.25)');
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
  });

  T.smoke = () => T.make('smoke', 64, 64, (g, w) => {
    const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.4)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, w);
  });

  T.glow = () => T.make('glow', 64, 64, (g, w) => {
    const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,240,200,1)');
    grd.addColorStop(0.25, 'rgba(255,210,140,0.5)');
    grd.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, w);
  });

  T.windsock = () => T.make('windsock', 128, 32, (g, w, h) => {
    for (let i = 0; i < 5; i++) {
      g.fillStyle = i % 2 ? '#f1eee4' : '#e0632a';
      g.fillRect((i * w) / 5, 0, w / 5 + 1, h);
    }
  });

  // Type A roundel (underwing, 1940)
  T.roundelA = () => T.make('roundelA', 128, 128, (g, w) => {
    roundelRings(g, w / 2, w / 2, w / 2 - 1, [[1, RAF_BLUE], [0.66, RAF_WHITE], [0.33, RAF_RED]]);
  });

  // Spinning propeller: a faint disc, darker toward the hub, with a ring where the tips run.
  T.propDisc = (tip) => T.make('propdisc:' + (tip || ''), 128, 128, (g, w) => {
    const c = w / 2;
    const grd = g.createRadialGradient(c, c, 0, c, c, c);
    grd.addColorStop(0, 'rgba(20,20,18,0.55)');
    grd.addColorStop(0.3, 'rgba(20,20,18,0.28)');
    grd.addColorStop(0.85, 'rgba(20,20,18,0.16)');
    grd.addColorStop(0.97, 'rgba(20,20,18,0.08)');
    grd.addColorStop(1, 'rgba(20,20,18,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, w);
    if (tip) {
      g.strokeStyle = tip;
      g.globalAlpha = 0.45;
      g.lineWidth = 5;
      g.beginPath(); g.arc(c, c, c - 6, 0, Math.PI * 2); g.stroke();
    }
  });

  // Soot streak left along the fuselage by exhaust stubs (fades toward the tail, +u).
  T.exhaustStain = () => T.make('exhaust', 128, 32, (g, w, h, rnd) => {
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, 'rgba(25,22,18,0.75)');
    grd.addColorStop(0.35, 'rgba(30,27,22,0.4)');
    grd.addColorStop(1, 'rgba(40,36,30,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(0, h * 0.3); g.quadraticCurveTo(w * 0.5, h * 0.05, w, h * 0.35);
    g.lineTo(w, h * 0.65); g.quadraticCurveTo(w * 0.5, h * 0.95, 0, h * 0.7);
    g.fill();
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(20,18,15,${rnd() * 0.12})`;
      g.fillRect(rnd() * w * 0.7, h * 0.25 + rnd() * h * 0.5, 4 + rnd() * 10, 1 + rnd() * 2);
    }
  });

  // Open cockpit seen from above: dark well with a padded leather rim.
  T.cockpitHole = () => T.make('cockpit', 64, 96, (g, w, h) => {
    g.fillStyle = '#5a3b24';
    g.beginPath(); g.ellipse(w / 2, h / 2, w / 2 - 1, h / 2 - 1, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#16150f';
    g.beginPath(); g.ellipse(w / 2, h / 2, w / 2 - 7, h / 2 - 8, 0, 0, Math.PI * 2); g.fill();
  });

  T.deckchair = () => T.make('deckchair', 64, 64, (g, w, h) => {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = ['#2f6b4a', '#e9e2cc', '#b5452f', '#e9e2cc'][i % 4];
      g.fillRect((i * w) / 8, 0, w / 8 + 1, h);
    }
  });

  // Stencilled wooden board for the dispersal hut.
  T.readinessBoard = () => T.make('board', 128, 64, (g, w, h) => {
    g.fillStyle = '#20231c';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#8a7d5a';
    g.lineWidth = 3;
    g.strokeRect(2, 2, w - 4, h - 4);
    g.fillStyle = '#e8e2cc';
    g.font = 'bold 14px "Courier New", monospace';
    g.fillText('READINESS', 10, 20);
    g.fillStyle = 'rgba(232,226,204,0.75)';
    for (let i = 0; i < 4; i++) g.fillRect(10, 30 + i * 7, 40 + ((i * 37) % 60), 3);
  });

  T.blackout = () => T.make('signals', 128, 128, (g, w, h) => {
    g.fillStyle = '#1c1c1b';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#e9e6dc';
    g.lineWidth = 4;
    g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#e9e6dc';
    g.fillRect(w / 2 - 6, 26, 12, 76); // landing T
    g.fillRect(w / 2 - 34, 26, 68, 12);
  });
})(window.AF);
