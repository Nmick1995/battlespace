// BattleSpace — game flow, cinematics, input and UI.
import * as THREE from 'three';
import { World, Grid, GRID } from './world.js';
import { FX } from './fx.js';
import { Ship, SHIP_TYPES, CELL, HOVER } from './ships.js';
import { AI } from './ai.js';
import { AudioEngine } from './audio.js';
import { clock, tween, wait, updateTasks, ease, lerp, rand, pick } from './core.js';

const $ = (id) => document.getElementById(id);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const coord = (r, c) => 'ABCDEFGHIJ'[r] + (c + 1);

// ------------------------------------------------------------------ setup
const world = new World($('c'));
const { scene, rig } = world;
const fx = new FX(scene);
const audio = new AudioEngine();
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
  quick: false,
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
  const g = which === 'fleet' ? playerGrid : enemyGrid, k = fit();
  return { pos: g.center.clone().add(V(0, 44 * k, 33 * k)), look: g.center.clone().add(V(0, 0, -1.5)), fov: 50 };
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
  $('stats').innerHTML = `<span>SHOTS</span><b>${st.shots}</b><span>HITS</span><b>${st.hits}</b><span>ACCURACY</span><b>${st.shots ? Math.round((st.hits / st.shots) * 100) : 0}%</b><span>THREAT</span><b>${S.difficulty.toUpperCase()}</b>`;
}

// ------------------------------------------------------------------ menu
const PANELS = {
  settings: () => `<div class="box"><h3>SYSTEMS</h3>
    <label>MUSIC <input type="range" min="0" max="1" step="0.05" value="${audio.musicVol}" id="volMusic"></label>
    <label>EFFECTS <input type="range" min="0" max="1" step="0.05" value="${audio.sfxVol}" id="volSfx"></label>
    <label>CINEMATICS <span class="opt"><button data-q="0" class="${S.quick ? '' : 'on'}">FULL</button><button data-q="1" class="${S.quick ? 'on' : ''}">QUICK</button></span></label>
    <p style="margin-top:12px;font-size:14px;color:#7fa3b8">Hold SPACE during any cinematic to fast-forward.</p></div>`,
  briefing: () => `<div class="box"><h3>RULES OF ENGAGEMENT</h3>
    <p>Classic naval rules, fought in orbit. Each commander secretly deploys five vessels on a 10×10 grid — horizontally or vertically, never diagonally or overlapping.</p>
    <ul><li><b>Carrier</b> · 5 sections · missile swarm</li><li><b>Battleship</b> · 4 sections · plasma batteries</li><li><b>Cruiser</b> · 3 sections · spinal railgun</li><li><b>Stealth Frigate</b> · 3 sections · void torpedoes</li><li><b>Destroyer</b> · 2 sections · pulse lasers</li></ul>
    <p style="margin-top:8px">Take turns firing one salvo at a grid coordinate. Hits and misses are reported — the enemy hull stays cloaked. When every section of a vessel is hit it is destroyed and its class is revealed. Destroy the entire hostile fleet to win.</p></div>`,
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
    $('volSfx').oninput = (e) => { audio.setSfxVolume(+e.target.value); };
    $('volSfx').onchange = () => audio.sfx('laser');
    p.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => { S.quick = b.dataset.q === '1'; showPanel('settings'); audio.sfx('click'); }));
  }
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
    showPanel('difficulty');
  }
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
  P.idx = i; renderPlaceList();
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
  audio.sfx('click');
  for (const s of S.player.ships) s.dispose();
  S.player = newBoard();
  randomFleet(S.player, 'player');
  S.player.ships.forEach(materialize);
  audio.sfx('place');
  nextPlacement();
};
$('btnClear').onclick = () => { audio.sfx('click'); for (const s of S.player.ships) s.dispose(); S.player = newBoard(); nextPlacement(); };
$('btnEngage').onclick = () => { if (S.state === 'placing' && S.place.idx < 0) { audio.sfx('click'); engage(); } };

async function engage() {
  S.state = 'busy';
  $('placement').classList.add('hidden');
  $('enemyPanel').classList.remove('hidden');
  playerGrid.setHover(null);
  renderPanels();
  log('All vessels in position. Weapons free.', 'you');
  announce('ENGAGE', 'sunk');
  audio.sfx('alarm');
  await wait(1.2);
  playerTurn();
}

// ------------------------------------------------------------------ turns
async function playerTurn() {
  if (S.state === 'over') return;
  S.stats.turns++;
  banner('YOUR TURN', 'Select a coordinate on the hostile grid to fire');
  await goView('target', 1.5);
  S.state = 'player';
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
const fleetDead = (b) => b.ships.every((s) => s.hits.size === s.len);

async function playerFire(r, c) {
  if (S.enemy.shots[r * 10 + c]) { audio.sfx('error'); return; }
  S.state = 'busy';
  reticle.visible = false; enemyGrid.setHover(null); $('cursorTag').style.display = 'none';
  S.stats.shots++;
  const res = resolve(S.enemy, r, c);
  if (res.hit) S.stats.hits++;
  await firingCinematic(r, c, res);
  log(`You fire at ${coord(r, c)} — ${res.hit ? 'HIT' : 'miss'}`, res.hit ? 'hit' : 'you');
  renderPanels();
  if (res.sunk) {
    await sinkCinematic(res.ship, true);
    for (const cell of res.ship.cells) { const m = enemyGrid.markers.children.find((g) => g.userData.cell === cell.r * 10 + cell.c); if (m) m.userData.fill.material.color.setRGB(1.2, 0.4, 0.05); }
    log(`Enemy ${res.ship.type.name} "${res.ship.name}" destroyed!`, 'sunk');
    renderPanels();
    if (fleetDead(S.enemy)) return gameOver(true);
  }
  enemyTurn();
}

async function enemyTurn() {
  if (S.state === 'over') return;
  banner('ENEMY TURN', 'Hostile fleet is targeting your vessels', true);
  await goView('fleet', 1.3);
  audio.sfx('alarm');
  await wait(0.5 + rand(0, 0.5));
  const { r, c } = S.ai.choose();
  S.stats.enemyShots++;
  const res = resolve(S.player, r, c);
  if (res.hit) S.stats.enemyHits++;
  S.ai.record(r, c, res.sunk ? 'sunk' : res.hit ? 'hit' : 'miss', res.sunk ? res.ship.cells : null, res.sunk ? res.ship.len : 0);
  await incomingCinematic(r, c, res);
  log(`Enemy fires at ${coord(r, c)} — ${res.hit ? `HIT on ${res.ship.name}` : 'miss'}`, res.hit ? 'hit' : '');
  renderPanels();
  if (res.sunk) {
    await sinkCinematic(res.ship, false);
    log(`${res.ship.name} has been lost!`, 'sunk');
    renderPanels();
    if (fleetDead(S.player)) return gameOver(false);
  }
  playerTurn();
}

// ------------------------------------------------------------------ cinematics
const WEAPON = {
  laser: { n: 6, gap: 0.09, dur: 1.05, s: 0.8, color: 0x55ff77 },
  plasma: { n: 6, gap: 0.13, dur: 1.35, s: 1.1, color: 0xff8a2a },
  railgun: { n: 1, gap: 0, dur: 0.42, s: 1.5, color: 0x88bbff, charge: 1.0 },
  torpedo: { n: 2, gap: 0.4, dur: 1.9, s: 1.2, color: 0xd050ff },
  missile: { n: 8, gap: 0.08, dur: 2.1, s: 0.6, color: 0xffaa55 },
  hostile: { n: 4, gap: 0.16, dur: 1.5, s: 1, color: 0xff3322 },
};

function salvo(kind, muzzles, target, { onImpact, onFirst }) {
  const W = WEAPON[kind];
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
    for (let i = 0; i < W.n; i++) {
      const m = muzzles[i % muzzles.length];
      const from = m.obj ? m.obj.getWorldPosition(V()) : m.pos.clone();
      const dir = m.obj ? V(1, 0, 0).transformDirection(m.obj.matrixWorld) : m.dir.clone();
      if (kind === 'missile') dir.set(rand(-0.2, 0.2), 1, rand(-0.2, 0.2)).normalize();
      fx.muzzle(from, dir, W.color, W.s);
      audio.sfx(kind === 'hostile' ? 'plasma' : kind);
      rig.shake(0.18 * W.s);
      if (kind === 'railgun') { fx.ring(from, new THREE.Color(0.7, 1.4, 3), 3, 0.5, { normal: dir, thick: 0.06 }); fx.ring(from.clone().addScaledVector(dir, 2), new THREE.Color(0.4, 0.9, 2), 2.2, 0.6, { normal: dir, thick: 0.05 }); rig.shake(1.2); }
      const end = target.clone().add(i === 0 ? V() : V(rand(-0.9, 0.9), rand(-0.3, 0.5), rand(-0.9, 0.9)));
      const dist = from.distanceTo(end);
      const ctrl = from.clone().addScaledVector(dir, dist * (kind === 'missile' ? 0.45 : kind === 'hostile' ? 0.2 : 0.3)).lerp(end, kind === 'railgun' ? 0.5 : 0.05);
      if (kind === 'torpedo') ctrl.add(V(rand(-6, 6), rand(0, 3), 0));
      if (kind === 'missile') ctrl.add(V(rand(-5, 5), 0, rand(-5, 5)));
      const p = fx.fire(kind, from, end, W.dur * rand(0.94, 1.06), {
        ctrl,
        onArrive: (pt) => { onImpact(pt, i); if (++arrived === W.n) resolveAll(); },
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

async function firingCinematic(r, c, res) {
  setCine(true);
  const shooter = chooseShooter();
  const target = enemyGrid.cellToWorld(r, c, HOVER);
  shooter.aimAt(target);
  const kind = shooter.type.weapon;
  const center = shooter.root.getWorldPosition(V());
  const toT = target.clone().sub(center).setY(0).normalize();
  const side = V().crossVectors(toT, UP).normalize().multiplyScalar(Math.random() < 0.5 ? 1 : -1);
  const len = shooter.len * CELL;
  caption(`${shooter.type.cls} · ${shooter.type.weaponName}`, `${shooter.name.toUpperCase()} — FIRING ON ${coord(r, c)}`);
  audio.sfx('whoosh');

  // Shot 1 — low dramatic dolly alongside the firing ship
  await wait(0.05);
  const muzzles = shooter.muzzles();
  const m0 = muzzles[0].pos;
  const p0 = center.clone().addScaledVector(side, len * 0.5 + 5).addScaledVector(UP, 1.0).addScaledVector(toT, len * 0.25);
  const p1 = center.clone().addScaledVector(toT, -(len * 0.45 + 5)).addScaledVector(side, len * 0.3 + 2.5).addScaledVector(UP, 2.4);
  const l0 = center.clone(), l1 = center.clone().addScaledVector(toT, 13).addScaledVector(UP, 0.5);
  // swing from a side profile around to an over-the-shoulder view down the barrels
  camTween(2.4, (k) => {
    const a = V().lerpVectors(p0, p1, k);
    a.addScaledVector(side, Math.sin(k * Math.PI) * len * 0.25);
    rig.pos.copy(a); rig.look.lerpVectors(l0, l1, k); rig.fov = lerp(42, 38, k);
  }, ease.inOutSine);
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
          const m = enemyGrid.addHit(r, c); m.userData.cell = r * 10 + c;
          res.ship.damage(res.seg, { silent: true });
          announce('DIRECT HIT', 'hit');
        }
      } else {
        fx.ripple(pt, firstImpact ? 1 : 0.45);
        if (firstImpact) { audio.sfx('ripple'); enemyGrid.addMiss(r, c); announce('MISS', 'miss'); }
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

async function incomingCinematic(r, c, res) {
  setCine(true);
  const target = playerGrid.cellToWorld(r, c, HOVER);
  caption('WARNING · HOSTILE ORDNANCE INBOUND', `IMPACT PROJECTED AT ${coord(r, c)}`, true);
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
          res.ship.damage(res.seg);
          playerGrid.addHit(r, c).userData.fill.material.opacity = 0.25;
          announce('HULL BREACH', 'lost');
        }
      } else {
        fx.ripple(pt, first ? 1 : 0.45);
        if (first) { audio.sfx('ripple'); playerGrid.addMiss(r, c); announce('ENEMY MISSED', 'miss'); }
      }
      first = false;
    },
  });
  await all;
  await wait(res.hit ? 1.5 : 1.1);
  if (!res.sunk) setCine(false);
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
  for (const m of grid.markers.children) if (ship.cells.some((cl) => grid.cellToWorld(cl.r, cl.c).sub(grid.center).distanceTo(m.position) < 1)) { m.userData.dim = true; m.traverse((o) => { if (o.material) o.material.opacity *= 0.25; }); }
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
  S.slowmo = 0.3;
  tween(0.9, (k) => { zoom = 1 + 1.1 * k; }, ease.out);
  fx.flash(center, 0xffffff, 900, 1.5, 120);
  flashScreen(0.45, 0.8);
  fx.explosion(center, 1.7);
  for (let i = 0; i < ship.len; i++) fx.explosion(ship.segWorld(i), 0.6, { noSmoke: true, noDebris: true });
  fx.debris(center, 26, 16, 0.4);
  fx.ring(center, new THREE.Color(4, 3, 2), len * 2.5, 2.2, { thick: 0.03 });
  fx.ring(center, new THREE.Color(2, 3, 5), len * 3.2, 2.8, { thick: 0.015, normal: V(0.2, 1, 0.1) });
  fx.sprite(center, new THREE.Color(4, 3.2, 2.4), len * 1.1, 0.8, 1.8);
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
  audio.stinger(win);
  banner(win ? 'VICTORY' : 'DEFEAT', win ? 'The hostile fleet has been annihilated' : 'Your fleet has been destroyed', !win);
  if (!win) {
    // reveal the surviving hostile vessels
    for (const s of S.enemy.ships) if (s.hits.size < s.len) { s.root.visible = true; s.setOpacity(0.55); }
    await goView('target', 2);
  } else await goView('target', 2);
  const st = S.stats;
  $('goKicker').textContent = win ? 'HOSTILE FLEET ELIMINATED' : 'ALL VESSELS LOST';
  $('goTitle').textContent = win ? 'VICTORY' : 'DEFEAT';
  $('goTitle').className = 'go-title ' + (win ? 'win' : 'lose');
  $('goStats').innerHTML = `<div>TURNS<b>${st.turns}</b></div><div>SHOTS FIRED<b>${st.shots}</b></div><div>ACCURACY<b>${st.shots ? Math.round((st.hits / st.shots) * 100) : 0}%</b></div><div>SHIPS REMAINING<b>${S.player.ships.filter((s) => s.hits.size < s.len).length}</b></div>`;
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
    if (cell) {
      const shot = S.enemy.shots[cell.r * 10 + cell.c];
      enemyGrid.setHover(cell, 1, 1, shot ? new THREE.Color(0.4, 0.4, 0.4) : new THREE.Color(1.4, 0.9, 0.25));
      reticle.visible = !shot;
      reticle.position.copy(enemyGrid.cellToWorld(cell.r, cell.c, 0.15));
      tag.style.display = 'block';
      tag.style.left = mouseScreen.x + 'px'; tag.style.top = mouseScreen.y + 'px';
      tag.textContent = shot ? `${coord(cell.r, cell.c)} · ALREADY TARGETED` : `TARGET ${coord(cell.r, cell.c)}`;
      if (S.hoverKey !== cell.r * 10 + cell.c) { S.hoverKey = cell.r * 10 + cell.c; if (!shot) audio.sfx('hover'); }
    } else { enemyGrid.setHover(null); reticle.visible = false; tag.style.display = 'none'; S.hoverKey = -1; }
    return;
  }
  tag.style.display = 'none';
}
$('c').addEventListener('pointerdown', (e) => {
  if (S.cine) return;
  if (e.button === 2) { if (S.state === 'placing') rotatePlacement(); return; }
  if (e.button !== 0) return;
  if (S.state === 'placing') placeCurrent();
  else if (S.state === 'player' && S.view === 'target') { const cell = pickCell(enemyGrid); if (cell) playerFire(cell.r, cell.c); }
  else if (S.state === 'player' && S.view === 'fleet') goView('target', 1);
});
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('keydown', (e) => {
  if (e.code === 'Space') { S.skip = true; e.preventDefault(); }
  if (e.code === 'KeyR' && S.state === 'placing') rotatePlacement();
  if (e.code === 'KeyV') toggleView();
  if (e.code === 'KeyM') $('btnMute').click();
});
addEventListener('keyup', (e) => { if (e.code === 'Space') S.skip = false; });

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
window.__bs = { S, world, fx, audio, startGame, playerFire, enemyGrid, playerGrid, frame };
