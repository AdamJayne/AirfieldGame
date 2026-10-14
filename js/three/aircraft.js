// 3D aircraft. Each type is built once, as a template, from a spec: a lofted fuselage, aerofoil
// wings and tail, engines and propellers, canopy, landing gear and markings. The template's
// static parts are merged into one mesh per material; moving parts (propellers, retracting gear,
// control surfaces and the pilot) stay separate. Every aircraft is a clone of its type's
// template with its own code letters.
// Convention: metres, +y up, nose toward -z, +x is starboard.
(function (AF) {
  'use strict';
  if (!window.THREE) return;

  const T = AF.tex, M = AF.models, MAT = M.mat, H = M.h;
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const clamp = AF.clamp;
  const DS = THREE.DoubleSide;
  const deg = Math.PI / 180;

  // ---------- paint schemes ----------
  const frameRAF = () => MAT.paint('#3e4532', 0.7);
  const PAINT = {
    // Dark Earth / Dark Green over Sky, with a Sky spinner and tail band (summer 1940)
    raf: { top: () => MAT.camo(), under: () => MAT.sky(), band: () => MAT.sky(), spinner: () => MAT.sky(), frame: frameRAF, tip: '#d9b53b' },
    // bombers: Night (black) undersides
    bomber: { top: () => MAT.camo(), under: () => MAT.paint('#1d1e1b', 0.8, 0.05), spinner: () => MAT.black(), frame: frameRAF, tip: '#d9b53b' },
    trainer: { top: () => MAT.trainer(), under: () => MAT.trainer(), spinner: () => MAT.black(), frame: () => MAT.paint('#2d2a22', 0.6), tip: null },
    // RLM 70/71 splinter over RLM 65 light blue
    luft: { top: () => MAT.luft(), under: () => MAT.paint('#9cb1c3', 0.55, 0.05), spinner: () => MAT.paint('#2b3427', 0.6), frame: () => MAT.paint('#2b3427', 0.65), tip: null },
  };
  const metalDark = () => MAT.metal('#4a4b46');
  const exhaustMat = () => MAT.paint('#4d3a2d', 0.85, 0.35);
  const chrome = () => MAT.metal('#b7bab4');
  const cowlInner = () => H.std('cowlInner', { color: '#1d1e1b', roughness: 0.9, side: DS });

  const decalMats = new Map();
  function decalMat(map) {
    let m = decalMats.get(map.uuid);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ map, transparent: true, roughness: 0.65, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false });
      decalMats.set(map.uuid, m);
    }
    return m;
  }

  // ---------- profiles ----------
  // Smooth curve through rows [[t, a, b, ...]] (monotone cubic, so it never bulges past the rows).
  function curve(rows) {
    const n = rows.length, d = rows[0].length - 1;
    const slope = (i, j) => (rows[i + 1][j + 1] - rows[i][j + 1]) / (rows[i + 1][0] - rows[i][0]);
    const tan = rows.map((r, i) => Array.from({ length: d }, (_, j) => {
      if (i === 0) return slope(0, j);
      if (i === n - 1) return slope(n - 2, j);
      const a = slope(i - 1, j), b = slope(i, j);
      return a * b <= 0 ? 0 : (2 * a * b) / (a + b);
    }));
    return (t) => {
      t = clamp(t, rows[0][0], rows[n - 1][0]);
      let i = 1;
      while (i < n - 1 && t > rows[i][0]) i++;
      const a = rows[i - 1], b = rows[i], h = b[0] - a[0], u = (t - a[0]) / h;
      const u2 = u * u, u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = 3 * u2 - 2 * u3, h11 = u3 - u2;
      const out = new Array(d);
      for (let j = 0; j < d; j++) out[j] = h00 * a[j + 1] + h10 * h * tan[i - 1][j] + h01 * b[j + 1] + h11 * h * tan[i][j];
      return out;
    };
  }

  const se = (v, e) => Math.sign(v) * Math.abs(v) ** e;

  // Geometry from per-group triangle lists.
  function buildGeo(pos, uv, groups) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const index = [];
    groups.forEach((g, gi) => {
      if (!g || !g.length) return;
      geo.addGroup(index.length, g.length, gi);
      for (const i of g) index.push(i);
    });
    geo.setIndex(index);
    geo.computeVertexNormals();
    return geo;
  }

  function weldNormals(geo, pairs) {
    const n = geo.attributes.normal, v = new THREE.Vector3();
    for (const [a, b] of pairs) {
      v.set(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
      n.setXYZ(a, v.x, v.y, v.z);
      n.setXYZ(b, v.x, v.y, v.z);
    }
  }

  // Lofted body along +z. prof(t) -> [halfWidth, top, bottom], t from 0 (front) to 1 (back).
  // Cross-sections are superellipses (n = 2 is an ellipse; higher is boxier). With o.half only
  // the upper half is built, rising from `bottom` (for canopies). o.group(t, angle) picks each
  // face's material index (angle 0 = starboard, π/2 = top).
  function loft(prof, o) {
    const N = o.N || 40, K = o.K || 28, e = 2 / (o.n || 2.2), half = !!o.half;
    const sweep = half ? Math.PI : Math.PI * 2;
    const ts = [];
    for (let i = 0; i <= N; i++) { const k = i / N; ts.push(0.55 * k + 0.45 * (0.5 - 0.5 * Math.cos(k * Math.PI))); }
    const pos = [], uv = [], groups = [];
    const push = (gi, ...ids) => (groups[gi] || (groups[gi] = [])).push(...ids);
    for (const t of ts) {
      const [w, top, bot] = prof(t);
      const z = o.z0 + t * o.len;
      for (let k = 0; k <= K; k++) {
        const a = (k / K) * sweep, c = Math.cos(a), s = Math.sin(a);
        const y = half ? bot + (top - bot) * Math.abs(s) ** e : (s >= 0 ? top : bot) * Math.abs(s) ** e;
        pos.push(w * se(c, e), y, z);
        uv.push(a * (o.uvR || 0.6), z);
      }
    }
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < K; k++) {
        const a = i * (K + 1) + k, b = a + K + 1;
        const gi = o.group ? o.group((ts[i] + ts[i + 1]) / 2, ((k + 0.5) / K) * sweep) : 0;
        push(gi, a, a + 1, b, a + 1, b + 1, b);
      }
    }
    const cap = (i, front, gi) => {
      const [, top, bot] = prof(ts[i]);
      const base = pos.length / 3, z = o.z0 + ts[i] * o.len;
      pos.push(0, (top + bot) / 2, z);
      uv.push(0, z);
      for (let k = 0; k <= K; k++) {
        const j = i * (K + 1) + k;
        pos.push(pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]);
        uv.push(uv[j * 2], uv[j * 2 + 1]);
      }
      for (let k = 0; k < K; k++) front ? push(gi, base, base + 2 + k, base + 1 + k) : push(gi, base, base + 1 + k, base + 2 + k);
    };
    if (!half && o.capFront !== false) cap(0, true, o.frontGroup ?? o.capGroup ?? 0);
    if (!half && o.capBack !== false) cap(N, false, o.capGroup || 0);
    const geo = buildGeo(pos, uv, groups);
    if (!half) weldNormals(geo, ts.map((_, i) => [i * (K + 1), i * (K + 1) + K]));
    return geo;
  }

  // Half-width of a loft's surface at station t and height y.
  function sideX(fz, t, y) {
    const [w, top, bot] = fz.prof(t);
    const h = y >= 0 ? top : -bot;
    const k = clamp(Math.abs(y) / Math.max(h, 0.01), 0, 1);
    return w * Math.max(0, 1 - k ** fz.n) ** (1 / fz.n);
  }
  // Height of a loft's upper surface at station t and offset x.
  function topY(fz, t, x) {
    const [w, top] = fz.prof(t);
    const k = clamp(Math.abs(x) / Math.max(w, 0.01), 0, 1);
    return top * Math.max(0, 1 - k ** fz.n) ** (1 / fz.n);
  }

  // Decal wrapped onto the side of a loft (side +1 starboard, -1 port). Text reads correctly from
  // outside; with aft=true the texture's u runs nose-to-tail on both sides.
  function sideDecalGeo(fz, side, zc, yc, w, h, aft) {
    const g = new THREE.PlaneGeometry(w, h, 12, 4);
    g.rotateY((side * Math.PI) / 2);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const z = zc + p.getZ(i), y = yc + p.getY(i);
      p.setXYZ(i, side * (sideX(fz, (z - fz.z0) / fz.len, y) + 0.012), y, z);
      if (aft && side > 0) uv.setX(i, 1 - uv.getX(i));
    }
    g.computeVertexNormals();
    return g;
  }

  // Decal wrapped onto the top of a loft.
  function topDecalGeo(fz, zc, w, len) {
    const g = new THREE.PlaneGeometry(w, len, 6, 8);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = zc + p.getZ(i);
      p.setXYZ(i, x, topY(fz, (z - fz.z0) / fz.len, x) + 0.012, z);
    }
    g.computeVertexNormals();
    return g;
  }

  // ---------- lifting surfaces ----------
  function naca(u, tc) {
    u = clamp(u, 0, 1);
    return 5 * tc * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u * u * u - 0.1036 * u * u * u * u);
  }
  function camberAt(u, m) {
    const p = 0.4;
    return u < p ? (m / (p * p)) * (2 * p * u - u * u) : (m / ((1 - p) * (1 - p))) * (1 - 2 * p + 2 * p * u - u * u);
  }

  // Planform of one half: span fraction s (0 root, 1 tip) -> chord, leading edge z, thickness.
  // The line at fraction f of the chord is straight (swept back by `sweep` at the tip), so rounded
  // tips close in from both edges. ell = elliptical; pts = chord at span stations [[s, chord]].
  function planform(o) {
    const round = o.round ?? 0.88, f = o.f ?? 0.3, pts = o.pts;
    const base = o.ell ? (s) => o.root * Math.sqrt(Math.max(0, 1 - s * s))
      : pts ? (s) => {
        for (let i = 1; i < pts.length; i++) {
          if (s <= pts[i][0]) return pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * (s - pts[i - 1][0])) / (pts[i][0] - pts[i - 1][0]);
        }
        return pts[pts.length - 1][1];
      }
      : (s) => o.root + ((o.tip ?? o.root) - o.root) * s;
    const chord = (s) => {
      let c = base(s);
      if (!o.ell && s > round) { const k = (s - round) / (1 - round); c *= Math.sqrt(Math.max(0, 1 - k * k)); }
      return Math.max(c, 0.03);
    };
    return {
      half: o.half, chord, camber: o.camber ?? 0.02, root: chord(0), f,
      le: (s) => (o.sweep || 0) * s - f * chord(s),
      tc: (s) => o.tRoot + ((o.tTip ?? o.tRoot) - o.tRoot) * s,
    };
  }

  // Point on a surface: side +1 upper, -1 lower, 0 camber line.
  function surfPt(pf, s, u, side) {
    const c = pf.chord(s);
    return V3(s * pf.half, (camberAt(u, pf.camber) + side * naca(u, pf.tc(s))) * c, pf.le(s) + u * c);
  }

  // Aerofoil surface over span [s0, s1] and chord [c0, c1]. Face groups: 0 upper, 1 lower.
  function liftGeo(pf, o = {}) {
    const s0 = o.s0 ?? 0, s1 = o.s1 ?? 1, c0 = o.c0 ?? 0, c1 = o.c1 ?? 1;
    const NS = Math.max(3, Math.round((o.res || 20) * (s1 - s0))), NC = o.NC || 9;
    const toTip = s1 > 0.999;
    const ss = [], us = [];
    for (let j = 0; j <= NS; j++) { const k = j / NS; ss.push(s0 + (s1 - s0) * (toTip ? Math.sin((k * Math.PI) / 2) : k)); }
    for (let m = 0; m <= NC; m++) us.push(c0 + (c1 - c0) * (0.5 - 0.5 * Math.cos((m / NC) * Math.PI)));
    const L = 2 * (NC + 1);
    const pos = [], uv = [], groups = [[], []];
    const add = (p) => { pos.push(p.x, p.y, p.z); uv.push(p.x, p.z); };
    for (const s of ss) {
      for (let m = 0; m <= NC; m++) add(surfPt(pf, s, us[m], 1));
      for (let m = NC; m >= 0; m--) add(surfPt(pf, s, us[m], -1));
    }
    for (let j = 0; j < NS; j++) {
      for (let q = 0; q < L; q++) {
        const a = j * L + q, a1 = j * L + ((q + 1) % L), b = a + L, b1 = a1 + L;
        groups[q > NC && q < L - 1 ? 1 : 0].push(a, a1, b, a1, b1, b);
      }
    }
    const cap = (j, end) => {
      const base = pos.length / 3;
      let cx = 0, cy = 0, cz = 0;
      for (let q = 0; q < L; q++) { cx += pos[(j * L + q) * 3]; cy += pos[(j * L + q) * 3 + 1]; cz += pos[(j * L + q) * 3 + 2]; }
      pos.push(cx / L, cy / L, cz / L);
      uv.push(cx / L, cz / L);
      for (let q = 0; q < L; q++) {
        const k = (j * L + q) * 3;
        pos.push(pos[k], pos[k + 1], pos[k + 2]);
        uv.push(pos[k], pos[k + 2]);
      }
      for (let q = 0; q < L; q++) {
        const a = base + 1 + q, b = base + 1 + ((q + 1) % L);
        end ? groups[0].push(base, a, b) : groups[0].push(base, b, a);
      }
    };
    cap(NS, true);
    if (s0 > 0 || o.closeRoot) cap(0, false);
    const geo = buildGeo(pos, uv, groups);
    if (c0 === 0) weldNormals(geo, ss.map((_, j) => [j * L, j * L + L - 1]));
    return geo;
  }

  // One half of a wing, tailplane or fin. cut = { s0, s1, c, name } splits off a control
  // surface, hinged along its leading edge.
  function surfaceHalf(pf, mats, cut) {
    const g = new THREE.Group();
    const add = (o) => g.add(H.mesh(liftGeo(pf, o), mats));
    if (!cut) { add({}); return g; }
    if (cut.s0 > 0) add({ s1: cut.s0 });
    add({ s0: cut.s0, s1: cut.s1, c1: cut.c });
    if (cut.s1 < 0.999) add({ s0: cut.s1 });
    const h0 = surfPt(pf, cut.s0, cut.c, 0), h1 = surfPt(pf, cut.s1, cut.c, 0);
    const piv = new THREE.Group();
    piv.name = cut.name;
    piv.userData.dynamic = true;
    piv.userData.axis = h1.clone().sub(h0).normalize().toArray();
    piv.position.copy(h0);
    const geo = liftGeo(pf, { s0: cut.s0 + 0.004, s1: Math.min(1, cut.s1 - 0.004), c0: cut.c + 0.015, NC: 5 });
    geo.translate(-h0.x, -h0.y, -h0.z);
    piv.add(H.mesh(geo, mats));
    g.add(piv);
    return g;
  }

  // Decal wrapped onto a surface (in its half's local space). w spans x, d spans z.
  function surfaceDecal(pf, sc, uc, w, d, map, under, swapUV) {
    const geo = new THREE.PlaneGeometry(w, d, 14, 14);
    geo.rotateX(under ? Math.PI / 2 : -Math.PI / 2);
    const p = geo.attributes.position, uv = geo.attributes.uv;
    const c = surfPt(pf, sc, uc, 0);
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i), pz = p.getZ(i);
      const x = c.x + px, z = c.z + pz;
      const s = clamp(x / pf.half, 0, 1);
      const u = clamp((z - pf.le(s)) / pf.chord(s), 0, 1);
      p.setXYZ(i, x, surfPt(pf, s, u, under ? -1 : 1).y + (under ? -0.016 : 0.016), z);
      uv.setXY(i, swapUV ? pz / d + 0.5 : px / w + 0.5, swapUV ? px / w + 0.5 : pz / d + 0.5);
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, decalMat(map));
    m.receiveShadow = true;
    return m;
  }

  // ---------- small parts ----------
  function tube(points, r, material, seg) {
    const curveP = new THREE.CatmullRomCurve3(points);
    return H.mesh(new THREE.TubeGeometry(curveP, seg || points.length * 3, r, 5, false), material);
  }

  function wheel(r, w, hubMat) {
    const g = new THREE.Group();
    const tyre = H.mesh(new THREE.TorusGeometry(r - w * 0.42, w * 0.45, 8, 22), MAT.rubber());
    tyre.rotation.y = Math.PI / 2;
    g.add(tyre);
    const hub = H.mesh(new THREE.CylinderGeometry(r * 0.58, r * 0.58, w * 0.7, 16), hubMat || MAT.metal('#6e706a'));
    hub.rotation.z = Math.PI / 2;
    g.add(hub);
    const cap = H.mesh(new THREE.CylinderGeometry(r * 0.18, r * 0.24, w * 0.95, 10), MAT.metal('#8d8f88'));
    cap.rotation.z = Math.PI / 2;
    g.add(cap);
    return g;
  }

  function spinnerGeo(r, len) {
    const pts = [];
    for (let i = 0; i <= 14; i++) {
      const k = i / 14;
      pts.push(new THREE.Vector2(Math.max(0.002, r * Math.pow(Math.max(0, 1 - k ** 1.5), 0.85)), k * len));
    }
    const g = new THREE.LatheGeometry(pts, 20);
    g.rotateX(-Math.PI / 2); // point forward (-z)
    return g;
  }

  // Twisted, tapered blade along +y in the x-y plane; leading edge forward (-z). Group 1 is the tip.
  function bladeGeo(R, hubR, cmax, pitch, tipFrom) {
    const NS = 10, NP = 8, pos = [], uv = [], groups = [[], []];
    for (let j = 0; j <= NS; j++) {
      const k = j / NS, r = hubR + (R - hubR) * k;
      let c = cmax * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, k * 1.25)));
      if (k > 0.82) c *= 0.25 + 0.75 * Math.sqrt(Math.max(0, 1 - ((k - 0.82) / 0.18) ** 2));
      const th = c * (0.2 - 0.12 * k);
      const beta = Math.atan2(pitch, 2 * Math.PI * Math.max(r, 0.05));
      const cd = V3(Math.cos(beta), 0, -Math.sin(beta)), td = V3(Math.sin(beta), 0, Math.cos(beta));
      for (let q = 0; q <= NP; q++) {
        const a = (q / NP) * Math.PI * 2;
        const u = (Math.cos(a) * c) / 2, v = (Math.sin(a) * th) / 2;
        pos.push(cd.x * u + td.x * v, r, cd.z * u + td.z * v);
        uv.push(q / NP, k);
      }
    }
    for (let j = 0; j < NS; j++) {
      for (let q = 0; q < NP; q++) {
        const a = j * (NP + 1) + q, b = a + NP + 1;
        groups[(j + 0.5) / NS >= tipFrom ? 1 : 0].push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    // tip cap
    const base = pos.length / 3, last = NS * (NP + 1);
    pos.push(0, R, 0);
    uv.push(0.5, 1);
    for (let q = 0; q < NP; q++) groups[1].push(base, last + q + 1, last + q);
    return buildGeo(pos, uv, groups);
  }

  const discMats = {};
  function discMat(tip) {
    const key = tip || 'none';
    return discMats[key] || (discMats[key] = new THREE.MeshBasicMaterial({ map: T.propDisc(tip), transparent: true, depthWrite: false, side: DS }));
  }

  // Propeller hub (spins about z) with blades, a blur disc for when it turns fast, and a spinner.
  function propeller(p, paint, name) {
    const hub = new THREE.Group();
    hub.name = name;
    hub.userData.dynamic = true;
    const blades = new THREE.Group();
    blades.name = 'blades';
    blades.userData.dynamic = true;
    const tip = p.luft ? null : p.wood ? null : paint.tip;
    const bladeMat = p.wood ? MAT.paint('#5e3d22', 0.55, 0.05) : p.luft ? MAT.paint('#26301f', 0.55, 0.1) : MAT.paint('#191918', 0.5, 0.2);
    const tipMat = tip ? MAT.paint(tip, 0.55, 0.1) : bladeMat;
    const geo = bladeGeo(p.R, (p.spinR || 0.15) * 0.6, p.chord, p.pitch || 2.8, tip ? 0.9 : 2);
    for (let k = 0; k < p.blades; k++) {
      const b = H.mesh(geo, [bladeMat, tipMat]);
      b.rotation.z = (k / p.blades) * Math.PI * 2 + 0.3;
      blades.add(b);
    }
    hub.add(blades);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(p.R, 40), discMat(tip));
    disc.name = 'disc';
    disc.userData.dynamic = true;
    disc.visible = false;
    hub.add(disc);
    if (p.spinR) {
      const sp = H.mesh(spinnerGeo(p.spinR, p.spinLen), p.spinMat || paint.spinner());
      sp.position.z = p.spinBack || 0;
      hub.add(sp);
    } else {
      const boss = H.mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.22, 12), MAT.metal('#5a5b55'));
      boss.rotation.x = Math.PI / 2;
      hub.add(boss);
    }
    return hub;
  }

  // Air-cooled radial: recessed engine face, crankcase, cylinders and the cowling's inner wall.
  function radialEngine(parent, R, z, nCyl, lip, x = 0, y = 0) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const face = H.mesh(new THREE.CircleGeometry(R * 0.98, 28), MAT.paint('#1f201d', 0.85, 0.3), false);
    face.rotation.y = Math.PI;
    face.position.z = 0.42;
    g.add(face);
    const wall = H.mesh(new THREE.CylinderGeometry(R * 0.985, R * 0.985, 0.44, 28, 1, true), cowlInner(), false);
    wall.rotation.x = Math.PI / 2;
    wall.position.z = 0.21;
    g.add(wall);
    const cc = H.mesh(new THREE.SphereGeometry(R * 0.3, 14, 10), metalDark());
    cc.scale.z = 0.7;
    cc.position.z = 0.22;
    g.add(cc);
    const cylMat = MAT.metal('#5d5e57');
    for (let i = 0; i < nCyl; i++) {
      const a = (i / nCyl) * Math.PI * 2;
      const dir = V3(Math.cos(a), Math.sin(a), 0);
      g.add(H.strut(dir.clone().multiplyScalar(R * 0.28).setZ(0.24), dir.clone().multiplyScalar(R * 0.8).setZ(0.24), R * 0.1, cylMat));
      g.add(H.strut(dir.clone().multiplyScalar(R * 0.62).setZ(0.24), dir.clone().multiplyScalar(R * 0.86).setZ(0.24), R * 0.14, metalDark()));
    }
    const ring = H.mesh(new THREE.TorusGeometry(R, 0.05, 8, 36), lip);
    g.add(ring);
    parent.add(g);
  }

  function pilotFigure() {
    const g = new THREE.Group();
    g.name = 'pilot';
    g.userData.dynamic = true;
    const torso = H.mesh(new THREE.SphereGeometry(1, 12, 8), MAT.paint('#c9a43a', 0.85)); // Mae West
    torso.scale.set(0.24, 0.27, 0.17);
    torso.position.y = -0.24;
    const head = H.mesh(new THREE.SphereGeometry(0.105, 12, 10), MAT.skin());
    head.position.y = 0.08;
    const helmet = H.mesh(new THREE.SphereGeometry(0.117, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.58), MAT.paint('#4a3221', 0.75));
    helmet.position.set(0, 0.09, 0.012);
    const goggles = H.box(0.18, 0.045, 0.05, MAT.paint('#2a2a26', 0.4, 0.4), 0, 0.15, -0.08);
    g.add(torso, head, helmet, goggles);
    return g;
  }

  // ---------- merging ----------
  // Merge a node's static meshes into one mesh per material. Children flagged dynamic keep their
  // own transform (they move), but their static contents are merged within them.
  function merge(node) {
    node.updateMatrixWorld(true);
    const inv = node.matrixWorld.clone().invert();
    const buckets = new Map(), victims = [], m4 = new THREE.Matrix4();
    const collect = (c) => {
      m4.multiplyMatrices(inv, c.matrixWorld);
      const g = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
      g.applyMatrix4(m4);
      const flip = m4.determinant() < 0;
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      const groups = Array.isArray(c.material) && g.groups.length ? g.groups : [{ start: 0, count: g.attributes.position.count, materialIndex: 0 }];
      const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
      for (const gr of groups) {
        const mat = mats[gr.materialIndex];
        if (!mat) continue;
        let b = buckets.get(mat);
        if (!b) buckets.set(mat, (b = { p: [], n: [], u: [], cast: false }));
        b.cast = b.cast || c.castShadow;
        const end = Math.min(gr.start + gr.count, P.count);
        for (let i = gr.start; i + 2 < end; i += 3) {
          for (const k of flip ? [i, i + 2, i + 1] : [i, i + 1, i + 2]) {
            b.p.push(P.getX(k), P.getY(k), P.getZ(k));
            b.n.push(N.getX(k), N.getY(k), N.getZ(k));
            if (U) b.u.push(U.getX(k), U.getY(k)); else b.u.push(0, 0);
          }
        }
      }
      g.dispose();
    };
    (function walk(o) {
      for (const c of o.children) {
        if (c.userData.dynamic) { merge(c); continue; }
        if (c.isMesh && !c.isInstancedMesh) { collect(c); victims.push(c); }
        walk(c);
      }
    })(node);
    for (const v of victims) {
      v.parent.remove(v);
      if (!v.geometry.userData.shared) v.geometry.dispose();
    }
    for (const [mat, b] of buckets) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.u, 2));
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = b.cast && !mat.transparent;
      m.receiveShadow = true;
      node.add(m);
    }
  }

  // ---------- generic builder ----------
  // lite: for aircraft only ever seen in the air at a distance (raid formations): the gear is left
  // off and everything but the propellers is merged, so each costs a handful of draw calls.
  function buildTemplate(id, lite) {
    const sp = SPECS[id];
    const paint = PAINT[sp.paint];
    const top = paint.top(), under = paint.under(), glass = MAT.glass(), dark = MAT.black();
    const frame = paint.frame();
    const root = new THREE.Group();
    root.rotation.order = 'YXZ';
    const body = new THREE.Group();
    body.name = 'body';
    root.add(body);
    const L = sp.len, z0 = sp.z0;
    const fz = { prof: curve(sp.prof), n: sp.n || 2.2, z0, len: L };
    const tz = (t) => z0 + t * L;
    const ctx = { sp, paint, body, top, under, glass, dark, frame, fz, tz, wings: [], props: [], codeDecals: [] };

    // fuselage
    const band = paint.band ? paint.band() : top;
    const split = sp.split ?? -0.28;
    body.add(H.mesh(loft(fz.prof, {
      z0, len: L, n: fz.n, N: sp.N || 44, K: 32, capFront: sp.nose !== 'radial',
      group: (t, a) => {
        if (sp.glass && sp.glass(t, a)) return 2;
        if (paint.band && t > 0.835 && t < 0.868) return 3;
        return Math.sin(a) < split ? 1 : 0;
      },
    }), [top, under, glass, band]));

    // engine and propeller
    if (sp.prop) {
      const p = { ...sp.prop };
      let pz = z0;
      if (sp.nose === 'radial') {
        const [w] = fz.prof(0);
        radialEngine(body, w * 0.97, z0, sp.cylinders || 9, top);
        pz = z0 - 0.12;
      } else if (sp.nose === 'inline') {
        pz = z0 + 0.02;
      } else {
        pz = z0 - 0.05;
      }
      const hub = propeller(p, paint, 'prop0');
      hub.position.set(0, sp.thrustY || 0, pz);
      body.add(hub);
      ctx.props.push('prop0');
    }
    if (sp.exhaust) exhausts(ctx, sp.exhaust);

    // canopy
    if (sp.canopy) canopy(ctx, sp.canopy);
    if (sp.cockpits) openCockpits(ctx, sp.cockpits);
    if (sp.pilot) {
      const pl = pilotFigure();
      pl.position.set(sp.pilot[2] || 0, sp.pilot[1], tz(sp.pilot[0]));
      body.add(pl);
    }

    // wings
    for (const [i, w] of sp.wings.entries()) mountWing(ctx, w, i);
    // tail
    tail(ctx, sp.tail);
    // twin engines
    for (const e of sp.engines || []) nacelles(ctx, e);
    // landing gear
    const contact = gear(ctx, sp.gear, sp.tailGear);

    // fuselage codes
    const cd = sp.codes || {};
    const ct = cd.t ?? 0.62;
    const [, ctop, cbot] = fz.prof(ct);
    const chh = cd.h ?? Math.min(0.95, (ctop - cbot) * 0.62);
    for (const side of [1, -1]) {
      const geo = sideDecalGeo(fz, side, tz(ct), cd.y ?? (ctop + cbot) / 2, chh * 3.9, chh, false);
      geo.userData.shared = true;
      ctx.codeDecals.push(geo);
    }

    if (sp.extra) sp.extra(ctx);

    if (lite) {
      const g = body.getObjectByName('gear');
      if (g && sp.gear.retract) g.parent.remove(g);
      root.traverse((o) => { if (o.userData.dynamic && !/^prop\d/.test(o.name) && o.name !== 'blades' && o.name !== 'disc') o.userData.dynamic = false; });
      root.traverse((o) => { delete o.userData.axis; });
    }
    merge(root);
    root.traverse((o) => { if (o.geometry) o.geometry.userData.shared = true; });

    const { ym, zm, yt, zt } = contact;
    const attitude = Math.atan2(yt - ym, zt - zm);
    return {
      obj: root, codeDecals: ctx.codeDecals, props: ctx.props, retract: !!sp.gear.retract && !lite, enemy: sp.paint === 'luft',
      attitude, offset: (p) => -(ym * Math.cos(p) - zm * Math.sin(p)),
      span: sp.wings.reduce((a, w) => Math.max(a, w.pf.half * 2), 0), len: L + (sp.prop ? sp.prop.spinLen || 0.3 : 0),
      smoke: V3(0, fz.prof(0.08)[1] * 0.7, tz(0.08)),
    };
  }

  function exhausts(ctx, ex) {
    const { fz, tz, body } = ctx;
    const mat = exhaustMat();
    for (const side of [1, -1]) {
      for (let i = 0; i < ex.n; i++) {
        const t = ex.t0 + ((ex.t1 - ex.t0) * i) / Math.max(1, ex.n - 1);
        const x = sideX(fz, t, ex.y);
        const big = ex.stub === 'kidney';
        const stub = H.box(big ? 0.13 : 0.1, big ? 0.17 : 0.085, big ? 0.3 : 0.17, mat, 0, -0.04, 0);
        stub.position.set(side * (x + 0.02), ex.y - 0.04, tz(t));
        stub.rotation.set(0, side * 0.15, side * 0.2);
        body.add(stub);
      }
      const z1 = tz(ex.t1) + 0.1, len = 1.8;
      const stain = new THREE.Mesh(sideDecalGeo(fz, side, z1 + len / 2 - 0.3, ex.y - 0.02, len, 0.32, true), decalMat(T.exhaustStain()));
      body.add(stain);
    }
  }

  function canopy(ctx, c) {
    const { fz, tz, body, glass } = ctx;
    const rows = c.rows, t0 = rows[0][0], t1 = rows[rows.length - 1][0];
    const cp = curve(rows);
    const at = (k) => t0 + k * (t1 - t0);
    const prof = (k) => {
      const t = at(k), [w, ttop] = cp(t);
      return [w, ttop, fz.prof(t)[1] - 0.06];
    };
    const geo = loft(prof, { z0: tz(t0), len: (t1 - t0) * fz.len, n: c.n || 2.4, half: true, N: 18, K: 16 });
    const m = H.mesh(geo, glass, false);
    body.add(m);
    // frames: hoops across the canopy and a bar along its spine
    const hoop = (t, scale = 1.012) => {
      const k = (t - t0) / (t1 - t0), [w, ttop, base] = prof(k), e = 2 / (c.n || 2.4), pts = [];
      for (let i = 0; i <= 10; i++) {
        const a = (i / 10) * Math.PI, cc = Math.cos(a), s = Math.sin(a);
        pts.push(V3(w * se(cc, e) * scale, base + (ttop - base) * Math.abs(s) ** e * scale, tz(t)));
      }
      return pts;
    };
    for (const t of c.frames || []) body.add(tube(hoop(t), 0.022, ctx.frame, 20));
    const spine = [];
    for (let i = 0; i <= 10; i++) { const k = 0.05 + (i / 10) * 0.9, [, ttop] = prof(k); spine.push(V3(0, ttop + 0.012, tz(at(k)))); }
    body.add(tube(spine, 0.02, ctx.frame, 20));
    if (c.bars) { // side rails (Bf 109's heavily framed hood)
      for (const sx of [1, -1]) {
        const pts = [];
        for (let i = 0; i <= 8; i++) {
          const k = 0.08 + (i / 8) * 0.84, [w, ttop, base] = prof(k), e = 2 / (c.n || 2.4);
          const a = Math.PI * (sx > 0 ? 0.22 : 0.78), cc = Math.cos(a), s = Math.sin(a);
          pts.push(V3(w * se(cc, e) * 1.012, base + (ttop - base) * Math.abs(s) ** e * 1.012, tz(at(k))));
        }
        body.add(tube(pts, 0.018, ctx.frame, 16));
      }
    }
  }

  function openCockpits(ctx, list) {
    const { fz, tz, body } = ctx;
    for (const c of list) {
      const z = tz(c.t);
      const [w, ttop] = fz.prof(c.t);
      const hole = new THREE.Mesh(topDecalGeo(fz, z, w * 1.25, c.len), decalMat(T.cockpitHole()));
      body.add(hole);
      const ws = H.mesh(new THREE.PlaneGeometry(0.46, 0.26), ctx.glass, false);
      ws.position.set(0, ttop + 0.12, z - c.len / 2 - 0.02);
      ws.rotation.x = -0.45;
      body.add(ws);
      body.add(tube([V3(-0.23, ttop + 0.01, z - c.len / 2 - 0.08), V3(-0.23, ttop + 0.24, z - c.len / 2 + 0.02), V3(0.23, ttop + 0.24, z - c.len / 2 + 0.02), V3(0.23, ttop + 0.01, z - c.len / 2 - 0.08)], 0.012, MAT.metal('#3a3a36'), 12));
    }
  }

  const ROUNDEL = { B: () => T.roundelB(), A: () => T.roundelA(), balken: () => T.balkenkreuz() };

  function mountWing(ctx, w, i) {
    const pf = planform(w.pf);
    const zRef = ctx.tz(w.t) + pf.f * pf.root;
    const mats = w.mats || [ctx.top, ctx.under];
    const halves = [];
    for (const side of [1, -1]) {
      const cut = w.cut && { ...w.cut, name: (w.cut.name || 'ail') + (side > 0 ? 'R' : 'L') + (i ? i : '') };
      const g = surfaceHalf(pf, mats, cut);
      for (const r of w.roundels || []) {
        g.add(surfaceDecal(pf, r.s, r.u ?? 0.38, r.size, r.size, ROUNDEL[r.map](), !!r.under));
      }
      g.position.set(0, w.y, zRef);
      g.scale.x = side;
      g.rotation.z = side * (w.dihedral || 0);
      g.updateMatrix();
      ctx.body.add(g);
      halves.push(g);
    }
    const info = { pf, y: w.y, zRef, halves };
    // point on this wing in body space: side +1 starboard, surf +1 upper / -1 lower / 0 mid
    info.pt = (side, s, u, surf) => surfPt(pf, s, u, surf).applyMatrix4(halves[side > 0 ? 0 : 1].matrix);
    info.sAt = (x) => clamp(Math.abs(x) / pf.half, 0, 1);
    ctx.wings[i] = info;
    // gun ports along the leading edge
    for (const s of w.guns || []) {
      for (const side of [1, -1]) {
        const p = info.pt(side, s, 0.0, 0);
        const gun = H.mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.16, 6), ctx.dark);
        gun.rotation.x = Math.PI / 2;
        gun.position.set(p.x, p.y, p.z - 0.05);
        ctx.body.add(gun);
      }
    }
  }

  function tail(ctx, tl) {
    const { body, tz } = ctx;
    const pf = planform(tl.pf);
    const zRef = tz(tl.t) + pf.f * pf.root;
    for (const side of [1, -1]) {
      const g = surfaceHalf(pf, [ctx.top, ctx.under], { s0: 0.08, s1: 1, c: tl.cut, name: side > 0 ? 'elevR' : 'elevL' });
      g.position.set(0, tl.y, zRef);
      g.scale.x = side;
      body.add(g);
    }
    const fn = tl.fin, fpf = planform(fn.pf);
    const fg = surfaceHalf(fpf, [ctx.top, ctx.top], { s0: fn.cutFrom ?? 0.04, s1: 1, c: fn.cut, name: 'rudder' });
    fg.position.set(0, fn.y, tz(fn.t) + fpf.f * fpf.root);
    fg.rotation.z = Math.PI / 2;
    if (!ctx.sp.noFlash) {
      // fin flash on both sides: red leading
      fg.add(surfaceDecal(fpf, 0.38, fn.cut * 0.5, fpf.half * 0.5, fpf.chord(0.38) * fn.cut * 0.85, T.finFlash(), false, true));
      fg.add(surfaceDecal(fpf, 0.38, fn.cut * 0.5, fpf.half * 0.5, fpf.chord(0.38) * fn.cut * 0.85, T.finFlash(), true, true));
    }
    body.add(fg);
    fg.updateMatrix();
    ctx.finTop = surfPt(fpf, 0.92, 0.3, 0).applyMatrix4(fg.matrix);
  }

  function nacelles(ctx, e) {
    const { body, tz } = ctx;
    const prof = curve(e.prof);
    const nz = { prof, n: 2.2, z0: 0, len: e.len };
    for (const side of [1, -1]) {
      const g = new THREE.Group();
      g.position.set(side * e.x, e.y, tz(e.t));
      g.add(H.mesh(loft(prof, { z0: 0, len: e.len, N: 24, K: 24, capFront: e.nose !== 'radial', group: (t, a) => (Math.sin(a) < -0.25 ? 1 : 0) }), [ctx.top, ctx.under]));
      const p = { ...e.prop };
      let pz = 0;
      if (e.nose === 'radial') {
        radialEngine(g, prof(0)[0] * 0.97, 0, 9, ctx.top);
        pz = -0.1;
      } else {
        const ring = H.mesh(new THREE.TorusGeometry(prof(0)[0] * 0.8, prof(0)[0] * 0.16, 8, 28), MAT.paint('#1d1e1b', 0.8, 0.3));
        ring.position.z = 0.05;
        g.add(ring);
      }
      const name = 'prop' + ctx.props.length;
      const hub = propeller(p, ctx.paint, name);
      hub.position.z = pz;
      g.add(hub);
      ctx.props.push(name);
      body.add(g);
      if (e.exhaust) {
        for (const sx of [1, -1]) {
          const ex = H.box(0.1, 0.1, 0.9, exhaustMat(), sx * sideX(nz, 0.2, -0.1), -0.25, 1.3);
          g.add(ex);
        }
      }
    }
    ctx.nacelle = { prof, x: e.x, y: e.y, z: tz(e.t), len: e.len };
  }

  // Landing gear; returns the ground contact points used for the sitting attitude.
  function gear(ctx, g, tg) {
    const { body, fz, tz } = ctx;
    // tail wheel or skid first: the main wheels are placed to give the type's ground angle
    const ztail = tz(tg.t);
    const fb = fz.prof(tg.t)[2];
    let yt;
    if (tg.skid) {
      const tip = V3(0, fb - 0.32, ztail + 0.12);
      body.add(H.strut(V3(0, fb + 0.05, ztail - 0.35), tip, 0.035, MAT.paint('#3a3326', 0.8)));
      yt = tip.y - 0.03;
    } else {
      const ty = fb - tg.drop;
      body.add(H.strut(V3(0, fb + 0.06, ztail - 0.22), V3(0, ty, ztail), 0.04, MAT.metal('#555')));
      const tw = wheel(tg.r, Math.max(0.07, tg.r * 0.6));
      tw.position.set(0, ty, ztail);
      body.add(tw);
      yt = ty - tg.r;
    }
    const zm = tz(g.t);
    const ym = yt - (ztail - zm) * Math.tan(g.angle * deg);
    const wy = ym + g.r;

    const grp = new THREE.Group();
    grp.name = 'gear';
    if (g.retract) grp.userData.dynamic = true;
    const legMat = g.legMat === 'top' ? ctx.top : g.legMat === 'under' ? ctx.under : MAT.metal('#5d5f59');
    for (const side of [1, -1]) {
      const axle = V3(side * g.track, wy, zm);
      const w = wheel(g.r, g.w, g.hub === 'under' ? ctx.under : null);
      w.position.copy(axle);
      grp.add(w);
      if (g.nacelle) {
        const n = ctx.nacelle;
        const topY = n.y + n.prof(0.32)[2] + 0.1;
        for (const dx of [-0.24, 0.24]) {
          grp.add(H.strut(V3(side * g.track + dx, topY, zm - 0.1), V3(side * g.track + dx, wy, zm), 0.07, MAT.metal('#5d5f59')));
        }
        grp.add(H.box(0.52, 0.08, 0.16, MAT.metal('#5d5f59'), side * g.track, wy - 0.04, zm));
        continue;
      }
      const wing = ctx.wings[g.wing || 0];
      const legTop = g.fromFuselage
        ? V3(side * g.legX, fz.prof(g.t)[2] + 0.12, zm + (g.legDz || 0))
        : V3(side * g.legX, wing.pt(side, wing.sAt(g.legX), 0.25, 0).y, zm + (g.legDz || 0));
      const foot = V3(axle.x - side * g.w * 0.62, wy, zm); // the leg runs down the inboard side of the wheel
      (ctx.legTop ||= {})[side] = legTop;
      (ctx.legFoot ||= {})[side] = foot;
      if (g.trouser) {
        const dir = foot.clone().sub(legTop), len = dir.length();
        const tr = H.mesh(new THREE.CylinderGeometry(0.11, 0.2, len, 12), ctx.top);
        tr.scale.z = 2.4;
        tr.position.copy(legTop).add(foot).multiplyScalar(0.5);
        tr.quaternion.setFromUnitVectors(V3(0, 1, 0), dir.normalize());
        grp.add(tr);
        const spat = H.mesh(new THREE.SphereGeometry(1, 16, 10), ctx.top);
        spat.scale.set(0.2, g.r * 1.12, g.r * 2.3);
        spat.position.copy(axle).add(V3(0, 0.04, 0.05));
        grp.add(spat);
        continue;
      }
      const mid = legTop.clone().lerp(foot, 0.5);
      grp.add(H.strut(legTop, mid, g.legR || 0.065, legMat));
      grp.add(H.strut(mid, foot, (g.legR || 0.065) * 0.62, chrome()));
      grp.add(H.strut(foot, axle, 0.035, MAT.metal('#5d5f59')));
      if (g.vee) { // split-axle V-struts (Tiger Moth)
        grp.add(H.strut(V3(side * 0.2, fz.prof(g.t)[2] + 0.05, zm + 0.45), foot, 0.03, MAT.paint('#5e5a4c', 0.7)));
        grp.add(H.strut(V3(side * 0.12, fz.prof(g.t)[2] + 0.05, zm), foot, 0.025, MAT.paint('#5e5a4c', 0.7)));
      }
      if (g.doors) {
        const dir = foot.clone().sub(legTop), len = dir.length();
        const door = H.mesh(H.boxGeo(0.03, len * 0.9, 0.48), ctx.under);
        door.position.copy(legTop).lerp(foot, 0.48).add(V3(side * 0.09, 0, 0.02));
        door.quaternion.setFromUnitVectors(V3(0, 1, 0), dir.normalize());
        grp.add(door);
      }
    }
    body.add(grp);
    return { ym, zm, yt, zt: ztail + (tg.skid ? 0.12 : 0) };
  }

  // ---------- type specs ----------
  // prof rows: [t, half-width, top, bottom] along the fuselage. Wing/tail t: station of the root
  // leading edge. gear.angle: ground angle sitting on its wheels (degrees).
  const RAF_ROUNDELS = (s, size) => [{ s, size, map: 'B' }, { s, size: size * 0.9, map: 'A', under: true }];
  const LUFT_CROSSES = (s, size) => [{ s, size, map: 'balken' }, { s, size, map: 'balken', under: true }];

  // Radiator bath hung under a surface at (x, y, z), with a dark intake at the front.
  function radiatorBody(ctx, x, y, z, w, d, len, mat) {
    const prof = curve([[0, w * 0.8, 0, -d * 0.7], [0.2, w, 0, -d], [0.75, w, 0, -d], [1, w * 0.7, 0, -d * 0.15]]);
    const m = H.mesh(loft(prof, { z0: 0, len, n: 3.5, N: 12, K: 16, frontGroup: 1 }), [mat, MAT.paint('#1a1a18', 0.9)]);
    m.position.set(x, y, z);
    ctx.body.add(m);
  }

  function mast(ctx, t, h, lean) {
    const { tz, fz, body } = ctx;
    const base = V3(0, fz.prof(t)[1] - 0.02, tz(t));
    const tip = base.clone().add(V3(0, h, lean));
    body.add(H.strut(base, tip, 0.025, ctx.top));
    if (ctx.finTop) {
      const geo = new THREE.BufferGeometry().setFromPoints([tip, ctx.finTop]);
      body.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#2a2a27', transparent: true, opacity: 0.7 })));
    }
  }

  // Biplane struts and rigging between wing 0 (lower) and wing 1 (upper).
  function biplaneRig(ctx, o) {
    const { body, fz, tz } = ctx;
    const lo = ctx.wings[0], up = ctx.wings[1];
    const mat = o.wood ? MAT.paint('#6a5034', 0.7) : MAT.paint('#2b2d27', 0.6, 0.3);
    const wires = [];
    for (const side of [1, -1]) {
      for (const u of [0.18, 0.7]) {
        const a = lo.pt(side, lo.sAt(o.x), u, 1), b = up.pt(side, up.sAt(o.x), u, -1);
        body.add(H.strut(a, b, 0.04, mat));
        if (u < 0.5) { // N bracing between the front and rear struts
          const b2 = up.pt(side, up.sAt(o.x), 0.7, -1);
          if (o.n) body.add(H.strut(a, b2, 0.03, mat));
        }
      }
      // cabane struts from the fuselage sides up to the upper centre section
      for (const u of [0.2, 0.68]) {
        const b = up.pt(side, up.sAt(0.42), u, -1);
        const t = clamp((b.z + 0.15 - fz.z0) / fz.len, 0, 1);
        const y0 = fz.prof(t)[1] * 0.7;
        const a = V3(side * sideX(fz, t, y0) * 0.97, y0, b.z + 0.15);
        body.add(H.strut(a, b, 0.03, mat));
      }
      // flying and landing wires
      const loRoot = lo.pt(side, lo.sAt(0.45), 0.25, 0), upRoot = up.pt(side, up.sAt(0.45), 0.25, 0);
      const loOut = lo.pt(side, lo.sAt(o.x), 0.25, 0), upOut = up.pt(side, up.sAt(o.x), 0.25, 0);
      wires.push(loRoot, upOut, upRoot, loOut);
      const loRoot2 = lo.pt(side, lo.sAt(0.45), 0.6, 0), upOut2 = up.pt(side, up.sAt(o.x), 0.6, 0);
      wires.push(loRoot2, upOut2);
    }
    const geo = new THREE.BufferGeometry().setFromPoints(wires);
    body.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#2a2a26', transparent: true, opacity: 0.75 })));
  }

  const SPECS = {
    tigermoth: {
      len: 7.1, z0: -2.0, n: 3.4, paint: 'trainer', nose: 'gipsy', noFlash: false,
      prof: [[0, 0.25, 0.3, -0.36], [0.1, 0.3, 0.36, -0.4], [0.2, 0.36, 0.42, -0.44], [0.3, 0.4, 0.44, -0.46], [0.46, 0.4, 0.44, -0.46], [0.6, 0.34, 0.42, -0.42], [0.75, 0.24, 0.38, -0.34], [0.9, 0.14, 0.34, -0.22], [1, 0.06, 0.32, -0.08]],
      prop: { R: 0.98, blades: 2, chord: 0.17, pitch: 1.6, wood: true },
      cockpits: [{ t: 0.36, len: 0.72 }, { t: 0.52, len: 0.72 }],
      pilot: [0.535, 0.62],
      wings: [
        { t: 0.29, y: -0.44, dihedral: 0.075, pf: { half: 4.3, root: 1.35, round: 0.86, f: 0.3, sweep: 0.42, tRoot: 0.1 }, cut: { s0: 0.5, s1: 0.93, c: 0.74 } },
        { t: 0.2, y: 1.12, dihedral: 0.06, pf: { half: 4.47, root: 1.35, round: 0.86, f: 0.3, sweep: 0.5, tRoot: 0.1 }, roundels: [{ s: 0.66, size: 0.95, map: 'B' }] },
      ],
      tail: { t: 0.85, y: 0.3, cut: 0.55, pf: { half: 1.5, root: 0.95, tip: 0.72, round: 0.6, f: 0.25, tRoot: 0.08 },
        fin: { t: 0.855, y: 0.3, cut: 0.42, pf: { half: 0.95, root: 0.85, tip: 0.6, round: 0.35, f: 0.2, sweep: 0.25, tRoot: 0.08 } } },
      gear: { t: 0.24, track: 0.85, legX: 0.36, fromFuselage: true, r: 0.33, w: 0.12, angle: 13, vee: true, legR: 0.04 },
      tailGear: { t: 0.95, skid: true },
      codes: { t: 0.66 },
      extra(ctx) {
        biplaneRig(ctx, { x: 2.9, wood: true });
        const up = ctx.wings[1];
        // gravity fuel tank on the upper centre section
        const p = up.pt(1, 0.0, 0.35, 1);
        const tank = H.mesh(new THREE.SphereGeometry(1, 16, 10), ctx.top);
        tank.scale.set(0.38, 0.13, 0.62);
        tank.position.set(0, p.y + 0.06, p.z);
        ctx.body.add(tank);
        // exhaust pipe along the port side
        const ex = H.strut(V3(-0.27, -0.24, ctx.tz(0.04)), V3(-0.3, -0.3, ctx.tz(0.42)), 0.045, exhaustMat());
        ctx.body.add(ex);
      },
    },

    gladiator: {
      len: 8.1, z0: -2.35, n: 3, paint: 'raf', nose: 'radial', cylinders: 9,
      prof: [[0, 0.66, 0.66, -0.66], [0.06, 0.68, 0.68, -0.68], [0.12, 0.62, 0.62, -0.63], [0.2, 0.5, 0.56, -0.6], [0.3, 0.46, 0.56, -0.6], [0.4, 0.44, 0.58, -0.58], [0.5, 0.4, 0.58, -0.54], [0.66, 0.3, 0.48, -0.44], [0.82, 0.2, 0.38, -0.3], [0.94, 0.11, 0.32, -0.18], [1, 0.05, 0.3, -0.06]],
      prop: { R: 1.5, blades: 3, chord: 0.22, pitch: 2.2, spinR: 0.17, spinLen: 0.32 },
      canopy: { rows: [[0.355, 0.1, 0.6], [0.385, 0.28, 0.9], [0.45, 0.28, 0.94], [0.5, 0.2, 0.82], [0.54, 0.04, 0.62]], frames: [0.385, 0.42, 0.455, 0.5], n: 2.6 },
      pilot: [0.44, 0.74],
      wings: [
        { t: 0.25, y: -0.58, dihedral: 0.05, pf: { half: 4.6, root: 1.5, round: 0.9, f: 0.3, tRoot: 0.1 }, cut: { s0: 0.55, s1: 0.93, c: 0.75 } },
        { t: 0.2, y: 1.06, dihedral: 0.035, pf: { half: 4.92, root: 1.6, round: 0.9, f: 0.3, tRoot: 0.1 }, cut: { s0: 0.55, s1: 0.93, c: 0.75 }, roundels: [{ s: 0.66, size: 1.1, map: 'B' }] },
      ],
      tail: { t: 0.86, y: 0.26, cut: 0.58, pf: { half: 1.7, root: 1.1, tip: 0.72, round: 0.6, f: 0.25, tRoot: 0.08 },
        fin: { t: 0.83, y: 0.26, cut: 0.5, pf: { half: 1.25, root: 1.2, tip: 0.55, round: 0.5, f: 0.2, sweep: 0.25, tRoot: 0.08 } } },
      gear: { t: 0.22, track: 0.98, legX: 0.34, fromFuselage: true, r: 0.38, w: 0.15, angle: 12, legMat: 'top', legR: 0.08 },
      tailGear: { t: 0.94, r: 0.12, drop: 0.18 },
      extra(ctx) { biplaneRig(ctx, { x: 3.25, n: true }); },
    },

    lysander: {
      len: 9.1, z0: -2.55, n: 2.4, paint: 'raf', nose: 'radial', cylinders: 9,
      prof: [[0, 0.62, 0.6, -0.66], [0.08, 0.66, 0.64, -0.72], [0.15, 0.6, 0.62, -0.8], [0.22, 0.55, 0.66, -0.86], [0.3, 0.53, 0.7, -0.8], [0.4, 0.5, 0.7, -0.72], [0.5, 0.45, 0.66, -0.6], [0.62, 0.34, 0.52, -0.44], [0.78, 0.22, 0.4, -0.3], [0.92, 0.12, 0.34, -0.18], [1, 0.05, 0.32, -0.06]],
      prop: { R: 1.55, blades: 3, chord: 0.24, pitch: 2.4, spinR: 0.2, spinLen: 0.38 },
      canopy: { rows: [[0.19, 0.2, 0.66], [0.235, 0.47, 1.46], [0.3, 0.53, 1.6], [0.46, 0.51, 1.6], [0.54, 0.4, 1.3], [0.61, 0.12, 0.76]], frames: [0.235, 0.275, 0.32, 0.37, 0.42, 0.47, 0.53], n: 3 },
      pilot: [0.29, 1.18],
      wings: [{ t: 0.215, y: 1.56, dihedral: 0.02, pf: { half: 7.6, pts: [[0, 1.7], [0.3, 2.45], [1, 1.35]], round: 0.9, f: 0.3, tRoot: 0.13, tTip: 0.1 }, cut: { s0: 0.56, s1: 0.93, c: 0.76 }, roundels: RAF_ROUNDELS(0.7, 1.3) }],
      tail: { t: 0.85, y: 0.38, cut: 0.6, pf: { half: 2.3, root: 1.4, tip: 0.9, round: 0.6, f: 0.25, tRoot: 0.09 },
        fin: { t: 0.84, y: 0.3, cut: 0.55, pf: { half: 1.35, root: 1.4, tip: 0.6, round: 0.5, f: 0.2, sweep: 0.3, tRoot: 0.08 } } },
      gear: { t: 0.165, track: 1.35, legX: 0.3, fromFuselage: true, legDz: -0.1, r: 0.42, w: 0.18, angle: 10, trouser: true },
      tailGear: { t: 0.94, r: 0.13, drop: 0.2 },
      extra(ctx) {
        // V struts from part-way down the trousers up to the wing
        const w = ctx.wings[0], { body } = ctx;
        for (const side of [1, -1]) {
          const base = ctx.legTop[side].clone().lerp(ctx.legFoot[side], 0.62);
          for (const u of [0.12, 0.72]) body.add(H.strut(base, w.pt(side, 0.33, u, -1), 0.055, ctx.top));
        }
      },
    },

    hurricane: {
      len: 9.0, z0: -2.95, n: 2.6, paint: 'raf', nose: 'inline',
      prof: [[0, 0.32, 0.33, -0.34], [0.05, 0.4, 0.42, -0.46], [0.12, 0.46, 0.5, -0.56], [0.22, 0.5, 0.56, -0.64], [0.3, 0.52, 0.62, -0.72], [0.38, 0.52, 0.74, -0.76], [0.46, 0.5, 0.84, -0.74], [0.56, 0.44, 0.78, -0.66], [0.7, 0.34, 0.62, -0.52], [0.84, 0.22, 0.48, -0.34], [0.94, 0.12, 0.42, -0.18], [1, 0.05, 0.4, -0.06]],
      prop: { R: 1.65, blades: 3, chord: 0.27, pitch: 3, spinR: 0.32, spinLen: 0.72 },
      exhaust: { n: 3, t0: 0.06, t1: 0.16, y: 0.24, stub: 'kidney' },
      canopy: { rows: [[0.29, 0.12, 0.64], [0.32, 0.3, 0.98], [0.36, 0.34, 1.08], [0.44, 0.33, 1.08], [0.48, 0.2, 0.94], [0.52, 0.04, 0.84]], frames: [0.32, 0.36, 0.4, 0.44], n: 2.6 },
      pilot: [0.395, 0.88],
      wings: [{ t: 0.21, y: -0.5, dihedral: 0.065, pf: { half: 6.1, root: 2.65, tip: 1.25, round: 0.88, f: 0.3, sweep: 0.22, tRoot: 0.19, tTip: 0.12 }, cut: { s0: 0.58, s1: 0.9, c: 0.74 }, roundels: RAF_ROUNDELS(0.63, 1.25), guns: [0.36, 0.38, 0.4, 0.42] }],
      tail: { t: 0.86, y: 0.44, cut: 0.6, pf: { half: 1.95, root: 1.35, tip: 0.75, round: 0.7, f: 0.25, tRoot: 0.1, tTip: 0.07 },
        fin: { t: 0.81, y: 0.38, cut: 0.55, pf: { half: 1.45, root: 1.5, tip: 0.55, round: 0.55, f: 0.2, sweep: 0.4, tRoot: 0.1, tTip: 0.07 } } },
      gear: { retract: true, t: 0.235, track: 1.08, legX: 1.2, r: 0.38, w: 0.18, angle: 11, doors: true },
      tailGear: { t: 0.93, r: 0.12, drop: 0.22 },
      extra(ctx) {
        radiatorBody(ctx, 0, ctx.fz.prof(0.33)[2] + 0.05, ctx.tz(0.29), 0.36, 0.34, 1.5, ctx.under);
        mast(ctx, 0.5, 0.5, 0.12);
      },
    },

    blenheim: {
      len: 12.6, z0: -4.6, n: 2.3, paint: 'bomber', nose: 'glazed', split: -0.2,
      prof: [[0, 0.12, 0.3, -0.12], [0.03, 0.42, 0.52, -0.42], [0.07, 0.56, 0.64, -0.56], [0.12, 0.62, 0.72, -0.62], [0.2, 0.66, 0.76, -0.66], [0.3, 0.66, 0.72, -0.7], [0.42, 0.62, 0.66, -0.66], [0.55, 0.54, 0.62, -0.58], [0.68, 0.42, 0.56, -0.46], [0.82, 0.28, 0.46, -0.32], [0.94, 0.14, 0.36, -0.18], [1, 0.05, 0.34, -0.06]],
      glass: (t, a) => t < 0.075 || (t < 0.16 && Math.sin(a) > -0.3) || (t < 0.23 && Math.sin(a) > 0.6),
      pilot: [0.17, 0.42, -0.2],
      wings: [{ t: 0.3, y: -0.2, dihedral: 0.1, pf: { half: 8.6, root: 3.4, tip: 1.3, round: 0.9, f: 0.3, sweep: 0.5, tRoot: 0.16, tTip: 0.1 }, cut: { s0: 0.6, s1: 0.92, c: 0.76 }, roundels: [{ s: 0.66, size: 1.6, map: 'B' }] }],
      engines: [{ x: 2.95, y: 0, t: 0.215, len: 4.6, nose: 'radial', prof: [[0, 0.56, 0.56, -0.56], [0.06, 0.6, 0.6, -0.6], [0.16, 0.58, 0.56, -0.62], [0.4, 0.5, 0.48, -0.62], [0.7, 0.34, 0.36, -0.48], [1, 0.06, 0.1, -0.12]], prop: { R: 1.6, blades: 3, chord: 0.25, pitch: 2.6, spinR: 0.2, spinLen: 0.36 } }],
      tail: { t: 0.87, y: 0.3, cut: 0.6, pf: { half: 2.8, root: 1.8, tip: 1.1, round: 0.7, f: 0.25, tRoot: 0.1 },
        fin: { t: 0.84, y: 0.3, cut: 0.55, pf: { half: 1.75, root: 1.9, tip: 0.8, round: 0.55, f: 0.2, sweep: 0.45, tRoot: 0.09 } } },
      gear: { retract: true, nacelle: true, t: 0.3, track: 2.95, r: 0.5, w: 0.24, angle: 9 },
      tailGear: { t: 0.94, r: 0.16, drop: 0.3 },
      codes: { t: 0.68 },
      extra(ctx) {
        const { body, tz, fz } = ctx;
        // dorsal turret
        const t = 0.565, y = fz.prof(t)[1];
        const tur = H.mesh(new THREE.SphereGeometry(0.55, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), ctx.glass, false);
        tur.scale.y = 0.75;
        tur.position.set(0, y - 0.04, tz(t));
        body.add(tur);
        const ring = H.mesh(new THREE.TorusGeometry(0.56, 0.05, 6, 24), metalDark());
        ring.rotation.x = Math.PI / 2;
        ring.position.set(0, y - 0.02, tz(t));
        body.add(ring);
        for (const dx of [-0.07, 0.07]) body.add(H.strut(V3(dx, y + 0.12, tz(t) + 0.1), V3(dx, y + 0.25, tz(t) + 1.0), 0.02, ctx.dark));
        glazingFrames(ctx, [0.03, 0.07, 0.11, 0.155], [0.4, 0.9, 1.57, 2.25, 2.75], 0.16);
      },
    },

    spitfire: {
      len: 8.5, z0: -2.75, n: 2.3, paint: 'raf', nose: 'inline',
      prof: [[0, 0.3, 0.3, -0.3], [0.04, 0.36, 0.38, -0.4], [0.12, 0.41, 0.46, -0.5], [0.22, 0.43, 0.5, -0.58], [0.3, 0.43, 0.52, -0.62], [0.38, 0.42, 0.55, -0.62], [0.46, 0.4, 0.57, -0.6], [0.56, 0.35, 0.52, -0.54], [0.7, 0.26, 0.43, -0.44], [0.84, 0.17, 0.36, -0.32], [0.94, 0.1, 0.32, -0.18], [1, 0.04, 0.3, -0.06]],
      prop: { R: 1.6, blades: 3, chord: 0.25, pitch: 3, spinR: 0.3, spinLen: 0.62 },
      exhaust: { n: 6, t0: 0.05, t1: 0.17, y: 0.2, stub: 'ejector' },
      canopy: { rows: [[0.3, 0.1, 0.54], [0.33, 0.29, 0.86], [0.36, 0.32, 0.94], [0.42, 0.31, 0.94], [0.46, 0.22, 0.77], [0.5, 0.05, 0.6]], frames: [0.33, 0.36, 0.425], n: 2.4 },
      pilot: [0.39, 0.7],
      wings: [{ t: 0.2, y: -0.42, dihedral: 0.105, pf: { half: 5.6, root: 2.5, ell: true, f: 0.25, tRoot: 0.13, tTip: 0.07 }, cut: { s0: 0.55, s1: 0.9, c: 0.76 }, roundels: RAF_ROUNDELS(0.62, 1.15), guns: [0.38, 0.45, 0.52, 0.56] }],
      tail: { t: 0.875, y: 0.3, cut: 0.62, pf: { half: 1.6, root: 1.15, ell: true, f: 0.3, tRoot: 0.1, tTip: 0.07 },
        fin: { t: 0.82, y: 0.26, cut: 0.6, pf: { half: 1.35, root: 1.25, tip: 0.4, round: 0.55, f: 0.2, sweep: 0.32, tRoot: 0.1, tTip: 0.08 } } },
      gear: { retract: true, t: 0.225, track: 0.86, legX: 0.6, r: 0.34, w: 0.16, angle: 12.5, doors: true },
      tailGear: { t: 0.935, r: 0.11, drop: 0.2 },
      extra(ctx) {
        // radiator under the starboard wing, oil cooler under the port wing
        const w = ctx.wings[0];
        const pr = w.pt(1, 0.25, 0.32, -1);
        radiatorBody(ctx, pr.x, pr.y + 0.02, pr.z, 0.24, 0.28, 1.2, ctx.under);
        const po = w.pt(-1, 0.24, 0.3, -1);
        const oil = H.mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.7, 12), ctx.under);
        oil.rotation.x = Math.PI / 2;
        oil.position.set(po.x, po.y - 0.08, po.z + 0.35);
        ctx.body.add(oil);
        mast(ctx, 0.5, 0.42, 0.1);
      },
    },

    // enemy aircraft (raid visuals only)
    he111: {
      len: 16.2, z0: -5.6, n: 2.2, paint: 'luft', nose: 'glazed', noFlash: true, split: -0.25,
      prof: [[0, 0.15, 0.3, -0.2], [0.03, 0.6, 0.72, -0.5], [0.07, 0.84, 0.92, -0.7], [0.12, 0.94, 1, -0.82], [0.2, 0.95, 1, -0.9], [0.32, 0.92, 0.98, -0.86], [0.45, 0.85, 0.9, -0.78], [0.6, 0.68, 0.78, -0.62], [0.75, 0.48, 0.62, -0.44], [0.88, 0.28, 0.5, -0.28], [1, 0.06, 0.44, -0.08]],
      glass: (t) => t < 0.115,
      pilot: [0.1, 0.5, 0.25],
      wings: [{ t: 0.3, y: -0.4, dihedral: 0.09, pf: { half: 11.3, root: 4.7, ell: true, f: 0.12, sweep: 0.9, tRoot: 0.16, tTip: 0.08 }, cut: { s0: 0.6, s1: 0.92, c: 0.76 }, roundels: LUFT_CROSSES(0.72, 1.6) }],
      engines: [{ x: 3.4, y: -0.1, t: 0.165, len: 5.4, nose: 'inline', exhaust: true, prof: [[0, 0.62, 0.62, -0.62], [0.08, 0.66, 0.66, -0.68], [0.3, 0.6, 0.6, -0.7], [0.6, 0.46, 0.5, -0.56], [1, 0.08, 0.14, -0.14]], prop: { R: 1.75, blades: 3, chord: 0.26, pitch: 3, spinR: 0.34, spinLen: 0.65, luft: true } }],
      tail: { t: 0.86, y: 0.35, cut: 0.62, pf: { half: 4.0, root: 2.2, ell: true, f: 0.3, tRoot: 0.1 },
        fin: { t: 0.84, y: 0.35, cut: 0.55, pf: { half: 2.3, root: 2.4, tip: 1.0, round: 0.5, f: 0.2, sweep: 0.6, tRoot: 0.09 } } },
      gear: { retract: true, nacelle: true, t: 0.3, track: 3.4, r: 0.6, w: 0.28, angle: 10 },
      tailGear: { t: 0.94, r: 0.18, drop: 0.3 },
      codes: { t: 0.6 },
      extra(ctx) {
        const { body, tz, fz } = ctx;
        // ventral gondola
        const gp = curve([[0, 0.1, 0.1, -0.05], [0.15, 0.38, 0.1, -0.5], [0.7, 0.36, 0.1, -0.45], [1, 0.1, 0.1, -0.05]]);
        const gd = H.mesh(loft(gp, { z0: 0, len: 3.2, N: 14, K: 18, group: (t) => (t < 0.2 ? 2 : 1) }), [ctx.top, ctx.under, ctx.glass]);
        gd.position.set(0, fz.prof(0.24)[2] + 0.12, tz(0.17));
        body.add(gd);
        // dorsal gun position
        const t = 0.5;
        const blister = H.mesh(new THREE.SphereGeometry(0.42, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), ctx.glass, false);
        blister.scale.set(1, 0.6, 1.8);
        blister.position.set(0, fz.prof(t)[1] - 0.03, tz(t));
        body.add(blister);
        glazingFrames(ctx, [0.025, 0.05, 0.08, 0.105], [0.3, 0.8, 1.3, 1.85, 2.35, 2.85, -0.5, -1.2, -1.9, -2.6], 0.11);
      },
    },

    bf109: {
      len: 8.2, z0: -2.6, n: 2.8, paint: 'luft', nose: 'inline', noFlash: true,
      prof: [[0, 0.28, 0.3, -0.3], [0.06, 0.36, 0.4, -0.44], [0.15, 0.4, 0.44, -0.56], [0.26, 0.4, 0.46, -0.6], [0.33, 0.38, 0.48, -0.6], [0.42, 0.36, 0.5, -0.56], [0.52, 0.32, 0.47, -0.5], [0.68, 0.24, 0.4, -0.4], [0.84, 0.15, 0.32, -0.28], [0.95, 0.08, 0.3, -0.15], [1, 0.04, 0.3, -0.06]],
      prop: { R: 1.55, blades: 3, chord: 0.26, pitch: 3, spinR: 0.29, spinLen: 0.6, luft: true },
      exhaust: { n: 6, t0: 0.05, t1: 0.17, y: 0.1, stub: 'ejector' },
      canopy: { rows: [[0.31, 0.14, 0.48], [0.35, 0.27, 0.8], [0.43, 0.27, 0.82], [0.48, 0.24, 0.76], [0.52, 0.08, 0.52]], frames: [0.35, 0.39, 0.43, 0.48], n: 4.5, bars: true },
      pilot: [0.41, 0.6],
      wings: [{ t: 0.22, y: -0.45, dihedral: 0.1, pf: { half: 4.95, root: 2.05, tip: 1.3, round: 0.965, f: 0.25, tRoot: 0.14, tTip: 0.1 }, cut: { s0: 0.55, s1: 0.95, c: 0.76 }, roundels: LUFT_CROSSES(0.72, 0.95) }],
      tail: { t: 0.87, y: 0.32, cut: 0.62, pf: { half: 1.5, root: 1.0, tip: 0.6, round: 0.75, f: 0.25, tRoot: 0.1, tTip: 0.07 },
        fin: { t: 0.84, y: 0.28, cut: 0.55, pf: { half: 1.15, root: 1.15, tip: 0.5, round: 0.5, f: 0.2, sweep: 0.3, tRoot: 0.09 } } },
      gear: { retract: true, t: 0.245, track: 0.99, legX: 0.4, r: 0.33, w: 0.15, angle: 13 },
      tailGear: { t: 0.94, r: 0.11, drop: 0.18 },
      extra(ctx) {
        const w = ctx.wings[0];
        for (const side of [1, -1]) {
          const p = w.pt(side, 0.28, 0.35, -1);
          radiatorBody(ctx, p.x, p.y + 0.02, p.z, 0.26, 0.16, 0.95, ctx.under);
        }
        radiatorBody(ctx, 0, ctx.fz.prof(0.12)[2] + 0.04, ctx.tz(0.08), 0.18, 0.16, 0.6, ctx.under);
        mast(ctx, 0.53, 0.38, 0.08);
      },
    },
  };

  // Glazing bars over a glazed nose: hoops at stations ts, and lines at angles from the tip to tEnd.
  function glazingFrames(ctx, ts, angles, tEnd) {
    const { fz, tz, body, frame } = ctx;
    const e = 2 / fz.n;
    const pt = (t, a) => {
      const [w, top, bot] = fz.prof(t), c = Math.cos(a), s = Math.sin(a);
      return V3(w * se(c, e) * 1.012, (s >= 0 ? top : bot) * Math.abs(s) ** e * 1.012, tz(t));
    };
    for (const t of ts) {
      const pts = [];
      for (let i = 0; i <= 24; i++) pts.push(pt(t, (i / 24) * Math.PI * 2));
      body.add(tube(pts, 0.018, frame, 40));
    }
    for (const a of angles) {
      const pts = [];
      for (let i = 0; i <= 8; i++) pts.push(pt(0.012 + (i / 8) * (tEnd - 0.012), a));
      body.add(tube(pts, 0.018, frame, 16));
    }
  }

  // ---------- public ----------
  const templates = {};

  // A new aircraft of the given type with its code letters. Returns a group (rotation order YXZ)
  // with userData.plane describing its moving parts and how it sits on the ground.
  // opts.lite: a cheaper airborne-only version (no gear, no moving control surfaces or pilot).
  M.plane = function (typeId, code, opts = {}) {
    const key = typeId + (opts.lite ? ':lite' : '');
    const tpl = templates[key] || (templates[key] = buildTemplate(typeId, !!opts.lite));
    const root = tpl.obj.clone(true);
    const body = root.getObjectByName('body');
    const codeMap = tpl.enemy ? T.luftCodes(code) : T.fuselageCodes(code);
    for (const geo of tpl.codeDecals) {
      const d = new THREE.Mesh(geo, decalMat(codeMap));
      d.receiveShadow = true;
      body.add(d);
    }
    const props = tpl.props.map((n) => {
      const hub = root.getObjectByName(n);
      return { hub, blades: hub.getObjectByName('blades'), disc: hub.getObjectByName('disc') };
    });
    const ctl = {};
    root.traverse((o) => {
      if (o.userData.axis) ctl[o.name] = { obj: o, axis: new THREE.Vector3().fromArray(o.userData.axis) };
    });
    const turn = (name, a) => { const c = ctl[name]; if (c) c.obj.quaternion.setFromAxisAngle(c.axis, a); };
    root.userData.plane = {
      props, gear: tpl.retract ? root.getObjectByName('gear') : null, pilot: root.getObjectByName('pilot'),
      attitude: tpl.attitude, offset: tpl.offset, span: tpl.span, len: tpl.len, smoke: tpl.smoke.clone(),
      // deflect the control surfaces (radians): rudder +ve = nose left, elevator +ve = trailing edge up, aileron +ve = roll right
      setControls(rudder, elevator, aileron) {
        turn('rudder', -rudder);
        turn('elevR', -elevator);
        turn('elevL', -elevator);
        for (const k in ctl) {
          if (k.startsWith('ailR')) turn(k, -aileron);
          else if (k.startsWith('ailL')) turn(k, aileron);
        }
      },
    };
    return root;
  };
})(window.AF);
