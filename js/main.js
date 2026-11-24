// BattleSpace — game flow, cinematics, input and UI.
import * as THREE from 'three';
import { World, Grid, GRID } from './world.js';
import { FX } from './fx.js';
import { Ship, SHIP_TYPES, CELL, HOVER } from './ships.js';
import { AI } from './ai.js';
import { AudioEngine } from './audio.js';
import { clock, tween, wait, updateTasks, ease, lerp, rand, pick } from './core.js';
import { MODES, ENERGY, ABILITIES, ABILITY, DIRS, plusCells, adjacentCells, areaOrigin, areaCells, lineCells, battleScore } from './rules.js';
import { save, persist, recordBattle, currentRank, rankPoints, totals, resetRecord } from './store.js';

const $ = (id) => document.getElementById(id);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const ROWS = 'ABCDEFGHIJ';
const coord = (r, c) => ROWS[r] + (c + 1);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : w === w.toUpperCase() ? 'S' : 's'}`;

// ------------------------------------------------------------------ setup
const world = new World($('c'));
const { scene, rig } = world;
const fx = new FX(scene);
const audio = new AudioEngine();
const SET = save.settings;
if (typeof SET.music === 'number') audio.musicVol = SET.music;
if (typeof SET.sfx === 'number') audio.sfxVol = SET.sfx;
function saveSettings() {
  Object.assign(SET, { music: audio.musicVol, sfx: audio.sfxVol, quick: S.quick, difficulty: S.difficulty, mode: S.mode });
  persist();
}
world.onResize = (h) => fx.setScale(h);
fx.setScale(innerHeight * world.renderer.getPixelRatio());

const playerGrid = new Grid(scene, V(0, 0, 30), 0x3fc8ff, 'HOME FLEET');
const enemyGrid = new Grid(scene, V(0, 0, -30), 0xff4a5a, 'HOSTILE SECTOR');
playerGrid.group.visible = enemyGrid.group.visible = false;

// targeting reticle
const reticle = new THREE.Group();
{
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.4, 0.6), toneMapped: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const a = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.14), m); a.position.set(sx * 1.55, 0, sz * 1.9); reticle.add(a);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 1.2), m); b.position.set(sx * 1.9, 0, sz * 1.55); reticle.add(b);
  }
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.12, 48, 1, 0, Math.PI * 1.5), m);
  ring.rotation.x = -Math.PI / 2; reticle.add(ring); reticle.userData.ring = ring;
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.15, 12), m); dot.rotation.x = -Math.PI / 2; reticle.add(dot);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 8, 6, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.6, 0.4), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  beam.position.y = 4; reticle.add(beam);
  reticle.visible = false;
  scene.add(reticle);
}

// ------------------------------------------------------------------ state
const S = {
  state: 'splash', // splash | menu | placing | player | busy | over
  difficulty: 'commander',
  mode: 'tactical', // tactical | salvo | classic
  quick: false,
  battle: false, // true from ENGAGE until the battle ends
  energy: { player: 0, enemy: 0 },
  sel: { ability: null, dir: 0, queue: [] }, // current targeting choice
  abilityUsed: false, // one ability per turn
  scans: [], // Recon Sweep results still shown on the hostile grid
  helpAb: null,
  view: 'fleet',
  cine: false,
  skip: false,
  slowmo: 1,
  player: null, enemy: null, ai: null,
  place: { idx: 0, vertical: false, ghost: null, hover: null },
  stats: { shots: 0, hits: 0, turns: 0, enemyShots: 0, enemyHits: 0 },
  parade: [],
};
const DIFFS = ['cadet', 'commander', 'admiral'];
if (DIFFS.includes(SET.difficulty)) S.difficulty = SET.difficulty;
if (MODES.some((m) => m.id === SET.mode)) S.mode = SET.mode;
S.quick = !!SET.quick;
const modeName = () => MODES.find((m) => m.id === S.mode).name;

function newBoard() { return { ships: [], occ: new Array(100).fill(-1), shots: new Array(100).fill(0) }; }

// ------------------------------------------------------------------ menu fleet (background of the main menu)
function buildParade() {
  const layout = [['carrier', 0, 0, 0], ['battleship', -9, 3, 7], ['cruiser', 10, -2, 9], ['frigate', -8, -4, -11], ['destroyer', 8, 4, -13]];
  for (const [id, x, y, z] of layout) {
    const s = new Ship(SHIP_TYPES.find((t) => t.id === id), 'player', fx);
    s.root.position.set(x, y + 20, z + 400);
    s.root.rotation.y = Math.PI / 2;
    scene.add(s.root);
    S.parade.push(s);
  }
  const e = new Ship(SHIP_TYPES[1], 'enemy', fx);
  e.root.position.set(-60, 5, 200); e.root.rotation.y = -Math.PI / 2 + 0.3; e.root.scale.setScalar(1.3);
  scene.add(e.root); S.parade.push(e);
}
function setParade(v) { for (const s of S.parade) s.root.visible = v; }

const fade = document.createElement('div');
Object.assign(fade.style, { position: 'fixed', inset: 0, background: '#000', opacity: 0, pointerEvents: 'none', zIndex: 9, transition: 'opacity 0.35s' });
document.body.appendChild(fade);

let menuShot = -1;
function menuCamera(t) {
  const P = V(0, 20, 400);
  const T = 10, n = Math.floor(t / T) % 4, k = (t % T) / T;
  if (n !== menuShot) { menuShot = n; }
  if (k > 0.965) fade.style.opacity = 1; else if (k > 0.02) fade.style.opacity = 0;
  rig.sway = 0.4;
  switch (n) {
    case 0: // low pass along the carrier hull
      rig.set(P.clone().add(V(lerp(7, 3.5, k), lerp(-1.5, 0.8, k), lerp(16, -12, k))), P.clone().add(V(0, 0.5, lerp(0, -18, k))), 38);
      break;
    case 1: { // wide orbit of the formation
      const a = 0.9 + k * 0.7;
      rig.set(P.clone().add(V(Math.cos(a) * 46, 14 - k * 6, Math.sin(a) * 46)), P.clone().add(V(0, 0, -2)), 45);
      break;
    }
    case 2: // battleship turrets close-up
      rig.set(P.clone().add(V(lerp(-4, -5.5, k), lerp(6.5, 4.5, k), lerp(12, 2, k))), P.clone().add(V(-9, 3.4, lerp(4, -2, k))), 34);
      break;
    case 3: // from ahead, fleet with the gas giant behind — no: fleet heading toward planet, view from behind-high
      rig.set(P.clone().add(V(lerp(18, 8, k), lerp(9, 6, k), lerp(46, 34, k))), P.clone().add(V(-4, 0, -30)), 42);
      break;
  }
}

function menuDust() {
  // space dust streaming past the moving fleet
  const P = V(0, 20, 400);
  for (let i = 0; i < 3; i++) {
    const p = P.clone().add(V(rand(-40, 40), rand(-20, 20), rand(-70, -40)));
    fx.add.spawn(p, V(0, 0, rand(50, 80)), 1.6, rand(0.1, 0.25), 0.1, new THREE.Color(0.5, 0.7, 1), new THREE.Color(0.2, 0.3, 0.5), 0.6, 0);
  }
}

// ------------------------------------------------------------------ views
function fit() { return Math.max(1, 1.45 / (innerWidth / innerHeight)); }
function viewFor(which) {
  const g = which === 'fleet' ? playerGrid : enemyGrid;
  // with the tactical bar on screen, pull back and aim lower so the bar does not cover the bottom rows
  // (on narrow windows the bar sits higher, above the log, so it needs more room)
  const bar = S.battle && S.mode !== 'classic' ? (innerWidth <= 1340 ? 2 : 1) : 0, k = fit() * [1, 1.1, 1.2][bar];
  return { pos: g.center.clone().add(V(0, 44 * k, 33 * k)), look: g.center.clone().add(V(0, 0, [-1.5, 5, 9][bar])), fov: 50 };
}
// Every camera move takes ownership of the rig; older moves still running become no-ops.
rig.token = 0;
function camTween(dur, fn, e = ease.inOut) {
  const id = ++rig.token;
  rig.follow = null;
  return tween(dur, (k, p) => { if (rig.token === id) fn(k, p); }, e);
}
function camFollow(f) { ++rig.token; rig.follow = f; }
function goView(which, dur = 1.4) {
  S.view = which;
  const v = viewFor(which);
  const p0 = rig.pos.clone(), l0 = rig.look.clone(), f0 = rig.fov;
  return camTween(dur, (k) => { rig.pos.lerpVectors(p0, v.pos, k); rig.look.lerpVectors(l0, v.look, k); rig.fov = lerp(f0, v.fov, k); });
}

// ------------------------------------------------------------------ UI helpers
function setCine(on) {
  S.cine = on;
  document.body.classList.toggle('cine', on);
  const a0 = world.cine.uniforms.amount.value;
  tween(0.8, (k) => { world.cine.uniforms.amount.value = lerp(a0, on ? 1 : 0, k); });
  if (!on) { $('caption').classList.remove('show'); rig.sway = 1; }
  else rig.sway = 0.25;
}
function caption(small, big, enemy = false) {
  const c = $('caption');
  c.classList.toggle('enemy', enemy);
  $('capSmall').textContent = small; $('capBig').textContent = big;
  c.classList.remove('show'); void c.offsetWidth; c.classList.add('show');
}
function announce(text, cls) {
  const a = $('annText');
  a.className = 'ann-text'; a.textContent = text; void a.offsetWidth;
  a.classList.add(cls, 'go');
}
function flashScreen(v = 1, dur = 0.6) { tween(dur, (k) => { world.cine.uniforms.flash.value = v * (1 - k); }, ease.out); }
function log(msg, cls = '') { const d = document.createElement('div'); d.textContent = msg; d.className = cls; $('log').prepend(d); while ($('log').children.length > 12) $('log').lastChild.remove(); }
function banner(text, sub, enemy = false) { $('turnBanner').textContent = text; $('turnSub').textContent = sub; $('turnBanner').classList.toggle('enemy', enemy); }

function renderPanels() {
  if (!S.player) return;
  const row = (s, known) => {
    const sunk = s.hits.size === s.len;
    const pips = Array.from({ length: s.len }, (_, i) => `<span class="${known ? (s.hits.has(i) ? 'hit' : '') : sunk ? 'hit' : 'unk'}"></span>`).join('');
    return `<div class="ship-row ${sunk ? 'sunk' : ''}"><div><span class="nm">${known || sunk ? s.name : 'UNKNOWN CONTACT'}</span><span class="cls">${s.type.cls.split(' ')[0]} · ${s.type.name.toUpperCase()}</span></div><div class="pips">${pips}</div></div>`;
  };
  $('fleetList').innerHTML = S.player.ships.map((s) => row(s, true)).join('');
  $('enemyList').innerHTML = S.enemy.ships.map((s) => row(s, false)).join('');
  const st = S.stats;
  const energy = S.mode === 'tactical' ? `<span>ENEMY ENERGY</span><b>${S.energy.enemy}/${ENERGY.max}</b>` : '';
  $('stats').innerHTML = `<span>SHOTS</span><b>${st.shots}</b><span>HITS</span><b>${st.hits}</b><span>ACCURACY</span><b>${st.shots ? Math.round((st.hits / st.shots) * 100) : 0}%</b>${energy}<span>MODE</span><b>${modeName()}</b><span>THREAT</span><b>${S.difficulty.toUpperCase()}</b>`;
  renderTactical();
}

// ------------------------------------------------------------------ menu
const PANELS = {
  settings: () => `<div class="box"><h3>SYSTEMS</h3>
    <label>MUSIC <input type="range" min="0" max="1" step="0.05" value="${audio.musicVol}" id="volMusic"></label>
    <label>EFFECTS <input type="range" min="0" max="1" step="0.05" value="${audio.sfxVol}" id="volSfx"></label>
    <label>CINEMATICS <span class="opt"><button data-q="0" class="${S.quick ? '' : 'on'}">FULL</button><button data-q="1" class="${S.quick ? 'on' : ''}">QUICK</button></span></label>
    <p style="margin-top:12px;font-size:14px;color:#7fa3b8">Hold SPACE during any cinematic to fast-forward.</p></div>`,
  briefing: () => `<div class="box"><h3>BRIEFING</h3>
    <p>Each side places 5 ships on a 10×10 grid, horizontally or vertically. Ships cannot overlap. Enemy ships stay hidden until they are destroyed.</p>
    <ul><li><b>Carrier</b> · 5 sections</li><li><b>Battleship</b> · 4 sections</li><li><b>Cruiser</b> · 3 sections</li><li><b>Stealth Frigate</b> · 3 sections</li><li><b>Destroyer</b> · 2 sections</li></ul>
    <p style="margin-top:8px">Players take turns firing at cells on the other grid. Each shot is reported as a hit or a miss. A ship is destroyed when every section is hit. Destroy all 5 enemy ships to win.</p>
    <p>BATTLE MODE sets how many shots you get per turn and whether ship abilities are available.</p></div>`,
  mode: () => `<div class="box"><h3>BATTLE MODE</h3><ul>
    ${MODES.map((m) => `<li class="${m.id === S.mode ? 'sel' : ''}"><b>${m.name}</b> · ${m.desc}</li>`).join('')}</ul>
    <h3 style="margin-top:14px">TACTICAL ABILITIES</h3>
    <p>You start with ${ENERGY.start} Energy. +${ENERGY.perTurn} at the start of each of your turns, +${ENERGY.perHit} for each hit. Maximum ${ENERGY.max}. 1 ability per turn. An ability is lost when its ship is destroyed. The enemy has the same abilities.</p>
    <ul class="abl">${ABILITIES.map((a) => `<li><b>${a.name}</b> · ${SHIP_TYPES.find((t) => t.id === a.ship).name} · ${a.cost} Energy<br>${a.desc}</li>`).join('')}</ul></div>`,
  record: () => {
    const rank = currentRank(), pts = rankPoints(), t = totals();
    const rows = [];
    for (const m of MODES) for (const d of DIFFS) {
      const e = save.record[`${m.id}:${d}`];
      if (e && e.played) rows.push(`<tr><td>${m.name} · ${d.toUpperCase()}</td><td>${e.wins}/${e.played}</td><td>${e.bestScore.toLocaleString()}</td><td>${e.bestStreak}</td><td>${e.fewestShots || '–'}</td></tr>`);
    }
    return `<div class="box"><h3>SERVICE RECORD</h3>
    <p>Rank: <b class="amber">${rank.name.toUpperCase()}</b> · ${plural(pts, 'rank point')}${rank.next ? ` · ${rank.next.at - pts} more for ${rank.next.name}` : ''}</p>
    <p>Battles: ${t.played} · Wins: ${t.wins}</p>
    ${rows.length ? `<table class="rec"><tr><th>MODE · THREAT</th><th>WINS</th><th>BEST SCORE</th><th>BEST STREAK</th><th>FEWEST SHOTS</th></tr>${rows.join('')}</table>` : '<p>No battles finished yet.</p>'}
    <p class="fine">Rank points per win: Cadet 1, Commander 2, Admiral 3.<br>Win score: 100 per intact section you keep + 20 per accuracy point + 25 per turn under 60. Loss score: 30 per enemy section hit. Commander ×1.5, Admiral ×2.</p>
    ${t.played ? '<span class="opt"><button id="btnResetRecord">RESET RECORD</button></span>' : ''}</div>`;
  },
  difficulty: () => `<div class="box"><h3>THREAT LEVEL</h3><ul>
    <li><b>CADET</b> — undisciplined fire, follows up on hits.</li>
    <li><b>COMMANDER</b> — methodical hunt &amp; target doctrine.</li>
    <li><b>ADMIRAL</b> — probabilistic fleet analysis. Merciless.</li></ul></div>`,
};
function showPanel(name) {
  const p = $('menuPanel');
  p.innerHTML = PANELS[name]();
  if (name === 'settings') {
    $('volMusic').oninput = (e) => audio.setMusicVolume(+e.target.value);
    $('volMusic').onchange = saveSettings;
    $('volSfx').oninput = (e) => { audio.setSfxVolume(+e.target.value); };
    $('volSfx').onchange = () => { audio.sfx('laser'); saveSettings(); };
    p.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => { S.quick = b.dataset.q === '1'; saveSettings(); showPanel('settings'); audio.sfx('click'); }));
  }
  if (name === 'record' && $('btnResetRecord')) {
    $('btnResetRecord').onclick = () => {
      if (!confirm('Delete your service record? This resets your rank and all best scores.')) return;
      resetRecord(); audio.sfx('click'); showPanel('record'); renderRank();
    };
  }
}
function renderRank() {
  const t = totals();
  $('rankLine').textContent = `RANK: ${currentRank().name.toUpperCase()} · ${plural(t.wins, 'WIN')}`;
}

document.querySelectorAll('.mbtn').forEach((b) => b.addEventListener('mouseenter', () => audio.sfx('hover')));
$('menu').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  audio.sfx('click');
  const act = b.dataset.act;
  if (act === 'play') startGame();
  if (act === 'difficulty') {
    S.difficulty = DIFFS[(DIFFS.indexOf(S.difficulty) + 1) % 3];
    $('diffLabel').textContent = S.difficulty.toUpperCase();
    saveSettings();
    showPanel('difficulty');
  }
  if (act === 'mode') {
    S.mode = MODES[(MODES.findIndex((m) => m.id === S.mode) + 1) % MODES.length].id;
    $('modeLabel').textContent = modeName();
    saveSettings();
    showPanel('mode');
  }
  if (act === 'record') showPanel('record');
  if (act === 'settings') showPanel('settings');
  if (act === 'briefing') showPanel('briefing');
});

function showMenu() {
  S.state = 'menu';
  $('hud').classList.add('hidden');
  $('gameover').classList.remove('show');
  playerGrid.group.visible = enemyGrid.group.visible = false;
  reticle.visible = false;
  setParade(true);
  $('diffLabel').textContent = S.difficulty.toUpperCase();
  $('modeLabel').textContent = modeName();
  renderRank();
  if ($('menuPanel').querySelector('.rec, .fine')) showPanel('record');
  $('menu').classList.add('show');
  requestAnimationFrame(() => $('menu').classList.add('visible'));
  audio.playMusic('menu');
}

// ------------------------------------------------------------------ game setup
function cleanupGame() {
  for (const side of [S.player, S.enemy]) if (side) for (const s of side.ships) s.dispose();
  if (S.place.ghost) { S.place.ghost.dispose(); S.place.ghost = null; }
  S.player = S.enemy = null;
  playerGrid.clearMarkers(); enemyGrid.clearMarkers();
  playerGrid.setHover(null); enemyGrid.setHover(null);
  fx.clear();
  $('log').innerHTML = '';
  // reset leftover UI from the previous engagement
  $('fleetList').innerHTML = ''; $('enemyList').innerHTML = ''; $('stats').innerHTML = '';
  $('annText').className = 'ann-text';
  $('caption').classList.remove('show');
  S.armed = -1;
  S.battle = false;
  S.scans = [];
  S.sel = { ability: null, dir: 0, queue: [] };
  S.abilityUsed = false;
  playerGrid.setTiles('scan', null);
  renderTactical();
}

async function startGame() {
  if (S.state !== 'menu' && S.state !== 'over') return;
  S.state = 'busy';
  cleanupGame();
  $('menu').classList.remove('visible');
  fade.style.opacity = 1;
  await wait(0.5);
  $('menu').classList.remove('show');
  setParade(false);
  S.player = newBoard(); S.enemy = newBoard();
  S.ai = new AI(S.difficulty);
  S.stats = { shots: 0, hits: 0, turns: 0, enemyShots: 0, enemyHits: 0 };
  S.energy = { player: ENERGY.start, enemy: ENERGY.start };
  // hostile fleet: placed at random, cloaked
  randomFleet(S.enemy, 'enemy');
  for (const s of S.enemy.ships) { s.root.visible = false; scene.add(s.root); }
  playerGrid.group.visible = enemyGrid.group.visible = true;
  audio.playMusic('battle');
  // establishing shot: sweep in from high above
  rig.set(V(-70, 110, 120), V(0, 0, 0), 50);
  fade.style.opacity = 0;
  $('hud').classList.remove('hidden');
  $('placement').classList.remove('hidden');
  $('enemyPanel').classList.add('hidden');
  banner('DEPLOY YOUR FLEET', 'Position all five vessels on your grid');
  S.state = 'busy';
  audio.sfx('whoosh');
  await goView('fleet', 2.6);
  beginPlacement();
}

function cellsFor(type, r, c, vertical, faction, flip = false) {
  const cells = [];
  for (let i = 0; i < type.len; i++) {
    if (vertical) cells.push(faction === 'player' ? { r: r + type.len - 1 - i, c } : { r: r + i, c });
    else cells.push(flip ? { r, c: c + type.len - 1 - i } : { r, c: c + i });
  }
  return cells;
}
function fits(board, cells) { return cells.every(({ r, c }) => r >= 0 && r < GRID && c >= 0 && c < GRID && board.occ[r * 10 + c] < 0); }
function addShip(board, ship, cells, grid) {
  ship.place(cells, (r, c) => grid.cellToWorld(r, c));
  const idx = board.ships.length;
  board.ships.push(ship);
  for (const { r, c } of cells) board.occ[r * 10 + c] = idx;
}
function randomFleet(board, faction) {
  const grid = faction === 'player' ? playerGrid : enemyGrid;
  for (const type of SHIP_TYPES) {
    if (board.ships.some((s) => s.type === type)) continue;
    for (let tries = 0; tries < 500; tries++) {
      const v = Math.random() < 0.5;
      const r = Math.floor(Math.random() * (v ? 11 - type.len : 10)), c = Math.floor(Math.random() * (v ? 10 : 11 - type.len));
      const cells = cellsFor(type, r, c, v, faction, faction === 'enemy' && Math.random() < 0.5);
      if (fits(board, cells)) { const s = new Ship(type, faction, fx); addShip(board, s, cells, grid); scene.add(s.root); break; }
    }
  }
}

// ------------------------------------------------------------------ placement
function beginPlacement() {
  S.state = 'placing';
  S.place.vertical = true;
  nextPlacement();
}
function nextPlacement() {
  const P = S.place;
  if (P.ghost) { P.ghost.dispose(); P.ghost = null; }
  P.idx = SHIP_TYPES.findIndex((t) => !S.player.ships.some((s) => s.type === t));
  renderPlaceList();
  renderPanels();
  $('btnEngage').disabled = P.idx >= 0;
  if (P.idx < 0) { playerGrid.setHover(null); return; }
  P.ghost = new Ship(SHIP_TYPES[P.idx], 'player', fx);
  P.ghost.setOpacity(0.45);
  P.ghost.root.visible = false;
  scene.add(P.ghost.root);
  updateGhost();
}
function renderPlaceList() {
  $('placeList').innerHTML = SHIP_TYPES.map((t, i) => {
    const done = S.player.ships.some((s) => s.type === t);
    return `<div class="place-item ${i === S.place.idx ? 'cur' : ''} ${done ? 'done' : ''}" data-i="${i}"><span>${t.name.toUpperCase()}</span><small>${'■'.repeat(t.len)}</small></div>`;
  }).join('');
  $('placeList').querySelectorAll('.place-item').forEach((el) => (el.onclick = () => {
    const t = SHIP_TYPES[+el.dataset.i];
    removePlayerShip(t);
    audio.sfx('click');
    nextPlacementFor(+el.dataset.i);
  }));
}
function nextPlacementFor(i) {
  const P = S.place;
  if (P.ghost) { P.ghost.dispose(); P.ghost = null; }
  P.idx = i; renderPlaceList(); renderPanels();
  $('btnEngage').disabled = true;
  P.ghost = new Ship(SHIP_TYPES[i], 'player', fx); P.ghost.setOpacity(0.45); P.ghost.root.visible = false; scene.add(P.ghost.root);
  updateGhost();
}
function removePlayerShip(type) {
  const B = S.player, i = B.ships.findIndex((s) => s.type === type);
  if (i < 0) return;
  B.ships[i].dispose(); B.ships.splice(i, 1);
  B.occ.fill(-1);
  B.ships.forEach((s, k) => s.cells.forEach(({ r, c }) => (B.occ[r * 10 + c] = k)));
}
function ghostCells() {
  const P = S.place; if (!P.hover || P.idx < 0) return null;
  const t = SHIP_TYPES[P.idx];
  let { r, c } = P.hover;
  if (P.vertical) r = Math.min(r, GRID - t.len); else c = Math.min(c, GRID - t.len);
  return { cells: cellsFor(t, r, c, P.vertical, 'player'), r, c };
}
function updateGhost() {
  const P = S.place, g = ghostCells();
  if (!P.ghost) return;
  if (!g) { P.ghost.root.visible = false; playerGrid.setHover(null); return; }
  const ok = fits(S.player, g.cells);
  P.ghost.place(g.cells, (r, c) => playerGrid.cellToWorld(r, c));
  P.ghost.root.visible = true;
  const t = SHIP_TYPES[P.idx];
  playerGrid.setHover({ r: g.r, c: g.c }, P.vertical ? 1 : t.len, P.vertical ? t.len : 1, ok ? new THREE.Color(0.15, 1.1, 0.45) : new THREE.Color(1.6, 0.12, 0.08));
}
function placeCurrent() {
  const P = S.place, g = ghostCells();
  if (!g) return;
  if (!fits(S.player, g.cells)) { audio.sfx('error'); return; }
  const s = new Ship(SHIP_TYPES[P.idx], 'player', fx);
  addShip(S.player, s, g.cells, playerGrid);
  scene.add(s.root);
  materialize(s);
  audio.sfx('place');
  nextPlacement();
}
function materialize(s) {
  s.setOpacity(0);
  const p = s.root.getWorldPosition(V());
  fx.ring(p.clone().setY(0.2), new THREE.Color(0.6, 2.5, 4), s.len * CELL * 0.7, 0.8, { thick: 0.05 });
  fx.sparks(p, 30, 8, new THREE.Color(1, 3, 5), 0.6, 0.2);
  tween(0.6, (k) => s.setOpacity(k)).then(() => s.setOpacity(1));
}
function rotatePlacement() { S.place.vertical = !S.place.vertical; audio.sfx('rotate'); updateGhost(); }

$('btnRandom').onclick = () => {
  if (S.state !== 'placing') return;
  audio.sfx('click');
  for (const s of S.player.ships) s.dispose();
  S.player = newBoard();
  randomFleet(S.player, 'player');
  S.player.ships.forEach(materialize);
  audio.sfx('place');
  nextPlacement();
};
$('btnRotate').onclick = () => { if (S.state === 'placing') rotatePlacement(); };
$('btnClear').onclick = () => { if (S.state !== 'placing') return; audio.sfx('click'); for (const s of S.player.ships) s.dispose(); S.player = newBoard(); nextPlacement(); };
$('btnEngage').onclick = () => { if (S.state === 'placing' && S.place.idx < 0) { audio.sfx('click'); engage(); } };

async function engage() {
  S.state = 'busy';
  $('placement').classList.add('hidden');
  $('enemyPanel').classList.remove('hidden');
  playerGrid.setHover(null);
  renderPanels();
  S.battle = true;
  log(`All 5 ships placed. Battle mode: ${modeName()}.`, 'you');
  announce('ENGAGE', 'sunk');
  audio.sfx('alarm');
  await wait(1.2);
  playerTurn();
}

// ------------------------------------------------------------------ turns
const aliveShips = (b) => b.ships.filter((s) => s.hits.size < s.len);
const shipById = (b, id) => b.ships.find((s) => s.type.id === id);
const hasAbility = (b, a) => { const s = shipById(b, a.ship); return !!s && s.hits.size < s.len; };
const unshot = (b) => ({ r, c }) => !b.shots[r * 10 + c];
const intactAt = (b, r, c) => b.occ[r * 10 + c] >= 0 && b.shots[r * 10 + c] !== 2;
const fleetDead = (b) => b.ships.every((s) => s.hits.size === s.len);
const lineLabel = (line) => (line[0].r === line[1].r ? `row ${ROWS[line[0].r]}` : `column ${line[0].c + 1}`);
const lineName = (line) => lineLabel(line).toUpperCase();
function freeCells(b) { let n = 0; for (const v of b.shots) if (!v) n++; return n; }
function gainEnergy(side, n) { if (S.mode === 'tactical') S.energy[side] = Math.min(ENERGY.max, S.energy[side] + n); }

// How many cells the player picks before firing. 1 means a click fires at once.
function queueSize() {
  if (!S.player || !S.enemy) return 1;
  const want = S.sel.ability === 'rapid' ? 2 : S.mode === 'salvo' && !S.sel.ability ? aliveShips(S.player).length : 1;
  return Math.max(1, Math.min(want, freeCells(S.enemy)));
}
function turnHint() {
  if (S.mode === 'salvo') return `Select ${plural(queueSize(), 'cell')} on the hostile grid, then press FIRE`;
  if (S.mode === 'tactical') return 'Select a cell on the hostile grid to fire, or choose an ability';
  return 'Select a cell on the hostile grid to fire';
}

async function playerTurn() {
  if (S.state === 'over') return;
  S.stats.turns++;
  gainEnergy('player', ENERGY.perTurn);
  S.sel.ability = null; S.sel.queue = [];
  S.abilityUsed = false;
  banner('YOUR TURN', turnHint());
  renderPanels();
  await goView('target', 1.5);
  if (S.state === 'over') return;
  S.state = 'player';
  renderTactical();
}

function resolve(board, r, c) {
  const k = r * 10 + c;
  const si = board.occ[k];
  if (si < 0) { board.shots[k] = 1; return { hit: false }; }
  board.shots[k] = 2;
  const ship = board.ships[si];
  const seg = ship.cells.findIndex((x) => x.r === r && x.c === c);
  ship.hits.add(seg);
  return { hit: true, ship, seg, sunk: ship.hits.size === ship.len };
}

// Resolve every cell of an attack. A lance stops at the first intact section it meets.
function resolveAttack(board, act) {
  const out = [];
  if (act.type === 'lance') {
    for (const p of act.line) {
      if (board.shots[p.r * 10 + p.c]) continue;
      const res = resolve(board, p.r, p.c);
      out.push({ ...p, res });
      if (res.hit) break;
    }
  } else for (const p of act.cells) out.push({ ...p, res: resolve(board, p.r, p.c) });
  return out;
}

// Put the hit or miss marker for a resolved cell on the grid. Safe to call twice.
function markCell(grid, r, c, hit) {
  const contact = grid.markerAt(r, c, 'contact');
  if (contact) grid.disposeMarker(contact);
  if (grid.markerAt(r, c, hit ? 'hit' : 'miss')) return;
  if (hit) { const m = grid.addHit(r, c); if (grid === playerGrid) m.userData.fill.material.opacity = 0.25; }
  else grid.addMiss(r, c);
}
// Sensors showed this hostile cell is empty: mark it so it cannot be targeted.
function clearCell(r, c) {
  const k = r * 10 + c;
  if (S.enemy.shots[k]) return;
  S.enemy.shots[k] = 3;
  enemyGrid.addMiss(r, c, true);
}
// Make sure every resolved cell shows its marker and damage even if a cinematic was cut short.
function settle(results, onPlayer) {
  const grid = onPlayer ? playerGrid : enemyGrid;
  for (const x of results) {
    markCell(grid, x.r, x.c, x.res.hit);
    if (x.res.hit && !x.res.ship.sunk) x.res.ship.damage(x.res.seg, { silent: !onPlayer });
  }
}

function attackLog(who, act, results) {
  const ab = ABILITY[act.type], hits = results.filter((x) => x.res.hit).length;
  const verb = who === 'You' ? 'fire' : 'fires';
  if (act.type === 'lance') {
    const last = results[results.length - 1];
    return `${who} ${verb} ${ab.name} down ${lineLabel(act.line)}: ${last && last.res.hit ? `HIT at ${coord(last.r, last.c)}` : 'no hit'}`;
  }
  if (results.length === 1) {
    const x = results[0];
    const target = x.res.hit ? (who === 'You' ? 'HIT' : `HIT on ${x.res.ship.name}`) : 'miss';
    return `${who} ${verb} ${ab ? ab.name + ' ' : ''}at ${coord(x.r, x.c)}: ${target}`;
  }
  const misses = results.length - hits;
  return `${who} ${verb} ${ab ? ab.name : `a salvo of ${results.length}`}: ${plural(hits, 'hit')}, ${misses} ${misses === 1 ? 'miss' : 'misses'}`;
}

// Void Torpedo hit: show whether each adjacent untargeted cell holds a ship section.
function sensorReveal(r, c, byPlayer) {
  const board = byPlayer ? S.enemy : S.player, grid = byPlayer ? enemyGrid : playerGrid;
  let found = 0;
  for (const p of adjacentCells(r, c)) {
    if (board.shots[p.r * 10 + p.c]) continue;
    const ship = board.occ[p.r * 10 + p.c] >= 0;
    if (ship) found++;
    fx.ring(grid.cellToWorld(p.r, p.c, 0.3), ship ? new THREE.Color(3.5, 2, 0.4) : new THREE.Color(0.6, 2.2, 3.2), 2.6, 0.9, { thick: 0.09 });
    if (byPlayer) {
      if (!ship) clearCell(p.r, p.c);
      else if (!grid.markerAt(p.r, p.c, 'contact')) grid.addContact(p.r, p.c);
    } else if (ship) S.ai.noteContact(p.r, p.c);
    else S.ai.noteClear(p.r, p.c);
  }
  audio.sfx('ping');
  log(byPlayer ? `Torpedo sensors: ${plural(found, 'intact ship section')} next to ${coord(r, c)}.` : `Enemy torpedo sensors: ${found} of your ship sections found next to ${coord(r, c)}.`, byPlayer ? 'you' : '');
}

function scanFx(grid, o, hostile) {
  const p = grid.cellToWorld(o.r + 1, o.c + 1, 0.4);
  const col = hostile ? new THREE.Color(4, 0.7, 0.5) : new THREE.Color(3.2, 2, 0.5);
  fx.ring(p, col, CELL * 2.8, 1.2, { thick: 0.05 });
  fx.ring(p, col, CELL * 1.7, 0.8, { thick: 0.1, opacity: 0.6 });
  fx.sprite(p, col, CELL * 3.2, 0.8, 1.3, 0.3);
}

// Recon Sweep: count intact sections in a 3×3 area. Does not end the turn.
function playerScan(r, c) {
  S.energy.player -= ABILITY.scan.cost;
  S.abilityUsed = true; S.sel.ability = null; S.sel.queue = [];
  const o = areaOrigin(r, c), cells = areaCells(r, c);
  const count = cells.filter((p) => intactAt(S.enemy, p.r, p.c)).length;
  scanFx(enemyGrid, o, false);
  audio.sfx('scan');
  if (count) S.scans.push({ cells, left: count, marker: enemyGrid.addScan(o.r, o.c, count) });
  else for (const p of cells) clearCell(p.r, p.c);
  announce(count ? `${plural(count, 'SECTION')} DETECTED` : 'AREA CLEAR', 'miss');
  log(`Recon Sweep ${coord(o.r, o.c)}–${coord(o.r + 2, o.c + 2)}: ${plural(count, 'intact ship section')} detected.`, 'you');
  banner('YOUR TURN', 'Select a cell on the hostile grid to fire');
  renderPanels();
}
// Keep scan frames current: the count drops as you hit sections inside, and an area with 0 left is cleared.
function updateScans() {
  S.scans = S.scans.filter((s) => {
    const left = s.cells.filter((p) => intactAt(S.enemy, p.r, p.c)).length;
    if (left === 0) for (const p of s.cells) clearCell(p.r, p.c);
    if (left === 0 || !s.cells.some(unshot(S.enemy))) { enemyGrid.disposeMarker(s.marker); return false; }
    if (left !== s.left) { s.left = left; enemyGrid.setScanCount(s.marker, left); }
    return true;
  });
}
async function enemyScan(cell) {
  S.energy.enemy -= ABILITY.scan.cost;
  const o = areaOrigin(cell.r, cell.c), cells = areaCells(cell.r, cell.c);
  const count = cells.filter((p) => intactAt(S.player, p.r, p.c)).length;
  S.ai.noteScan(cells, count);
  scanFx(playerGrid, o, true);
  audio.sfx('scan');
  playerGrid.setTiles('scan', cells, new THREE.Color(2.4, 0.3, 0.25));
  announce('ENEMY RECON SWEEP', 'lost');
  log(`Enemy Recon Sweep ${coord(o.r, o.c)}–${coord(o.r + 2, o.c + 2)}: ${count} of your intact ship sections detected.`);
  renderPanels();
  await wait(1.8);
  playerGrid.setTiles('scan', null);
}

function hideTargeting() {
  reticle.visible = false;
  enemyGrid.setHover(null); enemyGrid.setTiles('pattern', null); enemyGrid.setTiles('queue', null);
  $('cursorTag').style.display = 'none';
}

// A click on a hostile cell during the player's turn.
function targetClick({ r, c }) {
  const ab = S.sel.ability, k = r * 10 + c, open = unshot(S.enemy);
  if (ab === 'scan') { playerScan(r, c); return; }
  if (ab === 'barrage') {
    const cells = plusCells(r, c).filter(open);
    if (!cells.length) { audio.sfx('error'); return; }
    playerAttack({ type: 'barrage', cells, cell: { r, c } }); return;
  }
  if (ab === 'lance') {
    const line = lineCells(r, c, S.sel.dir);
    if (!line.some(open)) { audio.sfx('error'); return; }
    playerAttack({ type: 'lance', line }); return;
  }
  const need = queueSize();
  if (need > 1) {
    const q = S.sel.queue, i = q.findIndex((p) => p.r === r && p.c === c);
    if (i >= 0) { q.splice(i, 1); audio.sfx('rotate'); }
    else if (S.enemy.shots[k] || q.length >= need) { audio.sfx('error'); return; }
    else { q.push({ r, c }); audio.sfx('lock'); }
    renderTactical();
    return;
  }
  if (S.enemy.shots[k]) { audio.sfx('error'); return; }
  playerAttack({ type: ab === 'torpedo' ? 'torpedo' : 'shot', cells: [{ r, c }] });
}
function fireQueue() {
  if (S.state !== 'player' || S.cine) return;
  const need = queueSize();
  if (need < 2 || S.sel.queue.length !== need) { if (need > 1) audio.sfx('error'); return; }
  audio.sfx('click');
  playerAttack({ type: S.sel.ability === 'rapid' ? 'rapid' : 'salvo', cells: S.sel.queue.slice() });
}
function selectAbility(id) {
  if (S.state !== 'player' || S.mode !== 'tactical' || S.cine) return;
  const a = ABILITY[id];
  if (S.sel.ability === id) { S.sel.ability = null; audio.sfx('click'); }
  else if (!hasAbility(S.player, a) || S.abilityUsed || S.energy.player < a.cost) { audio.sfx('error'); S.helpAb = id; renderTactical(); return; }
  else { S.sel.ability = id; audio.sfx('select'); if (S.view !== 'target') goView('target', 1); }
  S.sel.queue = [];
  renderTactical();
}
function cancelAbility() {
  if (S.state !== 'player' || (!S.sel.ability && !S.sel.queue.length)) return;
  S.sel.ability = null; S.sel.queue = [];
  audio.sfx('click');
  renderTactical();
}
function rotateLance() { S.sel.dir = (S.sel.dir + 1) % DIRS.length; audio.sfx('rotate'); }

// Why an ability cannot be used right now ('' when it can).
function abilityBlock(a) {
  if (!hasAbility(S.player, a)) return `${SHIP_TYPES.find((t) => t.id === a.ship).name} destroyed.`;
  if (S.abilityUsed) return 'You already used an ability this turn.';
  if (S.energy.player < a.cost) return `Needs ${a.cost} Energy. You have ${S.energy.player}.`;
  return '';
}
function renderTactical() {
  const el = $('tactical');
  const show = S.battle && S.mode !== 'classic' && !!S.player && S.state !== 'over';
  el.classList.toggle('hidden', !show);
  if (!show) return;
  const mine = S.state === 'player', tac = S.mode === 'tactical';
  const need = queueSize(), q = S.sel.queue.length;
  $('energy').classList.toggle('hidden', !tac);
  $('abilities').classList.toggle('hidden', !tac);
  if (tac) {
    const e = S.energy.player;
    $('energy').innerHTML = `<span>ENERGY</span><div class="epips">${Array.from({ length: ENERGY.max }, (_, i) => `<i class="${i < e ? 'on' : ''}"></i>`).join('')}</div><b>${e}/${ENERGY.max}</b>`;
    $('abilities').innerHTML = ABILITIES.map((a, i) => {
      const lost = !hasAbility(S.player, a), off = !mine || !!abilityBlock(a);
      const ship = SHIP_TYPES.find((t) => t.id === a.ship).name.toUpperCase();
      return `<button class="abtn${S.sel.ability === a.id ? ' on' : ''}${off ? ' off' : ''}${lost ? ' lost' : ''}" data-ab="${a.id}"><i>${i + 1}</i><span class="an">${a.name.toUpperCase()}</span><span class="as">${ship}${lost ? ' DESTROYED' : ''}</span><b>${a.cost}</b></button>`;
    }).join('');
  }
  const fire = $('btnFire');
  fire.classList.toggle('hidden', !(mine && need > 1));
  fire.disabled = q !== need;
  fire.textContent = `FIRE ${q}/${need}`;
  $('btnLanceRotate').classList.toggle('hidden', !(mine && S.sel.ability === 'lance'));
  renderTacHelp();
}
// One line of help: the hovered or selected ability, else the rule for this mode.
function renderTacHelp() {
  const mine = S.state === 'player', tac = S.mode === 'tactical', need = queueSize();
  const a = ABILITY[S.helpAb] || ABILITY[S.sel.ability];
  let help;
  if (a) {
    const block = S.sel.ability === a.id ? '' : mine ? abilityBlock(a) : '';
    help = `<b>${a.name.toUpperCase()}</b> · ${a.cost} Energy · ${a.desc}${a.id === 'rapid' ? ' Press FIRE or Enter when both are selected.' : ''}${a.id === 'lance' ? ' Press R to change direction.' : ''}${block ? ` <em>${block}</em>` : ''}`;
  } else if (!mine) help = 'Enemy turn.';
  else if (tac) help = `+${ENERGY.perTurn} Energy at the start of your turn, +${ENERGY.perHit} for each hit. 1 ability per turn. Keys 1–5 select an ability, Esc cancels.`;
  else help = `Select ${plural(need, 'cell')}, then press FIRE or Enter. Click a selected cell to remove it.`;
  $('tacHelp').innerHTML = help;
}

async function finishSinks(results, enemyShips) {
  for (const x of results) {
    if (!x.res.sunk) continue;
    const ship = x.res.ship;
    await sinkCinematic(ship, enemyShips).catch(cineFailed);
    if (enemyShips) {
      for (const cell of ship.cells) { const m = enemyGrid.markerAt(cell.r, cell.c, 'hit'); if (m) m.userData.fill.material.color.setRGB(1.2, 0.4, 0.05); }
      log(`Enemy ${ship.type.name} "${ship.name}" destroyed.`, 'sunk');
    } else {
      const ab = S.mode === 'tactical' ? ABILITIES.find((a) => a.ship === ship.type.id) : null;
      log(`${ship.name} destroyed.${ab ? ` ${ab.name} is no longer available.` : ''}`, 'sunk');
    }
    renderPanels();
  }
}

async function playerAttack(act) {
  if (S.state !== 'player') return;
  S.state = 'busy';
  hideTargeting();
  const ab = ABILITY[act.type];
  if (ab) { S.energy.player -= ab.cost; S.abilityUsed = true; }
  S.sel.ability = null; S.sel.queue = []; S.helpAb = null;
  renderTactical();
  const results = resolveAttack(S.enemy, act);
  const hits = results.filter((x) => x.res.hit).length;
  // a lance is one slug: it counts as one shot however many cells it crosses
  S.stats.shots += act.type === 'lance' ? 1 : results.length;
  S.stats.hits += hits;
  gainEnergy('player', hits * ENERGY.perHit);
  if (results.length === 1 && act.type !== 'lance') {
    const x = results[0];
    await firingCinematic(x.r, x.c, x.res, ab ? { shooter: shipById(S.player, ab.ship), label: ab.name.toUpperCase() } : {}).catch(cineFailed);
  } else await volleyCinematic(act, results).catch(cineFailed);
  settle(results, false);
  log(attackLog('You', act, results), hits ? 'hit' : 'you');
  if (act.type === 'torpedo' && results[0].res.hit) sensorReveal(results[0].r, results[0].c, true);
  updateScans();
  renderPanels();
  await finishSinks(results, true);
  if (fleetDead(S.enemy)) return gameOver(true);
  enemyTurn();
}

async function enemyTurn() {
  if (S.state === 'over') return;
  banner('ENEMY TURN', 'Hostile fleet is targeting your vessels', true);
  gainEnergy('enemy', ENERGY.perTurn);
  renderPanels();
  await goView('fleet', 1.3);
  audio.sfx('alarm');
  await wait(0.5 + rand(0, 0.5));
  if (S.state === 'over') return;
  let act = S.ai.plan({ mode: S.mode, energy: S.energy.enemy, abilities: ABILITIES.filter((a) => hasAbility(S.enemy, a)).map((a) => a.id), shots: aliveShips(S.enemy).length });
  if (act.type === 'scan') { await enemyScan(act.cell); act = { type: 'shot', cells: [S.ai.choose()] }; }
  const ab = ABILITY[act.type];
  if (ab) S.energy.enemy -= ab.cost;
  if (act.type === 'barrage') act.cells = plusCells(act.cell.r, act.cell.c).filter(unshot(S.player));
  const results = resolveAttack(S.player, act);
  for (const x of results) S.ai.record(x.r, x.c, x.res.sunk ? 'sunk' : x.res.hit ? 'hit' : 'miss', x.res.sunk ? x.res.ship.cells : null, x.res.sunk ? x.res.ship.len : 0);
  const hits = results.filter((x) => x.res.hit).length;
  S.stats.enemyShots += act.type === 'lance' ? 1 : results.length;
  S.stats.enemyHits += hits;
  gainEnergy('enemy', hits * ENERGY.perHit);
  if (results.length === 1 && act.type !== 'lance') {
    const x = results[0];
    await incomingCinematic(x.r, x.c, x.res, ab ? ab.name.toUpperCase() : '').catch(cineFailed);
  } else await incomingVolley(act, results).catch(cineFailed);
  settle(results, true);
  log(attackLog('Enemy', act, results), hits ? 'hit' : '');
  if (act.type === 'torpedo' && results[0].res.hit) sensorReveal(results[0].r, results[0].c, false);
  renderPanels();
  await finishSinks(results, false);
  if (fleetDead(S.player)) return gameOver(false);
  playerTurn();
}

// ------------------------------------------------------------------ cinematics
// A cinematic must never soft-lock the game: log, restore the camera/HUD, and carry on with the turn.
function cineFailed(err) {
  console.error('Cinematic failed:', err);
  S.slowmo = 1;
  camFollow(null);
  setCine(false);
}

const WEAPON = {
  laser: { n: 6, gap: 0.09, dur: 1.05, s: 0.8, color: 0x55ff77 },
  plasma: { n: 6, gap: 0.13, dur: 1.35, s: 1.1, color: 0xff8a2a },
  railgun: { n: 1, gap: 0, dur: 0.42, s: 1.5, color: 0x88bbff, charge: 1.0 },
  torpedo: { n: 2, gap: 0.4, dur: 1.9, s: 1.2, color: 0xd050ff },
  missile: { n: 8, gap: 0.08, dur: 2.1, s: 0.6, color: 0xffaa55 },
  hostile: { n: 4, gap: 0.16, dur: 1.5, s: 1, color: 0xff3322 },
};

function salvo(kind, muzzles, target, { onImpact, onFirst, n, ctrl: path }) {
  const W = WEAPON[kind], count = n || W.n;
  let arrived = 0, resolveAll;
  const all = new Promise((r) => (resolveAll = r));
  (async () => {
    if (W.charge) {
      const m = muzzles[0];
      audio.sfx('railcharge');
      const glow = fx.sprite(m.obj.getWorldPosition(V()), new THREE.Color(1, 2, 4.5), 0.5, W.charge, 5, 1);
      await tween(W.charge, () => {
        const p = m.obj.getWorldPosition(V());
        glow.position.copy(p);
        const off = V().randomDirection().multiplyScalar(rand(1.5, 3));
        fx.add.spawn(p.clone().add(off), off.multiplyScalar(-2.5), 0.4, 0.25, 0.05, new THREE.Color(1.5, 3, 8), new THREE.Color(0.5, 1, 4), 1, 0);
      }, ease.linear);
    }
    for (let i = 0; i < count; i++) {
      const m = muzzles[i % muzzles.length];
      const from = m.obj ? m.obj.getWorldPosition(V()) : m.pos.clone();
      const dir = m.obj ? V(1, 0, 0).transformDirection(m.obj.matrixWorld) : m.dir.clone();
      if (kind === 'missile') dir.set(rand(-0.2, 0.2), 1, rand(-0.2, 0.2)).normalize();
      fx.muzzle(from, dir, W.color, W.s);
      audio.sfx(kind === 'hostile' ? 'plasma' : kind);
      rig.shake(0.18 * W.s);
      if (kind === 'railgun') { fx.ring(from, new THREE.Color(0.7, 1.4, 3), 3, 0.5, { normal: dir, thick: 0.06 }); fx.ring(from.clone().addScaledVector(dir, 2), new THREE.Color(0.4, 0.9, 2), 2.2, 0.6, { normal: dir, thick: 0.05 }); fx.streak(from, new THREE.Color(0.8, 1.4, 3), 30, 0.5, 0.8); rig.shake(1.2); }
      const end = target.clone().add(i === 0 ? V() : V(rand(-0.9, 0.9), rand(-0.3, 0.5), rand(-0.9, 0.9)));
      const dist = from.distanceTo(end);
      const ctrl = path ? path.clone() : from.clone().addScaledVector(dir, dist * (kind === 'missile' ? 0.45 : kind === 'hostile' ? 0.2 : 0.3)).lerp(end, kind === 'railgun' ? 0.5 : 0.05);
      if (kind === 'torpedo') ctrl.add(V(rand(-6, 6), rand(0, 3), 0));
      if (kind === 'missile') ctrl.add(V(rand(-5, 5), 0, rand(-5, 5)));
      const p = fx.fire(kind, from, end, W.dur * rand(0.94, 1.06), {
        ctrl,
        onArrive: (pt) => { onImpact(pt, i); if (++arrived === count) resolveAll(); },
      });
      if (i === 0 && onFirst) onFirst(p);
      if (W.gap) await wait(W.gap);
    }
  })();
  return { all, W };
}

function chooseShooter() {
  const alive = S.player.ships.filter((s) => s.hits.size < s.len);
  const armed = alive.filter((s) => s.guns.some((g) => !g.disabled));
  return pick(armed.length ? armed : alive);
}

// Opening shot of a firing cinematic: swing from a side profile of the ship to a view down its barrels.
function shooterDolly(shooter, toT, side) {
  const center = shooter.root.getWorldPosition(V()), len = shooter.len * CELL;
  const p0 = center.clone().addScaledVector(side, len * 0.5 + 5).addScaledVector(UP, 1.0).addScaledVector(toT, len * 0.25);
  const p1 = center.clone().addScaledVector(toT, -(len * 0.45 + 5)).addScaledVector(side, len * 0.3 + 2.5).addScaledVector(UP, 2.4);
  const l0 = center.clone(), l1 = center.clone().addScaledVector(toT, 13).addScaledVector(UP, 0.5);
  camTween(2.4, (k) => {
    const a = V().lerpVectors(p0, p1, k);
    a.addScaledVector(side, Math.sin(k * Math.PI) * len * 0.25);
    rig.pos.copy(a); rig.look.lerpVectors(l0, l1, k); rig.fov = lerp(42, 38, k);
  }, ease.inOutSine);
}

async function firingCinematic(r, c, res, { shooter = chooseShooter(), label = '' } = {}) {
  setCine(true);
  const target = enemyGrid.cellToWorld(r, c, HOVER);
  shooter.aimAt(target);
  const kind = shooter.type.weapon;
  const center = shooter.root.getWorldPosition(V());
  const toT = target.clone().sub(center).setY(0).normalize();
  const side = V().crossVectors(toT, UP).normalize().multiplyScalar(Math.random() < 0.5 ? 1 : -1);
  caption(`${shooter.type.cls} · ${label || shooter.type.weaponName}`, `${shooter.name.toUpperCase()} — FIRING ON ${coord(r, c)}`);
  audio.sfx('whoosh');

  // Shot 1 — low dramatic dolly alongside the firing ship
  await wait(0.05);
  const muzzles = shooter.muzzles();
  shooterDolly(shooter, toT, side);
  await wait(1.45);

  // Fire!
  let lead = null, cut = false, firstImpact = true;
  const impactCam = target.clone().addScaledVector(toT, -17).addScaledVector(side, 10).addScaledVector(UP, 5);
  const doCut = () => {
    if (cut) return; cut = true;
    const lk = target.clone().addScaledVector(UP, 0.5);
    const end = target.clone().addScaledVector(toT, -13).addScaledVector(side, 7.5).addScaledVector(UP, 3.8);
    rig.set(impactCam, lk, 42);
    camTween(3, (k) => { rig.pos.lerpVectors(impactCam, end, k); rig.look.copy(lk); rig.fov = 42; }, ease.out);
  };
  const { all, W } = salvo(kind, muzzles, target, {
    onFirst: (p) => { lead = p; },
    onImpact: (pt, i) => {
      doCut();
      if (res.hit) {
        fx.explosion(pt, firstImpact ? 1.25 : 0.5, { noDebris: !firstImpact });
        audio.sfx('explosion', { size: firstImpact ? 1.2 : 0.5 });
        rig.shake(firstImpact ? 1.6 : 0.5);
        if (firstImpact) {
          flashScreen(0.18, 0.4);
          markCell(enemyGrid, r, c, true);
          res.ship.damage(res.seg, { silent: true });
          announce('DIRECT HIT', 'hit');
        }
      } else {
        fx.ripple(pt, firstImpact ? 1 : 0.45);
        if (firstImpact) { audio.sfx('ripple'); markCell(enemyGrid, r, c, false); announce('MISS', 'miss'); }
      }
      firstImpact = false;
    },
  });

  // Shot 2 — chase camera riding behind the lead projectile
  if (W.dur > 0.9) {
    await wait((W.charge || 0) + 0.3);
    if (lead && lead.alive) {
      const smooth = rig.pos.clone();
      camFollow((dt) => {
        if (!lead.alive || cut) return;
        const d = lead.pos.clone().sub(lead.prev); if (d.lengthSq() < 1e-6) return;
        d.normalize();
        const want = lead.pos.clone().addScaledVector(d, -9).addScaledVector(UP, 2.4).addScaledVector(side, 2.4);
        smooth.lerp(want, 1 - Math.exp(-dt * 10));
        rig.pos.copy(smooth); rig.look.copy(lead.pos).addScaledVector(d, 6); rig.fov = 55;
      });
      audio.sfx('whoosh');
      await new Promise((res2) => { const chk = () => (!lead.alive || lead.t > 0.62 ? res2() : setTimeout(chk, 16)); chk(); });
      doCut();
    }
  }
  await all;
  await wait(res.hit ? 1.6 : 1.3);
  shooter.resetAim();
  if (!res.sunk) { setCine(false); }
}

async function incomingCinematic(r, c, res, label = '') {
  setCine(true);
  const target = playerGrid.cellToWorld(r, c, HOVER);
  caption(`WARNING · HOSTILE ${label || 'ORDNANCE'} INBOUND`, `IMPACT PROJECTED AT ${coord(r, c)}`, true);
  audio.sfx('incoming');
  // Camera near the target, looking back toward the incoming fire
  const side = Math.random() < 0.5 ? 1 : -1;
  const cam0 = target.clone().add(V(side * 13, 6, 12)), cam1 = target.clone().add(V(side * 9, 3.8, 8.5));
  const look = target.clone().add(V(-side * 2, 1.5, -8));
  rig.set(cam0, look, 48);
  camTween(3.5, (k) => { rig.pos.lerpVectors(cam0, cam1, k); rig.look.lerpVectors(look, target, Math.min(1, k * 1.3)); }, ease.inOutSine);
  await wait(0.4);
  const origin = { pos: V(rand(-25, 25), rand(18, 30), -95), dir: V(0, -0.1, 1).normalize() };
  let first = true;
  const { all } = salvo('hostile', [origin], target, {
    onImpact: (pt) => {
      if (res.hit) {
        fx.explosion(pt, first ? 1.2 : 0.5, { noDebris: false });
        audio.sfx('explosion', { size: first ? 1.1 : 0.5 });
        rig.shake(first ? 1.8 : 0.6);
        if (first) {
          flashScreen(0.15, 0.4);
          fx.shield(res.ship, pt);
          res.ship.damage(res.seg);
          markCell(playerGrid, r, c, true);
          announce('HULL BREACH', 'lost');
        }
      } else {
        fx.ripple(pt, first ? 1 : 0.45);
        if (first) { audio.sfx('ripple'); markCell(playerGrid, r, c, false); announce('ENEMY MISSED', 'miss'); }
      }
      first = false;
    },
  });
  await all;
  await wait(res.hit ? 1.5 : 1.1);
  if (!res.sunk) setCine(false);
}

// ---- multi-cell attacks (Salvo mode and Tactical abilities)
const VOLLEY_N = { laser: 3, plasma: 2, railgun: 1, torpedo: 1, missile: 3 };
const centroid = (pts) => pts.reduce((a, p) => a.add(p), V()).multiplyScalar(1 / pts.length);

// Effects for one resolved cell. `lead` is the first round to land on it; later rounds are lighter.
function impactFx(x, pt, lead, onPlayer) {
  const res = x.res;
  if (res.hit) {
    fx.explosion(pt, lead ? 1.15 : 0.5, { noDebris: !lead });
    audio.sfx('explosion', { size: lead ? 1.0 : 0.5 });
    rig.shake(lead ? 1.5 : 0.5);
    if (!lead) return;
    flashScreen(0.14, 0.4);
    if (onPlayer) { fx.shield(res.ship, pt); res.ship.damage(res.seg); }
    else res.ship.damage(res.seg, { silent: true });
    markCell(onPlayer ? playerGrid : enemyGrid, x.r, x.c, true);
  } else {
    fx.ripple(pt, lead ? 1 : 0.45);
    if (lead) { audio.sfx('ripple'); markCell(onPlayer ? playerGrid : enemyGrid, x.r, x.c, false); }
  }
}

// Railgun Lance: the cells the slug crossed resolve one after another along the line.
async function lanceWake(results, grid, onPlayer) {
  for (const x of results) {
    const pt = grid.cellToWorld(x.r, x.c, HOVER);
    if (x.res.hit) impactFx(x, pt, true, onPlayer);
    else { fx.ripple(pt, 0.6); audio.sfx('lock'); markCell(grid, x.r, x.c, false); }
    await wait(0.07);
  }
}

function volleyVerdict(results, onPlayer) {
  const hits = results.filter((x) => x.res.hit).length;
  if (onPlayer) announce(hits ? `${hits} HULL ${hits === 1 ? 'BREACH' : 'BREACHES'}` : 'ENEMY MISSED', hits ? 'lost' : 'miss');
  else announce(hits ? plural(hits, 'HIT') : 'NO HITS', hits ? 'hit' : 'miss');
  return hits;
}

async function volleyCinematic(act, results) {
  setCine(true);
  const ab = ABILITY[act.type];
  const pts = results.map((x) => enemyGrid.cellToWorld(x.r, x.c, HOVER));
  const C = centroid(pts), R = Math.max(...pts.map((p) => p.distanceTo(C)));
  const fleet = aliveShips(S.player);
  const one = ab ? shipById(S.player, ab.ship) : null; // abilities are fired by one ship, a salvo by the whole fleet
  const shooters = results.map((_, j) => one || fleet[j % fleet.length]);
  shooters.forEach((s, j) => s.aimAt(one ? C : pts[j]));
  const base = one ? one.root.getWorldPosition(V()) : playerGrid.center.clone();
  const toT = C.clone().sub(base).setY(0).normalize();
  const side = V().crossVectors(toT, UP).normalize().multiplyScalar(Math.random() < 0.5 ? 1 : -1);
  if (act.type === 'lance') caption(`${one.type.cls} · ${ab.name.toUpperCase()}`, `${one.name.toUpperCase()} — FIRING DOWN ${lineName(act.line)}`);
  else if (one) caption(`${one.type.cls} · ${ab.name.toUpperCase()}`, `${one.name.toUpperCase()} — FIRING ON ${results.length === 2 ? `${coord(results[0].r, results[0].c)} AND ${coord(results[1].r, results[1].c)}` : plural(results.length, 'CELL')}`);
  else caption('FLEET SALVO', `${plural(fleet.length, 'SHIP')} FIRING ON ${plural(results.length, 'CELL')}`);
  audio.sfx('whoosh');
  await wait(0.05);
  if (one) shooterDolly(one, toT, side);
  else {
    // wide shot from behind the fleet, looking toward the hostile grid
    const p0 = base.clone().addScaledVector(toT, -40).addScaledVector(side, 26).addScaledVector(UP, 17);
    const p1 = base.clone().addScaledVector(toT, -30).addScaledVector(side, 20).addScaledVector(UP, 13);
    const lk = base.clone().addScaledVector(toT, 12).addScaledVector(UP, 1);
    camTween(3.2, (k) => { rig.pos.lerpVectors(p0, p1, k); rig.look.copy(lk); rig.fov = 50; }, ease.inOutSine);
  }
  await wait(one ? 1.45 : 1.1);

  // cut to the target area: far enough back to frame every cell being hit
  let cut = false;
  const doCut = () => {
    if (cut) return; cut = true;
    const d = 13 + R * 1.25, lk = C.clone().addScaledVector(UP, 0.5);
    const from = C.clone().addScaledVector(toT, -d - 4).addScaledVector(side, 8 + R * 0.5).addScaledVector(UP, 5 + R * 0.75);
    const to = C.clone().addScaledVector(toT, -d).addScaledVector(side, 6 + R * 0.4).addScaledVector(UP, 4 + R * 0.65);
    rig.set(from, lk, 44);
    camTween(4, (k) => { rig.pos.lerpVectors(from, to, k); rig.look.copy(lk); rig.fov = 44; }, ease.out);
  };

  if (act.type === 'lance') {
    // the slug swings in from the edge of the grid and finishes its flight along the row or column
    const line = act.line, a = enemyGrid.cellToWorld(line[0].r, line[0].c, HOVER), b = enemyGrid.cellToWorld(line[1].r, line[1].c, HOVER);
    const dir = b.sub(a).normalize(), last = results[results.length - 1];
    const end = last.res.hit ? pts[pts.length - 1] : enemyGrid.cellToWorld(line[9].r, line[9].c, HOVER).addScaledVector(dir, CELL);
    let wake = null;
    await salvo('railgun', one.muzzles(), end, {
      ctrl: a.clone().addScaledVector(dir, -14).setY(HOVER + 2.5),
      onImpact: () => { doCut(); wake = lanceWake(results, enemyGrid, false); },
    }).all;
    await wake;
  } else {
    const gap = one ? 0.22 : 0.45;
    const tasks = results.map((x, j) => (async () => {
      await wait(j * gap);
      const s = shooters[j], kind = s.type.weapon;
      let lead = true;
      await salvo(kind, s.muzzles(), pts[j], { n: VOLLEY_N[kind], onImpact: (pt) => { doCut(); impactFx(x, pt, lead, false); lead = false; } }).all;
    })());
    const W = WEAPON[shooters[0].type.weapon];
    await wait((W.charge || 0) + W.dur * 0.55);
    doCut();
    await Promise.all(tasks);
  }
  const hits = volleyVerdict(results, false);
  await wait(hits ? 1.7 : 1.3);
  for (const s of new Set(shooters)) s.resetAim();
  if (!results.some((x) => x.res.sunk)) setCine(false);
}

async function incomingVolley(act, results) {
  setCine(true);
  const ab = ABILITY[act.type];
  const pts = results.map((x) => playerGrid.cellToWorld(x.r, x.c, HOVER));
  const C = centroid(pts), R = Math.max(...pts.map((p) => p.distanceTo(C)));
  caption(`WARNING · HOSTILE ${ab ? ab.name.toUpperCase() : 'SALVO'} INBOUND`, act.type === 'lance' ? `IMPACTS PROJECTED DOWN ${lineName(act.line)}` : `${plural(results.length, 'IMPACT')} PROJECTED`, true);
  audio.sfx('incoming');
  // camera beside the target area, looking back toward the incoming fire
  const side = Math.random() < 0.5 ? 1 : -1, d = 11 + R * 1.15;
  const cam0 = C.clone().add(V(side * (d + 3), 6 + R * 0.6, d + 2)), cam1 = C.clone().add(V(side * d * 0.8, 4.2 + R * 0.5, d * 0.8));
  const look = C.clone().add(V(-side * 2, 1.5, -8));
  rig.set(cam0, look, 48);
  camTween(4, (k) => { rig.pos.lerpVectors(cam0, cam1, k); rig.look.lerpVectors(look, C, Math.min(1, k * 1.3)); }, ease.inOutSine);
  await wait(0.4);
  const origin = { pos: V(rand(-25, 25), rand(18, 30), -95), dir: V(0, -0.1, 1).normalize() };
  if (act.type === 'lance') {
    let wake = null;
    await salvo('hostile', [origin], pts[pts.length - 1], { n: 1, onImpact: () => { wake = lanceWake(results, playerGrid, true); } }).all;
    await wake;
  } else {
    await Promise.all(results.map((x, j) => (async () => {
      await wait(j * 0.3);
      let lead = true;
      await salvo('hostile', [origin], pts[j], { n: 2, onImpact: (pt) => { impactFx(x, pt, lead, true); lead = false; } }).all;
    })()));
  }
  const hits = volleyVerdict(results, true);
  await wait(hits ? 1.6 : 1.2);
  if (!results.some((x) => x.res.sunk)) setCine(false);
}

async function sinkCinematic(ship, isEnemy) {
  setCine(true);
  const center = ship.root.getWorldPosition(V());
  const fwd = V(1, 0, 0).applyQuaternion(ship.root.quaternion).setY(0).normalize();
  const side = V().crossVectors(fwd, UP).normalize();
  const len = ship.len * CELL;
  const dist = len * 0.62 + 6.5;
  const a0 = rand(0, Math.PI * 2);
  caption(isEnemy ? 'TARGET NEUTRALISED' : 'CRITICAL DAMAGE · ABANDON SHIP', `${ship.name.toUpperCase()} · ${ship.type.cls}`, !isEnemy);
  let orbit = 0, zoom = 1;
  camFollow((dt) => {
    orbit += dt * 0.12;
    const a = a0 + orbit;
    const off = fwd.clone().multiplyScalar(Math.cos(a) * dist * zoom).addScaledVector(side, Math.sin(a) * dist * zoom);
    rig.pos.copy(center).add(off).addScaledVector(UP, (2.6 + len * 0.18) * zoom);
    rig.look.copy(center).addScaledVector(UP, 0.3);
  });
  rig.fov = 45;
  // dim this ship's hit markers so the wreck reads clearly
  const grid = isEnemy ? enemyGrid : playerGrid;
  for (const m of grid.markers.children) if (m.userData.kind === 'hit' && ship.cells.some((cl) => grid.cellToWorld(cl.r, cl.c).sub(grid.center).distanceTo(m.position) < 1)) { m.userData.dim = true; m.traverse((o) => { if (o.material) o.material.opacity *= 0.25; }); }
  await wait(0.6);
  if (isEnemy) {
    // decloak
    ship.root.visible = true;
    ship.setOpacity(0);
    audio.sfx('decloak');
    fx.ring(center.clone().setY(0.3), new THREE.Color(4, 0.8, 0.5), len * 0.8, 1.2, { thick: 0.04 });
    for (let i = 0; i < ship.len; i++) fx.sprite(ship.segWorld(i), new THREE.Color(3, 0.6, 0.4), 5, 1.2, 1.2, 0.6);
    await tween(1.3, (k) => ship.setOpacity(k));
    ship.setOpacity(1);
    await wait(0.9);
  } else await wait(0.6);

  // chain of internal detonations
  const order = [...Array(ship.len).keys()].sort(() => Math.random() - 0.5);
  for (const i of order) {
    const p = ship.segWorld(i).add(V(rand(-0.8, 0.8), rand(0, 0.8), rand(-0.8, 0.8)));
    fx.explosion(p, 0.65, { noDebris: true });
    audio.sfx('explosion', { size: 0.6 });
    rig.shake(0.7);
    await wait(rand(0.22, 0.4));
  }
  await wait(0.35);
  // reactor breach
  // pull back just before the reactor goes so the blast fills, not swallows, the frame
  await tween(0.45, (k) => { zoom = 1 + 0.6 * k; }, ease.inOut);
  S.slowmo = 0.3;
  tween(0.9, (k) => { zoom = 1.6 + 0.7 * k; }, ease.out);
  fx.flash(center, 0xffffff, 500, 1.5, 120);
  flashScreen(0.22, 0.7);
  fx.explosion(center, 0.9 + ship.len * 0.15);
  for (let i = 0; i < ship.len; i++) fx.explosion(ship.segWorld(i), 0.45, { noSmoke: true, noDebris: true });
  fx.streak(center, new THREE.Color(1.4, 1.6, 2.4), len * 6, 1.4, 0.7);
  fx.debris(center, 26, 16, 0.4);
  fx.ring(center, new THREE.Color(4, 3, 2), len * 2.5, 2.2, { thick: 0.03 });
  fx.ring(center, new THREE.Color(2, 3, 5), len * 3.2, 2.8, { thick: 0.015, normal: V(0.2, 1, 0.1) });
  fx.sprite(center, new THREE.Color(2.2, 1.8, 1.4), len * 0.8, 0.7, 1.8);
  audio.sfx('sink');
  rig.shake(3);
  ship.breakApart();
  announce(isEnemy ? `${ship.type.name.toUpperCase()} DESTROYED` : `${ship.type.name.toUpperCase()} LOST`, isEnemy ? 'sunk' : 'lost');
  await wait(0.5);
  S.slowmo = 1;
  audio.sfx('rumble', { delay: 0.3 });
  await wait(3.0);
  camFollow(null);
  setCine(false);
}

// ------------------------------------------------------------------ game over
async function gameOver(win) {
  S.state = 'over';
  S.battle = false;
  hideTargeting();
  renderTactical();
  audio.stinger(win);
  banner(win ? 'VICTORY' : 'DEFEAT', win ? 'The hostile fleet has been annihilated' : 'Your fleet has been destroyed', !win);
  if (!win) {
    // reveal the surviving hostile vessels
    for (const s of S.enemy.ships) if (s.hits.size < s.len) { s.root.visible = true; s.setOpacity(0.55); }
    await goView('target', 2);
  } else await goView('target', 2);
  const st = S.stats;
  const pct = (h, n) => (n ? Math.round((h / n) * 100) : 0);
  const accuracy = pct(st.hits, st.shots);
  const score = battleScore({
    win, accuracy, turns: st.turns, difficulty: S.difficulty,
    intact: S.player.ships.reduce((a, s) => a + s.len - s.hits.size, 0),
    enemyHit: S.enemy.ships.reduce((a, s) => a + s.hits.size, 0),
  });
  const rec = recordBattle({ mode: S.mode, difficulty: S.difficulty, win, score, shots: st.shots });
  $('goKicker').textContent = `${win ? 'ALL 5 ENEMY SHIPS DESTROYED' : 'ALL 5 OF YOUR SHIPS DESTROYED'} · ${modeName()} · ${S.difficulty.toUpperCase()}`;
  $('goTitle').textContent = win ? 'VICTORY' : 'DEFEAT';
  $('goTitle').className = 'go-title ' + (win ? 'win' : 'lose');
  $('goStats').innerHTML = `<div>TURNS<b>${st.turns}</b></div><div>SHOTS FIRED<b>${st.shots}</b></div><div>ACCURACY<b>${accuracy}%</b></div><div>ENEMY ACCURACY<b>${pct(st.enemyHits, st.enemyShots)}%</b></div><div>SHIPS REMAINING<b>${aliveShips(S.player).length}</b></div><div>SCORE<b class="score">${score.toLocaleString()}</b></div>`;
  const notes = [];
  if (rec.newBest) notes.push('<b>NEW BEST SCORE</b>');
  else notes.push(`BEST SCORE ${rec.entry.bestScore.toLocaleString()}`);
  if (win && rec.entry.streak > 1) notes.push(`WIN STREAK ${rec.entry.streak}`);
  notes.push(rec.promoted ? `<b>PROMOTED TO ${rec.promoted.name.toUpperCase()}</b>` : `RANK ${rec.rank.name.toUpperCase()}`);
  $('goRecord').innerHTML = notes.join(' · ');
  $('gameover').classList.add('show');
}
$('btnAgain').onclick = () => { audio.sfx('click'); $('gameover').classList.remove('show'); startGame(); };
$('btnMenu').onclick = () => { audio.sfx('click'); cleanupGame(); showMenu(); };
$('btnExit').onclick = () => {
  if (S.cine || !['placing', 'player', 'over'].includes(S.state)) return;
  audio.sfx('click');
  if (S.state === 'over' || confirm('Abandon this engagement and return to the main menu?')) { S.state = 'menu'; cleanupGame(); showMenu(); }
};
$('btnMute').onclick = () => { const m = audio.toggleMute(); $('btnMute').classList.toggle('off', m); };
$('btnView').onclick = () => toggleView();
$('btnFire').onclick = () => fireQueue();
$('btnLanceRotate').onclick = () => { if (S.state === 'player' && S.sel.ability === 'lance') rotateLance(); };
$('abilities').addEventListener('click', (e) => { const b = e.target.closest('[data-ab]'); if (b) selectAbility(b.dataset.ab); });
$('abilities').addEventListener('pointerover', (e) => {
  const b = e.target.closest('[data-ab]'), id = b ? b.dataset.ab : null;
  if (id === S.helpAb) return;
  S.helpAb = id;
  renderTacHelp(); // the help line only: rebuilding the buttons under the pointer would swallow clicks
});
$('abilities').addEventListener('pointerleave', () => { if (S.helpAb) { S.helpAb = null; renderTacHelp(); } });
function toggleView() {
  if (S.cine || !['player', 'placing'].includes(S.state)) return;
  audio.sfx('click');
  goView(S.view === 'fleet' ? 'target' : 'fleet', 1.1);
}

// ------------------------------------------------------------------ input
const ray = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const plane = new THREE.Plane(UP, 0);
let mouseScreen = { x: 0, y: 0 };
function pickCell(grid) {
  ray.setFromCamera(mouse, world.camera);
  const p = V();
  if (!ray.ray.intersectPlane(plane, p)) return null;
  return grid.worldToCell(p);
}
addEventListener('pointermove', (e) => {
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  mouseScreen = { x: e.clientX, y: e.clientY };
});
const COL_AIM = new THREE.Color(1.4, 0.9, 0.25), COL_OFF = new THREE.Color(0.4, 0.4, 0.4), COL_QUEUE = new THREE.Color(2.2, 0.5, 0.2);
function updateHover() {
  const tag = $('cursorTag');
  if (S.state === 'placing') {
    const cell = pickCell(playerGrid);
    const k = cell ? cell.r * 10 + cell.c : -1;
    const pk = S.place.hover ? S.place.hover.r * 10 + S.place.hover.c : -1;
    if (k !== pk) { S.place.hover = cell; updateGhost(); }
    tag.style.display = 'none';
    return;
  }
  if (S.state === 'player' && !S.cine) {
    const cell = S.view === 'target' ? pickCell(enemyGrid) : null;
    const ab = S.sel.ability, need = queueSize(), q = S.sel.queue;
    enemyGrid.setTiles('queue', q, COL_QUEUE);
    if (!cell) {
      enemyGrid.setHover(null); enemyGrid.setTiles('pattern', null);
      reticle.visible = false; tag.style.display = 'none'; S.hoverKey = -1;
      return;
    }
    const k = cell.r * 10 + cell.c, shot = S.enemy.shots[k], at = coord(cell.r, cell.c);
    let text, pattern = null, ok = !shot, single = false;
    if (ab === 'scan') {
      const o = areaOrigin(cell.r, cell.c);
      enemyGrid.setHover(o, 3, 3, COL_AIM);
      text = `SCAN ${coord(o.r, o.c)}–${coord(o.r + 2, o.c + 2)}`; ok = true;
    } else if (ab === 'barrage') {
      pattern = plusCells(cell.r, cell.c).filter(unshot(S.enemy)); ok = pattern.length > 0;
      text = ok ? `BARRAGE ${at} · ${plural(pattern.length, 'CELL')}` : `${at} · NO OPEN CELLS`;
    } else if (ab === 'lance') {
      const line = lineCells(cell.r, cell.c, S.sel.dir);
      pattern = line.filter(unshot(S.enemy)); ok = pattern.length > 0;
      text = ok ? `LANCE ${lineName(line)} ${DIRS[S.sel.dir].arrow} · R ROTATES` : `${lineName(line)} · NO OPEN CELLS`;
    } else {
      single = true;
      const queued = q.some((p) => p.r === cell.r && p.c === cell.c);
      enemyGrid.setHover(cell, 1, 1, shot ? COL_OFF : COL_AIM);
      if (shot) text = `${at} · ${shot === 3 ? 'NO SHIP HERE' : 'ALREADY TARGETED'}`;
      else if (queued) text = `${at} · CLICK TO REMOVE`;
      else if (need > 1) text = q.length >= need ? `${plural(need, 'CELL')} SELECTED · PRESS FIRE` : `TARGET ${at} · ${q.length + 1}/${need}`;
      else text = `${ab === 'torpedo' ? 'TORPEDO' : 'TARGET'} ${at}`;
    }
    if (pattern) enemyGrid.setHover(null);
    enemyGrid.setTiles('pattern', pattern, ok ? COL_AIM : COL_OFF);
    reticle.visible = single && !shot;
    reticle.position.copy(enemyGrid.cellToWorld(cell.r, cell.c, 0.15));
    tag.style.display = 'block';
    tag.style.left = mouseScreen.x + 'px'; tag.style.top = mouseScreen.y + 'px';
    tag.textContent = text;
    const hk = k + S.sel.dir * 100;
    if (S.hoverKey !== hk) { S.hoverKey = hk; if (ok) audio.sfx('hover'); }
    return;
  }
  tag.style.display = 'none';
}
$('c').addEventListener('pointerdown', (e) => {
  // always pick from where the pointer is now (touch taps have no prior pointermove)
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  mouseScreen = { x: e.clientX, y: e.clientY };
  if (S.cine) return;
  if (e.button === 2) { if (S.state === 'placing') rotatePlacement(); else if (S.state === 'player' && S.sel.ability === 'lance') rotateLance(); return; }
  if (e.button !== 0) return;
  const touch = e.pointerType === 'touch';
  if (S.state === 'placing') {
    if (S.view !== 'fleet') { goView('fleet', 1); return; }
    const cell = pickCell(playerGrid);
    const same = cell && S.place.hover && cell.r === S.place.hover.r && cell.c === S.place.hover.c;
    S.place.hover = cell; updateGhost();
    if (!touch || same) placeCurrent(); // touch: first tap previews, second tap places
  } else if (S.state === 'player' && S.view === 'target') {
    const cell = pickCell(enemyGrid);
    if (!cell) return;
    const k = cell.r * 10 + cell.c;
    if (touch && S.armed !== k) { S.armed = k; return; } // touch: tap to aim, tap again to fire
    S.armed = -1;
    targetClick(cell);
  } else if (S.state === 'player' && S.view === 'fleet') goView('target', 1);
});
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') {
    S.skip = true; e.preventDefault();
    if (document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.blur();
  }
  if (e.repeat) return;
  if (e.code === 'KeyR' && S.state === 'placing') rotatePlacement();
  if (e.code === 'KeyR' && S.state === 'player' && S.sel.ability === 'lance') rotateLance();
  if (S.state === 'player' && !S.cine) {
    const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(e.code);
    if (n >= 0) selectAbility(ABILITIES[n].id);
    if (e.code === 'Escape') cancelAbility();
    if (e.code === 'Enter' || e.code === 'KeyF') { e.preventDefault(); fireQueue(); }
  }
  if (e.code === 'KeyV') toggleView();
  if (e.code === 'KeyM') $('btnMute').click();
});
addEventListener('keyup', (e) => { if (e.code === 'Space') S.skip = false; });
addEventListener('blur', () => { S.skip = false; });
document.addEventListener('visibilitychange', () => { if (document.hidden) S.skip = false; });

// ------------------------------------------------------------------ splash
buildParade();
setParade(true);
rig.set(V(0, 30, 450), V(0, 20, 400), 45);
let splashReady = false;
(async () => {
  const bar = document.querySelector('.splash-bar span');
  bar.style.width = '40%';
  await document.fonts.ready;
  bar.style.width = '75%';
  // warm up shaders by rendering once
  world.renderer.compile(scene, world.camera);
  bar.style.width = '100%';
  splashReady = true;
  $('splashPrompt').textContent = 'CLICK TO ESTABLISH NEURAL LINK';
  $('splashPrompt').classList.add('ready');
})();
$('splash').addEventListener('click', () => {
  if (!splashReady) return;
  audio.init();
  audio.sfx('click');
  $('splash').classList.add('fade');
  setTimeout(() => $('splash').classList.remove('show'), 1300);
  showMenu();
});

// ------------------------------------------------------------------ main loop
let last = performance.now();
function frame(now, manual) {
  if (!manual) requestAnimationFrame(frame);
  const rdt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = Math.max(last, now);
  const scale = (S.cine ? (S.skip ? 4 : S.quick ? 2 : 1) : S.skip && S.state === 'busy' ? 3 : 1) * S.slowmo;
  const dt = rdt * scale;
  clock.time += dt;
  updateTasks(dt);
  if (S.state === 'menu' || S.state === 'splash') { menuCamera(clock.time); menuDust(); }
  fx.update(dt);
  const t = clock.time;
  for (const s of S.parade) if (s.root.visible) s.update(dt, t);
  for (const side of [S.player, S.enemy]) if (side) for (const s of side.ships) s.update(dt, t);
  if (S.place.ghost) S.place.ghost.update(dt, t);
  playerGrid.update(t); enemyGrid.update(t);
  if (reticle.visible) { reticle.userData.ring.rotation.z += dt * 2; reticle.scale.setScalar(1 + 0.05 * Math.sin(t * 6)); }
  updateHover();
  world.render(dt, t);
}
requestAnimationFrame(frame);

// debug handle
window.__bs = { S, world, fx, audio, startGame, targetClick, selectAbility, fireQueue, enemyGrid, playerGrid, frame };
