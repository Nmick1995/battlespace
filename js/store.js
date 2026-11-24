// Saved settings and service record (localStorage). Every access is guarded: private browsing can block storage.
import { RANK_POINTS, rankFor } from './rules.js';

const KEY = 'battlespace.v1';

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

export const save = read();
save.settings = save.settings || {};
save.record = save.record || {}; // "mode:difficulty" -> { played, wins, streak, bestStreak, bestScore, fewestShots }

export function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* storage unavailable */ }
}

export function rankPoints() {
  let p = 0;
  for (const [k, v] of Object.entries(save.record)) p += (v.wins || 0) * (RANK_POINTS[k.split(':')[1]] || 0);
  return p;
}
export const currentRank = () => rankFor(rankPoints());

export function totals() {
  let played = 0, wins = 0;
  for (const v of Object.values(save.record)) { played += v.played || 0; wins += v.wins || 0; }
  return { played, wins };
}

// Record a finished battle. Returns what changed so the debrief can report it.
export function recordBattle({ mode, difficulty, win, score, shots }) {
  const before = currentRank();
  const k = `${mode}:${difficulty}`;
  const e = save.record[k] || (save.record[k] = { played: 0, wins: 0, streak: 0, bestStreak: 0, bestScore: 0, fewestShots: 0 });
  e.played++;
  const newBest = score > (e.bestScore || 0);
  if (newBest) e.bestScore = score;
  if (win) {
    e.wins++; e.streak++;
    e.bestStreak = Math.max(e.bestStreak || 0, e.streak);
    if (!e.fewestShots || shots < e.fewestShots) e.fewestShots = shots;
  } else e.streak = 0;
  persist();
  const after = currentRank();
  return { entry: e, newBest, promoted: after.index > before.index ? after : null, rank: after };
}

export function resetRecord() { save.record = {}; persist(); }
