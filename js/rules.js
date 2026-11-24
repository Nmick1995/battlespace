// Battle modes, ship abilities and the cell patterns they use. Shared by the game flow and the AI.

export const N = 10;

export const MODES = [
  { id: 'tactical', name: 'TACTICAL', desc: '1 shot per turn. Each of your ships that is not destroyed gives you an ability. Abilities cost Energy.' },
  { id: 'salvo', name: 'SALVO', desc: '1 shot per turn for each of your ships that is not destroyed.' },
  { id: 'classic', name: 'CLASSIC', desc: '1 shot per turn. No abilities.' },
];

// Tactical mode only.
export const ENERGY = { start: 1, max: 8, perTurn: 1, perHit: 1 };

export const ABILITIES = [
  { id: 'scan', ship: 'carrier', name: 'Recon Sweep', cost: 3, desc: 'Scan a 3×3 area. Shows how many intact ship sections are inside. You still fire 1 shot this turn.' },
  { id: 'barrage', ship: 'battleship', name: 'Plasma Barrage', cost: 4, desc: 'Fire at 5 cells in a plus pattern.' },
  { id: 'lance', ship: 'cruiser', name: 'Railgun Lance', cost: 5, desc: 'Fire down a full row or column. The slug stops at the first intact ship section. Every cell it passes is marked as a miss.' },
  { id: 'torpedo', ship: 'frigate', name: 'Void Torpedo', cost: 3, desc: 'Fire at 1 cell. On a hit, the 4 adjacent cells are revealed as ship or empty.' },
  { id: 'rapid', ship: 'destroyer', name: 'Rapid Fire', cost: 2, desc: 'Fire at 2 cells of your choice.' },
];
export const ABILITY = Object.fromEntries(ABILITIES.map((a) => [a.id, a]));

export const inGrid = (r, c) => r >= 0 && r < N && c >= 0 && c < N;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Plus pattern: the cell and its 4 neighbours (cells off the grid are dropped).
export function plusCells(r, c) {
  return [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]].map(([dr, dc]) => ({ r: r + dr, c: c + dc })).filter((p) => inGrid(p.r, p.c));
}
export function adjacentCells(r, c) { return plusCells(r, c).slice(1); }

// 3×3 area around a cell, shifted inward so it always covers 9 cells.
export function areaOrigin(r, c) { return { r: clamp(r - 1, 0, N - 3), c: clamp(c - 1, 0, N - 3) }; }
export function areaCells(r, c) {
  const o = areaOrigin(r, c), out = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out.push({ r: o.r + i, c: o.c + j });
  return out;
}

// Lance directions. The slug enters at the grid edge and travels the whole row or column.
export const DIRS = [
  { dr: -1, dc: 0, arrow: '↑' },
  { dr: 0, dc: 1, arrow: '→' },
  { dr: 1, dc: 0, arrow: '↓' },
  { dr: 0, dc: -1, arrow: '←' },
];
export function lineCells(r, c, dir) {
  const d = DIRS[dir], out = [];
  let rr = d.dr ? (d.dr < 0 ? N - 1 : 0) : r, cc = d.dc ? (d.dc < 0 ? N - 1 : 0) : c;
  for (let i = 0; i < N; i++) { out.push({ r: rr, c: cc }); rr += d.dr; cc += d.dc; }
  return out;
}

// ------------------------------------------------------------------ scoring and ranks
export const DIFF_MULT = { cadet: 1, commander: 1.5, admiral: 2 };

// Win: 100 per intact section you still have, 20 per accuracy point, 25 per turn under 60.
// Loss: 30 per enemy section you hit. Both are multiplied by the threat level.
export function battleScore({ win, intact, accuracy, turns, enemyHit, difficulty }) {
  const m = DIFF_MULT[difficulty] || 1;
  return Math.round((win ? intact * 100 + accuracy * 20 + Math.max(0, 60 - turns) * 25 : enemyHit * 30) * m);
}

// Rank points: 1 per Cadet win, 2 per Commander win, 3 per Admiral win.
export const RANKS = [
  { at: 0, name: 'Ensign' }, { at: 2, name: 'Lieutenant' }, { at: 6, name: 'Commander' }, { at: 12, name: 'Captain' },
  { at: 20, name: 'Commodore' }, { at: 32, name: 'Rear Admiral' }, { at: 48, name: 'Admiral' }, { at: 70, name: 'Fleet Admiral' },
];
export const RANK_POINTS = { cadet: 1, commander: 2, admiral: 3 };
export function rankFor(points) {
  let i = 0;
  while (i + 1 < RANKS.length && points >= RANKS[i + 1].at) i++;
  return { ...RANKS[i], index: i, next: RANKS[i + 1] || null };
}
