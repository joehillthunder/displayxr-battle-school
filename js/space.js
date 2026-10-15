// Space set dressing shared by the Battle Room (in orbit over Earth) and the war: procedural
// planet textures, atmosphere shells, the sun, a bright nebula sky and image-based lighting built
// from that sky, so metal hulls and visors reflect the actual surroundings.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { rand, TAU } from './util.js';

// ── noise ─────────────────────────────────────────────────────────────────────────────────────

function hash(x, y, s) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Tileable-in-x value noise fbm on a w x h grid (for equirect textures). */
function fbm(u, v, _w, oct, seed) {
  let a = 0, amp = 0.5, f = 4;
  for (let o = 0; o < oct; o++) {
    const x = u * f, y = v * f, period = Math.round(f);
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const h = (i, j) => hash(((i % period) + period) % period, j, seed + o);
    const n = (h(x0, y0) * (1 - sx) + h(x0 + 1, y0) * sx) * (1 - sy) + (h(x0, y0 + 1) * (1 - sx) + h(x0 + 1, y0 + 1) * sx) * sy;
    a += n * amp;
    amp *= 0.5;
    f *= 2;
  }
  return a;
}

function canvasTex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Earth: blue oceans, green-brown continents, ice caps, plus a separate cloud layer. */
export function earthTextures(w = 1024, h = 512) {
  const c = document.createElement('canvas'), k = document.createElement('canvas');
  c.width = k.width = w; c.height = k.height = h;
  const g = c.getContext('2d'), gk = k.getContext('2d');
  const img = g.createImageData(w, h), cl = gk.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const lat = Math.abs(y / h - 0.5) * 2;
    for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      const e = fbm(u, v * 0.5, w, 6, 11) - lat * 0.08;
      const i = (y * w + x) * 4;
      let r, gg, b;
      if (lat > 0.92 - fbm(u, v, w, 3, 5) * 0.06) { r = 235; gg = 242; b = 250; }
      else if (e > 0.53) {
        const m = fbm(u, v, w, 4, 23);
        const dry = Math.max(0, 1 - lat * 1.6) * (m > 0.5 ? 1 : 0.3);
        r = 70 + dry * 120; gg = 110 + dry * 70; b = 50 + dry * 30;
        if (e > 0.66) { r += 40; gg += 30; b += 30; }
      } else {
        const d = Math.max(0, 0.53 - e) * 4;
        r = 20 - d * 10; gg = 80 - d * 30; b = 160 - d * 40;
      }
      img.data.set([r, gg, b, 255], i);
      const cv = fbm(u + 0.3, v * 0.6, w, 5, 77);
      const a = Math.max(0, Math.min(1, (cv - 0.52) * 4));
      cl.data.set([255, 255, 255, a * 235], i);
    }
  }
  g.putImageData(img, 0, 0);
  gk.putImageData(cl, 0, 0);
  return { map: canvasTex(c), clouds: canvasTex(k) };
}

/** The formic home world: rust deserts, dark seas, hive cities glowing on the night side. */
export function formicWorldTextures(w = 1024, h = 512) {
  const c = document.createElement('canvas'), e = document.createElement('canvas');
  c.width = e.width = w; c.height = e.height = h;
  const g = c.getContext('2d'), ge = e.getContext('2d');
  const img = g.createImageData(w, h), em = ge.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h, i = (y * w + x) * 4;
      const n = fbm(u, v * 0.5, w, 6, 101);
      const m = fbm(u, v, w, 4, 131);
      let r = 120 + n * 90, gg = 60 + n * 50, b = 40 + n * 30;
      if (n < 0.45) { r = 40; gg = 30 + m * 20; b = 45; }
      img.data.set([r, gg, b, 255], i);
      const hive = n > 0.5 && hash(x, y, 9) > 0.985 ? 1 : 0;
      const vein = Math.abs(m - 0.5) < 0.012 ? 0.8 : 0;
      const a = Math.max(hive, vein);
      em.data.set([255 * a, 140 * a, 40 * a, 255], i);
    }
  }
  g.putImageData(img, 0, 0);
  ge.putImageData(em, 0, 0);
  return { map: canvasTex(c), emissive: canvasTex(e) };
}

/** A soft round glow for sprites and particles. */
export function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner);
  gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, outer);
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return canvasTex(c);
}

/** Bright nebula sky as an equirect texture (also the source of the space environment map). */
export function nebulaTexture(w = 2048, h = 1024) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#0a1030');
  bg.addColorStop(0.5, '#141a44');
  bg.addColorStop(1, '#0a0d26');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'lighter';
  const clouds = [
    [0.18, 0.42, 0.22, 'rgba(120,70,220,0.55)'], [0.33, 0.55, 0.18, 'rgba(60,140,255,0.5)'],
    [0.62, 0.38, 0.25, 'rgba(255,90,150,0.35)'], [0.75, 0.6, 0.2, 'rgba(60,200,230,0.4)'],
    [0.9, 0.45, 0.16, 'rgba(160,90,255,0.4)'], [0.48, 0.3, 0.12, 'rgba(255,170,90,0.3)'],
  ];
  for (const [x, y, r, col] of clouds) {
    for (let k = 0; k < 18; k++) {
      const cx = (x + rand(-r, r) * 0.6) * w, cy = (y + rand(-r, r) * 0.35) * h, rr = rand(0.3, 1) * r * w * 0.5;
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rr);
      gr.addColorStop(0, col);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
    }
  }
  // Milky band of faint stars.
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * w, y = h * (0.5 + Math.sin((x / w) * TAU) * 0.12) + (Math.random() - 0.5) * h * 0.25 * Math.random();
    g.fillStyle = `rgba(255,255,255,${rand(0.15, 0.6)})`;
    g.fillRect(x, y, 1, 1);
  }
  const t = canvasTex(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

export function starfield(n, r, size = 2.2) {
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(r);
    pos.set([v.x, v.y, v.z], i * 3);
    c.setHSL(rand(0.55, 0.68), rand(0.1, 0.6), rand(0.7, 1)).multiplyScalar(rand(0.6, 2.2));
    col.set([c.r, c.g, c.b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, depthWrite: false, fog: false, map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending }));
}

/** Sky sphere + stars that should follow the camera. */
export function skyDome(radius = 700) {
  const g = new THREE.Group();
  const tex = nebulaTexture();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false, fog: false, color: new THREE.Color(0.6, 0.6, 0.65) }));
  g.add(sky, starfield(4000, radius * 0.95));
  g.renderOrder = -10;
  g.userData.texture = tex;
  return g;
}

/** Fresnel atmosphere shell: draw just outside a planet of radius 1 (scale it with the planet). */
export function atmosphere(color = '#6fb8ff', power = 3, strength = 1.6) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, power: { value: power }, strength: { value: strength } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 color; uniform float power; uniform float strength; varying vec3 vN; varying vec3 vV;
      void main() { float f = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), power); gl_FragColor = vec4(color * f * strength, f); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(1.06, 64, 32), mat);
}

/** A sun: bright core sprite plus a wide halo. Bloom does the rest. */
export function sun(size = 60) {
  const g = new THREE.Group();
  const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(3, 2.7, 2.1), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  core.scale.setScalar(size * 0.6);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(0.9, 0.7, 0.45), blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.18, fog: false }));
  halo.scale.setScalar(size * 3);
  g.add(halo, core);
  return g;
}

// ── image-based lighting ──────────────────────────────────────────────────────────────────────

const envCache = new Map();
export function envFromTexture(renderer, key, tex) {
  if (!envCache.has(key)) {
    const pm = new THREE.PMREMGenerator(renderer);
    envCache.set(key, pm.fromEquirectangular(tex).texture);
    pm.dispose();
  }
  return envCache.get(key);
}

export function roomEnv(renderer) {
  if (!envCache.has('room')) {
    const pm = new THREE.PMREMGenerator(renderer);
    envCache.set('room', pm.fromScene(new RoomEnvironment(renderer), 0.04).texture);
    pm.dispose();
  }
  return envCache.get('room');
}
