// Command School: the fleet battle (fleet.js) from two seats.
//
// CONSOLE: you are Ender at the simulator. The battle is a hologram above the table; select a
// squadron (1-6 or its card), right-click empty space to send it there or right-click a formic to
// attack it, and press D for its Little Doctor. Drag to walk round the table, wheel to lean in.
//
// COCKPIT: Tab drops you into the lead fighter of the selected squadron, in the war itself. The
// mouse flies, W/S throttle, A/D roll, click or Space fires, D launches the Little Doctor at what
// you're pointing at. Your squadron keeps following its orders around you. Tab again goes back to
// the table.

import * as THREE from 'three';
import { Fleet, FLEET_LEVELS, MD_RANGE, SQUADS } from './fleet.js';
import { clamp, damp, rand } from './util.js';
import { atmosphere, envFromTexture, glowTexture, roomEnv, skyDome, sun } from './space.js';

const HOLO_SCALE = 1 / 430; // battle units -> metres above the table
const TABLE_Y = 1.25;

const hdr = (c, k) => new THREE.Color(c).multiplyScalar(k); // > 1 blooms

function gasGiantTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  for (let y = 0; y < 256; y++) {
    const t = y / 256, b = Math.sin(t * 40 + Math.sin(t * 9) * 3) * 0.5 + 0.5;
    g.fillStyle = `rgb(${190 + b * 50},${150 + b * 50},${110 + b * 40})`;
    g.fillRect(0, y, 512, 1);
  }
  g.globalAlpha = 0.35;
  for (let i = 0; i < 60; i++) {
    g.fillStyle = Math.random() < 0.5 ? '#a8704a' : '#f2dcc0';
    g.beginPath(); g.ellipse(Math.random() * 512, Math.random() * 256, rand(20, 80), rand(2, 6), 0, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function gradientTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, 'rgba(255,255,255,0)');
  gr.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 4, 128);
  return new THREE.CanvasTexture(c);
}

/** A person at a station: uniform, face, a lit headset in their colour. */
function figure(color, light = '#5fd0ff') {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.9, 4, 12), m);
  body.position.y = 0.82;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), new THREE.MeshStandardMaterial({ color: '#d6a888', roughness: 0.6 }));
  head.position.y = 1.56;
  const set = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.015, 6, 24, Math.PI), new THREE.MeshBasicMaterial({ color: hdr(light, 3) }));
  set.position.y = 1.58;
  set.rotation.y = Math.PI / 2;
  g.add(body, head, set);
  return g;
}

export class Campaign {
  constructor(app) {
    this.app = app;
    this.fleet = new Fleet(app);
    this.fleet.onPlayerLost = () => this.playerLost();
    this.view = 'console';
    this.orbit = { yaw: 0, pitch: 0.55, dist: 2.3 };
    const renderer = app.stage.renderer;

    // Command room: a bright round chamber, the jeesh at their stations around the table.
    const room = (this.room = new THREE.Group());
    room.visible = false;
    app.stage.scene.add(room);
    this.roomEnv = roomEnv(renderer);
    room.add(new THREE.HemisphereLight('#d4e4ff', '#3a4456', 0.9));
    const spot = new THREE.SpotLight('#cfe8ff', 40, 14, 0.7, 0.5, 1.2);
    spot.position.set(0, 6, 0);
    spot.target.position.set(0, 0, 0);
    room.add(spot, spot.target);
    const tableLight = new THREE.PointLight('#5fd0ff', 12, 6, 1.5);
    tableLight.position.y = TABLE_Y;
    room.add(tableLight);
    const metal = new THREE.MeshStandardMaterial({ color: '#4a5668', roughness: 0.3, metalness: 0.8, envMap: this.roomEnv });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(10, 96), new THREE.MeshStandardMaterial({ color: '#3a4454', roughness: 0.22, metalness: 0.85, envMap: this.roomEnv }));
    floor.rotation.x = -Math.PI / 2;
    room.add(floor);
    for (const r of [1.6, 4.2, 7.2]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.04, 128), new THREE.MeshBasicMaterial({ color: hdr('#5fd0ff', 0.9) }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.005;
      room.add(ring);
    }
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, 7, 24, 1, true), new THREE.MeshStandardMaterial({ color: '#3c485c', roughness: 0.55, metalness: 0.4, side: THREE.BackSide, flatShading: true, envMap: this.roomEnv }));
    wall.position.y = 3.5;
    room.add(wall);
    const ceilingRing = new THREE.Mesh(new THREE.TorusGeometry(7, 0.06, 8, 160), new THREE.MeshBasicMaterial({ color: hdr('#e8f4ff', 3) }));
    ceilingRing.rotation.x = Math.PI / 2;
    ceilingRing.position.y = 6.2;
    room.add(ceilingRing);
    // Light columns and wall screens.
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      if (i % 2 === 0) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 5.5, 0.06), new THREE.MeshBasicMaterial({ color: hdr('#9fd8ff', 2.2) }));
        strip.position.set(Math.sin(a) * 9.85, 3.2, Math.cos(a) * 9.85);
        room.add(strip);
      } else {
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.9), new THREE.MeshBasicMaterial({ color: hdr(i % 3 ? '#2f8fd8' : '#3fd8a8', 1.1) }));
        scr.position.set(Math.sin(a) * 9.8, 2.2, Math.cos(a) * 9.8);
        scr.lookAt(0, 2.2, 0);
        room.add(scr);
      }
    }
    // The table: pedestal, emitter ring, a lit disc and a soft column of projector light.
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.15, 0.85, 64), metal);
    ped.position.y = 0.42;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.035, 10, 128), new THREE.MeshBasicMaterial({ color: hdr('#5fd0ff', 1.8) }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.86;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.09, 96), new THREE.MeshBasicMaterial({ color: hdr('#1f6a9a', 0.5) }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.865;
    room.add(ped, rim, disc);
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.08, 1.4, 96, 1, true), new THREE.MeshBasicMaterial({ color: hdr('#3fa8ff', 0.4), map: gradientTexture(), transparent: true, opacity: 0.25, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    cone.position.y = 0.87 + 0.7;
    room.add(cone);
    // Dust in the projector light.
    const dust = new Float32Array(400 * 3);
    for (let i = 0; i < 400; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 1.1;
      dust.set([Math.cos(a) * r, 0.9 + Math.random() * 1.3, Math.sin(a) * r], i * 3);
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(dust, 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ size: 0.012, color: hdr('#bfe8ff', 1.4), transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, map: glowTexture() }));
    room.add(this.dust);
    // The jeesh: one squadron leader at each station around the far side of the table.
    SQUADS.forEach((s, i) => {
      const a = Math.PI + ((i - 2.5) / 6) * 2.2;
      const x = Math.sin(a) * 6.2, z = Math.cos(a) * 6.2;
      const desk = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 0.5), metal);
      desk.position.set(x * 0.92, 0.4, z * 0.92);
      desk.lookAt(0, 0.4, 0);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.45), new THREE.MeshBasicMaterial({ color: hdr(s.color, 1.3) }));
      scr.position.set(x * 0.9, 1.05, z * 0.9);
      scr.lookAt(x * 2, 1.2, z * 2);
      const f = figure('#2a3448', s.color);
      f.position.set(x, 0, z);
      f.lookAt(0, 0, 0);
      room.add(desk, scr, f);
    });
    // The teachers, who come to watch as the stakes rise.
    this.watchers = [[-2.2, -8.2], [2.0, -8.3], [0.2, -8.8], [-4.6, -7.4], [4.4, -7.5]].map(([x, z]) => {
      const f = figure('#3a4a3a', '#ffd27a');
      f.position.set(x, 0, z);
      f.lookAt(0, 0, 0);
      room.add(f);
      return f;
    });

    // Space (cockpit view): nebula, the sun, a gas giant, image-based light from the sky.
    const space = (this.space = new THREE.Group());
    space.visible = false;
    app.stage.scene.add(space);
    this.sky = skyDome(760);
    this.spaceEnv = envFromTexture(renderer, 'nebula', this.sky.userData.texture);
    const SUN = new THREE.Vector3(-0.8, 0.45, 0.4).normalize();
    const s = sun(70);
    s.position.copy(SUN).multiplyScalar(650);
    this.sky.add(s);
    this.giant = new THREE.Mesh(new THREE.SphereGeometry(150, 64, 32), new THREE.MeshStandardMaterial({ map: gasGiantTexture(), roughness: 0.9 }));
    this.giant.add(atmosphere('#ffd2a0', 2.5, 1.5));
    this.giant.position.set(-380, -150, -520);
    this.giant.rotation.z = 0.35;
    this.sky.add(this.giant);
    space.add(this.sky);
    const sunLight = new THREE.DirectionalLight('#fff2dd', 3.6);
    sunLight.position.copy(SUN).multiplyScalar(10);
    space.add(sunLight, new THREE.HemisphereLight('#a8c0f0', '#4a3050', 1.4));

    this.holoRoot = new THREE.Group(); // parent of fleet.root in console view
    this.holoRoot.position.y = TABLE_Y;
    this.holoRoot.scale.setScalar(HOLO_SCALE);
    room.add(this.holoRoot);

    this.ray = new THREE.Raycaster();
    this.flyQuat = new THREE.Quaternion();
    this.chase = new THREE.Vector3();
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────────────────────

  enter(level = 0, view = 'console') {
    this.app.hud.mode('fleet');
    this.start(level, view);
  }

  start(level, view = this.view) {
    this.levelIndex = level;
    this.kills = 0;
    this.fleet.start(level);
    this.reported = false;
    this.selected = this.fleet.squads[0];
    this.fleet.selected = this.selected;
    this.player = null;
    this.watchers.forEach((w, i) => (w.visible = level >= 2 ? i < (FLEET_LEVELS[level].final ? 5 : 2) : false));
    this.orbit = { yaw: 0, pitch: 0.78, dist: 3.1 };
    this.setView(view, true);
    const L = FLEET_LEVELS[level];
    this.app.hud.banner(L.name, L.intro);
    this.app.hud.squads(this.fleet.squads, this.selected);
  }

  exit() {
    this.room.visible = this.space.visible = false;
    this.app.stage.scene.environment = null;
    this.app.input.unlock();
    if (this.player) this.player.isPlayer = false;
    this.player = null;
  }

  setView(view, quiet = false) {
    const { stage, hud, input } = this.app;
    this.view = view;
    const holo = view === 'console';
    this.room.visible = holo;
    this.space.visible = !holo;
    this.fleet.setHolo(holo);
    (holo ? this.holoRoot : this.space).add(this.fleet.root);
    stage.scene.background = null; // black clear: see post.js
    stage.scene.fog = null;
    stage.scene.environment = holo ? this.roomEnv : this.spaceEnv;
    stage.post.setBloom(holo ? { strength: 0.55, radius: 0.45, threshold: 0.9 } : { strength: 0.6, radius: 0.5, threshold: 0.9 });
    this.fleet.trailsOn = stage.post.q.trails;
    this.fleet.sparks.scale = stage.post.q.particles;
    stage.cam.near = holo ? 0.05 : 0.5;
    stage.cam.far = holo ? 60 : 1600;
    stage.cam.updateProjectionMatrix();
    if (holo) {
      if (this.player) this.player.isPlayer = false;
      this.player = null;
      input.unlock();
    } else {
      this.takeShip(this.selected);
    }
    hud.fleetView(view);
    if (!quiet) this.app.sfx.blip();
  }

  takeShip(sq) {
    const ship = sq?.ships.find((s) => s.alive) ?? this.fleet.ships.find((s) => s.alive && s.team === 0);
    if (!ship) return false;
    if (this.player) this.player.isPlayer = false;
    this.player = ship;
    ship.isPlayer = true;
    this.selected = ship.squad;
    this.fleet.selected = ship.squad;
    this.flyQuat.copy(ship.quat);
    this.speed = Math.max(20, ship.vel.length());
    this.chase.copy(ship.pos);
    this.app.hud.squads(this.fleet.squads, this.selected);
    return true;
  }

  playerLost() {
    if (this.view !== 'cockpit') return;
    const name = this.player?.squad?.name;
    this.player = null;
    this.app.hud.flash();
    setTimeout(() => {
      if (this.view !== 'cockpit' || this.fleet.over) return;
      if (this.takeShip(this.selected)) this.app.hud.toast(`Ship lost. Transferring you to another of ${this.selected.name}'s fighters.`, 2600);
      else this.app.hud.toast(`${name ?? 'Your'} squadron is gone.`, 2000);
    }, 700);
  }

  select(sq) {
    if (!sq) return;
    this.selected = sq;
    this.fleet.selected = sq;
    this.app.sfx.blip();
    this.app.hud.squads(this.fleet.squads, sq);
    if (this.view === 'cockpit') this.takeShip(sq);
  }

  doctor() {
    const sq = this.selected;
    const res = this.view === 'cockpit' && this.player
      ? this.fleet.fireMD(sq, this.player, new THREE.Vector3(0, 0, 1).applyQuaternion(this.flyQuat))
      : this.fleet.fireMD(sq);
    this.app.hud.toast(res.msg, 2200);
    if (!res.ok) this.app.sfx.alarm();
    this.app.hud.squads(this.fleet.squads, this.selected);
  }

  // ── frame ─────────────────────────────────────────────────────────────────────────────────

  update(dt) {
    const { input, hud } = this.app;
    const fleet = this.fleet;
    if (input.hit('Tab')) this.setView(this.view === 'console' ? 'cockpit' : 'console');
    for (let i = 0; i < fleet.squads.length; i++) if (input.hit('Digit' + (i + 1))) this.select(fleet.squads[i]);
    if (input.hit('KeyD') && !fleet.over) this.doctor();
    if (input.hit('KeyG') && !fleet.over) {
      // Everyone: attack the nearest formics.
      for (const sq of fleet.squads) {
        const c = fleet.centroid(sq);
        const f = c && fleet.alive(1).sort((a, b) => a.pos.distanceTo(c) - b.pos.distanceTo(c))[0];
        if (f) fleet.orderAttack(sq, f);
      }
      hud.toast('All squadrons: engage.', 1500);
      this.app.sfx.order();
    }

    if (this.view === 'console') this.updateConsole(dt);
    else this.updateCockpit(dt);

    fleet.update(dt, this.player);

    const formics = fleet.alive(1).length;
    const humans = fleet.alive(0).length;
    hud.fleet({ time: fleet.time, formics, humans, planet: fleet.level.planet ? (fleet.planetHp > 0 ? 'intact' : 'destroyed') : null });
    if ((this.hudTick = (this.hudTick ?? 0) + dt) > 0.25) { this.hudTick = 0; hud.squads(fleet.squads, this.selected); }

    if (fleet.over && !this.reported) {
      this.reported = true;
      setTimeout(() => this.finish(fleet.over), fleet.over.planet ? 2600 : 1400);
    }
  }

  updateConsole(dt) {
    const { input, stage, hud } = this.app;
    this.dust.rotation.y += dt * 0.06;
    const o = this.orbit;
    if (input.buttons & 1 && input.dragging) {
      o.yaw -= input.dx * 0.006;
      o.pitch = clamp(o.pitch + input.dy * 0.004, 0.08, 1.35);
    }
    o.yaw += input.axis('ArrowLeft', 'ArrowRight') * dt * 1.2;
    o.pitch = clamp(o.pitch + input.axis('ArrowDown', 'ArrowUp') * dt * 0.8, 0.08, 1.35);
    o.dist = clamp(o.dist * Math.exp(input.wheel * 0.001), 1.2, 4.2);
    const cam = stage.cam;
    const target = new THREE.Vector3(0, TABLE_Y, 0);
    cam.position.set(Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist, TABLE_Y + Math.sin(o.pitch) * o.dist, Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist);
    cam.lookAt(target);
    stage.focusDist = o.dist;

    // R / F raise and lower the selected squadron's move point.
    const sq = this.selected;
    const lift = input.axis('KeyF', 'KeyR');
    if (lift && sq && sq.order.type === 'move') sq.order.point.y = clamp(sq.order.point.y + lift * 120 * dt, -300, 300);

    for (const c of input.clicks) {
      if (c.button !== 2 || this.fleet.over) continue;
      this.order(c.x, c.y);
    }
    hud.cursorHint(null);
  }

  /** Right click on the hologram: attack the formic under the cursor, else move there. */
  order(px, py) {
    const { stage, hud, sfx } = this.app;
    const sq = this.selected;
    if (!sq || !this.fleet.centroid(sq)) return;
    const rect = stage.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((px - rect.left) / rect.width) * 2 - 1, -((py - rect.top) / rect.height) * 2 + 1);
    stage.scene.updateMatrixWorld();
    // Nearest formic on screen within 22 px.
    let best = null, bd = 22;
    const v = new THREE.Vector3();
    for (const s of this.fleet.ships) {
      if (!s.alive || s.team !== 1) continue;
      v.copy(s.pos).applyMatrix4(this.fleet.root.matrixWorld).project(stage.cam);
      if (v.z > 1) continue;
      const d = Math.hypot((v.x - ndc.x) * rect.width / 2, (v.y - ndc.y) * rect.height / 2);
      if (d < bd) { bd = d; best = s; }
    }
    if (best) {
      this.fleet.orderAttack(sq, best);
      hud.toast(`${sq.name}: attacking.`, 1200);
      sfx.order();
      return;
    }
    // Empty space: a point on the horizontal plane at the squadron's current height.
    this.ray.setFromCamera(ndc, stage.cam);
    const inv = this.fleet.root.matrixWorld.clone().invert();
    const r = this.ray.ray.clone().applyMatrix4(inv);
    const h = this.fleet.centroid(sq).y;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -h);
    const hit = r.intersectPlane(plane, new THREE.Vector3());
    if (!hit || hit.length() > 650) return;
    this.fleet.orderMove(sq, hit);
    hud.toast(`${sq.name}: moving. R / F to set the height.`, 1400);
    sfx.order();
  }

  updateCockpit(dt) {
    const { input, stage, hud, sfx } = this.app;
    const p = this.player;
    if (input.clicks.length && !input.locked) input.lock();
    if (!p || !p.alive) {
      // Between ships: hang the camera where we were.
      stage.focusDist = 12;
      return;
    }
    // Fly: mouse pitch/yaw, A/D roll, W/S throttle, Shift boost.
    const yaw = -input.dx * 0.0022 + input.axis('ArrowRight', 'ArrowLeft') * dt * 1.4;
    const pitch = input.dy * 0.0022 + input.axis('ArrowUp', 'ArrowDown') * dt * 1.2;
    const roll = input.axis('KeyA', 'KeyD') * dt * 2.2;
    this.flyQuat.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'))).normalize();
    const boost = input.key('ShiftLeft') || input.key('ShiftRight');
    this.speed = clamp(this.speed + input.axis('KeyS', 'KeyW') * 40 * dt, 8, boost ? 90 : 60);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.flyQuat);
    p.vel.copy(fwd).multiplyScalar(boost ? Math.max(this.speed, 85) : this.speed);
    p.pos.addScaledVector(p.vel, dt);
    p.quat.copy(this.flyQuat);
    // Stay in the battle volume.
    if (p.pos.length() > 620) p.pos.setLength(620);
    if (this.fleet.planet.visible) {
      const toP = p.pos.clone().sub(this.fleet.planet.position);
      const r = this.fleet.planet.scale.x + 6;
      if (toP.length() < r) p.pos.copy(this.fleet.planet.position).addScaledVector(toP.normalize(), r);
    }

    // Guns, with a little aim assist toward whatever is nearest the crosshair.
    p.cd -= dt;
    if ((input.locked && input.buttons & 1 || input.key('Space')) && p.cd <= 0) {
      p.cd = 0.16;
      let best = null, bd = 0.985;
      for (const f of this.fleet.ships) {
        if (!f.alive || f.team !== 1) continue;
        const to = f.pos.clone().sub(p.pos);
        const d = to.length();
        if (d > 70) continue;
        const dot = to.divideScalar(d).dot(fwd);
        if (dot > bd) { bd = dot; best = f; }
      }
      const muzzleL = p.pos.clone().add(new THREE.Vector3(-2.5, 0, 1).applyQuaternion(this.flyQuat));
      const muzzleR = p.pos.clone().add(new THREE.Vector3(2.5, 0, 1).applyQuaternion(this.flyQuat));
      this.side = !this.side;
      const from = this.side ? muzzleL : muzzleR;
      if (best && Math.random() < 0.7) {
        this.fleet.laser(from, best.pos, p.squad.color);
        this.fleet.damage(best, 1);
        hud.hitmarker();
        if (!best.alive) {
          this.kills = (this.kills ?? 0) + 1;
          hud.toast(`Formic destroyed (${this.kills})`, 900);
        }
      } else this.fleet.laser(from, from.clone().addScaledVector(fwd, 70), p.squad.color);
      sfx.laser(1);
    }

    // Chase camera: behind and above, lagging a touch on turns.
    const cam = stage.cam;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.flyQuat);
    const want = p.pos.clone().addScaledVector(fwd, -22).addScaledVector(up, 6);
    this.chase.lerp(want, 1 - Math.exp(-10 * dt));
    cam.position.copy(this.chase);
    const look = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(cam.position, p.pos.clone().addScaledVector(fwd, 30), up));
    cam.quaternion.slerp(look, 1 - Math.exp(-12 * dt));
    this.sky.position.copy(cam.position);
    stage.focusDist = damp(stage.focusDist, 23, 4, dt);

    // Nearest threat for the HUD.
    let near = Infinity;
    for (const f of this.fleet.ships) if (f.alive && f.team === 1) near = Math.min(near, f.pos.distanceTo(p.pos));
    const toPlanet = this.fleet.planet.visible ? p.pos.distanceTo(this.fleet.planet.position) - this.fleet.planet.scale.x : null;
    hud.cockpit({ kills: this.kills ?? 0, speed: p.vel.length(), hp: p.hp, near, md: p.squad.md, planet: toPlanet, mdRange: MD_RANGE });
  }

  finish(res) {
    const { hud, sfx } = this.app;
    this.app.input.unlock();
    const L = FLEET_LEVELS[this.levelIndex];
    const next = this.levelIndex + 1 < FLEET_LEVELS.length;
    const lost = this.fleet.ships.filter((s) => s.team === 0 && !s.alive).length;
    if (res.win && L.final) {
      sfx.win();
      hud.reveal(lost, [
        { label: 'Fight it again', go: () => this.start(this.levelIndex) },
        { label: 'Main menu', go: () => this.app.menu(), primary: true },
      ]);
      return;
    }
    res.win ? sfx.win() : sfx.lose();
    hud.end({
      title: res.win ? 'Simulation passed' : 'Fleet destroyed',
      text: res.win
        ? `Every formic ship is gone. You lost ${lost} fighter${lost === 1 ? '' : 's'} in ${this.fleet.time.toFixed(0)} s. Mazer is already setting up the next one.`
        : 'Your squadrons are gone. Remember the Little Doctor works best on ships flying close together.',
      actions: [
        res.win && next ? { label: 'Next simulation', go: () => this.start(this.levelIndex + 1), primary: true } : null,
        { label: res.win ? 'Replay' : 'Try again', go: () => this.start(this.levelIndex), primary: !res.win },
        { label: 'Main menu', go: () => this.app.menu() },
      ].filter(Boolean),
    });
  }
}
