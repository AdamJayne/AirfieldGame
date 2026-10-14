// Canvas renderer: top-down view of the airfield, aircraft, and day/night cycle.
(function (AF) {
  'use strict';

  const W = 960, H = 600;
  const R = (AF.render = {});

  R.LAYOUT = {
    runway: { x: 50, y: 48, w: 860, h: 66 },
    hangar: { x: 60, y: 318, w: 230, h: 150 },
    officers: { x: 320, y: 330, w: 170, h: 84 },
    enlisted: { x: 520, y: 330, w: 205, h: 92 },
    fuelDepot: { x: 755, y: 330, w: 150, h: 100 },
    mess: { x: 320, y: 455, w: 170, h: 80 },
    tower: { x: 520, y: 452, w: 120, h: 92 },
  };
  const APRON = { x: 60, y: 172, w: 845, h: 110 };
  const TAXI = { x: 455, y: 114, w: 40, h: 58 };
  const RUNWAY_Y = R.LAYOUT.runway.y + R.LAYOUT.runway.h / 2;

  let canvas, ctx, bg, dpr = 1;
  let hits = [];
  const anims = [];
  R.hover = null;
  R.selected = { building: null, plane: null };

  R.init = function (c) {
    canvas = c;
    ctx = c.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  };

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    buildBackground();
  }

  R.toLogical = function (e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height };
  };

  R.hitTest = function (x, y) {
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i];
      if (h.kind === 'plane') {
        if (Math.hypot(x - h.x, y - h.y) < 26) return h;
      } else if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
        return h;
      }
    }
    return null;
  };

  R.dragged = false;
  R.pick = function (e) {
    const p = R.toLogical(e);
    return R.hitTest(p.x, p.y);
  };

  // ---------- helpers ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const c = (v) => AF.clamp(v + amt, 0, 255);
    return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
  }

  function rr(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function circle(g, x, y, r) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }

  // ---------- static background ----------
  function buildBackground() {
    bg = document.createElement('canvas');
    bg.width = W * dpr;
    bg.height = H * dpr;
    const g = bg.getContext('2d');
    g.scale(dpr, dpr);
    const rnd = mulberry32(1940);

    g.fillStyle = '#6c8746';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(55,80,30,0.16)' : 'rgba(160,175,95,0.12)';
      const r = 4 + rnd() * 24;
      g.beginPath();
      g.ellipse(rnd() * W, rnd() * H, r, r * 0.6, rnd() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
    // mowing stripes
    for (let x = 0; x < W; x += 40) {
      g.fillStyle = (x / 40) % 2 ? 'rgba(255,255,220,0.025)' : 'rgba(0,0,0,0.025)';
      g.fillRect(x, 0, 40, H);
    }
    // perimeter track
    g.strokeStyle = 'rgba(185,165,120,0.55)';
    g.lineWidth = 6;
    rr(g, 30, 30, W - 60, H - 52, 30);
    g.stroke();
    // sandy paths linking apron and buildings
    g.fillStyle = 'rgba(190,170,125,0.6)';
    g.fillRect(55, 294, 860, 12);
    g.fillRect(498, 300, 12, 160);
    g.fillRect(300, 300, 12, 230);
    g.fillRect(730, 300, 12, 40);
    // hedgerows and trees around the edge
    for (let i = 0; i < 190; i++) {
      const side = Math.floor(rnd() * 4);
      let x, y;
      if (side === 0) { x = rnd() * W; y = rnd() * 20; }
      else if (side === 1) { x = rnd() * W; y = H - rnd() * 18; }
      else if (side === 2) { x = rnd() * 22; y = rnd() * H; }
      else { x = W - rnd() * 22; y = rnd() * H; }
      const r = 7 + rnd() * 9;
      g.fillStyle = 'rgba(0,0,0,0.25)';
      circle(g, x + 4, y + 4, r);
      g.fillStyle = rnd() < 0.5 ? '#3d5527' : '#486330';
      circle(g, x, y, r);
      g.fillStyle = 'rgba(140,170,80,0.35)';
      circle(g, x - r * 0.3, y - r * 0.3, r * 0.45);
    }
  }

  // ---------- aircraft ----------
  function silhouette(g, t, flatFill) {
    const span = t.span, len = t.length;
    const body = flatFill || t.color;
    const dark = flatFill || shade(t.color, -28);
    const light = flatFill || shade(t.color, 18);
    const noseY = -len * 0.42;

    // tailplane
    g.fillStyle = dark;
    rr(g, -8, len * 0.5, 16, 4.5, 1.8); g.fill();
    // lower / main wing
    g.fillStyle = body;
    if (t.elliptical) {
      g.beginPath(); g.ellipse(0, -1, span / 2, 5.5, 0, 0, Math.PI * 2); g.fill();
    } else {
      rr(g, -span / 2, -5, span, 8, 2.5); g.fill();
    }
    // fuselage
    g.fillStyle = dark;
    g.beginPath(); g.ellipse(0, len * 0.12, 3.4, len * 0.55, 0, 0, Math.PI * 2); g.fill();
    // engine nacelles
    if (t.engines === 2) {
      for (const ex of [-span * 0.22, span * 0.22]) { rr(g, ex - 3, -11, 6, 14, 2.5); g.fill(); }
    }
    // upper wing for biplanes, staggered forward
    if (t.biplane) {
      g.fillStyle = light;
      rr(g, -span / 2 + 1, -10, span - 2, 7, 2.5); g.fill();
    }
    if (flatFill) return;

    // roundels
    const ry = t.biplane ? -6.5 : -1;
    for (const rx of [-span * 0.34, span * 0.34]) {
      g.fillStyle = '#23365e'; circle(g, rx, ry, 3.3);
      g.fillStyle = '#efeadb'; circle(g, rx, ry, 2.2);
      g.fillStyle = '#b3261d'; circle(g, rx, ry, 1.2);
    }
    // canopy
    g.fillStyle = 'rgba(175,205,225,0.9)';
    g.beginPath(); g.ellipse(0, t.biplane ? 2 : 0, 1.7, 3.2, 0, 0, Math.PI * 2); g.fill();
    // propellers
    g.strokeStyle = 'rgba(25,25,25,0.7)';
    g.lineWidth = 1.4;
    const props = t.engines === 2 ? [[-span * 0.22, -12], [span * 0.22, -12]] : [[0, noseY - 1]];
    for (const [px, py] of props) {
      g.beginPath(); g.moveTo(px - 6, py); g.lineTo(px + 6, py); g.stroke();
    }
  }

  function drawPlane(g, x, y, typeId, o = {}) {
    const t = AF.PLANE_TYPES[typeId];
    const sc = o.scale || 1, ang = o.angle || 0, alt = o.alt || 0, alpha = o.alpha ?? 1;
    g.save();
    g.translate(x + 3 + alt * 28, y + 4 + alt * 28);
    g.rotate(ang);
    g.scale(sc * 0.95, sc * 0.95);
    g.globalAlpha = alpha * 0.28;
    silhouette(g, t, '#000');
    g.restore();

    g.save();
    g.translate(x, y);
    g.rotate(ang);
    g.scale(sc, sc);
    g.globalAlpha = alpha;
    silhouette(g, t, null);
    g.restore();
  }

  function drawSmoke(g, x, y, now) {
    for (let i = 0; i < 3; i++) {
      const p = ((now / 1400 + i / 3) % 1);
      g.fillStyle = `rgba(60,60,60,${0.45 * (1 - p)})`;
      circle(g, x + 4 + p * 10, y - 4 - p * 22, 3 + p * 6);
    }
  }

  function wrench(g, x, y) {
    g.fillStyle = 'rgba(30,30,25,0.75)';
    circle(g, x, y, 7);
    g.strokeStyle = '#f0d27a';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(x - 3, y + 3); g.lineTo(x + 3, y - 3); g.stroke();
    g.beginPath(); g.arc(x + 3, y - 3, 2, 0, Math.PI * 2); g.stroke();
  }

  function conditionBar(g, x, y, w, pct) {
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(x - w / 2, y, w, 4);
    g.fillStyle = pct >= 70 ? '#7fc35a' : pct >= 40 ? '#e0b43c' : '#d9503c';
    g.fillRect(x - w / 2, y, (w * pct) / 100, 4);
  }

  // ---------- ground features ----------
  function drawRunway(g, s) {
    const L = R.LAYOUT.runway;
    const lvl = s.buildings.runway.level;
    if (lvl === 1) {
      g.fillStyle = 'rgba(150,175,90,0.55)';
      rr(g, L.x, L.y, L.w, L.h, 6); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.08)';
      for (let x = L.x; x < L.x + L.w; x += 30) g.fillRect(x, L.y, 15, L.h);
      // white boundary markers
      g.fillStyle = '#f2efe2';
      for (let x = L.x + 10; x < L.x + L.w; x += 85) {
        g.fillRect(x, L.y - 3, 12, 4);
        g.fillRect(x, L.y + L.h - 1, 12, 4);
      }
    } else {
      const x0 = lvl === 3 ? L.x - 25 : L.x, w = lvl === 3 ? L.w + 50 : L.w;
      g.fillStyle = '#5f625d';
      g.fillRect(x0, L.y, w, L.h);
      g.fillStyle = 'rgba(0,0,0,0.12)';
      for (let x = x0; x < x0 + w; x += 60) g.fillRect(x, L.y, 1, L.h);
      g.fillStyle = '#e9e6da';
      for (let x = x0 + 70; x < x0 + w - 70; x += 36) g.fillRect(x, RUNWAY_Y - 1.5, 20, 3);
      // threshold piano keys
      for (const tx of [x0 + 8, x0 + w - 30]) {
        for (let i = 0; i < 6; i++) g.fillRect(tx, L.y + 6 + i * 9.5, 22, 5);
      }
      g.save();
      g.font = 'bold 16px "Courier New", monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.translate(x0 + 52, RUNWAY_Y); g.rotate(Math.PI / 2); g.fillText('09', 0, 0);
      g.restore();
      g.save();
      g.font = 'bold 16px "Courier New", monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.translate(x0 + w - 52, RUNWAY_Y); g.rotate(-Math.PI / 2); g.fillText('27', 0, 0);
      g.restore();
    }
    // taxiway and apron
    const surface = lvl >= 2 ? '#7a7a70' : '#9c8f6a';
    g.fillStyle = surface;
    g.fillRect(TAXI.x, TAXI.y, TAXI.w, TAXI.h);
    rr(g, APRON.x, APRON.y, APRON.w, APRON.h, 10); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    g.lineWidth = 2;
    rr(g, APRON.x, APRON.y, APRON.w, APRON.h, 10); g.stroke();
    // parking circles
    g.strokeStyle = 'rgba(255,255,230,0.25)';
    g.lineWidth = 1.5;
    for (let i = 0; i < 8; i++) {
      g.beginPath(); g.arc(slotPos(i).x, slotPos(i).y, 30, 0, Math.PI * 2); g.stroke();
    }
  }

  function slotPos(i) {
    return { x: APRON.x + 52 + i * 106, y: APRON.y + 58 };
  }
  function bayPos(i) {
    const L = R.LAYOUT.hangar;
    return { x: L.x + 42 + i * 73, y: L.y + 72 };
  }

  function drawWindsock(g, now) {
    const x = 930, y = 150;
    g.strokeStyle = '#ddd';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, y + 14); g.lineTo(x, y); g.stroke();
    const a = Math.PI + 0.4 + Math.sin(now / 1700) * 0.25;
    g.save();
    g.translate(x, y);
    g.rotate(a);
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? '#f4f1e6' : '#e5682e';
      g.fillRect(i * 5, -3 + i * 0.4, 5, 6 - i * 0.8);
    }
    g.restore();
  }

  // ---------- buildings ----------
  function drawHangarFloor(g, L) {
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(L.x + 6, L.y + 6, L.w, L.h);
    g.fillStyle = '#6b6c63';
    g.fillRect(L.x, L.y, L.w, L.h);
    g.fillStyle = '#3c3d38';
    g.fillRect(L.x + 8, L.y, L.w - 16, 6); // open doors facing the apron
  }

  function drawHangarRoof(g, L, lvl) {
    const grad = g.createLinearGradient(L.x, 0, L.x + L.w, 0);
    const base = lvl === 3 ? [95, 98, 88] : lvl === 2 ? [110, 112, 100] : [112, 120, 92];
    const c = (k) => `rgba(${base.map((v) => Math.round(v * k)).join(',')},0.28)`;
    grad.addColorStop(0, c(0.7));
    grad.addColorStop(0.5, c(1.25));
    grad.addColorStop(1, c(0.7));
    g.fillStyle = grad;
    g.fillRect(L.x, L.y + 10, L.w, L.h - 10);
    g.strokeStyle = 'rgba(200,200,180,0.12)';
    g.lineWidth = 1;
    for (let y = L.y + 22; y < L.y + L.h; y += 14) {
      g.beginPath(); g.moveTo(L.x, y); g.lineTo(L.x + L.w, y); g.stroke();
    }
    g.strokeStyle = 'rgba(20,20,15,0.6)';
    g.lineWidth = 2;
    g.strokeRect(L.x, L.y, L.w, L.h);
    if (lvl >= 2) { // workshop annex
      g.fillStyle = '#6d5a48';
      g.fillRect(L.x + 20, L.y + L.h, L.w - 40, 12);
    }
  }

  function hipRoof(g, x, y, w, h, color) {
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(x + 5, y + 5, w, h);
    g.fillStyle = color;
    g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 1;
    const inset = Math.min(w, h) / 2;
    g.beginPath();
    g.moveTo(x, y); g.lineTo(x + inset, y + h / 2); g.lineTo(x + w - inset, y + h / 2); g.lineTo(x + w, y);
    g.moveTo(x, y + h); g.lineTo(x + inset, y + h / 2);
    g.moveTo(x + w - inset, y + h / 2); g.lineTo(x + w, y + h);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.07)';
    g.beginPath();
    g.moveTo(x, y); g.lineTo(x + inset, y + h / 2); g.lineTo(x + w - inset, y + h / 2); g.lineTo(x + w, y);
    g.closePath(); g.fill();
  }

  function nissen(g, x, y, w, h) {
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(x + 4, y + 4, w, h);
    const grad = g.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, '#596150'); grad.addColorStop(0.5, '#8b9479'); grad.addColorStop(1, '#4e5545');
    g.fillStyle = grad;
    rr(g, x, y, w, h, 3); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    for (let i = x + 5; i < x + w; i += 5) { g.beginPath(); g.moveTo(i, y); g.lineTo(i, y + h); g.stroke(); }
  }

  function drawOfficers(g, L, lvl) {
    hipRoof(g, L.x, L.y + 14, 100, 52, '#7a3f31');
    if (lvl >= 2) hipRoof(g, L.x + 100, L.y + 4, 70, 40, '#743b2e');
    if (lvl >= 3) hipRoof(g, L.x + 100, L.y + 44, 70, 40, '#6f392c');
    g.fillStyle = '#4b2a22';
    g.fillRect(L.x + 20, L.y + 20, 6, 6);
    g.fillRect(L.x + 72, L.y + 20, 6, 6);
  }

  function drawEnlisted(g, L, lvl) {
    if (lvl === 1) {
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 4; c++) {
          const x = L.x + 26 + c * 48, y = L.y + 22 + r * 46;
          g.fillStyle = 'rgba(0,0,0,0.28)'; circle(g, x + 3, y + 3, 16);
          g.fillStyle = '#cbbf97'; circle(g, x, y, 16);
          g.strokeStyle = 'rgba(90,80,50,0.5)';
          g.lineWidth = 1;
          for (let k = 0; k < 8; k++) {
            const a = (k / 8) * Math.PI * 2;
            g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 16, y + Math.sin(a) * 16); g.stroke();
          }
          g.fillStyle = '#6b5f40'; circle(g, x, y, 2);
        }
      }
    } else if (lvl === 2) {
      for (let i = 0; i < 4; i++) nissen(g, L.x + 4 + i * 51, L.y + 6, 38, 80);
    } else {
      hipRoof(g, L.x, L.y + 4, L.w, 38, '#7d4535');
      hipRoof(g, L.x, L.y + 50, L.w, 38, '#77412f');
    }
  }

  function drawFuel(g, L, lvl) {
    g.fillStyle = 'rgba(120,105,70,0.55)';
    rr(g, L.x, L.y, L.w, L.h, 14); g.fill();
    if (lvl === 1) {
      for (let i = 0; i < 3; i++) { // bowsers
        const x = L.x + 20 + i * 42, y = L.y + 25;
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 3, y + 3, 26, 50);
        g.fillStyle = '#4f5a3c'; rr(g, x, y, 26, 50, 4); g.fill();
        g.fillStyle = '#3a4229'; g.fillRect(x + 3, y + 3, 20, 12);
      }
      return;
    }
    const n = lvl === 2 ? 2 : 4;
    for (let i = 0; i < n; i++) {
      const cx = L.x + (n === 2 ? 45 + i * 60 : 38 + (i % 2) * 74), cy = L.y + (n === 2 ? 50 : 28 + Math.floor(i / 2) * 46);
      const r = n === 2 ? 24 : 19;
      g.fillStyle = 'rgba(0,0,0,0.3)'; circle(g, cx + 4, cy + 4, r);
      g.fillStyle = '#8d8f86'; circle(g, cx, cy, r);
      g.fillStyle = '#a9aba1'; circle(g, cx - 3, cy - 3, r * 0.7);
      g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 1;
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
    }
  }

  function drawMess(g, L, lvl, now, dark) {
    if (lvl === 1) {
      nissen(g, L.x + 10, L.y + 18, 150, 44);
    } else {
      hipRoof(g, L.x, L.y + 8, L.w, 64, '#6e4a36');
    }
    // chimney with smoke
    const cx = L.x + 40, cy = L.y + 26;
    g.fillStyle = '#3b2c22'; g.fillRect(cx, cy, 7, 7);
    if (dark < 0.5) {
      for (let i = 0; i < 3; i++) {
        const p = (now / 2600 + i / 3) % 1;
        g.fillStyle = `rgba(220,220,215,${0.35 * (1 - p)})`;
        circle(g, cx + 4 + p * 18, cy - p * 26, 3 + p * 7);
      }
    }
  }

  function drawTower(g, L, lvl) {
    const x = L.x + 10, y = L.y + 8, w = lvl === 2 ? 70 : 58, h = lvl === 2 ? 64 : 52;
    g.fillStyle = 'rgba(0,0,0,0.32)'; g.fillRect(x + 7, y + 7, w, h);
    g.fillStyle = '#d8d2c0'; g.fillRect(x, y, w, h);
    g.strokeStyle = '#8f8a7a'; g.lineWidth = 2; g.strokeRect(x + 3, y + 3, w - 6, h - 6);
    if (lvl === 2) {
      g.fillStyle = '#7fa3b8'; g.fillRect(x + 18, y + 16, w - 36, h - 32);
      g.strokeStyle = '#3f4c55'; g.strokeRect(x + 18, y + 16, w - 36, h - 32);
    }
    // signals square
    const sx = x + w + 10, sy = y + 20;
    g.fillStyle = '#1f1f1f'; g.fillRect(sx, sy, 26, 26);
    g.fillStyle = '#f1efe6'; g.fillRect(sx + 11, sy + 3, 4, 20); g.fillRect(sx + 3, sy + 11, 20, 4);
  }

  function drawUnbuilt(g, L) {
    g.save();
    g.setLineDash([6, 5]);
    g.strokeStyle = 'rgba(255,250,225,0.45)';
    g.lineWidth = 2;
    rr(g, L.x, L.y, L.w, L.h, 6); g.stroke();
    g.restore();
    g.fillStyle = 'rgba(255,250,225,0.06)';
    rr(g, L.x, L.y, L.w, L.h, 6); g.fill();
    g.fillStyle = 'rgba(255,250,225,0.7)';
    g.font = '22px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('+', L.x + L.w / 2, L.y + L.h / 2);
  }

  function drawConstruction(g, L, b, s) {
    g.save();
    g.strokeStyle = '#e8c547';
    g.lineWidth = 3;
    g.setLineDash([8, 6]);
    g.lineDashOffset = -(s.time % 28);
    rr(g, L.x - 3, L.y - 3, L.w + 6, L.h + 6, 6); g.stroke();
    g.restore();
    const pct = (s.time - b.upgrading.startAt) / (b.upgrading.finishAt - b.upgrading.startAt);
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(L.x + 10, L.y + L.h - 12, L.w - 20, 6);
    g.fillStyle = '#e8c547';
    g.fillRect(L.x + 10, L.y + L.h - 12, (L.w - 20) * AF.clamp(pct, 0, 1), 6);
  }

  function label(g, text, x, y) {
    g.font = '600 11px "IBM Plex Sans", system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(20,24,12,0.85)';
    g.strokeText(text, x, y);
    g.fillStyle = '#f4eed6';
    g.fillText(text, x, y);
  }

  function darkness(t) {
    const h = (t % 1440) / 60;
    if (h >= 7 && h < 19) return 0;
    if (h >= 21 || h < 5) return 0.58;
    if (h < 7) return (0.58 * (7 - h)) / 2;
    return (0.58 * (h - 19)) / 2;
  }

  // ---------- animations ----------
  // Sortie movement is read from aircraft status and game time, so it matches the simulation.
  function sortieAnims(s) {
    const gt = AF.gameTime ?? s.time;
    anims.length = 0;
    for (const p of s.planes) {
      if (p.status !== 'taxiing' && p.status !== 'landing') continue;
      const t = (gt - p.phaseStart) / Math.max(1, p.phaseEnd - p.phaseStart);
      if (t < 0 && p.status === 'taxiing') continue; // still waiting at dispersal
      anims.push({ id: p.id, type: p.type, kind: p.status === 'taxiing' ? 'takeoff' : 'landing', t: AF.clamp(t, 0, 1), hidden: t < 0 });
    }
  }

  function drawAnims(g) {
    for (const a of anims) {
      if (a.hidden) continue;
      const t = a.t;
      if (a.kind === 'takeoff') {
        const x = 80 + (W + 100 - 80) * t * t;
        const lift = t > 0.45 ? (t - 0.45) / 0.55 : 0;
        drawPlane(g, x, RUNWAY_Y - lift * 18, a.type, { angle: Math.PI / 2, scale: 1 + lift * 0.6, alt: lift });
      } else {
        const e = 1 - (1 - t) * (1 - t);
        const x = -60 + (780 + 60) * e;
        const lift = t < 0.45 ? 1 - t / 0.45 : 0;
        const alpha = t > 0.85 ? (1 - t) / 0.15 : 1;
        drawPlane(g, x, RUNWAY_Y - lift * 18, a.type, { angle: Math.PI / 2, scale: 1 + lift * 0.6, alt: lift, alpha });
      }
    }
  }

  // ---------- main draw ----------
  R.draw = function (s, now) {
    AF.fx.length = 0; // raid effects are 3D-only
    sortieAnims(s);
    const g = ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.drawImage(bg, 0, 0, W, H);
    hits = [];
    const dark = darkness(s.time);

    drawRunway(g, s);
    hits.push({ kind: 'building', id: 'runway', ...R.LAYOUT.runway });

    // buildings (hangar roof drawn after the aircraft inside it)
    const B = s.buildings;
    const L = R.LAYOUT;
    drawHangarFloor(g, L.hangar);
    const inBay = s.planes.filter((p) => p.status === 'repair');
    inBay.forEach((p, i) => {
      const pos = bayPos(p.bay ?? i);
      drawPlane(g, pos.x, pos.y, p.type, { scale: 1.15 });
      hits.push({ kind: 'plane', id: p.id, x: pos.x, y: pos.y });
    });
    drawHangarRoof(g, L.hangar, B.hangar.level);
    inBay.forEach((p, i) => {
      const pos = bayPos(p.bay ?? i);
      wrench(g, pos.x + 16, pos.y - 18);
      conditionBar(g, pos.x, pos.y + 22, 34, p.condition);
    });
    hits.push({ kind: 'building', id: 'hangar', ...L.hangar });

    const drawers = {
      officers: () => drawOfficers(g, L.officers, B.officers.level),
      enlisted: () => drawEnlisted(g, L.enlisted, B.enlisted.level),
      fuelDepot: () => drawFuel(g, L.fuelDepot, B.fuelDepot.level),
      mess: () => drawMess(g, L.mess, B.mess.level, now, dark),
      tower: () => drawTower(g, L.tower, B.tower.level),
    };
    for (const [id, fn] of Object.entries(drawers)) {
      if (B[id].level > 0) fn();
      else drawUnbuilt(g, L[id]);
      hits.push({ kind: 'building', id, ...L[id] });
    }
    for (const id of AF.BUILDING_ORDER) if (B[id].upgrading && L[id]) drawConstruction(g, L[id], B[id], s);

    // parked aircraft (hide ones still performing a landing animation)
    const animating = new Set(anims.map((a) => a.id));
    const parked = s.planes.filter((p) => p.status !== 'flying' && p.status !== 'landing' && p.status !== 'repair' && !animating.has(p.id));
    parked.forEach((p, i) => {
      const pos = slotPos(i % 8);
      drawPlane(g, pos.x, pos.y, p.type, { scale: 1.3 });
      if (p.condition < 50) drawSmoke(g, pos.x, pos.y - 6, now);
      if (p.status === 'queued') wrench(g, pos.x + 22, pos.y - 22);
      if (p.status === 'turnaround') { // fuel bowser alongside
        g.fillStyle = '#4f5a3c'; rr(g, pos.x + 30, pos.y - 4, 9, 18, 2); g.fill();
      }
      conditionBar(g, pos.x, pos.y + 28, 34, p.condition);
      hits.push({ kind: 'plane', id: p.id, x: pos.x, y: pos.y });
    });

    drawWindsock(g, now);
    drawAnims(g);

    // night
    if (dark > 0) {
      g.fillStyle = `rgba(10,16,42,${dark})`;
      g.fillRect(0, 0, W, H);
      const glow = dark / 0.58;
      g.fillStyle = `rgba(255,214,120,${0.85 * glow})`;
      const windows = [
        [L.officers.x + 15, L.officers.y + 40], [L.officers.x + 50, L.officers.y + 40], [L.officers.x + 85, L.officers.y + 40],
        [L.hangar.x + 20, L.hangar.y + 4], [L.hangar.x + 200, L.hangar.y + 4],
        [L.tower.x + 25, L.tower.y + 30],
      ];
      if (B.mess.level) windows.push([L.mess.x + 60, L.mess.y + 40], [L.mess.x + 110, L.mess.y + 40]);
      if (B.enlisted.level >= 2) windows.push([L.enlisted.x + 30, L.enlisted.y + 46], [L.enlisted.x + 130, L.enlisted.y + 46]);
      for (const [x, y] of windows) g.fillRect(x, y, 4, 3);
      if (B.runway.level >= 2) {
        const R0 = L.runway;
        g.fillStyle = `rgba(255,236,170,${0.9 * glow})`;
        for (let x = R0.x + 6; x < R0.x + R0.w; x += 40) {
          g.fillRect(x, R0.y - 2, 2, 2);
          g.fillRect(x, R0.y + R0.h, 2, 2);
        }
      }
    }

    // labels
    for (const id of AF.BUILDING_ORDER) {
      if (id === 'runway' || !L[id]) continue; // defences & pens have no 2D drawing
      const b = B[id], LL = L[id], def = AF.BUILDINGS[id];
      const text = b.level ? `${def.name} · Lv ${b.level}` : `${def.name} (unbuilt)`;
      label(g, text, LL.x + LL.w / 2, LL.y + LL.h + (id === 'hangar' && b.level >= 2 ? 15 : 4));
    }
    label(g, `${AF.BUILDINGS.runway.levels[B.runway.level - 1].label}`, 140, 118);

    // hover & selection outlines
    const outline = (h, color) => {
      g.strokeStyle = color;
      g.lineWidth = 2;
      if (h.kind === 'plane') { g.beginPath(); g.arc(h.x, h.y, 28, 0, Math.PI * 2); g.stroke(); }
      else { rr(g, h.x - 4, h.y - 4, h.w + 8, h.h + 8, 6); g.stroke(); }
    };
    const find = (kind, id) => hits.find((h) => h.kind === kind && h.id === id);
    if (R.selected.building) { const h = find('building', R.selected.building); if (h) outline(h, '#f0c24b'); }
    if (R.selected.plane) { const h = find('plane', R.selected.plane); if (h) outline(h, '#f0c24b'); }
    if (R.hover) { const h = find(R.hover.kind, R.hover.id); if (h) outline(h, 'rgba(255,255,255,0.8)'); }
  };
})(window.AF);
