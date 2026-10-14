// DOM UI: header resources, tabbed command panel, contextual info box, raid banner,
// station log, tooltips, and dialogs.
(function (AF) {
  'use strict';

  const S = AF.sim;
  const UI = (AF.ui = {
    tab: 'station',
    picks: {},   // missionId -> array of selected planeIds
    tactics: {}, // missionId -> AF.TACTICS key
    scrambleSkip: new Set(), // fighters left out of the next scramble
  });
  const $ = (id) => document.getElementById(id);
  let lastLogKey = '';

  UI.init = function () {
    $('station').textContent = AF.STATION_NAME;

    document.querySelector('.tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (b) UI.setTab(b.dataset.tab);
    });

    $('speed').addEventListener('click', (e) => {
      const b = e.target.closest('[data-speed]');
      if (b) UI.setSpeed(Number(b.dataset.speed));
    });

    $('btn-save').addEventListener('click', () => {
      UI.toast(AF.save(AF.state) ? 'Game saved.' : 'Could not save — browser storage unavailable.');
    });
    $('btn-new').addEventListener('click', () => {
      UI.confirm('Abandon this station and start a new game? Your current progress will be lost.', 'Start new game', () => {
        AF.clearSave();
        AF.state = AF.newGame();
        UI.picks = {};
        UI.tactics = {};
        UI.scrambleSkip.clear();
        UI.select(null);
      });
    });

    $('modal-cancel').addEventListener('click', () => closeModal());
    $('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
    $('modal-ok').addEventListener('click', () => {
      const fn = UI._modalAction;
      closeModal();
      const err = fn && fn();
      if (err) UI.toast(err);
      AF.dirty = true;
      UI.update(true);
    });

    // Panel, info box, raid banner, radio card and orders chip share one set of action handlers.
    for (const el of [$('panel-body'), $('infobox'), $('raid-banner'), $('radio'), $('orders')]) {
      el.addEventListener('click', (e) => {
        const t = e.target.closest('[data-action]');
        if (!t || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && t.type === 'checkbox')) return;
        act(t.dataset.action, t.dataset, t);
      });
      el.addEventListener('change', (e) => {
        const t = e.target.closest('[data-action]');
        if (t) act(t.dataset.action, t.dataset, t);
      });
    }

    // canvas interaction
    const canvas = $('field');
    const tip = $('tooltip');
    canvas.addEventListener('mousemove', (e) => {
      if (e.buttons) { tip.hidden = true; AF.view.hover = null; return; } // dragging the camera
      const h = AF.view.pick(e);
      AF.view.hover = h;
      canvas.style.cursor = h ? 'pointer' : 'grab';
      if (!h) { tip.hidden = true; return; }
      tip.innerHTML = tooltipHtml(h);
      tip.hidden = false;
      const r = canvas.parentElement.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      tip.style.left = Math.min(x + 14, r.width - tip.offsetWidth - 6) + 'px';
      tip.style.top = Math.min(y + 14, r.height - tip.offsetHeight - 6) + 'px';
    });
    canvas.addEventListener('mouseleave', () => { AF.view.hover = null; tip.hidden = true; });
    canvas.addEventListener('click', (e) => {
      if (AF.view.dragged) return;
      UI.select(AF.view.pick(e), true);
    });

    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (!$('modal').hidden) closeModal();
        else UI.select(null);
        return;
      }
      if (e.target.matches('input, select, textarea') || !$('modal').hidden) return;
      if (e.code === 'Space') { e.preventDefault(); UI.setSpeed(AF.state.speed === 0 ? (UI.lastSpeed || 1) : 0); }
      else if (['Digit1', 'Digit2', 'Digit3'].includes(e.code)) UI.setSpeed(Number(e.code.slice(-1)));
    });
  };

  // Select an item (or null to clear): opens its info box and optionally centres the camera on it.
  UI.select = function (h, focus) {
    AF.view.selected = h ? { building: h.kind === 'building' ? h.id : null, plane: h.kind === 'plane' ? h.id : null } : { building: null, plane: null };
    if (h && focus && AF.view.focus) AF.view.focus(h, false);
    AF.dirty = true;
    UI.update(true);
  };

  UI.setTab = function (tab) {
    UI.tab = tab;
    document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    renderPanel(true);
  };

  UI.setSpeed = function (n) {
    if (n > 0) UI.lastSpeed = n;
    AF.state.speed = n;
    UI.updateHeader();
  };

  // In-page confirmation (native confirm() is blocked in some embedded browsers).
  // action returns null on success or an error string.
  UI.confirm = function (message, okLabel, action) {
    UI._modalAction = action;
    $('modal-text').textContent = message;
    $('modal-ok').textContent = okLabel;
    $('modal').hidden = false;
    $('modal-ok').focus();
  };

  function closeModal() {
    $('modal').hidden = true;
    UI._modalAction = null;
  }

  UI.toast = function (msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(UI._toastTimer);
    UI._toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  };

  function act(action, d, el) {
    const s = AF.state;
    let err = null;
    switch (action) {
      case 'select': UI.select({ kind: d.kind, id: d.id }, true); return;
      case 'deselect': UI.select(null); return;
      case 'goto-tab': UI.setTab(d.tab); return;
      case 'upgrade': err = S.upgrade(s, d.id); break;
      case 'rush': {
        const what = d.id === 'runway' ? 'fill the runway craters' : `repair the ${AF.BUILDINGS[d.id].name}`;
        UI.confirm(`Pay civilian contractors ${AF.money(S.rushCost(s, d.id))} to ${what} immediately?`, 'Pay contractors', () => S.rushRepair(s, d.id));
        break;
      }
      case 'buy-plane': err = S.buyPlane(s, d.type); break;
      case 'sell-plane': {
        const p = S.plane(s, d.id);
        if (!p) break;
        UI.confirm(`Sell ${p.code} (${AF.PLANE_TYPES[p.type].short}) back to the Air Ministry for ${AF.money(S.sellValue(s, p))}?`, 'Sell aircraft', () => {
          const e2 = S.sellPlane(s, d.id);
          if (!e2 && AF.view.selected.plane === d.id) UI.select(null);
          return e2;
        });
        break;
      }
      case 'assign': err = S.assignPilot(s, d.id, el.value); break;
      case 'repair': err = S.queueRepair(s, d.id); break;
      case 'cancel-repair': err = S.cancelRepair(s, d.id); break;
      case 'auto-assign': err = S.autoAssign(s); break;
      case 'hire-pilot': err = S.hirePilot(s, d.id); break;
      case 'dismiss-pilot':
        UI.confirm('Post this pilot elsewhere? They will leave the station.', 'Post elsewhere', () => S.dismissPilot(s, d.id));
        break;
      case 'hire': err = S.hireEnlisted(s, d.role); break;
      case 'dismiss': err = S.dismissEnlisted(s, d.role); break;
      case 'buy-fuel': err = S.buyFuel(s, Number(d.amount)); break;
      case 'buy-parts': err = S.buyParts(s, Number(d.amount)); break;
      case 'auto-repair': s.autoRepair = el.checked; break;
      case 'pause-raid': s.settings.pauseOnRaid = el.checked; break;
      case 'pause-radio': s.settings.pauseOnRadio = el.checked; break;
      case 'readiness': err = S.setReadiness(s, d.id, el.checked); break;
      case 'scramble-pick':
        if (el.checked) UI.scrambleSkip.delete(d.id); else UI.scrambleSkip.add(d.id);
        break;
      case 'scramble': {
        const ids = S.scrambleCandidates(s).filter((p) => !UI.scrambleSkip.has(p.id)).map((p) => p.id);
        err = S.scramble(s, ids);
        if (!err) UI.setSpeed(UI.lastSpeed || 1);
        break;
      }
      case 'radio': {
        const resume = s.radio && s.radio.paused;
        err = S.answerRadio(s, Number(d.i));
        if (!err && resume && s.speed === 0) UI.setSpeed(UI.lastSpeed || 1);
        break;
      }
      case 'tactic': UI.tactics[d.mission] = d.t; break;
      case 'resume': UI.setSpeed(UI.lastSpeed || 1); break;
      case 'dismiss-raid': UI.dismissedRaidAt = s.lastRaid && s.lastRaid.at; break;
      case 'pick': {
        const list = UI.picks[d.mission] || (UI.picks[d.mission] = []);
        const i = list.indexOf(d.id);
        if (el.checked && i < 0) list.push(d.id);
        if (!el.checked && i >= 0) list.splice(i, 1);
        break;
      }
      case 'launch': {
        err = S.launchMission(s, d.mission, UI.picks[d.mission] || [], UI.tactics[d.mission]);
        if (!err) { delete UI.picks[d.mission]; delete UI.tactics[d.mission]; }
        break;
      }
    }
    if (err) UI.toast(err);
    AF.dirty = true;
    UI.update(true);
  }

  // ---------- header & raid banner ----------
  UI.updateHeader = function () {
    const s = AF.state;
    $('date').textContent = `Day ${AF.dayNum(s.time)} · ${AF.dateStr(s.time)}`;
    $('time').textContent = AF.clock(s.time);
    $('r-funds').textContent = AF.money(s.funds);
    $('r-fuel').textContent = `${Math.floor(s.fuel)} / ${S.fuelCap(s)}`;
    $('r-parts').textContent = Math.floor(s.parts);
    $('r-morale').textContent = Math.round(s.morale) + '%';
    $('r-rep').textContent = Math.floor(s.rep);
    $('r-funds').parentElement.classList.toggle('low', s.funds < 0);
    $('r-fuel').parentElement.classList.toggle('low', s.fuel < 60);
    $('r-parts').parentElement.classList.toggle('low', s.parts < 5);
    $('r-morale').parentElement.classList.toggle('low', s.morale < 40);
    document.querySelectorAll('#speed [data-speed]').forEach((b) => b.classList.toggle('active', Number(b.dataset.speed) === s.speed));
    renderRaidBanner(s);
    renderRadio(s);
    renderOrders(s);
  };

  // Overlay HTML is only rewritten when it changes, so buttons stay clickable between frames.
  // Countdowns go in spans that live() updates in place, so they don't force a rewrite.
  function setOverlay(el, html, cls, live = {}) {
    if (html !== el._html || cls !== el._cls) {
      el.innerHTML = html;
      el._html = html;
      el._cls = cls;
      el.className = cls;
      el.hidden = !html;
    }
    for (const [sel, text] of Object.entries(live)) {
      const t = el.querySelector(sel);
      if (t && t.textContent !== text) t.textContent = text;
    }
  }

  function renderRadio(s) {
    const rd = s.radio;
    let html = '', timer = '';
    if (rd) {
      const choices = rd.choices.map((c, i) => `<button class="${i ? '' : 'first'}" data-action="radio" data-i="${i}">
          <b>${c.label}</b><span>${c.hint}</span></button>`).join('');
      html = `<div class="rt-head"><span class="rt-k">R/T · ${rd.mission}</span><span class="rt-timer"></span></div>
        <div class="rt-text">${rd.text}</div>
        <div class="rt-choices">${choices}</div>`;
      timer = s.speed === 0 ? 'Paused, awaiting your order' : `Leader decides in ${AF.dur(Math.max(0, rd.deadline - s.time))}`;
    }
    setOverlay($('radio'), html, 'radio-card', { '.rt-timer': timer });
  }

  function directiveLine(s, d) {
    const prog = d.kind === 'readiness'
      ? (s.time < d.from ? `from ${AF.clock(d.from)}` : `${S.defenceReady(s)}/${d.target} now`)
      : `${d.progress}/${d.target}`;
    return { prog, left: AF.dur(d.deadline - s.time) };
  }

  function renderOrders(s) {
    const d = s.directive;
    let html = '', prog = '';
    if (d && !(s.raid && s.raid.state !== 'scheduled')) { // out of the way of the raid warning
      const l = directiveLine(s, d);
      prog = `${l.prog} · ${l.left} left`;
      html = `<button class="orders-btn" data-action="goto-tab" data-tab="missions" title="Directive from Group: ${AF.money(d.funds)} and +${d.rep} reputation if carried out">
        <span class="ok-k">Group directive</span><span>${d.text}</span><span class="ok-p"></span></button>`;
    }
    setOverlay($('orders'), html, 'orders-chip', { '.ok-p': prog });
  }

  function scrambleChips(s) {
    const cands = S.scrambleCandidates(s);
    if (!cands.length) return '';
    return `<div class="rb-picks">${cands.map((p) => `<label class="sc-chip${S.atReadiness(s, p) ? ' ready' : ''}" title="${S.atReadiness(s, p) ? 'At readiness: airborne in minutes, with height in hand' : 'Will take a few minutes longer to get away'}">
        <input type="checkbox" data-action="scramble-pick" data-id="${p.id}"${UI.scrambleSkip.has(p.id) ? '' : ' checked'}>${p.code} ${AF.PLANE_TYPES[p.type].short}${S.atReadiness(s, p) ? ' ★' : ''}</label>`).join('')}</div>`;
  }

  function renderRaidBanner(s) {
    const el = $('raid-banner');
    const r = s.raid;
    let html = '', cls = '', eta = '';
    if (r && r.state === 'inbound') {
      cls = 'warning';
      eta = AF.dur(r.arriveAt - s.time);
      const n = S.scrambleCandidates(s).filter((p) => !UI.scrambleSkip.has(p.id)).length;
      const blk = S.scrambleBlocker(s) || (n ? null : 'No fighters selected');
      const up = r.scrambled ? `<span class="rb-note">${r.scrambled} scrambled</span>` : '';
      html = `<div class="rb-main"><div class="rb-text"><b>RAID WARNING</b> ${r.bombers} ${r.type}s${r.escorts ? ` with ${r.escorts} Bf 109s` : ''} inbound${r.night ? ' (night)' : ''} · ETA <b class="rb-eta"></b></div>
        <div class="rb-actions">
          ${up}
          ${S.scrambleCandidates(s).length || !r.scrambled ? btn(`Scramble${r.scrambled ? ' more' : ''}${n ? ` (${n})` : ''}`, 'data-action="scramble"', blk, 'danger') : ''}
          ${s.speed === 0 ? btn('Resume', 'data-action="resume"') : ''}
        </div></div>${scrambleChips(s)}`;
    } else if ((r && r.state === 'attacking') || (AF.view.raidActive && AF.view.raidActive())) {
      cls = 'warning';
      html = '<div class="rb-text"><b>AIR RAID IN PROGRESS</b></div>';
    } else if (s.lastRaid && s.time - s.lastRaid.at < 180 && UI.dismissedRaidAt !== s.lastRaid.at) {
      cls = s.lastRaid.damaging ? 'after bad' : 'after';
      html = `<div class="rb-text">${s.lastRaid.summary}</div><button class="ib-close" data-action="dismiss-raid" title="Dismiss">×</button>`;
    }
    setOverlay(el, html, 'raid-banner ' + cls, { '.rb-eta': eta });
  }

  // ---------- panel ----------
  UI.update = function (force) {
    UI.updateHeader();
    renderPanel(force);
    renderInfoBox(force);
    renderLog();
  };

  const focusedSelectIn = (el) => document.activeElement && document.activeElement.tagName === 'SELECT' && el.contains(document.activeElement);

  function renderPanel(force) {
    const body = $('panel-body');
    if (!force && focusedSelectIn(body)) return; // don't clobber an open dropdown
    const s = AF.state;
    const html = { station: stationTab, aircraft: aircraftTab, personnel: personnelTab, missions: missionsTab, supply: supplyTab }[UI.tab](s);
    if (html === body._html) return;
    const scroll = body.scrollTop;
    body.innerHTML = html;
    body._html = html;
    body.scrollTop = scroll;
  }

  function bar(pct, cls = '') {
    const c = cls || (pct >= 70 ? 'good' : pct >= 40 ? 'mid' : 'bad');
    return `<div class="bar ${c}"><div style="width:${AF.clamp(pct, 0, 100).toFixed(1)}%"></div></div>`;
  }

  function btn(label, attrs, disabledReason, cls = '') {
    const dis = disabledReason ? ` disabled title="${disabledReason}"` : '';
    return `<button class="${cls}" ${attrs}${dis}>${label}</button>`;
  }

  function effectText(s, id) {
    const b = s.buildings;
    switch (id) {
      case 'runway': return `Turnaround ${AF.dur(S.turnaroundMinutes(s))} · ${b.runway.level >= 2 ? 'twin-engine capable' : 'single-engine only'}`;
      case 'hangar': return `${S.bays(s)} repair bay${S.bays(s) === 1 ? '' : 's'} · parking ${s.planes.length}/${S.parkingCap(s)}`;
      case 'officers': return `Pilots ${s.pilots.length}/${S.pilotCap(s)} · fatigue recovery ${S.fatigueRecovery(s)}/h`;
      case 'enlisted': return `Enlisted ${S.enlistedCount(s)}/${S.enlistedCap(s)} (${s.enlisted.mechanics} mechanics, ${s.enlisted.groundCrew} ground crew)`;
      case 'fuelDepot': return `Fuel storage ${S.fuelCap(s)} gal`;
      case 'mess': return `Morale settles toward ${S.moraleTarget(s)}%`;
      case 'tower': return `${S.boardSize(s)} missions offered · +${Math.round(S.successBonus(s) * 100)}% mission success · ${S.raidWarning(s)} min raid warning`;
      case 'defenses': return `Each raider has a ${Math.round(S.aaChance(s, false) * 100)}% chance of being shot down by day, ${Math.round(S.aaChance(s, true) * 100)}% at night`;
      case 'pens': return `${Math.round(S.penProtection(s) * 100)}% of bombs aimed at parked aircraft are absorbed`;
    }
    return '';
  }

  function buildingStatus(s, id) {
    const b = s.buildings[id];
    const chips = [];
    if (b.upgrading) {
      const pct = Math.round(((s.time - b.upgrading.startAt) / (b.upgrading.finishAt - b.upgrading.startAt)) * 100);
      chips.push(`<span class="chip build">Building ${pct}%</span>`);
    }
    if (id === 'runway' && s.craters.length) chips.push(`<span class="chip bad">${s.craters.length} crater${s.craters.length > 1 ? 's' : ''}</span>`);
    if (b.damage >= 50) chips.push('<span class="chip bad">Out of action</span>');
    else if (b.damage) chips.push('<span class="chip mid">Damaged</span>');
    if (!b.level && !b.upgrading) chips.push('<span class="chip">Not built</span>');
    return chips.join('');
  }

  function directiveCard(s) {
    const d = s.directive;
    if (!d) return '';
    const { prog, left } = directiveLine(s, d);
    const pct = d.kind === 'readiness' ? (s.time < d.from ? 0 : ((s.time - d.from) / (d.deadline - d.from)) * 100) : (d.progress / d.target) * 100;
    const help = {
      sorties: 'Counts successful missions of that type.',
      kills: 'Counts enemy aircraft destroyed by your pilots and guns, on missions and in raids.',
      readiness: 'Set fighters to readiness (Aircraft tab). Group checks every hour; scrambled fighters still count.',
    }[d.kind];
    return `<div class="card orders">
        <div class="card-head"><h3>Directive from Group</h3><span class="pill">${AF.money(d.funds)} · +${d.rep} rep</span></div>
        <div class="desc">${d.text}.</div>
        <div class="row"><span class="small muted">${d.kind === 'readiness' ? 'Watch' : 'Progress'}</span>${bar(pct, 'build')}<span class="small num">${prog}</span></div>
        <div class="muted small">${help} ${left} left.</div>
      </div>`;
  }

  function stationTab(s) {
    const rows = AF.BUILDING_ORDER.map((id) => {
      const def = AF.BUILDINGS[id], b = s.buildings[id];
      const sel = AF.view.selected.building === id ? ' selected' : '';
      return `<div class="srow${sel}" data-action="select" data-kind="building" data-id="${id}">
        <div class="srow-main"><div class="srow-name">${def.name}</div>
          <div class="srow-sub">${b.level ? def.levels[b.level - 1].label : 'Not built'}</div></div>
        <div class="srow-chips">${buildingStatus(s, id)}<span class="pill">Lv ${b.level}/${def.levels.length}</span></div>
      </div>`;
    }).join('');
    const r = s.raid;
    const threat = r && r.state === 'inbound'
      ? '<span class="bad"><b>Raid inbound!</b></span>'
      : `Raid warning time ${S.raidWarning(s)} min · AA ${['none', 'light', 'medium', 'heavy'][S.lvl(s, 'defenses')]} · pens ${['none', 'earth', 'brick'][S.lvl(s, 'pens')]}`;
    return `<div class="section-head"><h2>Station</h2></div>
      ${directiveCard(s)}
      <p class="muted small">Select a building here or on the airfield for details and orders.</p>
      <div class="slist">${rows}</div>
      <div class="card"><div class="card-head"><h3>Air Defence</h3></div><div class="small">${threat}</div>
        <div class="muted small">Raids grow more frequent as your reputation rises. Build AA guns and blast pens, keep a fast control tower watch, and scramble fighters when a warning comes.</div></div>`;
  }

  function planeStatus(s, p) {
    if (S.atReadiness(s, p)) return { label: 'At readiness', cls: 'st-readiness' };
    let label = S.STATUS_LABEL[p.status];
    if (p.status === 'turnaround') label += ` · ${AF.dur(p.readyAt - s.time)}`;
    if (p.status === 'queued') label += ` · #${s.repairQueue.filter((id) => S.plane(s, id)?.status === 'queued').indexOf(p.id) + 1} in line`;
    if (p.status === 'towing') label += p.towTo === 'bay' ? ' to hangar' : ' to dispersal';
    return { label, cls: 'st-' + p.status };
  }

  function readinessToggle(s, p) {
    if (!S.canReadiness(p)) return '';
    const note = p.readiness && !S.atReadiness(s, p) ? ` <span class="muted">(resumes when ${p.status === 'ready' ? 'it can fly' : 'ready'})</span>` : '';
    return `<label class="toggle small" title="The pilot waits in the cockpit: scrambles in ${AF.FLIGHT.readyTaxi} min instead of ${AF.FLIGHT.scrambleTaxi}, meets raiders with height in hand, but tires instead of resting">
      <input type="checkbox" data-action="readiness" data-id="${p.id}"${p.readiness ? ' checked' : ''}> At readiness${note}</label>`;
  }

  function aircraftTab(s) {
    const planes = s.planes.map((p) => {
      const t = AF.PLANE_TYPES[p.type];
      const flying = S.isAway(p);
      const st = planeStatus(s, p);
      const sel = AF.view.selected.plane === p.id ? ' selected' : '';
      return `<div class="card${sel}" id="plane-${p.id}">
        <div class="card-head clickable" data-action="select" data-kind="plane" data-id="${p.id}" title="Show on the airfield">
          <h3>${p.code} <span class="muted">${t.short}</span></h3><span class="pill ${st.cls}">${st.label}</span></div>
        <div class="row"><span class="small muted">Condition</span>${bar(p.condition)}<span class="small num">${Math.round(p.condition)}%</span></div>
        <div class="row"><span class="small muted">Pilot</span>${pilotSelect(s, p)}</div>
        ${readinessToggle(s, p)}
        <div class="actions">${planeActions(s, p, flying)}</div>
      </div>`;
    }).join('') || '<p class="muted">No aircraft on strength.</p>';

    const shop = Object.entries(AF.PLANE_TYPES).map(([id, t]) => {
      const blk = S.planeBlocker(s, id);
      const locked = s.rep < t.minRep;
      return `<div class="card shop${locked ? ' locked' : ''}">
        <div class="card-head"><h3>${t.name}</h3><span class="pill">${t.role}</span></div>
        <p class="desc">${t.blurb}</p>
        <div class="stats">
          <span>Combat <b>${t.combat}</b></span><span>Speed <b>${t.speed}</b></span><span>Armour <b>${t.armor}</b></span><span>Fuel <b>${t.fuelUse}</b>/h</span>
        </div>
        ${btn(`Requisition · ${AF.money(t.cost)}`, `data-action="buy-plane" data-type="${id}"`, blk, 'wide')}
        ${blk && blk !== 'Insufficient funds' ? `<div class="muted small">${blk}</div>` : ''}
      </div>`;
    }).join('');

    return `<div class="section-head"><h2>Aircraft</h2><span class="muted">${s.planes.length}/${S.parkingCap(s)} parked</span></div>
      ${planes}
      <h2>Requisition Aircraft</h2>${shop}`;
  }

  function pilotSelect(s, p) {
    const options = s.pilots.map((pl) => {
      const other = S.planeOfPilot(s, pl.id);
      const note = other && other.id !== p.id ? ` [${other.code}]` : pl.status !== 'available' ? ` (${pl.status})` : '';
      return `<option value="${pl.id}"${pl.id === p.pilotId ? ' selected' : ''}>${S.pilotName(pl)} · skill ${pl.skill.toFixed(1)}${note}</option>`;
    }).join('');
    return `<select data-action="assign" data-id="${p.id}"${S.isAway(p) ? ' disabled' : ''}><option value="">— No pilot —</option>${options}</select>`;
  }

  function planeActions(s, p, flying) {
    const inQueue = p.status === 'queued' || p.status === 'repair';
    const towing = p.status === 'towing';
    const busy = flying ? 'Away on a sortie' : towing ? 'Being towed' : null;
    return [
      inQueue
        ? btn('Cancel repair', `data-action="cancel-repair" data-id="${p.id}"`)
        : btn('Repair', `data-action="repair" data-id="${p.id}"`, busy || (p.condition >= 100 ? 'Undamaged' : null)),
      btn(`Sell · ${AF.money(S.sellValue(s, p))}`, `data-action="sell-plane" data-id="${p.id}"`, busy, 'ghost'),
    ].join('');
  }

  function personnelTab(s) {
    const pilots = s.pilots.map((p) => {
      const plane = S.planeOfPilot(s, p.id);
      const status = p.status === 'wounded' ? `Wounded · back in ${AF.dur(p.returnAt - s.time)}` : p.status === 'flying' ? 'Airborne' : p.fatigue > 70 ? 'Exhausted' : 'Available';
      const ace = (p.kills || 0) >= AF.ACE_KILLS ? ' <span class="pill ace" title="Five or more victories">Ace</span>' : '';
      const waiting = plane && S.atReadiness(s, plane) ? ' · at readiness' : '';
      return `<div class="card pilot">
        <div class="card-head"><h3>${S.pilotName(p)}${ace}</h3><span class="pill st-${p.status}">${status}</span></div>
        <div class="row"><span class="small muted">Skill</span>${bar(p.skill * 10, 'skill')}<span class="small num">${p.skill.toFixed(1)}</span></div>
        <div class="row"><span class="small muted">Fatigue</span>${bar(p.fatigue, p.fatigue > 70 ? 'bad' : p.fatigue > 40 ? 'mid' : 'good')}<span class="small num">${Math.round(p.fatigue)}</span></div>
        <div class="row small"><span class="muted">${p.sorties} sorties · ${p.kills || 0} victor${p.kills === 1 ? 'y' : 'ies'} · ${plane ? 'flies ' + plane.code : 'no aircraft'}${waiting}</span>
          ${btn('Dismiss', `data-action="dismiss-pilot" data-id="${p.id}"`, p.status === 'flying' ? 'Airborne' : null, 'ghost small')}</div>
      </div>`;
    }).join('') || '<p class="muted">No pilots on strength!</p>';

    const full = s.pilots.length >= S.pilotCap(s);
    const recruits = s.recruits.map((r) => `<div class="card recruit">
        <div class="card-head"><h3>${r.name}</h3><span class="pill">${AF.money(r.cost)}</span></div>
        <div class="row"><span class="small muted">Skill</span>${bar(r.skill * 10, 'skill')}<span class="small num">${r.skill.toFixed(1)}</span></div>
        ${btn('Accept posting', `data-action="hire-pilot" data-id="${r.id}"`, full ? "Officers' barracks full" : s.funds < r.cost ? 'Insufficient funds' : null, 'wide')}
      </div>`).join('') || '<p class="muted small">No candidates today. New ones arrive at dawn.</p>';

    const efull = S.enlistedCount(s) >= S.enlistedCap(s);
    const role = (key, name, cost, effect) => `<div class="card">
        <div class="card-head"><h3>${name}</h3><span class="pill">${s.enlisted[key]}</span></div>
        <div class="muted small">${effect}</div>
        <div class="actions">
          ${btn(`Hire · ${AF.money(cost)}`, `data-action="hire" data-role="${key}"`, efull ? 'Enlisted barracks full' : s.funds < cost ? 'Insufficient funds' : null)}
          ${btn('Dismiss', `data-action="dismiss" data-role="${key}"`, s.enlisted[key] ? null : 'None to dismiss', 'ghost')}
        </div>
      </div>`;

    return `<div class="section-head"><h2>Pilots</h2><span class="muted">${s.pilots.length}/${S.pilotCap(s)} quartered</span></div>
      <div class="actions top">${btn('Auto-assign pilots to aircraft', 'data-action="auto-assign"')}</div>
      ${pilots}
      <h2>Pilot Candidates</h2>${recruits}
      <div class="section-head"><h2>Ground Personnel</h2><span class="muted">${S.enlistedCount(s)}/${S.enlistedCap(s)} quartered</span></div>
      ${role('mechanics', 'Mechanics', AF.PRICES.mechanics, `Repair speed ${S.repairRate(s).toFixed(1)}% per hour per bay.`)}
      ${role('groundCrew', 'Ground Crew', AF.PRICES.groundCrew, `Refuel &amp; rearm turnaround ${AF.dur(S.turnaroundMinutes(s))}. They also fill bomb craters (${S.craterHoursEach(s).toFixed(1)}h each) and patch bomb damage.`)}
      <p class="muted small">Wages: ${AF.money(AF.WAGES.pilot)}/day per pilot, ${AF.money(AF.WAGES.enlisted)}/day per airman.</p>`;
  }

  function opposition(d) {
    return d === 0 ? 'None' : d < 5 ? 'Light' : d < 12 ? 'Moderate' : d < 22 ? 'Heavy' : 'Severe';
  }
  function riskLabel(r) {
    return r < 0.05 ? 'Minimal' : r < 0.15 ? 'Low' : r < 0.25 ? 'Medium' : r < 0.35 ? 'High' : 'Extreme';
  }

  function tacticPicker(m) {
    if (m.stat === 'none') return '';
    const cur = UI.tactics[m.id] || 'standard';
    return `<div class="tactics" role="group" aria-label="Tactics">${Object.entries(AF.TACTICS).map(([k, t]) =>
      `<button class="${k === cur ? 'on' : ''}" data-action="tactic" data-mission="${m.id}" data-t="${k}" title="${t.desc}">${t.name}</button>`).join('')}</div>`;
  }

  function missionsTab(s) {
    const flights = s.flights.map((f) => {
      const end = f.parkAt ?? f.returnAt;
      const pct = ((s.time - f.departAt) / (end - f.departAt)) * 100;
      const phase = s.time < (f.airborneBy ?? f.departAt) ? 'Taxiing out' : s.time < f.returnAt ? 'In the air' : 'Landing';
      const scr = f.mission.typeId === 'scramble';
      const calling = s.radio && s.radio.flightId === f.id ? '<div class="note">On the radio, awaiting your order.</div>' : '';
      const odds = !scr && f.mission.stat !== 'none' && s.time < f.returnAt ? ` · odds ~${Math.round(S.flightOdds(s, f) * 100)}%` : '';
      const tac = f.tactic && f.tactic !== 'standard' ? ` · ${AF.TACTICS[f.tactic].name.toLowerCase()}` : '';
      return `<div class="card flight">
        <div class="card-head"><h3>${f.mission.name}</h3><span class="pill st-flying">${phase} · back in ${AF.dur(end - s.time)}</span></div>
        <div class="muted small">${f.mission.place} · ${f.planeIds.map((id) => S.plane(s, id)?.code || '?').join(', ')}${tac}${odds}</div>
        ${bar(pct, 'flight')}${calling}
      </div>`;
    }).join('');

    const runway = S.runwayBlocker(s);
    const available = s.planes.filter((p) => !S.isAway(p));
    const board = s.missions.map((m) => {
      const picks = (UI.picks[m.id] || []).filter((id) => {
        const p = S.plane(s, id);
        return p && !S.flyBlocker(s, p);
      });
      UI.picks[m.id] = picks;
      const chosen = picks.map((id) => S.plane(s, id));
      const chance = S.successChance(s, m, chosen, UI.tactics[m.id]);
      const fuel = S.fuelNeeded(m, chosen);

      const rows = available.map((p) => {
        const blk = S.flyBlocker(s, p);
        const pilot = p.pilotId && S.pilot(s, p.pilotId);
        const checked = picks.includes(p.id);
        const full = !checked && picks.length >= m.maxPlanes;
        return `<label class="pick${blk ? ' blocked' : ''}">
          <input type="checkbox" data-action="pick" data-mission="${m.id}" data-id="${p.id}"${checked ? ' checked' : ''}${blk || full ? ' disabled' : ''}>
          <span><b>${p.code}</b> ${AF.PLANE_TYPES[p.type].short} — ${pilot ? S.pilotName(pilot) : 'no pilot'}</span>
          <span class="muted small">${blk || Math.round(p.condition) + '%'}</span>
        </label>`;
      }).join('') || '<div class="muted small">No aircraft on the ground.</div>';

      let blocker = runway;
      if (blocker) { /* runway first */ }
      else if (picks.length < m.minPlanes) blocker = `Select at least ${m.minPlanes} aircraft`;
      else if (fuel > s.fuel) blocker = 'Not enough fuel';
      else if (m.requiresRole && chance === 0) blocker = `Needs a ${m.requiresRole.toLowerCase()}`;

      const chanceCls = chance >= 0.75 ? 'good' : chance >= 0.5 ? 'mid' : 'bad';
      return `<div class="card mission">
        <div class="card-head"><h3>${m.name}</h3><span class="pill">${AF.money(m.funds)}${m.rep ? ` · +${m.rep} rep` : ''}</span></div>
        <div class="sub">${m.place}</div>
        <p class="desc">${m.desc}</p>
        <div class="stats">
          <span>Opposition <b>${opposition(m.difficulty)}</b></span>
          <span>Risk <b>${riskLabel(m.risk)}</b></span>
          <span>Flight <b>${m.hours}h</b></span>
          <span>Away <b>~${AF.dur(m.hours * 60 + AF.FLIGHT.taxiOut + AF.FLIGHT.landing)}</b></span>
          <span>Aircraft <b>${m.minPlanes === m.maxPlanes ? m.minPlanes : m.minPlanes + '–' + m.maxPlanes}</b></span>
          <span>Expires <b>${AF.dur(m.expiresAt - s.time)}</b></span>
        </div>
        ${m.stat === 'speed' ? '<div class="note">Success depends on speed rather than firepower.</div>' : ''}
        <div class="picks">${rows}</div>
        ${tacticPicker(m)}
        <div class="launch">
          <span class="small">Success <b class="${chosen.length ? chanceCls : ''}">${chosen.length ? Math.round(chance * 100) + '%' : '—'}</b></span>
          <span class="small">Fuel <b>${fuel}</b> gal</span>
          ${btn('Launch', `data-action="launch" data-mission="${m.id}"`, blocker, 'primary')}
        </div>
      </div>`;
    }).join('') || '<p class="muted">No orders from Group. New missions arrive at dawn.</p>';

    return `${directiveCard(s)}
      ${flights ? `<h2>Airborne</h2>${flights}` : ''}
      ${runway ? `<div class="card alert">${runway}. Ground crews are filling the craters — see the Runway on the Station tab.</div>` : ''}
      <div class="section-head"><h2>Orders from Group HQ</h2><span class="muted">New orders at dawn</span></div>
      ${board}`;
  }

  function supplyTab(s) {
    const cap = S.fuelCap(s);
    const net = S.dailyStipend(s) - S.dailyWages(s);
    const st = s.stats;
    return `<h2>Stores</h2>
      <div class="card">
        <div class="card-head"><h3>Aviation Fuel</h3><span class="pill">${Math.floor(s.fuel)} / ${cap} gal</span></div>
        ${bar((s.fuel / cap) * 100, 'fuel')}
        <div class="muted small">${AF.money(AF.PRICES.fuel)} per gallon. Build or upgrade a Fuel Depot to store more.</div>
        <div class="actions">
          ${btn('+100 gal · ' + AF.money(100 * AF.PRICES.fuel), 'data-action="buy-fuel" data-amount="100"')}
          ${btn('+500 gal · ' + AF.money(500 * AF.PRICES.fuel), 'data-action="buy-fuel" data-amount="500"')}
          ${btn('Fill up', `data-action="buy-fuel" data-amount="${cap}"`)}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Spare Parts</h3><span class="pill">${Math.floor(s.parts)}</span></div>
        <div class="muted small">Repairs use 1 part per 5% of airframe restored. ${AF.money(AF.PRICES.parts)} each.</div>
        <div class="actions">
          ${btn('+10 · ' + AF.money(10 * AF.PRICES.parts), 'data-action="buy-parts" data-amount="10"')}
          ${btn('+50 · ' + AF.money(50 * AF.PRICES.parts), 'data-action="buy-parts" data-amount="50"')}
        </div>
      </div>
      <h2>Standing Orders</h2>
      <div class="card">
        <label class="toggle"><input type="checkbox" data-action="auto-repair"${s.autoRepair ? ' checked' : ''}> Automatically send aircraft below 60% to the hangar</label>
        <label class="toggle"><input type="checkbox" data-action="pause-raid"${s.settings.pauseOnRaid ? ' checked' : ''}> Pause the game when a raid warning comes in</label>
        <label class="toggle"><input type="checkbox" data-action="pause-radio"${s.settings.pauseOnRadio ? ' checked' : ''}> Pause the game when a flight radios for orders</label>
      </div>
      <h2>Station Accounts</h2>
      <div class="card">
        <table class="ledger">
          <tr><td>Air Ministry allowance</td><td>+${AF.money(S.dailyStipend(s))}</td></tr>
          <tr><td>Pilot wages (${s.pilots.length})</td><td>−${AF.money(s.pilots.length * AF.WAGES.pilot)}</td></tr>
          <tr><td>Airmen wages (${S.enlistedCount(s)})</td><td>−${AF.money(S.enlistedCount(s) * AF.WAGES.enlisted)}</td></tr>
          <tr class="total"><td>Net per day</td><td class="${net >= 0 ? 'good' : 'bad'}">${net >= 0 ? '+' : '−'}${AF.money(Math.abs(net))}</td></tr>
        </table>
        <div class="muted small">The allowance grows with your reputation. Paid at midnight.</div>
      </div>
      <h2>Service Record</h2>
      <div class="card">
        <table class="ledger">
          <tr><td>Missions flown</td><td>${st.missionsFlown}</td></tr>
          <tr><td>Successful</td><td>${st.successes}</td></tr>
          <tr><td>Raids weathered</td><td>${st.raids}</td></tr>
          <tr><td>Enemy aircraft destroyed</td><td>${st.enemyKills}</td></tr>
          <tr><td>Group directives carried out</td><td>${st.directives || 0}</td></tr>
          <tr><td>Aces</td><td>${s.pilots.filter((p) => (p.kills || 0) >= AF.ACE_KILLS).length}</td></tr>
          <tr><td>Aircraft lost</td><td>${st.planesLost}</td></tr>
          <tr><td>Aircrew lost</td><td>${st.pilotsLost}</td></tr>
          <tr><td>Morale target</td><td>${S.moraleTarget(s)}%</td></tr>
        </table>
      </div>`;
  }

  // ---------- info box ----------
  function renderInfoBox(force) {
    const box = $('infobox');
    if (!force && focusedSelectIn(box)) return;
    const s = AF.state;
    const sel = AF.view.selected;
    let html = '';
    if (sel.plane) {
      const p = S.plane(s, sel.plane);
      if (p) html = planeInfo(s, p);
      else AF.view.selected = { building: null, plane: null }; // sold or lost
    } else if (sel.building) {
      html = buildingInfo(s, sel.building);
    }
    if (html === box._html) return;
    box.innerHTML = html;
    box._html = html;
    box.hidden = !html;
  }

  function ibHead(kicker, title, sub) {
    return `<div class="ib-head"><div><div class="ib-kicker">${kicker}</div><h3>${title}</h3>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
      <button class="ib-close" data-action="deselect" title="Close (Esc)">×</button></div>`;
  }

  function buildingInfo(s, id) {
    const def = AF.BUILDINGS[id], b = s.buildings[id];
    const parts = [ibHead(`Station · Lv ${b.level}/${def.levels.length}`, def.name, b.level ? def.levels[b.level - 1].label : 'Not built')];
    parts.push(`<p class="desc">${def.desc}</p>`);
    if (b.level) parts.push(`<div class="effects">${effectText(s, id)}</div>`);

    if (id === 'runway' && s.craters.length) {
      const hrs = (s.craters.length - s.craterWork) * S.craterHoursEach(s);
      parts.push(`<div class="ib-alert"><b>${s.craters.length} bomb crater${s.craters.length > 1 ? 's' : ''}</b> — no aircraft can take off.
        Ground crews will have it clear in about ${AF.dur(hrs * 60)}.
        <div class="actions">${btn(`Rush repairs · ${AF.money(S.rushCost(s, id))}`, `data-action="rush" data-id="runway"`, s.funds < S.rushCost(s, id) ? 'Insufficient funds' : null, 'danger')}</div></div>`);
    }
    if (b.damage) {
      const hrs = b.damage / S.buildingRepairRate(s);
      parts.push(`<div class="ib-alert"><div class="row"><span class="small">Bomb damage</span>${bar(b.damage, 'bad')}<span class="small num">${Math.round(b.damage)}%</span></div>
        ${b.damage >= 50 ? `Out of action — working as Lv ${S.lvl(s, id)} until repaired. ` : ''}Repaired in about ${AF.dur(hrs * 60)}.
        <div class="actions">${btn(`Rush repairs · ${AF.money(S.rushCost(s, id))}`, `data-action="rush" data-id="${id}"`, s.funds < S.rushCost(s, id) ? 'Insufficient funds' : null, 'danger')}</div></div>`);
    }

    if (id === 'hangar') {
      const inHangar = s.repairQueue.map((pid, i) => {
        const p = S.plane(s, pid);
        return p ? `<div class="ib-line clickable" data-action="select" data-kind="plane" data-id="${p.id}"><b>${p.code}</b> ${AF.PLANE_TYPES[p.type].short}
          <span class="muted small">${p.status === 'repair' ? 'in bay ' + (p.bay + 1) : p.status === 'towing' ? 'being towed in' : 'waiting'} · ${Math.round(p.condition)}%</span></div>` : '';
      }).join('');
      parts.push(`<div class="ib-section"><div class="ib-label">Repair queue</div>${inHangar || '<div class="muted small">No aircraft under repair.</div>'}</div>`);
    }

    const info = S.upgradeInfo(s, id);
    if (b.upgrading) {
      const pct = ((s.time - b.upgrading.startAt) / (b.upgrading.finishAt - b.upgrading.startAt)) * 100;
      parts.push(`<div class="ib-section"><div class="ib-label">Under construction</div>${bar(pct, 'build')}
        <div class="muted small">${def.levels[b.level].label} — ${AF.dur(b.upgrading.finishAt - s.time)} remaining</div></div>`);
    } else if (info) {
      const blk = S.upgradeBlocker(s, id);
      parts.push(`<div class="ib-section"><div class="ib-label">${b.level ? 'Next level' : 'Construction'}</div>
        <div class="small"><b>${info.next.label}</b> · ${AF.money(info.next.cost)} · ${info.next.hours}h</div>
        ${btn(b.level ? 'Order upgrade' : 'Order construction', `data-action="upgrade" data-id="${id}"`, blk, 'primary wide')}</div>`);
    } else {
      parts.push('<div class="muted small ib-section">Fully upgraded.</div>');
    }
    return parts.join('');
  }

  function planeInfo(s, p) {
    const t = AF.PLANE_TYPES[p.type];
    const flying = S.isAway(p);
    const st = planeStatus(s, p);
    const flight = flying && s.flights.find((f) => f.planeIds.includes(p.id));
    const blk = S.flyBlocker(s, p);
    const pilot = p.pilotId && S.pilot(s, p.pilotId);
    const record = pilot ? `<div class="small muted">${S.pilotName(pilot)}: ${pilot.sorties} sorties, ${pilot.kills || 0} victor${pilot.kills === 1 ? 'y' : 'ies'}${(pilot.kills || 0) >= AF.ACE_KILLS ? ' (ace)' : ''}</div>` : '';
    return [
      ibHead(`${t.role} · ${p.sorties} sorties`, `${p.code} <span class="muted">${t.short}</span>`, t.name),
      `<div class="row"><span class="small muted">Status</span><span class="pill ${st.cls}">${st.label}</span></div>`,
      flight ? `<div class="small muted">${flight.mission.name}, ${flight.mission.place} — back in ${AF.dur((flight.parkAt ?? flight.returnAt) - s.time)}</div>` : '',
      `<div class="row"><span class="small muted">Condition</span>${bar(p.condition)}<span class="small num">${Math.round(p.condition)}%</span></div>`,
      `<div class="row"><span class="small muted">Pilot</span>${pilotSelect(s, p)}</div>`,
      record,
      readinessToggle(s, p),
      `<div class="stats"><span>Combat <b>${t.combat}</b></span><span>Speed <b>${t.speed}</b></span><span>Armour <b>${t.armor}</b></span><span>Fuel <b>${t.fuelUse}</b>/h</span></div>`,
      !flying ? `<div class="small ${blk ? 'mid' : 'good'}">${blk ? 'Not ready: ' + blk : 'Ready to fly'}</div>` : '',
      `<div class="actions">${planeActions(s, p, flying)}${btn('Missions →', 'data-action="goto-tab" data-tab="missions"', null, 'ghost')}</div>`,
    ].join('');
  }

  // ---------- log ----------
  function renderLog() {
    const s = AF.state;
    const key = s.log.length + ':' + (s.log[0] ? s.log[0].t + s.log[0].text : '');
    if (key === lastLogKey) return;
    lastLogKey = key;
    $('log').innerHTML = s.log.slice(0, 60).map((e) =>
      `<div class="entry ${e.kind}"><span class="t">D${AF.dayNum(e.t)} ${AF.clock(e.t)}</span><span>${e.text}</span></div>`
    ).join('');
  }

  // ---------- tooltip ----------
  function tooltipHtml(h) {
    const s = AF.state;
    if (h.kind === 'building') {
      const def = AF.BUILDINGS[h.id], b = s.buildings[h.id];
      const lvl = b.level ? def.levels[b.level - 1].label : 'Not built — click to construct';
      const extra = h.id === 'runway' && s.craters.length ? `<br><i>${s.craters.length} crater(s) — unserviceable</i>`
        : b.damage ? `<br><i>Bomb damage ${Math.round(b.damage)}%</i>` : '';
      return `<b>${def.name}</b><br>${lvl}${b.upgrading ? '<br><i>Under construction</i>' : ''}${extra}`;
    }
    const p = S.plane(s, h.id);
    if (!p) return '';
    const pilot = p.pilotId && S.pilot(s, p.pilotId);
    return `<b>${p.code}</b> · ${AF.PLANE_TYPES[p.type].short}<br>${planeStatus(s, p).label} · ${Math.round(p.condition)}%<br>${pilot ? S.pilotName(pilot) : 'No pilot assigned'}`;
  }
})(window.AF);
