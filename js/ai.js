// Opponent AI. Three threat levels:
//  cadet     – random shots, pokes neighbours after a hit, random ability targets
//  commander – hunt/target with checkerboard parity, abilities aimed with the density map
//  admiral   – probability-density targeting over every legal remaining ship placement
// In Tactical mode it also spends Energy on ship abilities; in Salvo mode it picks several cells per turn.
import { N, ABILITY, ENERGY, plusCells, areaCells, lineCells } from './rules.js';

const key = (r, c) => r * N + c;
const cellOf = (k) => ({ r: Math.floor(k / N), c: k % N });
const BASE_RATE = 0.17; // 17 ship sections on 100 cells

export class AI {
  constructor(level = 'commander') {
    this.level = level;
    this.shots = new Map(); // key -> 'hit' | 'miss' | 'sunk' | 'pending'
    this.remaining = [5, 4, 3, 3, 2];
    this.queue = [];
    this.contacts = new Set(); // cells known to hold an intact section (torpedo sensors)
    this.scans = []; // { cells: [key], left } from Recon Sweep
    this.want = null; // ability being saved up for
  }

  record(r, c, result, sunkCells, sunkLen) {
    const k = key(r, c);
    this.contacts.delete(k);
    this.shots.set(k, result === 'miss' ? 'miss' : 'hit');
    if (result !== 'miss') {
      // a scanned area with no intact sections left is known to be empty
      for (const s of this.scans) if (s.cells.includes(k) && --s.left <= 0) for (const j of s.cells) if (!this.shots.has(j)) this.shots.set(j, 'miss');
    }
    if (result === 'sunk') {
      for (const s of sunkCells) this.shots.set(key(s.r, s.c), 'sunk');
      const i = this.remaining.indexOf(sunkLen);
      if (i >= 0) this.remaining.splice(i, 1);
      this.queue = this.queue.filter((q) => !this.shots.has(key(q.r, q.c)));
    } else if (result === 'hit' && this.level === 'cadet') {
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) this.queue.push({ r: r + dr, c: c + dc });
    }
  }

  // Sensor results (no shot fired at these cells).
  noteClear(r, c) { if (!this.shots.has(key(r, c))) this.shots.set(key(r, c), 'miss'); }
  noteContact(r, c) { if (!this.shots.has(key(r, c))) this.contacts.add(key(r, c)); }
  noteScan(cells, count) {
    if (count <= 0) { for (const p of cells) this.noteClear(p.r, p.c); return; }
    this.scans.push({ cells: cells.map((p) => key(p.r, p.c)), left: count });
  }

  free(r, c) { return r >= 0 && r < N && c >= 0 && c < N && !this.shots.has(key(r, c)); }
  freeCount() { return N * N - this.shots.size; }

  choose() {
    for (const k of this.contacts) if (!this.shots.has(k)) return cellOf(k);
    if (this.level === 'cadet') {
      while (this.queue.length) { const q = this.queue.shift(); if (this.free(q.r, q.c)) return q; }
      return this.randomCell(() => true);
    }
    if (this.level === 'commander') return this.target() || this.randomCell((r, c) => (r + c) % 2 === 0) || this.randomCell(() => true);
    return this.density();
  }

  // Several distinct cells for one turn (Salvo mode).
  chooseMany(n) {
    const out = [];
    n = Math.min(n, this.freeCount());
    for (let i = 0; i < n; i++) {
      const p = this.choose();
      if (!p) break;
      out.push(p);
      this.shots.set(key(p.r, p.c), 'pending');
    }
    for (const p of out) this.shots.delete(key(p.r, p.c));
    return out;
  }

  // What to do this turn: { type, cells } or { type, cell } for area abilities, { type, line } for the lance.
  plan({ mode, energy, abilities, shots }) {
    if (mode === 'salvo') return { type: 'salvo', cells: this.chooseMany(shots) };
    if (mode === 'tactical' && abilities.length) {
      if (this.want && !abilities.includes(this.want)) this.want = null;
      if (!this.want && Math.random() < (this.level === 'cadet' ? 0.4 : 0.85)) this.want = abilities[Math.floor(Math.random() * abilities.length)];
      if (this.want && energy >= ABILITY[this.want].cost) {
        const act = this.useAbility(this.want);
        if (act) { this.want = null; return act; }
        if (energy >= ENERGY.max) this.want = null; // cannot use it now and cannot save more: pick another next turn
      }
    }
    return { type: 'shot', cells: [this.choose()] };
  }

  useAbility(id) {
    const smart = this.level !== 'cadet';
    let sc;
    if (smart) sc = this.scores();
    else { sc = new Float32Array(N * N); for (let k = 0; k < N * N; k++) if (!this.shots.has(k)) sc[k] = 0.01 + Math.random(); }
    const sum = (cells) => cells.reduce((a, p) => a + sc[key(p.r, p.c)], 0);
    const open = (cells) => cells.filter((p) => !this.shots.has(key(p.r, p.c))).length;
    const hunting = !this.openHits().length && !this.contacts.size;
    switch (id) {
      case 'rapid': {
        const cells = this.top(sc, 2);
        return cells.length === 2 ? { type: 'rapid', cells } : null;
      }
      case 'torpedo': {
        const cells = this.top(sc, 1);
        return cells.length ? { type: 'torpedo', cells } : null;
      }
      case 'barrage': {
        let best = null, bv = 0;
        for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
          const cells = plusCells(r, c);
          if (open(cells) < 3) continue;
          const v = sum(cells) * (0.95 + Math.random() * 0.1);
          if (v > bv) { bv = v; best = { r, c }; }
        }
        return best ? { type: 'barrage', cell: best } : null;
      }
      case 'lance': {
        let best = null, bv = 0;
        for (let i = 0; i < N; i++) for (const dir of [0, 1]) {
          const flip = Math.random() < 0.5 ? 2 : 0;
          const line = lineCells(i, i, dir + flip);
          if (open(line) < 4) continue;
          const v = sum(line) * (0.95 + Math.random() * 0.1);
          if (v > bv) { bv = v; best = line; }
        }
        return best ? { type: 'lance', line: best } : null;
      }
      case 'scan': {
        if (!hunting) return null; // a scan is only worth it when there is no lead to follow
        let best = null, bv = 0;
        for (let r = 1; r < N - 1; r++) for (let c = 1; c < N - 1; c++) {
          const cells = areaCells(r, c);
          if (open(cells) < 6) continue;
          const v = sum(cells) * (0.95 + Math.random() * 0.1);
          if (v > bv) { bv = v; best = { r, c }; }
        }
        return best ? { type: 'scan', cell: best } : null;
      }
    }
    return null;
  }

  // Highest-scoring untargeted cells.
  top(sc, n) {
    const ks = [];
    for (let k = 0; k < N * N; k++) if (!this.shots.has(k)) ks.push(k);
    ks.sort((a, b) => sc[b] - sc[a]);
    return ks.slice(0, n).map(cellOf);
  }

  randomCell(filter) {
    const opts = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (this.free(r, c) && filter(r, c)) opts.push({ r, c });
    return opts.length ? opts[Math.floor(Math.random() * opts.length)] : null;
  }

  openHits() {
    const out = [];
    for (const [k, v] of this.shots) if (v === 'hit') out.push(cellOf(k));
    return out;
  }

  // Hunt/target: extend lines of adjacent hits, otherwise probe around lone hits.
  target() {
    const hits = this.openHits();
    if (!hits.length) return null;
    const isHit = (r, c) => r >= 0 && r < N && c >= 0 && c < N && this.shots.get(key(r, c)) === 'hit';
    for (const h of hits) {
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        if (isHit(h.r + dr, h.c + dc) || isHit(h.r - dr, h.c - dc)) {
          // walk the line both ways to its ends
          let a = { ...h }, b = { ...h };
          while (isHit(a.r - dr, a.c - dc)) { a.r -= dr; a.c -= dc; }
          while (isHit(b.r + dr, b.c + dc)) { b.r += dr; b.c += dc; }
          const ends = [{ r: a.r - dr, c: a.c - dc }, { r: b.r + dr, c: b.c + dc }].filter((p) => this.free(p.r, p.c));
          if (ends.length) return ends[Math.floor(Math.random() * ends.length)];
        }
      }
    }
    const opts = [];
    for (const h of hits) for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (this.free(h.r + dr, h.c + dc)) opts.push({ r: h.r + dr, c: h.c + dc });
    return opts.length ? opts[Math.floor(Math.random() * opts.length)] : null;
  }

  // Score of every untargeted cell: how many legal placements of the remaining ships cover it,
  // weighted toward placements that explain open hits, then adjusted by sensor results.
  scores() {
    const score = new Float32Array(N * N);
    const open = new Set(this.openHits().map((h) => key(h.r, h.c)));
    for (const len of this.remaining) {
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) for (const [dr, dc] of [[0, 1], [1, 0]]) {
        let ok = true, covered = 0;
        const cells = [];
        for (let i = 0; i < len; i++) {
          const rr = r + dr * i, cc = c + dc * i;
          if (rr >= N || cc >= N) { ok = false; break; }
          const s = this.shots.get(key(rr, cc));
          if (s === 'miss' || s === 'sunk') { ok = false; break; }
          if (s === 'hit') covered++;
          cells.push(key(rr, cc));
        }
        if (!ok) continue;
        const w = open.size ? (covered ? Math.pow(30, covered) : 0.02) : 1;
        for (const k of cells) if (!this.shots.has(k)) score[k] += w;
      }
    }
    for (const s of this.scans) {
      const un = s.cells.filter((k) => !this.shots.has(k));
      if (!un.length || s.left <= 0) continue;
      const m = Math.min(6, Math.max(0.3, s.left / un.length / BASE_RATE));
      for (const k of un) score[k] *= m;
    }
    let max = 0;
    for (let k = 0; k < N * N; k++) max = Math.max(max, score[k]);
    for (const k of this.contacts) if (!this.shots.has(k)) score[k] = max * 10 + 1000;
    return score;
  }

  density() {
    const score = this.scores();
    let best = -1, bestList = [];
    for (let k = 0; k < N * N; k++) {
      if (this.shots.has(k)) continue;
      const s = score[k] * (0.97 + Math.random() * 0.06);
      if (s > best + 1e-6) { best = s; bestList = [k]; }
      else if (Math.abs(s - best) < 1e-6) bestList.push(k);
    }
    if (!bestList.length || best <= 0) return this.randomCell(() => true);
    return cellOf(bestList[Math.floor(Math.random() * bestList.length)]);
  }
}
