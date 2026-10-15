// The Battle Room: a 40 m zero-gravity cube in Battle School. You are the commander of Dragon
// Army, seen first person. Grab a star (the floating cover blocks) or a wall, aim, and hold Space
// to push off: you fly in a straight line until you hit something, so every jump is a decision.
// The flash gun freezes whatever it hits. Win by freezing the other army, or by reaching their
// gate. Their gate is in the floor of the room, so treat it as down.

import * as THREE from 'three';
import { clamp, damp, pick, rand, TAU } from './util.js';

const HALF = 20; // room half-size (m)
const R = 0.55; // soldier collision radius
const STAR = 1.4; // star half-size
const GATE = 3; // gate half-size

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
    enemies: [{ army: 'Rattlesnake', color: '#d64a3a', n: 9 }],
    allies: 4, skill: 0.6, react: 1.1, stars: 20,
  },
  {
    name: 'Dragon vs Griffin & Tiger',
    intro: 'Two armies at once. Nobody said it would be fair.',
    enemies: [{ army: 'Griffin', color: '#a46bff', n: 7 }, { army: 'Tiger', color: '#f2c230', n: 7 }],
    allies: 5, skill: 0.7, react: 0.95, stars: 22,
  },
];

const DRAGON = '#ff8a2a';

// ── look ──────────────────────────────────────────────────────────────────────────────────────

function gridTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#0a1220';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(90,170,255,0.35)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, 254, 254);
  g.strokeStyle = 'rgba(90,170,255,0.12)';
  g.lineWidth = 1;
  for (let i = 32; i < 256; i += 32) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.moveTo(0, i); g.lineTo(256, i); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10, 10);
  t.anisotropy = 4;
  return t;
}

function soldierMesh(color) {
  const g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.2, emissive: color, emissiveIntensity: 0.15 });
  const dark = new THREE.MeshStandardMaterial({ color: '#1a1f2a', roughness: 0.6 });
  const visor = new THREE.MeshStandardMaterial({ color: '#0b1730', roughness: 0.1, metalness: 0.8, emissive: '#2a6bff', emissiveIntensity: 0.4 });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
  add(new THREE.BoxGeometry(0.5, 0.62, 0.3), suit, 0, 0.1, 0);
  add(new THREE.SphereGeometry(0.21, 16, 12), suit, 0, 0.6, 0);
  add(new THREE.BoxGeometry(0.28, 0.12, 0.1), visor, 0, 0.62, 0.17);
  const limb = new THREE.CapsuleGeometry(0.08, 0.42, 4, 8);
  const armL = add(limb, suit, -0.33, 0.12, 0.05); armL.rotation.z = 0.35;
  const armR = add(limb, suit, 0.3, 0.2, 0.25); armR.rotation.x = -1.3;
  const legL = add(limb, suit, -0.13, -0.5, 0); legL.rotation.z = 0.12;
  const legR = add(limb, suit, 0.13, -0.5, 0); legR.rotation.z = -0.12;
  add(new THREE.BoxGeometry(0.08, 0.08, 0.32), dark, 0.3, 0.2, 0.48); // gun
  g.userData = { suit, legs: [legL, legR] };
  return g;
}

const FROZEN = new THREE.MeshStandardMaterial({ color: '#e9f6ff', roughness: 0.2, metalness: 0.1, emissive: '#9fd8ff', emissiveIntensity: 0.55 });

// ── soldiers ──────────────────────────────────────────────────────────────────────────────────

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
    this.mesh?.traverse((m) => { if (m.isMesh) m.material = FROZEN; });
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
    this.buildRoom();
  }

  buildRoom() {
    const g = this.group;
    const grid = gridTexture();
    // The grid glows on its own, so the walls read as walls from anywhere in the room.
    const wall = new THREE.MeshStandardMaterial({ map: grid, emissiveMap: grid, emissive: '#ffffff', emissiveIntensity: 0.9, roughness: 0.85, side: THREE.BackSide });
    g.add(new THREE.Mesh(new THREE.BoxGeometry(HALF * 2, HALF * 2, HALF * 2), wall));
    g.add(new THREE.AmbientLight('#8fb4ff', 1.1));
    const key = new THREE.DirectionalLight('#ffffff', 1.1);
    key.position.set(8, 30, 12);
    g.add(key);
    const fill = new THREE.PointLight('#5fa8ff', 80, 60, 1.5);
    fill.position.set(0, 0, 0);
    g.add(fill);

    // Corner lights, like the room's glowing seams.
    const seamMat = new THREE.MeshBasicMaterial({ color: '#6fb8ff' });
    for (const a of [-1, 1]) for (const b of [-1, 1]) {
      const s = 0.12, L = HALF * 2;
      [[L, s, s, 0, a * HALF, b * HALF], [s, L, s, a * HALF, 0, b * HALF], [s, s, L, a * HALF, b * HALF, 0]].forEach(([w, h, d, x, y, z]) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), seamMat);
        m.position.set(x, y, z);
        g.add(m);
      });
    }

    // Gates: ours in the ceiling, theirs in the floor.
    this.gates = [];
    for (const [y, color] of [[HALF - 0.05, DRAGON], [-HALF + 0.05, '#4fd8ff']]) {
      const gate = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color });
      for (const [w, d, x, z] of [[GATE * 2, 0.25, 0, GATE], [GATE * 2, 0.25, 0, -GATE], [0.25, GATE * 2, GATE, 0], [0.25, GATE * 2, -GATE, 0]]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), mat);
        m.position.set(x, 0, z);
        gate.add(m);
      }
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(GATE * 2, GATE * 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
      glow.rotation.x = Math.PI / 2;
      gate.add(glow);
      gate.position.y = y;
      g.add(gate);
      this.gates.push(gate);
    }

    this.starMat = new THREE.MeshStandardMaterial({ color: '#c9d6ea', roughness: 0.35, metalness: 0.5, emissive: '#2b4f80', emissiveIntensity: 0.35 });
    this.starEdge = new THREE.LineBasicMaterial({ color: '#8fd0ff' });
    this.starGeo = new THREE.BoxGeometry(STAR * 2, STAR * 2, STAR * 2);
    this.starEdgeGeo = new THREE.EdgesGeometry(this.starGeo);
    this.starGroup = new THREE.Group();
    g.add(this.starGroup);
    this.soldierGroup = new THREE.Group();
    g.add(this.soldierGroup);
  }

  // ── round set-up ──────────────────────────────────────────────────────────────────────────

  start(index) {
    this.level = index;
    this.cfg = ROOM_BATTLES[index];
    this.over = false;
    this.time = 0;
    this.charge = 0;
    this.starGroup.clear();
    this.soldierGroup.clear();
    this.beams.forEach((b) => this.group.remove(b.mesh));
    this.beams = [];

    // Stars: mirror-symmetric so neither side has the better field, kept off the gates.
    this.stars = [];
    const half = Math.ceil(this.cfg.stars / 2);
    const addStar = (p) => {
      const box = new THREE.Box3(p.clone().subScalar(STAR), p.clone().addScalar(STAR));
      const mesh = new THREE.Mesh(this.starGeo, this.starMat);
      mesh.position.copy(p);
      mesh.add(new THREE.LineSegments(this.starEdgeGeo, this.starEdge));
      this.starGroup.add(mesh);
      this.stars.push({ p, box });
    };
    let tries = 0;
    while (this.stars.length < half * 2 && tries++ < 500) {
      const p = new THREE.Vector3(rand(-15, 15), rand(2.5, 15), rand(-15, 15)).round();
      if (Math.hypot(p.x, p.z) < 5 && p.y > 11) continue;
      const q = new THREE.Vector3(-p.x, -p.y, -p.z);
      if (this.stars.some((s) => s.p.distanceTo(p) < STAR * 4 || s.p.distanceTo(q) < STAR * 4)) continue;
      addStar(p);
      addStar(q);
    }

    // Soldiers. The player starts on the ceiling by our gate, facing "down" at the enemy gate.
    this.soldiers = [];
    this.player = new Soldier(0, DRAGON, 'Dragon', true);
    this.player.pos.set(0, HALF - R, 4);
    this.player.normal.set(0, -1, 0);
    this.soldiers.push(this.player);
    this.quat.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), new THREE.Vector3(0, -1, -0.15), new THREE.Vector3(0, 0, -1)));

    const names = ['Bean', 'Alai', 'Petra', 'Crazy Tom', 'Hot Soup', 'Shen'];
    for (let i = 0; i < this.cfg.allies; i++) {
      const s = new Soldier(0, DRAGON, 'Dragon');
      s.name = names[i];
      s.pos.set(-6 + i * 3, HALF - R, rand(-4, 2));
      s.normal.set(0, -1, 0);
      this.add(s);
    }
    this.enemyTotal = 0;
    for (const army of this.cfg.enemies) {
      for (let i = 0; i < army.n; i++) {
        const s = new Soldier(1, army.color, army.army);
        const a = (i / army.n) * TAU + (army === this.cfg.enemies[1] ? 0.4 : 0);
        s.pos.set(Math.cos(a) * rand(4, 9), -HALF + R, Math.sin(a) * rand(4, 9));
        s.normal.set(0, 1, 0);
        this.add(s);
        this.enemyTotal++;
      }
    }
    this.gates[1].children.forEach((c) => c.material.color?.set(this.cfg.enemies[0].color));
    this.app.hud.banner(this.cfg.name, this.cfg.intro);
    this.app.hud.toast('The enemy\'s gate is down.', 3500);
  }

  add(s) {
    this.soldiers.push(s);
    s.mesh.position.copy(s.pos);
    this.soldierGroup.add(s.mesh);
  }

  enter(index = 0) {
    this.group.visible = true;
    this.app.stage.scene.background = new THREE.Color('#05080f');
    this.app.stage.scene.fog = null;
    this.app.stage.focusDist = 5;
    const cam = this.app.stage.cam;
    cam.near = 0.05;
    cam.far = 200;
    cam.updateProjectionMatrix();
    this.app.hud.mode('room');
    this.start(index);
  }

  exit() {
    this.group.visible = false;
    this.app.input.unlock();
  }

  // ── physics ───────────────────────────────────────────────────────────────────────────────

  /** Move a drifting soldier, bouncing (frozen) or grabbing (alive) on contact. */
  move(s, dt) {
    if (s.anchored) return;
    s.pos.addScaledVector(s.vel, dt);
    let hitN = null;
    for (const axis of ['x', 'y', 'z']) {
      const lim = HALF - R;
      if (Math.abs(s.pos[axis]) > lim) {
        const n = new THREE.Vector3();
        n[axis] = -Math.sign(s.pos[axis]);
        s.pos[axis] = Math.sign(s.pos[axis]) * lim;
        hitN = n;
      }
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

  /** Fire a flash beam. Returns the soldier hit (if any). */
  fire(from, dir, shooter, visFrom = from) {
    const ray = new THREE.Ray(from, dir);
    let best = 60, target = null, limb = false;
    const hit = new THREE.Vector3();
    for (const st of this.stars) if (ray.intersectBox(st.box, hit)) best = Math.min(best, hit.distanceTo(from));
    for (const s of this.soldiers) {
      if (s === shooter || s.frozen) continue;
      const toS = s.pos.clone().sub(from);
      const t = toS.dot(dir);
      if (t < 0 || t > best) continue;
      const miss = toS.addScaledVector(dir, -t).length();
      if (miss < 0.75) { best = t; target = s; limb = miss > 0.32; }
    }
    // A wall stops it at most at the room's far side.
    const end = from.clone().addScaledVector(dir, Math.min(best, 70));
    this.beam(visFrom, end, shooter.team === 0 ? '#ffd4a0' : '#b8ffcf');
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
      this.app.sfx.frozen();
      if (shooter.isPlayer) this.app.hud.toast(`${s.army} soldier frozen`, 900);
      else if (s.team === 0 && s.name) this.app.hud.toast(`${s.name} is frozen`, 1400);
    }
  }

  beam(a, b, color) {
    const len = a.distanceTo(b);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 6, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    this.group.add(mesh);
    this.beams.push({ mesh, life: 0.18 });
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
      this.fire(s.pos.clone().addScaledVector(dir, 0.6), dir, s);
      s.mesh.lookAt(o.pos);
      if (o.isPlayer || s.pos.distanceTo(this.player.pos) < 20) this.app.sfx.flash();
      return;
    }
    // Hop toward the enemy gate, star to star, with a little nerve and a little caution.
    const goalY = s.team === 0 ? -HALF : HALF;
    const goal = new THREE.Vector3(0, goalY, 0);
    const near = this.stars.filter((st) => st.p.distanceTo(s.pos) < 22 && st.p.distanceTo(s.pos) > 3);
    let dest;
    if (near.length && Math.random() < 0.85) {
      near.sort((a, b) => a.p.distanceTo(goal) + rand(0, 12) - (b.p.distanceTo(goal) + rand(0, 12)));
      dest = near[0].p.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(STAR + 0.4));
    } else {
      dest = goal.clone().add(new THREE.Vector3(rand(-8, 8), 0, rand(-8, 8)));
    }
    const dir = dest.sub(s.pos).normalize();
    this.launch(s, dir, rand(5, 8));
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
      if ((input.locked && input.buttons & 1 || input.key('KeyF')) && this.cool === 0) {
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
      if (s.mesh) {
        s.mesh.position.copy(s.pos);
        if (s.frozen) s.mesh.rotateOnAxis(new THREE.Vector3(1, 0.3, 0).normalize(), dt * 0.8);
        else if (s.anchored) {
          // Feet on the thing we hold.
          const up = s.normal;
          const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
          s.mesh.quaternion.slerp(q, 1 - Math.exp(-6 * dt));
          s.mesh.position.addScaledVector(up, 0.25);
        } else {
          // Flying feet-first is how you keep a frozen shield in front of you; we just tuck.
          const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), s.vel.clone().normalize());
          s.mesh.quaternion.slerp(q, 1 - Math.exp(-3 * dt));
        }
      }
    }

    for (const b of this.beams) {
      b.life -= dt;
      b.mesh.material.opacity = Math.max(0, b.life / 0.18);
      if (b.life <= 0) { this.group.remove(b.mesh); b.mesh.geometry.dispose(); }
    }
    this.beams = this.beams.filter((b) => b.life > 0);

    // Camera = the player's eyes.
    stage.cam.position.copy(p.pos);
    stage.cam.quaternion.copy(this.quat);
    // Converge on what you're looking at, so the star in front of you sits at the glass.
    const look = new THREE.Ray(p.pos, fwd);
    let dist = 30;
    const hit = new THREE.Vector3();
    for (const st of this.stars) if (look.intersectBox(st.box, hit)) dist = Math.min(dist, hit.distanceTo(p.pos));
    stage.focusDist = damp(stage.focusDist, clamp(dist, 2.5, 9), 3, dt);

    const glow = this.gates[1].children[4];
    glow.material.opacity = this.gateOpen() ? 0.35 + Math.sin(this.time * 4) * 0.12 : 0.08;
    this.checkEnd();
    const frozen = this.soldiers.filter((s) => s.team === 1 && s.frozen).length;
    const allies = this.soldiers.filter((s) => s.team === 0 && !s.isPlayer && !s.frozen).length;
    hud.room({
      enemies: `${frozen}/${this.enemyTotal}`, allies, suit: p.maxHits - p.hits, charge: this.charge,
      state: p.frozen ? 'FROZEN' : p.anchored ? 'HOLDING' : `DRIFT ${p.vel.length().toFixed(1)} m/s`,
      gate: Math.max(0, p.pos.y + HALF).toFixed(0) + (this.gateOpen() ? ' m, open' : ' m, locked'),
    });
  }

  /** Their gate opens once half their army is frozen (a rush past a full army doesn't count). */
  gateOpen() {
    return this.soldiers.filter((s) => s.team === 1 && s.frozen).length >= this.enemyTotal / 2;
  }

  checkEnd() {
    if (this.over) return;
    const p = this.player;
    const { hud, sfx } = this.app;
    const enemiesLeft = this.soldiers.some((s) => s.team === 1 && !s.frozen);
    const atGate = !p.frozen && p.pos.y < -HALF + R + 0.2 && Math.abs(p.pos.x) < GATE && Math.abs(p.pos.z) < GATE;
    let result = null;
    if (!enemiesLeft) result = { win: true, text: 'Every enemy soldier is frozen. Dragon Army wins.' };
    else if (atGate) result = { win: true, text: 'You touched their gate while they were still fighting. It counts. Dragon Army wins.' };
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
        result.win && !next ? { label: 'Go to Command School', go: () => this.app.go('fleet', 0), primary: true } : null,
        { label: result.win ? 'Replay' : 'Try again', go: () => this.start(this.level), primary: !result.win },
        { label: 'Main menu', go: () => this.app.menu() },
      ].filter(Boolean),
    }), 900);
  }
}
