// The fleet battle: human squadrons against the formic swarm. One simulation, drawn two ways by
// campaign.js: as a hologram above Ender's simulator table, or full size in space when you fly
// one of the fighters yourself.
//
// The Molecular Detachment Device (the "Little Doctor") is the trick of the war: its field breaks
// a ship apart, and the field jumps to anything packed close enough, friend or foe. Formics fly in
// tight formations, so one shot into a dense swarm takes out dozens. Get it close to the planet and
// it takes the planet.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, pick, rand, TAU } from './util.js';

export const SQUADS = [
  { name: 'Bean', color: '#ffd23f' },
  { name: 'Petra', color: '#ff6f9f' },
  { name: 'Alai', color: '#5fd0ff' },
  { name: 'Dink', color: '#7dff8a' },
  { name: 'Crazy Tom', color: '#ff9a3f' },
  { name: 'Hot Soup', color: '#c69bff' },
];

export const FLEET_LEVELS = [
  {
    name: 'Simulation 1: First Contact',
    intro: 'Three squadrons against two formic clusters. Learn the console.',
    squads: 3, md: 1,
    swarm: [{ n: 16, at: [220, 0, -60], spread: 30, shape: 'ball' }, { n: 14, at: [240, 40, 90], spread: 28, shape: 'ball' }],
  },
  {
    name: 'Simulation 2: Pincer',
    intro: 'They split up and one cluster swings round behind you. Watch your rear.',
    squads: 4, md: 1,
    swarm: [{ n: 24, at: [230, 0, 0], spread: 34, shape: 'ball' }, { n: 18, at: [120, -60, 230], spread: 30, shape: 'ball', flank: true },
      { n: 18, at: [120, 60, -230], spread: 30, shape: 'ball', flank: true }],
  },
  {
    name: 'Simulation 3: The Globe',
    intro: 'A hollow sphere of ships, closing around you. Find the weak spot, or make one.',
    squads: 5, md: 1,
    swarm: [{ n: 90, at: [0, 0, 0], spread: 200, shape: 'shell', closing: true }],
    humansAt: [0, 0, 0],
  },
  {
    name: 'Final Examination',
    intro: 'Their home world. The odds are a thousand to one. Your teachers are watching.',
    squads: 6, md: 2, planet: { at: [260, 0, 0], r: 70 },
    swarm: [
      { n: 110, at: [260, 0, 0], spread: 120, shape: 'shell' },
      { n: 70, at: [260, 0, 0], spread: 170, shape: 'shell' },
      { n: 30, at: [90, 30, -80], spread: 26, shape: 'ball' },
      { n: 30, at: [90, -30, 80], spread: 26, shape: 'ball' },
    ],
    final: true,
  },
];

const H_SPEED = 46, F_SPEED = 38;
const RANGE = 42;
export const MD_RANGE = 150;
const CHAIN = 21; // Little Doctor field jump distance
const MAX_EXPL = 260, MAX_LASER = 500;

// ── ship models ───────────────────────────────────────────────────────────────────────────────

function fighterGeo() {
  const body = new THREE.ConeGeometry(0.9, 5, 6);
  body.rotateX(-Math.PI / 2); // tip to -z, then turn round so +z is the nose
  body.rotateY(Math.PI);
  const wing = new THREE.BoxGeometry(5.2, 0.15, 1.4);
  wing.translate(0, 0, -0.9);
  const fin = new THREE.BoxGeometry(0.15, 1.2, 1.2);
  fin.translate(0, 0.6, -1.7);
  const pods = [-2.5, 2.5].map((x) => { const p = new THREE.CylinderGeometry(0.25, 0.25, 1.8, 6); p.rotateX(Math.PI / 2); p.translate(x, 0, -0.8); return p; });
  return mergeGeometries([body, wing, fin, ...pods].map((g) => (g.index ? g.toNonIndexed() : g)));
}

function formicGeo() {
  const core = new THREE.IcosahedronGeometry(1.6, 1);
  core.scale(1, 0.75, 1.5);
  const parts = [core];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const s = new THREE.ConeGeometry(0.35, 2.4, 5);
    s.rotateZ(Math.PI / 2);
    s.rotateY(a);
    s.translate(Math.cos(a) * 1.6, 0, -Math.sin(a) * 1.6 - 0.6);
    parts.push(s);
  }
  const eye = new THREE.SphereGeometry(0.6, 8, 6);
  eye.translate(0, 0.3, 1.9);
  parts.push(eye);
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
}

function planetTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#5a3a2a';
  g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * 512, y = Math.random() * 256, r = rand(2, 22);
    g.fillStyle = pick(['#7a4a2e', '#3b2a22', '#8f6a3a', '#2f4a3a', '#6b3b4b']);
    g.globalAlpha = rand(0.15, 0.5);
    g.beginPath(); g.ellipse(x, y, r * 1.6, r, 0, 0, TAU); g.fill();
  }
  // Hive lights on the night side.
  g.globalAlpha = 1;
  for (let i = 0; i < 400; i++) {
    g.fillStyle = pick(['#ffb85a', '#ff7a3a']);
    g.fillRect(Math.random() * 512, Math.random() * 256, 1.5, 1.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function labelSprite(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = '700 34px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.shadowColor = color;
  g.shadowBlur = 10;
  g.fillText(text.toUpperCase(), 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set(64, 16, 1);
  return s;
}

// ── the simulation ────────────────────────────────────────────────────────────────────────────

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();
const HULL = new THREE.Color(0.85, 0.87, 0.9);

export class Fleet {
  constructor(app) {
    this.app = app;
    this.root = new THREE.Group(); // everything in battle units; campaign.js scales and places it
    this.holo = false;
    this.shipScale = 1;

    this.mats = {
      human: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35, metalness: 0.6 }),
      formic: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7, metalness: 0.1, emissive: '#3a0a12', emissiveIntensity: 0.6 }),
      holo: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
      holoF: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    };
    this.humanMesh = new THREE.InstancedMesh(fighterGeo(), this.mats.human, 64);
    this.formicMesh = new THREE.InstancedMesh(formicGeo(), this.mats.formic, 400);
    for (const m of [this.humanMesh, this.formicMesh]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.setColorAt(0, _c.set('#fff'));
      this.root.add(m);
    }

    // Explosions and Little Doctor flashes: additive spheres that fade to black.
    this.explMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshBasicMaterial({ color: '#ffffff', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }), MAX_EXPL);
    this.explMesh.frustumCulled = false;
    this.explMesh.setColorAt(0, _c.set('#000'));
    this.root.add(this.explMesh);
    this.expl = [];

    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_LASER * 6), 3).setUsage(THREE.DynamicDrawUsage));
    lg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_LASER * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.laserMesh = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    this.laserMesh.frustumCulled = false;
    this.root.add(this.laserMesh);
    this.lasers = [];

    this.mdBolt = new THREE.Mesh(new THREE.SphereGeometry(2.2, 12, 8), new THREE.MeshBasicMaterial({ color: '#e8fbff' }));
    this.mdBolt.visible = false;
    this.root.add(this.mdBolt);

    // Planet (final level): a real globe in space, a wire globe in the hologram.
    this.planet = new THREE.Group();
    this.planetSolid = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), new THREE.MeshStandardMaterial({ map: planetTexture(), roughness: 0.9, emissive: '#ffffff', emissiveMap: null, emissiveIntensity: 0 }));
    this.planetWire = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: '#ff5a6a', wireframe: true, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.planet.add(this.planetSolid, this.planetWire);
    this.planet.visible = false;
    this.root.add(this.planet);

    // Order markers and squad labels (hologram only).
    this.markers = new THREE.Group();
    this.root.add(this.markers);
    this.labels = SQUADS.map((s) => labelSprite(s.name, s.color));
    this.labels.forEach((l) => this.markers.add(l));
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SQUADS.length * 6), 3));
    lineGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(SQUADS.length * 6), 3));
    this.orderLines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false }));
    this.orderLines.frustumCulled = false;
    this.markers.add(this.orderLines);
    this.rings = SQUADS.map((s) => {
      const r = new THREE.Mesh(new THREE.RingGeometry(9, 11, 32), new THREE.MeshBasicMaterial({ color: s.color, side: THREE.DoubleSide, transparent: true, opacity: 0.8, depthWrite: false }));
      r.rotation.x = -Math.PI / 2;
      this.markers.add(r);
      return r;
    });
  }

  setHolo(on) {
    this.holo = on;
    this.humanMesh.material = on ? this.mats.holo : this.mats.human;
    this.formicMesh.material = on ? this.mats.holoF : this.mats.formic;
    this.shipScale = on ? 3.2 : 1;
    this.planetSolid.visible = !on;
    this.planetWire.visible = on;
    this.markers.visible = on;
    this.laserMesh.material.opacity = on ? 0.9 : 1;
    // In space the hulls are mostly grey with a squadron tint; on the table they glow in full colour.
    for (const s of this.ships ?? []) {
      _c.copy(s.color);
      if (!on && s.team === 0) _c.lerp(HULL, 0.6);
      (s.team === 0 ? this.humanMesh : this.formicMesh).setColorAt(s.idx, _c);
    }
    if (this.ships) this.humanMesh.instanceColor.needsUpdate = this.formicMesh.instanceColor.needsUpdate = true;
  }

  // ── set-up ────────────────────────────────────────────────────────────────────────────────

  start(index) {
    const L = (this.level = FLEET_LEVELS[index]);
    this.index = index;
    this.time = 0;
    this.over = null;
    this.ships = [];
    this.expl = [];
    this.lasers = [];
    this.md = null;
    this.planetHp = L.planet ? 1 : 0;
    this.planetDying = 0;

    this.squads = SQUADS.slice(0, L.squads).map((s, i) => ({
      ...s, i, ships: [], md: L.md, mdMax: L.md, order: { type: 'move', point: new THREE.Vector3() }, anchor: new THREE.Vector3(),
    }));
    const base = new THREE.Vector3(...(L.humansAt ?? [-300, 0, 0]));
    this.squads.forEach((sq, i) => {
      const a = (i / this.squads.length) * TAU;
      const c = base.clone().add(L.humansAt ? new THREE.Vector3(Math.cos(a) * 40, Math.sin(a) * 25, Math.sin(a) * 40) : new THREE.Vector3(0, (i % 2 ? 1 : -1) * 18 * Math.ceil(i / 2), (i - (this.squads.length - 1) / 2) * 50));
      sq.anchor.copy(c);
      sq.order.point.copy(c);
      for (let k = 0; k < 6; k++) {
        const off = new THREE.Vector3((k % 3 - 1) * 15, (k < 3 ? 1 : -1) * 5, Math.floor(k / 3) * -14);
        this.ships.push(this.ship(0, c.clone().add(off), sq, off));
      }
    });

    this.clusters = L.swarm.map((w) => ({ ...w, anchor: new THREE.Vector3(...w.at), active: !!w.closing, shellR: w.spread }));
    for (const cl of this.clusters) {
      for (let k = 0; k < cl.n; k++) {
        let off;
        if (cl.shape === 'shell') {
          // Fibonacci sphere: an even shell, packed tight enough to chain.
          const y = 1 - (2 * (k + 0.5)) / cl.n, r = Math.sqrt(1 - y * y), th = k * 2.39996;
          off = new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r).multiplyScalar(cl.spread);
        } else off = new THREE.Vector3().randomDirection().multiplyScalar(cl.spread * Math.cbrt(Math.random()));
        const s = this.ship(1, cl.anchor.clone().add(off), null, off);
        s.cluster = cl;
        this.ships.push(s);
      }
    }
    if (L.planet) {
      this.planet.position.set(...L.planet.at);
      this.planet.scale.setScalar(L.planet.r);
      this.planet.visible = true;
      this.planetSolid.material.emissiveIntensity = 0;
    } else this.planet.visible = false;
    this.humanMesh.count = this.ships.filter((s) => s.team === 0).length;
    this.formicMesh.count = this.ships.filter((s) => s.team === 1).length;
    let hi = 0, fi = 0;
    for (const s of this.ships) s.idx = s.team === 0 ? hi++ : fi++;
    for (const s of this.ships) {
      const col = s.team === 0 ? s.squad.color : pick(['#b0303e', '#c24a2a', '#8f2a55']);
      s.color = new THREE.Color(col);
      (s.team === 0 ? this.humanMesh : this.formicMesh).setColorAt(s.idx, s.color);
    }
    this.humanMesh.instanceColor.needsUpdate = this.formicMesh.instanceColor.needsUpdate = true;
  }

  ship(team, pos, squad, offset) {
    const s = {
      team, squad, offset, pos, vel: new THREE.Vector3(team ? -1 : 1, 0, 0).multiplyScalar(5), quat: new THREE.Quaternion(),
      hp: team ? 3 : 6, alive: true, cd: rand(0, 1), target: null, retarget: rand(0, 0.5), md: -1, isPlayer: false,
    };
    s.quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), s.vel.clone().normalize());
    if (squad) squad.ships.push(s);
    return s;
  }

  alive(team) { return this.ships.filter((s) => s.alive && s.team === team); }
  centroid(sq) {
    const live = sq.ships.filter((s) => s.alive);
    if (!live.length) return null;
    return live.reduce((a, s) => a.add(s.pos), new THREE.Vector3()).divideScalar(live.length);
  }

  // ── orders ────────────────────────────────────────────────────────────────────────────────

  orderMove(sq, point) { sq.order = { type: 'move', point: point.clone() }; }
  orderAttack(sq, target) { sq.order = { type: 'attack', target, point: target.pos.clone() }; }

  /** Fire a squad's Little Doctor from the ship nearest the target. Returns a message. */
  fireMD(sq, from = null, aimDir = null) {
    if (!sq || sq.md <= 0) return { ok: false, msg: `${sq?.name ?? 'That squadron'} has no Little Doctor charges left.` };
    if (this.md) return { ok: false, msg: 'A Little Doctor is already in flight.' };
    const shooters = from ? [from] : sq.ships.filter((s) => s.alive);
    if (!shooters.length) return { ok: false, msg: `${sq.name}'s squadron is gone.` };
    // Aim where it does the most good: the densest knot of formics, away from our own fighters.
    const humans = this.alive(0);
    let best = null, bestScore = -Infinity, shooter = null;
    for (const sh of shooters) {
      if (this.planet.visible && this.planetHp > 0) {
        const d = sh.pos.distanceTo(this.planet.position) - this.planet.scale.x;
        if (d < MD_RANGE && (!aimDir || _v.copy(this.planet.position).sub(sh.pos).normalize().dot(aimDir) > 0.85)) {
          best = 'planet'; shooter = sh; break;
        }
      }
      for (const f of this.ships) {
        if (!f.alive || f.team !== 1 || f.md >= 0) continue;
        const d = f.pos.distanceTo(sh.pos);
        if (d > MD_RANGE) continue;
        if (aimDir && _v.copy(f.pos).sub(sh.pos).normalize().dot(aimDir) < 0.9) continue;
        let score = 0;
        for (const o of this.ships) if (o.alive && o.team === 1 && o.pos.distanceToSquared(f.pos) < CHAIN * CHAIN * 4) score++;
        for (const h of humans) if (h.pos.distanceToSquared(f.pos) < 30 * 30) score -= 4;
        score -= d / 100;
        if (score > bestScore) { bestScore = score; best = f; shooter = sh; }
      }
    }
    if (!best) return { ok: false, msg: `Nothing in Little Doctor range (${MD_RANGE}). Close in.` };
    sq.md--;
    this.md = { pos: shooter.pos.clone(), target: best, sq };
    this.mdBolt.visible = true;
    this.app.sfx.doctor();
    return { ok: true, msg: best === 'planet' ? 'Little Doctor away. Target: the planet.' : 'Little Doctor away.' };
  }

  disrupt(s, delay) {
    if (!s.alive || s.md >= 0) return;
    s.md = delay;
  }

  // ── frame ─────────────────────────────────────────────────────────────────────────────────

  update(dt, player) {
    if (this.over) dt *= 0.4;
    this.time += dt;
    const humans = this.alive(0), formics = this.alive(1);

    // Swarm brains: a cluster wakes when a human comes near, or when the clock says so.
    for (const cl of this.clusters) {
      if (!cl.active) {
        const near = humans.some((h) => h.pos.distanceTo(cl.anchor) < cl.spread + 140);
        if (near || this.time > (cl.flank ? 25 : cl.shape === 'shell' ? 1e9 : 45)) cl.active = true;
      }
      if (cl.flank && cl.active && humans.length) {
        // Flankers aim at the human rear.
        const back = humans.reduce((a, h) => a.add(h.pos), new THREE.Vector3()).divideScalar(humans.length).add(new THREE.Vector3(-80, 0, 0));
        cl.anchor.lerp(back, 1 - Math.exp(-0.15 * dt));
      }
      if (cl.closing) cl.shellR = Math.max(60, cl.shellR - dt * 3.2);
    }

    for (const sq of this.squads) {
      const o = sq.order;
      if (o.type === 'attack') {
        if (!o.target?.alive) {
          // Pick the next nearest ship in the same cluster, else go hold where it died.
          const c = this.centroid(sq);
          const next = c && formics.filter((f) => f.cluster === o.target?.cluster).sort((a, b) => a.pos.distanceTo(c) - b.pos.distanceTo(c))[0];
          if (next) o.target = next; else sq.order = { type: 'move', point: o.point.clone() };
        }
        if (o.target?.alive) o.point.copy(o.target.pos);
      }
      sq.anchor.copy(sq.order.point);
    }

    for (const s of this.ships) {
      if (!s.alive) continue;
      if (s.md >= 0) {
        s.md -= dt;
        if (s.md < 0) this.kill(s, true);
        continue;
      }
      if (s === player) continue; // flown by the player (campaign.js)
      this.steer(s, dt, s.team === 0 ? formics : humans);
    }

    // Little Doctor bolt.
    if (this.md) {
      const m = this.md;
      const tp = m.target === 'planet' ? this.planet.position : m.target.pos;
      const toT = _v.copy(tp).sub(m.pos);
      const reach = m.target === 'planet' ? this.planet.scale.x : 4;
      if (toT.length() <= reach + 3 || (m.target !== 'planet' && !m.target.alive)) {
        if (m.target === 'planet') this.killPlanet();
        else {
          // Detonate where it is: everything within the field starts to come apart.
          this.flash(m.pos, 30, '#ffffff', 1.2);
          for (const s of this.ships) if (s.alive && s.pos.distanceTo(m.pos) < (s.team ? CHAIN : 7)) this.disrupt(s, rand(0.05, 0.2));
        }
        this.md = null;
        this.mdBolt.visible = false;
      } else {
        m.pos.addScaledVector(toT.normalize(), Math.min(140 * dt, toT.length()));
        this.mdBolt.position.copy(m.pos);
        this.mdBolt.scale.setScalar(1 + Math.sin(this.time * 30) * 0.3);
      }
    }
    if (this.planetDying > 0) this.updatePlanetDeath(dt);
    else if (this.planet.visible) this.planet.rotation.y += dt * 0.02;

    this.draw(dt);
    this.checkEnd();
  }

  steer(s, dt, foes) {
    const isH = s.team === 0;
    const maxV = isH ? H_SPEED : F_SPEED;
    s.retarget -= dt;
    if (s.retarget <= 0) {
      s.retarget = rand(0.4, 0.8);
      const sq = s.squad, cl = s.cluster;
      let engage = isH ? (sq.order.type === 'attack' ? 120 : 60) : cl.shape === 'shell' ? (cl.active ? 110 : 60) : cl.active ? 600 : 70;
      if (isH && sq.order.type === 'attack' && sq.order.target?.alive && s.pos.distanceTo(sq.order.target.pos) < engage) s.target = sq.order.target;
      else {
        let best = null, bd = engage;
        for (const f of foes) { const d = f.pos.distanceToSquared(s.pos); if (d < bd * bd) { bd = Math.sqrt(d); best = f; } }
        // Humans on a move order only fight what's in their way.
        if (isH && sq.order.type === 'move' && s.pos.distanceTo(sq.anchor) > 80 && bd > 45) best = null;
        s.target = best;
      }
    }
    if (s.target && !s.target.alive) s.target = null;

    const desired = _w;
    if (s.target) {
      const d = s.pos.distanceTo(s.target.pos);
      desired.copy(s.target.pos).sub(s.pos).normalize();
      // Strafing runs: break off when close, swing back round.
      if (d < 16) desired.negate().add(_v.set(Math.sin(s.idx * 1.3), Math.cos(s.idx * 0.7), Math.sin(s.idx)).multiplyScalar(0.8)).normalize();
      desired.multiplyScalar(maxV);
    } else {
      const goal = isH
        ? _v.copy(s.squad.anchor).add(s.offset)
        : s.cluster.shape === 'shell'
          ? _v.copy(s.offset).normalize().multiplyScalar(s.cluster.shellR).add(s.cluster.anchor)
          : _v.copy(s.cluster.anchor).add(s.offset);
      desired.copy(goal).sub(s.pos);
      const d = desired.length();
      desired.multiplyScalar(d > 1e-3 ? (Math.min(maxV, d * 0.8) / d) : 0);
    }
    s.vel.lerp(desired, 1 - Math.exp(-(isH ? 1.6 : 1.1) * dt));
    // A shell holds its slot even under fire; free fighters don't drift to a dead stop.
    s.pos.addScaledVector(s.vel, dt);
    if (s.vel.lengthSq() > 4) {
      _q.setFromUnitVectors(_s.set(0, 0, 1), _v.copy(s.vel).normalize());
      s.quat.slerp(_q, 1 - Math.exp(-5 * dt));
    }

    s.cd -= dt;
    if (s.target && s.cd <= 0) {
      const to = _v.copy(s.target.pos).sub(s.pos);
      const d = to.length();
      if (d < RANGE && to.divideScalar(d).dot(_s.set(0, 0, 1).applyQuaternion(s.quat)) > 0.6) {
        s.cd = isH ? rand(0.5, 0.8) : rand(0.8, 1.3);
        this.shoot(s, s.target, isH ? 0.32 : 0.24);
      }
    }
  }

  shoot(s, t, chance) {
    const hit = Math.random() < chance;
    const end = hit ? t.pos : _v.copy(t.pos).add(_s.randomDirection().multiplyScalar(6));
    this.laser(s.pos, end, s.team === 0 ? (s.squad?.color ?? '#9fe0ff') : '#ff5a3a');
    if (hit) this.damage(t, 1);
    if (s.isPlayer || t.isPlayer) this.app.sfx.laser(1);
  }

  damage(t, n) {
    if (!t.alive || t.md >= 0) return;
    t.hp -= n;
    if (t.hp <= 0) this.kill(t, false);
  }

  kill(s, byMD) {
    if (!s.alive) return;
    s.alive = false;
    if (byMD) {
      this.flash(s.pos, 22, '#eaffff', 0.9);
      // The field jumps to everything packed close enough. Formic hulls carry it on; a human fighter
      // caught too close is lost, but its shielding stops the jump going any further.
      if (s.team === 1) {
        for (const o of this.ships) {
          if (!o.alive || o.md >= 0) continue;
          const r = o.team === 1 ? CHAIN : 7;
          if (o.pos.distanceToSquared(s.pos) < r * r) this.disrupt(o, rand(0.12, 0.3));
        }
      }
      if (this.planet.visible && this.planetHp > 0 && s.pos.distanceTo(this.planet.position) < this.planet.scale.x + CHAIN) this.killPlanet();
      this.app.sfx.boom(0.6);
    } else {
      this.flash(s.pos, 7, s.team === 0 ? '#ffc070' : '#ff7040', 0.6);
      this.app.sfx.boom(0.3);
    }
    if (s.isPlayer) this.onPlayerLost?.(s);
  }

  killPlanet() {
    if (this.planetHp <= 0) return;
    this.planetHp = 0;
    this.planetDying = 0.001;
    this.app.sfx.doctor();
  }

  updatePlanetDeath(dt) {
    this.planetDying += dt;
    const t = this.planetDying;
    const r0 = this.level.planet.r;
    this.planetSolid.material.emissiveIntensity = Math.min(3, t * 1.2);
    this.planetWire.material.color.set('#ffffff');
    if (t > 1.5) this.planet.scale.setScalar(r0 * Math.max(0.01, 1 - (t - 1.5) / 2));
    if (t < 3.5 && Math.random() < 0.6) this.flash(this.planet.position.clone().add(_v.randomDirection().multiplyScalar(r0 * rand(0.6, 1.2))), rand(15, 40), '#ffffff', 0.8);
    if (t > 1 && t < 1.1) for (const s of this.ships) if (s.alive && s.pos.distanceTo(this.planet.position) < r0 + (s.team ? 160 : 45)) this.disrupt(s, rand(0.2, 2.5));
    if (t > 3.5) { this.planet.visible = false; this.planetDying = 0; }
  }

  flash(pos, size, color, life) {
    if (this.expl.length >= MAX_EXPL) this.expl.shift();
    this.expl.push({ pos: pos.clone(), size, color: new THREE.Color(color), life, t: 0 });
  }

  laser(a, b, color) {
    if (this.lasers.length >= MAX_LASER) this.lasers.shift();
    this.lasers.push({ a: a.clone(), b: b.clone(), color: new THREE.Color(color), t: 0.14 });
  }

  // ── drawing ───────────────────────────────────────────────────────────────────────────────

  draw(dt) {
    const k = this.shipScale;
    for (const s of this.ships) {
      const mesh = s.team === 0 ? this.humanMesh : this.formicMesh;
      if (!s.alive) _m.makeScale(0, 0, 0);
      else {
        const sc = s.md >= 0 ? k * (1 + Math.random() * 0.4) : k;
        _m.compose(s.pos, s.quat, _s.setScalar(sc));
      }
      mesh.setMatrixAt(s.idx, _m);
      if (s.md >= 0) mesh.setColorAt(s.idx, _c.set('#ffffff'));
    }
    this.humanMesh.instanceMatrix.needsUpdate = this.formicMesh.instanceMatrix.needsUpdate = true;
    this.humanMesh.instanceColor.needsUpdate = this.formicMesh.instanceColor.needsUpdate = true;

    let n = 0;
    const ek = this.holo ? 1.6 : 1;
    for (const e of this.expl) {
      e.t += dt;
      const f = e.t / e.life;
      if (f >= 1) continue;
      _m.compose(e.pos, _q.identity(), _s.setScalar(e.size * ek * (0.3 + f * 0.9)));
      this.explMesh.setMatrixAt(n, _m);
      this.explMesh.setColorAt(n, _c.copy(e.color).multiplyScalar((1 - f) * (1 - f)));
      n++;
    }
    this.expl = this.expl.filter((e) => e.t < e.life);
    this.explMesh.count = n;
    this.explMesh.instanceMatrix.needsUpdate = true;
    if (this.explMesh.instanceColor) this.explMesh.instanceColor.needsUpdate = true;

    const pos = this.laserMesh.geometry.attributes.position, col = this.laserMesh.geometry.attributes.color;
    let j = 0;
    for (const l of this.lasers) {
      l.t -= dt;
      if (l.t <= 0) continue;
      const f = l.t / 0.14;
      pos.setXYZ(j * 2, l.a.x, l.a.y, l.a.z);
      pos.setXYZ(j * 2 + 1, l.b.x, l.b.y, l.b.z);
      col.setXYZ(j * 2, l.color.r * f, l.color.g * f, l.color.b * f);
      col.setXYZ(j * 2 + 1, l.color.r * f, l.color.g * f, l.color.b * f);
      j++;
    }
    this.lasers = this.lasers.filter((l) => l.t > 0);
    this.laserMesh.geometry.setDrawRange(0, j * 2);
    pos.needsUpdate = col.needsUpdate = true;

    if (this.holo) this.drawMarkers();
  }

  drawMarkers() {
    const lp = this.orderLines.geometry.attributes.position, lc = this.orderLines.geometry.attributes.color;
    SQUADS.forEach((s, i) => {
      const sq = this.squads[i];
      const c = sq && this.centroid(sq);
      const show = !!c;
      this.labels[i].visible = this.rings[i].visible = show;
      if (!show) { lp.setXYZ(i * 2, 0, 0, 0); lp.setXYZ(i * 2 + 1, 0, 0, 0); return; }
      this.labels[i].position.copy(c).add(_v.set(0, 32, 0));
      const sel = this.selected === sq;
      this.labels[i].material.opacity = sel ? 1 : 0.55;
      this.labels[i].scale.set(sel ? 150 : 110, sel ? 37 : 27, 1);
      this.rings[i].position.copy(sq.order.point);
      this.rings[i].scale.setScalar(sel ? 1.4 + Math.sin(this.time * 5) * 0.15 : 1);
      this.rings[i].material.opacity = sel ? 0.95 : 0.4;
      lp.setXYZ(i * 2, c.x, c.y, c.z);
      lp.setXYZ(i * 2 + 1, sq.order.point.x, sq.order.point.y, sq.order.point.z);
      _c.set(s.color).multiplyScalar(sel ? 1 : 0.4);
      lc.setXYZ(i * 2, _c.r, _c.g, _c.b);
      lc.setXYZ(i * 2 + 1, _c.r, _c.g, _c.b);
    });
    lp.needsUpdate = lc.needsUpdate = true;
  }

  checkEnd() {
    if (this.over) return;
    const h = this.ships.some((s) => s.alive && s.team === 0);
    const f = this.ships.some((s) => s.alive && s.team === 1);
    const planetGone = this.level.planet && this.planetHp <= 0;
    if ((!f && !this.md) || (planetGone && this.planetDying === 0)) this.over = { win: true, planet: planetGone };
    else if (!h) this.over = { win: false };
  }
}
