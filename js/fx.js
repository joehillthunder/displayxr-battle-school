// Spark particles: a fixed pool of additive glow points that fly, slow down and fade. One pool
// per scene scale (metres in the Battle Room, battle units in the fleet).

import * as THREE from 'three';
import { glowTexture } from './space.js';
import { rand } from './util.js';

let TEX = null;

export class Sparks {
  constructor(parent, max = 2000, size = 0.15) {
    TEX ??= glowTexture();
    this.max = max;
    this.scale = 1; // particle budget multiplier (quality)
    this.gain = 2; // brightness: above 1 the bloom pass catches it
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.c = new Float32Array(max * 3);
    this.c0 = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.c, 3).setUsage(THREE.DynamicDrawUsage));
    // A custom point shader rather than PointsMaterial: the point size is clamped and a spark
    // right at the camera is dropped. An unbounded point there turned into a huge black square once
    // it went through the HDR bloom.
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: TEX }, size: { value: size }, vh: { value: 1000 } },
      vertexShader: `attribute vec3 color; varying vec3 vC; uniform float size; uniform float vh;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vC = color;
          gl_Position = projectionMatrix * mv;
          float d = -mv.z;
          gl_PointSize = (d < 0.05 || dot(color, color) < 1e-6) ? 0.0 : clamp(size * projectionMatrix[1][1] * vh * 0.5 / d, 0.0, 64.0);
        }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC;
        void main() {
          float a = texture2D(map, gl_PointCoord).a;
          gl_FragColor = vec4(vC * a, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, mat);
    const vp = new THREE.Vector4();
    this.points.onBeforeRender = (renderer) => { renderer.getCurrentViewport(vp); mat.uniforms.vh.value = vp.w; };
    this.points.frustumCulled = false;
    parent.add(this.points);
  }

  emit(pos, n, color, speed = 4, life = 0.7, spread = 1) {
    const col = color.isColor ? color : new THREE.Color(color);
    n = Math.max(1, Math.round(n * this.scale));
    const d = new THREE.Vector3();
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      d.randomDirection().multiplyScalar(speed * rand(0.2, 1) * spread);
      this.p.set([pos.x, pos.y, pos.z], i * 3);
      this.v.set([d.x, d.y, d.z], i * 3);
      const b = rand(0.7, 1.6) * this.gain;
      this.c0.set([col.r * b, col.g * b, col.b * b], i * 3);
      this.life[i] = life * rand(0.5, 1.2);
      this.age[i] = 0;
    }
  }

  update(dt) {
    const drag = Math.exp(-2.2 * dt);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.age[i] += dt;
      const f = 1 - this.age[i] / this.life[i];
      const j = i * 3;
      if (f <= 0) { this.life[i] = 0; this.c[j] = this.c[j + 1] = this.c[j + 2] = 0; continue; }
      this.v[j] *= drag; this.v[j + 1] *= drag; this.v[j + 2] *= drag;
      this.p[j] += this.v[j] * dt; this.p[j + 1] += this.v[j + 1] * dt; this.p[j + 2] += this.v[j + 2] * dt;
      const k = f * f;
      this.c[j] = this.c0[j] * k; this.c[j + 1] = this.c0[j + 1] * k; this.c[j + 2] = this.c0[j + 2] * k;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.c.fill(0);
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}
