// 3D model builders: station buildings, vehicles, people, and aircraft.
// Convention: metres, +y up, building fronts face +z (south, toward the apron and runway).
// Aircraft are built nose toward -z.
(function (AF) {
  'use strict';
  if (!window.THREE) return;

  const T = AF.tex;
  const M = (AF.models = {});
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

  // ---------- materials ----------
  const mats = {};
  const std = (key, params) => mats[key] || (mats[key] = new THREE.MeshStandardMaterial(params));
  const DS = THREE.DoubleSide;

  const corrWallTex = () => {
    if (mats._corrWallTex) return mats._corrWallTex;
    const t = T.corrugated().clone();
    t.center.set(0.5, 0.5);
    t.rotation = Math.PI / 2;
    t.repeat.set(1 / 4, 1 / 2);
    t.needsUpdate = true;
    return (mats._corrWallTex = t);
  };

  const MAT = (M.mat = {
    brick: () => std('brick', { map: T.brick(), roughness: 0.92 }),
    render: () => std('render', { map: T.render(), roughness: 0.95 }),
    concrete: () => std('concrete', { map: T.concrete(), roughness: 0.95 }),
    tiles: () => std('tiles', { map: T.tiles(), roughness: 0.85, side: DS }),
    slate: () => std('slate', { map: T.slate(), roughness: 0.7, side: DS }),
    felt: () => std('felt', { map: T.felt(), roughness: 0.95, side: DS }),
    timber: () => std('timber', { map: T.timber(), roughness: 0.9, side: DS }),
    cloth: () => std('cloth', { map: T.canvasCloth(), roughness: 1, side: DS }),
    earth: () => std('earth', { map: T.earth(), roughness: 1, side: DS }),
    sandbag: () => std('sandbag', { map: T.sandbag(), roughness: 1 }),
    corr: (color) => std('corr' + color, { map: T.corrugated(), color, roughness: 0.85, metalness: 0.04, side: DS }),
    corrWall: (color) => std('corrW' + color, { map: corrWallTex(), color, roughness: 0.85, metalness: 0.04, side: DS }),
    paint: (color, rough = 0.75, metal = 0.1) => std(`paint${color}${rough}${metal}`, { color, roughness: rough, metalness: metal }),
    metal: (color = '#8d8f88') => std('metal' + color, { color, roughness: 0.45, metalness: 0.6 }),
    rubber: () => std('rubber', { color: '#1a1a19', roughness: 0.9 }),
    glass: () => std('glass', { color: '#a9bfcc', roughness: 0.08, metalness: 0.7, transparent: true, opacity: 0.55 }),
    darkGlass: () => std('darkGlass', { color: '#2b3a44', roughness: 0.15, metalness: 0.6 }),
    window: () => std('window', {
      map: T.windowPane(), emissive: '#ffc06a', emissiveMap: T.windowGlow(), emissiveIntensity: 0, roughness: 0.5,
    }),
    lamp: () => std('lamp', { color: '#d9d2bd', emissive: '#ffd890', emissiveIntensity: 0, roughness: 0.4 }),
    camo: () => std('camo', { map: T.camo(), roughness: 0.72, metalness: 0.05 }),
    luft: () => std('luft', { map: T.luftCamo(), roughness: 0.65, metalness: 0.08 }),
    burnt: () => std('burnt', { color: '#1d1a17', roughness: 1 }),
    trainer: () => std('trainer', { map: T.trainer(), roughness: 0.55, metalness: 0.05 }),
    sky: () => std('skyPaint', { color: '#b8c4a4', roughness: 0.6 }),
    black: () => std('black', { color: '#1e1e1c', roughness: 0.6, metalness: 0.2 }),
    skin: () => std('skin', { color: '#d4a983', roughness: 0.8 }),
  });

  M.disposeTree = function (obj) {
    obj.traverse((o) => { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); });
  };

  // ---------- geometry helpers (UVs in metres) ----------
  function scaleUV(geo, su, sv) {
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    return geo;
  }

  function boxGeo(w, h, d) {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; // +x -x +y -y +z -z
    for (let f = 0; f < 6; f++) {
      for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]);
      }
    }
    return g;
  }

  function mesh(geo, material, cast = true, receive = true) {
    const m = new THREE.Mesh(geo, material);
    m.castShadow = cast;
    m.receiveShadow = receive;
    return m;
  }

  // Box whose base sits at y.
  function box(w, h, d, material, x = 0, y = 0, z = 0) {
    const m = mesh(boxGeo(w, h, d), material);
    m.position.set(x, y + h / 2, z);
    return m;
  }

  function cyl(rt, rb, h, material, x = 0, y = 0, z = 0, seg = 16) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg);
    scaleUV(g, Math.PI * 2 * Math.max(rt, rb), h);
    const m = mesh(g, material);
    m.position.set(x, y + h / 2, z);
    return m;
  }

  // Polygons -> flat-shaded geometry with planar metre UVs.
  function polyGeo(polys) {
    const pos = [], uvs = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (const poly of polys) {
      a.fromArray(poly[0]); b.fromArray(poly[1]); c.fromArray(poly[2]);
      const n = b.clone().sub(a).cross(c.clone().sub(a));
      const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
      const uvOf = (p) => (ay >= ax && ay >= az ? [p[0], p[2]] : ax >= az ? [p[2], p[1]] : [p[0], p[1]]);
      for (let i = 1; i < poly.length - 1; i++) {
        for (const p of [poly[0], poly[i], poly[i + 1]]) { pos.push(p[0], p[1], p[2]); uvs.push(...uvOf(p)); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.computeVertexNormals();
    return g;
  }

  // Strut between two points.
  function strut(p1, p2, r, material) {
    const dir = p2.clone().sub(p1);
    const len = dir.length();
    const m = mesh(new THREE.CylinderGeometry(r, r, len, 8), material);
    m.position.copy(p1).add(p2).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(V3(0, 1, 0), dir.normalize());
    return m;
  }

  // shared with aircraft.js
  M.h = { mesh, box, boxGeo, cyl, strut, scaleUV, polyGeo, std };

  // ---------- roofs ----------
  // Ridge runs along x. Wall top at y=0.
  function gableRoof(w, d, rise, over, material) {
    const x0 = -w / 2 - over, x1 = w / 2 + over, z0 = -d / 2 - over, z1 = d / 2 + over;
    const ye = (-rise * over) / (d / 2);
    const g = polyGeo([
      [[x1, ye, z0], [x0, ye, z0], [x0, rise, 0], [x1, rise, 0]],
      [[x0, ye, z1], [x1, ye, z1], [x1, rise, 0], [x0, rise, 0]],
    ]);
    return mesh(g, material);
  }

  function gableEnds(w, d, rise, material, y0 = 0) {
    const tri = (x) => [[x, y0, -d / 2], [x, y0, d / 2], [x, y0 + rise, 0]];
    return mesh(polyGeo([tri(-w / 2), tri(w / 2).reverse()]), material);
  }

  function hipRoof(w, d, rise, over, material) {
    const x0 = -w / 2 - over, x1 = w / 2 + over, z0 = -d / 2 - over, z1 = d / 2 + over;
    const inset = d / 2 + over;
    const rx0 = Math.min(0, x0 + inset), rx1 = Math.max(0, x1 - inset);
    const ye = (-rise * over) / (d / 2);
    const g = polyGeo([
      [[x1, ye, z0], [x0, ye, z0], [rx0, rise, 0], [rx1, rise, 0]],
      [[x0, ye, z1], [x1, ye, z1], [rx1, rise, 0], [rx0, rise, 0]],
      [[x0, ye, z0], [x0, ye, z1], [rx0, rise, 0]],
      [[x1, ye, z1], [x1, ye, z0], [rx1, rise, 0]],
    ]);
    return mesh(g, material);
  }

  // ---------- windows & doors ----------
  const winGeo = new THREE.PlaneGeometry(1.1, 1.35);
  winGeo.userData.shared = true;

  function windowAt(group, x, y, z, rotY) {
    const m = mesh(winGeo, MAT.window(), false, true);
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    group.add(m);
  }

  // Windows along a wall of length len. face: '+z' | '-z' | '+x' | '-x'; off = wall offset from centre.
  function windowRow(group, len, y, face, off, spacing = 3.2, skipCentre = false) {
    const n = Math.max(1, Math.floor((len - 1.5) / spacing));
    for (let i = 0; i < n; i++) {
      const t = (i - (n - 1) / 2) * spacing;
      if (skipCentre && Math.abs(t) < 1.6) continue;
      if (face === '+z') windowAt(group, t, y, off + 0.03, 0);
      else if (face === '-z') windowAt(group, -t, y, -off - 0.03, Math.PI);
      else if (face === '+x') windowAt(group, off + 0.03, y, -t, Math.PI / 2);
      else windowAt(group, -off - 0.03, y, t, -Math.PI / 2);
    }
  }

  function door(group, x, y, z, rotY = 0, w = 1.2, h = 2.2, color = '#3d3328') {
    const m = mesh(new THREE.PlaneGeometry(w, h), MAT.paint(color, 0.8), false, true);
    m.position.set(x, y + h / 2, z);
    m.rotation.y = rotY;
    group.add(m);
  }

  // ---------- generic buildings ----------
  // Rectangular masonry building. Ridge along x (w >= d works best for hip roofs).
  function building(o) {
    const g = new THREE.Group();
    const { w, d, h } = o;
    const wall = o.wall || MAT.brick();
    const roofMat = o.roof || MAT.tiles();
    const roofType = o.roofType || 'hip';
    const rise = o.rise ?? Math.min(w, d) * 0.32;
    const storeys = o.storeys || 1;

    g.add(box(w + 0.25, 0.35, d + 0.25, MAT.concrete(), 0, -0.05, 0));
    g.add(box(w, h, d, wall));
    if (roofType === 'hip') {
      const r = hipRoof(w, d, rise, 0.45, roofMat); r.position.y = h; g.add(r);
    } else if (roofType === 'gable') {
      const r = gableRoof(w, d, rise, 0.45, roofMat); r.position.y = h; g.add(r);
      g.add(gableEnds(w, d, rise, wall, h));
    } else {
      g.add(box(w + 0.4, 0.3, d + 0.4, MAT.concrete(), 0, h, 0));
    }
    const sh = h / storeys;
    for (let s = 0; s < storeys; s++) {
      const y = s * sh + sh * 0.55;
      windowRow(g, w, y, '+z', d / 2, o.spacing || 3, s === 0 && o.door !== false);
      windowRow(g, w, y, '-z', d / 2, o.spacing || 3);
      if (d >= 7) { windowRow(g, d, y, '+x', w / 2, 3.2); windowRow(g, d, y, '-x', w / 2, 3.2); }
    }
    if (o.door !== false) door(g, 0, 0.3, d / 2 + 0.03);
    for (let i = 0; i < (o.chimneys || 0); i++) {
      const x = (o.chimneys === 1 ? 0.25 : -0.32 + (0.64 * i) / (o.chimneys - 1)) * w;
      g.add(box(0.9, rise + 1.3, 0.9, MAT.brick(), x, h + rise * 0.3, 0));
    }
    return g;
  }

  // Half-cylinder shell along z (Nissen hut / blister hangar).
  function archShell(r, len, material, sy = 1) {
    const geo = new THREE.CylinderGeometry(r, r, len, 24, 1, true, Math.PI / 2, Math.PI);
    scaleUV(geo, Math.PI * r, len);
    geo.rotateX(Math.PI / 2);
    geo.scale(1, sy, 1);
    return mesh(geo, material);
  }

  function halfDisc(r, material, sy = 1) {
    const geo = new THREE.CircleGeometry(r, 24, 0, Math.PI);
    scaleUV(geo, 2 * r, r);
    geo.scale(1, sy, 1);
    return mesh(geo, material);
  }

  function nissen(r, len, color = '#626b55') {
    const g = new THREE.Group();
    g.add(box(2 * r + 0.3, 0.2, len + 0.3, MAT.concrete(), 0, -0.1, 0));
    g.add(archShell(r, len, MAT.corr(color)));
    const front = halfDisc(r, MAT.timber()); front.position.z = len / 2; g.add(front);
    const back = halfDisc(r, MAT.timber()); back.position.z = -len / 2; back.rotation.y = Math.PI; g.add(back);
    door(g, 0, 0, len / 2 + 0.03, 0, 1.2, 2.1);
    windowAt(g, -r * 0.55, 1.3, len / 2 + 0.03, 0);
    windowAt(g, r * 0.55, 1.3, len / 2 + 0.03, 0);
    // side windows in small dormers
    for (let z = -len / 2 + 2.5; z < len / 2 - 1.5; z += 3.5) {
      for (const sx of [-1, 1]) {
        const dorm = box(0.9, 1.0, 1.3, MAT.corr(color), sx * r * 0.82, 0.7, z);
        g.add(dorm);
        windowAt(g, sx * (r * 0.82 + 0.46), 1.2, z, (sx * Math.PI) / 2);
      }
    }
    g.add(cyl(0.12, 0.12, 1.5, MAT.black(), r * 0.4, r * 0.85, -len / 4)); // stovepipe
    g.userData.smoke = V3(r * 0.4, r * 0.85 + 1.6, -len / 4);
    return g;
  }

  function bellTent() {
    const g = new THREE.Group();
    const wall = mesh(new THREE.CylinderGeometry(2.6, 2.6, 1.0, 20, 1, true), MAT.cloth());
    wall.position.y = 0.5;
    const cone = mesh(new THREE.ConeGeometry(2.7, 2.4, 20, 1, true), MAT.cloth());
    cone.position.y = 1.0 + 1.2;
    g.add(wall, cone);
    g.add(cyl(0.04, 0.04, 0.4, MAT.paint('#4a3c2c'), 0, 3.3, 0));
    const flap = mesh(new THREE.PlaneGeometry(0.9, 1.1), MAT.paint('#3b3423', 1), false, true);
    flap.position.set(0, 0.55, 2.62);
    g.add(flap);
    return g;
  }

  function timberHut(len, wid) {
    const g = new THREE.Group();
    const h = 2.9, rise = 1.7;
    g.add(box(len, 0.45, wid, MAT.brick(), 0, -0.05, 0));
    const body = new THREE.Group();
    body.position.y = 0.4;
    body.add(box(len, h, wid, MAT.timber()));
    const r = gableRoof(len, wid, rise, 0.4, MAT.felt()); r.position.y = h; body.add(r);
    body.add(gableEnds(len, wid, rise, MAT.timber(), h));
    windowRow(body, len, 1.6, '+z', wid / 2, 3);
    windowRow(body, len, 1.6, '-z', wid / 2, 3);
    door(body, len / 2 + 0.03, 0, 0, Math.PI / 2);
    body.add(cyl(0.12, 0.12, 1.6, MAT.black(), len * 0.25, h + 0.6, -wid * 0.2));
    g.add(body);
    return g;
  }

  function fuelTank(r, h) {
    const g = new THREE.Group();
    g.add(cyl(r, r, h, MAT.metal('#8a8c83'), 0, 0, 0, 28));
    const roof = mesh(new THREE.ConeGeometry(r * 1.02, 0.7, 28), MAT.metal('#7c7e76'));
    roof.position.y = h + 0.35;
    g.add(roof);
    g.add(box(0.5, h + 0.6, 0.12, MAT.metal('#555'), 0, 0, r + 0.08));
    const rail = mesh(new THREE.TorusGeometry(r * 0.98, 0.04, 6, 32), MAT.metal('#555'));
    rail.rotation.x = Math.PI / 2;
    rail.position.y = h + 0.9;
    g.add(rail);
    // earth blast bund
    const bund = mesh(new THREE.CylinderGeometry(r + 2.2, r + 3.4, 1.8, 28, 1, true), MAT.earth());
    bund.position.y = 0.9;
    g.add(bund);
    return g;
  }

  function sandbagWall(len, h = 1.2) {
    return box(len, h, 0.8, MAT.sandbag());
  }

  // ---------- vehicles & people ----------
  // Small props are built once per variant and cloned, sharing their geometry.
  const protos = {};
  function cached(key, build) {
    if (!protos[key]) {
      const g = build();
      g.traverse((o) => { if (o.geometry) o.geometry.userData.shared = true; });
      protos[key] = g;
    }
    return protos[key].clone(true);
  }

  function vWheel(r, w, x, y, z, hubCol = '#55583f') {
    const g = new THREE.Group();
    const tyre = mesh(new THREE.TorusGeometry(r - w * 0.4, w * 0.45, 8, 18), MAT.rubber());
    tyre.rotation.y = Math.PI / 2;
    const hub = mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, w * 0.75, 14), MAT.paint(hubCol, 0.7, 0.2));
    hub.rotation.z = Math.PI / 2;
    g.add(tyre, hub);
    g.position.set(x, y, z);
    return g;
  }

  // Wartime lorry (cab toward -z): 'bowser' (fuel), 'tender' (fire/crash), or a canvas-tilt 'lorry'.
  M.truck = function (kind = 'bowser') {
    return cached('truck:' + kind, () => {
      const g = new THREE.Group();
      const col = kind === 'tender' ? '#8e2a22' : '#4b5233';
      const paint = MAT.paint(col, 0.7);
      g.add(box(1.5, 0.3, 6.6, MAT.black(), 0, 0.62, 0.3)); // chassis
      // bonnet with radiator grille, and a cab with side windows
      g.add(box(1.25, 0.95, 1.6, paint, 0, 0.95, -2.75));
      g.add(box(1.1, 0.8, 0.06, MAT.metal('#3a3b36'), 0, 1.0, -3.57));
      for (const sx of [-1, 1]) {
        const lamp = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.12, 12), MAT.lamp());
        lamp.rotation.x = Math.PI / 2;
        lamp.position.set(sx * 0.82, 1.5, -3.45);
        g.add(lamp);
        // curved front wings over the wheels
        const wing = mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.42, 14, 1, true, -Math.PI / 2, Math.PI), std('guard' + col, { color: col, roughness: 0.7, side: DS }));
        wing.rotation.z = Math.PI / 2;
        wing.position.set(sx * 1.0, 0.62, -2.55);
        g.add(wing);
        g.add(box(0.42, 0.06, 1.0, paint, sx * 1.0, 0.95, -1.75)); // running board
      }
      g.add(box(2.1, 1.25, 1.4, paint, 0, 1.0, -1.45)); // cab
      g.add(box(2.15, 0.08, 1.5, paint, 0, 2.25, -1.45));
      const ws = mesh(new THREE.PlaneGeometry(1.8, 0.55), MAT.darkGlass(), false);
      ws.position.set(0, 1.9, -2.16);
      ws.rotation.y = Math.PI;
      g.add(ws);
      for (const sx of [-1, 1]) {
        const sw = mesh(new THREE.PlaneGeometry(0.75, 0.5), MAT.darkGlass(), false);
        sw.position.set(sx * 1.06, 1.85, -1.5);
        sw.rotation.y = (sx * Math.PI) / 2;
        g.add(sw);
      }
      if (kind === 'bowser') {
        const tank = mesh(new THREE.CylinderGeometry(1, 1, 4.2, 22), MAT.paint('#55603a', 0.6));
        tank.scale.x = 1.05;
        tank.scale.z = 0.8;
        tank.rotation.x = Math.PI / 2;
        tank.position.set(0, 1.75, 1.35);
        g.add(tank);
        for (const z of [-0.6, 3.3]) {
          const end = mesh(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), MAT.paint('#55603a', 0.6));
          end.scale.set(1.05, 0.25, 0.8);
          end.rotation.x = z < 0 ? -Math.PI / 2 : Math.PI / 2;
          end.position.set(0, 1.75, z);
          g.add(end);
        }
        g.add(box(0.5, 0.25, 0.5, MAT.paint('#3b4228'), 0, 2.55, 1.0)); // filler dome
        g.add(box(0.5, 0.25, 0.5, MAT.paint('#3b4228'), 0, 2.55, 2.2));
        g.add(box(1.2, 0.5, 0.6, MAT.metal('#5a5b55'), 0, 0.95, 3.75)); // pump and hose reel
        const reel = mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.5, 14), MAT.black());
        reel.rotation.z = Math.PI / 2;
        reel.position.set(0, 1.75, 3.75);
        g.add(reel);
      } else if (kind === 'tender') {
        g.add(box(2.2, 1.6, 4.4, paint, 0, 0.85, 1.45));
        g.add(box(0.12, 0.12, 4.6, MAT.metal('#b9bbb5'), 0.65, 2.55, 1.4)); // ladder rails
        g.add(box(0.12, 0.12, 4.6, MAT.metal('#b9bbb5'), 0.25, 2.55, 1.4));
        for (let i = 0; i < 9; i++) g.add(box(0.5, 0.05, 0.05, MAT.metal('#b9bbb5'), 0.45, 2.6, -0.6 + i * 0.5));
        const reel = mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.6, 14), MAT.paint('#c9b48a', 0.8));
        reel.rotation.z = Math.PI / 2;
        reel.position.set(0, 1.4, 3.75);
        g.add(reel);
        const bell = mesh(new THREE.SphereGeometry(0.14, 10, 8), MAT.metal('#b08a3a'));
        bell.position.set(0.7, 2.3, -2.2);
        g.add(bell);
      } else {
        g.add(box(2.2, 0.5, 4.4, MAT.paint('#4b5233', 0.8), 0, 0.85, 1.45));
        const tilt = mesh(new THREE.CylinderGeometry(1.1, 1.1, 4.4, 16, 1, false, -Math.PI / 2, Math.PI), MAT.cloth());
        tilt.rotation.x = Math.PI / 2;
        tilt.scale.set(1, 1, 0.85);
        tilt.position.set(0, 1.35, 1.45);
        g.add(tilt);
      }
      for (const z of [-2.55, 1.2, 2.45]) {
        for (const x of [-1.0, 1.0]) g.add(vWheel(0.48, 0.3, x, 0.48, z));
      }
      return g;
    });
  };

  // Airman. pose: 'stand' | 'sit' (in a chair) | 'walk'. Uniform colours: RAF blue-grey, overalls…
  M.figure = function (uniform = '#4f5c70', pose = 'stand') {
    return cached(`fig:${uniform}:${pose}`, () => {
      const g = new THREE.Group();
      const cloth = MAT.paint(uniform, 0.9);
      const boot = MAT.paint('#1d1a16', 0.6);
      const capsule = (r, len, mat, x, y, z, rx = 0, rz = 0) => {
        const m = mesh(new THREE.CapsuleGeometry(r, len, 3, 8), mat);
        m.position.set(x, y, z);
        m.rotation.set(rx, 0, rz);
        return m;
      };
      const sit = pose === 'sit', walk = pose === 'walk';
      const hip = sit ? 0.5 : 0.9;
      if (sit) {
        for (const sx of [-1, 1]) {
          g.add(capsule(0.075, 0.34, cloth, sx * 0.1, hip, -0.22, Math.PI / 2));
          g.add(capsule(0.065, 0.32, cloth, sx * 0.1, 0.27, -0.42, 0.15));
          g.add(box(0.11, 0.08, 0.24, boot, sx * 0.1, 0, -0.48));
        }
      } else {
        for (const sx of [-1, 1]) {
          const swing = walk ? sx * 0.35 : 0;
          const leg = capsule(0.075, 0.66, cloth, sx * 0.1, 0.46, 0, swing);
          leg.position.z = -Math.sin(swing) * 0.2;
          g.add(leg);
          g.add(box(0.11, 0.09, 0.26, boot, sx * 0.1, 0, -0.04 - Math.sin(swing) * 0.42));
        }
      }
      const lean = sit ? 0.28 : 0;
      const torso = capsule(0.16, 0.36, cloth, 0, hip + 0.32, lean * 0.5, -lean);
      torso.scale.z = 0.68;
      g.add(torso);
      for (const sx of [-1, 1]) {
        const swing = walk ? -sx * 0.4 : sit ? -0.5 : 0;
        g.add(capsule(0.05, 0.48, cloth, sx * 0.24, hip + 0.3, sit ? 0 : -Math.sin(swing) * 0.15, swing, sx * 0.08));
      }
      const head = mesh(new THREE.SphereGeometry(0.11, 12, 10), MAT.skin());
      head.position.set(0, hip + 0.76, lean * 0.6);
      g.add(head);
      const capTop = mesh(new THREE.CylinderGeometry(0.115, 0.12, 0.08, 12), MAT.paint('#39414e', 0.8));
      capTop.position.set(0, hip + 0.85, lean * 0.6 - 0.01);
      capTop.scale.z = 1.15;
      g.add(capTop);
      g.traverse((o) => { o.castShadow = true; });
      return g;
    });
  };

  // David Brown aircraft tractor, nose toward -z, with a driver.
  M.tractor = function () {
    return cached('tractor', () => {
      const g = new THREE.Group();
      const paint = MAT.paint('#5b6470', 0.7, 0.1);
      g.add(box(0.95, 0.8, 1.9, paint, 0, 0.55, -0.45)); // bonnet
      g.add(box(1.2, 0.35, 1.3, paint, 0, 0.55, 0.95)); // body and seat box
      g.add(box(0.5, 0.12, 0.45, MAT.paint('#2a2a26', 0.8), 0, 1.15, 1.0)); // seat
      g.add(box(0.5, 0.5, 0.1, MAT.paint('#2a2a26', 0.8), 0, 1.15, 1.25));
      g.add(cyl(0.05, 0.05, 0.9, MAT.black(), 0.3, 1.3, -1.0)); // exhaust stack
      const sw = mesh(new THREE.TorusGeometry(0.18, 0.025, 6, 16), MAT.black());
      sw.rotation.x = -1.0;
      sw.position.set(0, 1.45, 0.45);
      g.add(sw);
      for (const sx of [-1, 1]) {
        g.add(vWheel(0.52, 0.32, sx * 0.72, 0.52, 0.95, '#4a4f58'));
        g.add(vWheel(0.34, 0.2, sx * 0.55, 0.34, -1.05, '#4a4f58'));
        const guard = mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.36, 14, 1, true, -Math.PI / 2, Math.PI), std('guard#5b6470', { color: '#5b6470', roughness: 0.7, side: DS }));
        guard.rotation.z = Math.PI / 2;
        guard.position.set(sx * 0.72, 0.55, 0.95);
        g.add(guard);
      }
      g.add(box(0.12, 0.12, 0.9, MAT.metal('#555'), 0, 0.4, 1.95)); // tow hitch
      const d = M.figure('#4f5c70', 'sit');
      d.position.set(0, 0.62, 1.2);
      d.rotation.y = Math.PI;
      g.add(d);
      return g;
    });
  };

  // Trolley accumulator: starter batteries on wheels, plugged into a fighter at readiness.
  M.trolleyAcc = function () {
    return cached('trolleyAcc', () => {
      const g = new THREE.Group();
      g.add(box(0.7, 0.55, 1.2, MAT.paint('#3e4430', 0.8), 0, 0.3, 0));
      g.add(box(0.74, 0.06, 1.24, MAT.paint('#2c3022', 0.8), 0, 0.85, 0));
      for (const sx of [-1, 1]) g.add(vWheel(0.2, 0.1, sx * 0.4, 0.2, 0.35));
      g.add(box(0.06, 0.06, 0.7, MAT.metal('#666'), 0, 0.35, -0.9)); // handle
      return g;
    });
  };

  M.deckchair = function () {
    return cached('deckchair', () => {
      const g = new THREE.Group();
      const wood = MAT.paint('#8a6a45', 0.8);
      const stripe = std('deckchair', { map: T.deckchair(), roughness: 1, side: DS });
      for (const sx of [-1, 1]) {
        g.add(strut(V3(sx * 0.27, 0, -0.45), V3(sx * 0.27, 0.95, 0.35), 0.025, wood));
        g.add(strut(V3(sx * 0.27, 0, 0.3), V3(sx * 0.27, 0.45, -0.15), 0.025, wood));
      }
      // canvas slung from the top rail down to the front, sagging in the middle
      const geo = new THREE.PlaneGeometry(0.52, 1.15, 1, 6);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const k = p.getY(i) / 1.15 + 0.5; // 0 front-bottom .. 1 top
        p.setXYZ(i, p.getX(i), 0.42 + k * 0.5 - Math.sin(k * Math.PI) * 0.16, -0.38 + k * 0.7);
      }
      geo.computeVertexNormals();
      g.add(mesh(geo, stripe, true, true));
      return g;
    });
  };

  // ---------- station buildings ----------
  function withMeta(g, meta) {
    Object.assign(g.userData, meta);
    return g;
  }

  function hangarLamps(g, positions, y) {
    for (const [x, z] of positions) {
      const lamp = mesh(new THREE.SphereGeometry(0.3, 10, 8), MAT.lamp(), false, false);
      lamp.position.set(x, y, z);
      g.add(lamp);
      g.add(cyl(0.02, 0.02, 1.5, MAT.black(), x, y, z));
    }
    g.userData.light = V3(0, y - 0.5, 0);
  }

  function workbenches(g, x0, x1, z) {
    for (let x = x0; x <= x1; x += 4) {
      g.add(box(3, 0.9, 0.8, MAT.paint('#5d4a34', 0.9), x, 0, z));
      g.add(cyl(0.3, 0.3, 0.9, MAT.paint('#3f4a2d', 0.6), x + 1.8, 0, z + 0.6, 12));
    }
  }

  function doorStack(g, x, z, w, h, color) {
    for (let i = 0; i < 3; i++) g.add(box(w, h, 0.18, MAT.corrWall(color), x, 0, z + i * 0.25));
    const sx = Math.sign(x) || 1;
    g.add(box(0.35, h + 0.8, 0.35, MAT.metal('#444'), x + sx * (w / 2), 0, z + 0.25));
    g.add(box(w + 0.3, 0.35, 0.6, MAT.metal('#444'), x, h + 0.5, z + 0.25));
  }

  // Hangar floors sit under a roof, so they take little light from the open sky.
  const hangarFloor = () => std('hangarFloor', { map: T.concrete(), color: '#a19d92', roughness: 0.95, envMapIntensity: 0.3 });

  M.hangar = function (level) {
    const g = new THREE.Group();
    if (level <= 1) {
      const r = 10.5, len = 22, sy = 0.62;
      g.add(box(2 * r - 0.6, 0.06, len, hangarFloor()));
      g.add(archShell(r, len, MAT.corr('#69745c'), sy));
      // a dull lining inside, so the open end doesn't show the sheeting's shiny underside
      const lining = archShell(r - 0.08, len - 0.1, std('hangarLining', { color: '#4a4c42', roughness: 1, side: THREE.BackSide, envMapIntensity: 0.15 }), sy);
      g.add(lining);
      const back = halfDisc(r, MAT.corr('#69745c'), sy); back.position.z = -len / 2; g.add(back);
      for (let z = -len / 2 + 0.2; z <= len / 2; z += 4.4) {
        const rib = mesh(new THREE.TorusGeometry(r + 0.05, 0.1, 6, 24, Math.PI), MAT.metal('#3c3f37'));
        rib.scale.y = sy;
        rib.position.z = z;
        g.add(rib);
      }
      // timber frame round the open end, and canvas curtains drawn back to either side
      const arch = mesh(new THREE.TorusGeometry(r - 0.1, 0.22, 6, 28, Math.PI), MAT.timber());
      arch.scale.y = sy;
      arch.position.z = len / 2 - 0.1;
      g.add(arch);
      for (const sx of [-1, 1]) {
        const cur = new THREE.PlaneGeometry(3.2, 5.6, 6, 1);
        const p = cur.attributes.position;
        for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 3.5) * 0.25); // folds
        cur.computeVertexNormals();
        const c = mesh(cur, MAT.cloth(), true, true);
        c.position.set(sx * (r - 2.0), 2.8, len / 2 - 0.4);
        g.add(c);
      }
      workbenches(g, -6, 6, -len / 2 + 1);
      hangarLamps(g, [[0, -3], [0, 4]], 5.2);
      return withMeta(g, { bays: [V3(0, 0, 1.5)], footprint: { w: 24, d: 24 }, labelY: 9 });
    }
    if (level === 2) {
      const w = 36, d = 34, h = 7.5, rise = 2.6, col = '#6e7660';
      g.add(box(w, 0.06, d, hangarFloor()));
      g.add(box(w, h, 0.3, MAT.corrWall(col), 0, 0, -d / 2 + 0.15));
      g.add(box(0.3, h, d, MAT.corrWall(col), -w / 2 + 0.15, 0, 0));
      g.add(box(0.3, h, d, MAT.corrWall(col), w / 2 - 0.15, 0, 0));
      g.add(box(w, 1.4, 0.4, MAT.corrWall(col), 0, h - 1.4, d / 2 - 0.2));
      const roof = gableRoof(d, w, rise, 0.5, MAT.corr('#5e6552'));
      roof.rotation.y = Math.PI / 2;
      roof.position.y = h;
      g.add(roof);
      const ends = gableEnds(d, w, rise, MAT.corrWall(col), h);
      ends.rotation.y = Math.PI / 2;
      g.add(ends);
      for (let z = -d / 2 + 3; z < d / 2; z += 5.5) g.add(box(w - 0.6, 0.25, 0.25, MAT.metal('#3c3f37'), 0, h - 0.3, z));
      doorStack(g, -w / 2 - 4.6, d / 2 - 0.1, 9, 6.1, col);
      doorStack(g, w / 2 + 4.6, d / 2 - 0.1, 9, 6.1, col);
      workbenches(g, -14, 14, -d / 2 + 1);
      hangarLamps(g, [[-9, -4], [9, -4], [-9, 8], [9, 8]], 6.5);
      return withMeta(g, { bays: [V3(-9, 0, 4), V3(9, 0, 4)], footprint: { w: 56, d: 36 }, labelY: 12 });
    }
    const w = 48, d = 52, h = 9.5, rise = 4.6, col = '#697059';
    g.add(box(w, 0.06, d, hangarFloor()));
    g.add(box(1.0, h, d, MAT.brick(), -w / 2 + 0.5, 0, 0));
    g.add(box(1.0, h, d, MAT.brick(), w / 2 - 0.5, 0, 0));
    g.add(box(w, h, 0.8, MAT.brick(), 0, 0, -d / 2 + 0.4));
    g.add(box(w, 2.0, 1.2, MAT.concrete(), 0, h - 2.0, d / 2 - 0.6));
    for (const sx of [-1, 1]) g.add(box(2.2, h, 1.4, MAT.brick(), sx * (w / 2 - 1.1), 0, d / 2 - 0.7));
    const roof = gableRoof(d, w, rise, 0.7, MAT.corr('#5a6050'));
    roof.rotation.y = Math.PI / 2;
    roof.position.y = h;
    g.add(roof);
    const ends = gableEnds(d, w, rise, MAT.corrWall(col), h);
    ends.rotation.y = Math.PI / 2;
    g.add(ends);
    for (let z = -d / 2 + 3; z < d / 2; z += 6) g.add(box(w - 1, 0.3, 0.3, MAT.metal('#3c3f37'), 0, h - 0.3, z));
    for (const sx of [-1, 1]) {
      const annex = building({ w: d * 0.75, d: 6, h: 4.4, roofType: 'gable', roof: MAT.slate(), rise: 1.6, spacing: 3.4, door: false });
      annex.rotation.y = Math.PI / 2;
      annex.position.set(sx * (w / 2 + 3), 0, -d * 0.08);
      g.add(annex);
    }
    doorStack(g, -w / 2 - 6.4, d / 2 - 0.1, 12, 7.4, col);
    doorStack(g, w / 2 + 6.4, d / 2 - 0.1, 12, 7.4, col);
    workbenches(g, -18, 18, -d / 2 + 1.5);
    hangarLamps(g, [[-12, -12], [12, -12], [-12, 8], [12, 8], [0, -2]], 8.5);
    return withMeta(g, { bays: [V3(-12, 0, 9), V3(12, 0, 9), V3(0, 0, -13)], footprint: { w: 76, d: 54 }, labelY: 17 });
  };

  M.officers = function (level) {
    const g = new THREE.Group();
    if (level <= 1) {
      const a = timberHut(26, 7); a.position.z = -7; g.add(a);
      const b = timberHut(26, 7); b.position.z = 7; g.add(b);
      return withMeta(g, { footprint: { w: 30, d: 24 }, labelY: 8 });
    }
    const main = building({ w: level === 3 ? 34 : 30, d: 10, h: 6.4, storeys: 2, roof: MAT.tiles(), rise: 3, chimneys: 2 });
    main.position.z = -7;
    g.add(main);
    if (level === 2) {
      const hut = timberHut(24, 7); hut.position.z = 9; g.add(hut);
    } else {
      const wing = building({ w: 18, d: 9, h: 6.4, storeys: 2, roof: MAT.tiles(), rise: 2.8, chimneys: 1, door: false });
      wing.rotation.y = Math.PI / 2;
      wing.position.set(21.5, 0, 3);
      g.add(wing);
      // porch
      g.add(box(5, 0.3, 2.6, MAT.render(), 0, 3.1, -0.7));
      for (const x of [-2.2, 2.2]) g.add(cyl(0.18, 0.18, 3.1, MAT.render(), x, 0, 0.3));
      // hedged lawn
      for (const x of [-14, 6]) g.add(box(12, 1.0, 1.0, MAT.paint('#33461f', 1), x, 0, 9));
    }
    return withMeta(g, { footprint: { w: level === 3 ? 50 : 36, d: 30 }, labelY: 12 });
  };

  M.enlisted = function (level) {
    const g = new THREE.Group();
    if (level <= 1) {
      const rnd = T.rng(7);
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 4; c++) {
          const t = bellTent();
          t.position.set(-15 + c * 10, 0, -10 + r * 10);
          t.rotation.y = rnd() * Math.PI * 2;
          g.add(t);
        }
      }
      return withMeta(g, { footprint: { w: 40, d: 30 }, labelY: 7 });
    }
    if (level === 2) {
      g.userData.smokes = [];
      for (let i = 0; i < 4; i++) {
        const n = nissen(2.8, 13);
        n.position.x = -18 + i * 12;
        g.add(n);
      }
      return withMeta(g, { footprint: { w: 46, d: 16 }, labelY: 7 });
    }
    for (const z of [-8, 8]) {
      const b = building({ w: 38, d: 9, h: 6.2, storeys: 2, roof: MAT.slate(), rise: 2.8, chimneys: 3 });
      b.position.z = z;
      g.add(b);
    }
    return withMeta(g, { footprint: { w: 44, d: 30 }, labelY: 12 });
  };

  M.fuelDepot = function (level) {
    const g = new THREE.Group();
    if (level <= 1) {
      for (let i = 0; i < 3; i++) {
        const t = M.truck('bowser');
        t.position.set(-9 + i * 7, 0, 0);
        t.rotation.y = Math.PI;
        g.add(t);
      }
      for (let i = 0; i < 14; i++) {
        g.add(cyl(0.3, 0.3, 0.9, MAT.paint(i % 3 ? '#4f5a37' : '#6a4d33', 0.6), 13 + (i % 4) * 0.65, Math.floor(i / 8) * 0.9, -2 + Math.floor((i % 8) / 4) * 0.65, 10));
      }
      g.add(sandbagWall(10), box(0.8, 1.2, 6, MAT.sandbag(), 9.5, 0, -2));
      g.children[g.children.length - 2].position.set(14.5, 0.6, -5);
      return withMeta(g, { footprint: { w: 36, d: 18 }, labelY: 7 });
    }
    const spots = level === 2 ? [[-9, -2], [9, -2]] : [[-10, -9], [10, -9], [-10, 9], [10, 9]];
    for (const [x, z] of spots) {
      const t = fuelTank(5, 5.5);
      t.position.set(x, 0, z);
      g.add(t);
    }
    const pump = building({ w: 5, d: 4, h: 2.8, roofType: 'gable', roof: MAT.slate(), rise: 1.2, spacing: 4 });
    pump.position.set(level === 2 ? 0 : 23, 0, level === 2 ? 12 : 0);
    g.add(pump);
    const nb = level === 2 ? 1 : 2;
    for (let i = 0; i < nb; i++) {
      const t = M.truck('bowser');
      t.rotation.y = Math.PI / 2;
      t.position.set(level === 2 ? -12 : 27, 0, level === 2 ? 13 : 12 + i * 4);
      g.add(t);
    }
    return withMeta(g, { footprint: { w: level === 2 ? 38 : 54, d: level === 2 ? 34 : 40 }, labelY: 9 });
  };

  M.mess = function (level) {
    const g = new THREE.Group();
    if (level <= 1) {
      const n = nissen(3.6, 24, '#66705a');
      n.rotation.y = Math.PI / 2;
      g.add(n);
      const s = n.userData.smoke;
      return withMeta(g, { footprint: { w: 26, d: 10 }, labelY: 7, smoke: V3(s.z, s.y, -s.x) });
    }
    const b = building({ w: 28, d: 12, h: 4.6, roofType: 'gable', roof: MAT.tiles(), rise: 3.2, chimneys: 1 });
    g.add(b);
    g.add(box(4, 0.25, 2.2, MAT.render(), 0, 2.6, 7));
    return withMeta(g, { footprint: { w: 30, d: 14 }, labelY: 11, smoke: V3(7, 4.6 + 3.2 + 1.5, 0) });
  };

  M.tower = function (level) {
    const g = new THREE.Group();
    const w = level >= 2 ? 14 : 10, d = level >= 2 ? 10 : 8, h = 6.6;
    g.add(box(w + 0.3, 0.35, d + 0.3, MAT.concrete(), 0, -0.05, 0));
    g.add(box(w, h, d, MAT.render()));
    g.add(box(w + 0.6, 0.3, d + 0.6, MAT.concrete(), 0, h, 0));
    for (const y of [1.6, 4.9]) {
      windowRow(g, w, y, '+z', d / 2, 1.3);
      windowRow(g, d, y, '+x', w / 2, 1.6);
      windowRow(g, d, y, '-x', w / 2, 1.6);
      windowRow(g, w, y, '-z', d / 2, 3);
    }
    door(g, -w / 2 + 1.5, 0.3, -d / 2 - 0.03, Math.PI);
    // first-floor balcony and roof railing
    g.add(box(w + 1.6, 0.25, 1.6, MAT.concrete(), 0, 3.3, d / 2 + 0.8));
    const railTop = level >= 2 ? h + 0.3 : h + 0.3;
    for (const [len, x, z, rot] of [[w + 0.6, 0, d / 2 + 0.3, 0], [w + 0.6, 0, -d / 2 - 0.3, 0], [d + 0.6, w / 2 + 0.3, 0, 1], [d + 0.6, -w / 2 - 0.3, 0, 1]]) {
      const rail = box(rot ? 0.06 : len, 0.06, rot ? len : 0.06, MAT.metal('#2d2d2b'), x, railTop + 1.0, z);
      g.add(rail);
      const n = Math.round(len / 1.2);
      for (let i = 0; i <= n; i++) {
        const t = -len / 2 + (i * len) / n;
        g.add(box(0.05, 1.0, 0.05, MAT.metal('#2d2d2b'), rot ? x : t, railTop, rot ? t : z));
      }
    }
    if (level >= 2) {
      const cw = 8, cd = 6, ch = 2.6;
      g.add(box(cw, ch, cd, MAT.darkGlass(), 0, h + 0.3, 0));
      for (const [len, x, z, rot] of [[cw, 0, cd / 2, 0], [cw, 0, -cd / 2, 0], [cd, cw / 2, 0, 1], [cd, -cw / 2, 0, 1]]) {
        const n = Math.round(len / 1.3);
        for (let i = 0; i <= n; i++) {
          const t = -len / 2 + (i * len) / n;
          g.add(box(0.12, ch, 0.12, MAT.paint('#e6e2d6', 0.6), rot ? x : t, h + 0.3, rot ? t : z));
        }
      }
      g.add(box(cw + 0.8, 0.3, cd + 0.8, MAT.concrete(), 0, h + 0.3 + ch, 0));
    }
    // external stair
    for (let i = 0; i < 12; i++) g.add(box(1.1, 0.28, 0.3, MAT.concrete(), w / 2 + 0.7, i * 0.28, -d / 2 + 1 + i * 0.3));
    // signals square
    const sq = mesh(new THREE.PlaneGeometry(12, 12), std('signals', { map: T.blackout(), roughness: 0.9 }), false, true);
    sq.rotation.x = -Math.PI / 2;
    sq.position.set(-2, 0.06, d / 2 + 9);
    g.add(sq);
    // flagpole with RAF ensign
    g.add(cyl(0.07, 0.1, 11, MAT.paint('#e8e4d8', 0.5), w / 2 + 6, 0, d / 2 + 4));
    const flag = mesh(new THREE.PlaneGeometry(2.6, 1.3, 8, 1), std('ensign', { map: T.ensign(), roughness: 0.9, side: DS }), true, false);
    flag.position.set(w / 2 + 6 + 1.3, 10.2, d / 2 + 4);
    g.add(flag);
    // crash tender on standby
    const tender = M.truck('tender');
    tender.position.set(-w / 2 - 6, 0, d / 2 + 4);
    tender.rotation.y = Math.PI;
    g.add(tender);
    return withMeta(g, { footprint: { w: 34, d: 30 }, labelY: level >= 2 ? 13 : 10, flag });
  };

  // ---------- defences ----------
  function sandbagRing(r, h) {
    const ring = mesh(new THREE.CylinderGeometry(r, r + 0.4, h, 22, 1, true), std('sandbagRing', { map: T.sandbag(), roughness: 1, side: DS }));
    scaleUV(ring.geometry, Math.PI * 2 * r, h);
    ring.position.y = h / 2;
    return ring;
  }

  function lewisPost() {
    const g = new THREE.Group();
    g.add(sandbagRing(2.2, 1.1));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      g.add(strut(V3(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5), V3(0, 1.2, 0), 0.03, MAT.black()));
    }
    const gun = new THREE.Group();
    gun.add(box(0.12, 0.14, 1.3, MAT.black(), 0, 0, 0));
    const drum = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 14), MAT.black());
    drum.position.set(0, 0.16, 0.1);
    gun.add(drum);
    gun.position.set(0, 1.25, 0);
    gun.rotation.x = 0.7;
    g.add(gun);
    const f = M.figure('#5a5340');
    f.position.set(0.3, 0, 0.8);
    g.add(f);
    return withMeta(g, { gun: V3(0, 1.6, -0.4) });
  }

  function boforsPit() {
    const g = new THREE.Group();
    g.add(sandbagRing(4, 1.3));
    g.add(cyl(1.0, 1.2, 0.6, MAT.paint('#4b5233', 0.7)));
    g.add(box(1.4, 1.0, 1.6, MAT.paint('#4b5233', 0.7), 0, 0.6, 0));
    const barrel = mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.6, 10), MAT.black());
    barrel.geometry.translate(0, 1.8, 0);
    barrel.position.set(0, 1.3, 0);
    barrel.rotation.x = -0.75;
    g.add(barrel);
    g.add(box(1.6, 0.9, 0.08, MAT.paint('#4b5233', 0.7), 0, 1.2, -0.5)); // shield
    for (const [x, z, r] of [[-1.8, 1.2, 2.4], [1.9, 0.8, -2.2]]) {
      const f = M.figure('#5a5340');
      f.position.set(x, 0, z);
      f.rotation.y = r;
      g.add(f);
    }
    for (let i = 0; i < 3; i++) g.add(box(0.6, 0.35, 0.4, MAT.paint('#3f4a2d', 0.8), -2.6 + i * 0.7, 0, -2.4));
    return withMeta(g, { gun: V3(0, 3.8, -2.5) });
  }

  function heavyAA() {
    const g = new THREE.Group();
    const wall = mesh(new THREE.CylinderGeometry(6, 6.4, 1.5, 28, 1, true), MAT.concrete());
    wall.material.side = DS;
    wall.position.y = 0.75;
    g.add(wall);
    g.add(cyl(1.6, 1.9, 0.8, MAT.paint('#4b5233', 0.7)));
    g.add(box(1.8, 1.6, 2.6, MAT.paint('#4b5233', 0.7), 0, 0.8, 0));
    const barrel = mesh(new THREE.CylinderGeometry(0.11, 0.14, 5.4, 12), MAT.paint('#3c4229', 0.6));
    barrel.geometry.translate(0, 2.7, 0);
    barrel.position.set(0, 2.0, 0);
    barrel.rotation.x = -0.8;
    g.add(barrel);
    for (let i = 0; i < 4; i++) {
      const f = M.figure('#4f5c70');
      const a = (i / 4) * Math.PI * 2 + 0.4;
      f.position.set(Math.cos(a) * 3.3, 0, Math.sin(a) * 3.3);
      f.rotation.y = -a;
      g.add(f);
    }
    return withMeta(g, { gun: V3(0, 6, -3.8) });
  }

  function searchlight() {
    const g = new THREE.Group();
    g.add(sandbagRing(2.6, 1.0));
    g.add(box(0.3, 1.3, 0.3, MAT.metal('#555'), -0.7, 0, 0), box(0.3, 1.3, 0.3, MAT.metal('#555'), 0.7, 0, 0));
    const drum = mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.1, 18), MAT.paint('#4b5233', 0.6));
    drum.rotation.x = 1.0;
    drum.position.y = 1.5;
    g.add(drum);
    return withMeta(g, { lamp: V3(0, 2, 0) });
  }

  // Positions are absolute (the defences group sits at the world origin).
  const AA_SITES = {
    lewis: [[-140, 75], [145, 75], [-150, -78], [175, -55]],
    bofors: [[-430, 200], [440, -200], [580, 190]],
    heavy: [[-300, -205], [300, 215]],
    lights: [[-560, -150], [0, 232], [560, -40]],
  };

  M.defenses = function (level) {
    const g = new THREE.Group();
    const guns = [], lights = [];
    const place = (obj, [x, z]) => {
      obj.position.set(x, 0, z);
      obj.rotation.y = Math.atan2(x, z) + Math.PI; // face outward-ish
      g.add(obj);
      obj.updateMatrixWorld(true);
      if (obj.userData.gun) guns.push(obj.localToWorld(obj.userData.gun.clone()));
      if (obj.userData.lamp) lights.push(obj.localToWorld(obj.userData.lamp.clone()));
    };
    if (level >= 1) AA_SITES.lewis.forEach((p) => place(lewisPost(), p));
    if (level >= 2) AA_SITES.bofors.forEach((p) => place(boforsPit(), p));
    if (level >= 3) {
      AA_SITES.heavy.forEach((p) => place(heavyAA(), p));
      AA_SITES.lights.forEach((p) => place(searchlight(), p));
    }
    const a = AA_SITES.lewis[0];
    return withMeta(g, { anchor: V3(a[0], 0, a[1]), footprint: { w: 8, d: 8 }, labelY: 5, guns, searchlights: lights, noScaffold: true });
  };

  // Blast walls between parking spots (open front and back so aircraft can taxi out and be towed in).
  M.pens = function (level, slots) {
    const g = new THREE.Group();
    const h = level >= 2 ? 3.4 : 2.6;
    const xs = new Set();
    for (const p of slots) { xs.add(p.x - 15); xs.add(p.x + 15); }
    const z0 = slots[0].z - 11, len = 22;
    for (const x of xs) {
      if (level >= 2) {
        g.add(box(0.9, h - 0.5, len, MAT.brick(), x, 0, z0 + len / 2));
        g.add(box(1.3, 0.5, len, MAT.sandbag(), x, h - 0.5, z0 + len / 2));
      } else {
        const shape = new THREE.Shape([new THREE.Vector2(-2.6, 0), new THREE.Vector2(2.6, 0), new THREE.Vector2(0.7, h), new THREE.Vector2(-0.7, h)]);
        const geo = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false });
        const bank = mesh(geo, std('bank', { map: T.earth(), roughness: 1 }));
        bank.position.set(x, 0, z0);
        g.add(bank);
      }
    }
    return withMeta(g, { anchor: V3(0, 0, slots[0].z), footprint: { w: 250, d: 24 }, labelY: 6, noScaffold: true });
  };

  // Unbuilt defences: a marked-out site at each gun post, so players can see (and click) where they'd go.
  M.defensesSite = function () {
    const g = new THREE.Group();
    for (const [x, z] of AA_SITES.lewis) {
      const site = M.site({ w: 8, d: 8 });
      site.position.set(x, 0, z);
      g.add(site);
    }
    const a = AA_SITES.lewis[0];
    return withMeta(g, { anchor: V3(a[0], 0, a[1]), footprint: { w: 8, d: 8 }, labelY: 3, noScaffold: true });
  };

  // Unbuilt blast pens: survey pegs and white tape where each wall would run.
  M.pensSite = function (slots) {
    const g = new THREE.Group();
    const tape = std('tape', { color: '#f2eedc', roughness: 0.8 });
    const xs = new Set();
    for (const p of slots) { xs.add(p.x - 15); xs.add(p.x + 15); }
    const z0 = slots[0].z - 11, len = 22;
    for (const x of xs) {
      g.add(box(0.25, 0.02, len, tape, x, 0.19, z0 + len / 2));
      for (const z of [z0, z0 + len]) {
        g.add(box(0.12, 1.0, 0.12, MAT.paint('#c9b48a'), x, 0, z));
        g.add(box(0.14, 0.18, 0.14, MAT.paint('#b3261d'), x, 0.95, z));
      }
    }
    return withMeta(g, { anchor: V3(0, 0, slots[0].z), footprint: { w: 250, d: 24 }, labelY: 3, noScaffold: true });
  };

  M.crater = function (r) {
    const m = mesh(new THREE.CircleGeometry(r, 24), std('crater', { map: T.crater(), transparent: true, depthWrite: false, roughness: 1 }), false, true);
    m.rotation.x = -Math.PI / 2;
    return m;
  };

  // Turn an aircraft model into a burnt-out wreck.
  M.wreck = function (obj) {
    obj.traverse((o) => {
      if (!o.isMesh) return;
      if (o.material.transparent) { o.visible = false; return; }
      o.material = MAT.burnt();
    });
    const info = obj.userData.plane;
    if (info) for (const p of info.props) p.hub.visible = false;
    if (info && info.pilot) info.pilot.visible = false;
    obj.rotation.z = 0.25;
    obj.rotation.x = -0.05;
    obj.position.y -= 0.8;
  };

  M.SITE_FOOTPRINT = {
    fuelDepot: { w: 38, d: 32 }, mess: { w: 30, d: 14 }, tower: { w: 30, d: 26 },
  };

  M.site = function (fp) {
    const g = new THREE.Group();
    const m = mesh(new THREE.PlaneGeometry(fp.w, fp.d), std('site', { map: T.site(), transparent: true, depthWrite: false, roughness: 1 }), false, true);
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.08;
    g.add(m);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      g.add(box(0.12, 1.1, 0.12, MAT.paint('#c9b48a'), (sx * fp.w) / 2, 0, (sz * fp.d) / 2));
      g.add(box(0.14, 0.2, 0.14, MAT.paint('#b3261d'), (sx * fp.w) / 2, 1.0, (sz * fp.d) / 2));
    }
    return withMeta(g, { footprint: fp, labelY: 3 });
  };

  M.scaffold = function (fp, height) {
    const g = new THREE.Group();
    const pole = MAT.metal('#7a7b74');
    const plank = MAT.paint('#8c7550', 0.9);
    const w = fp.w + 2, d = fp.d + 2;
    const perim = [];
    for (let x = -w / 2; x <= w / 2 + 0.01; x += w / Math.max(1, Math.round(w / 3.5))) perim.push([x, -d / 2], [x, d / 2]);
    for (let z = -d / 2 + 3.5; z < d / 2 - 0.5; z += d / Math.max(1, Math.round(d / 3.5))) perim.push([-w / 2, z], [w / 2, z]);
    for (const [x, z] of perim) g.add(box(0.08, height, 0.08, pole, x, 0, z));
    for (let y = 2; y <= height; y += 2) {
      g.add(box(w, 0.08, 0.08, pole, 0, y, -d / 2), box(w, 0.08, 0.08, pole, 0, y, d / 2));
      g.add(box(0.08, 0.08, d, pole, -w / 2, y, 0), box(0.08, 0.08, d, pole, w / 2, y, 0));
      g.add(box(w, 0.06, 0.6, plank, 0, y, d / 2 - 0.3));
    }
    // barrier and materials
    g.add(box(4, 0.8, 1.6, MAT.paint('#a59a82', 1), w / 2 + 3, 0, d / 2 - 2));
    g.add(box(3, 0.5, 1.2, MAT.brick(), w / 2 + 3, 0, d / 2 - 5));
    return g;
  };

  // Squadron dispersal hut: where pilots wait for the call, with deckchairs out front, the
  // readiness board and the scramble bell. Front faces +z. meta.chairs are seats for pilots.
  M.dispersalHut = function () {
    const g = new THREE.Group();
    const hut = timberHut(10, 5);
    g.add(hut);
    // veranda roof on posts along the front
    g.add(box(10.6, 0.15, 2.4, MAT.felt(), 0, 3.05, 3.6));
    for (const x of [-5, -1.7, 1.7, 5]) g.add(cyl(0.08, 0.08, 3.05, MAT.timber(), x, 0, 4.6));
    g.add(box(10.6, 0.2, 2.6, MAT.timber(), 0, 0, 3.6)); // boardwalk
    // readiness board and bell
    const board = mesh(new THREE.PlaneGeometry(1.6, 0.8), std('board', { map: T.readinessBoard(), roughness: 0.8 }), false, true);
    board.position.set(-2.8, 1.9, 2.54);
    g.add(board);
    g.add(cyl(0.03, 0.03, 0.5, MAT.black(), 4.2, 2.5, 4.6));
    const bell = mesh(new THREE.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), MAT.metal('#b08a3a'));
    bell.material.side = DS;
    bell.position.set(4.2, 2.45, 4.6);
    bell.rotation.x = Math.PI;
    g.add(bell);
    // table with a field telephone
    g.add(box(1.4, 0.06, 0.8, MAT.timber(), 2.2, 0.75, 3.4));
    for (const [x, z] of [[1.6, 3.1], [2.8, 3.1], [1.6, 3.7], [2.8, 3.7]]) g.add(box(0.06, 0.75, 0.06, MAT.timber(), x, 0, z));
    g.add(box(0.25, 0.18, 0.2, MAT.black(), 2.4, 0.81, 3.4));
    // chairs on the grass in front
    const chairs = [];
    for (let i = 0; i < 8; i++) {
      const row = i < 5 ? 0 : 1;
      const x = row ? -3.2 + (i - 5) * 3.1 : -5.6 + i * 2.7, z = 7.2 + row * 2.6 + (i % 2) * 0.4;
      const rot = Math.PI + (((i * 37) % 7) - 3) * 0.12;
      const c = M.deckchair();
      c.position.set(x, 0, z);
      c.rotation.y = rot;
      g.add(c);
      chairs.push({ x, z, rot });
    }
    return withMeta(g, { chairs });
  };

  M.house = function (seed) {
    const r = T.rng(seed);
    const w = 7 + r() * 5, d = 6 + r() * 2;
    const b = building({
      w, d, h: 5.2, storeys: 2, roofType: r() < 0.5 ? 'gable' : 'hip',
      roof: r() < 0.6 ? MAT.tiles() : MAT.slate(), wall: r() < 0.7 ? MAT.brick() : MAT.render(), chimneys: 2, rise: 2.6,
    });
    return b;
  };

  M.windsock = function () {
    const g = new THREE.Group();
    g.add(cyl(0.06, 0.1, 7, MAT.paint('#dedad0', 0.5)));
    const sockGeo = new THREE.CylinderGeometry(0.25, 0.45, 3.2, 14, 1, true);
    sockGeo.rotateZ(Math.PI / 2);
    sockGeo.translate(-1.6, 0, 0);
    const sock = mesh(sockGeo, std('sock', { map: T.windsock(), side: DS, roughness: 1 }));
    sock.position.y = 6.8;
    g.add(sock);
    g.userData.sock = sock;
    return g;
  };

})(window.AF);
