// HUD en DOM: marcador, botones, etiquetas, textos flotantes, minimapa, flechas y avisos.
import { TEAMS, EMOTES, PAPOIS, F } from '../shared/constants.js';
import { W, H, RIVER, BRIDGES, RECTS, CIRCLES, BUSHES, BASES } from '../shared/map.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.root = $('hud');
    this.el = {
      sc0: $('sc0'), sc1: $('sc1'), fs0: $('fs0'), fs1: $('fs1'), timer: $('timer'),
      feed: $('feed'), banner: $('banner'), territory: $('territory'), labels: $('labels'),
      floaters: $('floaters'), arrows: $('arrows'), vignette: $('vignette'), frost: $('frost'),
      countdown: $('countdown'), jailbox: $('jailbox'), jailTxt: $('jailTxt'), tip: $('tip'),
      ultRing: $('ultRing'), ultPct: $('ultPct'), btnUlt: $('btnUlt'), btnAttack: $('btnAttack'),
      btnAbility: $('btnAbility'), atkCd: $('atkCd'), abiCd: $('abiCd'), atkIco: $('atkIco'), abiIco: $('abiIco'),
      minimap: $('minimap'), ping: $('ping'), emoteWheel: $('emoteWheel'), waitbox: $('waitbox'),
    };
    this.labels = new Map();
    this.floaters = [];
    this.arrowEls = [];
    this.lastScore = [0, 0];
    this.mmBg = null;
    this.mmCtx = this.el.minimap.getContext('2d');
    this.tipTimer = null;
    this.bannerQueue = [];
    this.bannerBusy = 0;
    this.cache = {};
  }

  show(on) { this.root.classList.toggle('hidden', !on); }

  setTeam(team) {
    this.team = team;
    this.el.btnAttack.classList.toggle('t1', team !== PAPOIS);
    this.el.btnAbility.classList.toggle('t1', team !== PAPOIS);
    this.el.btnUlt.classList.toggle('t1', team !== PAPOIS);
    this.el.atkIco.textContent = team === PAPOIS ? '❄️' : '🥥';
    this.el.abiIco.textContent = team === PAPOIS ? '💨' : '🦘';
    this.buildMinimapBg();
  }

  clear() {
    this.el.labels.innerHTML = '';
    this.el.floaters.innerHTML = '';
    this.el.arrows.innerHTML = '';
    this.el.feed.innerHTML = '';
    this.el.banner.innerHTML = '';
    this.el.countdown.innerHTML = '';
    this.labels.clear();
    this.floaters = [];
    this.arrowEls = [];
    this.lastScore = [0, 0];
    this.cache = {};
    this.el.jailbox.classList.add('hidden');
    this.el.waitbox.classList.add('hidden');
    this.el.vignette.className = '';
    this.el.frost.className = '';
  }

  setText(key, el, txt) {
    if (this.cache[key] === txt) return;
    this.cache[key] = txt;
    el.textContent = txt;
  }

  // ------------------------------------------------------------ marcador
  score(sc, flags, timeLeft, phase) {
    for (const t of [0, 1]) {
      if (sc[t] !== this.lastScore[t]) {
        const el = t ? this.el.sc1 : this.el.sc0;
        el.textContent = sc[t];
        el.classList.remove('bump');
        void el.offsetWidth;
        el.classList.add('bump');
        this.lastScore[t] = sc[t];
      }
      const st = flags[t]?.state ?? 0;
      const fsEl = t ? this.el.fs1 : this.el.fs0;
      this.setText('fs' + t, fsEl, st === 0 ? '🚩' : st === 1 ? '🏃' : '⚠️');
      const cls = st === 0 ? 'flagst' : 'flagst stolen';
      if (fsEl.className !== cls) fsEl.className = cls;
    }
    const s = Math.max(0, Math.ceil(timeLeft));
    const txt = phase === 2 ? `⚡${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.setText('timer', this.el.timer, txt);
    const cls = 'timer' + (phase === 2 ? ' ot' : s <= 30 && phase === 1 ? ' hot' : '');
    if (this.el.timer.className !== cls) this.el.timer.className = cls;
  }

  // ------------------------------------------------------------ botones
  buttons(p) {
    const atk = Math.max(0, p.atkCd || 0), abi = Math.max(0, p.abiCd || 0);
    this.cd(this.el.atkCd, atk, 'atk');
    this.cd(this.el.abiCd, p.mutantT > 0 ? 0 : abi, 'abi');
    this.el.btnAbility.classList.toggle('disabled', p.mutantT > 0);
    const u = Math.min(1, p.ult || 0);
    const off = Math.round(283 * (1 - u));
    if (this.cache.ult !== off) {
      this.cache.ult = off;
      this.el.ultRing.style.strokeDashoffset = off;
      this.el.ultPct.textContent = p.mutantT > 0 ? `${Math.ceil(p.mutantT)}s` : `${Math.floor(u * 100)}%`;
    }
    const ready = u >= 1 && p.mutantT <= 0 && p.carrying < 0;
    this.el.btnUlt.classList.toggle('ready', ready);
    if (p.mutantT > 0) this.setText('ultPct', this.el.ultPct, `${Math.ceil(p.mutantT)}s`);
  }

  cd(el, v, key) {
    const on = v > 0.05;
    const txt = on ? (v >= 2 ? Math.ceil(v) : v.toFixed(1)) : '';
    if (this.cache[key] !== txt) {
      this.cache[key] = txt;
      el.textContent = txt;
      el.classList.toggle('on', on);
    }
  }

  // ------------------------------------------------------------ territorio / estados
  territory(kind, text) {
    if (this.cache.terr === kind + text) return;
    this.cache.terr = kind + text;
    this.el.territory.className = kind;
    this.el.territory.textContent = text;
  }

  danger(on, mutant) {
    const cls = mutant ? 'mut' : on ? 'on' : '';
    if (this.el.vignette.className !== cls) this.el.vignette.className = cls;
  }

  frost(on) {
    const cls = on ? 'on' : '';
    if (this.el.frost.className !== cls) this.el.frost.className = cls;
  }

  countdown(v) {
    const txt = v > 0 ? String(Math.ceil(v)) : '';
    if (this.cache.cd === txt) return;
    this.cache.cd = txt;
    this.el.countdown.innerHTML = txt ? `<div><span>${txt}</span><small>¡Prepárate!</small></div>` : '';
  }

  waiting(text) {
    const on = !!text;
    this.el.waitbox.classList.toggle('hidden', !on);
    if (on) this.setText('wait', this.el.waitbox, text);
  }

  jail(on, secs) {
    this.el.jailbox.classList.toggle('hidden', !on);
    if (on) this.setText('jail', this.el.jailTxt, `Libre en ${Math.ceil(secs)} s… o espera que te rescaten`);
  }

  ping(ms, local) {
    this.setText('ping', this.el.ping, local ? 'offline · bots' : `${Math.round(ms)} ms`);
  }

  // ------------------------------------------------------------ avisos
  feed(html, cls = '') {
    const d = document.createElement('div');
    d.className = cls;
    d.innerHTML = html;
    this.el.feed.prepend(d);
    while (this.el.feed.children.length > 5) this.el.feed.lastChild.remove();
    setTimeout(() => d.classList.add('out'), 4000);
    setTimeout(() => d.remove(), 4600);
  }

  banner(text, sub = '', cls = '', dur = 2400) {
    this.bannerQueue.push({ text, sub, cls, dur });
    if (!this.bannerBusy) this.nextBanner();
  }

  nextBanner() {
    const b = this.bannerQueue.shift();
    if (!b) { this.bannerBusy = 0; return; }
    this.bannerBusy = 1;
    this.el.banner.innerHTML = `<div class="b ${b.cls}" style="animation-duration:${b.dur}ms">${b.text}${b.sub ? `<small>${b.sub}</small>` : ''}</div>`;
    setTimeout(() => this.nextBanner(), Math.min(b.dur, this.bannerQueue.length ? 1300 : b.dur));
  }

  tip(text, dur = 4500) {
    this.el.tip.textContent = text;
    this.el.tip.classList.add('on');
    clearTimeout(this.tipTimer);
    this.tipTimer = setTimeout(() => this.el.tip.classList.remove('on'), dur);
  }

  // ------------------------------------------------------------ etiquetas
  syncLabels(roster, meId) {
    for (const [id, l] of this.labels) {
      if (!roster.has(id)) { l.el.remove(); this.labels.delete(id); }
    }
    for (const r of roster.values()) {
      let l = this.labels.get(r.id);
      if (!l) {
        const el = document.createElement('div');
        el.className = 'lbl t' + r.team + (r.id === meId ? ' me' : '');
        el.innerHTML = '<span class="bub"></span><span class="st"></span><span class="lv"></span><span class="nm"></span>';
        this.el.labels.appendChild(el);
        l = { el, bub: el.children[0], st: el.children[1], lv: el.children[2], nm: el.children[3], bubbleT: 0, last: '' };
        this.labels.set(r.id, l);
      }
      l.lv.textContent = r.level || 1;
      l.nm.textContent = (r.bot ? '🤖 ' : '') + r.name;
    }
  }

  label(id, sx, sy, on, flags, dt) {
    const l = this.labels.get(id);
    if (!l) return;
    if (!on) {
      if (l.el.style.display !== 'none') l.el.style.display = 'none';
      return;
    }
    if (l.el.style.display === 'none') l.el.style.display = '';
    l.el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -100%)`;
    let st = '';
    if (flags & F.CARRY) st = '🚩';
    else if (flags & F.FROZEN) st = '🧊';
    else if (flags & F.STUNNED) st = '💫';
    else if (flags & F.MUTANT) st = '☣️';
    else if (flags & F.SHIELD) st = '🛡️';
    else if (flags & F.SLOWED) st = '🤢';
    if (l.last !== st) { l.last = st; l.st.textContent = st; }
    if (l.bubbleT > 0) {
      l.bubbleT -= dt;
      if (l.bubbleT <= 0) { l.bub.className = 'bub'; l.bub.textContent = ''; }
    }
  }

  bubble(id, text) {
    const l = this.labels.get(id);
    if (!l) return;
    l.bub.textContent = text;
    l.bub.className = 'bub bubble';
    l.bubbleT = 2.6;
  }

  // ------------------------------------------------------------ textos flotantes
  floater(x, y, h, text, color = '#fff', size = 20) {
    const el = document.createElement('div');
    el.className = 'fl';
    el.textContent = text;
    el.style.color = color;
    el.style.fontSize = size + 'px';
    this.el.floaters.appendChild(el);
    this.floaters.push({ el, x, y, h, t: 0, dur: 1.1 });
    if (this.floaters.length > 14) { const f = this.floaters.shift(); f.el.remove(); }
  }

  updateFloaters(dt, world) {
    const out = { x: 0, y: 0, on: false };
    this.floaters = this.floaters.filter((f) => {
      f.t += dt;
      if (f.t >= f.dur) { f.el.remove(); return false; }
      const k = f.t / f.dur;
      world.toScreen(f.x, f.y, f.h + k * 1.2, out);
      const sc = k < 0.15 ? 0.5 + (k / 0.15) * 0.7 : 1.2 - Math.min(0.2, (k - 0.15));
      f.el.style.transform = `translate3d(${out.x}px, ${out.y}px, 0) translate(-50%, -50%) scale(${sc.toFixed(2)})`;
      f.el.style.opacity = k > 0.7 ? (1 - (k - 0.7) / 0.3).toFixed(2) : '1';
      return true;
    });
  }

  // ------------------------------------------------------------ flechas fuera de pantalla
  arrows(list, world, vw, vh) {
    while (this.arrowEls.length < list.length) {
      const el = document.createElement('div');
      el.className = 'ar';
      el.innerHTML = '<span></span><i></i>';
      this.el.arrows.appendChild(el);
      this.arrowEls.push(el);
    }
    const out = { x: 0, y: 0, on: false };
    this.arrowEls.forEach((el, i) => {
      const a = list[i];
      if (!a) { el.style.display = 'none'; return; }
      world.toScreen(a.x, a.y, 0.5, out);
      const m = 46;
      const inside = out.x > m && out.x < vw - m && out.y > m + 50 && out.y < vh - m;
      if (inside) { el.style.display = 'none'; return; }
      el.style.display = '';
      const cx = vw / 2, cy = vh / 2;
      let dx = out.x - cx, dy = out.y - cy;
      const sx = (vw / 2 - m) / Math.abs(dx || 1e-3), sy = (vh / 2 - m - 30) / Math.abs(dy || 1e-3);
      const s = Math.min(sx, sy);
      let px = cx + dx * s, py = cy + dy * s;
      // no tapar los botones de acción ni el marcador
      if (px > vw - 270 && py > vh - 240) py = vh - 240;
      if (py < 70) py = 70;
      el.style.transform = `translate3d(${px}px, ${py}px, 0)`;
      el.style.borderColor = a.color;
      const ang = Math.atan2(dy, dx);
      const sp = el.children[0], ar = el.children[1];
      if (sp.textContent !== a.icon) sp.textContent = a.icon;
      ar.style.transform = `rotate(${ang}rad)`;
      ar.style.borderLeftColor = a.color;
    });
  }

  // ------------------------------------------------------------ minimapa
  buildMinimapBg() {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 144;
    const g = c.getContext('2d');
    const sx = 256 / W, sy = 144 / H;
    g.fillStyle = '#5b6068'; g.fillRect(0, 0, RIVER.x0 * sx, 144);
    g.fillStyle = '#3f6a2a'; g.fillRect(RIVER.x1 * sx, 0, 256, 144);
    g.fillStyle = '#2a7fa8'; g.fillRect(RIVER.x0 * sx, 0, (RIVER.x1 - RIVER.x0) * sx, 144);
    g.fillStyle = '#b08a5a';
    for (const b of BRIDGES) g.fillRect((RIVER.x0 - 0.5) * sx, b.y0 * sy, (RIVER.x1 - RIVER.x0 + 1) * sx, (b.y1 - b.y0) * sy);
    g.fillStyle = 'rgba(30,60,20,0.8)';
    for (const b of BUSHES) { g.beginPath(); g.arc(b.x * sx, b.y * sy, b.r * sx, 0, 7); g.fill(); }
    g.fillStyle = 'rgba(20,20,25,0.85)';
    for (const r of RECTS) g.fillRect(r.x * sx, r.y * sy, r.w * sx, r.h * sy);
    for (const c2 of CIRCLES) { g.beginPath(); g.arc(c2.x * sx, c2.y * sy, c2.r * sx, 0, 7); g.fill(); }
    for (const b of BASES) {
      g.strokeStyle = TEAMS[b.team].color; g.lineWidth = 2;
      g.beginPath(); g.arc(b.flag.x * sx, b.flag.y * sy, 2.8 * sx, 0, 7); g.stroke();
      g.strokeStyle = '#ff5a5a';
      g.beginPath(); g.arc(b.jail.x * sx, b.jail.y * sy, 2.2 * sx, 0, 7); g.stroke();
    }
    this.mmBg = c;
  }

  minimap(state) {
    const g = this.mmCtx;
    const sx = 256 / W, sy = 144 / H;
    g.drawImage(this.mmBg, 0, 0);
    for (const s of state.serums) {
      g.fillStyle = '#c77dff';
      g.beginPath(); g.arc(s.x * sx, s.y * sy, 4, 0, 7); g.fill();
    }
    state.flags.forEach((f, i) => {
      g.fillStyle = TEAMS[i].color;
      g.strokeStyle = '#000'; g.lineWidth = 1.5;
      const x = f.x * sx, y = f.y * sy;
      g.beginPath(); g.moveTo(x, y + 6); g.lineTo(x, y - 7); g.lineTo(x + 8, y - 4); g.lineTo(x, y - 1); g.closePath();
      g.fill(); g.stroke();
    });
    for (const p of state.players) {
      if (!p.visible) continue;
      const x = p.x * sx, y = p.y * sy;
      g.fillStyle = p.me ? '#ffffff' : p.ally ? TEAMS[p.team].color : '#ff4d5a';
      g.beginPath(); g.arc(x, y, p.me ? 5 : 3.6, 0, 7); g.fill();
      if (p.me) { g.strokeStyle = TEAMS[p.team].color; g.lineWidth = 2; g.stroke(); }
      if (p.carry) { g.strokeStyle = '#fff36b'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 6.5, 0, 7); g.stroke(); }
    }
    // ventana de la cámara
    if (state.view) {
      g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1;
      g.strokeRect((state.view.x - state.view.w / 2) * sx, (state.view.y - state.view.h / 2) * sy, state.view.w * sx, state.view.h * sy);
    }
  }

  // ------------------------------------------------------------ emotes
  openEmotes(onPick) {
    const w = this.el.emoteWheel;
    w.innerHTML = '<div class="wheel">' + EMOTES.map((e, i) => `<button data-e="${i}">${e}</button>`).join('') + '</div>';
    w.classList.remove('hidden');
    const close = () => w.classList.add('hidden');
    w.onclick = (ev) => {
      const b = ev.target.closest('button');
      if (b) onPick(+b.dataset.e);
      close();
    };
  }
}
