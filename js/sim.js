// Simulation: time stepping, missions, repairs, economy, and player commands.
// Commands return null on success or an error string.
(function (AF) {
  'use strict';

  const S = (AF.sim = {});
  AF.fx = [];        // visual events consumed by the renderer
  AF.dirty = true;   // UI needs refresh
  AF.wantSave = false;

  // ---- derived values ----
  // Effective level: a building with 50%+ bomb damage works one level lower until repaired.
  S.lvl = (s, id) => {
    const b = s.buildings[id];
    return Math.max(0, b.level - ((b.damage || 0) >= 50 ? 1 : 0));
  };
  S.pilotCap = (s) => 4 * s.buildings.officers.level;
  S.enlistedCap = (s) => 8 * s.buildings.enlisted.level;
  S.enlistedCount = (s) => s.enlisted.mechanics + s.enlisted.groundCrew;
  S.parkingCap = (s) => 2 + 2 * s.buildings.hangar.level;
  S.bays = (s) => S.lvl(s, 'hangar');
  S.fuelCap = (s) => [600, 1500, 3000, 5000][S.lvl(s, 'fuelDepot')];
  S.moraleTarget = (s) => 55 + 12 * S.lvl(s, 'mess');
  S.successBonus = (s) => 0.05 * S.lvl(s, 'tower');
  S.boardSize = (s) => 3 + S.lvl(s, 'tower');
  S.fatigueRecovery = (s) => 2 + S.lvl(s, 'officers') + 0.5 * S.lvl(s, 'mess');
  S.raidWarning = (s) => 20 + 12 * S.lvl(s, 'tower') + (S.lvl(s, 'defenses') >= 1 ? 5 : 0); // minutes
  S.aaChance = (s, night) => {
    const l = S.lvl(s, 'defenses');
    return AF.RAID.aaKill[l] * (night ? (l >= 3 ? 0.9 : 0.5) : 1);
  };
  S.penProtection = (s) => AF.RAID.penProtect[S.lvl(s, 'pens')];
  S.craterHoursEach = (s) => AF.RAID.craterHours / (1 + s.enlisted.groundCrew / 4);
  S.buildingRepairRate = (s) => 4 + s.enlisted.groundCrew * 0.4; // damage % per hour
  S.rushCost = (s, id) => {
    if (id === 'runway') return s.craters.length * AF.RAID.rushCrater;
    const b = s.buildings[id];
    return Math.round(((b.damage || 0) * Math.max(1, b.level) * 6) / 10) * 10;
  };
  S.repairRate = (s) => {
    const active = Math.max(1, Math.min(S.bays(s), s.planes.filter((p) => p.status === 'repair').length));
    return 1 + 2.5 * Math.min(s.enlisted.mechanics / active, 6); // % per hour per bay
  };
  S.turnaroundMinutes = (s) =>
    Math.max(20, Math.round((120 * 3) / (3 + s.enlisted.groundCrew) * (1 - 0.15 * (s.buildings.runway.level - 1))));
  S.dailyWages = (s) => s.pilots.length * AF.WAGES.pilot + S.enlistedCount(s) * AF.WAGES.enlisted;
  S.dailyStipend = (s) => 100 + Math.round(s.rep * 3);

  S.plane = (s, id) => s.planes.find((p) => p.id === id);
  S.pilot = (s, id) => s.pilots.find((p) => p.id === id);
  S.rank = (pilot) => {
    let r = AF.RANKS[0];
    for (const k of AF.RANKS) if (pilot.sorties >= k.min) r = k;
    return r;
  };
  S.pilotName = (pilot) => `${S.rank(pilot).abbr} ${pilot.name}`;
  S.planeOfPilot = (s, pilotId) => s.planes.find((p) => p.pilotId === pilotId);

  S.STATUS_LABEL = {
    ready: 'Ready', taxiing: 'Taxiing out', flying: 'Airborne', landing: 'Landing', turnaround: 'Refuelling', towing: 'Being towed',
    queued: 'Awaiting repair', repair: 'Under repair',
  };
  // Away on a sortie: taxiing out, in the air, or landing. Such aircraft can't be sold, repaired or re-crewed.
  S.isAway = (p) => p.status === 'taxiing' || p.status === 'flying' || p.status === 'landing';

  S.log = (s, text, kind = 'info') => {
    s.log.unshift({ t: s.time, text, kind });
    if (s.log.length > 200) s.log.length = 200;
    AF.dirty = true;
  };

  const clampMorale = (s) => { s.morale = AF.clamp(s.morale, 0, 100); };

  // ---- missions ----
  S.flyBlocker = (s, plane) => {
    if (plane.status !== 'ready') return S.STATUS_LABEL[plane.status];
    if (plane.condition < 50) return 'Needs repair';
    const pilot = plane.pilotId && S.pilot(s, plane.pilotId);
    if (!pilot) return 'No pilot';
    if (pilot.status !== 'available') return 'Pilot ' + pilot.status;
    if (pilot.fatigue > 70) return 'Pilot exhausted';
    return null;
  };

  S.planeStrength = (s, plane, m) => {
    const t = AF.PLANE_TYPES[plane.type];
    const pilot = plane.pilotId && S.pilot(s, plane.pilotId);
    const skill = pilot ? pilot.skill : 1;
    let stat = m.stat === 'speed' ? t.speed * (t.role === 'Recon' ? 2 : 1) : t.combat;
    if (m.requiresRole && t.role === m.requiresRole) stat *= 1.5;
    return stat * (0.6 + skill * 0.08) * (0.5 + plane.condition / 200);
  };

  S.moraleFactor = (s) => 0.75 + s.morale / 200;

  // tactic: key of AF.TACTICS chosen at launch; bonus: added by radio-call decisions in flight
  S.successChance = (s, m, planes, tactic, bonus = 0) => {
    if (m.stat === 'none') return 1;
    if (!planes.length) return 0;
    if (m.requiresRole && !planes.some((p) => AF.PLANE_TYPES[p.type].role === m.requiresRole)) return 0;
    const strength = planes.reduce((a, p) => a + S.planeStrength(s, p, m), 0) * S.moraleFactor(s);
    const t = AF.TACTICS[tactic] || AF.TACTICS.standard;
    return AF.clamp(0.25 + (0.45 * strength) / m.difficulty + S.successBonus(s) + t.success + bonus, 0.05, 0.97);
  };

  // Current odds for a flight already in the air.
  S.flightOdds = (s, f) => {
    const planes = f.planeIds.map((id) => S.plane(s, id)).filter(Boolean);
    return S.successChance(s, f.mission, planes, f.tactic, f.mod ? f.mod.success : 0);
  };

  // Modifiers a flight picks up from radio-call decisions.
  S.newMod = () => ({ success: 0, risk: 1, kills: 1, reward: 1, xp: 1, rep: 0, turnBack: 1 });

  S.fuelNeeded = (m, planes) =>
    Math.round(planes.reduce((a, p) => a + AF.PLANE_TYPES[p.type].fuelUse * m.hours, 0));

  S.runwayBlocker = (s) => (s.craters.length ? `Runway cratered (${s.craters.length}) — unserviceable until filled` : null);

  // Ground time added to a sortie of n aircraft (taxi out + landing, with stagger).
  S.sortieOverhead = (n, scramble) => {
    const F = AF.FLIGHT;
    return (scramble ? F.scrambleTaxi + F.scrambleStagger * (n - 1) : F.taxiOut + F.stagger * (n - 1)) + F.landing + F.stagger * (n - 1);
  };

  // Send aircraft off on mission m. Caller has validated everything.
  // Each aircraft taxis out in turn (status 'taxiing' over [phaseStart, phaseEnd]), then is 'flying'.
  // Scrambling fighters get away quickly, and those at readiness quickest of all.
  // The flight resolves at returnAt, as it arrives back overhead; aircraft then land one by one.
  S.dispatch = (s, m, planes, extra = {}) => {
    const F = AF.FLIGHT;
    const scramble = m.typeId === 'scramble';
    s.fuel -= S.fuelNeeded(m, planes);
    let at = s.time, airborneBy = s.time;
    planes.forEach((p, i) => {
      const quick = scramble && S.atReadiness(s, p);
      if (i) at += !scramble ? F.stagger : quick ? F.readyStagger : F.scrambleStagger;
      p.status = 'taxiing';
      p.phaseStart = at;
      p.phaseEnd = at + (!scramble ? F.taxiOut : quick ? F.readyTaxi : F.scrambleTaxi);
      p.fromReadiness = quick;
      airborneBy = Math.max(airborneBy, p.phaseEnd);
      S.pilot(s, p.pilotId).status = 'flying';
    });
    const returnAt = airborneBy + Math.round(m.hours * 60);
    const f = {
      id: 'f' + s.nextId++,
      mission: m,
      planeIds: planes.map((p) => p.id),
      pilotIds: planes.map((p) => p.pilotId),
      departAt: s.time,
      airborneBy,
      returnAt,
      parkAt: returnAt + F.landing + F.stagger * (planes.length - 1),
      tactic: 'standard',
      mod: S.newMod(),
      planeRisk: {},
      ...extra,
    };
    // most real sorties bring a decision over the radio somewhere along the way
    if (!scramble && m.stat !== 'none' && Math.random() < AF.RADIO.chance) {
      const ev = S.pickRadioEvent(m, planes.length);
      if (ev) {
        f.radioEvent = ev.id;
        f.radioAt = airborneBy + Math.round((returnAt - airborneBy) * AF.rand(0.25, 0.6));
      }
    }
    s.flights.push(f);
    const tac = f.tactic !== 'standard' ? ` (${AF.TACTICS[f.tactic].name.toLowerCase()})` : '';
    S.log(s, `${planes.map((p) => p.code).join(', ')} ${scramble ? 'scrambling' : 'taxiing out'} — ${m.name}, ${m.place}${tac}.`, 'mission');
    return f;
  };

  // A landed aircraft reaches dispersal: refuel, or go straight to the hangar if badly damaged.
  S.parkPlane = (s, p) => {
    // a pilot sent home early is released once the aircraft is down
    const pilot = p.pilotId && S.pilot(s, p.pilotId);
    if (pilot && pilot.status === 'flying' && !s.flights.some((f) => f.pilotIds.includes(pilot.id))) pilot.status = 'available';
    p.fromReadiness = false;
    if (s.autoRepair && p.condition < 60) {
      p.status = 'ready';
      S.queueRepair(s, p.id);
    } else {
      p.status = 'turnaround';
      p.readyAt = s.time + S.turnaroundMinutes(s);
    }
    AF.dirty = true;
  };

  S.launchMission = (s, missionId, planeIds, tactic = 'standard') => {
    const m = s.missions.find((x) => x.id === missionId);
    if (!m) return 'That mission is no longer available.';
    const rb = S.runwayBlocker(s);
    if (rb) return rb + '.';
    const planes = planeIds.map((id) => S.plane(s, id)).filter(Boolean);
    if (planes.length < m.minPlanes) return `Needs at least ${m.minPlanes} aircraft.`;
    if (planes.length > m.maxPlanes) return `At most ${m.maxPlanes} aircraft.`;
    for (const p of planes) {
      const b = S.flyBlocker(s, p);
      if (b) return `${p.code}: ${b}`;
    }
    if (m.requiresRole && !planes.some((p) => AF.PLANE_TYPES[p.type].role === m.requiresRole)) {
      return `Requires at least one ${m.requiresRole.toLowerCase()}.`;
    }
    const fuel = S.fuelNeeded(m, planes);
    if (fuel > s.fuel) return `Not enough fuel (${fuel} gal needed).`;

    s.missions = s.missions.filter((x) => x !== m);
    S.dispatch(s, m, planes, { tactic: m.stat === 'none' || !AF.TACTICS[tactic] ? 'standard' : tactic });
    return null;
  };

  // ---- radio calls ----
  S.radioEvent = (id) => (id === AF.RADIO.scramble.id ? AF.RADIO.scramble : AF.RADIO.events.find((e) => e.id === id));

  S.pickRadioEvent = (m, n) => {
    const pool = AF.RADIO.events.filter((e) => e.types.includes(m.typeId) && n >= (e.minPlanes || 1));
    return pool.length ? AF.pick(pool) : null;
  };

  // A flight calls in with a decision to make. The game pauses (if the player wants that) until
  // it's answered; otherwise the flight leader takes the first option when time runs out.
  S.raiseRadio = (s, f) => {
    const ev = S.radioEvent(f.radioEvent);
    const planes = f.planeIds.map((id) => S.plane(s, id)).filter(Boolean);
    if (!ev || !planes.length) return;
    const lead = S.pilot(s, f.pilotIds[0]);
    const others = planes.slice(1);
    const pick = ev.onePlane ? AF.pick(others.length ? others : planes) : null;
    const pickPilot = pick && S.pilot(s, pick.pilotId);
    const r = f.raidId && s.raid && s.raid.id === f.raidId ? s.raid : null;
    const ctx = {
      leader: lead ? S.pilotName(lead) : 'Leader', place: f.mission.place,
      code: pick ? pick.code : '', pilot: pickPilot ? S.pilotName(pickPilot) : '',
      bombers: r ? r.bombers : 0, escorts: r ? r.escorts : 0, type: r ? r.type : '',
    };
    s.radio = {
      flightId: f.id, eventId: ev.id, at: s.time, deadline: s.time + AF.RADIO.answerTime, planeId: pick ? pick.id : null,
      mission: f.mission.name, text: ev.text(ctx),
      choices: ev.choices.map((c) => ({ label: typeof c.label === 'function' ? c.label(ctx) : c.label, hint: c.hint })),
      paused: false,
    };
    S.log(s, `R/T, ${f.mission.name}: ${s.radio.text}`, 'radio');
    if (s.settings.pauseOnRadio && s.speed > 0) {
      s.speed = 0;
      s.radio.paused = true;
    }
    AF.dirty = true;
  };

  // Answer the open radio call with choice idx. auto: nobody answered in time.
  S.answerRadio = (s, idx, auto) => {
    const rd = s.radio;
    if (!rd) return 'No call to answer.';
    s.radio = null;
    AF.dirty = true;
    const f = s.flights.find((x) => x.id === rd.flightId);
    if (!f) return null;
    const ev = S.radioEvent(rd.eventId);
    const i = AF.clamp(idx | 0, 0, ev.choices.length - 1);
    const ch = ev.choices[i];
    let fx = ch.fx, note = ch.say ? `"${ch.say}"` : '';
    if (fx.gamble) {
      const win = Math.random() < fx.gamble.p;
      note = win ? fx.gamble.winText : fx.gamble.loseText;
      fx = win ? fx.gamble.win : fx.gamble.lose;
    }
    // the controller's vector goes to every fighter scrambled against the raid
    const targets = f.raidId ? s.flights.filter((x) => x.raidId === f.raidId) : [f];
    for (const t of targets) S.applyFx(s, t, fx, rd.planeId);
    const label = rd.choices[i].label;
    const act = label[0].toLowerCase() + label.slice(1);
    S.log(s, `${rd.mission}: ${auto ? `no order came, so the flight leader chose to ${act}` : `ordered to ${act}`}. ${note}`, 'radio');
    return null;
  };

  S.applyFx = (s, f, fx, planeId) => {
    const m = f.mod || (f.mod = S.newMod());
    if (fx.success) m.success += fx.success;
    for (const k of ['risk', 'kills', 'reward', 'xp', 'turnBack']) if (fx[k]) m[k] *= fx[k];
    if (fx.rep) {
      if (fx.always) { s.rep += fx.rep; S.checkUnlocks(s); } else m.rep += fx.rep;
    }
    if (fx.planeRisk && planeId && f.planeIds.includes(planeId)) {
      f.planeRisk = f.planeRisk || {};
      f.planeRisk[planeId] = (f.planeRisk[planeId] || 1) * fx.planeRisk;
    }
    if (fx.time && s.time < f.returnAt) {
      const planes = f.planeIds.map((id) => S.plane(s, id)).filter(Boolean);
      if (fx.time > 0) s.fuel = Math.max(0, s.fuel - S.fuelNeeded({ hours: fx.time / 60 }, planes));
      f.returnAt = Math.max(s.time + 5, f.returnAt + fx.time);
      f.parkAt = f.returnAt + AF.FLIGHT.landing + AF.FLIGHT.stagger * (f.planeIds.length - 1);
    }
    if (fx.detach && planeId) S.detachPlane(s, f, planeId);
  };

  // One aircraft leaves the flight and heads home early with a sick engine.
  S.detachPlane = (s, f, planeId) => {
    const i = f.planeIds.indexOf(planeId);
    if (i < 0 || f.planeIds.length < 2) return;
    f.planeIds.splice(i, 1);
    const pilotId = f.pilotIds.splice(i, 1)[0];
    const p = S.plane(s, planeId);
    if (!p) return;
    p.condition = Math.max(5, p.condition - AF.randInt(8, 22));
    p.sorties++;
    p.status = 'landing';
    p.phaseStart = s.time + 20; // the flight home
    p.phaseEnd = p.phaseStart + AF.FLIGHT.landing;
    const pilot = S.pilot(s, pilotId);
    if (pilot) {
      pilot.sorties++;
      pilot.fatigue = Math.min(100, pilot.fatigue + 10);
    }
    S.log(s, `${p.code} has turned for home with engine trouble.`, 'mission');
  };

  S.pilotFate = (s, pilot) => {
    const name = S.pilotName(pilot);
    const r = Math.random();
    if (r < 0.5) {
      pilot.status = 'wounded';
      pilot.returnAt = s.time + AF.randInt(2, 4) * 1440;
      return `${name} bailed out and is in hospital.`;
    }
    S.removePilot(s, pilot.id);
    s.stats.pilotsLost++;
    return r < 0.78 ? `${name} was killed in action.` : `${name} is missing, believed captured.`;
  };

  // Credit a pilot with enemy aircraft destroyed; five makes an ace.
  S.creditKills = (s, pilot, n) => {
    const before = pilot.kills || 0;
    pilot.kills = before + n;
    s.stats.enemyKills += n;
    S.directiveProgress(s, 'kills', null, n);
    if (before < AF.ACE_KILLS && pilot.kills >= AF.ACE_KILLS) {
      s.morale = AF.clamp(s.morale + 5, 0, 100);
      s.rep += 2;
      return `${S.pilotName(pilot)} is now an ace, with ${pilot.kills} victories! +2 reputation.`;
    }
    return '';
  };

  S.resolveFlight = (s, f) => {
    const m = f.mission;
    const planes = f.planeIds.map((id) => S.plane(s, id)).filter(Boolean);
    const scramble = m.typeId === 'scramble';
    const tac = AF.TACTICS[f.tactic] || AF.TACTICS.standard;
    const mod = f.mod || S.newMod();
    const success = scramble || Math.random() < S.successChance(s, m, planes, f.tactic, mod.success);
    const lines = [];
    const returned = [];
    const claims = [], aces = [];
    let losses = 0;

    planes.forEach((plane) => {
      const t = AF.PLANE_TYPES[plane.type];
      const pilot = S.pilot(s, f.pilotIds[f.planeIds.indexOf(plane.id)]);
      const skill = pilot ? pilot.skill : 1;
      const failMul = success ? 1 : 1.5;
      const skillMul = Math.max(0.3, 1.3 - skill * 0.07);
      const riskMul = (scramble ? 1 : tac.risk) * mod.risk * ((f.planeRisk && f.planeRisk[plane.id]) || 1);

      let dmg = 0;
      if (Math.random() < Math.min(0.95, m.risk * riskMul * skillMul * failMul * 1.6)) {
        dmg = Math.round(AF.rand(8, 40) * (1.4 - t.armor * 0.1));
      }
      const shotDown = Math.random() < Math.min(0.6, m.risk * 0.12 * riskMul * skillMul * failMul) || plane.condition - dmg <= 0;

      // enemy aircraft claimed on the way (scramble claims are made in the raid itself)
      if (!scramble && m.kills && pilot && t.role !== 'Trainer') {
        const lam = m.kills * (t.combat / 5) * (0.5 + skill / 6) * tac.kills * mod.kills * (success ? 1 : 0.4);
        const k = Math.floor(lam) + (Math.random() < lam % 1 ? 1 : 0);
        if (k) {
          claims.push(`${S.pilotName(pilot)} ${k}`);
          const ace = S.creditKills(s, pilot, k);
          if (ace) aces.push(ace);
        }
      }

      if (shotDown) {
        losses++;
        s.stats.planesLost++;
        S.removePlane(s, plane.id);
        lines.push(`${plane.code} (${t.short}) was lost. ${pilot ? S.pilotFate(s, pilot) : ''}`);
        return;
      }

      plane.condition = Math.max(1, plane.condition - dmg);
      plane.sorties++;
      if (dmg > 0) lines.push(`${plane.code} returned damaged (−${dmg}%).`);

      if (pilot) {
        const oldRank = S.rank(pilot);
        pilot.sorties++;
        pilot.status = 'available';
        pilot.fatigue = Math.min(100, pilot.fatigue + 7 * m.hours);
        const gain = m.xp * (success ? 1 : 0.5) * tac.xp * mod.xp * 0.02 * (10 - pilot.skill) / 10;
        pilot.skill = Math.min(10, Math.round((pilot.skill + gain) * 100) / 100);
        if (S.rank(pilot) !== oldRank) lines.push(`${pilot.name} promoted to ${S.rank(pilot).name}.`);
        if (dmg >= 25 && Math.random() < 0.25) {
          pilot.status = 'wounded';
          pilot.returnAt = s.time + AF.randInt(1, 3) * 1440;
          lines.push(`${S.pilotName(pilot)} was wounded.`);
        }
      }

      // join the circuit and land in turn
      plane.status = 'landing';
      plane.phaseStart = s.time + returned.length * AF.FLIGHT.stagger;
      plane.phaseEnd = plane.phaseStart + AF.FLIGHT.landing;
      returned.push(plane);
    });

    let head;
    if (scramble) {
      head = returned.length ? 'Scrambled fighters are returning to land.' : 'None of the scrambled fighters returned.';
    } else if (success) {
      const pay = Math.round((m.funds * mod.reward) / 10) * 10;
      const rep = m.rep + mod.rep;
      s.funds += pay;
      s.rep += rep;
      s.morale += 3;
      s.stats.successes++;
      head = `✔ ${m.name} (${m.place}) succeeded. +${AF.money(pay)}${rep ? `, +${rep} reputation` : ''}.`;
      S.directiveProgress(s, 'sorties', m.typeId, 1);
    } else {
      const partial = Math.round((m.funds * 0.25) / 10) * 10;
      s.funds += partial;
      s.rep = Math.max(0, s.rep - 1);
      s.morale -= 4;
      head = `✖ ${m.name} (${m.place}) failed. Partial pay ${AF.money(partial)}, −1 reputation.`;
    }
    s.morale -= losses * 8;
    clampMorale(s);
    if (!scramble) s.stats.missionsFlown++;
    s.flights = s.flights.filter((x) => x !== f);
    if (claims.length) lines.unshift(`Claims: ${claims.join(', ')} destroyed.`);

    S.log(s, [head, ...lines].join(' '), success ? 'success' : 'fail');
    for (const a of aces) S.log(s, a, 'event');
    S.checkUnlocks(s);
  };

  S.makeMission = (s, t, day) => {
    const scale = t.difficulty ? AF.rand(0.85, 1.25) * (1 + s.rep / 150) : 1;
    return {
      id: 'm' + s.nextId++,
      typeId: t.id,
      name: t.name,
      desc: t.desc,
      place: AF.pick(t.places),
      stat: t.stat,
      requiresRole: t.requiresRole || null,
      difficulty: Math.round(t.difficulty * scale * 10) / 10,
      risk: t.risk,
      funds: Math.round((t.funds * scale) / 10) * 10,
      rep: t.rep,
      xp: t.xp,
      kills: t.kills || 0,
      hours: t.hours,
      minPlanes: t.minPlanes,
      maxPlanes: t.maxPlanes,
      expiresAt: (day + 2) * 1440,
    };
  };

  S.generateMissions = (s) => {
    const day = Math.floor(s.time / 1440);
    s.missions = s.missions.filter((m) => m.expiresAt > s.time);
    if (!s.missions.some((m) => m.typeId === 'training')) {
      s.missions.push(S.makeMission(s, AF.MISSION_TYPES[0], day));
    }
    const pool = AF.MISSION_TYPES.filter((t) => t.minRep <= s.rep && t.stat !== 'none');
    // weight newer (harder) mission types a little more heavily
    const weighted = pool.flatMap((t, i) => Array(i + 1).fill(t));
    while (s.missions.length < S.boardSize(s)) s.missions.push(S.makeMission(s, AF.pick(weighted), day));
  };

  S.generateRecruits = (s) => {
    s.recruits = [];
    for (let i = 0; i < 3; i++) {
      const p = AF.makePilot(s, Math.min(7, AF.rand(1, 3 + s.rep / 30)));
      p.cost = Math.round((120 + p.skill * 70) / 10) * 10;
      s.recruits.push(p);
    }
  };

  S.checkUnlocks = (s, silent) => {
    const unlocked = new Set(s.flags.unlocked);
    for (const t of AF.MISSION_TYPES) {
      const key = 'm:' + t.id;
      if (t.minRep <= s.rep && !unlocked.has(key)) {
        unlocked.add(key);
        if (!silent) S.log(s, `Group HQ now trusts you with ${t.name} missions.`, 'event');
      }
    }
    for (const [id, t] of Object.entries(AF.PLANE_TYPES)) {
      const key = 'p:' + id;
      if (t.minRep <= s.rep && !unlocked.has(key)) {
        unlocked.add(key);
        if (!silent) S.log(s, `The Air Ministry will now release the ${t.short} to your station.`, 'event');
      }
    }
    s.flags.unlocked = [...unlocked];
  };

  // ---- repairs ----
  // Aircraft needing repair join s.repairQueue. When a bay is free the next one is towed in
  // (status 'towing', towTo 'bay'), repaired in its own bay (status 'repair', p.bay), then towed
  // back to dispersal (towTo 'slot'). Every tow books the hangar doors, so aircraft go through
  // one at a time instead of meeting in the doorway.
  S.startTow = (s, p, to) => {
    const F = AF.FLIGHT;
    const start = Math.max(s.time, s.hangarDoorFreeAt || 0);
    s.hangarDoorFreeAt = start + F.doorGap;
    p.status = 'towing';
    p.towTo = to;
    p.phaseStart = start;
    p.phaseEnd = start + F.tow;
    AF.dirty = true;
  };

  S.updateRepairStatuses = (s) => {
    s.repairQueue = s.repairQueue.filter((id) => S.plane(s, id));
    const bays = S.bays(s);
    const inBay = (p) => p.status === 'repair' || (p.status === 'towing' && p.towTo === 'bay');
    const used = new Set();
    for (const id of s.repairQueue) {
      const p = S.plane(s, id);
      if (inBay(p) && p.bay != null && !used.has(p.bay)) used.add(p.bay);
    }
    for (const id of s.repairQueue) {
      const p = S.plane(s, id);
      const needsBay = p.status === 'queued' || (p.status === 'repair' && (p.bay == null || !used.has(p.bay)));
      if (!needsBay) continue;
      let free = -1;
      for (let b = 0; b < bays; b++) if (!used.has(b)) { free = b; break; }
      if (free < 0) {
        if (p.status === 'repair') p.status = 'queued'; // older saves: no bay recorded
        continue;
      }
      used.add(free);
      p.bay = free;
      if (p.status === 'repair') continue; // older saves: already inside, just give it a bay
      S.startTow(s, p, 'bay');
    }
  };

  S.queueRepair = (s, planeId) => {
    const p = S.plane(s, planeId);
    if (!p) return 'Unknown aircraft.';
    if (p.status !== 'ready' && p.status !== 'turnaround') return 'Aircraft is not available.';
    if (p.condition >= 100) return 'Aircraft is undamaged.';
    p.status = 'queued';
    s.repairQueue.push(p.id);
    S.updateRepairStatuses(s);
    AF.dirty = true;
    return null;
  };

  S.cancelRepair = (s, planeId) => {
    const p = S.plane(s, planeId);
    if (!p || !s.repairQueue.includes(planeId)) return 'Not in the repair queue.';
    if (p.status === 'towing') return 'Aircraft is being towed into the hangar — wait until it is in its bay.';
    s.repairQueue = s.repairQueue.filter((id) => id !== planeId);
    if (p.status === 'repair') S.startTow(s, p, 'slot');
    else p.status = 'ready';
    S.updateRepairStatuses(s);
    AF.dirty = true;
    return null;
  };

  // A tow has reached its destination.
  S.finishTow = (s, p) => {
    if (p.towTo === 'bay') {
      p.status = 'repair';
    } else {
      p.status = 'ready';
      p.bay = null;
    }
    S.updateRepairStatuses(s);
    AF.dirty = true;
  };

  // ---- time ----
  S.hourly = (s) => {
    S.updateRepairStatuses(s);
    const rate = S.repairRate(s);
    let stalled = false;
    const bays = S.bays(s);
    for (const id of s.repairQueue.slice()) {
      const p = S.plane(s, id);
      if (p.status !== 'repair' || p.bay >= bays) continue; // only aircraft in a working bay
      let gain = Math.min(rate, 100 - p.condition);
      const partsPer = 0.2;
      if (s.parts < gain * partsPer) { gain = s.parts / partsPer; stalled = true; }
      s.parts = Math.max(0, Math.round((s.parts - gain * partsPer) * 100) / 100);
      p.condition = Math.min(100, p.condition + gain);
      if (p.condition >= 99.9) {
        p.condition = 100;
        s.repairQueue = s.repairQueue.filter((x) => x !== id);
        S.startTow(s, p, 'slot');
        S.log(s, `${p.code} repaired — towing it back to dispersal.`);
      }
    }
    if (stalled && !s.flags.partsWarned) S.log(s, 'Repairs have stalled — the stores are out of spare parts!', 'warn');
    s.flags.partsWarned = stalled;
    S.updateRepairStatuses(s);

    // pilots rest in their quarters, but sitting at readiness wears them down
    const rec = S.fatigueRecovery(s);
    const waiting = new Set(s.planes.filter((p) => S.atReadiness(s, p)).map((p) => p.pilotId));
    for (const p of s.pilots) {
      if (waiting.has(p.id)) p.fatigue = Math.min(100, p.fatigue + AF.READINESS_FATIGUE);
      else if (p.status !== 'flying') p.fatigue = Math.max(0, p.fatigue - rec);
    }
    S.checkReadinessDirective(s);

    // ground crews fill runway craters
    if (s.craters.length) {
      s.craterWork += 1 / S.craterHoursEach(s);
      while (s.craterWork >= 1 && s.craters.length) {
        s.craters.shift();
        s.craterWork -= 1;
        if (!s.craters.length) S.log(s, 'The last crater has been filled. The runway is serviceable again.', 'event');
      }
    } else {
      s.craterWork = 0;
    }
    // works department patches up bomb damage
    for (const id of AF.BUILDING_ORDER) {
      const b = s.buildings[id];
      if (!b.damage) continue;
      b.damage = Math.max(0, b.damage - S.buildingRepairRate(s));
      if (!b.damage) S.log(s, `Bomb damage to the ${AF.BUILDINGS[id].name} has been repaired.`);
    }
    AF.dirty = true;
  };

  S.randomEvent = (s) => {
    const events = [
      () => {
        const add = Math.min(150, S.fuelCap(s) - s.fuel);
        if (add <= 0) return;
        s.fuel += add;
        S.log(s, `A supply convoy arrived early with ${add} gallons of fuel.`, 'event');
      },
      () => {
        s.parts += 10;
        S.log(s, 'A crate of spare parts turned up from a disbanded squadron. +10 parts.', 'event');
      },
      () => {
        s.morale += 6;
        S.log(s, 'Sacks of mail from home arrived. Spirits are up.', 'event');
      },
      () => {
        if (s.morale >= 60) {
          s.rep += 2;
          S.log(s, 'An Air Vice-Marshal inspected the station and left impressed. +2 reputation.', 'event');
        } else {
          s.morale -= 4;
          S.log(s, 'A surprise inspection found the station wanting. Morale dips.', 'event');
        }
      },
    ];
    AF.pick(events)();
    clampMorale(s);
  };

  // ---- air raids ----
  S.scheduleRaid = (s) => {
    if (s.raid) return;
    const day = AF.dayNum(s.time);
    if (day < 4) return;
    const p = AF.clamp(0.06 + s.rep / 140 + Math.max(0, day - 40) * 0.004, 0, 0.6);
    if (Math.random() >= p) return;
    const night = s.rep >= 35 && Math.random() < 0.25;
    const hour = night ? AF.pick([0, 1, 2, 3, 22, 23]) : AF.randInt(7, 19);
    const warn = S.raidWarning(s);
    const arriveAt = Math.max(s.time + warn + 5, s.time + hour * 60 + AF.randInt(0, 59));
    const bombers = AF.clamp(Math.round(2 + s.rep / 16 + AF.rand(0, 3)), 2, 10);
    s.raid = {
      id: 'r' + s.nextId++,
      state: 'scheduled',
      detectAt: arriveAt - warn,
      arriveAt,
      bombers,
      escorts: s.rep >= 25 ? Math.round(bombers * AF.rand(0.3, 0.8)) : 0,
      night,
      type: AF.pick(AF.RAID.bomberTypes),
      scrambled: false,
    };
  };

  // ---- readiness ----
  // A fighter at readiness has its pilot strapped in and a starter battery plugged in: it scrambles
  // in moments and meets the raiders with height in hand, but the waiting wears the pilot down.
  S.canReadiness = (p) => AF.PLANE_TYPES[p.type].role === 'Fighter';
  S.atReadiness = (s, p) => !!p.readiness && p.status === 'ready' && !S.flyBlocker(s, p);

  S.setReadiness = (s, planeId, on) => {
    const p = S.plane(s, planeId);
    if (!p) return 'Unknown aircraft.';
    if (!S.canReadiness(p)) return 'Only fighters stand at readiness.';
    p.readiness = !!on;
    AF.dirty = true;
    return null;
  };

  S.scrambleCandidates = (s) => s.planes.filter((p) => AF.PLANE_TYPES[p.type].role === 'Fighter' && !S.flyBlocker(s, p));

  S.scrambleBlocker = (s) => {
    const r = s.raid;
    if (r && r.state === 'attacking') return 'Too late — the raiders are already over the field.';
    if (!r || r.state !== 'inbound') return 'No raid is inbound.';
    const rb = S.runwayBlocker(s);
    if (rb) return rb;
    if (!S.scrambleCandidates(s).length) return r.scrambled ? 'Every fit fighter is already up.' : 'No fighters ready (needs a fighter with a fit pilot).';
    return null;
  };

  // Scramble fighters against the inbound raid: ids limits it to those aircraft (default: all).
  // More can follow later, until the formation is in sight.
  S.scramble = (s, ids) => {
    const err = S.scrambleBlocker(s);
    if (err) return err;
    const r = s.raid;
    let planes = S.scrambleCandidates(s);
    if (ids) planes = planes.filter((p) => ids.includes(p.id));
    if (!planes.length) return 'No fighters selected.';
    planes.sort((a, b) => (S.atReadiness(s, b) ? 1 : 0) - (S.atReadiness(s, a) ? 1 : 0)); // readiness first
    const m = {
      id: 'm' + s.nextId++, typeId: 'scramble', name: 'Scramble', place: 'over the airfield', stat: 'combat',
      requiresRole: null, difficulty: r.bombers + r.escorts * 2, risk: 0.12 + r.escorts * 0.025, funds: 0, rep: 0, xp: 18,
      hours: Math.max(20, r.arriveAt + 30 - (s.time + AF.FLIGHT.scrambleTaxi)) / 60, minPlanes: 1, maxPlanes: 99, expiresAt: Infinity,
    };
    while (planes.length && S.fuelNeeded(m, planes) > s.fuel) planes = planes.slice(0, -1);
    if (!planes.length) return 'Not enough fuel to scramble.';
    const f = S.dispatch(s, m, planes, { raidId: r.id });
    // stay up until the raid is over, then come home
    f.returnAt = Math.max(f.airborneBy + 10, r.arriveAt + 20);
    f.parkAt = f.returnAt + AF.FLIGHT.landing + AF.FLIGHT.stagger * (planes.length - 1);
    r.scrambled = (r.scrambled || 0) + planes.length;
    // the controller's call comes as they close with the formation, if they're up in time
    if (!r.radioAsked) {
      const at = Math.max(f.airborneBy + 1, r.arriveAt - AF.RAID.approach - 4);
      if (at < r.arriveAt - AF.RAID.approach) {
        f.radioEvent = AF.RADIO.scramble.id;
        f.radioAt = at;
        r.radioAsked = true;
      }
    }
    return null;
  };

  function casualties(s, n) {
    const lost = [];
    for (let i = 0; i < n; i++) {
      const role = s.enlisted.groundCrew >= s.enlisted.mechanics ? 'groundCrew' : 'mechanics';
      if (s.enlisted[role] > 0) { s.enlisted[role]--; lost.push(role); }
    }
    return lost.length;
  }

  // A raid plays out over several game minutes so the simulation matches what you see:
  //  - beginAttack (formation comes into sight, AF.RAID.approach minutes out): the battle is decided,
  //    and every kill and bomb gets the game minute at which it happens;
  //  - raidTick: each bomb's damage is applied at the minute it lands;
  //  - finishRaid: once the last bomb is down, the report is logged.
  S.beginAttack = (s) => {
    const r = s.raid;
    r.state = 'attacking';
    r.startAt = s.time;

    // interception by scrambled fighters (with the controller's vector, and an edge for those
    // that went up from readiness)
    const flights = s.flights.filter((f) => f.raidId === r.id);
    const fighters = [];
    let remaining = r.bombers, fighterKills = 0, turnMul = 1;
    r.claims = [];
    for (const f of flights) {
      const mod = f.mod || S.newMod();
      turnMul = Math.max(turnMul, mod.turnBack);
      f.planeIds.forEach((id, i) => {
        const p = S.plane(s, id);
        if (!p) return;
        fighters.push(p);
        const str = S.planeStrength(s, p, { stat: 'combat' }) * S.moraleFactor(s) * (p.fromReadiness ? AF.READINESS_EDGE : 1);
        const k = Math.min(remaining, Math.floor((str / (2.5 + r.escorts * 0.4)) * AF.rand(0.5, 1.5) * mod.kills + Math.random() * 0.6));
        fighterKills += k;
        remaining -= k;
        if (k && f.pilotIds[i]) r.claims.push({ pilotId: f.pilotIds[i], n: k });
      });
    }
    const turnedBack = fighters.length ? Math.min(remaining, Math.floor(remaining * Math.min(0.4 * turnMul, fighters.length * 0.08 * turnMul) + Math.random() * 0.5)) : 0;
    remaining -= turnedBack;

    // anti-aircraft fire
    const aa = S.aaChance(s, r.night);
    let aaKills = 0;
    for (let i = 0; i < remaining; i++) if (Math.random() < aa) aaKills++;
    remaining -= aaKills;

    // bomb aiming: targets are chosen now; damage is applied when each bomb lands
    const hits = [];
    const accuracy = r.night ? 0.4 : 0.6;
    let sticks = 0;
    for (let i = 0; i < remaining; i++) sticks += !r.night && Math.random() < 0.3 ? 2 : 1;
    const grounded = s.planes.filter((p) => p.status !== 'flying' && p.status !== 'landing' && p.status !== 'repair');
    const built = AF.BUILDING_ORDER.filter((id) => id !== 'runway' && id !== 'pens' && s.buildings[id].level > 0);
    for (let i = 0; i < sticks; i++) {
      const at = r.arriveAt + AF.randInt(-1, 2);
      const roll = Math.random();
      if (Math.random() > accuracy) hits.push({ kind: 'miss', at });
      else if (roll >= 0.35 && roll < 0.62 && grounded.length) hits.push({ kind: 'plane', id: AF.pick(grounded).id, at });
      else if (roll >= 0.62 && built.length) hits.push({ kind: 'building', id: AF.pick(built), at });
      else hits.push({ kind: 'runway', crater: 'c' + s.nextId++, along: AF.rand(-0.45, 0.45), off: AF.rand(-0.35, 0.35), at });
    }
    hits.sort((a, b) => a.at - b.at);

    r.fighterKills = fighterKills;
    r.aaKills = aaKills;
    r.turnedBack = turnedBack;
    r.fighterKillTimes = Array.from({ length: fighterKills }, () => r.arriveAt - AF.randInt(4, 8));
    r.aaKillTimes = Array.from({ length: aaKills }, () => r.arriveAt + AF.randInt(-3, 2));
    r.interceptors = fighters.map((p) => p.type);
    r.hits = hits;
    r.endAt = Math.max(r.arriveAt + 3, ...hits.map((h) => h.at + 1), ...r.aaKillTimes.map((t) => t + 1));
    r.report = { lines: [], buildingHits: {}, damaging: 0, destroyed: 0, killed: 0, craters: 0 };
    AF.dirty = true;
  };

  function applyHit(s, r, h) {
    const rep = r.report;
    if (h.kind === 'plane') {
      const p = S.plane(s, h.id);
      // the aircraft may have taxied off, been towed into the hangar, or already been destroyed
      if (!p || S.isAway(p) || p.status === 'repair') { h.kind = 'miss'; return; }
      rep.damaging++;
      const sheltered = p.status !== 'towing' && Math.random() < S.penProtection(s);
      const dmg = sheltered ? AF.randInt(5, 18) : AF.randInt(35, 110);
      p.condition -= dmg;
      if (p.condition <= 0) {
        h.destroyed = true;
        rep.destroyed++;
        s.stats.planesLost++;
        S.removePlane(s, p.id);
        rep.lines.push(`${p.code} was destroyed on the ground.`);
      } else {
        rep.lines.push(sheltered ? `${p.code} was shielded by its blast pen (−${dmg}%).` : `${p.code} was damaged (−${dmg}%).`);
        if (s.autoRepair && p.condition < 60 && (p.status === 'ready' || p.status === 'turnaround')) S.queueRepair(s, p.id);
      }
    } else if (h.kind === 'building') {
      rep.damaging++;
      const id = h.id, b = s.buildings[id];
      b.damage = Math.min(100, (b.damage || 0) + AF.randInt(25, 60));
      let extra = '';
      if (id === 'hangar') {
        for (const p of s.planes.filter((q) => q.status === 'repair')) p.condition = Math.max(1, p.condition - AF.randInt(10, 30));
      } else if (id === 'fuelDepot') {
        const lost = Math.round(s.fuel * AF.rand(0.2, 0.5));
        s.fuel -= lost;
        extra = `${lost} gallons of fuel went up in flames.`;
      } else if (id === 'enlisted' || id === 'mess') {
        const n = casualties(s, AF.randInt(0, 2));
        rep.killed += n;
        if (n) extra = `${n} airm${n > 1 ? 'en' : 'an'} killed.`;
      } else if (id === 'officers') {
        const ground = s.pilots.filter((p) => p.status === 'available');
        if (ground.length && Math.random() < 0.35) {
          const p = AF.pick(ground);
          p.status = 'wounded';
          p.returnAt = s.time + AF.randInt(2, 4) * 1440;
          extra = `${S.pilotName(p)} was wounded.`;
        }
      }
      const bh = (rep.buildingHits[id] ??= { n: 0, extras: [] });
      bh.n++;
      if (extra) bh.extras.push(extra);
      s.fuel = Math.min(s.fuel, S.fuelCap(s));
      S.updateRepairStatuses(s);
    } else if (h.kind === 'runway') {
      rep.damaging++;
      rep.craters++;
      s.craters.push({ id: h.crater, along: h.along, off: h.off });
    }
    AF.dirty = true;
  }

  S.raidTick = (s) => {
    const r = s.raid;
    for (const h of r.hits) {
      if (!h.done && s.time >= h.at) {
        h.done = true;
        applyHit(s, r, h);
      }
    }
    if (s.time >= r.endAt) S.finishRaid(s);
  };

  S.finishRaid = (s) => {
    const r = s.raid;
    s.raid = null;
    s.stats.raids++;
    const rep = r.report;
    const lines = rep.lines.slice();
    for (const [id, bh] of Object.entries(rep.buildingHits)) {
      const times = bh.n > 1 ? ` ${bh.n === 2 ? 'twice' : bh.n + ' times'}` : '';
      const out = s.buildings[id].damage >= 50 ? ' and put out of action' : '';
      lines.push(`${AF.BUILDINGS[id].name} hit${times}${out}.${bh.extras.length ? ' ' + bh.extras.join(' ') : ''}`);
    }
    if (rep.craters) lines.push(`${rep.craters} bomb${rep.craters > 1 ? 's' : ''} cratered the runway.`);

    const kills = r.fighterKills + r.aaKills;
    s.stats.enemyKills += r.aaKills; // fighter kills are counted as each pilot is credited
    s.rep += kills;
    const claimLines = [], aces = [];
    for (const c of r.claims || []) {
      const pilot = S.pilot(s, c.pilotId);
      if (!pilot) { s.stats.enemyKills += c.n; continue; }
      claimLines.push(`${S.pilotName(pilot)} ${c.n}`);
      const ace = S.creditKills(s, pilot, c.n);
      if (ace) aces.push(ace);
    }
    if (r.aaKills) S.directiveProgress(s, 'kills', null, r.aaKills);
    const claimText = claimLines.length ? `Claims: ${claimLines.join(', ')}. ` : '';
    s.morale += kills * 2 - rep.damaging * 2 - rep.destroyed * 5 - rep.killed * 3;
    clampMorale(s);

    const desc = `${r.bombers} ${r.type} bomber${r.bombers > 1 ? 's' : ''}${r.escorts ? ` escorted by ${r.escorts} Bf 109s` : ''}`;
    const tally = [];
    if (r.fighterKills) tally.push(`${r.fighterKills} shot down by our fighters`);
    if (r.aaKills) tally.push(`${r.aaKills} by the guns`);
    if (r.turnedBack) tally.push(`${r.turnedBack} turned back`);
    const summary = `${r.night ? 'Night raid' : 'Air raid'}: ${desc}. ${tally.length ? tally.join(', ') + '.' : 'None were brought down.'} ${claimText}` +
      (lines.length ? lines.join(' ') : r.hits.length ? 'Their bombs fell wide.' : 'No bombs fell on the station.');
    s.lastRaid = { at: s.time, summary, kills, damaging: rep.damaging, destroyed: rep.destroyed };
    S.log(s, summary + (kills ? ` +${kills} reputation.` : ''), rep.damaging ? 'warn' : 'success');
    for (const a of aces) S.log(s, a, 'event');
    AF.wantSave = true;
  };

  S.rushRepair = (s, id) => {
    const cost = S.rushCost(s, id);
    if (id === 'runway' ? !s.craters.length : !s.buildings[id].damage) return 'Nothing to repair.';
    if (s.funds < cost) return 'Insufficient funds.';
    s.funds -= cost;
    if (id === 'runway') {
      s.craters = [];
      s.craterWork = 0;
      S.log(s, `Civilian contractors filled the runway craters for ${AF.money(cost)}.`);
    } else {
      s.buildings[id].damage = 0;
      S.log(s, `The ${AF.BUILDINGS[id].name} was repaired by contractors for ${AF.money(cost)}.`);
    }
    S.updateRepairStatuses(s);
    AF.dirty = true;
    return null;
  };

  // ---- orders from Group ----
  const isFighter = (p) => AF.PLANE_TYPES[p.type].role === 'Fighter';

  S.issueDirective = (s) => {
    if (s.directive || AF.dayNum(s.time) < 2 || Math.random() >= AF.DIRECTIVES.chance) return;
    const day = Math.floor(s.time / 1440);
    const options = [];
    const types = AF.MISSION_TYPES.filter((t) => t.stat !== 'none' && t.minRep <= s.rep && (!t.requiresRole || s.planes.some((p) => AF.PLANE_TYPES[p.type].role === t.requiresRole)));
    if (types.length) {
      const t = AF.pick(types), n = AF.randInt(2, 3);
      options.push({ kind: 'sorties', mission: t.id, target: n, deadline: s.time + 2 * 1440, text: `Complete ${n} ${t.name} missions`, funds: Math.round((t.funds * n * 0.5) / 10) * 10, rep: 2 + Math.floor(t.rep / 3) });
    }
    const fighters = s.planes.filter(isFighter).length;
    if (fighters) {
      const n = AF.clamp(Math.round(2 + s.rep / 20), 2, 8);
      options.push({ kind: 'kills', target: n, deadline: s.time + 3 * 1440, text: `Destroy ${n} enemy aircraft`, funds: n * 120, rep: 2 + Math.floor(n / 2) });
      const k = Math.min(2, fighters);
      options.push({ kind: 'readiness', target: k, from: day * 1440 + 600, deadline: day * 1440 + 960, text: `Keep ${k} fighter${k > 1 ? 's' : ''} at readiness from 10:00 to 16:00 today`, funds: 250 + 100 * k, rep: 2 });
    }
    if (!options.length) return;
    const d = AF.pick(options);
    s.directive = { id: 'd' + s.nextId++, progress: 0, issuedAt: s.time, ...d };
    if (d.kind === 'sorties') {
      // Group posts the missions to go with the order (one spare), open until its deadline
      const t = AF.MISSION_TYPES.find((x) => x.id === d.mission);
      for (let i = 0; i <= d.target; i++) {
        const m = S.makeMission(s, t, day);
        m.expiresAt = d.deadline;
        s.missions.push(m);
      }
    }
    S.log(s, `Directive from Group: ${d.text}. Reward ${AF.money(d.funds)} and +${d.rep} reputation.`, 'event');
  };

  S.directiveProgress = (s, kind, key, n) => {
    const d = s.directive;
    if (!d || d.kind !== kind || (d.mission && d.mission !== key)) return;
    d.progress += n;
    if (d.progress >= d.target) S.closeDirective(s, true);
    AF.dirty = true;
  };

  // Fighters counting toward a readiness order: at readiness, or up against a raid.
  S.defenceReady = (s) => s.planes.filter((p) => isFighter(p) && (S.atReadiness(s, p) ||
    (S.isAway(p) && s.flights.some((f) => f.raidId && f.planeIds.includes(p.id))))).length;

  S.checkReadinessDirective = (s) => {
    const d = s.directive;
    if (!d || d.kind !== 'readiness' || s.time < d.from || s.time >= d.deadline) return;
    d.progress = Math.min(d.target, S.defenceReady(s));
    if (d.progress < d.target) {
      d.progress = 0;
      S.closeDirective(s, false, `Group found only ${S.defenceReady(s)} fighter${S.defenceReady(s) === 1 ? '' : 's'} at readiness at ${AF.clock(s.time)}.`);
    }
  };

  S.closeDirective = (s, ok, why) => {
    const d = s.directive;
    if (!d) return;
    s.directive = null;
    if (ok) {
      s.funds += d.funds;
      s.rep += d.rep;
      s.morale = AF.clamp(s.morale + 4, 0, 100);
      s.stats.directives = (s.stats.directives || 0) + 1;
      S.log(s, `✔ Group's directive carried out: ${d.text}. +${AF.money(d.funds)}, +${d.rep} reputation.`, 'success');
      S.checkUnlocks(s);
    } else {
      const F = AF.DIRECTIVES.fail;
      s.rep = Math.max(0, s.rep - F.rep);
      s.morale = AF.clamp(s.morale - F.morale, 0, 100);
      S.log(s, `✖ Group's directive not carried out: ${d.text}. ${why ? why + ' ' : ''}−${F.rep} reputation.`, 'fail');
    }
    AF.dirty = true;
  };

  S.daily = (s) => {
    const wages = S.dailyWages(s);
    const stipend = S.dailyStipend(s);
    s.funds += stipend - wages;
    S.log(s, `${AF.dateStr(s.time)}. Air Ministry allowance ${AF.money(stipend)}; wages paid ${AF.money(wages)}.`, 'day');
    if (s.funds < 0) {
      s.morale -= 10;
      S.log(s, 'The station is in debt! Pay is late and morale is suffering.', 'warn');
    }
    s.morale += (S.moraleTarget(s) - s.morale) * 0.25;
    clampMorale(s);
    S.generateMissions(s);
    S.generateRecruits(s);
    if (Math.random() < 0.35) S.randomEvent(s);
    S.scheduleRaid(s);
    S.issueDirective(s);
    S.checkUnlocks(s);
    AF.wantSave = true;
  };

  // Advance the world by one game minute.
  S.step = (s) => {
    s.time++;
    // radio calls: one open at a time; the leader decides if nobody answers
    if (s.radio && s.time >= s.radio.deadline) S.answerRadio(s, 0, true);
    for (const f of s.flights) {
      if (!f.radioAt || f.radioDone || s.time < f.radioAt) continue;
      if (s.radio && f.raidId) S.answerRadio(s, 0, true); // the raid takes priority
      if (!s.radio) { f.radioDone = true; S.raiseRadio(s, f); }
      else if (s.time + 3 < f.returnAt - 10) f.radioAt = s.time + 3; // wait for the frequency to clear
      else f.radioDone = true;
    }
    for (const f of s.flights.slice()) {
      if (s.time < f.returnAt) continue;
      if (s.radio && s.radio.flightId === f.id) S.answerRadio(s, 0, true);
      if (s.time >= f.returnAt) S.resolveFlight(s, f);
    }
    for (const p of s.planes) {
      if (p.status === 'turnaround' && s.time >= p.readyAt) { p.status = 'ready'; AF.dirty = true; }
      else if (p.status === 'taxiing' && s.time >= p.phaseEnd) { p.status = 'flying'; AF.dirty = true; }
      else if (p.status === 'landing' && s.time >= p.phaseEnd) S.parkPlane(s, p);
      else if (p.status === 'towing' && s.time >= p.phaseEnd) S.finishTow(s, p);
    }
    for (const p of s.pilots) {
      if (p.status === 'wounded' && s.time >= p.returnAt) {
        p.status = 'available';
        p.fatigue = 0;
        S.log(s, `${S.pilotName(p)} has returned from hospital, fit to fly.`);
      }
    }
    for (const id of AF.BUILDING_ORDER) {
      const b = s.buildings[id];
      if (b.upgrading && s.time >= b.upgrading.finishAt) {
        b.level++;
        b.damage = 0;
        delete b.upgrading;
        S.log(s, `Construction complete: ${AF.BUILDINGS[id].levels[b.level - 1].label}.`, 'event');
        S.updateRepairStatuses(s);
      }
    }
    const r = s.raid;
    if (r && r.state === 'scheduled' && s.time >= r.detectAt) {
      r.state = 'inbound';
      S.log(s, `RAID WARNING: ${r.bombers} ${r.type}s${r.escorts ? ` with fighter escort` : ''} plotted heading for the station. ETA ${AF.dur(r.arriveAt - s.time)}.`, 'raid');
      if (s.settings.pauseOnRaid) s.speed = 0;
      AF.dirty = true;
    } else if (r && r.state === 'inbound' && s.time >= r.arriveAt - AF.RAID.approach) {
      const rf = s.radio && s.flights.find((f) => f.id === s.radio.flightId);
      if (rf && rf.raidId === r.id) S.answerRadio(s, 0, true); // contact: no more time to talk
      S.beginAttack(s);
    } else if (r && r.state === 'attacking') {
      S.raidTick(s);
    }
    const d = s.directive;
    if (d && s.time >= d.deadline) {
      if (d.kind === 'readiness') S.closeDirective(s, true);
      else S.closeDirective(s, false, `Only ${d.progress} of ${d.target} by the deadline.`);
    }
    if (s.missions.some((m) => m.expiresAt <= s.time)) {
      s.missions = s.missions.filter((m) => m.expiresAt > s.time);
      AF.dirty = true;
    }
    if (s.time % 60 === 0) S.hourly(s);
    if (s.time % 1440 === 0) S.daily(s);
  };

  // ---- player commands ----
  S.upgradeInfo = (s, id) => {
    const b = s.buildings[id];
    const next = AF.BUILDINGS[id].levels[b.level];
    return next ? { next, level: b.level + 1 } : null;
  };

  S.upgradeBlocker = (s, id) => {
    if (s.buildings[id].upgrading) return 'Under construction';
    const info = S.upgradeInfo(s, id);
    if (!info) return 'Fully upgraded';
    if (s.funds < info.next.cost) return 'Insufficient funds';
    return null;
  };

  S.upgrade = (s, id) => {
    const err = S.upgradeBlocker(s, id);
    if (err) return err;
    const { next } = S.upgradeInfo(s, id);
    s.funds -= next.cost;
    s.buildings[id].upgrading = { startAt: s.time, finishAt: s.time + next.hours * 60 };
    S.log(s, `Works department has begun construction of the ${next.label} (${next.hours}h).`);
    return null;
  };

  S.planeBlocker = (s, typeId) => {
    const t = AF.PLANE_TYPES[typeId];
    if (s.rep < t.minRep) return `Needs ${t.minRep} reputation`;
    if (s.buildings.hangar.level < t.hangarLevel) return `Needs Hangar Lv ${t.hangarLevel}`;
    if (s.buildings.runway.level < t.runwayLevel) return `Needs Runway Lv ${t.runwayLevel}`;
    if (s.planes.length >= S.parkingCap(s)) return 'No parking space';
    if (s.funds < t.cost) return 'Insufficient funds';
    return null;
  };

  S.buyPlane = (s, typeId) => {
    const err = S.planeBlocker(s, typeId);
    if (err) return err;
    s.funds -= AF.PLANE_TYPES[typeId].cost;
    const p = AF.makePlane(s, typeId);
    s.planes.push(p);
    S.log(s, `A new ${AF.PLANE_TYPES[typeId].short} was ferried in and coded ${p.code}.`);
    return null;
  };

  S.sellValue = (s, plane) => Math.round((AF.PLANE_TYPES[plane.type].cost * 0.4 * plane.condition) / 100 / 10) * 10;

  S.sellPlane = (s, planeId) => {
    const p = S.plane(s, planeId);
    if (!p) return 'Unknown aircraft.';
    if (S.isAway(p)) return 'Aircraft is away on a sortie.';
    if (p.status === 'towing') return 'Aircraft is being towed.';
    const value = S.sellValue(s, p);
    s.funds += value;
    S.removePlane(s, planeId);
    S.log(s, `${p.code} was handed back to a Maintenance Unit for ${AF.money(value)}.`);
    return null;
  };

  S.removePlane = (s, planeId) => {
    s.planes = s.planes.filter((p) => p.id !== planeId);
    s.repairQueue = s.repairQueue.filter((id) => id !== planeId);
    S.updateRepairStatuses(s);
    AF.dirty = true;
  };

  S.removePilot = (s, pilotId) => {
    for (const p of s.planes) if (p.pilotId === pilotId) p.pilotId = null;
    s.pilots = s.pilots.filter((p) => p.id !== pilotId);
    AF.dirty = true;
  };

  S.assignPilot = (s, planeId, pilotId) => {
    const plane = S.plane(s, planeId);
    if (!plane) return 'Unknown aircraft.';
    if (S.isAway(plane)) return 'Aircraft is away on a sortie.';
    if (!pilotId) { plane.pilotId = null; AF.dirty = true; return null; }
    const pilot = S.pilot(s, pilotId);
    if (!pilot) return 'Unknown pilot.';
    if (pilot.status === 'flying') return 'That pilot is airborne.';
    const other = S.planeOfPilot(s, pilotId);
    if (other) {
      if (S.isAway(other)) return 'That pilot is airborne.';
      other.pilotId = null;
    }
    plane.pilotId = pilotId;
    AF.dirty = true;
    return null;
  };

  S.autoAssign = (s) => {
    const free = s.pilots
      .filter((p) => p.status !== 'flying' && !S.planeOfPilot(s, p.id))
      .sort((a, b) => b.skill - a.skill);
    const planes = s.planes
      .filter((p) => !p.pilotId && !S.isAway(p))
      .sort((a, b) => AF.PLANE_TYPES[b.type].combat - AF.PLANE_TYPES[a.type].combat);
    let n = 0;
    for (const plane of planes) {
      const pilot = free.shift();
      if (!pilot) break;
      plane.pilotId = pilot.id;
      n++;
    }
    AF.dirty = true;
    return n ? null : 'No unassigned pilots or aircraft.';
  };

  S.hirePilot = (s, recruitId) => {
    const r = s.recruits.find((p) => p.id === recruitId);
    if (!r) return 'Candidate no longer available.';
    if (s.pilots.length >= S.pilotCap(s)) return "Officers' barracks are full.";
    if (s.funds < r.cost) return 'Insufficient funds.';
    s.funds -= r.cost;
    s.recruits = s.recruits.filter((p) => p !== r);
    const pilot = { ...r };
    delete pilot.cost;
    s.pilots.push(pilot);
    S.log(s, `${S.pilotName(pilot)} has reported for duty.`);
    return null;
  };

  S.dismissPilot = (s, pilotId) => {
    const p = S.pilot(s, pilotId);
    if (!p) return 'Unknown pilot.';
    if (p.status === 'flying') return 'Pilot is airborne.';
    S.removePilot(s, pilotId);
    S.log(s, `${S.pilotName(p)} has been posted elsewhere.`);
    return null;
  };

  S.hireEnlisted = (s, role) => {
    if (S.enlistedCount(s) >= S.enlistedCap(s)) return 'Enlisted barracks are full.';
    const cost = AF.PRICES[role];
    if (s.funds < cost) return 'Insufficient funds.';
    s.funds -= cost;
    s.enlisted[role]++;
    AF.dirty = true;
    return null;
  };

  S.dismissEnlisted = (s, role) => {
    if (s.enlisted[role] <= 0) return 'Nobody to dismiss.';
    s.enlisted[role]--;
    AF.dirty = true;
    return null;
  };

  S.buyFuel = (s, amount) => {
    amount = Math.min(amount, Math.floor(S.fuelCap(s) - s.fuel));
    if (amount <= 0) return 'Fuel storage is full.';
    const cost = amount * AF.PRICES.fuel;
    if (s.funds < cost) return 'Insufficient funds.';
    s.funds -= cost;
    s.fuel += amount;
    AF.dirty = true;
    return null;
  };

  S.buyParts = (s, amount) => {
    const cost = amount * AF.PRICES.parts;
    if (s.funds < cost) return 'Insufficient funds.';
    s.funds -= cost;
    s.parts += amount;
    s.flags.partsWarned = false;
    AF.dirty = true;
    return null;
  };
})(window.AF);
