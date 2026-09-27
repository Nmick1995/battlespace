// Particles, explosions, shockwaves, debris and projectiles.
import * as THREE from 'three';
import { rand } from './core.js';

const V = () => new THREE.Vector3();
const tmp = new THREE.Vector3();
const epos = new THREE.Vector3();

function softTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function smokeTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 40; i++) {
    const x = 64 + rand(-26, 26), y = 64 + rand(-26, 26), r = rand(14, 34);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.22)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const TEX = {};

class Particles {
  constructor(max, blending, map) {
    this.max = max; this.count = 0;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.siz = new Float32Array(max);
    this.alp = new Float32Array(max);
    this.rot = new Float32Array(max);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.siz, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alp, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('rot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, scale: { value: 600 } },
      vertexShader: `
        attribute float size; attribute float alpha; attribute float rot; attribute vec3 color;
        varying vec3 vColor; varying float vAlpha; varying float vRot;
        uniform float scale;
        void main(){
          vColor = color; vAlpha = alpha; vRot = rot;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = min(size * scale / max(0.1, -mv.z), 260.0);
          vAlpha *= smoothstep(0.8, 5.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map; varying vec3 vColor; varying float vAlpha; varying float vRot;
        void main(){
          vec2 p = gl_PointCoord - 0.5;
          float c = cos(vRot), s = sin(vRot);
          p = mat2(c,-s,s,c) * p + 0.5;
          vec4 t = texture2D(map, p);
          gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
        }`,
      transparent: true, depthWrite: false, blending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = blending === THREE.AdditiveBlending ? 3 : 2;
    // simulation state
    this.p = []; for (let i = 0; i < max; i++) this.p.push({ x: V(), v: V(), life: 0, max: 1, s0: 1, s1: 1, c0: new THREE.Color(), c1: new THREE.Color(), a0: 1, a1: 0, drag: 0, g: 0, r: 0, vr: 0 });
  }
  spawn(pos, vel, life, s0, s1, c0, c1, a0 = 1, a1 = 0, drag = 0, g = 0) {
    if (this.count >= this.max) return;
    const q = this.p[this.count++];
    q.x.copy(pos); q.v.copy(vel); q.life = 0; q.max = life; q.s0 = s0; q.s1 = s1;
    q.c0.copy(c0); q.c1.copy(c1 || c0); q.a0 = a0; q.a1 = a1; q.drag = drag; q.g = g;
    q.r = Math.random() * 6.28; q.vr = rand(-1.5, 1.5);
  }
  update(dt) {
    let i = 0;
    while (i < this.count) {
      const q = this.p[i];
      q.life += dt;
      if (q.life >= q.max) {
        this.count--; // swap-remove
        this.p[i] = this.p[this.count]; this.p[this.count] = q;
        continue;
      }
      const k = q.life / q.max;
      if (q.drag) q.v.multiplyScalar(Math.exp(-q.drag * dt));
      q.v.y += q.g * dt;
      q.x.addScaledVector(q.v, dt);
      q.r += q.vr * dt;
      const j = i * 3;
      this.pos[j] = q.x.x; this.pos[j + 1] = q.x.y; this.pos[j + 2] = q.x.z;
      this.col[j] = q.c0.r + (q.c1.r - q.c0.r) * k;
      this.col[j + 1] = q.c0.g + (q.c1.g - q.c0.g) * k;
      this.col[j + 2] = q.c0.b + (q.c1.b - q.c0.b) * k;
      this.siz[i] = q.s0 + (q.s1 - q.s0) * k;
      this.alp[i] = (q.a0 + (q.a1 - q.a0) * k) * Math.min(1, q.life * 30);
      this.rot[i] = q.r;
      i++;
    }
    this.geo.setDrawRange(0, this.count);
    for (const n of ['position', 'color', 'size', 'alpha', 'rot']) this.geo.attributes[n].needsUpdate = true;
  }
  clear() { this.count = 0; this.geo.setDrawRange(0, 0); }
}

const C = (r, g, b) => new THREE.Color(r, g, b);
export const COLORS = {
  fireHot: C(2.0, 1.1, 0.4), fire: C(1.9, 0.7, 0.15), fireDark: C(0.35, 0.07, 0.01),
  spark: C(4, 2.8, 1.3), smoke: C(0.12, 0.11, 0.11), smokeLight: C(0.25, 0.23, 0.22),
  cyan: C(1.2, 4, 6), cyanDim: C(0.1, 0.5, 0.8), white: C(8, 8, 8),
};

export class FX {
  constructor(scene) {
    this.scene = scene;
    TEX.soft = softTexture(); TEX.smoke = smokeTexture();
    this.add = new Particles(14000, THREE.AdditiveBlending, TEX.soft);
    this.smoke = new Particles(5000, THREE.NormalBlending, TEX.smoke);
    scene.add(this.add.points, this.smoke.points);
    this.anims = []; // generic per-frame updaters
    this.emitters = [];
    this.projectiles = [];
    // fixed light pool (changing light count would recompile shaders)
    this.lights = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffaa66, 0, 40, 1.6);
      l.userData.t = 0; l.userData.dur = 1; l.userData.peak = 0;
      scene.add(l); this.lights.push(l);
    }
    this.debrisGeo = [new THREE.IcosahedronGeometry(1, 0), new THREE.TetrahedronGeometry(1, 0), new THREE.BoxGeometry(1.4, 0.4, 0.9)];
    this.debrisMat = new THREE.MeshStandardMaterial({ color: 0x3a3a40, metalness: 0.8, roughness: 0.5, emissive: 0xff4400, emissiveIntensity: 0.6 });
    this.ringGeo = new THREE.RingGeometry(0.85, 1, 96);
    this.sprMats = new Map();
  }

  setScale(h) { this.add.mat.uniforms.scale.value = h * 0.9; this.smoke.mat.uniforms.scale.value = h * 0.9; }

  update(dt) {
    for (let i = this.anims.length - 1; i >= 0; i--) if (this.anims[i](dt) === false) this.anims.splice(i, 1);
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i];
      if (e.dead) { this.emitters.splice(i, 1); continue; }
      if (e.active && !e.active()) continue;
      e.acc += dt * e.rate;
      while (e.acc >= 1) { e.acc -= 1; e.fn(e.obj ? e.obj.getWorldPosition(epos) : e.pos); }
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) if (this.projectiles[i].update(dt) === false) this.projectiles.splice(i, 1);
    for (const l of this.lights) {
      if (l.userData.t < l.userData.dur) {
        l.userData.t += dt;
        const k = Math.min(1, l.userData.t / l.userData.dur);
        l.intensity = l.userData.peak * Math.pow(1 - k, 2);
      } else l.intensity = 0;
    }
    this.add.update(dt); this.smoke.update(dt);
  }

  clear() {
    this.add.clear(); this.smoke.clear();
    this.emitters.length = 0;
    for (const p of this.projectiles) p.dispose();
    this.projectiles.length = 0;
  }

  addEmitter(e) { e.acc = 0; this.emitters.push(e); return e; }

  flash(pos, color = 0xffaa55, peak = 400, dur = 0.6, dist = 60) {
    let l = this.lights.find((x) => x.userData.t >= x.userData.dur) || this.lights[0];
    l.position.copy(pos); l.color.set(color); l.distance = dist;
    l.userData.t = 0; l.userData.dur = dur; l.userData.peak = peak;
  }

  sprite(pos, color, size, dur, grow = 1.6, opacity = 1) {
    const mat = new THREE.SpriteMaterial({ map: TEX.soft, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity });
    const s = new THREE.Sprite(mat); s.position.copy(pos); s.scale.setScalar(size); s.renderOrder = 4;
    this.scene.add(s);
    let t = 0;
    this.anims.push((dt) => {
      t += dt; const k = t / dur;
      if (k >= 1) { this.scene.remove(s); mat.dispose(); return false; }
      s.scale.setScalar(size * (1 + (grow - 1) * Math.sqrt(k)));
      mat.opacity = opacity * Math.pow(1 - k, 1.5);
    });
    return s;
  }

  ring(pos, color, radius, dur, { normal = new THREE.Vector3(0, 1, 0), thick = 0.15, opacity = 1, start = 0.1 } = {}) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity });
    const geo = new THREE.RingGeometry(1 - thick, 1, 96);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(pos);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
    m.renderOrder = 4;
    this.scene.add(m);
    let t = 0;
    this.anims.push((dt) => {
      t += dt; const k = t / dur;
      if (k >= 1) { this.scene.remove(m); geo.dispose(); mat.dispose(); return false; }
      const e = 1 - Math.pow(1 - k, 3);
      m.scale.setScalar(radius * (start + (1 - start) * e));
      mat.opacity = opacity * (1 - k) * (1 - k);
    });
    return m;
  }

  sparks(pos, n, speed, color = COLORS.spark, life = 0.8, size = 0.25) {
    for (let i = 0; i < n; i++) {
      const v = V().randomDirection().multiplyScalar(speed * rand(0.3, 1));
      this.add.spawn(pos, v, life * rand(0.5, 1.2), size, 0.02, color, COLORS.fireDark, 1, 0, 1.5, -2);
    }
  }

  // --------------------------------------------------------------- composite effects
  explosion(pos, s = 1, opts = {}) {
    const up = opts.noSmoke ? 0 : 1;
    this.flash(pos, 0xff9a4a, 450 * s, 0.9 * s, 50 * s);
    this.sprite(pos, new THREE.Color(2.2, 1.6, 1.0), 5 * s, 0.3, 2.2);
    this.sprite(pos, new THREE.Color(1.8, 0.7, 0.15), 8 * s, 1.0 * s, 1.8, 0.7);
    // fireball
    for (let i = 0; i < 55 * s; i++) {
      const v = V().randomDirection().multiplyScalar(rand(2, 9) * s);
      const p = tmp.copy(pos).addScaledVector(v, 0.05);
      this.add.spawn(p, v, rand(0.5, 1.4) * Math.sqrt(s), rand(1.2, 2.4) * s, rand(2.5, 5) * s, COLORS.fireHot, COLORS.fireDark, 0.45, 0, 3.2, 0.6);
    }
    this.sparks(pos, 90 * s, 28 * s, COLORS.spark, 1.1, 0.35 * s);
    // smoke
    for (let i = 0; i < 26 * s * up; i++) {
      const v = V().randomDirection().multiplyScalar(rand(1, 4) * s);
      this.smoke.spawn(pos, v, rand(2, 4) * s, rand(2, 3) * s, rand(6, 10) * s, COLORS.smokeLight, COLORS.smoke, 0.55, 0, 1.2, 0.4);
    }
    // shockwave
    this.ring(pos, new THREE.Color(2, 1.2, 0.5), 10 * s, 0.8, { thick: 0.12 });
    this.ring(pos, new THREE.Color(0.5, 0.9, 1.5), 16 * s, 1.3, { thick: 0.03, opacity: 0.45 });
    if (!opts.noDebris) this.debris(pos, Math.round(8 * s), 10 * s, 0.25 * Math.sqrt(s));
  }

  debris(pos, n, speed, size = 0.3) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.debrisGeo[i % 3], this.debrisMat);
      m.scale.set(size * rand(0.4, 1.3), size * rand(0.3, 1), size * rand(0.4, 1.3));
      m.position.copy(pos);
      const v = V().randomDirection().multiplyScalar(speed * rand(0.4, 1));
      const w = V().randomDirection().multiplyScalar(rand(2, 8));
      this.scene.add(m);
      let t = 0; const life = rand(1.5, 3.2); const s0 = m.scale.clone();
      this.anims.push((dt) => {
        t += dt;
        if (t > life) { this.scene.remove(m); return false; }
        v.multiplyScalar(Math.exp(-0.8 * dt));
        m.position.addScaledVector(v, dt);
        m.rotation.x += w.x * dt; m.rotation.y += w.y * dt; m.rotation.z += w.z * dt;
        const k = Math.max(0, (t - life * 0.7) / (life * 0.3));
        m.scale.copy(s0).multiplyScalar(1 - k);
        if (Math.random() < 0.6) this.add.spawn(m.position, V(), 0.5, 0.6, 0.1, COLORS.fire, COLORS.fireDark, 0.9, 0, 0, 0);
      });
    }
  }

  // Shot missed: the bolt dissipates into a soft expanding circular wave.
  ripple(pos, s = 1) {
    const c = new THREE.Color(1.0, 3.2, 4.5);
    this.ring(pos, c, 2.6 * s, 1.1, { thick: 0.08, start: 0.05 });
    this.ring(pos, c.clone().multiplyScalar(0.6), 1.7 * s, 1.4, { thick: 0.18, start: 0.05, opacity: 0.6 });
    if (s > 0.6) this.ring(pos, c.clone().multiplyScalar(0.8), 2.2 * s, 1.2, { thick: 0.1, start: 0.05, opacity: 0.6, normal: new THREE.Vector3(0.3, 1, 0.2) });
    this.sprite(pos, new THREE.Color(1.5, 3, 4), 2.2 * s, 0.5, 1.4, 0.8);
    const n = Math.round(40 * s);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const v = V().set(Math.cos(a), rand(-0.1, 0.1), Math.sin(a)).multiplyScalar(rand(2, 3.4) * s);
      this.add.spawn(pos, v, rand(0.6, 1), 0.3, 0.02, COLORS.cyan, COLORS.cyanDim, 1, 0, 2.2, 0);
    }
    this.flash(pos, 0x66ccff, 80 * s, 0.5, 18);
  }

  muzzle(pos, dir, color, s = 1) {
    this.flash(pos, color, 120 * s, 0.25, 25);
    this.sprite(pos, new THREE.Color(color).multiplyScalar(3), 1.8 * s, 0.18, 1.8);
    for (let i = 0; i < 14 * s; i++) {
      const v = dir.clone().multiplyScalar(rand(6, 16)).add(V().randomDirection().multiplyScalar(3));
      this.add.spawn(pos, v, rand(0.15, 0.35), 0.5 * s, 0.05, new THREE.Color(color).multiplyScalar(2.5), COLORS.fireDark, 1, 0, 4, 0);
    }
    for (let i = 0; i < 6 * s; i++) {
      const v = dir.clone().multiplyScalar(rand(1, 3)).add(V().randomDirection());
      this.smoke.spawn(pos, v, rand(0.8, 1.6), 0.6, 2.2, COLORS.smokeLight, COLORS.smoke, 0.3, 0, 1.5, 0.2);
    }
  }

  fire(kind, from, to, dur, opts = {}) {
    const p = new Projectile(this, kind, from, to, dur, opts);
    this.projectiles.push(p);
    return p;
  }
}

const KINDS = {
  laser:   { color: [0.4, 3, 0.8], size: 0.8, len: 2.6, rad: 0.09, arc: 0.0, trail: 'short' },
  plasma:  { color: [3, 1.1, 0.25], size: 1.6, len: 1.6, rad: 0.35, arc: 0.12, trail: 'flame' },
  railgun: { color: [1.4, 2.6, 5], size: 1.1, len: 3.5, rad: 0.12, arc: 0.0, trail: 'streak' },
  torpedo: { color: [2.8, 0.6, 3.4], size: 2.0, len: 0.8, rad: 0.45, arc: 0.25, trail: 'spiral' },
  missile: { color: [3, 1.5, 0.5], size: 0.9, len: 0.9, rad: 0.12, arc: 0.6, trail: 'smoke' },
  hostile: { color: [3.6, 0.45, 0.3], size: 1.5, len: 2.2, rad: 0.22, arc: 0.1, trail: 'flame' },
};

class Projectile {
  constructor(fx, kind, from, to, dur, opts) {
    this.fx = fx; this.kind = kind; this.k = KINDS[kind];
    this.a = from.clone(); this.b = to.clone(); this.dur = dur; this.t = 0;
    this.onArrive = opts.onArrive; this.alive = true;
    const dist = this.a.distanceTo(this.b);
    this.c = this.a.clone().lerp(this.b, 0.5);
    this.c.y += dist * this.k.arc * (opts.arcMul ?? 1);
    if (opts.ctrl) this.c.copy(opts.ctrl);
    if (kind === 'missile') { // launch straight up/out then curve
      this.c.copy(this.a).add(new THREE.Vector3(rand(-6, 6), dist * 0.45, rand(-4, 4)));
    }
    if (kind === 'torpedo') this.c.add(new THREE.Vector3(rand(-8, 8), 0, 0));
    const col = new THREE.Color(...this.k.color);
    this.color = col;
    this.group = new THREE.Group();
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.soft, color: col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    glow.scale.setScalar(this.k.size * 1.6);
    this.group.add(glow);
    const core = new THREE.Mesh(new THREE.CapsuleGeometry(this.k.rad, this.k.len, 4, 8),
      new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.5), toneMapped: false }));
    core.rotation.x = Math.PI / 2; // capsule along z
    const holder = new THREE.Group(); holder.add(core);
    if (kind === 'missile') {
      core.material = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.7, roughness: 0.4 });
      glow.position.z = -this.k.len * 0.8; glow.scale.setScalar(1.4);
      holder.add(glow);
    }
    this.holder = holder;
    this.group.add(holder);
    fx.scene.add(this.group);
    this.prev = this.a.clone();
    this.pos = this.a.clone();
    this.spin = 0;
    this.group.position.copy(this.a);
  }
  point(t, out) {
    const u = 1 - t;
    return out.set(
      u * u * this.a.x + 2 * u * t * this.c.x + t * t * this.b.x,
      u * u * this.a.y + 2 * u * t * this.c.y + t * t * this.b.y,
      u * u * this.a.z + 2 * u * t * this.c.z + t * t * this.b.z);
  }
  update(dt) {
    if (!this.alive) return false;
    this.t += dt / this.dur;
    const tt = Math.min(1, this.t);
    const te = this.kind === 'missile' ? tt * tt * (1.2 - 0.2 * tt) : tt;
    this.prev.copy(this.pos);
    this.point(te, this.pos);
    this.group.position.copy(this.pos);
    const dir = tmp.copy(this.pos).sub(this.prev);
    if (dir.lengthSq() > 1e-6) this.holder.lookAt(tmp.copy(this.pos).add(dir));
    this.trail(dt);
    if (this.t >= 1) {
      this.dispose();
      this.onArrive && this.onArrive(this.b.clone());
      return false;
    }
  }
  trail(dt) {
    const fx = this.fx, col = this.color, p = this.pos;
    switch (this.k.trail) {
      case 'short':
        for (let i = 0; i < 3; i++) fx.add.spawn(tmp.copy(this.prev).lerp(p, i / 3), V(), 0.12, 0.5, 0.1, col, col, 0.8, 0);
        break;
      case 'flame':
        for (let i = 0; i < 4; i++) fx.add.spawn(tmp.copy(this.prev).lerp(p, i / 4), V().randomDirection().multiplyScalar(0.8), rand(0.2, 0.45), this.k.size * 0.7, 0.1, col, COLORS.fireDark, 0.55, 0, 1, 0);
        break;
      case 'streak': {
        const n = 10;
        for (let i = 0; i < n; i++) fx.add.spawn(tmp.copy(this.prev).lerp(p, i / n), V().randomDirection().multiplyScalar(0.15), 0.9, 0.55, 0.05, col, new THREE.Color(0.2, 0.4, 1), 0.9, 0, 0.5, 0);
        break;
      }
      case 'spiral':
        this.spin += dt * 18;
        for (let i = 0; i < 2; i++) {
          const a = this.spin + i * Math.PI;
          const off = V().set(Math.cos(a), Math.sin(a), 0).multiplyScalar(0.7);
          fx.add.spawn(tmp.copy(p).add(off), off.multiplyScalar(0.5), 0.5, 0.45, 0.05, col, new THREE.Color(0.8, 0.2, 2), 1, 0);
        }
        fx.add.spawn(p, V(), 0.3, 1.4, 0.2, col, col, 0.5, 0);
        break;
      case 'smoke':
        fx.add.spawn(p, V(), 0.15, 0.8, 0.1, COLORS.fireHot, COLORS.fire, 1, 0);
        if (Math.random() < 0.8) fx.smoke.spawn(p, V().randomDirection().multiplyScalar(0.3), rand(1.2, 2), 0.4, 1.8, COLORS.smokeLight, COLORS.smoke, 0.4, 0, 1, 0.1);
        break;
    }
  }
  dispose() {
    this.alive = false;
    this.fx.scene.remove(this.group);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
}
