// Post-processing, per eye: HDR render (MSAA) -> bloom -> tone map / sRGB output.
//
// One composer sized to an eye's viewport (both eyes are the same size, so it is rebuilt only when
// the canvas or quality changes). Its last pass draws to the screen inside whatever viewport and
// scissor are set, i.e. into the current eye's half of the side-by-side canvas. The same approach
// runs on the Leia panel in the music visualizer.
//
// maxEyeW caps the post resolution per eye; the output pass scales it up to the eye's viewport. An
// 8K panel's ~3700 px eyes are more detail than the weave shows, and bloom at that size costs fps.
//
// Gotcha: keep the clear colour pure black and scene.background null. The RenderPass clears with
// the renderer's clear colour, which the OutputPass would convert a second time (grey haze).

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Safety net before the bloom: one NaN or infinite pixel would otherwise be smeared by the blur
// chain into a large black block. Also caps extreme HDR values.
const Sanitize = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  // The exponent-bits test, not isnan(): the D3D compiler behind ANGLE may optimise isnan() away.
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    bool bad(float x) { return (floatBitsToUint(x) & 0x7f800000u) == 0x7f800000u; }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      if (bad(c.r) || bad(c.g) || bad(c.b) || bad(c.a)) c = vec4(0.0);
      gl_FragColor = vec4(min(c.rgb, vec3(48.0)), c.a);
    }`,
};

export const QUALITY = {
  ultra: { label: 'Ultra', samples: 4, maxEyeW: 2560, bloom: true, particles: 1, trails: true },
  high: { label: 'High', samples: 2, maxEyeW: 1920, bloom: true, particles: 0.6, trails: true },
  low: { label: 'Low', samples: 0, maxEyeW: 1600, bloom: false, particles: 0.3, trails: false },
};

export class Post {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.level = 'ultra';
    this.key = '';
    this.composer = null;
    this.bloom = { strength: 0.9, radius: 0.55, threshold: 0.72 };
  }

  get q() { return QUALITY[this.level]; }

  setLevel(level) {
    if (!QUALITY[level]) return;
    this.level = level;
    this.key = '';
  }

  setBloom(b) {
    Object.assign(this.bloom, b);
    if (this.bloomPass) Object.assign(this.bloomPass, this.bloom);
  }

  ensure(w, h) {
    const key = `${w}x${h}:${this.level}`;
    if (key === this.key) return;
    this.key = key;
    this.composer?.dispose?.();
    this.composer = null;
    if (!this.q.bloom) return;
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: this.q.samples });
    const c = (this.composer = new EffectComposer(this.renderer, rt));
    c.setPixelRatio(1);
    this.renderPass = new RenderPass(this.scene, null);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), this.bloom.strength, this.bloom.radius, this.bloom.threshold);
    c.addPass(this.renderPass);
    c.addPass(new ShaderPass(Sanitize));
    c.addPass(this.bloomPass);
    c.addPass(new OutputPass());
    c.setSize(w, h);
  }

  /** Draw the scene from `cam` into viewport `vp` (canvas pixels). */
  render(cam, vp) {
    const r = this.renderer;
    r.setViewport(vp.x, vp.y, vp.width, vp.height);
    r.setScissor(vp.x, vp.y, vp.width, vp.height);
    const s = Math.min(1, this.q.maxEyeW / vp.width);
    this.ensure(Math.max(1, Math.round(vp.width * s)), Math.max(1, Math.round(vp.height * s)));
    if (this.composer) {
      this.renderPass.camera = cam;
      this.composer.render();
    } else {
      r.render(this.scene, cam);
    }
  }
}
