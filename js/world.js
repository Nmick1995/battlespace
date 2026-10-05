// Renderer, post-processing, space environment, holographic grids and the camera rig.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL } from './ships.js';
import { TEX } from './fx.js';
import { rand, clamp } from './core.js';

export const GRID = 10;

const NOISE_GLSL = `
float hash(vec3 p){ p = fract(p*0.3183099 + .1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x), mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x), mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y), f.z); }
float fbm(vec3 p){ float v = 0.0, a = 0.5; for(int i=0;i<6;i++){ v += a*noise(p); p = p*2.03 + 1.7; a *= 0.5; } return v; }
`;

export class World {
  constructor(canvas) {
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    r.setSize(innerWidth, innerHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 6000);
    this.camera.position.set(0, 60, 90);

    this.buildSky();
    this.buildLights();
    this.buildPlanet();
    this.buildAsteroids();
    this.buildDust();
    this.buildEnvMap();
    this.buildPost();

    this.rig = new CameraRig(this.camera);
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h); this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.dustMat.uniforms.scale.value = h * this.renderer.getPixelRatio();
    this.onResize && this.onResize(h * this.renderer.getPixelRatio());
  }

  buildSky() {
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform float time; varying vec3 vDir; ${NOISE_GLSL}
        void main(){
          vec3 d = normalize(vDir);
          float n1 = fbm(d*2.3 + vec3(0.0, 0.0, time*0.003));
          float n2 = fbm(d*4.1 + 11.0);
          float n3 = fbm(d*9.0 - 3.0);
          float band = exp(-pow(d.y*1.8 + 0.35*(n1-0.5) + 0.15, 2.0)*4.0);
          vec3 purple = vec3(0.30,0.06,0.50), teal = vec3(0.03,0.28,0.50), orange = vec3(0.85,0.30,0.12);
          vec3 col = mix(purple, teal, smoothstep(0.35,0.65,n2)) * pow(n1, 2.6) * 2.2 * (0.25 + band);
          col += orange * pow(max(0.0, n2-0.52), 1.6) * 2.4 * band * n1;
          col *= 0.45 + 0.55*smoothstep(0.3, 0.62, n3);
          // faint dense star glow in the band
          col += vec3(0.5,0.55,0.7) * pow(n3, 6.0) * band * 0.6;
          gl_FragColor = vec4(col*0.55, 1.0);
        }`,
      side: THREE.BackSide, depthWrite: false, depthTest: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 64, 32), this.skyMat);
    sky.renderOrder = -10;
    this.sky = sky;
    this.scene.add(sky);

    // stars
    const N = 7000, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N), ph = new Float32Array(N);
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(rand(2000, 3500));
      pos.set([v.x, v.y, v.z], i * 3);
      const t = Math.random();
      c.setHSL(t < 0.7 ? 0.6 : t < 0.9 ? 0.1 : 0.0, rand(0.2, 0.7), rand(0.7, 0.95));
      const b = Math.pow(Math.random(), 3) * 2.5 + 0.4;
      col.set([c.r * b, c.g * b, c.b * b], i * 3);
      size[i] = Math.random() < 0.02 ? rand(3, 5) : rand(1, 2.4);
      ph[i] = Math.random() * 100;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    g.setAttribute('phase', new THREE.BufferAttribute(ph, 1));
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, pr: { value: this.renderer.getPixelRatio() } },
      vertexShader: `attribute float size; attribute float phase; attribute vec3 color; uniform float time; uniform float pr; varying vec3 vC; varying float vT;
        void main(){ vC = color; vT = 0.75 + 0.25*sin(time*1.5 + phase); vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = size*pr; gl_Position = projectionMatrix*mv; gl_Position.z = gl_Position.w*0.99999; }`,
      fragmentShader: `varying vec3 vC; varying float vT; void main(){ vec2 p = gl_PointCoord-0.5; float d = length(p); float a = smoothstep(0.5,0.0,d); gl_FragColor = vec4(vC*vT*a, a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.stars = new THREE.Points(g, this.starMat);
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);
  }

  buildLights() {
    this.sunDir = new THREE.Vector3(0.9, 0.55, -0.35).normalize();
    const sun = (this.sun = new THREE.DirectionalLight(0xfff1dc, 3.2));
    sun.position.copy(this.sunDir).multiplyScalar(120);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -75; sc.right = 75; sc.top = 75; sc.bottom = -75; sc.near = 10; sc.far = 300;
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04;
    this.scene.add(sun, sun.target);
    this.scene.add(new THREE.HemisphereLight(0x8a9cff, 0x3a2010, 1.0));
    this.scene.add(new THREE.AmbientLight(0x223044, 0.6));
    const rim = new THREE.DirectionalLight(0x6fb8ff, 1.4);
    rim.position.set(-80, 30, -60);
    this.scene.add(rim);

    // sun glow + lens flare
    const mk = (size, stops) => {
      const cv = document.createElement('canvas'); cv.width = cv.height = size;
      const g = cv.getContext('2d'); const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      stops.forEach(([o, c]) => grd.addColorStop(o, c)); g.fillStyle = grd; g.fillRect(0, 0, size, size);
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
    };
    const t0 = mk(256, [[0, 'rgba(255,255,255,1)'], [0.1, 'rgba(255,240,210,0.9)'], [0.3, 'rgba(255,170,80,0.25)'], [1, 'rgba(0,0,0,0)']]);
    const t1 = mk(128, [[0, 'rgba(140,200,255,0.0)'], [0.7, 'rgba(140,200,255,0.25)'], [0.8, 'rgba(140,200,255,0.05)'], [1, 'rgba(0,0,0,0)']]);
    const t2 = mk(64, [[0, 'rgba(255,200,150,0.35)'], [1, 'rgba(0,0,0,0)']]);
    // sun: layered additive sprites far away along the light direction
    const sunPos = this.sunDir.clone().multiplyScalar(3000);
    for (const [tex, size, col] of [[t0, 900, new THREE.Color(1.6, 1.4, 1.1)], [t2, 2600, new THREE.Color(0.6, 0.35, 0.2)], [t1, 1500, new THREE.Color(0.5, 0.7, 1)]]) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      sp.position.copy(sunPos); sp.scale.setScalar(size); sp.renderOrder = -5;
      this.scene.add(sp);
    }
  }

  buildPlanet() {
    // gas giant texture: turbulent, sheared bands painted per pixel
    const W = 1024, H = 512;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const img = g.createImageData(W, H), D = img.data;
    const bands = [];
    for (let i = 0; i < 70; i++) bands.push([rand(0, 1), rand(0.005, 0.04), Math.random()]);
    const pal = [[0.86, 0.66, 0.45], [0.62, 0.42, 0.30], [0.95, 0.85, 0.68], [0.55, 0.36, 0.42], [0.78, 0.55, 0.36]];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = x / W * Math.PI * 2;
        // horizontal shear + eddies displace the band lookup
        const vy = y / H + 0.012 * Math.sin(u * 3 + y * 0.05) + 0.006 * Math.sin(u * 11 - y * 0.13) + 0.004 * Math.sin(u * 23 + y * 0.31);
        let t = 0;
        for (const [c, w, k] of bands) t += Math.exp(-Math.pow((vy - c) / w, 2)) * (k - 0.5);
        const idx = Math.abs(Math.floor(vy * 9)) % pal.length, nxt = (idx + 1) % pal.length, fr = vy * 9 - Math.floor(vy * 9);
        const base = pal[idx].map((v, j) => v + (pal[nxt][j] - v) * fr);
        const lum = 1 + t * 0.45;
        const o = (y * W + x) * 4;
        D[o] = clamp(base[0] * lum * 255, 0, 255); D[o + 1] = clamp(base[1] * lum * 255, 0, 255); D[o + 2] = clamp(base[2] * lum * 255, 0, 255); D[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // storms
    for (const [sx, sy, rw, rh, col] of [[0.62, 0.62, 40, 18, '200,110,70'], [0.25, 0.38, 22, 9, '240,220,190'], [0.82, 0.3, 14, 6, '235,215,185']]) {
      for (let k = 3; k > 0; k--) { g.fillStyle = `rgba(${col},${0.25 * k / 3 + 0.15})`; g.beginPath(); g.ellipse(W * sx, H * sy, rw * k / 3 + 4, rh * k / 3 + 2, 0, 0, 7); g.fill(); }
    }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const planet = new THREE.Mesh(new THREE.SphereGeometry(420, 96, 64), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 }));
    planet.position.set(-900, -380, -1900);
    planet.rotation.z = 0.35;
    this.planet = planet;
    const atm = new THREE.Mesh(new THREE.SphereGeometry(445, 64, 48), new THREE.ShaderMaterial({
      uniforms: { sun: { value: this.sunDir } },
      vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `uniform vec3 sun; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 4.0); float l = clamp(dot(vN, sun)*0.9+0.25, 0.0, 1.0); vec3 c = mix(vec3(0.25,0.5,1.0), vec3(1.0,0.75,0.5), pow(l,3.0)*0.4)*f*l*1.4; gl_FragColor = vec4(c, f*0.8); }`,
      side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    }));
    planet.add(atm);
    // rings
    const rc = document.createElement('canvas'); rc.width = 512; rc.height = 1;
    const rg = rc.getContext('2d');
    for (let x = 0; x < 512; x++) { const a = Math.max(0, Math.sin(x * 0.05) * 0.3 + Math.random() * 0.5) * (x > 30 && x < 500 ? 1 : 0); rg.fillStyle = `rgba(220,200,180,${a})`; rg.fillRect(x, 0, 1, 1); }
    const rt = new THREE.CanvasTexture(rc); rt.colorSpace = THREE.SRGBColorSpace;
    const ringGeo = new THREE.RingGeometry(520, 860, 128, 1);
    const uv = ringGeo.attributes.uv, p = ringGeo.attributes.position;
    for (let i = 0; i < uv.count; i++) { const rr = Math.hypot(p.getX(i), p.getY(i)); uv.setXY(i, (rr - 520) / 340, 0.5); }
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshStandardMaterial({ map: rt, transparent: true, side: THREE.DoubleSide, roughness: 1, depthWrite: false, opacity: 0.8 }));
    ring.rotation.x = -Math.PI / 2 + 0.25;
    planet.add(ring);
    this.scene.add(planet);
  }

  buildAsteroids() {
    // cheap 3D value noise for displacement
    const h = (x, y, z) => { const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return n - Math.floor(n); };
    const vn = (x, y, z) => {
      const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
      const l = (a, b, t) => a + (b - a) * t;
      return l(l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
               l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v), w);
    };
    const makeRock = (seed, stretch) => {
      const raw = new THREE.IcosahedronGeometry(1, 3);
      raw.deleteAttribute('normal'); raw.deleteAttribute('uv');
      const geo = mergeVertices(raw); // shared vertices -> smooth normals
      const p = geo.attributes.position, col = new Float32Array(p.count * 3), v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        let d = 0, f = 1.4, amp = 0.34;
        for (let o = 0; o < 6; o++) { d += (vn(v.x * f + seed, v.y * f + seed * 2, v.z * f - seed) - 0.5) * amp; f *= 2.2; amp *= 0.58; }
        // ridged layer for sharp crags
        d += (0.5 - Math.abs(vn(v.x * 5 + seed, v.y * 5, v.z * 5) - 0.5)) * 0.07;
        // craters: a couple of soft dents
        const crater = Math.max(0, 1 - v.distanceTo(new THREE.Vector3(Math.sin(seed), Math.cos(seed * 1.7), Math.sin(seed * 2.3)).normalize()) * 2.2);
        d -= crater * crater * 0.18;
        v.multiplyScalar(1 + d).multiply(stretch);
        p.setXYZ(i, v.x, v.y, v.z);
        const shade = Math.max(0.15, 0.6 + d * 2.4); // crevices darker, ridges lighter
        col.set([shade, shade * 0.95, shade * 0.9], i * 3);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.computeVertexNormals();
      return geo;
    };
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a7c72, roughness: 0.92, metalness: 0.08, vertexColors: true });
    // per-pixel procedural rock detail: fbm bump + mottled albedo, computed in object space
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vObj;
          ${NOISE_GLSL}
          vec3 rockPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
            vec3 vSigmaX = dFdx(surf_pos.xyz); vec3 vSigmaY = dFdy(surf_pos.xyz); vec3 vN = surf_norm;
            vec3 R1 = cross(vSigmaY, vN); vec3 R2 = cross(vN, vSigmaX);
            float fDet = dot(vSigmaX, R1) * faceDirection;
            vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
            return normalize(abs(fDet) * surf_norm - vGrad);
          }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float mott = fbm(vObj*3.0);
          diffuseColor.rgb *= 0.7 + 0.6*mott;`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          // fade fine detail with screen-space footprint so distant rocks don't sparkle/alias
          float lod = length(fwidth(vObj));
          float nearF = 1.0 - smoothstep(0.006, 0.03, lod);
          float midF = 1.0 - smoothstep(0.015, 0.09, lod);
          float hgt = fbm(vObj*6.0)*midF + 0.5*fbm(vObj*17.0)*nearF;
          normal = rockPerturb(-vViewPosition, normal, vec2(dFdx(hgt), dFdy(hgt))*2.2, faceDirection);`);
    };
    const variants = [makeRock(1.3, new THREE.Vector3(1, 0.8, 0.9)), makeRock(4.7, new THREE.Vector3(1.3, 0.7, 0.8)), makeRock(8.1, new THREE.Vector3(0.9, 0.9, 1))];
    const N = 420;
    this.rocks = [];
    this.asteroidMeshes = variants.map((g) => { const m = new THREE.InstancedMesh(g, mat, Math.ceil(N / 3)); m.frustumCulled = false; this.scene.add(m); return m; });
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, rr = rand(140, 330);
      const r = {
        pos: new THREE.Vector3(Math.cos(a) * rr, rand(-50, 15) - (rr > 200 ? 20 : 0), Math.sin(a) * rr),
        rot: new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6)), spin: new THREE.Vector3(rand(-0.3, 0.3), rand(-0.3, 0.3), rand(-0.3, 0.3)),
        s: Math.pow(Math.random(), 3) * 7 + 0.6, mesh: this.asteroidMeshes[i % 3], idx: Math.floor(i / 3),
      };
      c.setHSL(rand(0.04, 0.09), rand(0.08, 0.25), rand(0.32, 0.6));
      r.mesh.setColorAt(r.idx, c);
      this.rocks.push(r);
    }
    this.updateRocks(0);
  }
  updateRocks(dt) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    const ang = dt * 0.004, c = Math.cos(ang), sn = Math.sin(ang);
    for (const r of this.rocks) {
      r.rot.x += r.spin.x * dt; r.rot.y += r.spin.y * dt; r.rot.z += r.spin.z * dt;
      const x = r.pos.x * c - r.pos.z * sn; r.pos.z = r.pos.x * sn + r.pos.z * c; r.pos.x = x;
      m.compose(r.pos, q.setFromEuler(r.rot), s.setScalar(r.s));
      r.mesh.setMatrixAt(r.idx, m);
    }
    for (const am of this.asteroidMeshes) am.instanceMatrix.needsUpdate = true;
  }

  // Fine motes drifting through the battlespace: parallax that sells depth in close-ups.
  buildDust() {
    const N = 2200, pos = new Float32Array(N * 3), ph = new Float32Array(N);
    for (let i = 0; i < N; i++) { pos.set([rand(-90, 90), rand(-25, 45), rand(-95, 95)], i * 3); ph[i] = Math.random() * 100; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('phase', new THREE.BufferAttribute(ph, 1));
    this.dustMat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, scale: { value: innerHeight * this.renderer.getPixelRatio() } },
      vertexShader: `attribute float phase; uniform float time; uniform float scale; varying float vA;
        void main(){
          vec3 p = position + vec3(sin(time*0.05+phase)*3.0, sin(time*0.07+phase*1.3)*2.0, cos(time*0.04+phase)*3.0);
          vec4 mv = modelViewMatrix*vec4(p,1.0);
          float d = -mv.z;
          gl_PointSize = clamp(0.09*scale/d, 1.0, 5.0);
          vA = smoothstep(2.0, 10.0, d) * (1.0 - smoothstep(60.0, 140.0, d)) * (0.5 + 0.5*sin(time*0.8+phase));
          gl_Position = projectionMatrix*mv;
        }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord-0.5); float a = smoothstep(0.5, 0.0, d)*vA*0.55; gl_FragColor = vec4(vec3(0.7,0.85,1.0)*a, a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(g, this.dustMat);
    pts.frustumCulled = false;
    this.scene.add(pts);
  }

  buildEnvMap() {
    const pm = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), this.skyMat));
    const sunBall = new THREE.Mesh(new THREE.SphereGeometry(8, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 8, 7) }));
    sunBall.position.copy(this.sunDir).multiplyScalar(80); envScene.add(sunBall);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(120, 30), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.8, 1.2, 1.8), side: THREE.DoubleSide }));
    panel.position.set(0, 70, 0); panel.rotation.x = Math.PI / 2; envScene.add(panel);
    const low = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.12, 0.05), side: THREE.DoubleSide }));
    low.position.set(0, -60, 0); low.rotation.x = Math.PI / 2; envScene.add(low);
    this.scene.environment = pm.fromScene(envScene, 0.02).texture;
    this.scene.environmentIntensity = 1.25;
  }

  buildPost() {
    const r = this.renderer;
    const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // guard: a single NaN pixel would smear into black blocks through the bloom mip chain
    this.composer.addPass(new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); uvec4 b = floatBitsToUint(c) & 0x7fffffffu; if (any(greaterThanEqual(b, uvec4(0x7f800000u)))) c = vec4(0.0,0.0,0.0,1.0); gl_FragColor = vec4(min(c.rgb, vec3(60.0)), c.a); }`,
    }));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.65, 0.55, 0.95);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.cine = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, time: { value: 0 }, amount: { value: 0 }, flash: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform sampler2D tDiffuse; uniform float time; uniform float amount; uniform float flash; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
        void main(){
          vec2 c = vUv - 0.5;
          float ca = 0.0015 + amount*0.004;
          vec3 col;
          col.r = texture2D(tDiffuse, vUv + c*ca).r;
          col.g = texture2D(tDiffuse, vUv).g;
          col.b = texture2D(tDiffuse, vUv - c*ca).b;
          col += (h(vUv*1000.0 + time) - 0.5) * (0.025 + amount*0.03);
          col = mix(col, col*vec3(1.05,1.0,0.95), amount);
          col += flash;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.composer.addPass(this.cine);
  }

  render(dt, t) {
    this.skyMat.uniforms.time.value = t;
    this.starMat.uniforms.time.value = t;
    this.dustMat.uniforms.time.value = t;
    this.cine.uniforms.time.value = t % 100;
    this.planet.rotation.y += dt * 0.004;
    this.updateRocks(dt);
    this.rig.update(dt, t);
    this.composer.render();
  }
}

// ------------------------------------------------------------------ holographic grid
export class Grid {
  constructor(scene, center, color, label) {
    this.center = center.clone();
    this.size = GRID * CELL;
    this.group = new THREE.Group();
    this.group.position.copy(center);
    scene.add(this.group);
    const S = this.size;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: new THREE.Color(color) }, time: { value: 0 }, hover: { value: new THREE.Vector2(-10, -10) },
        hoverColor: { value: new THREE.Color(3, 2, 0.6) }, hoverSize: { value: new THREE.Vector2(1, 1) }, opacity: { value: 1 },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 color; uniform float time; uniform vec2 hover; uniform vec2 hoverSize; uniform vec3 hoverColor; uniform float opacity; varying vec2 vUv;
        void main(){
          vec2 g = vUv*10.0;
          vec2 f = fract(g); vec2 d = min(f, 1.0-f);
          vec2 fw = fwidth(g);
          vec2 l = smoothstep(vec2(0.0), fw*1.6, d);
          float line = 1.0 - min(l.x, l.y);
          vec2 e = min(vUv, 1.0-vUv);
          float border = 1.0 - smoothstep(0.0, fwidth(vUv.x)*3.0, min(e.x, e.y) - 0.002);
          float cross = step(abs(f.x-0.5), 0.03) * step(abs(f.y-0.5), 0.12) + step(abs(f.y-0.5), 0.03) * step(abs(f.x-0.5), 0.12);
          float sweep = exp(-pow((vUv.y - fract(time*0.08))*30.0, 2.0));
          vec2 cell = floor(g);
          vec2 hv = step(hover, cell) * step(cell, hover + hoverSize - 1.0);
          float hov = hv.x*hv.y;
          float fill = 0.035 + sweep*0.05;
          vec3 c = color*(line*0.55 + border*1.2 + cross*0.25 + fill) + color*sweep*line*1.5;
          float a = line*0.55 + border + cross*0.2 + fill + sweep*0.15;
          c += hoverColor * hov * (0.18 + line*1.2);
          a += hov*0.35;
          gl_FragColor = vec4(c, clamp(a,0.0,1.0)*opacity);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(S, S), this.mat);
    plane.rotation.x = -Math.PI / 2;
    plane.renderOrder = 1;
    this.group.add(plane);
    const base = new THREE.Mesh(new THREE.PlaneGeometry(S + 2, S + 2), new THREE.MeshBasicMaterial({ color: 0x02060c, transparent: true, opacity: 0.4, depthWrite: false }));
    base.rotation.x = -Math.PI / 2; base.position.y = -0.05; base.renderOrder = 0;
    this.group.add(base);
    // frame corners
    const cm = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.5), toneMapped: false });
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const a = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 0.35), cm); a.position.set(sx * (S / 2 + 1) - sx * 1.6, 0, sz * (S / 2 + 1)); this.group.add(a);
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.2, 4), cm); b.position.set(sx * (S / 2 + 1), 0, sz * (S / 2 + 1) - sz * 1.6); this.group.add(b);
    }
    // labels
    const colCss = '#' + new THREE.Color(color).getHexString();
    for (let i = 0; i < GRID; i++) {
      const rowL = this.label('ABCDEFGHIJ'[i], colCss); rowL.position.set(-S / 2 - 2.2, 0.2, (i - 4.5) * CELL); this.group.add(rowL);
      const colL = this.label(String(i + 1), colCss); colL.position.set((i - 4.5) * CELL, 0.2, S / 2 + 2.2); this.group.add(colL);
    }
    const title = this.label(label, colCss, 512, 40); title.scale.set(22, 2.75, 1); title.position.set(0, 0.2, -S / 2 - 3.2); this.group.add(title);
    this.markers = new THREE.Group(); this.group.add(this.markers);
  }

  label(text, css, w = 64, fs = 44) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = 64;
    const g = cv.getContext('2d');
    g.font = `700 ${fs}px Orbitron, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = css; g.shadowBlur = 12; g.fillStyle = css; g.fillText(text, w / 2, 34);
    g.shadowBlur = 0; g.fillStyle = '#ffffff'; g.globalAlpha = 0.7; g.fillText(text, w / 2, 34);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    // flat holographic label lying on the grid plane
    const s = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.rotation.x = -Math.PI / 2;
    s.scale.set(2.4 * w / 64, 2.4, 1);
    return s;
  }

  cellToWorld(r, c, y = 0) {
    return new THREE.Vector3(this.center.x + (c - 4.5) * CELL, this.center.y + y, this.center.z + (r - 4.5) * CELL);
  }

  worldToCell(p) {
    const c = Math.floor((p.x - this.center.x) / CELL + 5), r = Math.floor((p.z - this.center.z) / CELL + 5);
    if (r < 0 || r >= GRID || c < 0 || c >= GRID) return null;
    return { r, c };
  }

  setHover(cell, w = 1, h = 1, color) {
    if (!cell) { this.mat.uniforms.hover.value.set(-10, -10); return; }
    // shader cell coords: x = col, y = 9 - row (uv.y grows toward -z)
    this.mat.uniforms.hover.value.set(cell.c, 9 - (cell.r + h - 1));
    this.mat.uniforms.hoverSize.value.set(w, h);
    if (color) this.mat.uniforms.hoverColor.value.copy(color);
  }

  clearMarkers() {
    while (this.markers.children.length) {
      const m = this.markers.children[0];
      m.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      this.markers.remove(m);
    }
  }

  addMiss(r, c) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.4, 2.2), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    m.rotation.x = -Math.PI / 2;
    const d = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16), m.material); d.rotation.x = -Math.PI / 2;
    g.add(m, d);
    g.position.copy(this.cellToWorld(r, c, 0.05)).sub(this.center);
    this.markers.add(g);
    return g;
  }

  addHit(r, c) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.5, 0.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(CELL * 0.92, CELL * 0.92), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.08, 0.02), transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
    fill.rotation.x = -Math.PI / 2;
    g.add(fill);
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.05, 0.22), mat);
      bar.rotation.y = a; g.add(bar);
    }
    const ember = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.soft, color: new THREE.Color(3, 0.9, 0.3), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    ember.scale.setScalar(3); ember.position.y = 0.4; g.add(ember);
    g.userData.ember = ember; g.userData.fill = fill;
    g.position.copy(this.cellToWorld(r, c, 0.06)).sub(this.center);
    this.markers.add(g);
    return g;
  }

  update(t) {
    this.mat.uniforms.time.value = t;
    for (const m of this.markers.children) {
      if (m.userData.ember) {
        m.userData.ember.material.opacity = (0.55 + 0.35 * Math.sin(t * 6 + m.position.x)) * (m.userData.dim ? 0.2 : 1);
        m.userData.ember.scale.setScalar(2.6 + 0.4 * Math.sin(t * 4 + m.position.z));
      }
    }
  }
}

// ------------------------------------------------------------------ camera rig
export class CameraRig {
  constructor(cam) {
    this.cam = cam;
    this.pos = cam.position.clone();
    this.look = new THREE.Vector3();
    this.fov = 50;
    this.shakeAmt = 0;
    this.sway = 1;
    this.follow = null; // function(dt) that sets pos/look each frame
  }
  set(pos, look, fov) { this.pos.copy(pos); this.look.copy(look); if (fov) this.fov = fov; }
  shake(a) { this.shakeAmt = Math.max(this.shakeAmt, a); }
  update(dt, t) {
    if (this.follow) this.follow(dt, t);
    const c = this.cam;
    c.position.copy(this.pos);
    if (this.sway) {
      c.position.x += Math.sin(t * 0.21) * 0.5 * this.sway;
      c.position.y += Math.sin(t * 0.17) * 0.35 * this.sway;
    }
    if (this.shakeAmt > 0.001) {
      c.position.x += (Math.random() - 0.5) * this.shakeAmt;
      c.position.y += (Math.random() - 0.5) * this.shakeAmt;
      c.position.z += (Math.random() - 0.5) * this.shakeAmt;
      this.shakeAmt *= Math.exp(-dt * 6);
    }
    c.lookAt(this.look);
    if (Math.abs(c.fov - this.fov) > 0.01) { c.fov = this.fov; c.updateProjectionMatrix(); }
  }
}
