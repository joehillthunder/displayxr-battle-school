// The Battle Room: a zero-gravity glass sphere in orbit, with Earth turning below. You are the
// commander of Dragon Army, seen first person. Grab a star (the floating cover blocks) or the
// wall, aim, and hold Space to push off: you fly in a straight line until you hit something, so
// every jump is a decision. The flash gun freezes whatever it hits. Win by freezing the other army,
// or by going through their gate once half of them are frozen. Their gate faces Earth: it's down.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp, damp, rand, TAU } from './util.js';
import { atmosphere, earthTextures, envFromTexture, skyDome, sun } from './space.js';
import { Sparks } from './fx.js';

const RS = 22; // room radius (m)
const R = 0.55; // soldier collision radius
const STAR = 1.4; // star half-size
const GATE = 3.2; // gate radius
const SUN_DIR = new THREE.Vector3(0.75, 0.45, -0.5).normalize();

export const ROOM_BATTLES = [
  {
    name: 'Dragon vs Salamander',
    intro: 'Your first battle as commander. Salamander Army is waiting on the far side.',
    enemies: [{ army: 'Salamander', color: '#3fd16b', n: 6 }],
    allies: 3, skill: 0.45, react: 1.4, stars: 16,
  },
  {
    name: 'Dragon vs Rattlesnake',
    intro: 'They know your tricks now. Nine soldiers and better aim.',
    enemies: [{ army: 'Rattlesnake', color: '#ff4a3a', n: 9 }],
    allies: 4, skill: 0.6, react: 1.1, stars: 20,
  },
  {
    name: 'Dragon vs Griffin & Tiger',
    intro: 'Two armies at once. Nobody said it would be fair.',
    enemies: [{ army: 'Griffin', color: '#b07bff', n: 7 }, { army: 'Tiger', color: '#ffd23a', n: 7 }],
    allies: 5, skill: 0.7, react: 0.95, stars: 22,
  },
];

const DRAGON = '#ff8a2a';
const hdr = (c, k) => new THREE.Color(c).multiplyScalar(k); // > 1 blooms

// ── soldiers: dark armour with light strips in the army's colour ─────────────────────────────

const SUIT = new THREE.MeshStandardMaterial({ color: '#4a5262', roughness: 0.32, metalness: 0.55 });
const PLATE = new THREE.MeshStandardMaterial({ color: '#8a94a6', roughness: 0.25, metalness: 0.7 });
const VISOR = new THREE.MeshStandardMaterial({ color: '#0a1424', roughness: 0.05, metalness: 1 });
const FROZEN_SUIT = new THREE.MeshStandardMaterial({ color: '#d8ecff', roughness: 0.15, metalness: 0.2, emissive: '#7fc8ff', emissiveIntensity: 0.5 });
const FROZEN_LIGHT = new THREE.MeshBasicMaterial({ color: hdr('#bfe8ff', 2.5) });

function soldierMesh(color) {
  const g = new THREE.Group();
  const light = new THREE.MeshBasicMaterial({ color: hdr(color, 3) });
  const parts = { suit: [], lights: [] };
  const add = (geo, mat, x, y, z, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, 0, rz);
    g.add(m);
    (mat === light ? parts.lights : parts.suit).push(m);
    return m;
  };
  // Torso, chest plate, helmet with a mirrored visor and a lit brow line.
  add(new THREE.CapsuleGeometry(0.2, 0.36, 6, 14), SUIT, 0, 0.12, 0);
  add(new RoundedBoxGeometry(0.42, 0.34, 0.14, 3, 0.05), PLATE, 0, 0.24, 0.12);
  add(new THREE.SphereGeometry(0.2, 24, 16), SUIT, 0, 0.62, 0);
  add(new THREE.SphereGeometry(0.17, 24, 12, -1.1, 2.2, 0.9, 1.0), VISOR, 0, 0.62, 0.04);
  add(new THREE.TorusGeometry(0.19, 0.012, 6, 24, Math.PI), light, 0, 0.7, 0.02, 0.15);
  for (const sx of [-1, 1]) add(new THREE.SphereGeometry(0.1, 14, 10), PLATE, sx * 0.25, 0.36, 0);
  // Limbs: upper + lower capsules, with light strips.
  const limb = new THREE.CapsuleGeometry(0.07, 0.26, 4, 10);
  const strip = new THREE.BoxGeometry(0.025, 0.24, 0.025);
  for (const sx of [-1, 1]) {
    add(limb, SUIT, sx * 0.3, 0.12, 0.04, 0, sx * 0.25);
    add(limb, SUIT, sx * 0.34, -0.14, 0.14, -0.6, sx * 0.1);
    add(strip, light, sx * 0.36, 0.12, 0.07, 0, sx * 0.25);
    add(limb, SUIT, sx * 0.11, -0.36, 0, 0, sx * 0.08);
    add(limb, SUIT, sx * 0.13, -0.68, 0.04, 0.15, 0);
    add(strip, light, sx * 0.11, -0.36, 0.075, 0, sx * 0.08);
    add(strip, light, sx * 0.13, -0.68, 0.11, 0.15, 0);
  }
  // Chest emblem and belt.
  add(new THREE.BoxGeometry(0.3, 0.025, 0.02), light, 0, 0.32, 0.2);
  add(new THREE.BoxGeometry(0.38, 0.05, 0.3), PLATE, 0, -0.1, 0);
  // Flash gun with a lit muzzle.
  add(new RoundedBoxGeometry(0.07, 0.08, 0.34, 2, 0.02), PLATE, 0.34, -0.2, 0.36);
  add(new THREE.SphereGeometry(0.025, 8, 6), light, 0.34, -0.2, 0.54);
  g.userData = parts;
  g.scale.setScalar(1.15);
  return g;
}

class Soldier {
  constructor(team, color, army, isPlayer = false) {
    this.team = team; // 0 Dragon, 1 enemy
    this.army = army;
    this.color = color;
    this.isPlayer = isPlayer;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.normal = new THREE.Vector3(0, 1, 0); // surface we're holding
    this.anchored = true;
    this.frozen = false;
    this.hits = 0;
    this.maxHits = isPlayer ? 3 : 1;
    this.think = rand(0.5, 2);
    this.mesh = isPlayer ? null : soldierMesh(color);
  }

  freeze() {
    this.frozen = true;
    this.anchored = false;
    if (this.vel.lengthSq() < 0.5) this.vel.randomDirection().multiplyScalar(0.6);
    if (!this.mesh) return;
    this.mesh.userData.suit.forEach((m) => (m.material = FROZEN_SUIT));
    this.mesh.userData.lights.forEach((m) => (m.material = FROZEN_LIGHT));
  }
}

// ── the mode ──────────────────────────────────────────────────────────────────────────────────

export class BattleRoom {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group();
    this.group.visible = false;
    app.stage.scene.add(this.group);
    this.quat = new THREE.Quaternion();
    this.beams = [];
    this.built = false;
  }

  /** Built on first entry: the Earth textures take a moment to generate. */
  build() {
    if (this.built) return;
    this.built = true;
    const g = this.group;
    const renderer = this.app.stage.renderer;

    // Outside: sky, sun and Earth turning far below.
    this.sky = skyDome(1200);
    this.env = envFromTexture(renderer, 'nebula', this.sky.userData.texture);
    g.add(this.sky);
    const s = sun(90);
    s.position.copy(SUN_DIR).multiplyScalar(1000);
    g.add(s);
    const tex = earthTextures(1024, 512);
    this.earth = new THREE.Group();
    const earthMat = new THREE.MeshStandardMaterial({ map: tex.map, roughness: 0.75, metalness: 0, emissive: '#0a1a33', emissiveIntensity: 0.4 });
    this.earth.add(new THREE.Mesh(new THREE.SphereGeometry(420, 96, 48), earthMat));
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(424, 96, 48), new THREE.MeshStandardMaterial({ map: tex.clouds, transparent: true, depthWrite: false, roughness: 1 }));
    this.earth.add(this.clouds);
    const atm = atmosphere('#7cc4ff', 2.4, 2.2);
    atm.scale.setScalar(420);
    this.earth.add(atm);
    this.earth.position.set(0, -560, -80);
    this.earth.rotation.set(1.25, 0, 0.3); // equator towards the room: oceans, continents and cloud bands, not the ice cap
    g.add(this.earth);

    // Light: the sun, blue light bouncing off Earth, and a bright sky fill.
    const key = new THREE.DirectionalLight('#fff4e0', 2.0);
    key.position.copy(SUN_DIR).multiplyScalar(50);
    const earthshine = new THREE.DirectionalLight('#7fb8ff', 0.8);
    earthshine.position.set(0, -50, 0);
    g.add(key, earthshine, new THREE.HemisphereLight('#cfe2ff', '#3a6aa8', 0.7));

    // The room: a geodesic glass sphere with lit struts and two metal rings.
    const struts = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(RS, 3), 1), new THREE.LineBasicMaterial({ color: hdr('#7fd4ff', 1.3), transparent: true, opacity: 0.55 }));
    g.add(struts);
    const glass = new THREE.Mesh(new THREE.SphereGeometry(RS + 0.05, 64, 32), new THREE.MeshStandardMaterial({
      color: '#9fd8ff', roughness: 0.05, metalness: 0.9, envMap: this.env, envMapIntensity: 0.4, transparent: true, opacity: 0.06, side: THREE.BackSide, depthWrite: false,
    }));
    g.add(glass);
    const ringMat = new THREE.MeshStandardMaterial({ color: '#c8d2e0', roughness: 0.25, metalness: 0.9, envMap: this.env });
    for (const rx of [Math.PI / 2, 0]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(RS + 0.15, 0.22, 12, 160), ringMat);
      ring.rotation.x = rx;
      g.add(ring);
    }
    // Floodlights around the equator.
    const lampMat = new THREE.MeshBasicMaterial({ color: hdr('#e8f4ff', 4) });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), lampMat);
      lamp.position.set(Math.cos(a) * (RS - 0.1), 0, Math.sin(a) * (RS - 0.1));
      g.add(lamp);
    }
    g.add(new THREE.PointLight('#dceeff', 60, 60, 1.4));

    // Gates: ours at the top pole, theirs at the bottom, facing Earth.
    this.gates = [];
    for (const [y, color] of [[RS - 0.1, DRAGON], [-RS + 0.1, '#4fd8ff']]) {
      const gate = new THREE.Group();
      const ringM = new THREE.MeshBasicMaterial({ color: hdr(color, 3) });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(GATE, 0.14, 12, 64), ringM);
      ring.rotation.x = Math.PI / 2;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(GATE, 48), new THREE.MeshBasicMaterial({ color: hdr(color, 1.5), transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      disc.rotation.x = Math.PI / 2;
      gate.add(ring, disc);
      gate.position.y = y;
      gate.userData = { ringM, disc };
      g.add(gate);
      this.gates.push(gate);
    }

    // Stars: rounded metal blocks with glowing edges.
    this.starMat = new THREE.MeshStandardMaterial({ color: '#8fa6c8', roughness: 0.38, metalness: 0.35, envMap: this.env, envMapIntensity: 0.5 });
    this.starEdge = new THREE.LineBasicMaterial({ color: hdr('#7fd4ff', 2.4) });
    this.starGeo = new RoundedBoxGeometry(STAR * 2, STAR * 2, STAR * 2, 4, 0.22);
    this.starEdgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(STAR * 2.02, STAR * 2.02, STAR * 2.02));
    this.starGroup = new THREE.Group();
    g.add(this.starGroup);
    this.soldierGroup = new THREE.Group();
    g.add(this.soldierGroup);
    this.sparks = new Sparks(g, 2500, 0.18);
  }

  // ── round set-up ──────────────────────────────────────────────────────────────────────────

  start(index) {
    this.level = index;
    this.cfg = ROOM_BATTLES[index];
    this.over = false;
    this.time = 0;
    this.charge = 0;
    this.gateWarned = false;
    this.starGroup.clear();
    this.soldierGroup.clear();
    this.beams.forEach((b) => this.group.remove(b.mesh));
    this.beams = [];
    this.sparks.clear();

    // Stars: point-symmetric so neither side has the better field, kept clear of the gates.
    this.stars = [];
    const want = Math.ceil(this.cfg.stars / 2) * 2;
    const addStar = (p) => {
      const box = new THREE.Box3(p.clone().subScalar(STAR), p.clone().addScalar(STAR));
      const mesh = new THREE.Mesh(this.starGeo, this.starMat);
      mesh.position.copy(p);
      mesh.add(new THREE.LineSegments(this.starEdgeGeo, this.starEdge));
      this.starGroup.add(mesh);
      this.stars.push({ p, box });
    };
    let tries = 0;
    while (this.stars.length < want && tries++ < 800) {
      const p = new THREE.Vector3().randomDirection().multiplyScalar(rand(4, 16)).round();
      if (p.y < 1.5 || (Math.hypot(p.x, p.z) < 6 && p.y > 10)) continue;
      const q = p.clone().negate();
      if (this.stars.some((s) => s.p.distanceTo(p) < STAR * 4 || s.p.distanceTo(q) < STAR * 4)) continue;
      addStar(p);
      addStar(q);
    }

    // Soldiers. The player starts on the glass by our gate, facing down at Earth and their gate.
    const onCap = (top, polar, az) => new THREE.Vector3(Math.sin(polar) * Math.cos(az), (top ? 1 : -1) * Math.cos(polar), Math.sin(polar) * Math.sin(az)).multiplyScalar(RS - R);
    this.soldiers = [];
    this.player = new Soldier(0, DRAGON, 'Dragon', true);
    this.player.pos.copy(onCap(true, 0.2, Math.PI / 2));
    this.player.normal.copy(this.player.pos).normalize().negate();
    this.soldiers.push(this.player);
    this.quat.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), new THREE.Vector3(0, -1, -0.15), new THREE.Vector3(0, 0, -1)));

    const names = ['Bean', 'Alai', 'Petra', 'Crazy Tom', 'Hot Soup', 'Shen'];
    for (let i = 0; i < this.cfg.allies; i++) {
      const s = new Soldier(0, DRAGON, 'Dragon');
      s.name = names[i];
      s.pos.copy(onCap(true, rand(0.3, 0.55), (i / this.cfg.allies) * TAU));
      s.normal.copy(s.pos).normalize().negate();
      this.add(s);
    }
    this.enemyTotal = 0;
    this.cfg.enemies.forEach((army, ai) => {
      for (let i = 0; i < army.n; i++) {
        const s = new Soldier(1, army.color, army.army);
        s.pos.copy(onCap(false, rand(0.25, 0.6), (i / army.n) * TAU + ai * 0.4));
        s.normal.copy(s.pos).normalize().negate();
        this.add(s);
        this.enemyTotal++;
      }
    });
    const ec = this.cfg.enemies[0].color;
    this.gates[1].userData.ringM.color.copy(hdr(ec, 3));
    this.gates[1].userData.disc.material.color.copy(hdr(ec, 1.5));
    this.app.hud.banner(this.cfg.name, this.cfg.intro);
    this.app.hud.toast('The enemy\'s gate is down.', 3500);
  }

  add(s) {
    this.soldiers.push(s);
    s.mesh.position.copy(s.pos);
    this.soldierGroup.add(s.mesh);
  }

  enter(index = 0) {
    this.build();
    this.group.visible = true;
    const { stage } = this.app;
    stage.scene.background = null;
    stage.scene.fog = null;
    stage.scene.environment = this.env;
    stage.focusDist = 5;
    stage.post.setBloom({ strength: 0.55, radius: 0.45, threshold: 0.92 });
    this.sparks.scale = stage.post.q.particles;
    const cam = stage.cam;
    cam.near = 0.05;
    cam.far = 2000;
    cam.updateProjectionMatrix();
    this.app.hud.mode('room');
    this.start(index);
  }

  exit() {
    this.group.visible = false;
    this.app.stage.scene.environment = null;
    this.app.input.unlock();
  }

  // ── physics ───────────────────────────────────────────────────────────────────────────────

  /** Move a drifting soldier, bouncing (frozen) or grabbing (alive) on contact. */
  move(s, dt) {
    if (s.anchored) return;
    s.pos.addScaledVector(s.vel, dt);
    let hitN = null;
    const r = s.pos.length();
    if (r > RS - R) {
      hitN = s.pos.clone().divideScalar(r).negate();
      s.pos.setLength(RS - R);
    }
    for (const st of this.stars) {
      const c = st.box.clampPoint(s.pos, new THREE.Vector3());
      const d = s.pos.distanceTo(c);
      if (d < R) {
        const n = d > 1e-4 ? s.pos.clone().sub(c).divideScalar(d) : s.pos.clone().sub(st.p).normalize();
        s.pos.copy(c).addScaledVector(n, R);
        hitN = n;
      }
    }
    if (!hitN) return;
    if (s.frozen) {
      const vn = s.vel.dot(hitN);
      if (vn < 0) s.vel.addScaledVector(hitN, -1.7 * vn).multiplyScalar(0.8);
      return;
    }
    if (s.isPlayer && s.vel.length() > 2) this.app.sfx.bump();
    s.vel.set(0, 0, 0);
    s.anchored = true;
    s.normal.copy(hitN);
  }

  launch(s, dir, speed) {
    // You can't push off into the thing you're holding.
    if (dir.dot(s.normal) < 0.05) dir = dir.clone().addScaledVector(s.normal, 0.2 - dir.dot(s.normal)).normalize();
    s.vel.copy(dir).multiplyScalar(speed);
    s.anchored = false;
    s.pos.addScaledVector(s.normal, 0.05);
  }

  /** Line of fire from a to b: blocked by a star? */
  clear(a, b) {
    const dir = b.clone().sub(a);
    const len = dir.length();
    const ray = new THREE.Ray(a, dir.divideScalar(len));
    const hit = new THREE.Vector3();
    return !this.stars.some((st) => ray.intersectBox(st.box, hit) && hit.distanceTo(a) < len - 0.3);
  }

  /** Fire a flash beam. Hit-tests from `from`, draws from `visFrom`. Returns the soldier hit. */
  fire(from, dir, shooter, visFrom = from) {
    const ray = new THREE.Ray(from, dir);
    let best = RS * 2, target = null, limb = false;
    const hit = new THREE.Vector3();
    for (const st of this.stars) if (ray.intersectBox(st.box, hit)) best = Math.min(best, hit.distanceTo(from));
    // The glass: where the ray leaves the sphere.
    const b = from.dot(dir), c = from.lengthSq() - RS * RS;
    best = Math.min(best, -b + Math.sqrt(Math.max(0, b * b - c)));
    for (const s of this.soldiers) {
      if (s === shooter || s.frozen) continue;
      const toS = s.pos.clone().sub(from);
      const t = toS.dot(dir);
      if (t < 0 || t > best) continue;
      const miss = toS.addScaledVector(dir, -t).length();
      if (miss < 0.75) { best = t; target = s; limb = miss > 0.32; }
    }
    const end = from.clone().addScaledVector(dir, best);
    const col = shooter.team === 0 ? '#ffb070' : shooter.color;
    this.beam(visFrom, end, col);
    this.sparks.emit(end, target ? 26 : 10, target ? '#bfe8ff' : col, target ? 5 : 3, 0.6);
    if (target) this.hitSoldier(target, limb, shooter);
    return target;
  }

  hitSoldier(s, limb, shooter) {
    s.hits += limb && !s.isPlayer ? 0.5 : 1;
    if (s.isPlayer) {
      const left = s.maxHits - s.hits;
      this.app.hud.flash();
      if (left > 0) this.app.hud.toast(left === 2 ? 'Legs frozen: weaker push-offs.' : 'Arm frozen: one more hit and you\'re out.', 2200);
    }
    if (s.hits >= s.maxHits) {
      s.freeze();
      this.sparks.emit(s.pos, 60, '#cdeeff', 3, 1.2);
      this.app.sfx.frozen();
      if (shooter.isPlayer) this.app.hud.toast(`${s.army} soldier frozen`, 900);
      else if (s.team === 0 && s.name) this.app.hud.toast(`${s.name} is frozen`, 1400);
    }
  }

  beam(a, b, color) {
    // A white-hot core inside a coloured glow; both bloom.
    const len = a.distanceTo(b);
    const mk = (r, col, op) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      this.group.add(m);
      return m;
    };
    this.beams.push({ mesh: mk(0.022, hdr('#ffffff', 4), 1), life: 0.2, op: 1 });
    this.beams.push({ mesh: mk(0.09, hdr(color, 2), 0.6), life: 0.2, op: 0.6 });
  }

  // ── AI ────────────────────────────────────────────────────────────────────────────────────

  think(s, dt) {
    if (s.frozen || !s.anchored || this.time < 2.5) return; // nobody fires while the gates open
    s.think -= dt;
    if (s.think > 0) return;
    const cfg = this.cfg;
    const skill = s.team === 1 ? cfg.skill : 0.55;
    s.think = rand(0.6, 1.4) * cfg.react;
    const foes = this.soldiers.filter((o) => o.team !== s.team && !o.frozen && o.pos.distanceTo(s.pos) < 32 && this.clear(s.pos, o.pos));
    if (foes.length && Math.random() < 0.7) {
      const o = foes.reduce((a, b) => (a.pos.distanceTo(s.pos) < b.pos.distanceTo(s.pos) ? a : b));
      const lead = o.pos.clone().addScaledVector(o.vel, o.pos.distanceTo(s.pos) / 80);
      const err = (1 - skill) * 0.16 * (1 + o.pos.distanceTo(s.pos) / 20) * (o.isPlayer ? 1.4 : 1);
      const dir = lead.sub(s.pos).normalize().add(new THREE.Vector3().randomDirection().multiplyScalar(rand(0, err))).normalize();
      this.fire(s.pos.clone().addScaledVector(dir, 0.7), dir, s);
      s.mesh.lookAt(o.pos);
      if (o.isPlayer || s.pos.distanceTo(this.player.pos) < 20) this.app.sfx.flash();
      return;
    }
    // Hop toward the enemy gate, star to star, with a little nerve and a little caution.
    const goal = new THREE.Vector3(0, (s.team === 0 ? -1 : 1) * RS * 0.9, 0);
    const near = this.stars.filter((st) => st.p.distanceTo(s.pos) < 22 && st.p.distanceTo(s.pos) > 3);
    let dest;
    if (near.length && Math.random() < 0.85) {
      near.sort((a, b) => a.p.distanceTo(goal) + rand(0, 12) - (b.p.distanceTo(goal) + rand(0, 12)));
      dest = near[0].p.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(STAR + 0.4));
    } else {
      dest = goal.clone().add(new THREE.Vector3(rand(-8, 8), 0, rand(-8, 8)));
    }
    this.launch(s, dest.sub(s.pos).normalize(), rand(5, 8));
  }

  /** Their gate opens once half their army is frozen (a rush past a full army doesn't count). */
  gateOpen() {
    return this.soldiers.filter((s) => s.team === 1 && s.frozen).length >= this.enemyTotal / 2;
  }

  // ── frame ─────────────────────────────────────────────────────────────────────────────────

  update(dt) {
    const { input, stage, hud, sfx } = this.app;
    const p = this.player;
    this.time += dt;

    // Look: free rotation, no up in zero-g. Q/E roll.
    if (!this.over) {
      const yaw = -input.dx * 0.0025, pitch = -input.dy * 0.0025, roll = input.axis('KeyE', 'KeyQ') * 1.6 * dt;
      const dq = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw + input.axis('ArrowRight', 'ArrowLeft') * 1.8 * dt, roll, 'YXZ'));
      this.quat.multiply(dq).normalize();
    }
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quat);

    if (!this.over && !p.frozen) {
      if (input.clicks.length && !input.locked) input.lock();
      // Push off: hold Space (or right mouse) to charge, release to go.
      const holding = input.key('Space') || (input.buttons & 2);
      if (p.anchored && holding) this.charge = Math.min(1, this.charge + dt * 1.1);
      if (p.anchored && !holding && this.charge > 0) {
        const legs = p.hits >= 1 ? 0.7 : 1;
        this.launch(p, fwd, (4 + this.charge * 10) * legs);
        sfx.push();
        this.charge = 0;
      }
      if (!p.anchored) this.charge = 0;
      // Fire: left click or F, about four shots a second.
      this.cool = Math.max(0, (this.cool ?? 0) - dt);
      if (((input.locked && input.buttons & 1) || input.key('KeyF')) && this.cool === 0) {
        this.cool = 0.25;
        sfx.flash();
        // Hit-test from the eye (the crosshair); draw the beam from low and to the right, like a gun
        // held at the hip. No gun model: anything that close to the eyes is too much depth on a 3D panel.
        const hip = p.pos.clone().addScaledVector(fwd, 0.8).add(new THREE.Vector3(0.28, -0.22, 0).applyQuaternion(this.quat));
        const shot = this.fire(p.pos.clone(), fwd, p, hip);
        if (shot) hud.hitmarker();
      }
    }

    for (const s of this.soldiers) {
      if (!s.isPlayer) this.think(s, dt);
      this.move(s, dt);
      if (!s.mesh) continue;
      s.mesh.position.copy(s.pos);
      if (s.frozen) s.mesh.rotateOnAxis(new THREE.Vector3(1, 0.3, 0).normalize(), dt * 0.8);
      else if (s.anchored) {
        // Feet on the thing we hold.
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), s.normal);
        s.mesh.quaternion.slerp(q, 1 - Math.exp(-6 * dt));
        s.mesh.position.addScaledVector(s.normal, 0.25);
      } else {
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), s.vel.clone().normalize());
        s.mesh.quaternion.slerp(q, 1 - Math.exp(-3 * dt));
      }
    }

    for (const b of this.beams) {
      b.life -= dt;
      b.mesh.material.opacity = Math.max(0, b.life / 0.2) * b.op;
      if (b.life <= 0) { this.group.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); }
    }
    this.beams = this.beams.filter((b) => b.life > 0);
    this.sparks.update(dt);
    this.earth.rotation.y += dt * 0.004;
    this.clouds.rotation.y += dt * 0.002;

    // Camera = the player's eyes; the sky follows so it stays at infinity.
    stage.cam.position.copy(p.pos);
    stage.cam.quaternion.copy(this.quat);
    this.sky.position.copy(p.pos);
    // Converge on what you're looking at, so the star in front of you sits at the glass.
    const look = new THREE.Ray(p.pos, fwd);
    let dist = 30;
    const hit = new THREE.Vector3();
    for (const st of this.stars) if (look.intersectBox(st.box, hit)) dist = Math.min(dist, hit.distanceTo(p.pos));
    stage.focusDist = damp(stage.focusDist, clamp(dist, 2.5, 9), 3, dt);

    const open = this.gateOpen();
    this.gates[1].userData.disc.material.opacity = open ? 0.45 + Math.sin(this.time * 4) * 0.15 : 0.08;
    this.checkEnd();
    const frozen = this.soldiers.filter((s) => s.team === 1 && s.frozen).length;
    const allies = this.soldiers.filter((s) => s.team === 0 && !s.isPlayer && !s.frozen).length;
    hud.room({
      enemies: `${frozen}/${this.enemyTotal}`, allies, suit: p.maxHits - p.hits, charge: this.charge,
      state: p.frozen ? 'FROZEN' : p.anchored ? 'HOLDING' : `DRIFT ${p.vel.length().toFixed(1)} m/s`,
      gate: p.pos.distanceTo(new THREE.Vector3(0, -RS, 0)).toFixed(0) + (open ? ' m, open' : ' m, locked'),
    });
  }

  checkEnd() {
    if (this.over) return;
    const p = this.player;
    const { hud, sfx } = this.app;
    const enemiesLeft = this.soldiers.some((s) => s.team === 1 && !s.frozen);
    const atGate = !p.frozen && p.pos.y < -(RS - R - 0.6) && Math.hypot(p.pos.x, p.pos.z) < GATE;
    let result = null;
    if (!enemiesLeft) result = { win: true, text: 'Every enemy soldier is frozen. Dragon Army wins.' };
    else if (atGate && this.gateOpen()) result = { win: true, text: 'You went through their gate while they were still fighting. It counts. Dragon Army wins.' };
    else if (p.frozen) result = { win: false, text: 'Your suit locked up. A commander who is frozen can\'t give orders.' };
    if (atGate && !result && !this.gateWarned) {
      this.gateWarned = true;
      hud.toast('Their gate stays shut until half their army is frozen.', 2600);
    }
    if (!atGate) this.gateWarned = false;
    if (!result) return;
    this.over = true;
    this.app.input.unlock();
    result.win ? sfx.win() : sfx.lose();
    const next = this.level + 1 < ROOM_BATTLES.length;
    setTimeout(() => hud.end({
      title: result.win ? 'Victory' : 'Frozen',
      text: `${result.text} Time: ${this.time.toFixed(0)} s.`,
      actions: [
        result.win && next ? { label: 'Next battle', go: () => this.start(this.level + 1), primary: true } : null,
        result.win && !next ? { label: 'Go to Command School', go: () => this.app.go('console', 0), primary: true } : null,
        { label: result.win ? 'Replay' : 'Try again', go: () => this.start(this.level), primary: !result.win },
        { label: 'Main menu', go: () => this.app.menu() },
      ].filter(Boolean),
    }), 900);
  }
}
