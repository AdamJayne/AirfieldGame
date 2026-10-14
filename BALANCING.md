# Balancing Notes

Working notes on game tuning: current values, where they live, what testing has shown, and
what still needs a look. Update this as values change or playtests turn something up.

Most numbers live in `js/data.js`. Formulas live in `js/sim.js`.

## Pacing

| Setting | Value | Where |
| --- | --- | --- |
| Game minutes per real second at 1x | 1 | `AF.MINUTES_PER_SECOND` |
| Speed multipliers | 1x / 4x / 12x | `AF.SPEEDS` |
| One game day takes | 24 min / 6 min / 2 min real | |
| Taxi out + take-off | 45 game min, plus 4 min per extra aircraft | `AF.FLIGHT` |
| Landing + taxi in | 50 game min, plus 4 min stagger | `AF.FLIGHT` |
| Scramble taxi | 8 game min, 2 min stagger | `AF.FLIGHT` |
| Tow between dispersal and a hangar bay | 30 game min | `AF.FLIGHT.tow` |
| Gap between tows through the hangar doors | 8 game min | `AF.FLIGHT.doorGap` |

- 1x was 6 game min/sec until the taxi/landing fix (a day took 4 real minutes). It was slowed
  so that sortie movement plays at a natural speed: 1 game minute is drawn as 1 second of
  animation. The old pace now sits between 4x and 12x.
- Mission "hours" are time in the air. Ground phases add about 1.6 h, so a 2 h training flight
  keeps an aircraft away for about 3.6 h, then it needs a refuelling turnaround.
- **To check:** whether 1x feels too slow. If so, raise `MINUTES_PER_SECOND`. Animations stay in
  sync, but taxiing gets faster. Alternatively shorten `AF.FLIGHT` phases.

## Economy

| Item | Value | Where |
| --- | --- | --- |
| Starting funds / fuel / parts | £1,500 / 400 gal / 30 | `AF.newGame` (state.js) |
| Daily allowance | £100 + 3 × reputation | `S.dailyStipend` |
| Wages | £15/pilot, £5/airman per day | `AF.WAGES` |
| Fuel / parts | £1/gal, £4/part | `AF.PRICES` |
| Mechanic / ground crew hire | £80 / £50 | `AF.PRICES` |
| Sell price | 40% of cost × condition | `S.sellValue` |

- Repairs use 0.2 parts per 1% of condition. A badly damaged fighter costs roughly 10–15 parts.
- **Seen in testing:** money is tight early, then comfortable once reputation passes about 40,
  because the allowance scales with reputation.

## Reputation and missions

- Rewards scale by difficulty × (0.85–1.25) × (1 + rep/150). See `S.makeMission`.
- Success chance = 0.25 + 0.45 × strength / difficulty, plus the tower bonus, clamped to
  5–97%. See `S.successChance`.
- **Concern:** reputation grows fast. Automated 40-day runs reach rep 140–150 and 45-day runs
  reach 60–100, while the last unlock (Spitfire / Fighter Sweep) is at 60–65. Options: smaller
  `rep` rewards in `AF.MISSION_TYPES`, a bigger failure penalty, or longer unlock thresholds.
- **Concern:** raid kills also give +1 rep each (`S.resolveRaid`), which adds to the above.

## Tactics, radio calls and claims

| Setting | Value | Where |
| --- | --- | --- |
| Tactics (success / risk / claims / xp) | Cautious −10% / ×0.55 / ×0.5 / ×0.8; Aggressive +10% / ×1.6 / ×1.5 / ×1.25 | `AF.TACTICS` |
| Chance a mission brings a radio call | 70% (combat and recon missions; never training) | `AF.RADIO.chance` |
| Call arrives | 25–60% of the way through the time aloft | `S.dispatch` |
| Time to answer before the leader decides | 10 game min (first option) | `AF.RADIO.answerTime` |
| Claims per aircraft on success | `kills` × combat/5 × (0.5 + skill/6) × tactic × radio, ×0.4 on failure | `S.resolveFlight` |
| Mission `kills` rates | patrol 0.2, convoy 0.35, intercept 0.7, strike 0.1, sweep 0.6 | `AF.MISSION_TYPES` |
| Ace | 5 victories: +5 morale, +2 reputation | `AF.ACE_KILLS`, `S.creditKills` |

- Risk multipliers stack (tactic × radio choice × per-aircraft engine trouble). Damage chance is
  capped at 95% and the chance of being shot down at 60% per aircraft.
- The scramble call ("vector") applies to every flight up against that raid: kills ×1.3 / risk
  ×1.4 (go for the bombers), turn-back ×2.2 / kills ×0.8 (head-on), kills ×0.6 / risk ×0.6
  (stragglers).
- **Seen in testing** (800 runs of a Convoy Escort, two Hurricanes, skill-3 pilots, no radio
  call): Cautious 62% success, 0.043 aircraft lost per sortie, 0.31 claims, £494 average pay;
  Standard 73%, 0.061, 0.69, £549; Aggressive 86%, 0.086, 1.17, £620. Aggressive roughly breaks
  even on money once losses and extra repairs are counted, and wins reputation and claims at
  the cost of pilots. Cautious only pays when aircraft or pilots are scarce.
- **To check:** whether Aggressive is simply better in real play. If so, raise its risk multiplier.
- **To check:** claims add to reputation only through aces and raid kills, so they shouldn't
  worsen the rep-growth concern below, but watch it.

## Readiness

| Setting | Value | Where |
| --- | --- | --- |
| Scramble taxi from readiness | 3 min (1 min stagger), against 8 min (2) | `AF.FLIGHT.readyTaxi` |
| Interception strength from readiness | ×1.2 | `AF.READINESS_EDGE` |
| Fatigue while waiting | +1.5 per hour instead of recovering | `AF.READINESS_FATIGUE` |

- A pilot at readiness reaches the 70 fatigue limit in about two days from fresh, so readiness
  needs rotating. **To check:** whether that's too forgiving.

## Group directives

| Setting | Value | Where |
| --- | --- | --- |
| Chance of a new directive each dawn (from day 2, when none is open) | 60% | `AF.DIRECTIVES.chance` |
| Missions | complete 2–3 of a type in 2 days; Group posts one spare mission of that type | `S.issueDirective` |
| Kills | 2 + rep/20 (2–8) in 3 days; pays £120 each | `S.issueDirective` |
| Readiness | 1–2 fighters at readiness (or up against a raid) at every hourly check, 10:00–16:00 | `S.checkReadinessDirective` |
| Failure | −2 reputation, −3 morale | `AF.DIRECTIVES.fail` |

## Air raids

| Setting | Value | Where |
| --- | --- | --- |
| First possible raid | Day 4 | `S.scheduleRaid` |
| Daily raid chance | 6% + rep/140 + 0.4% per day after day 40 (max 60%) | `S.scheduleRaid` |
| Night raid chance | 25% once rep ≥ 35 | `S.scheduleRaid` |
| Bombers | 2 + rep/16 + 0–3 (2 to 10) | `S.scheduleRaid` |
| Escorts | rep ≥ 25: 30–80% of bombers | `S.scheduleRaid` |
| Warning time | 20 min + 12 per tower level + 5 if AA built | `S.raidWarning` |
| Formation in sight before reaching the field | 12 min (the battle is decided then; scrambling closes) | `AF.RAID.approach` |
| AA kill chance per bomber | 3 / 10 / 18 / 28% (×0.5 at night, ×0.9 with searchlights) | `AF.RAID.aaKill` |
| Blast pen protection | 0 / 50 / 75% | `AF.RAID.penProtect` |
| Bomb accuracy | 60% day, 40% night; 30% of day bombers drop two sticks | `S.resolveRaid` |
| Hit split | 35% runway, 27% parked aircraft, 38% buildings | `S.resolveRaid` |
| Crater filling | 3 h each ÷ (1 + ground crew / 4) | `S.craterHoursEach` |
| Building repair | 4% + 0.4% per ground crew, per hour | `S.buildingRepairRate` |
| Rush repairs | £150 per crater; damage × level × £6 for buildings | `S.rushCost` |

- A building with 50%+ damage works one level lower until repaired (`S.lvl`).
- Fighter interception: each fighter downs about strength / (2.5 + 0.4 × escorts) bombers, and
  fighters can also turn some back.
- **Seen in testing:** before tuning, rep-60+ raids of up to 14 bombers hit 10+ times and were
  crippling. Cut to at most 10 bombers, with lower accuracy and fewer double sticks. Undefended
  stations still take real losses (several aircraft and craters per raid at high rep).
- **To check:** whether early raids (Day 4–10, rep < 20) feel fair with no AA. Consider
  guaranteeing a quiet first week, or limiting the first raids to 2–3 bombers.
- **To check:** a cratered runway blocks all take-offs, including scrambles. Fair, but it can
  snowball, because the next raid finds fighters grounded.

- Timeline: warning → (at least 8 min to scramble) → formation in sight, battle decided →
  fighter kills about 4–8 min before arrival, AA kills around arrival → bombs land −1 to +2 min
  around arrival, each applied at its own minute → report logged. Scrambled fighters stay up
  until 20 min after arrival, then land.
- **To check:** whether the 8-minute minimum decision window feels long enough at 4x/12x.
  (The game pauses on warnings by default.)

## Repairs and turnaround

- Repair rate per bay: 1 + 2.5 × min(mechanics per active bay, 6) % per hour (`S.repairRate`).
- Turnaround: 120 × 3 / (3 + ground crew) minutes, −15% per runway level above 1, minimum 20 min.
- Auto-repair sends aircraft below 60% to the hangar when they park.
- Each aircraft keeps its own bay. Towing in and out takes 30 min each way, and the doors take
  one tow every 8 min, so an aircraft spends about an hour more out of service than its repair
  time alone. Raise `doorGap`/`tow` for more congestion, or lower them if the hangar feels slow.

## Playtest checklist

- [ ] Does 1x feel too slow now that a day is 24 real minutes?
- [ ] Is the first raid survivable with the starting station?
- [ ] How long until the Spitfire unlocks in normal play? (Target: a few in-game weeks?)
- [ ] Is money ever a real constraint after the first week?
- [ ] Are blast pens and AA worth their cost compared with simply buying more aircraft?
- [ ] Do radio calls feel like real decisions, or is one option always right?
- [ ] Is pausing for every radio call welcome, or too frequent at 12x?
- [ ] Are directives achievable without derailing everything else?
