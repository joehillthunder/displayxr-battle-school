// Keyboard and mouse. Modes read held keys, one-shot presses and the mouse motion since last frame.
// Pointer lock is requested by the modes that steer with the mouse (Battle Room, the fighter);
// without it the raw cursor position and drag still work (the command console).

export class Input {
  constructor(el) {
    this.el = el;
    this.down = new Set();
    this.pressed = new Set();
    this.buttons = 0;
    this.clicks = []; // { button, x, y } in CSS px, one-shot
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.x = 0;
    this.y = 0;
    this.dragging = false;

    addEventListener('keydown', (e) => {
      if (e.target.closest?.('input, select, textarea')) return;
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => { this.down.clear(); this.buttons = 0; });

    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      this.buttons = e.buttons;
      this.downAt = { x: e.clientX, y: e.clientY, button: e.button };
      this.dragging = false;
      el.focus?.();
    });
    addEventListener('pointerup', (e) => {
      this.buttons = e.buttons;
      if (this.downAt && !this.dragging && e.target === el) this.clicks.push({ button: this.downAt.button, x: e.clientX, y: e.clientY });
      this.downAt = null;
    });
    addEventListener('pointermove', (e) => {
      this.x = e.clientX;
      this.y = e.clientY;
      if (document.pointerLockElement === el || this.buttons) {
        this.dx += e.movementX || 0;
        this.dy += e.movementY || 0;
      }
      if (this.downAt && Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 5) this.dragging = true;
    });
    el.addEventListener('wheel', (e) => { this.wheel += e.deltaY; e.preventDefault(); }, { passive: false });
  }

  get locked() { return document.pointerLockElement === this.el; }

  lock() {
    if (!this.locked) this.el.requestPointerLock?.()?.catch?.(() => {});
  }

  unlock() {
    if (this.locked) document.exitPointerLock();
  }

  key(code) { return this.down.has(code); }
  hit(code) { return this.pressed.has(code); }
  axis(neg, pos) { return (this.key(pos) ? 1 : 0) - (this.key(neg) ? 1 : 0); }

  /** Call once at the end of every frame. */
  endFrame() {
    this.pressed.clear();
    this.clicks.length = 0;
    this.dx = this.dy = this.wheel = 0;
  }
}
