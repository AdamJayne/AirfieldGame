# Airfield Command

A browser management game: run an RAF fighter station through the summer of 1940.

You start with a grass strip, a blister hangar, officers' and enlisted barracks, two
Tiger Moths, a Gloster Gladiator, and three green pilots. Fly missions for Group HQ to
earn funds and reputation, then upgrade the station and requisition better aircraft,
up to Hurricanes, Blenheims and Spitfires.

## Running

Open `index.html` in a browser. There's no build step and nothing to install. The 3D view
loads Three.js (r158) from the jsDelivr CDN, so it needs an internet connection. Without one,
or without WebGL, the game falls back to the 2D map automatically.

URL options:

- `?flat` uses the 2D map instead of 3D.
- `?sandbox` starts a throwaway game that never reads or writes your save, which is handy for testing.

If you'd rather serve it over HTTP:

```powershell
powershell -ExecutionPolicy Bypass -File tools\serve.ps1
```

then open http://localhost:8765.

## Deploying

Pushing to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml), which builds
the site and publishes it to GitHub Pages. The build (`tools/build.mjs`, using esbuild) bundles the
local scripts into one minified, content-hashed file, minifies the stylesheet, and writes the
result to `dist/`. To try the production build locally (needs Node.js):

```powershell
npm install
npm run build
powershell -ExecutionPolicy Bypass -File tools\serve.ps1 -Root dist
```

One-time setup: in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**.

## Title menu

The game opens on a title menu with a demo station playing behind it: a cinematic camera
cuts between raids coming in (fighters and AA guns firing, bombs falling on the field),
aircraft taxiing, tows to the hangar, refuelling, and buildings going up. From the menu you can
**Resume** your saved game, start a **New game** (or **Play**, the first time), read **How to
play**, or see **About**. In a game, **Guide** opens How to Play (pausing the game) and **Menu**
saves and returns to the title menu.

## How to play

The in-game guide (Guide button, or How to play on the menu) covers everything in more detail.
In brief:


- **Missions**: pick aircraft for an order from Group HQ, choose how they fly it (Cautious,
  Standard or Aggressive), and launch. Success odds depend on aircraft stats, pilot skill,
  airframe condition, morale, the control tower, and the tactic. Reconnaissance runs on speed
  rather than firepower.
- **Radio calls**: most sorties call in once while they're out: bandits in the sun, flak over the
  target, an engine running rough. Pick an order from the card that appears. Each choice trades
  odds, losses, claims, pay or time aloft. The game pauses for the call (Supply → Standing
  Orders to turn that off); if nobody answers, the flight leader takes the first option.
- **Victories and aces**: pilots claim enemy aircraft on combat missions and when intercepting
  raids. Five victories make an ace (+morale, +reputation).
- **Group directives**: Group HQ sometimes issues a directive with a deadline: complete so many
  missions of a type, destroy so many enemy aircraft, or keep fighters at readiness through the
  day. Carry it out for money and reputation; miss it and you lose reputation. The current
  directive is pinned to the corner of the airfield view.
- **Aircraft**: each aircraft needs an assigned pilot. Damaged aircraft (below 50%) can't
  fly until the hangar repairs them, which uses spare parts and is faster with more mechanics.
- **Personnel**: the officers' barracks limits how many pilots you can have, and the
  enlisted barracks limits mechanics and ground crew. Ground crew shorten refuel turnaround.
  Pilots get tired after missions and recover in their quarters.
- **Supply**: buy fuel (storage is capped by the fuel depot) and spare parts.
- **Economy**: an Air Ministry allowance (which grows with reputation) arrives at
  midnight, and wages are paid at the same time.
- Reputation unlocks harder missions and better aircraft.
- **Air raids**: from the first week on, the Luftwaffe raids the station, more often as your
  reputation grows. The control tower decides how much warning you get, and the game pauses
  when a raid is plotted (you can turn that off in Supply → Standing Orders). Scramble your
  fighters to intercept: the raid warning lists every fit fighter, so you can hold some back
  and send more up later. As they close with the formation, the controller asks how to attack.
  Anti-aircraft defences shoot bombers down, and blast pens shield parked aircraft. Bombs
  crater the runway, which grounds everything until ground crews fill the holes. They also
  damage buildings: a building with 50%+ damage works one level lower until it's repaired.
  You can pay contractors to rush repairs.
- **Readiness**: put fighters at readiness (Aircraft tab or the aircraft's info box). The pilot
  waits in the cockpit with a starter trolley plugged in, so the fighter scrambles in 3 minutes
  instead of 8 and meets the raiders with height in hand. Waiting tires the pilot instead of
  letting them rest. Pilots not at readiness wait in deckchairs by the dispersal hut.
- **Selling aircraft**: select an aircraft and use **Sell** in its info box (or on the
  Aircraft tab). The price depends on its condition.

## Controls

| Input | Action |
| --- | --- |
| Click | Select a building or aircraft: centres the camera and opens its info box |
| Double-click | Zoom right in on it |
| Esc | Close the info box |
| Drag | Rotate the view |
| Right-drag, Shift-drag, WASD or arrows | Pan |
| Scroll, R/F | Zoom |
| Q / E | Rotate |
| H | Reset the view |
| Space | Pause or resume |
| 1–3 | Game speed |

At 1x, one game minute passes per real second (a day takes 24 minutes); 4x and 12x speed this up.
Aircraft taxi, take off and land on the game clock, so what you see always matches their
status. The game autosaves each day to browser storage.

## Code layout

| File | Purpose |
| --- | --- |
| `js/data.js` | Aircraft, buildings, missions, names, tuning constants |
| `js/state.js` | New-game setup, helpers, save/load |
| `js/sim.js` | Simulation: time, missions, repairs, economy, player commands |
| `js/render.js` | 2D fallback map |
| `js/three/textures.js` | Procedural canvas textures (brick, camouflage, roundels, grass…) |
| `js/three/models.js` | 3D buildings for each upgrade level, vehicles, people, dispersal hut |
| `js/three/aircraft.js` | 3D aircraft built from per-type specs: lofted fuselages, aerofoil wings, moving controls |
| `js/three/world.js` | Countryside, airfield surfaces, sky, sun and moon lighting, clouds |
| `js/three/render3d.js` | 3D view: camera, taxi/takeoff/landing animations, picking, labels |
| `js/ui.js` | Header, tabbed command panel, log, tooltips, dialogs |
| `js/demo.js` | The demo station behind the title menu, and the director that keeps it busy |
| `js/menu.js` | Title menu, How to Play guide, new-game welcome card |
| `js/main.js` | Renderer selection and main loop |

Everything in the 3D scene is generated in code. There are no image or model files.

Tuning values, test findings and open balance questions are tracked in [BALANCING.md](BALANCING.md).
