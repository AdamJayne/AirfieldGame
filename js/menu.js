// Title menu (with the demo station playing behind it), the How to Play guide, and the
// welcome card for a new game.
(function (AF) {
  'use strict';

  const S = AF.sim;
  const M = (AF.menu = { open: false, held: null, guideSpeed: null });
  const $ = (id) => document.getElementById(id);

  // ---------- menu ----------
  M.init = function () {
    $('menu').addEventListener('click', (e) => {
      const b = e.target.closest('[data-menu]');
      if (b) act(b.dataset.menu);
    });
    $('guide').addEventListener('click', (e) => {
      if (e.target.id === 'guide') return M.closeGuide();
      const b = e.target.closest('[data-guide]');
      if (!b) return;
      if (b.dataset.guide === 'close') M.closeGuide();
      else showPage(b.dataset.guide);
    });
    $('welcome').addEventListener('click', (e) => {
      const b = e.target.closest('[data-welcome]');
      if (!b) return;
      $('welcome').hidden = true;
      if (b.dataset.welcome === 'guide') M.openGuide('basics');
    });
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && !$('guide').hidden) { e.stopImmediatePropagation(); M.closeGuide(); }
    }, true);
  };

  // True while the menu or guide covers the game (keyboard shortcuts stay off).
  M.blocking = () => M.open || !$('guide').hidden;

  // The player's own game, if there is one (in play or set aside while the menu is up).
  M.game = () => M.held || (AF.state && !AF.state.demo ? AF.state : null);

  M.show = function () {
    const s = AF.state;
    if (s && !s.demo) {
      AF.save(s);
      M.held = s;
    }
    M.open = true;
    document.body.classList.add('menu-open');
    $('welcome').hidden = true;
    startDemo();
    if (AF.view.setCinematic) AF.view.setCinematic(true);
    renderMenu();
    $('menu').hidden = false;
  };

  function startDemo() {
    AF.state = AF.demo.create();
    if (AF.view.reset) AF.view.reset();
    AF.ui.select(null);
  }

  function enterGame(s) {
    M.open = false;
    M.held = null;
    $('menu').hidden = true;
    document.body.classList.remove('menu-open');
    if (AF.view.setCinematic) AF.view.setCinematic(false);
    AF.state = s;
    if (AF.view.reset) AF.view.reset();
    AF.ui.resetSession();
    AF.ui.select(null);
    AF.ui.setTab('station');
    AF.dirty = true;
    AF.ui.update(true);
  }

  function act(what) {
    if (what === 'resume') {
      const s = M.held || AF.load();
      if (s) enterGame(s);
    } else if (what === 'new') {
      const start = () => {
        AF.clearSave();
        const s = AF.newGame();
        enterGame(s);
        AF.save(s);
        $('welcome').innerHTML = welcomeHtml();
        $('welcome').hidden = false;
      };
      if (M.held || AF.load()) {
        AF.ui.confirm('Start a new station? Your current game will be lost.', 'Start new game', () => { start(); return null; });
      } else start();
    } else if (what === 'guide') {
      M.openGuide('basics');
    } else if (what === 'about') {
      const a = $('menu').querySelector('.menu-about');
      a.hidden = !a.hidden;
    }
  }

  function savedSummary() {
    const s = M.held || AF.load();
    if (!s) return null;
    return `Day ${AF.dayNum(s.time)} · ${AF.clock(s.time)} · ${s.planes.length} aircraft · reputation ${Math.floor(s.rep)}`;
  }

  function renderMenu() {
    const saved = savedSummary();
    $('menu').innerHTML = `
      <div class="menu-shade"></div>
      <div class="menu-panel">
        <svg class="menu-roundel" viewBox="0 0 40 40" aria-hidden="true">
          <circle cx="20" cy="20" r="19" fill="#e2b72e"/><circle cx="20" cy="20" r="16.5" fill="#1f3a6b"/>
          <circle cx="20" cy="20" r="11" fill="#ece8dc"/><circle cx="20" cy="20" r="6" fill="#b02a23"/>
        </svg>
        <h1 class="menu-title">Airfield Command</h1>
        <div class="menu-sub">${AF.STATION_NAME} · Summer 1940</div>
        <p class="menu-blurb">Take command of a fighter station through the Battle of Britain. Fly Group's missions,
          build up the station, train your pilots, and hold out against the raids.</p>
        <div class="menu-buttons">
          ${saved ? `<button class="mb primary" data-menu="resume"><b>Resume</b><span>${saved}</span></button>` : ''}
          <button class="mb${saved ? '' : ' primary'}" data-menu="new"><b>${saved ? 'New game' : 'Play'}</b>
            <span>${saved ? 'Start again with a fresh station' : 'A grass strip, three old aircraft, three green pilots'}</span></button>
          <button class="mb" data-menu="guide"><b>How to play</b><span>Missions, radio calls, raids, the station and the controls</span></button>
          <button class="mb" data-menu="about"><b>About</b><span>What this is</span></button>
        </div>
        <div class="menu-about" hidden>
          A management game set on a fictional RAF fighter station in the summer of 1940. The squadron, station and pilots are
          invented; the aircraft, and the way a station worked, are as close to the real thing as a game allows. Everything you
          see is generated in code (no image or model files), drawn with Three.js.
        </div>
        <div class="menu-foot">${AF.sandbox ? 'Sandbox mode: nothing is saved.' : 'Your station is saved in this browser automatically.'}</div>
      </div>
      <div class="menu-ticker"><div class="mt-head"><span class="mt-dot"></span>Operations room</div><div class="mt-lines"></div></div>`;
  }

  // Called every frame: run the demo, and show its log in the ticker.
  M.frame = function () {
    if (!M.open) return;
    const s = AF.state;
    if (s.demo && AF.demo.tick(s) === 'restart') startDemo();
    const el = $('menu').querySelector('.mt-lines');
    if (!el) return;
    const lines = AF.state.log.filter((e) => /raid|mission|success|warn/.test(e.kind)).slice(0, 3);
    const key = lines.map((e) => e.t + e.text).join('|');
    if (key === el._key) return;
    el._key = key;
    el.innerHTML = lines.map((e) => `<div class="mt-line ${e.kind}"><span>${AF.clock(e.t)}</span>${e.text.replace(/^[✔✖] /, '')}</div>`).join('');
  };

  // ---------- guide ----------
  const PAGES = [
    ['basics', 'Your command'],
    ['view', 'The airfield'],
    ['missions', 'Missions'],
    ['radio', 'Radio calls'],
    ['raids', 'Air raids'],
    ['aircraft', 'Aircraft & pilots'],
    ['station', 'Station & supply'],
    ['tips', 'Tips'],
  ];

  M.openGuide = function (page) {
    if (!M.open && AF.state && !AF.state.demo && M.guideSpeed === null) { // pause the game while reading
      M.guideSpeed = AF.state.speed;
      AF.ui.setSpeed(0);
    }
    $('guide').innerHTML = `<div class="guide-box" role="dialog" aria-modal="true" aria-label="How to play">
        <div class="guide-head"><h2>How to Play</h2><button class="ib-close" data-guide="close" title="Close (Esc)">×</button></div>
        <div class="guide-body">
          <nav class="guide-nav">${PAGES.map(([id, name]) => `<button data-guide="${id}">${name}</button>`).join('')}</nav>
          <article class="guide-page"></article>
        </div>
      </div>`;
    $('guide').hidden = false;
    showPage(page || 'basics');
  };

  M.closeGuide = function () {
    $('guide').hidden = true;
    if (M.guideSpeed !== null) {
      if (AF.state && !AF.state.demo && M.guideSpeed > 0) AF.ui.setSpeed(M.guideSpeed);
      M.guideSpeed = null;
    }
  };

  function showPage(id) {
    const page = $('guide').querySelector('.guide-page');
    page.innerHTML = (GUIDE[id] || GUIDE.basics)();
    page.scrollTop = 0;
    $('guide').querySelectorAll('.guide-nav button').forEach((b) => b.classList.toggle('on', b.dataset.guide === id));
  }

  const pct = (x) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.round(Math.abs(x) * 100)}%`;
  const mul = (x) => `×${x}`;

  const GUIDE = {
    basics: () => `
      <h3>Your command</h3>
      <p>It is June 1940. You have just taken over <b>${AF.STATION_NAME}</b>: a grass strip, a blister hangar, a couple of
        huts and some tents, two Tiger Moth trainers, one Gloster Gladiator, and three green pilots.</p>
      <p>Group HQ sends you <b>missions</b>. Flying them earns <b>funds</b> and <b>reputation</b>. Funds pay for new buildings,
        aircraft, pilots and stores; reputation makes Group trust you with harder missions and makes the Air Ministry release
        better aircraft, up to Hurricanes, Blenheims and Spitfires.</p>
      <p>From the first week on, the Luftwaffe raids the station, and the better known you become, the more often they come.</p>
      <h4>A day at the station</h4>
      <ul>
        <li><b>Midnight:</b> the Air Ministry allowance arrives and wages are paid. New missions and pilot candidates are posted,
          and Group may issue a <b>directive</b> with a deadline.</li>
        <li><b>All day:</b> launch missions, answer the radio when flights call in, refuel and repair aircraft, build, and watch for
          raid warnings.</li>
        <li>Pilots tire as they fly and recover in their quarters. Aircraft need refuelling after every sortie, and repairs
          when they come back damaged.</li>
      </ul>
      <h4>Time</h4>
      <p>At normal speed one game minute passes each second, so a day takes 24 minutes. Use the speed buttons (or keys 1–3) to go
        4× or 12× faster, and <span class="key">Space</span> to pause. Everything you see on the airfield runs on the game
        clock, so pausing freezes it too.</p>
      <p>The game saves itself each day and whenever you leave. <b>Menu</b> (top right) takes you back to the title screen;
        <b>Guide</b> opens this page.</p>`,

    view: () => `
      <h3>The airfield</h3>
      <p>The big view is your station. <b>Click</b> any building or aircraft to select it: the camera centres on it and an
        <b>info box</b> opens with its details and orders (upgrade a building, assign a pilot, send an aircraft for repair,
        put a fighter at readiness, sell it). The <b>command panel</b> on the right has the same orders, grouped by tab.</p>
      <table class="gt">
        <tr><th>Input</th><th>Action</th></tr>
        <tr><td>Click</td><td>Select a building or aircraft</td></tr>
        <tr><td>Double-click</td><td>Zoom right in on it</td></tr>
        <tr><td>Drag</td><td>Rotate the view</td></tr>
        <tr><td>Right-drag, Shift-drag, <span class="key">W</span><span class="key">A</span><span class="key">S</span><span class="key">D</span> or arrows</td><td>Pan</td></tr>
        <tr><td>Scroll, <span class="key">R</span> / <span class="key">F</span></td><td>Zoom</td></tr>
        <tr><td><span class="key">Q</span> / <span class="key">E</span></td><td>Rotate</td></tr>
        <tr><td><span class="key">H</span></td><td>Reset the view</td></tr>
        <tr><td><span class="key">Space</span></td><td>Pause or resume</td></tr>
        <tr><td><span class="key">1</span>–<span class="key">3</span></td><td>Game speed</td></tr>
        <tr><td><span class="key">Esc</span></td><td>Close the info box or this guide</td></tr>
      </table>
      <h4>What you'll see</h4>
      <ul>
        <li>Aircraft taxi out, take off, and land on the game clock, so what you see always matches their status.</li>
        <li>After a sortie a <b>bowser</b> pulls up to refuel. Damaged aircraft are <b>towed</b> to the hangar by a tractor.</li>
        <li>Fighters at <b>readiness</b> have their pilot in the cockpit and a starter trolley plugged in. Pilots who are off
          duty wait in deckchairs by the <b>dispersal hut</b>.</li>
        <li>Buildings under construction are wrapped in scaffolding; new ones rise out of their sites.</li>
        <li>The current <b>Group directive</b> is pinned to the top right of the view; click it to see the Missions tab.</li>
      </ul>`,

    missions: () => `
      <h3>Missions</h3>
      <p>Open the <b>Missions</b> tab. Each order from Group shows its pay, reputation, opposition, risk, flight time and
        expiry. Tick the aircraft to send (each needs a fit pilot), choose a <b>tactic</b>, and press <b>Launch</b>.</p>
      <p>The <b>success chance</b> shown depends on the aircraft (combat, or speed for reconnaissance), the pilots' skill, the
        airframes' condition, station morale, the control tower, and the tactic. Success pays in full; failure pays a quarter
        and costs a point of reputation. Either way, aircraft can come back damaged, or not at all.</p>
      <h4>Tactics</h4>
      <table class="gt">
        <tr><th>Tactic</th><th>Success</th><th>Risk</th><th>Claims</th><th></th></tr>
        ${Object.values(AF.TACTICS).map((t) => `<tr><td><b>${t.name}</b></td><td>${pct(t.success) || '—'}</td><td>${mul(t.risk)}</td><td>${mul(t.kills)}</td><td>${t.desc}</td></tr>`).join('')}
      </table>
      <h4>Mission types</h4>
      <table class="gt">
        <tr><th>Mission</th><th>From reputation</th><th>Aircraft</th><th>Hours aloft</th><th></th></tr>
        ${AF.MISSION_TYPES.map((t) => `<tr><td><b>${t.name}</b></td><td>${t.minRep}</td><td>${t.minPlanes === t.maxPlanes ? t.minPlanes : `${t.minPlanes}–${t.maxPlanes}`}</td><td>${t.hours}</td><td>${t.desc}</td></tr>`).join('')}
      </table>
      <p>A sortie also spends about ${Math.round((AF.FLIGHT.taxiOut + AF.FLIGHT.landing) / 6) / 10} hours taxiing, taking off and
        landing, then each aircraft needs refuelling. Every mission burns fuel, so keep the tanks topped up (Supply tab).</p>`,

    radio: () => `
      <h3>Radio calls</h3>
      <p>Most missions call in once while they're out: bandits in the sun, flak over the target, men in the water, an engine
        running rough. A card appears over the airfield with two or three orders to choose from, each with a note on what it
        trades. Better odds usually mean more danger; safety usually means a weaker result.</p>
      <ul>
        <li>The game <b>pauses</b> while a call is waiting (turn this off under Supply → Standing Orders).</li>
        <li>If nobody answers within ${AF.RADIO.answerTime} game minutes, the flight leader takes the <b>first option</b>.</li>
        <li>Some calls are gambles: going down to look at a contact might find E-boats worth a report, or a flak ship.</li>
        <li>Sending a sick aircraft home brings it back safely but leaves the flight a machine short.</li>
        <li>The Missions tab shows each airborne flight's current odds, so you can see what an order did.</li>
      </ul>
      <p>When your fighters scramble against a raid, the sector controller calls as they close with the formation: go for the
        bombers, go head-on to scatter them, or hang back and pick off stragglers.</p>`,

    raids: () => `
      <h3>Air raids</h3>
      <p>From the first week, bombers raid the station, more often as your reputation grows; later raids bring fighter
        escorts, and some come at night. When a raid is plotted you get a <b>warning</b> (longer with a better control
        tower) and the game pauses.</p>
      <h4>Meeting the raid</h4>
      <ul>
        <li><b>Scramble.</b> The raid warning lists every fighter that can fly. Untick any you want to keep on the ground and press
          Scramble. You can send more up later, until the formation is in sight.</li>
        <li><b>Readiness.</b> A fighter set to readiness (Aircraft tab or its info box) has its pilot waiting in the cockpit: it gets
          away in ${AF.FLIGHT.readyTaxi} minutes instead of ${AF.FLIGHT.scrambleTaxi} and meets the raiders with height in hand
          (${mul(AF.READINESS_EDGE)} strength). Waiting wears the pilot down instead of letting them rest, so rotate pilots.</li>
        <li><b>Anti-aircraft guns</b> shoot bombers down as they arrive: Lewis guns, then Bofors, then heavy guns with searchlights,
          which work much better at night.</li>
        <li><b>Blast pens</b> shield parked aircraft: a bomb on the flight line often does only light damage instead of wrecking them.</li>
      </ul>
      <h4>After the raid</h4>
      <ul>
        <li><b>Craters</b> close the runway: nothing can take off, including a scramble against the next raid. Ground crews fill
          them; more ground crew fill them faster.</li>
        <li>A building with 50% damage or more works one level lower until it is repaired.</li>
        <li>You can pay civilian contractors to <b>rush repairs</b> (click the runway or the damaged building).</li>
      </ul>`,

    aircraft: () => `
      <h3>Aircraft & pilots</h3>
      <p>Requisition aircraft on the Aircraft tab once Group trusts you enough and the station can support them. Each needs a
        parking place (more come with each hangar level).</p>
      <table class="gt">
        <tr><th>Aircraft</th><th>Role</th><th>Combat</th><th>Speed</th><th>Armour</th><th>Cost</th><th>Needs</th></tr>
        ${Object.values(AF.PLANE_TYPES).map((t) => `<tr><td><b>${t.short}</b></td><td>${t.role}</td><td>${t.combat}</td><td>${t.speed}</td><td>${t.armor}</td><td>${AF.money(t.cost)}</td>
          <td>${[t.minRep ? `rep ${t.minRep}` : '', t.hangarLevel > 1 ? `hangar Lv ${t.hangarLevel}` : '', t.runwayLevel > 1 ? `runway Lv ${t.runwayLevel}` : ''].filter(Boolean).join(', ') || '—'}</td></tr>`).join('')}
      </table>
      <ul>
        <li>An aircraft below <b>50%</b> condition can't fly. With the standing order on, anything coming back below 60% goes
          straight to the hangar. Repairs use spare parts and go faster with more mechanics.</li>
        <li><b>Pilots</b> have a skill (1–10) that grows with experience, and are promoted as they fly more sorties. Above
          70 fatigue a pilot is too tired to fly. Wounded pilots spend a few days in hospital.</li>
        <li>Pilots claim <b>victories</b> on combat missions and against raids. Five make an <b>ace</b>, which lifts morale and
          your reputation.</li>
        <li>Hire new pilots from the candidates posted each day (Personnel tab). The officers' quarters limit how many you can house.</li>
      </ul>`,

    station: () => `
      <h3>Station & supply</h3>
      <p>Click a building (or use the Station tab) to see what it does and order an upgrade. Building takes time and money.</p>
      <table class="gt">
        <tr><th>Building</th><th>What it does</th><th>Levels</th></tr>
        ${AF.BUILDING_ORDER.map((id) => { const b = AF.BUILDINGS[id]; return `<tr><td><b>${b.name}</b></td><td>${b.desc}</td><td>${b.levels.map((l) => l.label).join(' → ')}</td></tr>`; }).join('')}
      </table>
      <h4>People and stores</h4>
      <ul>
        <li><b>Mechanics</b> repair aircraft. <b>Ground crew</b> refuel and rearm (shorter turnarounds), fill craters and patch
          bomb damage. Both live in the enlisted barracks.</li>
        <li><b>Fuel</b> is used by every sortie and stored up to your fuel depot's capacity. <b>Spare parts</b> are used by repairs.</li>
        <li>The <b>allowance</b> grows with reputation; <b>wages</b> are paid at midnight. Running into debt hurts morale.</li>
        <li><b>Morale</b> affects every mission and drifts toward a level set by the mess hall.</li>
      </ul>
      <h4>Group directives</h4>
      <p>Group sometimes issues a directive with a deadline: complete a number of missions of one type (Group posts them for
        you), destroy a number of enemy aircraft, or keep fighters at readiness from 10:00 to 16:00. Carry it out for money
        and reputation; miss it and you lose reputation.</p>`,

    tips: () => `
      <h3>Tips</h3>
      <ul>
        <li>Fly <b>training flights</b> with green pilots. They are safe, and skill matters in everything.</li>
        <li>Early money is tight. A <b>control tower</b> early gives more missions, better odds and longer raid warnings.</li>
        <li>Buy <b>fuel and parts</b> before you run dry: an empty fuel store grounds the station.</li>
        <li>Keep a fighter or two at <b>readiness</b> when raids are likely, and rotate tired pilots off it.</li>
        <li>Don't leave everything parked on the flight line during a raid without <b>blast pens</b>: a single stick of bombs
          can wreck several aircraft.</li>
        <li><b>Aggressive</b> tactics win reputation faster but cost aircraft and pilots. <b>Cautious</b> is for when you can't
          afford to lose anyone.</li>
        <li>A cratered runway can't scramble fighters. If another raid is likely, paying to rush the repairs can be worth it.</li>
      </ul>`,
  };

  // ---------- welcome card for a new game ----------
  function welcomeHtml() {
    return `<div class="wl-k">Welcome to ${AF.STATION_NAME}</div>
      <ol>
        <li>Open the <b>Missions</b> tab, tick your Gladiator for the <b>Coastal Patrol</b> and press Launch. Training flights
          give green pilots safe experience.</li>
        <li>When a flight radios for orders, pick one on the card that appears.</li>
        <li>Spend what you earn on the station (click any building) and on better aircraft as Group's trust grows.</li>
        <li>From day 4 the Luftwaffe raids. When the warning comes, <b>scramble</b> your fighters.</li>
      </ol>
      <div class="actions"><button class="primary" data-welcome="ok">Got it</button><button class="ghost" data-welcome="guide">Read the guide</button></div>`;
  }
})(window.AF);
