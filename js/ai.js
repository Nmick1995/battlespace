// Opponent AI. Three threat levels:
//  cadet     – random shots, pokes neighbours after a hit
//  commander – hunt/target with checkerboard parity
//  admiral   – probability-density targeting over every legal remaining ship placement

const N = 10;
const key = (r, c) => r * N + c;

export class AI {
  constructor(level = 'commander') {
    this.level = level;
    this.shots = new Map(); // key -> 'hit' | 'miss' | 'sunk'
    this.remaining = [5, 4, 3, 3, 2];
    this.queue = [];
  }

  record(r, c, result, sunkCells, sunkLen) {
    this.shots.set(key(r, c), result === 'miss' ? 'miss' : 'hit');
    if (result === 'sunk') {
      for (const s of sunkCells) this.shots.set(key(s.r, s.c), 'sunk');
      const i = this.remaining.indexOf(sunkLen);
      if (i >= 0) this.remaining.splice(i, 1);
      this.queue = this.queue.filter((q) => !this.shots.has(key(q.r, q.c)));
    } else if (result === 'hit' && this.level === 'cadet') {
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) this.queue.push({ r: r + dr, c: c + dc });
    }
  }

  free(r, c) { return r >= 0 && r < N && c >= 0 && c < N && !this.shots.has(key(r, c)); }

  choose() {
    if (this.level === 'cadet') {
      while (this.queue.length) { const q = this.queue.shift(); if (this.free(q.r, q.c)) return q; }
      return this.randomCell(() => true);
    }
    if (this.level === 'commander') return this.target() || this.randomCell((r, c) => (r + c) % 2 === 0) || this.randomCell(() => true);
    return this.density();
  }

  randomCell(filter) {
    const opts = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (this.free(r, c) && filter(r, c)) opts.push({ r, c });
    return opts.length ? opts[Math.floor(Math.random() * opts.length)] : null;
  }

  openHits() {
    const out = [];
    for (const [k, v] of this.shots) if (v === 'hit') out.push({ r: Math.floor(k / N), c: k % N });
    return out;
  }

  // Hunt/target: extend lines of adjacent hits, otherwise probe around lone hits.
  target() {
    const hits = this.openHits();
    if (!hits.length) return null;
    const isHit = (r, c) => this.shots.get(key(r, c)) === 'hit';
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

  density() {
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
    let best = -1, bestList = [];
    for (let k = 0; k < N * N; k++) {
      if (this.shots.has(k)) continue;
      const s = score[k] * (0.97 + Math.random() * 0.06);
      if (s > best + 1e-6) { best = s; bestList = [k]; }
      else if (Math.abs(s - best) < 1e-6) bestList.push(k);
    }
    if (!bestList.length || best <= 0) return this.randomCell(() => true);
    const k = bestList[Math.floor(Math.random() * bestList.length)];
    return { r: Math.floor(k / N), c: k % N };
  }
}
