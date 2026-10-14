// 3D renderer (Three.js). Same interface as the 2D renderer:
// init(canvas), draw(state, now), pick(event) -> {kind, id} | null, hover, selected, dragged,
// plus focus(hit, close) to move the camera to an item.
(function (AF) {
  'use strict';
  if (!window.THREE) return;

  const W = AF.world, MD = AF.models, T = AF.tex;
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const R = (AF.render3d = { hover: null, selected: { building: null, plane: null }, dragged: false, followId: null });

  let renderer, scene, camera, canvas, env, statics, labelsEl, flashLight;
  let runwayGroup = null, runwayLevel = -1;
  let lastNow = 0, visTime = null, lastW = 0, lastH = 0, clock = 0, shake = 0;
  const buildings = {};          // id -> { group, key, meta, anchor, label, text }
  const planes = new Map();      // planeId -> view
  const slots = new Array(8).fill(null);
  const pickables = [];
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hoverRing, selectRing;

  // raid bookkeeping: effects that the simulation has already applied but the bombs haven't reached yet
  const raids = [];
  const craterMeshes = new Map();
  const scorch = [];             // temporary craters from bombs that missed

  R.supported = function () {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch (e) {
      return false;
    }
  };

  // ---------- camera controls ----------
  const ctl = { target: V3(-20, 0, 12), theta: 0.45, phi: 1.0, radius: 250 };
  const goal = { target: ctl.target.clone(), theta: ctl.theta, phi: ctl.phi, radius: ctl.radius };
  const HOME = { target: ctl.target.clone(), theta: ctl.theta, phi: ctl.phi, radius: ctl.radius };
  const keys = new Set();

  R.resetView = function () {
    goal.target.copy(HOME.target);
    goal.theta = HOME.theta;
    goal.phi = HOME.phi;
    goal.radius = HOME.radius;
    R.followId = null;
  };

  function clampGoal() {
    goal.phi = AF.clamp(goal.phi, 0.12, 1.45);
    goal.radius = AF.clamp(goal.radius, 22, 1500);
    goal.target.x = AF.clamp(goal.target.x, -1000, 1000);
    goal.target.z = AF.clamp(goal.target.z, -800, 800);
  }

  function pan(dx, dy) {
    const k = goal.radius * 0.0016;
    const right = V3(Math.cos(goal.theta), 0, -Math.sin(goal.theta));
    const fwd = V3(-Math.sin(goal.theta), 0, -Math.cos(goal.theta));
    goal.target.addScaledVector(right, -dx * k).addScaledVector(fwd, dy * k);
    R.followId = null;
    clampGoal();
  }

  function updateControls(dt) {
    const k = 0.6 * goal.radius * dt;
    const px = k / (goal.radius * 0.0016);
    if (keys.has('KeyW') || keys.has('ArrowUp')) pan(0, px);
    if (keys.has('KeyS') || keys.has('ArrowDown')) pan(0, -px);
    if (keys.has('KeyA') || keys.has('ArrowLeft')) pan(px, 0);
    if (keys.has('KeyD') || keys.has('ArrowRight')) pan(-px, 0);
    if (keys.has('KeyQ')) goal.theta += dt * 1.2;
    if (keys.has('KeyE')) goal.theta -= dt * 1.2;
    if (keys.has('KeyR') || keys.has('Equal')) goal.radius *= 1 - dt * 1.5;
    if (keys.has('KeyF') || keys.has('Minus')) goal.radius *= 1 + dt * 1.5;
    clampGoal();

    // keep a selected aircraft in view while it taxis
    if (R.followId) {
      const v = planes.get(R.followId);
      if (!v || !v.obj.visible || v.obj.position.y > 60 || v.wreck) R.followId = null;
      else if (v.moving) goal.target.set(v.obj.position.x, 0, v.obj.position.z);
    }

    const a = Math.min(1, dt * 7);
    ctl.target.lerp(goal.target, a);
    ctl.theta += (goal.theta - ctl.theta) * a;
    ctl.phi += (goal.phi - ctl.phi) * a;
    ctl.radius += (goal.radius - ctl.radius) * a;
    const sp = Math.sin(ctl.phi);
    camera.position.set(
      ctl.target.x + ctl.radius * sp * Math.sin(ctl.theta),
      ctl.target.y + ctl.radius * Math.cos(ctl.phi),
      ctl.target.z + ctl.radius * sp * Math.cos(ctl.theta)
    );
    if (shake > 0.01) {
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake;
      shake *= Math.exp(-dt * 4);
    }
    camera.position.y = Math.max(camera.position.y, 2);
    camera.lookAt(ctl.target);
  }

  function bindInput() {
    const pointers = new Map();
    let press = null, pinch = 0;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        press = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, pan: e.button === 2 || e.button === 1 || e.shiftKey };
        R.dragged = false;
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) goal.radius *= pinch / d;
        pinch = d;
        R.dragged = true;
        clampGoal();
        return;
      }
      if (!press) return;
      const dx = e.clientX - press.lx, dy = e.clientY - press.ly;
      press.lx = e.clientX;
      press.ly = e.clientY;
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4) R.dragged = true;
      if (!R.dragged) return;
      if (press.pan) pan(dx, dy);
      else {
        goal.theta -= dx * 0.005;
        goal.phi -= dy * 0.004;
        clampGoal();
      }
    });
    const up = (e) => {
      pointers.delete(e.pointerId);
      if (!pointers.size) press = null;
      pinch = 0;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      goal.radius *= Math.exp(e.deltaY * 0.0012);
      clampGoal();
    }, { passive: false });
    canvas.addEventListener('dblclick', (e) => {
      const h = R.pick(e);
      if (h) R.focus(h, true);
    });
    window.addEventListener('keydown', (e) => {
      if (e.target.matches && e.target.matches('input, select, textarea')) return;
      keys.add(e.code);
      if (e.code === 'KeyH') R.resetView();
    });
    window.addEventListener('keyup', (e) => keys.delete(e.code));
    window.addEventListener('blur', () => keys.clear());
  }

  function targetInfo(h) {
    if (h.kind === 'building') {
      if (h.id === 'runway') return { pos: V3(0, 0, W.RUNWAY_Z), size: 260 };
      const rec = buildings[h.id];
      if (!rec) return null;
      const fp = rec.meta.footprint || { w: 30, d: 30 };
      return { pos: rec.anchor, size: Math.min(160, Math.max(fp.w, fp.d)) };
    }
    const v = planes.get(h.id);
    if (!v || !v.obj.visible || v.obj.position.y > 60) return null;
    return { pos: v.obj.position, size: v.info.span };
  }

  // Centre the camera on an item. close=true also zooms right in; otherwise it only zooms if far away.
  R.focus = function (h, close) {
    const info = targetInfo(h);
    if (!info) return;
    goal.target.set(info.pos.x, 0, info.pos.z);
    const want = close ? Math.max(24, info.size * 1.7) : Math.max(70, info.size * 4);
    if (close || goal.radius > want * 1.8) goal.radius = want;
    R.followId = h.kind === 'plane' ? h.id : null;
    clampGoal();
  };

  // ---------- init ----------
  R.init = function (c) {
    canvas = c;
    // Logarithmic depth keeps flat ground layers from flickering against each other at a distance.
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(38, 1, 1, 15000);
    env = W.createEnvironment(scene, renderer);
    statics = W.buildStatic(scene);

    flashLight = new THREE.PointLight('#ffc070', 0, 260, 1.6);
    scene.add(flashLight);

    labelsEl = document.createElement('div');
    labelsEl.className = 'labels3d';
    canvas.parentElement.appendChild(labelsEl);

    R.debug = { get camera() { return camera; }, scene, renderer, ctl, goal, buildings, planes, raids };

    hoverRing = makeRing('#ffffff', 0.55);
    selectRing = makeRing('#f0c24b', 0.9);
    initParticles();
    bindInput();
  };

  function makeRing(color, opacity) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.93, 1, 72),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, fog: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 3;
    m.visible = false;
    m.userData.baseOpacity = opacity;
    scene.add(m);
    return m;
  }

  // ---------- picking ----------
  function visibleChain(o) {
    for (; o; o = o.parent) if (!o.visible) return false;
    return true;
  }

  R.pick = function (e) {
    if (!camera) return null;
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(pickables, true);
    for (const h of hits) {
      if (!visibleChain(h.object) || h.object.userData.noPick) continue;
      let o = h.object;
      while (o && !o.userData.pick) o = o.parent;
      if (o) return { ...o.userData.pick };
    }
    return null;
  };

  function removePickable(o) {
    const i = pickables.indexOf(o);
    if (i >= 0) pickables.splice(i, 1);
  }

  // ---------- buildings ----------
  function makeLabel() {
    const el = document.createElement('div');
    el.className = 'label3d';
    labelsEl.appendChild(el);
    return el;
  }

  function buildFor(id, level) {
    const slots = () => [...Array(8).keys()].map(W.slot);
    if (level === 0) {
      if (id === 'defenses') return MD.defensesSite();
      if (id === 'pens') return MD.pensSite(slots());
      return MD.site(MD.SITE_FOOTPRINT[id]);
    }
    if (id === 'pens') return MD.pens(level, slots());
    return MD[id](level);
  }

  function syncBuildings(s) {
    const rl = s.buildings.runway.level;
    if (rl !== runwayLevel) {
      if (runwayGroup) { scene.remove(runwayGroup); MD.disposeTree(runwayGroup); removePickable(runwayGroup); }
      runwayGroup = W.buildRunway(rl);
      runwayGroup.userData.pick = { kind: 'building', id: 'runway' };
      scene.add(runwayGroup);
      pickables.push(runwayGroup);
      runwayLevel = rl;
      for (const m of craterMeshes.values()) scene.remove(m);
      craterMeshes.clear(); // re-place craters for the new runway length
    }

    for (const id of AF.BUILDING_ORDER) {
      if (id === 'runway') continue;
      const b = s.buildings[id];
      const key = b.level + '|' + (b.upgrading ? 1 : 0);
      let rec = buildings[id];
      if (!rec || rec.key !== key) {
        if (rec) { scene.remove(rec.group); MD.disposeTree(rec.group); removePickable(rec.group); }
        const group = new THREE.Group();
        const main = buildFor(id, b.level);
        const meta = main.userData;
        group.add(main);
        if (b.upgrading && !meta.noScaffold && !meta.empty) {
          group.add(MD.scaffold(meta.footprint, b.level > 0 ? Math.max(5, meta.labelY * 0.7) : 4));
        }
        const lay = W.LAYOUT[id];
        group.position.set(lay.x, 0, lay.z);
        group.userData.pick = { kind: 'building', id };
        scene.add(group);
        if (!meta.empty) pickables.push(group);
        const anchor = group.position.clone().add(meta.anchor || V3(0, 0, 0));
        rec = buildings[id] = { group, key, meta, anchor, label: rec ? rec.label : makeLabel(), text: '' };
      }
      const def = AF.BUILDINGS[id];
      let text = b.level ? `${def.name} · Lv ${b.level}` : `${def.name} — site`;
      if (b.upgrading) {
        const pct = Math.round(((s.time - b.upgrading.startAt) / (b.upgrading.finishAt - b.upgrading.startAt)) * 100);
        text += ` · building ${pct}%`;
      }
      if ((b.damage || 0) >= 50) text += ' · out of action';
      else if (b.damage) text += ' · damaged';
      rec.hidden = rec.meta.empty && !b.upgrading;
      if (text !== rec.text) { rec.label.textContent = text; rec.text = text; }
      rec.label.classList.toggle('damaged', (b.damage || 0) > 0);
    }

    const hg = buildings.hangar;
    if (hg && hg.meta.light) env.hangarLight.position.copy(hg.meta.light).add(hg.group.position);
  }

  function craterWorld(c) {
    return V3(c.along * W.runwayLength(runwayLevel), 0.2, W.RUNWAY_Z + c.off * 46);
  }

  function syncCraters(s, dt) {
    const ids = new Set(s.craters.map((c) => c.id));
    for (const [id, m] of craterMeshes) {
      if (!ids.has(id)) { scene.remove(m); m.geometry.dispose(); craterMeshes.delete(id); }
    }
    for (const c of s.craters) {
      let m = craterMeshes.get(c.id);
      if (!m) {
        m = MD.crater(3.6 + (c.along * 10 % 1 + 1) % 1 * 1.6);
        m.position.copy(craterWorld(c));
        scene.add(m);
        craterMeshes.set(c.id, m);
      }
      m.visible = true;
    }
    for (let i = scorch.length - 1; i >= 0; i--) {
      const sc = scorch[i];
      sc.life -= dt;
      sc.mesh.material.opacity = AF.clamp(sc.life / 30, 0, 1);
      if (sc.life <= 0) { scene.remove(sc.mesh); sc.mesh.geometry.dispose(); sc.mesh.material.dispose(); scorch.splice(i, 1); }
    }
  }

  // ---------- particles ----------
  const parts = [];
  function initParticles() {
    for (let i = 0; i < 420; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.smoke(), transparent: true, depthWrite: false, opacity: 0 }));
      sp.visible = false;
      scene.add(sp);
      parts.push({ sp, life: 0, max: 0, vel: V3(0, 0, 0), s0: 1, s1: 2, alpha: 0.5, drag: 0, additive: false });
    }
  }
  function emit(pos, o) {
    const p = parts.find((q) => !q.sp.visible);
    if (!p) return;
    p.sp.visible = true;
    p.sp.position.copy(pos);
    p.life = 0;
    p.max = o.life * (0.8 + Math.random() * 0.4);
    p.vel.set((Math.random() - 0.5) * o.spread, o.rise * (0.7 + Math.random() * 0.6), (Math.random() - 0.5) * o.spread);
    p.s0 = o.s0;
    p.s1 = o.s1;
    p.alpha = o.alpha;
    p.drag = o.drag || 0;
    p.sp.material.color.set(o.color);
    const additive = !!o.additive;
    if (p.additive !== additive) {
      p.additive = additive;
      p.sp.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
      p.sp.material.map = additive ? T.glow() : T.smoke();
      p.sp.material.needsUpdate = true;
    }
  }
  function updateParticles(dt) {
    for (const p of parts) {
      if (!p.sp.visible) continue;
      p.life += dt;
      const t = p.life / p.max;
      if (t >= 1) { p.sp.visible = false; continue; }
      p.vel.x += dt * 1.5; // drift downwind (east)
      if (p.drag) p.vel.multiplyScalar(Math.exp(-p.drag * dt));
      p.sp.position.addScaledVector(p.vel, dt);
      const s = p.s0 + (p.s1 - p.s0) * Math.sqrt(t);
      p.sp.scale.set(s, s, 1);
      p.sp.material.opacity = p.alpha * (1 - t) * Math.min(1, t * 8);
    }
  }
  const FX = {
    damage: { color: '#3a3a38', life: 4, rise: 2.2, spread: 0.6, s0: 1, s1: 6, alpha: 0.55 },
    chimney: { color: '#cfcfca', life: 6, rise: 1.4, spread: 0.4, s0: 0.8, s1: 5, alpha: 0.3 },
    dust: { color: '#a8956d', life: 1.8, rise: 0.8, spread: 2.5, s0: 1.5, s1: 7, alpha: 0.35 },
    burnSmoke: { color: '#2a2724', life: 7, rise: 5, spread: 1.5, s0: 3, s1: 14, alpha: 0.5 },
    fire: { color: '#ff8a2a', life: 0.9, rise: 3.5, spread: 1.6, s0: 2.2, s1: 0.8, alpha: 0.9, additive: true },
    flash: { color: '#ffe2a8', life: 0.45, rise: 0, spread: 0, s0: 10, s1: 34, alpha: 1, additive: true },
    blastFire: { color: '#ff7a1e', life: 1.3, rise: 9, spread: 14, s0: 4, s1: 2, alpha: 0.9, additive: true, drag: 1.5 },
    blastSmoke: { color: '#3b3630', life: 6, rise: 6, spread: 9, s0: 5, s1: 20, alpha: 0.6, drag: 0.6 },
    dirt: { color: '#6b5a40', life: 2.2, rise: 14, spread: 16, s0: 3, s1: 9, alpha: 0.7, drag: 1.2 },
    flak: { color: '#1f1e1c', life: 3.5, rise: 0.3, spread: 1, s0: 4, s1: 15, alpha: 0.75 },
    flakFlash: { color: '#ffd28a', life: 0.18, rise: 0, spread: 0, s0: 3, s1: 7, alpha: 1, additive: true },
    muzzle: { color: '#ffe0a0', life: 0.12, rise: 0, spread: 0, s0: 1.2, s1: 2.5, alpha: 1, additive: true },
  };
  R.FX = FX;

  function explode(pos, size = 1) {
    emit(V3(pos.x, pos.y + 3, pos.z), { ...FX.flash, s0: FX.flash.s0 * size, s1: FX.flash.s1 * size });
    for (let i = 0; i < 10; i++) emit(V3(pos.x, pos.y + 2, pos.z), FX.blastFire);
    for (let i = 0; i < 8; i++) emit(V3(pos.x, pos.y + 1, pos.z), FX.dirt);
    for (let i = 0; i < 10; i++) emit(V3(pos.x, pos.y + 4, pos.z), FX.blastSmoke);
    flashLight.position.set(pos.x, pos.y + 8, pos.z);
    flashLight.intensity = 60000 * size;
    const d = pos.distanceTo(ctl.target);
    if (d < 600) shake = Math.max(shake, 2.2 * size * (1 - d / 600));
  }

  // ---------- aircraft ----------
  function claimSlot(id) {
    let i = slots.indexOf(id);
    if (i >= 0) return i;
    i = slots.indexOf(null);
    if (i < 0) i = 0;
    slots[i] = id;
    return i;
  }

  function disposeView(id, v) {
    scene.remove(v.obj);
    MD.disposeTree(v.obj);
    removePickable(v.obj);
    if (v.crew) { scene.remove(v.crew); MD.disposeTree(v.crew); }
    if (v.tug) { scene.remove(v.tug); MD.disposeTree(v.tug); }
    const si = slots.indexOf(id);
    if (si >= 0) slots[si] = null;
    planes.delete(id);
  }

  function ensureViews(s) {
    const seen = new Set();
    for (const p of s.planes) {
      seen.add(p.id);
      let v = planes.get(p.id);
      if (!v) {
        const obj = MD.plane(p.type, p.code);
        obj.userData.pick = { kind: 'plane', id: p.id };
        scene.add(obj);
        pickables.push(obj);
        v = { id: p.id, obj, info: obj.userData.plane, anim: null, heading: Math.PI, pitch: 0, bank: 0, spin: 0, slot: claimSlot(p.id), restKey: null, crew: null, smokeT: 0 };
        v.pitch = v.info.attitude;
        planes.set(p.id, v);
      }
      v.data = p;
    }
    for (const [id, v] of planes) {
      if (seen.has(id) || v.wreck) continue;
      if (bombTargets().has(id)) { wreckPlane(v); continue; } // destroyed by a bomb: leave a burning wreck
      disposeView(id, v);
    }
  }

  function compilePath(pts) {
    const segs = [];
    let t = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = V3(pts[i][0], pts[i][1], pts[i][2]), b = V3(pts[i + 1][0], pts[i + 1][1], pts[i + 1][2]);
      const len = a.distanceTo(b);
      if (len < 0.01) continue;
      const v0 = pts[i][3], v1 = pts[i + 1][3];
      const dur = (2 * len) / Math.max(0.2, v0 + v1);
      segs.push({ a, b, dir: b.clone().sub(a).normalize(), len, v0, v1, t0: t, dur });
      t += dur;
    }
    const end = V3(...pts[pts.length - 1].slice(0, 3));
    return {
      total: t,
      sample(time) {
        if (!segs.length) return { pos: end.clone(), dir: V3(0, 0, 1), speed: 0, done: true };
        let sg = segs[segs.length - 1];
        for (const q of segs) if (time < q.t0 + q.dur) { sg = q; break; }
        const tau = AF.clamp(time - sg.t0, 0, sg.dur);
        const acc = (sg.v1 - sg.v0) / sg.dur;
        const d = Math.min(sg.len, sg.v0 * tau + 0.5 * acc * tau * tau);
        return { pos: sg.a.clone().addScaledVector(sg.dir, d), dir: sg.dir, speed: sg.v0 + acc * tau, done: time >= t };
      },
    };
  }

  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const approach = (cur, target, maxStep) => cur + AF.clamp(wrap(target - cur), -maxStep, maxStep);

  // Sortie paths. Speeds (4th value, m/s) shape the motion; the whole path is then stretched to fit
  // the sortie phase the simulation has scheduled in game time (AF.FLIGHT), so what you see always
  // matches the aircraft's status.
  function takeoffPath(st) {
    const RZ = W.RUNWAY_Z;
    return compilePath([
      [st.x, 0, st.z, 0], [st.x, 0, 58, 9], [0, 0, 63, 10], [0, 0, RZ - 12, 10], [10, 0, RZ, 6], [40, 0, RZ, 12],
      [300, 0, RZ, 42], [560, 22, RZ, 50], [900, 90, RZ + 110, 56], [1300, 180, RZ + 270, 60],
    ]);
  }

  function landingPath(slot) {
    const RZ = W.RUNWAY_Z;
    const p = compilePath([
      [-1500, 200, RZ, 62], [-600, 40, RZ, 50], [-340, 0, RZ, 42], [-60, 0, RZ, 9],
      [-12, 0, RZ - 2, 8], [0, 0, RZ - 14, 8], [0, 0, 64, 9], [slot.x, 0, 60, 6], [slot.x, 0, slot.z, 1],
    ]);
    p.pivot = 3;               // swing round to face the runway once parked
    p.finalHeading = Math.PI;
    return p;
  }

  const lerpAngle = (a, b, k) => a + wrap(b - a) * k;
  const headingOf = (d) => Math.atan2(-d.x, -d.z);

  // Pose an aircraft at fraction u (0..1) of a sortie path. Stateless: depends only on u, so it
  // stays correct through pauses, speed changes, reloads and fast-forward.
  function poseOnPath(v, path, kind, u, dt) {
    const pre = path.prePivot || 0;
    const total = pre + path.total + (path.pivot || 0);
    const tau = u * total - pre;
    const tm = AF.clamp(tau, 0, path.total);
    const smp = path.sample(tm);
    const ahead = (dtau) => {
      const a = path.sample(AF.clamp(tm + dtau - 0.8, 0, path.total)).pos;
      const b = path.sample(AF.clamp(tm + dtau + 0.8, 0, path.total)).pos;
      return b.sub(a);
    };
    const d = ahead(0);
    const horiz = Math.hypot(d.x, d.z);
    let heading = horiz > 0.05 ? headingOf(d) : v.heading;
    const ease = (k) => k * k * (3 - 2 * k);
    if (pre && tau < 0) {
      heading = lerpAngle(path.startHeading, headingOf(ahead(1)), ease(1 + tau / pre));
    } else if (path.pivot && tau > path.total) {
      const k = (tau - path.total) / path.pivot;
      heading = lerpAngle(headingOf(ahead(-1)), path.finalHeading, ease(k));
    }
    const airborne = smp.pos.y > 0.3;

    let pitch, bank = 0, elev = 0;
    const airPitch = Math.max(Math.atan2(d.y, Math.max(horiz, 0.01)) * 0.9 + 0.05, -0.04);
    const d1 = ahead(-1.5), d2 = ahead(1.5);
    const turnRate = Math.hypot(d1.x, d1.z) > 0.05 && Math.hypot(d2.x, d2.z) > 0.05 ? wrap(headingOf(d2) - headingOf(d1)) / 3 : 0;
    if (airborne) bank = AF.clamp(turnRate * 1.4, -0.7, 0.7);
    if (kind === 'takeoff') {
      const tailUp = AF.clamp((smp.speed - 14) / 14, 0, 1);
      pitch = airborne ? airPitch : v.info.attitude * (1 - tailUp);
      elev = airborne ? 0.12 : smp.speed > 4 ? -0.25 * tailUp : 0.2; // stick back to start, forward to lift the tail
    } else {
      pitch = v.info.attitude + (airPitch - v.info.attitude) * AF.clamp(smp.pos.y / 4, 0, 1); // flare onto three points
      elev = kind === 'tow' ? 0 : smp.pos.y < 6 ? 0.32 : 0.05;
    }
    // control surfaces follow what the pilot is doing
    v.ctl = { r: AF.clamp(turnRate * 3, -0.45, 0.45), e: elev, a: AF.clamp(-bank * 0.5 - turnRate * 0.4, -0.35, 0.35) };
    v.heading = heading;
    v.pitch = pitch;
    v.bank = bank;
    if (v.info.gear) v.info.gear.visible = kind === 'takeoff' ? smp.pos.y < 8 : smp.pos.y < 150;
    v.spin = kind === 'tow' || tau >= path.total ? Math.max(0, v.spin - dt * 25) : smp.speed > 12 || airborne ? 75 : 30;

    if (!airborne && smp.speed > 15 && runwayLevel === 1 && dt > 0) {
      v.dustT = (v.dustT || 0) - dt;
      if (v.dustT <= 0) {
        v.dustT = 0.07;
        emit(V3(smp.pos.x - Math.sin(heading) * 4, 0.5, smp.pos.z - Math.cos(heading) * 4), FX.dust);
      }
    }
    pose(v, smp.pos, airborne);
  }

  function bayPos(i) {
    const hb = buildings.hangar;
    const bays = (hb && hb.meta.bays) || [V3(0, 0, 0)];
    return bays[AF.clamp(i || 0, 0, bays.length - 1)].clone().add(hb ? hb.group.position : V3(-75, 0, -28));
  }

  // Tows between dispersal and a hangar bay. Inbound and outbound use separate lanes across the
  // front of the hangar, and the simulation books the doors, so tows never meet head-on.
  function towPath(p, v) {
    const slot = W.slot(v.slot), bay = bayPos(p.bay);
    if (p.towTo === 'bay') {
      const path = compilePath([[slot.x, 0, slot.z, 0], [slot.x, 0, 11, 3], [bay.x, 0, 11, 3], [bay.x, 0, bay.z, 0.5]]);
      path.prePivot = 4;       // swing round from facing the runway before moving off
      path.startHeading = Math.PI;
      path.pivot = 4;          // and face the doors once inside
      path.finalHeading = Math.PI;
      return path;
    }
    return compilePath([[bay.x, 0, bay.z, 0], [bay.x, 0, 24, 3], [slot.x, 0, 24, 3], [slot.x, 0, slot.z, 0.5]]);
  }

  function restFor(s, p, v) {
    if (p.status === 'repair' && p.bay != null) return { key: 'bay' + p.bay, pos: bayPos(p.bay), heading: Math.PI };
    return { key: 'slot', pos: W.slot(v.slot), heading: Math.PI };
  }

  function pose(v, pos, airborne) {
    const off = v.info.offset(airborne ? 0 : v.pitch);
    v.obj.position.set(pos.x, pos.y + off, pos.z);
    v.obj.rotation.set(v.pitch, v.heading, v.bank);
  }

  function spinProps(v, dt) {
    for (const pr of v.info.props) {
      pr.hub.rotation.z += v.spin * dt;
      const fast = v.spin > 40;
      pr.blades.visible = !fast;
      pr.disc.visible = fast;
    }
  }

  // Ground crew around a parked aircraft: refuelling (bowser), waiting for the hangar, or at
  // readiness (starter trolley plugged in, a fitter standing by).
  function crewFor(v) {
    if (v.crew) return v.crew;
    const g = new THREE.Group();
    const bowser = MD.truck('bowser');
    bowser.position.set(v.info.span / 2 + 4, 0, -1);
    bowser.rotation.y = Math.PI;
    bowser.name = 'bowser';
    g.add(bowser);
    const a = MD.figure();
    a.position.set(v.info.span * 0.25, 0, -2.6);
    a.rotation.y = 2.4;
    a.name = 'rigger';
    const b = MD.figure('#3f4b5e');
    b.position.set(v.info.span / 2 + 1.6, 0, -0.5);
    b.rotation.y = -1.2;
    b.name = 'fueller';
    const c = MD.figure('#5a5340');
    c.position.set(-1.5, 0, -3.2);
    c.rotation.y = 0.4;
    c.name = 'fitter';
    g.add(a, b, c);
    // crew space: the aircraft's nose points along +z, its starboard side is -x
    const trolley = MD.trolleyAcc();
    trolley.position.set(-2.3, 0, v.info.len * 0.22);
    trolley.rotation.y = 0.25;
    trolley.name = 'trolley';
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 5), MD.mat.black());
    cable.position.set(-1.35, 0.5, v.info.len * 0.2);
    cable.rotation.z = Math.PI / 2 + 0.35;
    cable.name = 'cable';
    const ready = MD.figure('#3f4b5e');
    ready.position.set(-2.9, 0, v.info.len * 0.22 + 1.1);
    ready.rotation.y = -2.2;
    ready.name = 'readyman';
    g.add(trolley, cable, ready);
    scene.add(g);
    v.crew = g;
    return g;
  }

  // Aircraft tractor and tow bar, created the first time an aircraft is towed.
  function tugFor(v) {
    if (v.tug) return v.tug;
    const g = new THREE.Group();
    const t = MD.tractor();
    t.name = 'tractor';
    g.add(t);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 6), MD.mat.metal('#4a4b46'));
    bar.name = 'bar';
    g.add(bar);
    scene.add(g);
    v.tug = g;
    return g;
  }

  function placeTug(v) {
    const tug = tugFor(v);
    tug.visible = true;
    const h = v.heading, fx = -Math.sin(h), fz = -Math.cos(h);
    const p = v.obj.position;
    const lead = v.info.len * 0.5 + 3.2;
    const t = tug.getObjectByName('tractor');
    t.position.set(p.x + fx * lead, 0, p.z + fz * lead);
    t.rotation.y = h;
    const a = V3(t.position.x - fx * 2.4, 0.42, t.position.z - fz * 2.4); // hitch
    const b = V3(p.x + fx * v.info.len * 0.25, 0.42, p.z + fz * v.info.len * 0.25); // towing arm on the main gear
    const bar = tug.getObjectByName('bar');
    bar.position.copy(a).add(b).multiplyScalar(0.5);
    bar.scale.y = Math.max(0.1, a.distanceTo(b));
    bar.quaternion.setFromUnitVectors(V3(0, 1, 0), b.clone().sub(a).normalize());
  }

  // Pilots resting at the dispersal hut, in deckchairs.
  let loungers = null;
  function updateDispersal(s) {
    if (!statics.chairs) return;
    if (!loungers) {
      loungers = statics.chairs.map((c) => {
        const f = MD.figure(AF.pick(['#4f5c70', '#56627a', '#4a5568']), 'sit');
        f.position.copy(c.pos).add(V3(Math.sin(c.rot) * 0.12, -0.04, Math.cos(c.rot) * 0.12)); // settled back into the canvas
        f.rotation.y = c.rot;
        f.visible = false;
        scene.add(f);
        return f;
      });
    }
    const inCockpit = new Set(s.planes.filter((p) => AF.sim.atReadiness(s, p)).map((p) => p.pilotId));
    const n = Math.min(loungers.length, s.pilots.filter((p) => p.status === 'available' && !inCockpit.has(p.id)).length);
    loungers.forEach((f, i) => { f.visible = i < n; });
  }

  function updatePlanes(s, dt, gt) {
    for (const [id, v] of planes) {
      if (v.wreck) {
        v.smokeT -= dt;
        if (v.smokeT <= 0) {
          v.smokeT = 0.12;
          const p = v.obj.position;
          if (clock < v.wreck.fireUntil) emit(V3(p.x + (Math.random() - 0.5) * 4, 1, p.z + (Math.random() - 0.5) * 4), FX.fire);
          emit(V3(p.x, 2, p.z), FX.burnSmoke);
        }
        if (clock > v.wreck.until) disposeView(id, v);
        continue;
      }
      const p = v.data;
      let atRest = false, crewed = false;
      v.moving = false;
      v.ctl = null;
      if (p.status === 'taxiing' || p.status === 'landing' || p.status === 'towing') {
        crewed = p.status !== 'towing';
        // sortie and tow phases follow the simulation's schedule exactly
        const kind = p.status === 'taxiing' ? 'takeoff' : p.status === 'landing' ? 'landing' : 'tow';
        const key = kind + ':' + (p.towTo || '') + ':' + p.phaseStart;
        if (v.pathKey !== key) {
          v.pathKey = key;
          v.path = kind === 'takeoff' ? takeoffPath(W.slot(v.slot)) : kind === 'landing' ? landingPath(W.slot(v.slot)) : towPath(p, v);
        }
        const u = (gt - p.phaseStart) / Math.max(1, p.phaseEnd - p.phaseStart);
        if (u < 0 && kind === 'tow') {
          // waiting for the hangar doors to clear
          v.obj.visible = true;
          poseOnPath(v, v.path, kind, 0, dt);
        } else if (u < 0 && kind === 'takeoff') {
          // waiting its turn at dispersal, engine running
          v.obj.visible = true;
          v.heading = Math.PI;
          v.pitch = v.info.attitude;
          v.bank = 0;
          v.spin = 28;
          pose(v, W.slot(v.slot), false);
        } else if (u < 0) {
          v.obj.visible = false; // still in the circuit, out of sight
        } else {
          v.obj.visible = true;
          v.moving = true;
          poseOnPath(v, v.path, kind, AF.clamp(u, 0, 1), dt);
        }
      } else if (p.status === 'flying') {
        v.obj.visible = false;
      } else {
        const rest = restFor(s, p, v);
        v.obj.visible = true;
        v.heading = rest.heading;
        v.pitch = v.info.attitude;
        v.bank = 0;
        v.spin = Math.max(0, v.spin - dt * 25);
        if (v.info.gear) v.info.gear.visible = true;
        pose(v, rest.pos, false);
        atRest = true;
      }
      spinProps(v, dt);

      // pilot aboard while moving under power, or waiting in the cockpit at readiness
      const ready = atRest && AF.sim.atReadiness(s, p);
      if (v.info.pilot) v.info.pilot.visible = crewed || ready;
      // control surfaces ease toward what the pilot is doing (elevators droop when parked)
      const want = v.ctl || { r: 0, e: crewed ? 0 : -0.12, a: 0 };
      const cur = v.ctlNow || (v.ctlNow = { r: 0, e: -0.12, a: 0 });
      const k = Math.min(1, dt * 3);
      cur.r += (want.r - cur.r) * k;
      cur.e += (want.e - cur.e) * k;
      cur.a += (want.a - cur.a) * k;
      if (v.obj.visible && v.info.setControls) v.info.setControls(cur.r, cur.e, cur.a);

      const showCrew = atRest && (p.status === 'turnaround' || p.status === 'queued' || ready);
      if (showCrew || v.crew) {
        const crew = crewFor(v);
        crew.visible = showCrew;
        if (showCrew) {
          crew.position.copy(v.obj.position).setY(0);
          crew.rotation.y = v.heading - Math.PI;
          const fuel = p.status === 'turnaround';
          crew.getObjectByName('bowser').visible = fuel;
          crew.getObjectByName('fueller').visible = fuel;
          crew.getObjectByName('rigger').visible = !ready;
          crew.getObjectByName('fitter').visible = !ready;
          for (const n of ['trolley', 'cable', 'readyman']) crew.getObjectByName(n).visible = ready;
        }
      }
      // towed by a tractor between dispersal and the hangar
      const towed = p.status === 'towing' && v.obj.visible;
      if (towed) placeTug(v);
      else if (v.tug) v.tug.visible = false;

      if (v.obj.visible && p.condition < 50 && p.status !== 'flying') {
        v.smokeT -= dt;
        if (v.smokeT <= 0) {
          v.smokeT = 0.3;
          emit(v.obj.localToWorld(v.info.smoke.clone()), FX.damage);
        }
      }
    }
  }

  function wreckPlane(v) {
    if (v.crew) v.crew.visible = false;
    if (v.tug) v.tug.visible = false;
    MD.wreck(v.obj);
    removePickable(v.obj);
    v.wreck = { until: clock + 90, fireUntil: clock + 40 };
    v.smokeT = 0;
  }

  // ---------- air raids ----------
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Build the raid visuals from the plan the simulation made when the formation came into sight
  // (s.raid in state 'attacking'). The timeline runs on game time: t = game minutes since the
  // formation appeared, shown as seconds. Kills and bomb impacts happen at the very minutes the
  // simulation applies them.
  function startRaid(r, s) {
    const approach = r.arriveAt - r.startAt;
    const reaching = Math.max(1, r.bombers - r.turnedBack);
    const n = Math.min(12, reaching);
    const order = shuffle([...Array(n).keys()]);
    const downAt = {};
    const fkTimes = r.fighterKillTimes.slice(0, n);
    const akTimes = r.aaKillTimes.slice(0, Math.max(0, n - fkTimes.length));
    fkTimes.forEach((at, k) => { downAt[order[k]] = at - r.startAt; });
    akTimes.forEach((at, k) => { downAt[order[fkTimes.length + k]] = at - r.startAt; });

    const dir = V3(-0.72, 0, -0.69).normalize(); // in from the Channel (south-east), out to the north-west
    const right = V3(-dir.z, 0, dir.x);
    const speed = 95;
    const start = V3(0, 0, 40).addScaledVector(dir, -speed * approach); // overhead the field at arriveAt
    const alt = r.night ? 150 : 175;

    const letters = 'ABCDEFGHKLMNPRS';
    const members = [];
    for (let i = 0; i < n; i++) {
      const row = Math.floor((i + 1) / 2), side = i === 0 ? 0 : i % 2 ? 1 : -1;
      const obj = MD.plane('he111', `1H+${letters[i % letters.length]}K`, { lite: true });
      if (obj.userData.plane.gear) obj.userData.plane.gear.visible = false;
      scene.add(obj);
      members.push({ obj, lat: side * row * 30, back: row * 28, dy: AF.rand(-8, 8), downAt: downAt[i], side: side || 1 });
    }
    const escorts = [];
    for (let i = 0; i < Math.min(6, r.escorts); i++) {
      const obj = MD.plane('bf109', `<+${i}`, { lite: true });
      if (obj.userData.plane.gear) obj.userData.plane.gear.visible = false;
      scene.add(obj);
      escorts.push({ obj, lat: AF.rand(-140, 140), back: AF.rand(-80, 90), dy: 70 + AF.rand(0, 50), ph: Math.random() * 6 });
    }
    const interceptors = [];
    (r.interceptors || []).slice(0, 4).forEach((type, i) => {
      const obj = MD.plane(type, 'TF-' + (i + 1), { lite: true });
      if (obj.userData.plane.gear) obj.userData.plane.gear.visible = false;
      obj.visible = false;
      scene.add(obj);
      interceptors.push({ obj, i });
    });

    const survivors = [...Array(n).keys()].filter((i) => downAt[i] === undefined);
    const F = W.FIELD;
    const bombs = r.hits.map((h) => {
      let tp = null;
      if (h.kind === 'runway') tp = craterWorld(h);
      else if (h.kind === 'building') {
        const rec = buildings[h.id];
        const fp = rec ? rec.meta.footprint : { w: 20, d: 20 };
        tp = (rec ? rec.anchor.clone() : V3(0, 0, 0)).add(V3(AF.rand(-0.3, 0.3) * Math.min(fp.w, 60), 0, AF.rand(-0.3, 0.3) * Math.min(fp.d, 60)));
      } else if (h.kind === 'miss') {
        tp = V3(AF.rand(F.x0 * 0.6, F.x1 * 0.6), 0, AF.rand(F.z0 * 0.8, F.z1 * 0.8));
      } // aircraft targets are aimed at their position when the bomb is released
      const impact = h.at - r.startAt;
      return { hit: h, tp, impact, release: impact - 4.5, member: survivors.length ? AF.pick(survivors) : 0, mesh: null, from: null, done: false };
    });

    // searchlight beams for night raids
    const beams = [];
    const def = buildings.defenses;
    if (r.night && def && def.meta.searchlights) {
      for (const lp of def.meta.searchlights) {
        const geo = new THREE.CylinderGeometry(22, 0.6, 900, 20, 1, true);
        geo.translate(0, 450, 0);
        const beam = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
          color: '#fff3cf', transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
        }));
        beam.position.copy(lp);
        scene.add(beam);
        beams.push({ beam, ph: Math.random() * 6 });
      }
    }

    raids.push({
      id: r.id, t0: r.startAt, t: 0, start, dir, right, speed, alt, members, escorts, interceptors, bombs, beams,
      tCenter: approach, end: approach * 2 + 14, flakT: 0, aaLvl: AF.sim.lvl(s, 'defenses'),
      guns: def && def.meta.guns ? def.meta.guns : [],
    });
  }

  // Aircraft ids targeted by bombs in raids still on screen (so a destroyed one becomes a wreck).
  function bombTargets() {
    const ids = new Set();
    for (const r of raids) for (const b of r.bombs) if (b.hit.kind === 'plane' || b.hit.destroyed) ids.add(b.hit.id);
    return ids;
  }

  const UP = V3(0, 1, 0);
  function updateRaid(raid, dt, gt) {
    raid.t = gt - raid.t0;
    const t = raid.t;
    const heading = Math.atan2(-raid.dir.x, -raid.dir.z);
    const center = raid.start.clone().addScaledVector(raid.dir, raid.speed * t).setY(raid.alt);
    const alive = [];

    for (const m of raid.members) {
      if (!m.obj.visible) continue;
      if (m.downAt !== undefined && t > m.downAt) {
        if (!m.fall) m.fall = { p0: m.obj.position.clone(), t0: t };
        const ft = t - m.fall.t0;
        m.obj.position.copy(m.fall.p0).addScaledVector(raid.dir, raid.speed * 0.75 * ft).addScaledVector(raid.right, m.side * ft * 9);
        m.obj.position.y = m.fall.p0.y - 2.6 * ft * ft;
        m.obj.rotation.set(-Math.min(0.9, ft * 0.12), heading, m.side * ft * 0.5);
        m.fxT = (m.fxT || 0) - dt;
        if (m.fxT <= 0) {
          m.fxT = 0.06;
          emit(m.obj.position, FX.fire);
          emit(m.obj.position, { ...FX.burnSmoke, life: 5, rise: 1 });
        }
        if (m.obj.position.y <= 1) {
          m.obj.visible = false;
          if (m.obj.position.length() < 3000) explode(m.obj.position.clone().setY(0), 1.3);
        }
        continue;
      }
      m.obj.position.copy(center).addScaledVector(raid.right, m.lat).addScaledVector(raid.dir, -m.back);
      m.obj.position.y += m.dy + Math.sin(t * 0.7 + m.lat) * 1.5;
      m.obj.rotation.set(0, heading, Math.sin(t * 0.5 + m.back) * 0.03);
      for (const pr of m.obj.userData.plane.props) { pr.blades.visible = false; pr.disc.visible = true; }
      alive.push(m);
    }

    for (const e of raid.escorts) {
      const w = Math.sin(t * 0.6 + e.ph);
      e.obj.position.copy(center).addScaledVector(raid.right, e.lat + w * 60).addScaledVector(raid.dir, -e.back);
      e.obj.position.y += e.dy + Math.cos(t * 0.9 + e.ph) * 15;
      e.obj.rotation.set(0, heading - w * 0.25, -Math.cos(t * 0.6 + e.ph) * 0.6);
      for (const pr of e.obj.userData.plane.props) { pr.blades.visible = false; pr.disc.visible = true; }
    }

    // RAF interceptors harry the formation, then break away
    for (const f of raid.interceptors) {
      const active = t > raid.tCenter - 22 && t < raid.tCenter + 6;
      f.obj.visible = active;
      if (!active) continue;
      const k = t * 0.9 + f.i * 1.7;
      f.obj.position.copy(center).addScaledVector(raid.dir, -60 - f.i * 30 + Math.sin(k * 0.7) * 40)
        .addScaledVector(raid.right, Math.sin(k) * 90);
      f.obj.position.y += 20 + Math.sin(k * 1.3) * 25;
      f.obj.rotation.set(Math.cos(k * 1.3) * 0.3, heading + Math.cos(k) * 0.4, -Math.cos(k) * 0.9);
      for (const pr of f.obj.userData.plane.props) { pr.blades.visible = false; pr.disc.visible = true; }
    }

    // flak bursts and gun flashes
    if (raid.aaLvl > 0 && alive.length && center.clone().setY(0).length() < 1500) {
      raid.flakT -= dt;
      if (raid.flakT <= 0) {
        raid.flakT = 0.45 / raid.aaLvl + Math.random() * 0.25;
        const m = AF.pick(alive);
        const at = m.obj.position.clone().add(V3(AF.rand(-45, 45), AF.rand(-25, 30), AF.rand(-45, 45)));
        emit(at, FX.flak);
        emit(at, FX.flakFlash);
        if (raid.guns.length) emit(AF.pick(raid.guns), FX.muzzle);
      }
    }

    const near = center.clone().setY(0).length();
    for (const b of raid.beams) {
      b.beam.visible = near < 1800;
      const aim = center.clone().add(V3(Math.sin(t * 0.4 + b.ph) * 120, 0, Math.cos(t * 0.3 + b.ph) * 120)).sub(b.beam.position);
      aim.y = Math.max(aim.y, Math.hypot(aim.x, aim.z) * 0.55); // keep beams pointing up into the sky
      b.beam.quaternion.setFromUnitVectors(UP, aim.normalize());
    }

    // bombs
    for (const b of raid.bombs) {
      if (b.done) continue;
      if (!b.tp && t >= b.release - 0.5) {
        const v = planes.get(b.hit.id); // aim at where the aircraft is now
        b.tp = v ? v.obj.position.clone().setY(0) : V3(0, 0, 40);
      }
      if (t >= b.release && !b.mesh && t < b.impact) {
        const m = raid.members[b.member];
        b.from = m && m.obj.visible ? m.obj.position.clone() : center.clone();
        b.mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.12, 1.2, 8), MD.mat.black());
        scene.add(b.mesh);
      }
      if (b.mesh && t < b.impact) {
        const u = AF.clamp((t - b.release) / (b.impact - b.release), 0, 1);
        b.mesh.position.set(
          b.from.x + (b.tp.x - b.from.x) * u,
          b.from.y * (1 - u * u) + b.tp.y * u * u,
          b.from.z + (b.tp.z - b.from.z) * u
        );
        b.mesh.rotation.set(Math.PI / 2 - u * 1.2, heading, 0);
      }
      if (t >= b.impact) landBomb(b);
    }

    if (t > raid.end && !raid.members.some((m) => m.fall && m.obj.visible)) {
      for (const b of raid.bombs) landBomb(b);
      for (const list of [raid.members, raid.escorts, raid.interceptors]) {
        for (const m of list) { scene.remove(m.obj); MD.disposeTree(m.obj); }
      }
      for (const b of raid.beams) { scene.remove(b.beam); b.beam.geometry.dispose(); b.beam.material.dispose(); }
      return true;
    }
    return false;
  }

  function landBomb(b) {
    if (b.done) return;
    b.done = true;
    if (b.mesh) { scene.remove(b.mesh); b.mesh.geometry.dispose(); }
    const h = b.hit;
    if (!b.tp) b.tp = V3(0, 0, 40);
    explode(b.tp, h.kind === 'building' || h.destroyed ? 1.3 : 1);
    // The simulation applies the damage in this same game minute: craters appear, buildings burn,
    // and a destroyed aircraft is removed (ensureViews then turns it into a wreck).
    if (h.destroyed) {
      const v = planes.get(h.id);
      if (v && !v.wreck) wreckPlane(v);
    } else if (h.kind === 'miss') {
      const m = MD.crater(3 + Math.random() * 2);
      m.material = m.material.clone();
      m.position.set(b.tp.x, 0.21, b.tp.z);
      scene.add(m);
      scorch.push({ mesh: m, life: 240 });
    }
  }

  // Raids, sorties and tows are all read straight from game state; nothing is queued as an event.
  function syncRaids(s, dt, gt) {
    AF.fx.length = 0;
    const r = s.raid;
    if (r && r.state === 'attacking' && !raids.some((x) => x.id === r.id)) startRaid(r, s);
    for (let i = raids.length - 1; i >= 0; i--) if (updateRaid(raids[i], dt, gt)) raids.splice(i, 1);
  }

  // ---------- ambience ----------
  let chimneyT = 0, fireT = 0;
  function ambient(s, dt, now) {
    const t = now / 1000;
    if (statics.windsock) {
      statics.windsock.rotation.y = Math.PI + Math.sin(t * 0.6) * 0.18;
      statics.windsock.rotation.z = -0.12 + Math.sin(t * 1.7) * 0.05;
    }
    const tw = buildings.tower;
    if (tw && tw.meta.flag) {
      const pos = tw.meta.flag.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        pos.setZ(i, Math.sin(x * 2.4 - t * 5) * 0.18 * ((x + 1.3) / 2.6));
      }
      pos.needsUpdate = true;
    }
    chimneyT -= dt;
    if (chimneyT <= 0) {
      chimneyT = 0.5;
      for (const id of ['mess', 'enlisted', 'officers']) {
        const rec = buildings[id];
        if (rec && rec.meta.smoke) emit(rec.meta.smoke.clone().add(rec.group.position), FX.chimney);
      }
    }
    // bomb-damaged buildings smoke, and burn when put out of action
    fireT -= dt;
    if (fireT <= 0) {
      fireT = 0.2;
      for (const id in buildings) {
        const dmg = s.buildings[id].damage || 0;
        if (!dmg) continue;
        const rec = buildings[id];
        const fp = rec.meta.footprint;
        const at = rec.anchor.clone().add(V3(AF.rand(-0.25, 0.25) * Math.min(fp.w, 50), (rec.meta.labelY || 8) * 0.5, AF.rand(-0.25, 0.25) * Math.min(fp.d, 50)));
        emit(at, dmg >= 50 ? FX.burnSmoke : FX.damage);
        if (dmg >= 50) emit(at, FX.fire);
      }
    }
    flashLight.intensity *= Math.exp(-dt * 9);
  }

  // ---------- selection rings & labels ----------
  function placeRing(ring, h, now) {
    ring.visible = false;
    if (!h) return;
    let pos, radius;
    if (h.kind === 'building') {
      const rec = buildings[h.id];
      if (!rec || rec.hidden) return;
      const fp = rec.meta.footprint;
      pos = rec.anchor;
      radius = Math.max(fp.w, fp.d) * 0.62;
    } else {
      const v = planes.get(h.id);
      if (!v || !v.obj.visible || v.obj.position.y > 4 || v.wreck) return;
      pos = v.obj.position;
      radius = v.info.span * 0.62;
    }
    ring.visible = true;
    ring.position.set(pos.x, 0.3, pos.z);
    ring.scale.setScalar(radius);
    ring.material.opacity = ring.userData.baseOpacity * (0.75 + 0.25 * Math.sin(now / 250));
  }

  function selectedHit() {
    const sel = R.selected;
    if (sel.plane) return { kind: 'plane', id: sel.plane };
    if (sel.building) return { kind: 'building', id: sel.building };
    return null;
  }

  const proj = new THREE.Vector3();
  function updateLabels() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    for (const id in buildings) {
      const rec = buildings[id];
      const el = rec.label;
      proj.copy(rec.anchor).setY(rec.meta.labelY || 8);
      const dist = proj.distanceTo(camera.position);
      proj.project(camera);
      if (rec.hidden || proj.z > 1 || dist > 1300 || Math.abs(proj.x) > 1.1 || Math.abs(proj.y) > 1.1) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.transform = `translate(${((proj.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-proj.y * 0.5 + 0.5) * h).toFixed(1)}px) translate(-50%, -100%)`;
      el.style.opacity = String(AF.clamp(1.4 - dist / 900, 0.35, 1));
      el.classList.toggle('selected', R.selected.building === id);
    }
  }

  // ---------- frame ----------
  R.draw = function (s, now) {
    const dtReal = AF.clamp((now - lastNow) / 1000 || 0, 0, 0.1);
    lastNow = now;

    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (cw && ch && (cw !== lastW || ch !== lastH)) {
      renderer.setSize(cw, ch, false);
      camera.aspect = cw / ch;
      camera.updateProjectionMatrix();
      lastW = cw;
      lastH = ch;
    }

    // Everything animates on game time: one game minute plays as one second of animation, so
    // movement pauses and fast-forwards with the clock and always matches the simulation.
    const gt = AF.gameTime ?? s.time;
    const jump = visTime === null || gt < visTime || gt - visTime > 30; // new game, load, or big skip
    const dt = jump ? 0 : Math.min(1, gt - visTime);
    visTime = gt;
    clock += dt;

    syncBuildings(s);
    syncRaids(s, dt, gt); // before ensureViews, so aircraft destroyed by a bomb become wrecks
    ensureViews(s);
    updatePlanes(s, dt, gt);
    updateDispersal(s);
    syncCraters(s, dt);
    updateControls(dtReal);
    env.update(visTime, ctl.target, ctl.radius, dt);
    env.follow(camera);
    ambient(s, dt, now);
    updateParticles(dt);

    const sh = selectedHit();
    placeRing(selectRing, sh && sh.id !== 'runway' ? sh : null, now);
    const hv = R.hover;
    placeRing(hoverRing, hv && !(sh && sh.kind === hv.kind && sh.id === hv.id) && hv.id !== 'runway' ? hv : null, now);

    renderer.render(scene, camera);
    updateLabels();
  };

  R.raidActive = () => raids.length > 0;
})(window.AF);
