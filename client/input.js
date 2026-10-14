// Controles: joystick táctil + botones (apuntado automático o manual) y teclado/mouse.
export class Input {
  constructor(root, opts = {}) {
    this.root = root;
    this.vibrate = opts.vibrate ?? true;
    this.getPlayerScreen = opts.getPlayerScreen || (() => null);
    this.onEmote = opts.onEmote || (() => {});
    this.onEmoteWheel = opts.onEmoteWheel || (() => {});
    this.mx = 0; this.my = 0;
    this.joyId = null;
    this.joyBase = { x: 0, y: 0 };
    this.aimId = null;
    this.aimStart = { x: 0, y: 0 };
    this.aim = null; // vector manual en curso
    this.aiming = false;
    this.pressAttack = false;
    this.attackAim = null;
    this.pressAbility = false;
    this.pressUlt = false;
    this.keys = new Set();
    this.mouse = null;
    this.mouseDown = false;
    this.enabled = true;
    this.listeners = [];

    this.joy = root.querySelector('#joy');
    this.knob = root.querySelector('#joyKnob');
    this.zone = root.querySelector('#joyZone');
    this.btnAttack = root.querySelector('#btnAttack');
    this.btnAbility = root.querySelector('#btnAbility');
    this.btnUlt = root.querySelector('#btnUlt');
    this.btnEmote = root.querySelector('#btnEmote');
    this.bind();
  }

  on(el, ev, fn, o) {
    el.addEventListener(ev, fn, o);
    this.listeners.push([el, ev, fn, o]);
  }

  buzz(ms = 12) {
    if (this.vibrate && navigator.vibrate) try { navigator.vibrate(ms); } catch { /* */ }
  }

  bind() {
    const R = 56;
    const touchMode = 'ontouchstart' in window;
    this.touchMode = touchMode;

    // --- joystick
    const joyStart = (id, x, y) => {
      if (this.joyId !== null) return;
      this.joyId = id;
      this.joyBase = { x, y };
      this.joy.style.left = x + 'px';
      this.joy.style.top = y + 'px';
      this.joy.classList.add('on');
      this.knob.style.transform = 'translate(-50%,-50%)';
    };
    const joyMove = (x, y) => {
      let dx = x - this.joyBase.x, dy = y - this.joyBase.y;
      const l = Math.hypot(dx, dy);
      if (l > R) {
        // el joystick sigue al dedo (cómodo en pantallas chicas)
        const over = l - R;
        this.joyBase.x += (dx / l) * over;
        this.joyBase.y += (dy / l) * over;
        this.joy.style.left = this.joyBase.x + 'px';
        this.joy.style.top = this.joyBase.y + 'px';
        dx = (dx / l) * R; dy = (dy / l) * R;
      }
      const n = Math.min(1, l / R);
      const dead = 0.12;
      const k = n < dead ? 0 : (n - dead) / (1 - dead);
      this.mx = l ? (dx / Math.min(l, R)) * k : 0;
      this.my = l ? (dy / Math.min(l, R)) * k : 0;
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    };
    const joyEnd = () => {
      this.joyId = null;
      this.mx = this.my = 0;
      this.joy.classList.remove('on');
    };

    // --- ataque: tocar = auto-apuntado, arrastrar = apuntado manual
    const atkStart = (id, x, y) => {
      if (this.aimId !== null) return;
      this.aimId = id;
      this.aimStart = { x, y };
      this.aim = null;
      this.aiming = false;
      this.btnAttack.classList.add('down');
    };
    const atkMove = (x, y) => {
      const dx = x - this.aimStart.x, dy = y - this.aimStart.y;
      const l = Math.hypot(dx, dy);
      if (l > 16) {
        this.aiming = true;
        this.aim = [dx / l, dy / l];
      }
    };
    const atkEnd = (cancel) => {
      this.aimId = null;
      this.btnAttack.classList.remove('down');
      if (cancel) { this.aiming = false; this.aim = null; return; }
      this.pressAttack = true;
      this.attackAim = this.aiming ? this.aim : null;
      this.aiming = false;
      this.aim = null;
      this.buzz(10);
    };
    const ability = () => { this.pressAbility = true; this.buzz(15); this.btnAbility.classList.add('down'); setTimeout(() => this.btnAbility.classList.remove('down'), 120); };
    const ult = () => { this.pressUlt = true; this.buzz(25); };

    if (touchMode) {
      // Eventos táctiles nativos: multi-touch confiable en iOS y Android
      const opt = { passive: false };
      this.on(this.zone, 'touchstart', (e) => {
        e.preventDefault();
        const t = e.changedTouches[0];
        joyStart(t.identifier, t.clientX, t.clientY);
      }, opt);
      this.on(this.btnAttack, 'touchstart', (e) => {
        e.preventDefault();
        const t = e.changedTouches[0];
        atkStart(t.identifier, t.clientX, t.clientY);
      }, opt);
      this.on(this.btnAbility, 'touchstart', (e) => { e.preventDefault(); ability(); }, opt);
      this.on(this.btnUlt, 'touchstart', (e) => { e.preventDefault(); ult(); }, opt);
      this.on(this.btnEmote, 'touchstart', (e) => { e.preventDefault(); this.onEmoteWheel(); }, opt);
      this.on(window, 'touchmove', (e) => {
        for (const t of e.changedTouches) {
          if (t.identifier === this.joyId) joyMove(t.clientX, t.clientY);
          else if (t.identifier === this.aimId) atkMove(t.clientX, t.clientY);
        }
        if (this.joyId !== null || this.aimId !== null) e.preventDefault();
      }, opt);
      const end = (e) => {
        const cancel = e.type === 'touchcancel';
        for (const t of e.changedTouches) {
          if (t.identifier === this.joyId) joyEnd();
          if (t.identifier === this.aimId) atkEnd(cancel);
        }
      };
      this.on(window, 'touchend', end);
      this.on(window, 'touchcancel', end);
    }

    // Puntero (mouse / lápiz / navegadores sin touch events)
    const isTouchPtr = (e) => touchMode && e.pointerType === 'touch';
    this.on(this.zone, 'pointerdown', (e) => {
      if (isTouchPtr(e)) return;
      e.preventDefault();
      joyStart(e.pointerId, e.clientX, e.clientY);
      try { this.zone.setPointerCapture(e.pointerId); } catch { /* */ }
    });
    this.on(this.zone, 'pointermove', (e) => { if (!isTouchPtr(e) && e.pointerId === this.joyId) joyMove(e.clientX, e.clientY); });
    const pJoyEnd = (e) => { if (!isTouchPtr(e) && e.pointerId === this.joyId) joyEnd(); };
    this.on(this.zone, 'pointerup', pJoyEnd);
    this.on(this.zone, 'pointercancel', pJoyEnd);
    this.on(this.btnAttack, 'pointerdown', (e) => {
      if (isTouchPtr(e)) return;
      e.preventDefault();
      atkStart(e.pointerId, e.clientX, e.clientY);
      try { this.btnAttack.setPointerCapture(e.pointerId); } catch { /* */ }
    });
    this.on(this.btnAttack, 'pointermove', (e) => { if (!isTouchPtr(e) && e.pointerId === this.aimId) atkMove(e.clientX, e.clientY); });
    const pAtkEnd = (e) => { if (!isTouchPtr(e) && e.pointerId === this.aimId) atkEnd(e.type === 'pointercancel'); };
    this.on(this.btnAttack, 'pointerup', pAtkEnd);
    this.on(this.btnAttack, 'pointercancel', pAtkEnd);
    this.on(this.btnAbility, 'pointerdown', (e) => { if (isTouchPtr(e)) return; e.preventDefault(); ability(); });
    this.on(this.btnUlt, 'pointerdown', (e) => { if (isTouchPtr(e)) return; e.preventDefault(); ult(); });
    this.on(this.btnEmote, 'pointerdown', (e) => { if (isTouchPtr(e)) return; e.preventDefault(); this.onEmoteWheel(); });

    // teclado
    this.on(window, 'keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === ' ' || k === 'j') { this.pressAttack = true; this.attackAim = this.mouseAim(); e.preventDefault(); }
      if (k === 'shift' || k === 'k') this.pressAbility = true;
      if (k === 'q' || k === 'e' || k === 'l') this.pressUlt = true;
      if (k >= '1' && k <= '8') this.onEmote(+k - 1);
      if (k === 't') this.onEmoteWheel();
    });
    this.on(window, 'keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    this.on(window, 'blur', () => { this.keys.clear(); this.mx = this.my = 0; });

    // mouse (PC): click para disparar hacia el puntero
    const canvas = document.getElementById('game');
    if (canvas) {
      this.on(canvas, 'mousemove', (e) => { this.mouse = { x: e.clientX, y: e.clientY }; });
      this.on(canvas, 'mousedown', (e) => {
        if (e.button === 0) { this.pressAttack = true; this.mouse = { x: e.clientX, y: e.clientY }; this.attackAim = this.mouseAim(); }
        if (e.button === 2) this.pressAbility = true;
      });
      this.on(canvas, 'contextmenu', (e) => e.preventDefault());
    }
  }

  mouseAim() {
    if (!this.mouse) return null;
    const p = this.getPlayerScreen();
    if (!p) return null;
    const dx = this.mouse.x - p.x, dy = (this.mouse.y - p.y) * 1.25;
    const l = Math.hypot(dx, dy);
    return l > 4 ? [dx / l, dy / l] : null;
  }

  // Lee y consume el estado del input para este tick
  sample() {
    let mx = this.mx, my = this.my;
    const kx = (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0) - (this.keys.has('a') || this.keys.has('arrowleft') ? 1 : 0);
    const ky = (this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0) - (this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0);
    if (kx || ky) {
      const l = Math.hypot(kx, ky);
      mx = kx / l; my = ky / l;
    }
    const out = {
      mx, my,
      attack: this.pressAttack,
      aim: this.attackAim,
      ability: this.pressAbility,
      ult: this.pressUlt,
    };
    this.pressAttack = this.pressAbility = this.pressUlt = false;
    this.attackAim = null;
    if (!this.enabled) { out.mx = out.my = 0; out.attack = out.ability = out.ult = false; }
    return out;
  }

  reset() {
    this.mx = this.my = 0;
    this.joyId = null;
    this.aimId = null;
    this.aiming = false;
    this.joy.classList.remove('on');
    this.pressAttack = this.pressAbility = this.pressUlt = false;
  }

  destroy() {
    for (const [el, ev, fn, o] of this.listeners) el.removeEventListener(ev, fn, o);
    this.listeners = [];
  }
}
