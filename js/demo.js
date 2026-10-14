// The demo station that plays behind the title menu: a well-built station with a full flight
// line, run by a director that keeps something happening — sorties taxiing out and landing,
// raids coming in (fighters scrambling, guns firing, bombs falling), aircraft being towed to the
// hangar and refuelled, and buildings going up. It is never saved.
(function (AF) {
  'use strict';

  const S = AF.sim;
  const D = (AF.demo = {
    speed: 2.5, // game minutes per real second
  });

  const FLEET = ['spitfire', 'spitfire', 'hurricane', 'hurricane', 'spitfire', 'blenheim', 'lysander', 'tigermoth'];
  const BUILDS = { mess: 150, tower: 200, officers: 180 }; // under construction, and how long each pass takes

  D.create = function () {
    const s = AF.newGame();
    s.demo = true;
    s.log = [];
    s.time = 20 * 1440 + 8 * 60 + 40; // a summer morning, three weeks in
    s.speed = 1;
    s.rep = 90;
    s.settings = { pauseOnRaid: false, pauseOnRadio: false };
    s.autoRepair = true;
    const lv = { runway: 2, hangar: 3, officers: 2, enlisted: 3, fuelDepot: 2, mess: 0, tower: 1, defenses: 3, pens: 2 };
    for (const id of AF.BUILDING_ORDER) s.buildings[id] = { level: lv[id] };
    s.enlisted = { mechanics: 10, groundCrew: 12 };
    s.planes = [];
    s.pilots = [];
    s.missions = [];
    s.recruits = [];
    for (const t of FLEET) s.planes.push(AF.makePlane(s, t));
    for (let i = 0; i < 11; i++) s.pilots.push(AF.makePilot(s, AF.rand(2, 4)));
    S.autoAssign(s);
    s.planes[0].readiness = true;
    s.planes[4].readiness = true;
    for (const [id, len] of Object.entries(BUILDS)) {
      const start = s.time - Math.round(len * AF.rand(0.1, 0.6));
      s.buildings[id].upgrading = { startAt: start, finishAt: start + len };
    }
    // set the scene: one fighter refuelling, the Blenheim on its way into the hangar
    const h = s.planes[2];
    h.status = 'turnaround';
    h.readyAt = s.time + 25;
    s.planes[5].condition = 48;
    S.queueRepair(s, s.planes[5].id);
    s.demoCtl = { nextRaid: s.time + 14, nextSortie: s.time + 2, nextTow: s.time + 50, lastTime: s.time, cleaned: null };
    return s;
  };

  // A short local sortie, so aircraft are always taxiing out or coming back in.
  function sortie(s) {
    const free = s.planes.filter((p) => !S.flyBlocker(s, p) && !p.readiness);
    const fighters = free.filter((p) => AF.PLANE_TYPES[p.type].role === 'Fighter');
    const others = free.filter((p) => AF.PLANE_TYPES[p.type].role !== 'Fighter');
    let go;
    if (fighters.length >= 3 && Math.random() < 0.5) go = fighters.slice(0, 2); // keep some back for raids
    else if (others.length) go = [AF.pick(others)];
    if (!go || !go.length) return;
    const t = AF.pick(AF.MISSION_TYPES.filter((x) => x.stat !== 'none'));
    const m = {
      id: 'm' + s.nextId++, typeId: t.id, name: t.name, place: AF.pick(t.places), stat: 'none', requiresRole: null,
      difficulty: 1, risk: 0.04, funds: 0, rep: 0, xp: 0, kills: 0, hours: AF.rand(0.4, 0.9), minPlanes: 1, maxPlanes: 6, expiresAt: Infinity,
    };
    S.dispatch(s, m, go);
  }

  // Keep the show going. Returns 'restart' when the day is done and the demo should start over.
  D.tick = function (s) {
    const c = s.demoCtl;
    const mins = Math.max(0, s.time - c.lastTime);
    c.lastTime = s.time;
    s.funds = 1e7;
    s.fuel = S.fuelCap(s);
    s.parts = 500;
    s.morale = 80;
    for (const p of s.pilots) p.fatigue = Math.min(p.fatigue, 25);
    if (s.radio) S.answerRadio(s, AF.randInt(0, s.radio.choices.length - 1));
    if ((s.time % 1440) / 60 >= 19) return 'restart';

    // raids, one every half minute or so of real time
    const r = s.raid;
    const busy = AF.view && AF.view.raidActive && AF.view.raidActive();
    if (!r && !busy && s.time >= c.nextRaid) {
      s.raid = {
        id: 'r' + s.nextId++, state: 'scheduled', detectAt: s.time + 1, arriveAt: s.time + 27,
        bombers: AF.randInt(9, 12), escorts: AF.randInt(4, 6), night: false, type: AF.pick(AF.RAID.bomberTypes), scrambled: 0,
      };
    }
    // send up two fighters: enough for a dogfight, few enough that bombs still reach the field
    if (r && r.state === 'inbound' && !r.scrambled && !S.scrambleBlocker(s)) S.scramble(s, S.scrambleCandidates(s).slice(0, 2).map((p) => p.id));
    if (r) c.nextRaid = Math.max(c.nextRaid, (r.endAt || r.arriveAt + 5) + AF.randInt(35, 55));

    // after the raid, the works department tidies up (much faster than in a real game)
    if (s.lastRaid && c.cleaned !== s.lastRaid.at && s.time - s.lastRaid.at > 20) {
      c.cleaned = s.lastRaid.at;
      s.craters = [];
      s.craterWork = 0;
      for (const id of AF.BUILDING_ORDER) s.buildings[id].damage = 0;
    }

    // replace losses
    if (!s.raid && s.planes.length < FLEET.length) {
      const need = {};
      for (const t of FLEET) need[t] = (need[t] || 0) + 1;
      for (const p of s.planes) need[p.type]--;
      const want = Object.keys(need).find((t) => need[t] > 0);
      if (want) S.buyPlane(s, want);
    }
    while (s.pilots.length < 11) s.pilots.push(AF.makePilot(s, AF.rand(2, 4)));
    if (s.planes.some((p) => !p.pilotId)) S.autoAssign(s);

    // sorties between raids
    if (!s.raid && s.time >= c.nextSortie && !S.runwayBlocker(s)) {
      sortie(s);
      c.nextSortie = s.time + AF.randInt(10, 22);
    }

    // send something to the hangar now and then, so there's towing to watch, and hurry repairs
    if (s.time >= c.nextTow) {
      c.nextTow = s.time + AF.randInt(35, 60);
      const cand = s.planes.filter((p) => p.status === 'ready' && !p.readiness && !S.isAway(p));
      if (cand.length > 2 && s.repairQueue.length < 2) {
        const p = AF.pick(cand);
        p.condition = AF.randInt(40, 55);
        S.queueRepair(s, p.id);
      }
    }
    for (const p of s.planes) {
      if (p.status === 'repair' && p.condition < 99) p.condition = Math.min(99, p.condition + mins * 0.55);
    }

    // building work goes round and round
    for (const [id, len] of Object.entries(BUILDS)) {
      const u = s.buildings[id].upgrading;
      if (!u || (s.time - u.startAt) / (u.finishAt - u.startAt) > 0.94) {
        s.buildings[id].upgrading = { startAt: s.time - Math.round(len * 0.05), finishAt: s.time + Math.round(len * 0.95) };
      }
    }
    return null;
  };
})(window.AF);
