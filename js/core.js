// Game-time tween/sequence engine. All cinematic timing runs through here so it can be fast-forwarded.

export const clock = { time: 0, timeScale: 1 };
const tasks = [];

export const ease = {
  linear: (t) => t,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
  in: (t) => t * t * t,
  outExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
};

export function tween(dur, fn, e = ease.inOut) {
  return new Promise((res) => {
    const task = { t: 0, dur: Math.max(dur, 1e-4), fn, e, res };
    tasks.push(task);
    fn(0, 0);
  });
}

export const wait = (s) => tween(s, () => {}, ease.linear);

export function updateTasks(dt) {
  for (let i = tasks.length - 1; i >= 0; i--) {
    const k = tasks[i];
    k.t += dt;
    const p = Math.min(k.t / k.dur, 1);
    k.fn(k.e(p), p);
    if (p >= 1) { tasks.splice(i, 1); k.res(); }
  }
}

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
