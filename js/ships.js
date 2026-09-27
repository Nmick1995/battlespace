// Procedurally modelled starships. Each ship is built from per-grid-cell "segments" so damage
// is localised to the exact section that was hit, and so the hull can break apart when sunk.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { rand, clamp } from './core.js';
import { COLORS, TEX } from './fx.js';

export const CELL = 4;
export const HOVER = 1.5;

export const SHIP_TYPES = [
  { id: 'carrier', name: 'Carrier', cls: 'LEVIATHAN-CLASS CARRIER', len: 5, weapon: 'missile', weaponName: 'VLS MISSILE SWARM' },
  { id: 'battleship', name: 'Battleship', cls: 'DREADNOUGHT-CLASS BATTLESHIP', len: 4, weapon: 'plasma', weaponName: 'TWIN PLASMA BATTERIES' },
  { id: 'cruiser', name: 'Cruiser', cls: 'VANGUARD-CLASS CRUISER', len: 3, weapon: 'railgun', weaponName: 'SPINAL MAGNETIC RAILGUN' },
  { id: 'frigate', name: 'Stealth Frigate', cls: 'PHANTOM-CLASS STEALTH FRIGATE', len: 3, weapon: 'torpedo', weaponName: 'VOID TORPEDOES' },
  { id: 'destroyer', name: 'Destroyer', cls: 'LANCER-CLASS DESTROYER', len: 2, weapon: 'laser', weaponName: 'PULSE LASER PODS' },
];

export const NAMES = {
  player: { carrier: 'UES Leviathan', battleship: 'UES Indomitable', cruiser: 'UES Vanguard', frigate: 'UES Wraith', destroyer: 'UES Lancer' },
  enemy: { carrier: "Kor'Vath Brood-Mother", battleship: 'Xel Dominion', cruiser: 'Talon of Veyr', frigate: 'Silent Maw', destroyer: 'Ashfang' },
};

// ------------------------------------------------------------------ procedural textures
let TX = null;
function canvas(s) { const c = document.createElement('canvas'); c.width = c.height = s; return [c, c.getContext('2d')]; }

function textures() {
  if (TX) return TX;
  // Hull plating
  const S = 1024;
  const [hc, g] = canvas(S);
  g.fillStyle = '#8c8c8c'; g.fillRect(0, 0, S, S);
  const panel = (x, y, w, h, d) => {
    if (d > 4 || w < 48 || h < 48 || (d > 1 && Math.random() < 0.18)) {
      const v = Math.round(150 + rand(-26, 22));
      g.fillStyle = `rgb(${v},${v},${v + 2})`; g.fillRect(x + 1, y + 1, w - 2, h - 2);
      g.strokeStyle = 'rgba(15,15,18,0.95)'; g.lineWidth = 2.5; g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
      g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x + 3, y + h - 3); g.lineTo(x + 3, y + 3); g.lineTo(x + w - 3, y + 3); g.stroke();
      if (Math.random() < 0.5) { // rivets
        g.fillStyle = 'rgba(40,40,45,0.8)';
        for (let i = 6; i < w - 6; i += 12) { g.fillRect(x + i, y + 5, 2, 2); g.fillRect(x + i, y + h - 7, 2, 2); }
      }
      if (Math.random() < 0.35) { // greeble
        const gw = rand(8, w * 0.5), gh = rand(6, h * 0.4);
        g.fillStyle = `rgba(${Math.random() < 0.5 ? '30,30,34' : '200,200,205'},0.35)`;
        g.fillRect(x + rand(6, w - gw - 6), y + rand(6, h - gh - 6), gw, gh);
      }
      if (Math.random() < 0.08) { // hazard stripes
        g.save(); g.beginPath(); g.rect(x + 6, y + h - 16, w - 12, 10); g.clip();
        for (let i = -20; i < w; i += 14) { g.fillStyle = 'rgba(220,190,60,0.55)'; g.beginPath(); g.moveTo(x + i, y + h); g.lineTo(x + i + 7, y + h); g.lineTo(x + i + 17, y + h - 20); g.lineTo(x + i + 10, y + h - 20); g.fill(); }
        g.restore();
      }
      return;
    }
    if (Math.random() < 0.5) { const f = rand(0.3, 0.7); panel(x, y, w * f, h, d + 1); panel(x + w * f, y, w * (1 - f), h, d + 1); }
    else { const f = rand(0.3, 0.7); panel(x, y, w, h * f, d + 1); panel(x, y + h * f, w, h * (1 - f), d + 1); }
  };
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) panel(i * 256, j * 256, 256, 256, 0);
  const id = g.getImageData(0, 0, S, S);
  for (let i = 0; i < id.data.length; i += 4) { const n = (Math.random() - 0.5) * 14; id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n; }
  g.putImageData(id, 0, 0);
  for (let i = 0; i < 120; i++) { // grime streaks
    g.fillStyle = `rgba(20,18,16,${rand(0.03, 0.08)})`;
    g.fillRect(rand(0, S), rand(0, S), rand(2, 6), rand(30, 160));
  }
  const hull = new THREE.CanvasTexture(hc);
  hull.wrapS = hull.wrapT = THREE.RepeatWrapping; hull.colorSpace = THREE.SRGBColorSpace; hull.anisotropy = 8;

  // Window lights (emissive)
  const [wc, w] = canvas(512);
  w.fillStyle = '#000'; w.fillRect(0, 0, 512, 512);
  for (let row = 0; row < 26; row++) {
    if (Math.random() < 0.55) continue;
    const y = row * 20 + 6;
    let x = rand(0, 60);
    while (x < 500) {
      const run = Math.floor(rand(2, 9));
      for (let k = 0; k < run && x < 506; k++) {
        if (Math.random() < 0.8) { const b = rand(120, 255); w.fillStyle = `rgb(${b},${b},${b})`; w.fillRect(x, y, 4, 3); }
        x += 7;
      }
      x += rand(20, 90);
    }
  }
  const win = new THREE.CanvasTexture(wc);
  win.wrapS = win.wrapT = THREE.RepeatWrapping; win.colorSpace = THREE.SRGBColorSpace;

  // Burn / breach damage (emissive glowing cracks)
  const [bc, bg] = canvas(512);
  bg.fillStyle = '#000'; bg.fillRect(0, 0, 512, 512);
  bg.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    let x = rand(0, 512), y = rand(0, 512), a = rand(0, 6.28);
    const n = Math.floor(rand(6, 22));
    bg.strokeStyle = `rgba(255,${Math.floor(rand(90, 200))},40,${rand(0.5, 1)})`;
    bg.lineWidth = rand(0.8, 3);
    bg.shadowColor = '#ff5500'; bg.shadowBlur = 8;
    bg.beginPath(); bg.moveTo(x, y);
    for (let k = 0; k < n; k++) { a += rand(-0.9, 0.9); x += Math.cos(a) * rand(4, 14); y += Math.sin(a) * rand(4, 14); bg.lineTo(x, y); }
    bg.stroke();
  }
  for (let i = 0; i < 25; i++) {
    const x = rand(0, 512), y = rand(0, 512), r = rand(10, 40);
    const grd = bg.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,120,30,0.5)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    bg.fillStyle = grd; bg.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const burn = new THREE.CanvasTexture(bc);
  burn.wrapS = burn.wrapT = THREE.RepeatWrapping; burn.colorSpace = THREE.SRGBColorSpace;

  TX = { hull, win, burn };
  return TX;
}

// Box-projected UVs so panel textures have consistent scale on every part.
function projectUV(geo, scale = 0.3) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  for (let i = 0; i < n.count; i++) if (!Number.isFinite(n.getX(i) + n.getY(i) + n.getZ(i)) || n.getX(i) ** 2 + n.getY(i) ** 2 + n.getZ(i) ** 2 < 0.5) n.setXYZ(i, 0, 1, 0);
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ax >= ay && ax >= az) { u = p.getZ(i); v = p.getY(i); }
    else if (ay >= az) { u = p.getX(i); v = p.getZ(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u * scale; uv[i * 2 + 1] = v * scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

const flameShader = (color) => new THREE.ShaderMaterial({
  uniforms: { time: { value: 0 }, color: { value: color }, power: { value: 1 } },
  vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    void main(){ vUv = uv; vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
  fragmentShader: `uniform float time; uniform vec3 color; uniform float power; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    void main(){
      float along = 1.0 - vUv.y;            // 1 at nozzle, 0 at tip
      float flick = 0.85 + 0.15*sin(time*40.0 + vUv.y*30.0);
      float rim = pow(abs(dot(vN, vV)), 1.5);
      float a = pow(along, 2.2) * rim * flick * power;
      vec3 c = mix(color, vec3(3.0), pow(along, 6.0));
      gl_FragColor = vec4(c * a, a);
    }`,
  transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
});

const MATS = {};
function factionMats(f) {
  if (MATS[f]) return MATS[f];
  const P = f === 'player';
  const tx = textures();
  const glowCol = P ? new THREE.Color(0.5, 1.6, 4) : new THREE.Color(4, 0.8, 0.3);
  MATS[f] = {
    hull: new THREE.MeshStandardMaterial({ color: P ? 0xd2dbe4 : 0x9a7c80, map: tx.hull, bumpMap: tx.hull, bumpScale: 0.9, metalness: 0.7, roughness: 0.42, emissive: P ? 0xbfe8ff : 0xffa080, emissiveMap: tx.win, emissiveIntensity: 1.6 }),
    dark: new THREE.MeshStandardMaterial({ color: P ? 0x68717c : 0x51404a, map: tx.hull, bumpMap: tx.hull, bumpScale: 0.6, metalness: 0.85, roughness: 0.32 }),
    stealth: new THREE.MeshStandardMaterial({ color: P ? 0x4a5462 : 0x3e2d35, map: tx.hull, metalness: 0.45, roughness: 0.62, emissive: P ? 0x70c8ff : 0xff6040, emissiveMap: tx.win, emissiveIntensity: 0.6 }),
    accent: new THREE.MeshStandardMaterial({ color: P ? 0x2f8cff : 0xd4203a, metalness: 0.45, roughness: 0.35, emissive: P ? 0x0c4aa0 : 0x600014, emissiveIntensity: 0.7 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0b1622, metalness: 1, roughness: 0.06, emissive: P ? 0x3a90ff : 0xff4028, emissiveIntensity: 0.45 }),
    glow: new THREE.MeshBasicMaterial({ color: glowCol, toneMapped: false }),
    strip: new THREE.MeshBasicMaterial({ color: P ? new THREE.Color(0.3, 1.2, 2.2) : new THREE.Color(2.2, 0.35, 0.2), toneMapped: false }),
    flame: flameShader(glowCol),
    glowColor: glowCol,
    weaponGlow: P ? new THREE.Color(0.6, 3, 5) : new THREE.Color(5, 0.8, 0.5),
  };
  return MATS[f];
}

// ------------------------------------------------------------------ builder
class Builder {
  constructor(type, faction) {
    this.type = type; this.len = type.len; this.L = this.len * CELL - 0.7; this.faction = faction;
    this.m = factionMats(faction);
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.segs = [];
    for (let i = 0; i < this.len; i++) {
      const g = new THREE.Group(); g.position.x = this.segCenter(i);
      g.userData = { index: i, loose: [], guns: [], engines: [] };
      this.body.add(g); this.segs.push(g);
    }
    this.guns = []; this.engines = []; this.blinkers = []; this.spinners = [];
  }
  X(u) { return -this.L / 2 + u * this.L; }
  segCenter(i) { return -this.len * CELL / 2 + CELL * (i + 0.5); }
  segOf(x) { return clamp(Math.floor((x + this.len * CELL / 2) / CELL), 0, this.len - 1); }
  put(obj, x, y, z, seg) {
    const s = seg ?? this.segOf(x);
    obj.position.set(x - this.segCenter(s), y, z);
    this.segs[s].add(obj);
    return obj;
  }
  mesh(geo, mat, loose = false) {
    if (mat.map) projectUV(geo);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true; m.receiveShadow = true;
    m.userData.loose = loose;
    return m;
  }
  box(w, h, d, mat, x, y, z, { r = 0.06, loose = false, seg, rot } = {}) {
    const geo = r > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)) : new THREE.BoxGeometry(w, h, d);
    const m = this.mesh(geo, mat, loose);
    if (rot) m.rotation.set(...rot);
    this.put(m, x, y, z, seg);
    if (loose) this.segs[seg ?? this.segOf(x)].userData.loose.push(m);
    return m;
  }
  cyl(rt, rb, h, mat, x, y, z, { axis = 'y', seg, n = 18, loose = false, open = false } = {}) {
    const geo = new THREE.CylinderGeometry(rt, rb, h, n, 1, open);
    if (axis === 'x') geo.rotateZ(-Math.PI / 2);
    if (axis === 'z') geo.rotateX(Math.PI / 2);
    const m = this.mesh(geo, mat, loose);
    this.put(m, x, y, z, seg);
    if (loose) this.segs[seg ?? this.segOf(x)].userData.loose.push(m);
    return m;
  }
  // A hull layer defined by a half-width profile along the ship, sliced per segment.
  layer(mat, y, h, wFn, u0 = 0, u1 = 1, bevel = 0.1, zOff = 0) {
    for (let i = 0; i < this.len; i++) {
      const s0 = this.segCenter(i) - CELL / 2, s1 = s0 + CELL;
      const x0 = Math.max(this.X(u0), s0 - 0.01), x1 = Math.min(this.X(u1), s1 + 0.01);
      if (x1 - x0 < 0.05) continue;
      const N = 8, pts = [];
      const cx = this.segCenter(i);
      for (let k = 0; k <= N; k++) { const x = x0 + (x1 - x0) * k / N; pts.push(new THREE.Vector2(x - cx, Math.max(0.04, wFn((x + this.L / 2) / this.L)))); }
      for (let k = N; k >= 0; k--) { const x = x0 + (x1 - x0) * k / N; pts.push(new THREE.Vector2(x - cx, -Math.max(0.04, wFn((x + this.L / 2) / this.L)))); }
      const shape = new THREE.Shape(pts);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
      geo.rotateX(-Math.PI / 2);
      const m = this.mesh(geo, mat);
      m.position.set(0, y, zOff);
      this.segs[i].add(m);
    }
  }
  // Flat extruded plate from a 2D outline in the XZ plane (x along ship, y of outline = z)
  plate(mat, outline, y, thick, { seg, bevel = 0.04, vertical = false } = {}) {
    const shape = new THREE.Shape(outline.map(([a, b]) => new THREE.Vector2(a, b)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1 });
    if (vertical) geo.translate(0, 0, -thick / 2); else { geo.rotateX(-Math.PI / 2); }
    const cx = outline.reduce((s, p) => s + p[0], 0) / outline.length;
    const si = seg ?? this.segOf(cx);
    geo.translate(-this.segCenter(si), 0, 0);
    const m = this.mesh(geo, mat);
    m.position.y = y;
    this.segs[si].add(m);
    return m;
  }
  strip(w, h, d, x, y, z, seg) { const m = this.box(w, h, d, this.m.strip, x, y, z, { r: 0, seg }); m.castShadow = false; m.userData.strip = true; return m; }
  engine(x, y, z, r, seg) {
    const g = new THREE.Group();
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.3, r, r * 1.3, 20, 1, true).rotateZ(Math.PI / 2), this.m.dark);
    nozzle.material = this.m.dark; nozzle.castShadow = true;
    const collar = new THREE.Mesh(projectUV(new THREE.CylinderGeometry(r * 1.15, r * 1.15, r * 0.9, 20).rotateZ(Math.PI / 2)), this.m.hull);
    collar.position.x = r * 0.9; collar.castShadow = true;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r * 1.05, 20).rotateY(-Math.PI / 2), this.m.glow);
    disc.position.x = -r * 0.2; disc.userData.engineGlow = true;
    const flame = new THREE.Mesh(new THREE.ConeGeometry(r * 0.95, r * 6, 20, 1, true).rotateZ(Math.PI / 2), this.m.flame);
    flame.position.x = -r * 0.6 - r * 3; flame.userData.fx = true;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.soft, color: this.m.glowColor, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 }));
    halo.position.x = -r * 0.9; halo.scale.setScalar(r * 3.2); halo.userData.fx = true;
    g.add(nozzle, collar, disc, flame, halo);
    const s = seg ?? this.segOf(x);
    this.put(g, x, y, z, s);
    const e = { g, disc, flame, halo, r, seg: s, alive: true, phase: Math.random() * 10 };
    this.engines.push(e); this.segs[s].userData.engines.push(e);
    return e;
  }
  turret(x, y, z, { s = 1, barrels = 2, blen = 2, facing = 1, seg, mat } = {}) {
    const yaw = new THREE.Group();
    const base = this.mesh(new THREE.CylinderGeometry(0.55 * s, 0.68 * s, 0.26 * s, 20), this.m.dark);
    base.position.y = 0.1 * s;
    const house = this.mesh(new RoundedBoxGeometry(1.25 * s, 0.46 * s, 0.98 * s, 2, 0.1 * s), mat || this.m.hull);
    house.position.set(-0.12 * s, 0.42 * s, 0);
    const pitch = new THREE.Group(); pitch.position.set(0.38 * s, 0.42 * s, 0);
    const muzzles = [];
    for (let i = 0; i < barrels; i++) {
      const zz = barrels === 1 ? 0 : (i / (barrels - 1) - 0.5) * 0.5 * s;
      const barrel = this.mesh(new THREE.CylinderGeometry(0.065 * s, 0.095 * s, blen * s, 12).rotateZ(-Math.PI / 2), this.m.dark);
      barrel.position.set(blen * s / 2, 0, zz);
      const brake = this.mesh(new THREE.CylinderGeometry(0.12 * s, 0.12 * s, 0.3 * s, 12).rotateZ(-Math.PI / 2), this.m.dark);
      brake.position.set(blen * s - 0.1 * s, 0, zz);
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * s, 0.1 * s, 0.06 * s, 12).rotateZ(-Math.PI / 2), this.m.strip);
      ring.position.set(blen * s * 0.4, 0, zz);
      const mz = new THREE.Object3D(); mz.position.set(blen * s + 0.1, 0, zz);
      pitch.add(barrel, brake, ring, mz); muzzles.push(mz);
    }
    yaw.add(base, house, pitch);
    const restYaw = facing > 0 ? 0 : Math.PI;
    yaw.rotation.y = restYaw;
    const si = seg ?? this.segOf(x);
    this.put(yaw, x, y, z, si);
    const gun = { yaw, pitch, muzzles, seg: si, restYaw, targetYaw: restYaw, targetPitch: 0, fixed: false, disabled: false };
    this.guns.push(gun); this.segs[si].userData.guns.push(gun);
    return gun;
  }
  fixedGun(muzzles, seg) {
    const gun = { muzzles, seg, fixed: true, disabled: false };
    this.guns.push(gun); this.segs[seg].userData.guns.push(gun);
    return gun;
  }
  muzzle(x, y, z, seg) { const o = new THREE.Object3D(); this.put(o, x, y, z, seg); return o; }
  blinker(x, y, z, color, seg) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.soft, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.scale.setScalar(0.6); s.userData.fx = true;
    this.put(s, x, y, z, seg);
    this.blinkers.push({ s, phase: Math.random() * 3 });
    return s;
  }
}

// ------------------------------------------------------------------ ship designs
const DESIGNS = {
  destroyer(b) {
    const { hull, dark, accent, glass } = b.m;
    b.layer(hull, -0.45, 0.42, (u) => 0.14 + 0.86 * Math.pow(1 - u, 0.9));
    b.layer(accent, -0.56, 0.1, (u) => 0.2 + 0.9 * Math.pow(1 - u, 0.9), 0, 0.97, 0.03);
    b.layer(dark, -0.02, 0.28, (u) => 0.1 + 0.5 * Math.pow(1 - u, 0.8), 0.04, 0.86, 0.08);
    const can = b.mesh(new THREE.SphereGeometry(1, 24, 12), glass);
    can.scale.set(1.1, 0.3, 0.32); b.put(can, b.X(0.6), 0.32, 0);
    for (const side of [-1, 1]) {
      const x0 = b.X(0.12), c = 2.4, sw = 1.2, span = 1.35, w0 = 0.7;
      b.plate(dark, [[x0, side * w0], [x0 + c, side * w0], [x0 + c - sw, side * (w0 + span)], [x0 - 0.2, side * (w0 + span)]].map(([a, z]) => [a, -z]), -0.28, 0.1, { seg: 0 });
      b.box(1.6, 0.05, 0.12, accent, x0 + 0.6, -0.15, side * (w0 + span * 0.6), { r: 0, seg: 0 });
      const pz = side * (w0 + span + 0.05);
      b.cyl(0.18, 0.2, 2.6, hull, b.X(0.3), -0.22, pz, { axis: 'x', seg: 0 });
      b.cyl(0.06, 0.07, 1.0, dark, b.X(0.3) + 1.7, -0.22, pz, { axis: 'x', seg: 0 });
      const ring = b.cyl(0.11, 0.11, 0.12, b.m.strip, b.X(0.3) + 1.4, -0.22, pz, { axis: 'x', seg: 0 }); ring.castShadow = false;
      side < 0 ? (b._mL = b.muzzle(b.X(0.3) + 2.3, -0.22, pz, 0)) : (b._mR = b.muzzle(b.X(0.3) + 2.3, -0.22, pz, 0));
      b.blinker(x0 - 0.1, -0.2, side * (w0 + span + 0.3), side < 0 ? new THREE.Color(5, 0.3, 0.3) : new THREE.Color(0.3, 5, 0.5), 0);
      b.engine(b.X(0) + 0.3, -0.2, side * 0.42, 0.27, 0);
    }
    b.fixedGun([b._mL, b._mR], 0);
    b.plate(accent, [[b.X(0.05), 0], [b.X(0.35), 0], [b.X(0.12), 0.85], [b.X(0.02), 0.85]], 0, 0.06, { seg: 0, vertical: true });
    b.strip(2.2, 0.04, 0.05, b.X(0.45), 0.27, 0.25); b.strip(2.2, 0.04, 0.05, b.X(0.45), 0.27, -0.25);
    b.box(0.5, 0.18, 0.3, dark, b.X(0.78), 0.1, 0, { loose: true });
    b.box(0.4, 0.14, 0.4, dark, b.X(0.2), 0.3, 0, { loose: true });
  },

  frigate(b) {
    const { stealth, dark, accent, glass } = b.m;
    const w = (u) => 0.15 + 1.45 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + u * 0.95)), 0.75);
    b.layer(stealth, -0.4, 0.34, w, 0, 1, 0.06);
    b.layer(dark, -0.52, 0.1, (u) => w(u) * 0.8, 0.03, 0.97, 0.02);
    b.layer(stealth, -0.02, 0.22, (u) => w(u) * 0.62, 0.06, 0.92, 0.1);
    b.layer(stealth, 0.26, 0.16, (u) => w(u) * 0.3, 0.2, 0.78, 0.08);
    // faceted cockpit
    const cp = b.mesh(new THREE.OctahedronGeometry(1, 0), glass);
    cp.scale.set(1.0, 0.25, 0.35); b.put(cp, b.X(0.7), 0.3, 0);
    // dorsal fin + ventral fin
    b.plate(dark, [[b.X(0.12), 0], [b.X(0.4), 0], [b.X(0.2), 1.1], [b.X(0.1), 1.1]], 0.35, 0.08, { vertical: true });
    b.plate(dark, [[b.X(0.15), 0], [b.X(0.35), 0], [b.X(0.2), -0.7], [b.X(0.12), -0.7]], -0.45, 0.06, { vertical: true });
    // edge light strips
    for (let i = 0; i < 12; i++) {
      const u = 0.08 + i * 0.07, x = b.X(u);
      for (const side of [-1, 1]) b.strip(0.5, 0.03, 0.04, x, -0.1, side * (w(u) + 0.06));
    }
    // torpedo tubes
    const muz = [];
    for (const side of [-1, 1]) {
      const z = side * 0.42;
      b.cyl(0.2, 0.22, 1.8, dark, b.X(0.8), -0.15, z, { axis: 'x' });
      const ring = b.cyl(0.17, 0.17, 0.05, b.m.strip, b.X(0.8) + 0.92, -0.15, z, { axis: 'x' }); ring.castShadow = false;
      muz.push(b.muzzle(b.X(0.8) + 1.1, -0.15, z));
    }
    b.fixedGun(muz, b.segOf(b.X(0.8)));
    // wide flat engine
    b.box(0.6, 0.45, 1.9, dark, b.X(0) + 0.6, -0.1, 0, { r: 0.1, seg: 0 });
    for (const z of [-0.55, 0, 0.55]) b.engine(b.X(0) + 0.3, -0.1, z, 0.22, 0);
    b.engine(b.X(0.05) + 0.3, -0.1, 0.95, 0.18, 0); b.engine(b.X(0.05) + 0.3, -0.1, -0.95, 0.18, 0);
    // sensor greebles
    b.box(0.6, 0.12, 0.5, dark, b.X(0.45), 0.43, 0, { loose: true });
    b.box(0.3, 0.1, 0.3, accent, b.X(0.3), 0.43, 0.3, { loose: true });
    b.blinker(b.X(0.5), -0.1, 1.55, new THREE.Color(0.3, 5, 0.5)); b.blinker(b.X(0.5), -0.1, -1.55, new THREE.Color(5, 0.3, 0.3));
  },

  cruiser(b) {
    const { hull, dark, accent, glass } = b.m;
    const w = (u) => (u < 0.72 ? 1.15 : 1.15 - 0.8 * Math.pow((u - 0.72) / 0.28, 1.2)) * (u < 0.05 ? 0.85 + u * 3 : 1);
    b.layer(hull, -0.6, 0.55, w, 0, 1, 0.1);
    b.layer(accent, -0.7, 0.1, (u) => w(u) + 0.06, 0.01, 0.98, 0.02);
    b.layer(dark, -0.05, 0.35, (u) => w(u) * 0.62, 0.05, 0.85, 0.08);
    // spinal railgun (split into segment pieces)
    const rx0 = b.X(0.12), rx1 = b.X(1.0) + 0.6;
    for (let i = 0; i < b.len; i++) {
      const s0 = Math.max(rx0, b.segCenter(i) - CELL / 2), s1 = Math.min(rx1, b.segCenter(i) + CELL / 2);
      if (s1 - s0 < 0.1) continue;
      for (const z of [-0.26, 0.26]) b.box(s1 - s0, 0.22, 0.14, dark, (s0 + s1) / 2, 0.62, z, { seg: i, r: 0.03 });
      b.box(s1 - s0, 0.1, 0.26, hull, (s0 + s1) / 2, 0.48, 0, { seg: i, r: 0.02 });
    }
    for (let x = rx0 + 0.6; x < rx1 - 0.4; x += 1.1) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.035, 8, 20).rotateY(Math.PI / 2), b.m.dark);
      const t2 = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.012, 6, 20).rotateY(Math.PI / 2), b.m.strip); b.put(t2, x + 0.06, 0.62, 0);
      b.put(t, x, 0.62, 0);
    }
    const rm = b.muzzle(rx1 + 0.2, 0.62, 0, b.len - 1);
    b.fixedGun([rm], b.len - 1);
    // bridge
    b.box(1.3, 0.45, 0.9, hull, b.X(0.22), 0.55, 0.0, { r: 0.1 });
    b.box(0.9, 0.12, 0.92, glass, b.X(0.22) + 0.2, 0.7, 0, { r: 0.04 });
    // sponsons with point-defense turrets
    for (const side of [-1, 1]) {
      b.box(1.8, 0.4, 0.5, dark, b.X(0.45), -0.3, side * 1.3, { r: 0.1 });
      b.turret(b.X(0.45), -0.1, side * 1.3, { s: 0.45, barrels: 1, blen: 1.6 });
      b.strip(1.6, 0.04, 0.04, b.X(0.45), -0.25, side * 1.57);
      b.box(0.12, 0.6, 0.9, dark, b.X(0.06), 0.2, side * 0.5, { r: 0.02, loose: true });
    }
    for (const z of [-0.62, 0, 0.62]) b.engine(b.X(0) + 0.3, -0.3, z, 0.3, 0);
    b.box(0.5, 0.2, 0.4, dark, b.X(0.6), 0.1, 0.8, { loose: true });
    b.box(0.4, 0.2, 0.3, dark, b.X(0.5), 0.1, -0.75, { loose: true });
    b.blinker(b.X(0.45), -0.3, 1.65, new THREE.Color(0.3, 5, 0.5)); b.blinker(b.X(0.45), -0.3, -1.65, new THREE.Color(5, 0.3, 0.3));
  },

  battleship(b) {
    const { hull, dark, accent, glass } = b.m;
    const w1 = (u) => 1.8 - 1.25 * Math.pow(u, 2.3);
    b.layer(hull, -0.85, 0.66, w1, 0, 1, 0.12);
    b.layer(accent, -0.95, 0.1, (u) => w1(u) + 0.07, 0.01, 0.99, 0.02);
    b.layer(dark, -0.22, 0.42, (u) => 1.45 - 1.0 * Math.pow(u, 2), 0.02, 0.96, 0.1);
    b.layer(hull, 0.18, 0.28, (u) => 0.95 - 0.5 * Math.pow(u, 2), 0.05, 0.9, 0.08);
    // keel
    b.plate(dark, [[b.X(0.1), 0], [b.X(0.7), 0], [b.X(0.55), -0.6], [b.X(0.2), -0.6]], -0.85, 0.2, { vertical: true, seg: 1 });
    // superstructure tower
    const tx = b.X(0.3);
    b.box(2.4, 0.55, 1.3, hull, tx, 0.72, 0, { r: 0.1 });
    b.box(1.7, 0.5, 1.0, dark, tx - 0.1, 1.2, 0, { r: 0.08 });
    b.box(1.1, 0.34, 1.25, hull, tx + 0.1, 1.6, 0, { r: 0.08 });
    b.box(0.2, 0.1, 1.27, glass, tx + 0.62, 1.62, 0, { r: 0.02 });
    b.strip(0.05, 0.05, 1.1, tx + 0.72, 1.62, 0);
    b.cyl(0.03, 0.05, 1.3, dark, tx - 0.3, 2.3, 0.3, { loose: true });
    b.cyl(0.03, 0.05, 0.9, dark, tx - 0.1, 2.1, -0.35, { loose: true });
    const dish = b.cyl(0.4, 0.1, 0.12, dark, tx - 0.4, 1.9, -0.1, { loose: true });
    b.spinners.push(dish);
    // main turrets
    b.turret(b.X(0.52), 0.46, 0, { s: 1.05, barrels: 2, blen: 2.3 });
    b.turret(b.X(0.73), 0.46, 0, { s: 0.95, barrels: 2, blen: 2.1 });
    b.turret(b.X(0.1), 0.46, 0, { s: 0.95, barrels: 2, blen: 2.1, facing: -1 });
    // broadside secondary batteries
    for (const side of [-1, 1]) {
      for (const u of [0.25, 0.45, 0.62]) b.box(0.7, 0.28, 0.25, dark, b.X(u), -0.05, side * (1.45 - u * u), { r: 0.05 });
      b.strip(5.5, 0.05, 0.04, b.X(0.4), -0.45, side * 1.72);
      b.blinker(b.X(0.02), -0.3, side * 1.9, side < 0 ? new THREE.Color(5, 0.3, 0.3) : new THREE.Color(0.3, 5, 0.5), 0);
    }
    for (const [y, z] of [[-0.55, -0.9], [-0.55, 0.9], [0.05, -0.55], [0.05, 0.55]]) b.engine(b.X(0) + 0.35, y, z, 0.36, 0);
    b.box(0.5, 0.25, 0.5, dark, b.X(0.85), 0.25, 0.4, { loose: true });
    b.box(0.6, 0.2, 0.4, dark, b.X(0.62), 0.3, -0.7, { loose: true });
  },

  carrier(b) {
    const { hull, dark, accent, glass } = b.m;
    const w = (u) => (u > 0.86 ? 1.9 - 0.9 * Math.pow((u - 0.86) / 0.14, 1.5) : 1.9) * (u < 0.04 ? 0.85 + u * 3.5 : 1);
    b.layer(hull, -1.0, 0.75, w, 0, 1, 0.12);
    b.layer(accent, -1.1, 0.1, (u) => w(u) + 0.06, 0.01, 0.99, 0.02);
    b.layer(dark, -0.14, 0.14, (u) => Math.min(1.6, w(u) - 0.25), 0.02, 0.97, 0.03);
    b.layer(dark, -1.5, 0.4, (u) => w(u) * 0.62, 0.04, 0.9, 0.1);
    for (const side of [-1, 1]) for (let x = b.X(0.1); x < b.X(0.9); x += 1.6) b.box(0.9, 0.18, 0.3, dark, x, 0.05, side * 1.72, { r: 0.04 });
    // runway lights & markings
    for (let x = b.X(0.06); x < b.X(0.95); x += 1.2) {
      b.strip(0.12, 0.02, 0.04, x, 0.02, 0.45); b.strip(0.12, 0.02, 0.04, x, 0.02, -0.45);
    }
    for (let x = b.X(0.1); x < b.X(0.9); x += 1.4) b.box(0.6, 0.02, 0.07, accent, x, 0.02, 0, { r: 0 });
    // hangar side pods
    for (const side of [-1, 1]) {
      for (let i = 0; i < b.len; i++) {
        const s0 = Math.max(b.X(0.12), b.segCenter(i) - CELL / 2), s1 = Math.min(b.X(0.8), b.segCenter(i) + CELL / 2);
        if (s1 - s0 < 0.2) continue;
        b.box(s1 - s0 - 0.05, 0.6, 0.45, dark, (s0 + s1) / 2, -0.55, side * 2.0, { seg: i, r: 0.08 });
        b.strip(s1 - s0 - 0.4, 0.03, 0.02, (s0 + s1) / 2, -0.4, side * 2.23, i);
      }
      b.blinker(b.X(0.5), -0.2, side * 2.35, side < 0 ? new THREE.Color(5, 0.3, 0.3) : new THREE.Color(0.3, 5, 0.5));
    }
    // bow hangar mouth
    const mouth = b.box(0.05, 0.45, 1.2, b.m.strip, b.X(1) - 0.05, -0.6, 0, { r: 0 }); mouth.castShadow = false;
    // island
    const ix = b.X(0.45), iz = -1.2;
    b.box(2.2, 0.7, 0.7, hull, ix, 0.4, iz, { r: 0.1 });
    b.box(1.4, 0.55, 0.6, dark, ix + 0.2, 0.95, iz, { r: 0.08 });
    b.box(0.9, 0.3, 0.62, glass, ix + 0.3, 1.32, iz, { r: 0.04 });
    const dish = b.cyl(0.45, 0.12, 0.1, dark, ix - 0.5, 1.45, iz, { loose: true }); b.spinners.push(dish);
    b.cyl(0.03, 0.04, 1.2, dark, ix + 0.1, 1.9, iz, { loose: true });
    // VLS missile pods (fixed launchers)
    const muz = [];
    for (const u of [0.22, 0.68]) {
      const px = b.X(u), pz = 1.15;
      b.box(1.4, 0.35, 0.8, dark, px, 0.12, pz, { r: 0.06 });
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
        const cx = px - 0.45 + i * 0.3, cz = pz - 0.18 + j * 0.36;
        const cap = b.box(0.2, 0.05, 0.22, j ? accent : hull, cx, 0.31, cz, { r: 0 });
        muz.push(b.muzzle(cx, 0.4, cz));
      }
    }
    b.fixedGun(muz.filter((_, i) => i < 8), b.segOf(b.X(0.22)));
    b.fixedGun(muz.filter((_, i) => i >= 8), b.segOf(b.X(0.68)));
    // parked fighters (loose — they get blown off when hit)
    const fGeo = new THREE.ConeGeometry(0.22, 0.6, 3).rotateZ(-Math.PI / 2);
    for (const u of [0.35, 0.58, 0.8]) for (const z of [0.1, 0.7]) {
      const f = b.mesh(fGeo.clone(), accent, true); f.scale.set(1, 0.4, 1);
      b.put(f, b.X(u), 0.08, z); b.segs[b.segOf(b.X(u))].userData.loose.push(f);
    }
    b.turret(b.X(0.9), -0.1, -1.1, { s: 0.4, barrels: 2, blen: 1.4 });
    b.turret(b.X(0.08), 0.02, -1.0, { s: 0.4, barrels: 2, blen: 1.4, facing: -1 });
    for (const [y, z] of [[-0.6, -1.2], [-0.6, -0.4], [-0.6, 0.4], [-0.6, 1.2]]) b.engine(b.X(0) + 0.4, y, z, 0.38, 0);
    b.engine(b.X(0.12), -0.55, 2.0, 0.22, 0); b.engine(b.X(0.12), -0.55, -2.0, 0.22, 0);
  },
};

// ------------------------------------------------------------------ runtime ship
const up = new THREE.Vector3(0, 1, 0);
const tv = new THREE.Vector3();

export class Ship {
  constructor(type, faction, fx) {
    this.type = type; this.faction = faction; this.fx = fx;
    this.name = NAMES[faction][type.id];
    const b = new Builder(type, faction);
    DESIGNS[type.id](b);
    this.root = b.root; this.body = b.body; this.segs = b.segs;
    this.guns = b.guns; this.engines = b.engines; this.blinkers = b.blinkers; this.spinners = b.spinners;
    this.len = type.len;
    this.hits = new Set();
    this.sunk = false;
    this.cells = [];
    this.phase = Math.random() * 10;
    this.list = new THREE.Vector3();
    this.emitters = [];
    this.opacity = 1;
    // clone materials per segment so damage stays local
    for (const seg of this.segs) {
      const map = new Map();
      seg.userData.mats = [];
      seg.traverse((o) => {
        if (!o.isMesh || o.userData.fx) return;
        if (!map.has(o.material)) { const c = o.material.clone(); map.set(o.material, c); seg.userData.mats.push(c); }
        o.material = map.get(o.material);
      });
    }
  }

  get hp() { return this.len - this.hits.size; }

  place(cells, gridToWorld) {
    this.cells = cells;
    const a = gridToWorld(cells[0].r, cells[0].c), z = gridToWorld(cells[cells.length - 1].r, cells[cells.length - 1].c);
    this.root.position.set((a.x + z.x) / 2, HOVER, (a.z + z.z) / 2);
    this.root.rotation.y = cells.length > 1 ? Math.atan2(-(z.z - a.z), z.x - a.x) : 0;
    this.root.updateMatrixWorld(true);
  }

  segWorld(i, out = new THREE.Vector3()) { return this.segs[i].getWorldPosition(out); }

  update(dt, t) {
    if (!this.root.visible || this.sunk) return;
    this.body.position.y = Math.sin(t * 0.7 + this.phase) * 0.12;
    this.body.rotation.x = Math.sin(t * 0.5 + this.phase) * 0.012 + this.list.x;
    this.body.rotation.z = Math.sin(t * 0.43 + this.phase * 2) * 0.01 + this.list.z;
    for (const e of this.engines) {
      const f = e.alive ? 1 : (Math.random() < 0.08 ? 0.5 : 0);
      e.flame.scale.x = f * (0.9 + 0.12 * Math.sin(t * 30 + e.phase) + 0.05 * Math.random());
      e.halo.material.opacity = 0.35 * f;
      e.flame.visible = f > 0;
    }
    for (const bl of this.blinkers) bl.s.material.opacity = ((t + bl.phase) % 1.6) < 0.12 ? 1 : 0.05;
    for (const s of this.spinners) s.rotation.y += dt * 1.5;
    for (const g of this.guns) {
      if (g.fixed || g.disabled) continue;
      g.yaw.rotation.y += angDiff(g.targetYaw, g.yaw.rotation.y) * Math.min(1, dt * 3);
      g.pitch.rotation.z += (g.targetPitch - g.pitch.rotation.z) * Math.min(1, dt * 3);
    }
    factionMats(this.faction).flame.uniforms.time.value = t;
  }

  aimAt(target) {
    for (const g of this.guns) {
      if (g.fixed || g.disabled) continue;
      const local = g.yaw.parent.worldToLocal(tv.copy(target));
      local.sub(g.yaw.position);
      g.targetYaw = Math.atan2(-local.z, local.x);
      g.targetPitch = clamp(Math.atan2(local.y, Math.hypot(local.x, local.z)) + 0.08, -0.1, 0.35);
    }
  }
  resetAim() { for (const g of this.guns) if (!g.fixed && !g.disabled) { g.targetYaw = g.restYaw; g.targetPitch = 0; } }

  // world-space muzzle positions/directions of working guns (falls back to any gun)
  muzzles() {
    let guns = this.guns.filter((g) => !g.disabled);
    if (!guns.length) guns = this.guns;
    // prefer the main weapon system (fixed weapons are the signature weapons except on the battleship)
    const main = this.type.id === 'battleship' ? guns.filter((g) => !g.fixed) : guns.filter((g) => g.fixed);
    if (main.length) guns = main;
    const out = [];
    this.root.updateMatrixWorld(true);
    for (const g of guns) for (const m of g.muzzles) {
      const pos = m.getWorldPosition(new THREE.Vector3());
      const dir = new THREE.Vector3(1, 0, 0).transformDirection(m.matrixWorld);
      out.push({ pos, dir, obj: m });
    }
    return out;
  }

  // Localised damage model: the struck section burns, loses its lights/engines/guns and sheds parts.
  damage(i, { silent = false } = {}) {
    const seg = this.segs[i];
    if (seg.userData.damaged) return;
    seg.userData.damaged = true;
    const tx = textures();
    for (const m of seg.userData.mats) {
      if (m.isMeshBasicMaterial) { m.color.multiplyScalar(0.06); continue; }
      m.color.multiplyScalar(0.42);
      m.emissiveMap = tx.burn; m.emissive.setRGB(1, 0.42, 0.12); m.emissiveIntensity = 2.2;
      m.roughness = Math.min(1, m.roughness + 0.3);
      m.needsUpdate = true;
    }
    seg.userData.burnMats = seg.userData.mats.filter((m) => !m.isMeshBasicMaterial);
    for (const e of seg.userData.engines) e.alive = false;
    for (const g of seg.userData.guns) {
      g.disabled = true;
      if (!g.fixed) { g.pitch.rotation.z = -0.25; g.yaw.rotation.y += rand(-0.6, 0.6); g.yaw.rotation.x = rand(-0.15, 0.15); }
    }
    // shed loose parts
    for (const m of seg.userData.loose) if (!silent && Math.random() < 0.8) this.shed(m);
    // list/tilt the hull a bit
    this.list.x += rand(-0.03, 0.03); this.list.z += rand(-0.02, 0.02);
    // breach: fire, smoke and sparks emitting from the damaged section
    const anchor = new THREE.Object3D();
    anchor.position.set(rand(-1, 1), 0.3, rand(-0.4, 0.4));
    seg.add(anchor);
    const fx = this.fx;
    const active = () => this.root.visible && this.opacity > 0.5;
    this.emitters.push(fx.addEmitter({
      obj: anchor, rate: 26, active,
      fn: (p) => {
        fx.add.spawn(p, tv.set(rand(-0.3, 0.3), rand(0.8, 2), rand(-0.3, 0.3)), rand(0.3, 0.7), rand(0.6, 1.2), 0.1, COLORS.fire, COLORS.fireDark, 0.9, 0, 0.5, 0);
        if (Math.random() < 0.35) fx.smoke.spawn(p, tv.set(rand(-0.2, 0.2), rand(1, 2), rand(-0.2, 0.2)), rand(1.5, 2.8), 0.6, 2.8, COLORS.smokeLight, COLORS.smoke, 0.45, 0, 0.3, 0.3);
        if (Math.random() < 0.06) fx.sparks(p, 8, 5, COLORS.spark, 0.6, 0.18);
      },
    }));
  }

  shed(m) {
    const fx = this.fx;
    const scene = fx.scene;
    scene.attach(m);
    const v = new THREE.Vector3(rand(-3, 3), rand(2, 5), rand(-3, 3));
    const w = new THREE.Vector3().randomDirection().multiplyScalar(rand(2, 6));
    let t = 0; const life = 4, s0 = m.scale.clone();
    fx.anims.push((dt) => {
      t += dt;
      if (t > life) { scene.remove(m); return false; }
      m.position.addScaledVector(v, dt); v.multiplyScalar(Math.exp(-0.4 * dt));
      m.rotation.x += w.x * dt; m.rotation.y += w.y * dt; m.rotation.z += w.z * dt;
      if (t > life - 1) m.scale.copy(s0).multiplyScalar(life - t);
      if (Math.random() < 0.5) fx.add.spawn(m.position, tv.set(0, 0, 0), 0.4, 0.5, 0.05, COLORS.fire, COLORS.fireDark, 0.8, 0);
    });
  }

  setOpacity(k, tint) {
    this.opacity = k;
    this.root.traverse((o) => {
      if (!o.material || o.userData.fx) return;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) {
        const want = k < 0.999;
        if (m.transparent !== want) { m.transparent = want; m.needsUpdate = true; }
        m.opacity = k;
        m.depthWrite = !want;
      }
    });
  }

  // Blow the ship into its segment chunks, each tumbling away on fire.
  breakApart() {
    const fx = this.fx, scene = fx.scene;
    const center = this.root.getWorldPosition(new THREE.Vector3());
    this.sunk = true;
    for (const e of this.engines) { e.alive = false; e.flame.visible = false; e.halo.visible = false; }
    for (const bl of this.blinkers) bl.s.visible = false;
    const chunks = [];
    for (const seg of this.segs) {
      scene.attach(seg);
      for (const m of seg.userData.mats) if (!m.isMeshBasicMaterial) { m.emissiveMap = textures().burn; m.emissive.setRGB(1, 0.4, 0.1); m.emissiveIntensity = 3; m.needsUpdate = true; }
      const p = seg.getWorldPosition(new THREE.Vector3());
      const v = p.clone().sub(center).setY(0);
      if (v.lengthSq() < 0.01) v.randomDirection().setY(0);
      v.normalize().multiplyScalar(rand(2, 5)).add(new THREE.Vector3(rand(-1, 1), rand(0.5, 2.5), rand(-1, 1)));
      const w = new THREE.Vector3().randomDirection().multiplyScalar(rand(0.3, 1.2));
      chunks.push({ seg, v, w });
    }
    let t = 0;
    const life = 7;
    fx.anims.push((dt) => {
      t += dt;
      for (const c of chunks) {
        c.seg.position.addScaledVector(c.v, dt); c.v.multiplyScalar(Math.exp(-0.25 * dt));
        c.seg.rotation.x += c.w.x * dt; c.seg.rotation.y += c.w.y * dt; c.seg.rotation.z += c.w.z * dt;
        if (t < life - 1.5 && Math.random() < 0.9) {
          const p = c.seg.getWorldPosition(tv);
          fx.add.spawn(p.add(new THREE.Vector3(rand(-1, 1), rand(-0.5, 0.5), rand(-1, 1))), new THREE.Vector3(0, rand(0.5, 1.5), 0), rand(0.4, 0.9), rand(0.8, 1.8), 0.2, COLORS.fire, COLORS.fireDark, 0.9, 0);
          if (Math.random() < 0.4) fx.smoke.spawn(p, new THREE.Vector3(0, rand(0.5, 1.5), 0), rand(2, 3), 1, 4, COLORS.smokeLight, COLORS.smoke, 0.4, 0, 0.3, 0.2);
        }
        for (const m of c.seg.userData.mats) if (m.emissiveIntensity !== undefined) m.emissiveIntensity = Math.max(0, 3 * (1 - t / life));
        if (t > life - 1.5) c.seg.scale.setScalar(Math.max(0.001, (life - t) / 1.5));
      }
      if (t >= life) {
        for (const c of chunks) scene.remove(c.seg);
        return false;
      }
    });
    for (const e of this.emitters) e.dead = true;
  }

  dispose() {
    for (const e of this.emitters) e.dead = true;
    this.root.parent && this.root.parent.remove(this.root);
    for (const s of this.segs) s.parent && s.parent.remove(s);
  }
}

function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
