// Small maths helpers shared by every module.

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
/** Frame-rate independent exponential approach: rate is "how many e-folds per second". */
export const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const TAU = Math.PI * 2;

/** Signed shortest difference b - a, in (-PI, PI]. */
export function angleDiff(a, b) {
  return ((((b - a) % TAU) + 3 * Math.PI) % TAU) - Math.PI;
}

export function dampAngle(a, b, rate, dt) {
  return a + angleDiff(a, b) * (1 - Math.exp(-rate * dt));
}

export function dist2D(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Does the segment p->q (xz) cross the rect? Liang-Barsky clip. */
export function segmentHitsRect(px, pz, qx, qz, r) {
  let t0 = 0, t1 = 1;
  const dx = qx - px, dz = qz - pz;
  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  return clip(-dx, px - r.x0) && clip(dx, r.x1 - px) && clip(-dz, pz - r.z0) && clip(dz, r.z1 - pz) && t0 <= t1;
}
