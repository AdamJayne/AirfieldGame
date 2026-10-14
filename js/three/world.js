// 3D world: terrain and countryside, airfield surfaces, sky, sun/moon lighting, clouds.
(function (AF) {
  'use strict';
  if (!window.THREE) return;

  const T = AF.tex;
  const MD = AF.models;
  const W = (AF.world = {});
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

  // ---------- layout (metres; +x east, +z south) ----------
  W.LAYOUT = {
    hangar: { x: -75, z: -28 },
    officers: { x: 5, z: -32 },
    enlisted: { x: 85, z: -32 },
    fuelDepot: { x: 165, z: 28 },
    mess: { x: 40, z: -88 },
    tower: { x: -170, z: 30 },
    defenses: { x: 0, z: 0 }, // gun sites are placed in absolute coordinates
    pens: { x: 0, z: 0 },
  };
  W.DISPERSAL = { x: 112, z: 1 }; // pilots' dispersal hut, facing the apron
  W.RUNWAY_Z = 130;
  W.APRON = { x0: -125, x1: 125, z0: 18, z1: 62 };
  W.FIELD = { x0: -650, x1: 650, z0: -270, z1: 250 };
  W.slot = (i) => V3(-105 + i * 30, 0, 40);
  W.runwayLength = (level) => (level >= 3 ? 1100 : 800);

  function flat(w, d, material, x, z, y = 0.03, rotY = 0) {
    const geo = new THREE.PlaneGeometry(w, d);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * d);
    const m = new THREE.Mesh(geo, material);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = rotY;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    return m;
  }
  W.flat = flat;

  const surf = {};
  const surface = (key, params) => surf[key] || (surf[key] = new THREE.MeshStandardMaterial({
    roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, ...params,
  }));
  W.surfaces = {
    concrete: () => surface('concrete', { map: T.concrete(), color: '#c4c0b4' }),
    asphalt: () => surface('asphalt', { map: T.asphalt() }),
    gravel: () => surface('gravel', { map: T.gravel() }),
    dirt: () => surface('dirt', { map: T.dirt() }),
    mown: () => surface('mown', { map: T.mown() }),
    paint: () => surface('paint', { color: '#e9e7de', roughness: 0.8, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  };

  // Smooth value noise for terrain colour variation.
  function noise2(x, z) {
    return (
      Math.sin(x * 0.011 + 1.3) * Math.sin(z * 0.013 + 0.7) * 0.5 +
      Math.sin(x * 0.031 + z * 0.017 + 2.1) * 0.3 +
      Math.sin(x * 0.067 - z * 0.059 + 0.4) * 0.2 +
      Math.sin(x * 0.19 + 1.7) * Math.sin(z * 0.23 + 0.9) * 0.22 // ~30 m: breaks up the texture tiling
    );
  }

  // ---------- static countryside & airfield ----------
  W.buildStatic = function (scene) {
    const rnd = T.rng(1940);
    const F = W.FIELD;
    const inField = (x, z, m = 0) => x > F.x0 - m && x < F.x1 + m && z > F.z0 - m && z < F.z1 + m;

    // Farmland patchwork from a jittered lattice so fields share hedge lines.
    const SIZE = 9000, CELL = 260, N = Math.ceil(SIZE / CELL) + 1, HALF = SIZE / 2;
    const lat = [];
    for (let i = 0; i <= N; i++) {
      lat.push([]);
      for (let j = 0; j <= N; j++) {
        lat[i].push([-HALF + i * CELL + (rnd() - 0.5) * 120, -HALF + j * CELL + (rnd() - 0.5) * 120]);
      }
    }
    const RES = 2048, k = RES / SIZE;
    const cv = document.createElement('canvas');
    cv.width = cv.height = RES;
    const g = cv.getContext('2d');
    g.fillStyle = '#5d7a36';
    g.fillRect(0, 0, RES, RES);
    const crops = ['#6f8b40', '#7d9446', '#5f7d34', '#a99c5c', '#b8a764', '#6e5d40', '#8a9a50', '#c2b06c', '#587533'];
    const P = (p) => [(p[0] + HALF) * k, (p[1] + HALF) * k];
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const q = [lat[i][j], lat[i + 1][j], lat[i + 1][j + 1], lat[i][j + 1]];
        const cx = (q[0][0] + q[2][0]) / 2, cz = (q[0][1] + q[2][1]) / 2;
        const col = inField(cx, cz, 60) ? '#5b7834' : crops[Math.floor(rnd() * crops.length)];
        g.fillStyle = col;
        g.beginPath();
        q.forEach((p, n) => (n ? g.lineTo(...P(p)) : g.moveTo(...P(p))));
        g.closePath();
        g.fill();
        if (col === '#6e5d40' || col === '#a99c5c') { // plough / crop rows
          g.save(); g.clip();
          g.strokeStyle = 'rgba(0,0,0,0.12)';
          g.lineWidth = 1;
          const [px, py] = P([cx, cz]);
          for (let s = -40; s < 40; s += 3) { g.beginPath(); g.moveTo(px - 60, py + s); g.lineTo(px + 60, py + s + 10); g.stroke(); }
          g.restore();
        }
      }
    }
    // hedgerows
    g.strokeStyle = '#3b4f22';
    g.lineWidth = 2.2;
    const hedges = [];
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        for (const [di, dj] of [[1, 0], [0, 1]]) {
          if (i + di > N || j + dj > N) continue;
          const a = lat[i][j], b = lat[i + di][j + dj];
          const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
          if (inField(mx, mz, 80)) continue;
          g.beginPath(); g.moveTo(...P(a)); g.lineTo(...P(b)); g.stroke();
          hedges.push([a, b]);
        }
      }
    }
    // roads
    g.strokeStyle = '#7d7768';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(...P([20, F.z0])); g.lineTo(...P([20, -HALF])); g.stroke();
    g.beginPath(); g.moveTo(...P([-HALF, -700])); g.lineTo(...P([HALF, -720])); g.stroke();
    const farmTex = new THREE.CanvasTexture(cv);
    farmTex.colorSpace = THREE.SRGBColorSpace;
    farmTex.anisotropy = 8;
    // Farmland with a hole where the airfield grass sits, so the two never overlap and flicker.
    const outer = new THREE.Shape([
      new THREE.Vector2(-HALF, -HALF), new THREE.Vector2(HALF, -HALF), new THREE.Vector2(HALF, HALF), new THREE.Vector2(-HALF, HALF),
    ]);
    // shape y = -world z (the mesh is rotated -90° about x)
    outer.holes.push(new THREE.Path([
      new THREE.Vector2(F.x0, -F.z0), new THREE.Vector2(F.x0, -F.z1), new THREE.Vector2(F.x1, -F.z1), new THREE.Vector2(F.x1, -F.z0),
    ]));
    const farmGeo = new THREE.ShapeGeometry(outer);
    const fp = farmGeo.attributes.position, fuv = farmGeo.attributes.uv;
    for (let i = 0; i < fp.count; i++) fuv.setXY(i, (fp.getX(i) + HALF) / SIZE, (fp.getY(i) + HALF) / SIZE);
    const farm = new THREE.Mesh(farmGeo, new THREE.MeshStandardMaterial({ map: farmTex, roughness: 1 }));
    farm.rotation.x = -Math.PI / 2;
    farm.receiveShadow = true;
    scene.add(farm);

    // Airfield grass with vertex-colour variation to break up tiling.
    const fw = F.x1 - F.x0, fd = F.z1 - F.z0;
    const grassGeo = new THREE.PlaneGeometry(fw, fd, 192, 80);
    const uv = grassGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * fw, uv.getY(i) * fd);
    const pos = grassGeo.attributes.position;
    const cols = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + (F.x0 + F.x1) / 2, z = -pos.getY(i) + (F.z0 + F.z1) / 2;
      const n = noise2(x, z);
      cols.push(0.88 + n * 0.14, 0.9 + n * 0.12, 0.85 + n * 0.1);
    }
    grassGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const grass = new THREE.Mesh(grassGeo, new THREE.MeshStandardMaterial({ map: T.grass(), vertexColors: true, roughness: 1 }));
    grass.rotation.x = -Math.PI / 2;
    grass.position.set((F.x0 + F.x1) / 2, 0, (F.z0 + F.z1) / 2);
    grass.receiveShadow = true;
    scene.add(grass);

    // Trees: hedgerow trees, copses, and a broken tree line round the airfield.
    const trees = [];
    const addTree = (x, z, s = 1) => trees.push([x, z, s * (0.75 + rnd() * 0.6), rnd()]);
    for (const [a, b] of hedges) {
      const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
      const mid = Math.hypot((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      if (mid > 3200) continue;
      for (let s = 0; s < len; s += 14 + rnd() * 22) {
        if (rnd() < 0.45) addTree(a[0] + (dx * s) / len + (rnd() - 0.5) * 3, a[1] + (dz * s) / len + (rnd() - 0.5) * 3);
      }
    }
    for (let c = 0; c < 26; c++) {
      const ang = rnd() * Math.PI * 2, dist = 800 + rnd() * 2200;
      const cx = Math.cos(ang) * dist, cz = Math.sin(ang) * dist;
      const r = 50 + rnd() * 110, n = 30 + Math.floor(rnd() * 70);
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r;
        addTree(cx + Math.cos(a) * d, cz + Math.sin(a) * d, 1.1);
      }
    }
    const edge = (x0, z0, x1, z1, gapAt) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      for (let s = 0; s < len; s += 9 + rnd() * 12) {
        const x = x0 + ((x1 - x0) * s) / len, z = z0 + ((z1 - z0) * s) / len;
        if (gapAt && Math.abs(x - gapAt) < 25) continue;
        if (rnd() < 0.75) addTree(x + (rnd() - 0.5) * 6, z + (rnd() - 0.5) * 6 + (z0 === z1 ? Math.sign(z0) * 8 : 0));
      }
    };
    edge(F.x0, F.z0 - 6, F.x1, F.z0 - 6, 20);
    edge(F.x0, F.z1 + 6, F.x1, F.z1 + 6);
    edge(F.x0 - 8, F.z0, F.x0 - 8, F.z1);
    edge(F.x1 + 8, F.z0, F.x1 + 8, F.z1);
    // a few mature trees around the domestic site
    for (const [x, z] of [[-130, -70], [-120, -95], [130, -75], [150, -60], [-30, -110], [100, -120], [-160, -40]]) addTree(x, z, 1.25);

    // Crown = cluster of lumpy blobs, so silhouettes read as foliage rather than spheres.
    // Near trees get more lumps and cast shadows; distant ones are cheaper and don't.
    function crownGeometry(lumps, detail) {
      const pos = [], uvs = [];
      lumps.forEach(([ox, oy, oz, r], li) => {
        const lg = new THREE.IcosahedronGeometry(1, detail);
        const lp = lg.attributes.position, lu = lg.attributes.uv;
        for (let i = 0; i < lp.count; i++) {
          const x = lp.getX(i), y = lp.getY(i), z = lp.getZ(i);
          const f = 1 + 0.14 * Math.sin(6 * x + li) * Math.sin(5 * y + 2 * li) * Math.sin(7 * z + 3) + 0.07 * Math.sin(13 * x + 9 * z + li);
          pos.push(ox + x * f * r, oy + y * f * r * 0.9, oz + z * f * r);
          uvs.push(lu.getX(i) * 3, lu.getY(i) * 2);
        }
        lg.dispose();
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.computeVertexNormals();
      return geo;
    }
    const LUMPS = [[0, 0, 0, 0.82], [0.48, 0.28, 0.18, 0.62], [-0.45, 0.22, -0.22, 0.64], [0.08, 0.55, -0.12, 0.58],
      [-0.18, -0.12, 0.48, 0.6], [0.2, -0.05, -0.5, 0.56], [-0.5, -0.2, 0.1, 0.5]];
    const crownMat = new THREE.MeshStandardMaterial({ color: '#ffffff', map: T.foliage(), roughness: 1 });
    const trunkMat = new THREE.MeshStandardMaterial({ color: '#4a3b2b', roughness: 1 });
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.35, 1, 6);
    trunkGeo.translate(0, 0.5, 0);
    const farTrunkGeo = new THREE.CylinderGeometry(0.22, 0.35, 1, 4, 1, true); // distant trees: far fewer triangles
    farTrunkGeo.translate(0, 0.5, 0);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p3 = new THREE.Vector3(), col = new THREE.Color();
    const greens = ['#3d5426', '#4a6330', '#35491f', '#56693a', '#425a2a', '#2f4420'];
    const nearTrees = trees.filter(([x, z]) => Math.hypot(x, z) < 900);
    const farTrees = trees.filter(([x, z]) => Math.hypot(x, z) >= 900);
    for (const [list, lumps, near] of [[nearTrees, LUMPS, true], [farTrees, LUMPS.slice(0, 4), false]]) {
      const crowns = new THREE.InstancedMesh(crownGeometry(lumps, near ? 1 : 0), crownMat, list.length);
      const trunks = new THREE.InstancedMesh(near ? trunkGeo : farTrunkGeo, trunkMat, list.length);
      list.forEach(([x, z, s, r], i) => {
        const tall = r < 0.15;
        const cr = (tall ? 3.2 : 4.8) * s, ch = (tall ? 10 : 6.5) * s, th = (tall ? 3 : 3.6) * s;
        q.setFromAxisAngle(V3(0, 1, 0), r * 6.28);
        m4.compose(p3.set(x, th + ch * 0.45, z), q, sc.set(cr, ch * 0.55, cr));
        crowns.setMatrixAt(i, m4);
        col.set(greens[Math.floor(r * 997) % greens.length]).multiplyScalar(0.85 + ((r * 7.3) % 1) * 0.3);
        crowns.setColorAt(i, col);
        m4.compose(p3.set(x, 0, z), q, sc.set(s, th + ch * 0.2, s));
        trunks.setMatrixAt(i, m4);
      });
      crowns.castShadow = trunks.castShadow = near;
      crowns.receiveShadow = near;
      scene.add(crowns, trunks);
    }

    // Boundary fence (post and wire) with a gate on the north side.
    const posts = [];
    const fenceLine = (x0, z0, x1, z1, gap) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      for (let s = 0; s <= len; s += 5) {
        const x = x0 + ((x1 - x0) * s) / len, z = z0 + ((z1 - z0) * s) / len;
        if (gap !== undefined && Math.abs(x - gap) < 6) continue;
        posts.push([x, z]);
      }
    };
    fenceLine(F.x0, F.z0, F.x1, F.z0, 20);
    fenceLine(F.x0, F.z1, F.x1, F.z1);
    fenceLine(F.x0, F.z0, F.x0, F.z1);
    fenceLine(F.x1, F.z0, F.x1, F.z1);
    const postMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 1.4, 0.12), MD.mat.paint('#6b5a43', 1), posts.length);
    posts.forEach(([x, z], i) => { m4.makeTranslation(x, 0.7, z); postMesh.setMatrixAt(i, m4); });
    postMesh.castShadow = true;
    scene.add(postMesh);
    const wireMat = new THREE.LineBasicMaterial({ color: '#5a5a55', transparent: true, opacity: 0.6 });
    for (const y of [0.6, 1.2]) {
      const pts = [V3(F.x0, y, F.z0), V3(F.x1, y, F.z0), V3(F.x1, y, F.z1), V3(F.x0, y, F.z1), V3(F.x0, y, F.z0)];
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wireMat));
    }

    // Roads and camp paths.
    const S = W.surfaces;
    // Each overlay gets its own height so overlapping surfaces never share a plane (z-fighting).
    scene.add(flat(6, 4000, S.asphalt(), 20, F.z0 - 2000, 0.08));
    scene.add(flat(SIZE, 5, S.asphalt(), 0, -710, 0.11, -20 / SIZE));
    scene.add(flat(6, F.z0 * -1 - 62, S.gravel(), 20, (F.z0 - 62) / 2, 0.08));
    scene.add(flat(270, 6, S.gravel(), 0, -62, 0.11));
    scene.add(flat(5, 80, S.gravel(), -29, -22, 0.14));
    scene.add(flat(5, 80, S.gravel(), 46, -22, 0.14));
    scene.add(flat(32, 6, S.gravel(), -139, 35, 0.14));
    scene.add(flat(16, 6, S.gravel(), 132, 40, 0.14));
    scene.add(flat(46, 34, S.concrete(), -75, 1, 0.14)); // hangar pad
    scene.add(flat(5, 30, S.gravel(), 40, -77, 0.14));

    // Main gate with guard hut.
    const gate = new THREE.Group();
    for (const x of [-4, 4]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.4, 0.5), MD.mat.render());
      post.position.set(x, 1.2, 0);
      post.castShadow = true;
      gate.add(post);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(8, 0.15, 0.15), MD.mat.paint('#c9312a', 0.6));
    bar.position.set(0, 1.1, 0);
    gate.add(bar);
    const hut = MD.house(3);
    hut.scale.set(0.45, 0.6, 0.5);
    hut.position.set(12, 0, 6);
    gate.add(hut);
    gate.position.set(20, 0, F.z0);
    scene.add(gate);

    // Village along the lane, and a farm.
    for (let i = 0; i < 12; i++) {
      const h = MD.house(100 + i);
      const side = i % 2 ? 1 : -1;
      h.position.set(-260 + i * 45 + rnd() * 10, 0, -712 + side * (16 + rnd() * 6));
      h.rotation.y = side > 0 ? Math.PI : 0;
      scene.add(h);
    }
    const church = new THREE.Group();
    const nave = MD.house(42);
    nave.scale.set(2, 1.3, 1.2);
    church.add(nave);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(6, 18, 6), MD.mat.render());
    tower.position.set(-14, 9, 0);
    tower.castShadow = true;
    church.add(tower);
    church.position.set(320, 0, -680);
    scene.add(church);
    for (const [x, z, s] of [[-900, 350, 7], [-930, 330, 8], [980, -260, 9]]) {
      const b = MD.house(s);
      b.position.set(x, 0, z);
      b.rotation.y = s;
      scene.add(b);
    }

    const sock = MD.windsock();
    sock.position.set(330, 0, 98);
    scene.add(sock);

    // pilots' dispersal hut beside the apron
    const D = W.DISPERSAL;
    const disp = MD.dispersalHut();
    disp.position.set(D.x, 0, D.z);
    scene.add(disp);
    scene.add(flat(3, 12, S.gravel(), D.x - 8.6, D.z + 11, 0.14));
    const chairs = disp.userData.chairs.map((c) => ({ pos: V3(D.x + c.x, 0, D.z + c.z), rot: c.rot }));
    return { windsock: sock.userData.sock, chairs };
  };

  // ---------- runway, taxiway, apron (rebuilt when the runway is upgraded) ----------
  W.buildRunway = function (level) {
    const g = new THREE.Group();
    const S = W.surfaces;
    const RZ = W.RUNWAY_Z;
    const len = W.runwayLength(level);
    const lights = [];

    if (level <= 1) {
      g.add(flat(len, 60, S.mown(), 0, RZ, 0.06));
      const white = MD.mat.paint('#eeeae0', 0.7);
      for (let x = -len / 2; x <= len / 2; x += 50) {
        for (const z of [RZ - 31, RZ + 31]) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(3, 0.35, 0.5), white);
          m.position.set(x, 0.18, z);
          m.castShadow = true;
          g.add(m);
        }
      }
      g.add(flat(15, RZ - 30 - 60, S.dirt(), 0, (RZ - 30 + 60) / 2, 0.09));
    } else {
      g.add(flat(len + 30, 70, S.mown(), 0, RZ, 0.06));
      g.add(flat(len, 46, S.asphalt(), 0, RZ, 0.1));
      for (let x = -len / 2 + 70; x < len / 2 - 70; x += 50) g.add(flat(25, 0.9, S.paint(), x, RZ, 0.13));
      for (const sx of [-1, 1]) {
        const tx = sx * (len / 2 - 22);
        for (let i = 0; i < 8; i++) g.add(flat(30, 1.8, S.paint(), tx, RZ - 17.5 + i * 5, 0.13));
        const num = new THREE.Mesh(
          new THREE.PlaneGeometry(9, 18),
          new THREE.MeshStandardMaterial({ map: T.runwayNumber(sx < 0 ? '09' : '27'), transparent: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3, depthWrite: false })
        );
        num.rotation.set(-Math.PI / 2, 0, sx < 0 ? -Math.PI / 2 : Math.PI / 2);
        num.position.set(sx * (len / 2 - 60), 0.16, RZ);
        num.receiveShadow = true;
        g.add(num);
      }
      for (let x = -len / 2; x <= len / 2; x += 60) for (const z of [RZ - 25, RZ + 25]) lights.push([x, z]);
      g.add(flat(15, RZ - 23 - 60, S.concrete(), 0, (RZ - 23 + 60) / 2, 0.09));
    }
    g.add(flat(W.APRON.x1 - W.APRON.x0, W.APRON.z1 - W.APRON.z0, S.concrete(), 0, (W.APRON.z0 + W.APRON.z1) / 2, 0.17));
    // only the runway strip itself selects the runway; the apron and taxiway click through
    g.children[g.children.length - 1].userData.noPick = true;
    g.children.forEach((c) => { if (c.position.x === 0 && c.position.z < RZ - 20) c.userData.noPick = true; });

    if (lights.length) {
      const lampGeo = new THREE.CylinderGeometry(0.15, 0.2, 0.5, 8);
      const inst = new THREE.InstancedMesh(lampGeo, MD.mat.lamp(), lights.length);
      const m4 = new THREE.Matrix4();
      lights.forEach(([x, z], i) => { m4.makeTranslation(x, 0.25, z); inst.setMatrixAt(i, m4); });
      g.add(inst);
    }
    return g;
  };

  // ---------- sky, lighting, clouds ----------
  W.createEnvironment = function (scene, renderer) {
    const env = {};

    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        topColor: { value: new THREE.Color() }, horizonColor: { value: new THREE.Color() },
        groundColor: { value: new THREE.Color('#2a3320') }, sunDir: { value: V3(0, 1, 0) },
        sunColor: { value: new THREE.Color() }, sunAmount: { value: 1 },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize((modelMatrix*vec4(position,1.)).xyz - cameraPosition); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform vec3 topColor, horizonColor, groundColor, sunDir, sunColor; uniform float sunAmount; varying vec3 vDir;
        void main(){ vec3 d = normalize(vDir); float h = d.y;
          vec3 col = h > 0. ? mix(horizonColor, topColor, pow(min(1., h * 1.6), 0.55)) : mix(horizonColor, groundColor, min(1., -h * 6.));
          float s = max(0., dot(d, normalize(sunDir)));
          col += sunColor * sunAmount * (pow(s, 900.) * 6. + pow(s, 12.) * 0.25 + pow(s, 3.) * 0.08);
          gl_FragColor = vec4(col, 1.); }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(7000, 32, 16), skyMat);
    sky.renderOrder = -1;
    scene.add(sky);

    // stars
    const sp = [];
    const r = T.rng(77);
    for (let i = 0; i < 1600; i++) {
      const a = r() * Math.PI * 2, y = 0.05 + r() * 0.95, rr = Math.sqrt(1 - y * y);
      sp.push(Math.cos(a) * rr * 6500, y * 6500, Math.sin(a) * rr * 6500);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    const starMat = new THREE.PointsMaterial({ color: '#ffffff', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    scene.fog = new THREE.Fog('#b8cde0', 900, 5200);

    const hemi = new THREE.HemisphereLight('#c7dbf2', '#4d5a32', 0.8);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight('#fff3dd', 3);
    sun.castShadow = true;
    const maxTex = renderer.capabilities.maxTextureSize;
    sun.shadow.mapSize.set(Math.min(4096, maxTex), Math.min(4096, maxTex));
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 2400;
    sun.shadow.bias = -0.0004;
    scene.add(sun, sun.target);
    const moon = new THREE.DirectionalLight('#8ea2d6', 0);
    moon.position.set(-300, 600, -200);
    scene.add(moon);

    const hangarLight = new THREE.PointLight('#ffd79a', 0, 60, 1.6);
    scene.add(hangarLight);
    env.hangarLight = hangarLight;

    // clouds
    const clouds = [];
    for (let i = 0; i < 34; i++) {
      const mat = new THREE.SpriteMaterial({ map: T.cloud(i % 4), transparent: true, depthWrite: false, fog: true, opacity: 0.9 });
      const s = new THREE.Sprite(mat);
      const w = 300 + r() * 500;
      s.scale.set(w, w * (0.35 + r() * 0.15), 1);
      s.position.set((r() - 0.5) * 7000, 420 + r() * 380, (r() - 0.5) * 7000);
      scene.add(s);
      clouds.push(s);
    }

    const KEYS = [ // elevation (rad) -> palette
      { e: -0.35, top: '#0a1330', hor: '#1d2a48', sun: '#000000', sunI: 0, hemi: 0.9, moon: 1.1, fog: '#152038', cloud: 0.18 },
      { e: -0.08, top: '#1a2a58', hor: '#5a4a64', sun: '#000000', sunI: 0, hemi: 0.8, moon: 0.7, fog: '#3a3a52', cloud: 0.4 },
      { e: 0.0, top: '#2c4c86', hor: '#f0a46e', sun: '#ff9a50', sunI: 0.6, hemi: 0.4, moon: 0, fog: '#d6a283', cloud: 0.8 },
      { e: 0.18, top: '#3c6cb4', hor: '#e9c49a', sun: '#ffcf96', sunI: 2.2, hemi: 0.6, moon: 0, fog: '#d9d0c2', cloud: 0.95 },
      { e: 0.45, top: '#3a74c2', hor: '#bdd5e8', sun: '#fff4e2', sunI: 3.0, hemi: 0.8, moon: 0, fog: '#bccfe0', cloud: 1 },
    ];
    const ca = new THREE.Color(), cb = new THREE.Color();
    const lerpCol = (a, b, t, out) => out.copy(ca.set(a)).lerp(cb.set(b), t);

    const sunDir = V3(0, 1, 0);
    env.sunDir = sunDir;
    env.night = 0;

    // Image-based lighting: render the sky dome into a prefiltered environment map so
    // paint, glass and metal pick up sky reflections. Refreshed as the sun moves.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), skyMat));
    let envRT = null, envKey = null;
    function refreshEnv(key) {
      if (key === envKey) return;
      envKey = key;
      const rt = pmrem.fromScene(envScene, 0.04, 0.1, 2000);
      if (envRT) envRT.dispose();
      envRT = rt;
      scene.environment = rt.texture;
    }

    env.update = function (minute, target, radius, dt) {
      const h = (minute % 1440) / 60;
      const frac = (h - 5) / 16; // daylight 05:00 - 21:00 (British Summer Time)
      const ang = frac * Math.PI;
      const elev = Math.sin(ang) * 0.95;
      const hx = Math.cos(ang), hz = Math.sin(ang) * 0.8 + 0.35;
      const hl = Math.hypot(hx, hz);
      sunDir.set((hx / hl) * Math.cos(elev), Math.sin(elev), (hz / hl) * Math.cos(elev));

      let i = 0;
      while (i < KEYS.length - 2 && elev > KEYS[i + 1].e) i++;
      const A = KEYS[i], B = KEYS[i + 1];
      const t = AF.clamp((elev - A.e) / (B.e - A.e), 0, 1);
      const L = (k) => A[k] + (B[k] - A[k]) * t;
      lerpCol(A.top, B.top, t, skyMat.uniforms.topColor.value);
      lerpCol(A.hor, B.hor, t, skyMat.uniforms.horizonColor.value);
      lerpCol(A.sun, B.sun, t, skyMat.uniforms.sunColor.value);
      skyMat.uniforms.sunDir.value.copy(sunDir);
      skyMat.uniforms.sunAmount.value = elev > -0.05 ? 1 : 0;
      lerpCol(A.fog, B.fog, t, scene.fog.color);
      skyMat.uniforms.groundColor.value.copy(scene.fog.color).multiplyScalar(0.6);

      refreshEnv(Math.round(elev * 30));

      sun.intensity = L('sunI');
      lerpCol(A.sun, B.sun, t, sun.color);
      sun.castShadow = sun.intensity > 0.05;
      hemi.intensity = L('hemi') * 0.45;
      lerpCol(A.top, B.hor, 0.6, hemi.color).lerp(cb.set('#ffffff'), 0.4);
      moon.intensity = L('moon');

      // keep the shadow frustum tight around what the camera is looking at
      // sized in discrete steps so shadows don't shimmer continuously while zooming
      const size = Math.pow(2, Math.ceil(Math.log2(AF.clamp(radius * 0.85, 70, 520)) * 3) / 3);
      const cam = sun.shadow.camera;
      if (cam.right !== size) {
        cam.left = cam.bottom = -size;
        cam.right = cam.top = size;
        cam.updateProjectionMatrix();
        sun.shadow.normalBias = (size / sun.shadow.mapSize.x) * 2;
      }
      const texel = (2 * size) / sun.shadow.mapSize.x;
      const tx = Math.round(target.x / texel) * texel, tz = Math.round(target.z / texel) * texel;
      sun.target.position.set(tx, 0, tz);
      sun.position.set(tx + sunDir.x * 1000, Math.max(30, sunDir.y * 1000), tz + sunDir.z * 1000);

      const night = AF.clamp((0.06 - elev) / 0.22, 0, 1);
      env.night = night;
      starMat.opacity = night * 0.9;
      MD.mat.window().emissiveIntensity = night * 2.4;
      MD.mat.lamp().emissiveIntensity = night * 6;
      hangarLight.intensity = night * 90;

      const cl = L('cloud');
      for (const c of clouds) {
        c.material.color.setRGB(cl, cl * (elev < 0.15 && elev > -0.1 ? 0.88 : 1), cl * (elev < 0.15 && elev > -0.1 ? 0.8 : 1));
        c.position.x += dt * 4;
        if (c.position.x > 3500) c.position.x -= 7000;
      }
    };

    env.follow = function (camera) {
      sky.position.copy(camera.position);
      stars.position.copy(camera.position);
    };

    return env;
  };
})(window.AF);
