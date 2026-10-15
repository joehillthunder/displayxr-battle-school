// Battle School 3D: a game inspired by Orson Scott Card's Ender's Game.
//
//   The Battle Room (battleroom.js)  zero-g army battles in Battle School, first person.
//   Ender's Console (campaign.js)    the fleet battle as a hologram on the simulator table.
//   In the War (campaign.js)         the same battle, flying one of the fighters yourself.
//
// In the DisplayXR Browser on a Leia display it is glasses-free 3D; anywhere else it plays in 2D.
// URL options: ?mode=room|console|war&level=<n> skips the menu, ?mono forces 2D, ?depth=0-2.

import { Stage } from './stage.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { BattleRoom, ROOM_BATTLES } from './battleroom.js';
import { Campaign } from './campaign.js';
import { FLEET_LEVELS } from './fleet.js';
import { clamp } from './util.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const store = {
  get(k) { try { return localStorage.getItem('battle-school.' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('battle-school.' + k, v); } catch { /* private mode */ } },
};

// ── HUD ───────────────────────────────────────────────────────────────────────────────────────

const timers = {};
function later(name, ms, fn) { clearTimeout(timers[name]); timers[name] = setTimeout(fn, ms); }

const hud = {
  mode(m) {
    $('room-hud').hidden = m !== 'room';
    $('fleet-hud').hidden = m !== 'fleet';
    $('menu').hidden = m !== 'menu';
    $('menu-btn').hidden = m === 'menu';
    $('end').hidden = $('reveal').hidden = $('pause').hidden = true;
  },
  banner(title, sub) {
    const b = $('banner');
    b.querySelector('h2').textContent = title;
    b.querySelector('p').textContent = sub;
    b.style.opacity = 1;
    later('banner', 3800, () => (b.style.opacity = 0));
  },
  toast(text, ms = 2000) {
    const t = $('toast');
    t.textContent = text;
    t.style.opacity = 1;
    later('toast', ms, () => (t.style.opacity = 0));
  },
  flash() {
    $('flash').style.transition = 'none';
    $('flash').style.opacity = 1;
    requestAnimationFrame(() => { $('flash').style.transition = 'opacity 0.6s'; $('flash').style.opacity = 0; });
  },
  hitmarker() {
    for (const id of ['r-cross', 'c-cross']) $(id).classList.add('hit');
    later('hit', 120, () => { for (const id of ['r-cross', 'c-cross']) $(id).classList.remove('hit'); });
  },
  room(s) {
    $('r-enemies').textContent = s.enemies;
    $('r-allies').textContent = s.allies;
    $('r-gate').textContent = s.gate;
    $('suit').innerHTML = [0, 1, 2].map((i) => `<i class="${i < s.suit ? '' : 'off'}"></i>`).join('');
    $('charge').firstElementChild.style.width = (s.charge * 100).toFixed(0) + '%';
    $('room-state').textContent = s.state;
  },
  squads(squads, selected) {
    const box = $('squads');
    const html = squads.map((sq, i) => {
      const alive = sq.ships.filter((s) => s.alive).length;
      const order = alive ? (sq.order.type === 'attack' ? 'attacking' : 'moving / holding') : 'lost';
      return `<button class="sq${sq === selected ? ' sel' : ''}${alive ? '' : ' dead'}" data-i="${i}" style="--sqc:${sq.color}">
        <kbd>${i + 1}</kbd><b>${sq.name}</b><span class="md" title="Little Doctor charges">MD ${'◆'.repeat(sq.md)}${'◇'.repeat(Math.max(0, (sq.mdMax ?? sq.md) - sq.md))}</span>
        <small>${alive}/6 fighters · ${order}</small></button>`;
    }).join('');
    if (box.dataset.html !== html) { box.innerHTML = html; box.dataset.html = html; }
  },
  fleetView(view) {
    const cockpit = view === 'cockpit';
    $('cockpit-hud').hidden = !cockpit;
    $('view-btn').innerHTML = cockpit ? 'Back to the console <kbd>Tab</kbd>' : 'Fly a fighter <kbd>Tab</kbd>';
    $('f-help').innerHTML = cockpit
      ? 'Click to fly with the mouse · <kbd>W</kbd>/<kbd>S</kbd> throttle · <kbd>Shift</kbd> boost · <kbd>A</kbd>/<kbd>D</kbd> roll · click or <kbd>Space</kbd> fire · <kbd>D</kbd> Little Doctor ahead · <kbd>1</kbd>-<kbd>6</kbd> switch squadron'
      : '<kbd>1</kbd>-<kbd>6</kbd> select · right-click: move / attack · <kbd>R</kbd>/<kbd>F</kbd> height · <kbd>D</kbd> Little Doctor · <kbd>G</kbd> all attack · drag to look round · wheel zoom';
  },
  fleet(s) {
    $('f-time').textContent = s.time.toFixed(0);
    $('f-formics').textContent = s.formics;
    $('f-humans').textContent = s.humans;
    $('f-planet-box').hidden = !s.planet;
    if (s.planet) $('f-planet').textContent = s.planet;
  },
  cockpit(s) {
    $('c-speed').textContent = s.speed.toFixed(0);
    $('c-hp').textContent = '▮'.repeat(Math.max(0, s.hp)) || '-';
    $('c-near').textContent = isFinite(s.near) ? s.near.toFixed(0) : '-';
    $('c-md').textContent = s.md;
    $('c-planet').hidden = $('c-planet-l').hidden = s.planet == null;
    if (s.planet != null) {
      $('c-planet').textContent = s.planet.toFixed(0) + (s.planet < s.mdRange ? ' · in range' : '');
      $('c-planet').style.color = s.planet < s.mdRange ? 'var(--ok)' : '';
    }
  },
  cursorHint() {},
  end({ title, text, actions }) {
    const m = $('end');
    m.querySelector('h2').textContent = title;
    m.querySelector('p').textContent = text;
    fillActions(m, actions);
    m.hidden = false;
  },
  reveal(lost, actions) {
    $('reveal-text').innerHTML = `
      <p>The room is too quiet. The officers behind you aren't clapping. Some of them are crying.</p>
      <p class="quote">Mazer Rackham takes off his headset. "There were no simulations, Ender. Not tonight, and not for months.
      Every fleet you commanded was real, light-years away. Your orders reached them instantly over the ansible.
      ${lost ? `The ${lost} fighter${lost === 1 ? '' : 's'} you lost tonight had pilots in them.` : 'Every one of those ships had a crew.'} And that planet was their home world. You won. The war is over."</p>
      <p>Years later, on a colony world far from Earth, Ender finds something the formics left for him alone: a single cocoon, and a queen waiting to wake.
      He will spend the rest of his life looking for a place where she can live.</p>`;
    fillActions($('reveal'), actions);
    $('reveal').hidden = false;
  },
};

function fillActions(modal, actions) {
  const box = modal.querySelector('.actions');
  box.innerHTML = '';
  for (const a of actions) {
    const b = document.createElement('button');
    b.className = 'btn' + (a.primary ? ' primary' : '');
    b.textContent = a.label;
    b.onclick = () => { modal.hidden = true; a.go(); };
    box.appendChild(b);
  }
}

// ── app ───────────────────────────────────────────────────────────────────────────────────────

const canvas = $('stage');
const stage = new Stage(canvas);
const input = new Input(canvas);
const sfx = new Sfx();
const app = { stage, input, sfx, hud };
const room = new BattleRoom(app);
const campaign = new Campaign(app);
let active = null; // the running mode, or null on the menu
let attract = true;
let paused = false;

app.go = (mode, level = 0) => {
  (active ?? campaign).exit();
  attract = false;
  paused = false;
  if (mode === 'room') { active = room; room.enter(level); }
  else { active = campaign; campaign.enter(level, mode === 'war' ? 'cockpit' : 'console'); }
};

app.menu = () => {
  active?.exit();
  active = null;
  paused = false;
  hud.mode('menu');
  // Behind the menu: the final battle playing itself on the table.
  attract = true;
  campaign.start(3, 'console');
  campaign.orbit = { yaw: 0.6, pitch: 0.42, dist: 2.6 };
  $('banner').style.opacity = 0;
};

// Menu level buttons.
for (const box of document.querySelectorAll('.levels')) {
  const mode = box.dataset.mode;
  const list = mode === 'room' ? ROOM_BATTLES : FLEET_LEVELS;
  list.forEach((L, i) => {
    const b = document.createElement('button');
    b.className = 'btn' + (i === 0 ? ' primary' : '');
    b.textContent = mode === 'room' ? `${i + 1}. ${L.name.replace('Dragon vs ', 'vs ')}` : L.final ? 'Final' : `Sim ${i + 1}`;
    b.title = L.intro;
    b.onclick = () => app.go(mode, i);
    box.appendChild(b);
  });
}

$('squads').addEventListener('click', (e) => {
  const b = e.target.closest('.sq');
  if (b) campaign.select(campaign.fleet.squads[+b.dataset.i]);
});
$('view-btn').onclick = () => campaign.setView(campaign.view === 'console' ? 'cockpit' : 'console');
$('menu-btn').onclick = () => app.menu();
$('resume-btn').onclick = () => { paused = false; $('pause').hidden = true; };
$('pause-menu-btn').onclick = () => app.menu();
$('mute-btn').onclick = () => {
  sfx.muted = !sfx.muted;
  $('mute-btn').textContent = sfx.muted ? 'Sound off' : 'Sound on';
  store.set('muted', sfx.muted ? '1' : '');
};
if (store.get('muted')) $('mute-btn').click();

const depth = $('depth');
depth.value = clamp(+(params.get('depth') ?? store.get('depth') ?? 1), 0, 2);
stage.setDepth(+depth.value);
depth.oninput = () => { stage.setDepth(+depth.value); store.set('depth', depth.value); };

$('stereo-btn').onclick = async () => {
  await stage.setStereo(!stage.stereo);
};
stage.onModeChange = (stereo) => {
  $('badge').textContent = stage.woven ? (stereo ? '3D' : '3D off') : '2D';
  $('badge').dataset.kind = stage.woven && stereo ? 'ok' : '';
  $('stereo-btn').textContent = stereo ? 'Switch to 2D' : 'Switch to 3D';
};

// ── loop ──────────────────────────────────────────────────────────────────────────────────────

stage.onTick = (dt) => {
  if (input.hit('Escape') || input.hit('KeyP')) {
    if (active && !input.locked) { paused = !paused; $('pause').hidden = !paused; }
  }
  if (attract) {
    campaign.orbit.yaw += dt * 0.08;
    const fleet = campaign.fleet;
    const cam = stage.cam, o = campaign.orbit;
    cam.position.set(Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist, 1.25 + Math.sin(o.pitch) * o.dist, Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist);
    cam.lookAt(0, 1.25, 0);
    stage.focusDist = o.dist;
    // The swarm wakes up slowly; nudge the squadrons in so the table has a battle on it.
    if (fleet.time > 3 && !fleet.nudged) {
      fleet.nudged = true;
      fleet.squads.forEach((sq, i) => fleet.orderAttack(sq, fleet.alive(1)[i * 9] ?? fleet.alive(1)[0]));
    }
    fleet.update(dt, null);
    if (fleet.over || fleet.time > 90) { campaign.start(3, 'console'); }
  } else if (active && !paused) {
    active.update(dt);
  }
  input.endFrame();
};

hud.mode('menu');
app.menu();

if (params.has('mono')) {
  stage.sizeToCanvas();
  stage.monoLoop();
} else {
  stage.start().then(({ woven }) => {
    stage.onModeChange(woven && stage.stereo);
    $('stereo-btn').hidden = !stage.displayModesSupported;
  });
}
stage.onModeChange(false);

const m = params.get('mode');
if (m === 'room' || m === 'console' || m === 'war') {
  const n = clamp(+(params.get('level') ?? 1) - 1 || 0, 0, (m === 'room' ? ROOM_BATTLES : FLEET_LEVELS).length - 1);
  app.go(m, n);
}

window.battleSchool = { stage, room, campaign, app };
