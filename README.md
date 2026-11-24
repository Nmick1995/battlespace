<div align="center">

![BattleSpace](docs/screenshots/title.jpg)

# BATTLESPACE

**Classic naval strategy, fought between starfleets in orbit.**

A cinematic 3D take on Battleship for the browser, with procedural starships, per-section damage, a camera that follows every salvo, and a synthesized monk-choir soundtrack. Built entirely with code: no models, textures or audio files.

### [▶ Play in your browser](https://nmick1995.github.io/battlespace/)

[Features](#features) · [Gallery](#gallery) · [Run locally](#play-it) · [Rules](#rules-of-engagement) · [How it's made](#how-its-made)

</div>

---

## About

Two fleets hold position above a ringed gas giant, each hidden from the other behind cloaking fields. You get one salvo per turn. Every shot you fire becomes a short cinematic: the camera drops in beside one of your ships, its turrets swing toward the target, and the camera rides the salvo across the gap. If you hit, you see an explosion and nothing else, because the enemy hull stays cloaked. If you miss, the round fades out in a soft ripple.

Once every section of a ship has been hit, its cloak fails. The camera circles the hull while the damage from earlier hits glows through the plating, secondary explosions run along the ship, and the reactor goes up and breaks the ship into burning pieces. Your own ships get the same treatment.

The rules are the classic ones. The rest is space opera.

## Features

- **Five distinct starship classes.** Each has its own hull and weapon system:

  | Class | Size | Weapon | Style |
  |---|---|---|---|
  | Leviathan Carrier | 5 | VLS missile swarm | Missiles launch upward and curve in on smoke trails |
  | Dreadnought Battleship | 4 | Twin plasma batteries | Three turrets that track the target and fire heavy plasma |
  | Vanguard Cruiser | 3 | Spinal railgun | Charges up, then fires a slug with a shockwave |
  | Phantom Stealth Frigate | 3 | Void torpedoes | Spiraling violet torpedoes |
  | Lancer Destroyer | 2 | Pulse lasers | Quick green bursts from pods on the wingtips |

- **Three battle modes.** Tactical gives every ship an ability that costs Energy. Salvo gives you one shot per surviving ship each turn. Classic is one shot per turn with no abilities.
- **Ship abilities.** Recon Sweep, Plasma Barrage, Railgun Lance, Void Torpedo and Rapid Fire. You lose an ability when its ship is destroyed, and the enemy uses the same abilities against you.
- **A service record.** Wins, best scores, win streaks and your rank are saved in your browser, along with your settings.
- **Damage by section.** Every grid cell a ship covers is its own section. A hit section chars and glows with molten cracks, catches fire and smokes, sparks, loses its lights, engines and turrets, and sheds loose parts.
- **Cinematics for everything.** Firing shots, chase cams, impact cuts, incoming-fire warnings and ship destruction, all with letterboxing, film grain, chromatic aberration, slow motion and screen shake. Hold `Space` to fast-forward.
- **Nothing gives away enemy positions.** Enemy ships stay invisible until they sink. Enemy fire comes from off-screen, so it never reveals where their fleet is.
- **An original generated soundtrack.** Menu music is Gregorian-style chant with an organum choir, full choir chords, taiko drums and string ostinatos. In-game music is a quieter, tense ambient version. Every sound effect is synthesized live with the Web Audio API.
- **Three AI threat levels.** Cadet, Commander and Admiral. Admiral scores every legal placement of your remaining ships and fires at the most likely cell. All three use abilities in Tactical mode and fire full salvos in Salvo mode.
- **Failing shields.** Your ships' shields flare with a hex-pattern ripple at the point of impact before the hull breaks.
- **A living backdrop.** Procedural nebula, a banded gas giant with rings and an atmosphere, cratered asteroids with per-pixel rock detail, drifting space dust, and HDR bloom.

## Gallery

<table>
<tr>
<td width="50%"><img src="docs/screenshots/dreadnought.jpg" alt="Dreadnought turrets"><br><sub><b>Main menu</b>: the camera flies past the fleet in formation</sub></td>
<td width="50%"><img src="docs/screenshots/fleet-deployed.jpg" alt="Fleet deployed"><br><sub><b>Deployment</b>: your fleet on the holographic grid</sub></td>
</tr>
<tr>
<td><img src="docs/screenshots/targeting.jpg" alt="Targeting"><br><sub><b>Targeting</b>: choose a coordinate on the hostile sector</sub></td>
<td><img src="docs/screenshots/railgun-charging.jpg" alt="Railgun charging"><br><sub><b>Firing solution</b>: the Vanguard lines up its spinal railgun</sub></td>
</tr>
<tr>
<td><img src="docs/screenshots/railgun-firing.jpg" alt="Railgun firing"><br><sub><b>Railgun discharge</b>: the magnetic coils fire the slug</sub></td>
<td><img src="docs/screenshots/missile-chase.jpg" alt="Missile chase cam"><br><sub><b>Chase cam</b>: following the Carrier's missile swarm</sub></td>
</tr>
<tr>
<td><img src="docs/screenshots/miss-ripple.jpg" alt="Miss ripple"><br><sub><b>Miss</b>: the round fades out in a circular wave</sub></td>
<td><img src="docs/screenshots/incoming-fire.jpg" alt="Incoming fire"><br><sub><b>Incoming</b>: hostile plasma closes on the Dreadnought</sub></td>
</tr>
<tr>
<td><img src="docs/screenshots/hull-breach.jpg" alt="Hull breach"><br><sub><b>Hull breach</b>: debris blown off the struck section</sub></td>
<td><img src="docs/screenshots/carrier-decloaked.jpg" alt="Carrier decloaked"><br><sub><b>Target neutralised</b>: the enemy carrier's cloak fails, showing every hit</sub></td>
</tr>
<tr>
<td><img src="docs/screenshots/frigate-decloaked.jpg" alt="Frigate decloaked"><br><sub><b>Stealth frigate revealed</b>, burning from stern to bow</sub></td>
<td><img src="docs/screenshots/carrier-breakup.jpg" alt="Carrier breakup"><br><sub><b>Reactor breach</b>: the hull breaks into burning pieces</sub></td>
</tr>
<tr>
<td><img src="docs/screenshots/shield-flare.jpg" alt="Shield flare"><br><sub><b>Shields failing</b>: a hex-pattern energy ripple spreads from the impact point</sub></td>
<td><img src="docs/screenshots/cruiser-decloaked.jpg" alt="Cruiser decloaked"><br><sub><b>Cloak down</b>: every section burning where it was struck</sub></td>
</tr>
<tr>
<td><img src="docs/screenshots/reactor-breach.jpg" alt="Reactor breach"><br><sub><b>Reactor breach</b>: a slow-motion flash with an anamorphic lens streak</sub></td>
<td><img src="docs/screenshots/cruiser-breakup.jpg" alt="Cruiser breakup"><br><sub><b>Cruiser destroyed</b>: burning segments tumble across the grid</sub></td>
</tr>
<tr>
<td><img src="docs/screenshots/frigate-breakup.jpg" alt="Frigate destroyed"><br><sub><b>Stealth frigate destroyed</b></sub></td>
<td><img src="docs/screenshots/defeat.jpg" alt="Defeat"><br><sub><b>Defeat</b>: the Commander AI won this match, and its survivors are revealed</sub></td>
</tr>
</table>

## Play it

**No install needed:** play at **https://nmick1995.github.io/battlespace/** in any modern desktop browser with WebGL2.

To run it locally instead, you need [Node.js](https://nodejs.org/) (any recent version) and an internet connection the first time, to load Three.js and fonts from a CDN. There are no dependencies to install.

```bash
git clone https://github.com/Nmick1995/battlespace.git
cd battlespace
npm start
```

Then open **http://localhost:8080**. On Windows you can also double-click `start.bat`.

> Any static file server works (for example `python -m http.server 8080`). Opening `index.html` straight from disk won't work, because browsers block ES modules loaded from `file://`.

Use headphones. The soundtrack is half the experience.

## Rules of engagement

BattleSpace follows the classic rules of Battleship. The battle mode you pick on the main menu changes what you can do on your turn.

1. **Deploy.** Each side places five ships on its own 10×10 grid: Carrier (5), Battleship (4), Cruiser (3), Stealth Frigate (3, the classic "submarine"), and Destroyer (2). Ships go horizontally or vertically. They can't be placed diagonally or overlap.
2. **Fire.** Players take turns firing at cells on the enemy's grid, such as `C7`. The battle mode sets how many shots you get.
3. **Report.** Each shot is called as a hit or a miss. Hits are marked in red and misses in cyan, so you never waste a shot.
4. **Sink.** When every section of a ship has been hit, the ship is destroyed and its class is announced.
5. **Win.** The first commander to destroy the entire enemy fleet wins.

### Battle modes

| Mode | Shots per turn | Abilities |
|---|---|---|
| **Tactical** (default) | 1 | Yes, paid for with Energy |
| **Salvo** | 1 for each of your ships that is not destroyed | No |
| **Classic** | 1 | No |

### Tactical abilities

You start with 1 Energy. You gain 1 at the start of each of your turns and 1 for each hit, up to a maximum of 8. You can use one ability per turn. Each ability belongs to one ship and is lost when that ship is destroyed. The enemy has the same abilities and the same Energy rules.

| Key | Ability | Ship | Cost | Effect |
|---|---|---|---|---|
| `1` | Recon Sweep | Carrier | 3 | Scans a 3×3 area and shows how many intact ship sections are inside. You still fire 1 shot that turn. The number on the grid goes down as you hit those sections. An area with 0 left is marked as empty. |
| `2` | Plasma Barrage | Battleship | 4 | Fires at 5 cells in a plus pattern. |
| `3` | Railgun Lance | Cruiser | 5 | Fires down a full row or column. The slug stops at the first intact ship section. Every cell it passes is marked as a miss. |
| `4` | Void Torpedo | Stealth Frigate | 3 | Fires at 1 cell. On a hit, the 4 adjacent cells are revealed as ship or empty. |
| `5` | Rapid Fire | Destroyer | 2 | Fires at 2 cells of your choice. |

### Score and rank

A win scores 100 for each of your ship sections that is still intact, 20 for each point of accuracy, and 25 for each turn under 60. A loss scores 30 for each enemy section you hit. Commander multiplies the score by 1.5 and Admiral by 2. Each win also earns rank points: 1 on Cadet, 2 on Commander, 3 on Admiral. Your record is stored in your browser only. You can reset it from **Service Record** on the main menu.

### Controls

| Action | Input |
|---|---|
| Place ship | Left click |
| Rotate ship | `R`, right click, or the **ROTATE** button |
| Fire | Left click on the hostile grid |
| Select an ability (Tactical) | `1`–`5`, or click it in the bar at the bottom |
| Cancel an ability or clear selected cells | `Esc` |
| Change Railgun Lance direction | `R`, right click, or the **ROTATE** button |
| Fire selected cells (Salvo, Rapid Fire) | `Enter`, `F`, or the **FIRE** button |
| Toggle fleet / target view | `V` |
| Fast-forward a cinematic | Hold `Space` |
| Mute | `M` |
| Touch screens | Tap a cell to preview, tap it again to place, fire or select it. Use the **ROTATE** and **FIRE** buttons. |

### Threat levels

| Level | Doctrine | Avg. shots to win* |
|---|---|---|
| **Cadet** | Random fire, then probes around hits | ~63 |
| **Commander** | Hunt & target with checkerboard parity | ~51 |
| **Admiral** | Probability density over every legal remaining ship placement | ~44 |

<sub>*Classic mode, measured over 200 simulated games per level. With abilities in Tactical mode the same levels need about 43, 30 and 28 turns.</sub>

## How it's made

Everything you see and hear is generated at runtime. The repository contains no binary assets apart from the screenshots.

| File | Responsibility |
|---|---|
| [`js/main.js`](js/main.js) | Game flow, turns, cinematic direction, UI and input |
| [`js/ships.js`](js/ships.js) | Procedural starship models, built per section for localized damage and breakup |
| [`js/fx.js`](js/fx.js) | GPU particle system, explosions, shockwaves, debris and projectiles |
| [`js/world.js`](js/world.js) | Renderer, bloom and film post-processing, nebula shader, planet, asteroids, holographic grids and the camera rig |
| [`js/audio.js`](js/audio.js) | Web Audio soundtrack (formant-filtered choir, taiko, strings, brass) and all sound effects |
| [`js/ai.js`](js/ai.js) | The three opponent AIs, including ability and salvo targeting |
| [`js/rules.js`](js/rules.js) | Battle modes, ability definitions, cell patterns, scoring and ranks |
| [`js/store.js`](js/store.js) | Saved settings and service record (`localStorage`) |
| [`js/core.js`](js/core.js) | Game-time tween/sequence engine, which is what lets cinematics fast-forward |

Some implementation details:

- **Ships** are built from extruded hull profiles, rounded boxes and cylinders, cut into one "segment" per grid cell. Each segment gets its own copy of the materials, so a hit can char that section without touching the rest. When a ship is destroyed, its segments detach and tumble away as separate burning pieces.
- **Hull plating, window lights and burn cracks** are canvas-generated textures, projected onto every part with box-mapped UVs.
- **The choir** is detuned sawtooth voices with vibrato, run through band-pass filters tuned to the resonances of vowels like "ah", "oh" and "oo", then into a long convolution reverb that simulates a cathedral.
- **Cinematics** are `async` sequences driven by a game clock, so holding `Space` speeds up everything evenly: camera moves, particles and projectiles.

Built with [Three.js](https://threejs.org/) and plain ES modules. There's no build step.

## Patch notes

**2026-11-23**
- Added battle modes: Tactical (new default), Salvo and Classic.
- Added Energy and five ship abilities in Tactical mode: Recon Sweep, Plasma Barrage, Railgun Lance, Void Torpedo and Rapid Fire. The AI uses them too.
- Added cinematics for multi-cell attacks: fleet salvos, barrages and the lance.
- Added a service record with ranks, best scores and win streaks. Settings are now saved between visits.
- Added a score, enemy accuracy and record results to the end-of-battle screen.
- Fixed the Commander AI treating a hit in column 10 as adjacent to column 1 of the next row.

**2026-10-07**
- Fixed a black oval that could appear around your ships for a second or two after they were hit. The shield-flare shader produced invalid values on some GPUs (notably Chrome and Edge on Windows), which rendered as black.
- Fixed the same kind of rendering glitch in shockwave rings, the nebula and the radar sweep.

**2026-10-05**
- Fixed input and memory bugs.
- Upgraded explosions, asteroids, the planet and shield effects.

## Contributing

Issues and pull requests are welcome. Some ideas:

- Local two-player hot-seat mode
- More ship classes and faction hull styles
- Mobile touch controls

## License

[MIT](LICENSE). Free to use, modify and share.

BattleSpace is an independent fan project inspired by the classic pencil-and-paper game. It is not affiliated with or endorsed by Hasbro, owner of the *Battleship* trademark, or by the owners of *Halo*. The soundtrack is an original composition.
