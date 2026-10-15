// The 3D stage: one persistent canvas, woven by the DisplayXR inline-3D SDK when the browser and
// display support it, and rendered as ordinary 2D otherwise.
//
// Why a CAMERA rig: every view in this game is a camera the game owns (first person in the Battle
// Room, a chase camera behind a fighter, Ender's seat at the simulator table), which is the
// authoring guide's "Which rig" case for first person and games. Each mode sets focusDist to what
// the player is looking at: the star ahead in the Battle Room, the fighter in the war, the table
// in the console. Convergence sits a little beyond it, so the subject floats just in front of the
// glass and everything else recedes. The eye separation grows with that distance (ipdFactorFor) so
// a far subject still has depth; the Depth slider scales it. The eyes hang off the app camera and
// the rig is sent identity-posed every frame (the attach pattern), so a moving camera has no
// one-frame stereo lag.

import * as THREE from 'three';
import { createInline3D, inline3dDisplayModesSupported } from '@displayxr/inline3d';
import { EyeCamera, cameraRigFromCamera } from '@displayxr/inline3d/three';
import { clamp } from './util.js';
import { Post } from './post.js';

const MIN_CONVERGENCE = 0.6; // metres; comfort floor for the zero-disparity plane
const POP = 1.08; // convergence / camera-to-player distance: > 1 puts the player slightly out of the glass
const MAX_EYE_W = 2560; // per-eye backing-store cap: an 8K panel's ~3700 px eyes are more than the weave shows

/** Stereo strength for a follow camera `dist` metres from the player (63 mm eyes at 1). */
export function ipdFactorFor(dist, gain = 1) {
  return gain * clamp(dist / 1.8, 1, 5);
}

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.woven = false;
    this.stereo = true;
    this.depthGain = 1;
    this.focusDist = 7;
    this.onTick = () => {};
    this.onModeChange = () => {};
    this.frames = 0;

    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' }));
    // pixelRatio MUST be 1: layer.getViewport() reports backing-store pixels, and three would
    // multiply them again. The backing store is sized by hand (sizeToCanvas).
    r.setPixelRatio(1);
    r.autoClear = false;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.1; // bright (the user asked for a lighter look) without blowing out under bloom
    r.setClearColor(0x000000, 1); // pure black: see post.js

    this.scene = new THREE.Scene();
    this.post = new Post(r, this.scene);
    // The app camera is IN the scene: the eye cameras hang off it (attach pattern), and three only
    // updates a parented camera through a scene traversal.
    this.cam = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 400);
    this.scene.add(this.cam);
    this.eyes = [new EyeCamera(THREE), new EyeCamera(THREE)];
    this.rigScratch = {};
    window.addEventListener('resize', () => this.sizeToCanvas());
  }

  async start() {
    this.sizeToCanvas();
    try {
      this.wall = await createInline3D({ lazy: false });
    } catch (e) {
      console.warn('[battleschool] inline-3D unavailable', e);
    }
    if (!this.wall?.supported) {
      console.info('[battleschool] no inline-3D session: rendering 2D');
      this.monoLoop();
      return { woven: false, firstWoven: Promise.resolve({ woven: false }) };
    }
    this.woven = true;
    this.sizeToCanvas();
    for (const eye of this.eyes) this.cam.add(eye.camera);
    // The first rig goes in at construction so the very first located frame is already ours.
    this.handle = this.wall.addScene(this.canvas, (views, layer) => this.xrFrame(views, layer), {
      viewRig: this.currentRig(),
      onLayerLost: () => {
        console.warn('[battleschool] 3D layer lost: falling back to 2D');
        this.woven = false;
        this.sizeToCanvas();
        this.monoLoop();
        this.onModeChange(false);
      },
    });
    this.wall.on?.('renderingmodechange', (e) => {
      this.stereo = e.viewCount !== 1;
      this.onModeChange(this.stereo);
    });
    window.addEventListener('pagehide', () => this.wall?.close());
    console.info('[battleschool] inline-3D session live: addScene registered');
    setInterval(() => {
      const s = this.handle?.stats?.();
      if (s) console.info(`[battleschool] frames=${s.frames} monoFrames=${s.monoFrames} wovenState=${this.handle.wovenState ?? 'n/a'} buffer=${this.canvas.width}x${this.canvas.height}`);
    }, 5000);
    return { woven: true, firstWoven: this.handle.firstWoven };
  }

  get displayModesSupported() {
    return this.woven && inline3dDisplayModesSupported();
  }

  /** 2D/3D lens toggle (the display-modes sample's pattern). */
  async setStereo(on) {
    if (!this.displayModesSupported) return false;
    await this.wall.setStereoEnabled(on);
    this.stereo = on;
    this.onModeChange(on);
    return true;
  }

  setDepth(gain) {
    this.depthGain = clamp(gain, 0, 2);
  }

  currentRig() {
    const d = this.focusDist;
    return cameraRigFromCamera(THREE, this.cam, {
      convergence: Math.max(MIN_CONVERGENCE, d * POP),
      ipdFactor: ipdFactorFor(d, this.depthGain),
      attach: true,
      out: this.rigScratch,
    });
  }

  sizeToCanvas() {
    const dpr = window.devicePixelRatio || 1;
    let w = Math.max(1, Math.round((this.canvas.clientWidth || 960) * dpr));
    let h = Math.max(1, Math.round((this.canvas.clientHeight || 540) * dpr));
    // Both axes by one factor, so the eye split stays at exactly half the buffer.
    const s = Math.min(1, (this.maxEyeW || MAX_EYE_W) / w);
    w = Math.floor(w * s);
    h = Math.floor(h * s);
    // Woven: a DOUBLE-WIDTH side-by-side store (left eye | right eye) in the same CSS box.
    const bw = this.woven ? w * 2 : w;
    if (this.canvas.width !== bw || this.canvas.height !== h) this.renderer.setSize(bw, h, false);
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
  }

  step() {
    const now = performance.now();
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    this.onTick(dt);
    this.frames++;
  }

  xrFrame(views, layer) {
    // Validate BEFORE clearing: a short view list or a missing viewport must not become a dark tile.
    if (!views || views.length < 2 || !layer) return;
    const vps = views.map((v) => layer.getViewport(v));
    if (vps.some((vp) => !vp || vp.width <= 0 || vp.height <= 0)) return;
    this.step();
    this.handle.setViewRig(this.currentRig());
    this.scene.updateMatrixWorld();
    const r = this.renderer;
    r.setScissorTest(false);
    r.clear();
    r.setScissorTest(true);
    for (let i = 0; i < 2; i++) {
      this.eyes[i].setLocalFromView(views[i]);
      this.eyes[i].camera.updateMatrixWorld();
      this.post.render(this.eyes[i].camera, vps[i]);
    }
    if (!this.loggedWoven) {
      this.loggedWoven = true;
      console.info(`[battleschool] firstWoven eyes=${vps[0].width}x${vps[0].height} quality=${this.post.level}`);
    }
    r.setScissorTest(false);
  }

  monoLoop() {
    if (this.monoRunning) return;
    this.monoRunning = true;
    const loop = () => {
      if (this.woven) { this.monoRunning = false; return; }
      requestAnimationFrame(loop);
      this.step();
      const r = this.renderer;
      r.setScissorTest(true);
      r.setViewport(0, 0, this.canvas.width, this.canvas.height);
      r.setScissor(0, 0, this.canvas.width, this.canvas.height);
      r.clear();
      this.post.render(this.cam, { x: 0, y: 0, width: this.canvas.width, height: this.canvas.height });
      r.setScissorTest(false);
    };
    requestAnimationFrame(loop);
  }
}
