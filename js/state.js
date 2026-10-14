// Game state creation, helpers, and save/load.
(function (AF) {
  'use strict';

  const SAVE_KEY = 'airfield-command-save-v1';

  AF.rand = (a, b) => a + Math.random() * (b - a);
  AF.randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
  AF.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  AF.clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ---- time & formatting ----
  AF.dayNum = (t) => Math.floor(t / 1440) + 1;
  AF.clock = (t) => {
    const m = ((t % 1440) + 1440) % 1440;
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  };
  AF.dateStr = (t) => {
    const d = new Date(AF.START_DATE.getTime());
    d.setDate(d.getDate() + Math.floor(t / 1440));
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  };
  AF.dur = (mins) => {
    mins = Math.max(0, Math.round(mins));
    const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
    if (d) return `${d}d ${h}h`;
    if (h) return m ? `${h}h ${m}m` : `${h}h`;
    return `${m}m`;
  };
  AF.money = (n) => '£' + Math.round(n).toLocaleString('en-GB');

  // ---- entity factories ----
  AF.makePilot = function (s, skill) {
    return {
      id: 'p' + s.nextId++,
      name: AF.pick(AF.FIRST_NAMES) + ' ' + AF.pick(AF.LAST_NAMES),
      skill: Math.round((skill ?? AF.rand(1.5, 3.5)) * 10) / 10,
      sorties: 0,
      kills: 0,
      fatigue: 0,
      status: 'available', // available | flying | wounded
      returnAt: 0,
    };
  };

  AF.makePlane = function (s, typeId) {
    const used = new Set(s.planes.map((p) => p.code.slice(-1)));
    let letter = 'Z';
    for (const c of 'ABCDEFGHJKLMNPRSTUVWXY') if (!used.has(c)) { letter = c; break; }
    return {
      id: 'a' + s.nextId++,
      type: typeId,
      code: AF.SQUADRON_CODE + '-' + letter,
      condition: 100,
      status: 'ready', // ready | flying | turnaround | queued | repair
      pilotId: null,
      readyAt: 0,
      sorties: 0,
      readiness: false, // fighters: wait with the pilot strapped in, to scramble at once
    };
  };

  AF.newGame = function () {
    const s = {
      version: 1,
      time: 6 * 60, // Day 1, 06:00
      speed: 1,
      funds: 1500,
      fuel: 400,
      parts: 30,
      morale: 70,
      rep: 0,
      nextId: 1,
      autoRepair: true,
      buildings: {
        runway: { level: 1 },
        hangar: { level: 1 },
        officers: { level: 1 },
        enlisted: { level: 1 },
        fuelDepot: { level: 0 },
        mess: { level: 0 },
        tower: { level: 0 },
        defenses: { level: 0 },
        pens: { level: 0 },
      },
      craters: [],     // runway bomb craters: { id, along (-0.5..0.5 of length), off (-0.5..0.5 of width) }
      craterWork: 0,
      hangarDoorFreeAt: 0, // next game minute the hangar doors are clear for a tow
      raid: null,      // the next scheduled or inbound raid
      lastRaid: null,  // summary of the most recent raid
      radio: null,     // the radio call waiting for an answer
      directive: null, // the current order from Group
      settings: { pauseOnRaid: true, pauseOnRadio: true },
      planes: [],
      pilots: [],
      enlisted: { mechanics: 3, groundCrew: 3 },
      repairQueue: [],
      flights: [],
      missions: [],
      recruits: [],
      log: [],
      stats: { missionsFlown: 0, successes: 0, planesLost: 0, pilotsLost: 0, raids: 0, enemyKills: 0, directives: 0 },
      flags: { unlocked: [] },
    };

    for (const type of ['tigermoth', 'tigermoth', 'gladiator']) s.planes.push(AF.makePlane(s, type));
    s.pilots.push(AF.makePilot(s, 3.2), AF.makePilot(s, 2.4), AF.makePilot(s, 1.8));
    s.planes[2].pilotId = s.pilots[0].id; // best pilot gets the Gladiator
    s.planes[0].pilotId = s.pilots[1].id;
    s.planes[1].pilotId = s.pilots[2].id;

    AF.sim.checkUnlocks(s, true);
    AF.sim.generateMissions(s);
    AF.sim.generateRecruits(s);
    AF.sim.log(s, `You have taken command of ${AF.STATION_NAME}: a grass strip, a blister hangar, and three aircraft. Group HQ expects results.`, 'day');
    return s;
  };

  // ?sandbox in the URL starts a throwaway game that never touches the saved one.
  AF.sandbox = new URLSearchParams(location.search).has('sandbox');

  AF.save = function (s) {
    if (AF.sandbox || !s || s.demo) return true; // the title screen's demo station is never saved
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(s));
      return true;
    } catch (e) {
      return false;
    }
  };

  AF.load = function () {
    if (AF.sandbox) return null;
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || s.version !== 1) return null;
      return AF.migrate(s);
    } catch (e) {
      return null;
    }
  };

  // Bring saves from earlier versions up to date with fields added since.
  AF.migrate = function (s) {
    for (const id of AF.BUILDING_ORDER) s.buildings[id] ??= { level: 0 };
    s.craters ??= [];
    s.craterWork ??= 0;
    s.hangarDoorFreeAt ??= 0;
    s.raid ??= null;
    s.lastRaid ??= null;
    s.settings ??= { pauseOnRaid: true };
    s.settings.pauseOnRadio ??= true;
    s.radio ??= null;
    s.directive ??= null;
    s.stats.raids ??= 0;
    s.stats.enemyKills ??= 0;
    s.stats.directives ??= 0;
    s.flags ??= { unlocked: [] };
    for (const p of s.pilots) p.kills ??= 0;
    for (const p of s.planes) p.readiness ??= false;
    for (const f of s.flights) {
      f.tactic ??= 'standard';
      f.mod ??= AF.sim.newMod();
      f.planeRisk ??= {};
    }
    return s;
  };

  AF.clearSave = function () {
    if (AF.sandbox) return;
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  };
})(window.AF);
