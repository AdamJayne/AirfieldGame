// Static game data: aircraft, buildings, missions, names and tuning constants.
window.AF = window.AF || {};
(function (AF) {
  'use strict';

  AF.STATION_NAME = 'RAF Thornbury Down';
  AF.SQUADRON_CODE = 'TF';
  AF.START_DATE = new Date(1940, 5, 1); // 1 June 1940
  // One game minute ≈ one real second at 1x, so taxiing and landing play at a natural pace.
  // Animations run on game time, so they speed up and pause with the clock.
  AF.MINUTES_PER_SECOND = 1;            // game minutes per real second at 1x
  AF.SPEEDS = [0, 1, 4, 12];            // speed multipliers by index (0 = paused)

  // Ground phases of every sortie, in game minutes. Mission "hours" are time in the air;
  // these are added on top.
  AF.FLIGHT = {
    taxiOut: 45,        // engine start, taxi to the runway, take-off and climb away
    landing: 50,        // join the circuit, land, and taxi back to dispersal
    stagger: 4,         // gap between successive aircraft in the same flight
    scrambleTaxi: 8,    // fighters scrambling for a raid get away much faster
    scrambleStagger: 2,
    readyTaxi: 3,       // ...and faster still from readiness, with the pilot already strapped in
    readyStagger: 1,
    tow: 30,            // towing an aircraft between dispersal and a hangar bay
    doorGap: 8,         // minimum gap between aircraft moving through the hangar doors
  };

  AF.PRICES = { fuel: 1, parts: 4, mechanics: 80, groundCrew: 50 };
  AF.WAGES = { pilot: 15, enlisted: 5 };

  // stat values are 1-10ish. span/length are drawing sizes in canvas pixels.
  AF.PLANE_TYPES = {
    tigermoth: {
      name: 'de Havilland Tiger Moth', short: 'Tiger Moth', role: 'Trainer',
      cost: 400, combat: 1, speed: 1, armor: 1, fuelUse: 8,
      hangarLevel: 1, runwayLevel: 1, minRep: 0,
      biplane: true, engines: 1, color: '#c8b26a', span: 30, length: 24,
      blurb: 'A forgiving two-seat trainer. Unarmed in any meaningful sense.',
    },
    gladiator: {
      name: 'Gloster Gladiator', short: 'Gladiator', role: 'Fighter',
      cost: 900, combat: 3, speed: 2, armor: 2, fuelUse: 15,
      hangarLevel: 1, runwayLevel: 1, minRep: 0,
      biplane: true, engines: 1, color: '#8e9868', span: 30, length: 25,
      blurb: 'The last of the biplane fighters. Nimble, but outclassed.',
    },
    lysander: {
      name: 'Westland Lysander', short: 'Lysander', role: 'Recon',
      cost: 1400, combat: 2, speed: 2, armor: 3, fuelUse: 18,
      hangarLevel: 1, runwayLevel: 1, minRep: 12,
      engines: 1, color: '#7b845d', span: 38, length: 27,
      blurb: 'Army co-operation aircraft. Excellent for reconnaissance work.',
    },
    hurricane: {
      name: 'Hawker Hurricane Mk I', short: 'Hurricane', role: 'Fighter',
      cost: 2400, combat: 6, speed: 3, armor: 4, fuelUse: 28,
      hangarLevel: 2, runwayLevel: 1, minRep: 25,
      engines: 1, color: '#6d7a51', span: 34, length: 28,
      blurb: 'Rugged eight-gun monoplane fighter, easy to repair.',
    },
    blenheim: {
      name: 'Bristol Blenheim Mk IV', short: 'Blenheim', role: 'Bomber',
      cost: 3200, combat: 5, speed: 3, armor: 5, fuelUse: 45,
      hangarLevel: 2, runwayLevel: 2, minRep: 40,
      engines: 2, color: '#5d6847', span: 46, length: 32,
      blurb: 'Twin-engined light bomber. Needs a proper runway.',
    },
    spitfire: {
      name: 'Supermarine Spitfire Mk I', short: 'Spitfire', role: 'Fighter',
      cost: 4500, combat: 8, speed: 4, armor: 4, fuelUse: 32,
      hangarLevel: 3, runwayLevel: 2, minRep: 65,
      engines: 1, elliptical: true, color: '#718057', span: 34, length: 28,
      blurb: 'Thoroughbred interceptor. Every pilot wants one.',
    },
  };

  // levels[i] describes level i+1. cost/hours on levels[i] are the price to reach it.
  AF.BUILDINGS = {
    runway: {
      name: 'Runway',
      desc: 'Better surfaces speed up turnaround and allow heavier, twin-engined aircraft.',
      levels: [
        { label: 'Grass Strip' },
        { label: 'Tarmac Runway', cost: 3000, hours: 36 },
        { label: 'Extended Runway', cost: 6500, hours: 60 },
      ],
    },
    hangar: {
      name: 'Maintenance Hangar',
      desc: 'Repairs damaged aircraft. Each level adds a repair bay, more parking, and access to modern types.',
      levels: [
        { label: 'Blister Hangar' },
        { label: 'Bellman Hangar', cost: 2000, hours: 24 },
        { label: 'Type-C Hangar', cost: 5000, hours: 48 },
      ],
    },
    officers: {
      name: "Officers' Barracks",
      desc: 'Houses your pilots. Better quarters hold more pilots and help them recover from fatigue.',
      levels: [
        { label: "Officers' Huts" },
        { label: "Officers' Quarters", cost: 1200, hours: 18 },
        { label: "Officers' Mess & Quarters", cost: 3000, hours: 36 },
      ],
    },
    enlisted: {
      name: 'Enlisted Barracks',
      desc: 'Houses mechanics and ground crew, the people who keep the aircraft flying.',
      levels: [
        { label: 'Bell Tents' },
        { label: 'Nissen Huts', cost: 1000, hours: 16 },
        { label: 'Brick Barrack Blocks', cost: 2500, hours: 30 },
      ],
    },
    fuelDepot: {
      name: 'Fuel Depot',
      desc: 'Stores aviation spirit. Without one you can only keep a few hundred gallons in drums.',
      levels: [
        { label: 'Bowser Park', cost: 800, hours: 12 },
        { label: 'Buried Tanks', cost: 2000, hours: 24 },
        { label: 'Bulk Fuel Installation', cost: 4000, hours: 40 },
      ],
    },
    mess: {
      name: 'Mess Hall',
      desc: 'Hot food and a warm stove. Raises the level that morale settles toward.',
      levels: [
        { label: 'NAAFI Canteen', cost: 900, hours: 12 },
        { label: 'Station Mess Hall', cost: 2200, hours: 24 },
      ],
    },
    tower: {
      name: 'Control Tower',
      desc: 'Better coordination with Group HQ: more missions offered, better odds in the air, and earlier raid warnings.',
      levels: [
        { label: 'Watch Office', cost: 1500, hours: 20 },
        { label: 'Control Tower', cost: 3500, hours: 36 },
      ],
    },
    defenses: {
      name: 'Anti-Aircraft Defences',
      desc: 'Guns to meet enemy raids, shooting bombers down before they can drop their loads.',
      levels: [
        { label: 'Lewis Gun Posts', cost: 700, hours: 10 },
        { label: 'Bofors 40 mm Battery', cost: 2200, hours: 24 },
        { label: 'Heavy AA & Searchlights', cost: 4500, hours: 40 },
      ],
    },
    pens: {
      name: 'Blast Pens',
      desc: 'Revetments between parked aircraft, so a bomb that falls on the apron can only reach one machine.',
      levels: [
        { label: 'Earth Revetments', cost: 900, hours: 16 },
        { label: 'Brick Blast Pens', cost: 2400, hours: 30 },
      ],
    },
  };
  AF.BUILDING_ORDER = ['runway', 'hangar', 'officers', 'enlisted', 'fuelDepot', 'mess', 'tower', 'defenses', 'pens'];

  // Air raid tuning. Index arrays by (effective) building level.
  AF.RAID = {
    aaKill: [0.03, 0.1, 0.18, 0.28],  // chance per bomber of being shot down by AA
    penProtect: [0, 0.5, 0.75],        // chance a bomb on a parked aircraft is absorbed by its pen
    craterHours: 3,                    // hours for a base crew to fill one crater
    rushCrater: 150,                   // £ per crater for civilian contractors
    approach: 12,                      // minutes the formation is in sight before it reaches the field;
                                       // the battle is decided then, and each bomb lands at its own minute
    bomberTypes: ['Heinkel He 111', 'Dornier Do 17', 'Junkers Ju 88'],
  };

  // stat: which aircraft stat drives success ('combat', 'speed', or 'none' = always succeeds)
  // kills: enemy aircraft an average fighter pilot claims per sortie when the mission succeeds
  AF.MISSION_TYPES = [
    {
      id: 'training', name: 'Training Flight', stat: 'none',
      desc: 'Circuits and bumps over the field. Safe experience for green pilots.',
      minPlanes: 1, maxPlanes: 3, hours: 2, difficulty: 0, risk: 0.02,
      funds: 30, rep: 0, xp: 14, minRep: 0, kills: 0,
      places: ['the home circuit', 'the practice range'],
    },
    {
      id: 'patrol', name: 'Coastal Patrol', stat: 'combat',
      desc: 'Fly the coastline and report any shipping or aircraft.',
      minPlanes: 1, maxPlanes: 2, hours: 3, difficulty: 3, risk: 0.10,
      funds: 200, rep: 2, xp: 10, minRep: 0, kills: 0.2,
      places: ['the Thames Estuary', 'the Dover Strait', 'the Kent coast', 'Beachy Head'],
    },
    {
      id: 'recon', name: 'Reconnaissance', stat: 'speed',
      desc: 'Photograph enemy positions across the Channel. Speed is life; Lysanders excel.',
      minPlanes: 1, maxPlanes: 1, hours: 4, difficulty: 3, risk: 0.18,
      funds: 320, rep: 3, xp: 14, minRep: 4, kills: 0,
      places: ['Calais harbour', 'Boulogne', 'Dunkirk', 'the Pas-de-Calais'],
    },
    {
      id: 'convoy', name: 'Convoy Escort', stat: 'combat',
      desc: 'Cover a merchant convoy as it runs the Channel.',
      minPlanes: 2, maxPlanes: 4, hours: 5, difficulty: 8, risk: 0.20,
      funds: 550, rep: 4, xp: 16, minRep: 10, kills: 0.35,
      places: ['convoy CW-8', 'convoy OA-178', 'convoy Bread', 'convoy Peewit'],
    },
    {
      id: 'intercept', name: 'Intercept Raid', stat: 'combat',
      desc: 'Enemy bombers inbound. Scramble and break them up before they reach the target.',
      minPlanes: 2, maxPlanes: 5, hours: 2, difficulty: 15, risk: 0.30,
      funds: 900, rep: 6, xp: 20, minRep: 22, kills: 0.7,
      places: ['Portsmouth', 'Manston', 'Dover', 'Hawkinge', 'Detling'],
    },
    {
      id: 'strike', name: 'Bombing Strike', stat: 'combat', requiresRole: 'Bomber',
      desc: 'Hit invasion barges and airfields across the Channel. Requires at least one bomber.',
      minPlanes: 2, maxPlanes: 4, hours: 5, difficulty: 16, risk: 0.32,
      funds: 1300, rep: 8, xp: 20, minRep: 40, kills: 0.1,
      places: ['barges at Ostend', 'Abbeville airfield', 'Saint-Omer', 'Antwerp docks'],
    },
    {
      id: 'sweep', name: 'Fighter Sweep', stat: 'combat',
      desc: 'Seek out and engage enemy fighters over France.',
      minPlanes: 3, maxPlanes: 6, hours: 3, difficulty: 26, risk: 0.38,
      funds: 1700, rep: 10, xp: 24, minRep: 60, kills: 0.6,
      places: ['Cap Gris-Nez', 'Lille', 'Saint-Omer', 'the Somme estuary'],
    },
  ];

  // How a flight is told to fly a mission, chosen at launch.
  AF.TACTICS = {
    cautious: { name: 'Cautious', desc: 'Keep height and avoid a brawl: much safer, weaker results.', success: -0.1, risk: 0.55, kills: 0.5, xp: 0.8 },
    standard: { name: 'Standard', desc: 'Fly the briefing.', success: 0, risk: 1, kills: 1, xp: 1 },
    aggressive: { name: 'Aggressive', desc: 'Press every attack home: better odds and more claims, at a price.', success: 0.1, risk: 1.6, kills: 1.5, xp: 1.25 },
  };

  // Radio calls: decisions the player makes while a flight is in the air. Each choice's fx
  // modifies the flight: success (added to the odds), risk / kills / reward / xp (multipliers),
  // time (minutes added to the flight), rep (bonus on success; always: paid at once),
  // detach (the named aircraft goes home), planeRisk (multiplier for the named aircraft),
  // gamble { p, win, lose, winText, loseText }. The first choice is what the flight leader does
  // if no order comes.
  AF.RADIO = {
    chance: 0.7,       // chance a mission brings a radio call
    answerTime: 10,    // game minutes before the flight leader decides alone
    events: [
      {
        id: 'bounce', types: ['patrol', 'convoy', 'sweep', 'intercept'],
        text: (c) => `${c.leader}: "Bandits, two o'clock high! A dozen 109s with the sun behind them."`,
        choices: [
          { label: 'Turn into them', hint: 'Fight it out: better odds and more claims, more danger', fx: { success: 0.08, risk: 1.4, kills: 1.5 }, say: 'Turning in. Tally-ho!' },
          { label: 'Dive for the cloud', hint: 'Live to fight another day: safer, weaker result', fx: { success: -0.12, risk: 0.6, kills: 0.4 }, say: 'Break, break! Down into the cloud.' },
        ],
      },
      {
        id: 'eboat', types: ['patrol'],
        text: (c) => `${c.leader}: "Small craft below, making for the French coast. Could be E-boats."`,
        choices: [
          { label: 'Go down and look', hint: 'A gamble: a sighting worth money and reputation, or a flak ship', fx: { gamble: { p: 0.55, win: { reward: 1.35, rep: 1 }, lose: { risk: 1.5 }, winText: 'E-boats! Position passed to the Navy.', loseText: 'Flak ships. They hosed us with tracer.' } } },
          { label: 'Report and press on', hint: 'No change', fx: {}, say: 'Noted. Continuing the patrol.' },
        ],
      },
      {
        id: 'headwind', types: ['patrol', 'recon', 'convoy', 'strike', 'sweep'],
        text: (c) => `${c.leader}: "Headwinds stronger than forecast. Fuel's getting tight."`,
        choices: [
          { label: 'Press on', hint: 'Finish the job: riskier on the way home', fx: { risk: 1.3 }, say: 'Pressing on.' },
          { label: 'Cut it short', hint: 'Home 30 minutes early with a weaker result', fx: { success: -0.12, time: -30 }, say: 'Turning for home.' },
        ],
      },
      {
        id: 'flak', types: ['recon', 'strike'],
        text: (c) => `${c.leader}: "Flak's thick over ${c.place}. They know we're coming."`,
        choices: [
          { label: 'Go in low', hint: 'Better results and pay, far more dangerous', fx: { success: 0.14, risk: 1.5, reward: 1.15 }, say: 'Going in low.' },
          { label: 'Stay high', hint: 'Safer, less accurate', fx: { success: -0.07, risk: 0.75 }, say: 'Holding at height.' },
        ],
      },
      {
        id: 'secondrun', types: ['recon'],
        text: (c) => `${c.leader}: "Cloud over the target on the first run. The photos might be useless."`,
        choices: [
          { label: 'Make a second run', hint: 'Better photos, but they will be waiting: +15 min', fx: { success: 0.15, risk: 1.6, time: 15 }, say: 'Coming round again.' },
          { label: 'Head for home', hint: 'Take what we have', fx: { success: -0.08 }, say: 'Heading home.' },
        ],
      },
      {
        id: 'stukas', types: ['convoy'],
        text: (c) => `${c.leader}: "Stukas diving on the convoy! Their escort is still above."`,
        choices: [
          { label: 'Go for the Stukas', hint: 'Save the ships: much better odds and claims, the escort will bounce us', fx: { success: 0.14, risk: 1.4, kills: 1.6 }, say: 'Going for the Stukas!' },
          { label: 'Take on the escort', hint: 'Safer for us; the ships take their chances', fx: { success: 0.02, risk: 1.1, kills: 1.1 }, say: 'Climbing for the escort.' },
        ],
      },
      {
        id: 'survivors', types: ['convoy', 'patrol'],
        text: (c) => `${c.leader}: "Ship burning below, and men in the water."`,
        choices: [
          { label: 'Circle and fix their position', hint: '+20 min aloft and a little exposed; +1 reputation whatever happens', fx: { time: 20, risk: 1.15, rep: 1, always: true }, say: 'Circling. Sending their position.' },
          { label: 'Stay on task', hint: 'No change', fx: {}, say: 'Staying on task.' },
        ],
      },
      {
        id: 'tallyho', types: ['intercept'],
        text: (c) => `${c.leader}: "Tally-ho! Bombers below, fighters weaving above them."`,
        choices: [
          { label: 'Attack head-on', hint: 'Break up the formation: best odds, highest risk', fx: { success: 0.12, risk: 1.5, kills: 1.3 }, say: 'Head-on. Go!' },
          { label: 'Attack from astern', hint: 'Steady and methodical: more claims', fx: { kills: 1.2 }, say: 'Line astern, follow me in.' },
          { label: 'Tie up the escort', hint: 'Fewer claims, safer for our pilots', fx: { success: -0.05, risk: 0.8, kills: 0.7 }, say: 'Keep their fighters busy.' },
        ],
      },
      {
        id: 'chase', types: ['intercept', 'sweep'],
        text: (c) => `${c.leader}: "They're running for home. We could catch them over the Channel."`,
        choices: [
          { label: 'Give chase', hint: 'More claims, more risk, +20 min', fx: { kills: 1.5, risk: 1.3, time: 20 }, say: 'After them!' },
          { label: 'Let them go', hint: 'Bring everyone home', fx: { risk: 0.85 }, say: 'Let them go. Reform on me.' },
        ],
      },
      {
        id: 'barges', types: ['strike'],
        text: (c) => `${c.leader}: "Barges packed into the canal beside the target."`,
        choices: [
          { label: 'Hit the barges too', hint: 'A bigger pay-off for longer over the target', fx: { reward: 1.35, risk: 1.25 }, say: 'Second run on the barges.' },
          { label: 'Stick to the plan', hint: 'No change', fx: {}, say: 'Sticking to the plan.' },
        ],
      },
      {
        id: 'weather', types: ['patrol', 'recon', 'convoy', 'strike', 'sweep'],
        text: (c) => `${c.leader}: "Cloud's down to the deck over ${c.place}. Can't see a thing."`,
        choices: [
          { label: 'Go under it', hint: 'Low and dangerous, but we will find the target', fx: { success: 0.06, risk: 1.3 }, say: 'Going under.' },
          { label: 'Climb over it', hint: 'Safe, but we may miss everything', fx: { success: -0.1, risk: 0.8 }, say: 'Climbing over the top.' },
        ],
      },
      {
        id: 'engine', types: ['patrol', 'recon', 'convoy', 'intercept', 'strike', 'sweep'], minPlanes: 2, onePlane: true,
        text: (c) => `${c.pilot} (${c.code}): "Engine's running rough. Oil temperature's climbing."`,
        choices: [
          { label: 'Stay with the flight', hint: 'Keep our strength, but that aircraft may not make it back', fx: { planeRisk: 3 }, say: 'Staying with you, Leader.' },
          { label: (c) => `Send ${c.code} home`, hint: 'It lands early and safely; the flight is a machine short', fx: { detach: true }, say: 'Heading home. Good luck.' },
        ],
      },
    ],
    // asked once per raid, as the scrambled fighters close with the formation
    scramble: {
      id: 'vector',
      text: (c) => `Controller: "${c.bombers} ${c.type}s at Angels 15${c.escorts ? `, ${c.escorts} 109s above them` : ''}. Vector one-two-zero, buster."`,
      choices: [
        { label: 'Go for the bombers', hint: 'Stop the most bombers; the escort will bounce us', fx: { kills: 1.3, risk: 1.4 }, say: 'Going for the bombers.' },
        { label: 'Go head-on through the formation', hint: 'Scatter them: more turn back, fewer shot down', fx: { turnBack: 2.2, kills: 0.8, risk: 1.2 }, say: 'Head-on, line abreast!' },
        { label: 'Pick off stragglers', hint: 'Safer for us; more bombs reach the field', fx: { kills: 0.6, risk: 0.6 }, say: 'Wait for the stragglers.' },
      ],
    },
  };

  // Orders from Group with a deadline. Progress is counted by the simulation.
  AF.DIRECTIVES = {
    chance: 0.6,       // chance each dawn of a new order when none is open
    fail: { rep: 2, morale: 3 },
  };

  AF.ACE_KILLS = 5;
  AF.READINESS_FATIGUE = 1.5;   // fatigue per hour for a pilot waiting at readiness (instead of resting)
  AF.READINESS_EDGE = 1.2;      // interception strength of fighters scrambled from readiness (height advantage)

  AF.RANKS = [
    { min: 0, name: 'Pilot Officer', abbr: 'P/O' },
    { min: 5, name: 'Flying Officer', abbr: 'F/O' },
    { min: 15, name: 'Flight Lieutenant', abbr: 'F/Lt' },
    { min: 30, name: 'Squadron Leader', abbr: 'S/Ldr' },
  ];

  AF.FIRST_NAMES = [
    'James', 'John', 'Peter', 'Geoffrey', 'Douglas', 'Alan', 'Brian', 'Colin', 'Dennis', 'Eric',
    'Frank', 'George', 'Harold', 'Ian', 'Kenneth', 'Leonard', 'Michael', 'Norman', 'Richard',
    'Robert', 'Tom', 'William', 'Hugh', 'Archie', 'Billy', 'Tony', 'Roger', 'Jan', 'Witold',
    'Josef', 'Patrick', 'Desmond', 'Rupert', 'Cyril', 'Arthur', 'Stanley',
  ];
  AF.LAST_NAMES = [
    'Ashworth', 'Pemberton', 'Holloway', 'Whitcombe', 'Fairbanks', 'Thorne', 'Harker', 'Rimmer',
    'Crossley', 'Kingsley', 'Barton', 'Fenwick', 'Gray', 'Hollis', 'Mackenzie', 'Fraser',
    'Dunmore', 'Lyall', 'Prescott', 'Radcliffe', 'Sheldon', 'Talbot', 'Vickery', 'Waring',
    'Nowak', 'Kowalczyk', 'Dvořák', 'O\'Hara', 'Llewellyn', 'Pritchard', 'Hastings', 'Calloway',
  ];
})(window.AF);
