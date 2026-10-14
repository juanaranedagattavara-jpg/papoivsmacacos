// Partida en el cliente: predicción, interpolación, eventos, cámara y HUD.
import * as THREE from 'three';
import {
  DT, F, TEAMS, WEAPONS, ABILITIES, MUTATION, EMOTES, PAPOIS, MACACOS, RULES,
} from '../shared/constants.js';
import { moveByInput, PHASE } from '../shared/sim.js';
import { territoryOf, lineOfSight, BASES, solidAt } from '../shared/map.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { speak } from './audio.js';

const r3 = (v) => Math.round(v * 1000) / 1000;
const lerp = (a, b, t) => a + (b - a) * t;
function lerpAngle(a, b, t) {
  let d = b - a;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return a + d * t;
}

function makePred(team) {
  return {
    team, x: 0, y: 0, face: team === PAPOIS ? 0 : Math.PI,
    frozenT: 0, stunT: 0, slowT: 0, boostT: 0, shieldT: 0, aimT: 0, landT: 0,
    leapT: 0, leapDx: 0, leapDy: 0, dashT: 0, dashDx: 0, dashDy: 0,
    transformT: 0, mutantT: 0, carrying: -1, state: 0, group: 0, zoneOn: true, locked: true,
    atkCd: 0, abiCd: 0, ult: 0, jailT: 0,
  };
}

function canActLocal(p) {
  return p.state === 0 && !p.locked && p.frozenT <= 0 && p.stunT <= 0 && p.transformT <= 0 && p.leapT <= 0 && p.dashT <= 0;
}

function tickTimers(p, dt) {
  p.frozenT = Math.max(0, p.frozenT - dt);
  p.stunT = Math.max(0, p.stunT - dt);
  p.slowT = Math.max(0, p.slowT - dt);
  p.boostT = Math.max(0, p.boostT - dt);
  p.shieldT = Math.max(0, p.shieldT - dt);
  p.aimT = Math.max(0, p.aimT - dt);
  p.landT = Math.max(0, p.landT - dt);
  p.atkCd = Math.max(0, p.atkCd - dt);
  p.abiCd = Math.max(0, p.abiCd - dt);
  if (p.transformT > 0) p.transformT = Math.max(0, p.transformT - dt);
  else if (p.mutantT > 0) p.mutantT = Math.max(0, p.mutantT - dt);
}

export class Game {
  constructor({ world, conn, start, profile, sound, onEnd, onQuit, toast }) {
    this.world = world;
    this.conn = conn;
    this.profile = profile;
    this.sound = sound;
    this.onEnd = onEnd;
    this.onQuit = onQuit;
    this.toast = toast;
    this.settings = start.settings;
    this.code = start.code;
    this.meId = start.you;
    this.roster = new Map(start.roster.map((r) => [r.id, r]));
    this.team = this.roster.get(this.meId)?.team ?? 0;
    this.pred = makePred(this.team);
    this.prevPred = { x: 0, y: 0 };
    this.pending = [];
    this.seq = 0;
    this.smooth = { x: 0, y: 0 };
    this.acc = 0;
    this.snaps = [];
    this.latest = null;
    this.clock = null;
    this.interpDelay = conn.isLocal ? 0.06 : 0.13;
    this.phase = PHASE.COUNTDOWN;
    this.timeLeft = this.settings.duration;
    this.score = [0, 0];
    this.renderPos = new Map();
    this.ghosts = [];
    this.ghostSeq = 0;
    this.seenProj = new Set();
    this.look = { x: 0, y: 0 };
    this.time = 0;
    this.running = true;
    this.ended = false;
    this.myTags = [];
    this.lastTerr = -1;
    this.tipsShown = new Set();
    this.lastCd = -1;
    this.mmTimer = 0;
    this.myBush = -1;
    this.initialized = false;
    this.frozenSelf = false;

    this.hud = new Hud();
    this.hud.clear();
    this.hud.setTeam(this.team);
    this.hud.show(true);
    this.hud.syncLabels(this.roster, this.meId);
    this.world.setPlayers([...this.roster.values()], this.meId, this.team);
    this.world.zoomTarget = 1;
    this.screenTmp = { x: 0, y: 0, on: false };

    this.input = new Input(document.getElementById('hud'), {
      vibrate: profile.prefs.vibrate,
      getPlayerScreen: () => {
        const o = { x: 0, y: 0, on: false };
        const rp = this.renderPos.get(this.meId);
        if (!rp) return null;
        return this.world.toScreen(rp.x, rp.y, 0.8, o);
      },
      onEmote: (i) => this.sendEmote(i),
      onEmoteWheel: () => this.hud.openEmotes((i) => this.sendEmote(i)),
    });

    // indicador de apuntado
    const tex = (() => {
      const c = document.createElement('canvas');
      c.width = 32; c.height = 256;
      const g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 256, 0, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)');
      gr.addColorStop(1, 'rgba(255,255,255,0.1)');
      g.fillStyle = gr;
      g.fillRect(8, 0, 16, 256);
      return new THREE.CanvasTexture(c);
    })();
    const geo = new THREE.PlaneGeometry(0.5, 1);
    geo.translate(0, 0.5, 0);
    this.aimMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: this.team === PAPOIS ? 0x8fe8ff : 0xffd27a }));
    this.aimMesh.rotation.x = -Math.PI / 2;
    this.aimMesh.visible = false;
    this.world.scene.add(this.aimMesh);

    this.bindUi();
    this.sound.setIntensity(0);
    this.sound.startMusic();
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
    this.tipsEnabled = profile.prefs.tips;
  }

  bindUi() {
    const $ = (id) => document.getElementById(id);
    this.ui = {
      pause: $('pauseMenu'),
    };
    this.onPause = () => {
      this.paused = this.conn.isLocal;
      $('pauseInfo').textContent = this.conn.isLocal ? 'Partida contra bots (en pausa)' : `Sala ${this.code} · la partida sigue corriendo`;
      this.ui.pause.classList.remove('hidden');
      this.conn.setPaused(true);
      this.input.reset();
    };
    this.onResume = () => { this.ui.pause.classList.add('hidden'); this.conn.setPaused(false); this.paused = false; };
    this.onQuitBtn = () => this.quit();
    this.onHelp = () => this.sendEmote(4);
    $('btnPause').onclick = this.onPause;
    $('btnResume').onclick = this.onResume;
    $('btnQuit').onclick = this.onQuitBtn;
    $('btnHelp').onclick = this.onHelp;
  }

  sendEmote(i) {
    this.conn.send({ t: 'emote', e: i });
  }

  quit() {
    if (!this.running) return;
    this.destroy();
    this.onQuit();
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.input.destroy();
    this.hud.show(false);
    this.hud.clear();
    this.ui.pause.classList.add('hidden');
    document.getElementById('emoteWheel').classList.add('hidden');
    this.world.scene.remove(this.aimMesh);
    this.world.fx.syncProjectiles([], 0, () => ({ x: 0, y: 0 }));
    this.world.fx.syncPeels([]);
    this.world.fx.syncSerums([]);
    this.sound.setIntensity(0);
  }

  // ------------------------------------------------------------ red
  onMessage(m) {
    if (!this.running) return;
    switch (m.t) {
      case 's': this.onSnapshot(m); break;
      case 'roster':
        this.roster = new Map(m.roster.map((r) => [r.id, r]));
        this.world.setPlayers(m.roster, this.meId, this.team);
        this.hud.syncLabels(this.roster, this.meId);
        break;
      case 'end': this.finish(m.results); break;
      case 'error': this.toast(m.msg, true); break;
      default: break;
    }
  }

  onSnapshot(m) {
    const now = performance.now() / 1000;
    const sample = m.tm - now;
    if (this.clock === null) this.clock = sample;
    else if (sample > this.clock) this.clock += (sample - this.clock) * 0.25;
    else this.clock += (sample - this.clock) * 0.03;

    m.pmap = new Map();
    for (const a of m.p) m.pmap.set(a[0], a);
    this.snaps.push(m);
    if (this.snaps.length > 40) this.snaps.shift();
    this.latest = m;
    this.phase = m.ph;
    this.timeLeft = m.tl;
    this.score = m.sc;
    if (m.you) this.reconcile(m.you);
    if (!this.initialized) {
      this.initialized = true;
      this.world.camTarget.set(this.pred.x, 0, this.pred.y);
      this.prevPred = { x: this.pred.x, y: this.pred.y };
    }
    for (const ev of m.ev || []) this.handleEvent(ev);
  }

  reconcile(y) {
    const p = this.pred;
    const wasJailed = p.state === 1;
    const bx = p.x + this.smooth.x, by = p.y + this.smooth.y;
    p.state = y.s;
    p.jailT = y.j;
    p.x = y.x; p.y = y.y;
    p.atkCd = y.a; p.abiCd = y.b; p.ult = y.u;
    p.frozenT = y.fz; p.stunT = y.st; p.slowT = y.sl; p.boostT = y.bo;
    p.leapT = y.lp; p.leapDx = y.ldx; p.leapDy = y.ldy;
    p.dashT = y.ds; p.dashDx = y.ddx; p.dashDy = y.ddy;
    p.transformT = y.tr; p.mutantT = y.mu; p.group = y.g; p.shieldT = y.sh;
    p.carrying = y.cr; p.zoneOn = !!y.zo; p.locked = !!y.lk;
    if (y.s === 1) {
      this.pending = [];
      this.smooth.x = this.smooth.y = 0;
      this.prevPred = { x: p.x, y: p.y };
      return;
    }
    this.pending = this.pending.filter((e) => e.s > y.ack);
    for (const e of this.pending) this.replay(p, e);
    const dx = bx - p.x, dy = by - p.y;
    if (wasJailed || Math.hypot(dx, dy) > 3.5) {
      this.smooth.x = this.smooth.y = 0;
      this.prevPred = { x: p.x, y: p.y };
    } else {
      this.smooth.x = dx; this.smooth.y = dy;
    }
  }

  replay(p, e) {
    moveByInput(p, e.inp, DT);
    if (e.leap && p.leapT <= 0) {
      p.leapDx = e.leap[0]; p.leapDy = e.leap[1];
      p.leapT = p.carrying >= 0 ? ABILITIES[MACACOS].carryTime : ABILITIES[MACACOS].time;
    }
    if (e.dash && p.dashT <= 0) { p.dashDx = e.dash[0]; p.dashDy = e.dash[1]; p.dashT = MUTATION.lungeTime; }
    if (e.atk) p.atkCd = Math.max(p.atkCd, e.atk);
    if (e.abi) p.abiCd = Math.max(p.abiCd, e.abi);
    tickTimers(p, DT);
  }

  // ------------------------------------------------------------ tick fijo (30 Hz)
  fixedTick() {
    const raw = this.input.sample();
    const p = this.pred;
    const playing = this.phase === PHASE.PLAY || this.phase === PHASE.OVERTIME;
    let b = 0, ax = 0, ay = 0;
    if (raw.attack) {
      b |= 1;
      const a = raw.aim || this.autoAim();
      ax = a[0]; ay = a[1];
    }
    if (raw.ability) b |= 2;
    if (raw.ult) b |= 4;
    const inp = { s: ++this.seq, mx: r3(raw.mx), my: r3(raw.my), ax: r3(ax), ay: r3(ay), b };
    this.conn.send({ t: 'in', ...inp });
    const entry = { s: inp.s, inp, leap: null, dash: null, atk: 0, abi: 0 };
    this.prevPred = { x: p.x, y: p.y };
    if (p.state === 0) {
      moveByInput(p, inp, DT);
      if (playing) {
        if ((b & 1) && canActLocal(p) && p.atkCd <= 0) {
          p.face = Math.atan2(ay, ax);
          p.aimT = 0.35;
          if (p.mutantT > 0) {
            p.dashT = MUTATION.lungeTime; p.dashDx = ax; p.dashDy = ay;
            entry.dash = [ax, ay];
            p.atkCd = entry.atk = MUTATION.lungeCooldown;
            this.sound.play('lunge');
          } else {
            const w = WEAPONS[this.team];
            p.atkCd = entry.atk = w.cooldown;
            this.ghosts.push({
              id: 'g' + (++this.ghostSeq), kind: this.team, x: p.x + ax * 0.55, y: p.y + ay * 0.55,
              vx: ax * w.speed, vy: ay * w.speed, life: w.range / w.speed, born: performance.now(),
            });
            this.sound.play(this.team === PAPOIS ? 'shootIce' : 'throw', { vol: 0.8 });
          }
        }
        if ((b & 2) && canActLocal(p) && p.abiCd <= 0 && p.mutantT <= 0) {
          const a = ABILITIES[this.team];
          p.abiCd = entry.abi = a.cooldown;
          if (this.team === MACACOS) {
            let dx = inp.mx, dy = inp.my;
            let l = Math.hypot(dx, dy);
            if (l < 0.2) { dx = Math.cos(p.face); dy = Math.sin(p.face); l = 1; }
            p.leapDx = dx / l; p.leapDy = dy / l;
            p.leapT = p.carrying >= 0 ? a.carryTime : a.time;
            entry.leap = [p.leapDx, p.leapDy];
            this.sound.play('leap');
          } else {
            p.boostT = a.boost;
            this.sound.play('fart');
            this.world.fx.fart(p.x, p.y);
            this.world.shake(0.25, 0.25);
            this.ownFartT = performance.now();
          }
        }
      }
    }
    this.pending.push(entry);
    if (this.pending.length > 120) this.pending.shift();
    tickTimers(p, DT);
  }

  autoAim() {
    const p = this.pred;
    const mutant = p.mutantT > 0;
    const range = mutant ? 4.5 : WEAPONS[this.team].range * 1.02;
    let best = null, bestScore = Infinity, bestD = 0;
    const fx = Math.cos(p.face), fy = Math.sin(p.face);
    for (const [id, r] of this.renderPos) {
      if (id === this.meId) continue;
      const info = this.roster.get(id);
      if (!info || info.team === this.team) continue;
      if (r.flags & F.JAILED || r.hidden) continue;
      const dx = r.x - p.x, dy = r.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > range || d < 0.01) continue;
      if (!lineOfSight(p.x, p.y, r.x, r.y, 0.1)) continue;
      let score = d;
      if (r.flags & F.CARRY) score -= 6;
      if (territoryOf(r.x) === this.team) score -= 3;
      if (r.flags & (F.FROZEN | F.STUNNED)) score += 4;
      if (r.flags & (F.MUTANT | F.SHIELD)) score += 8;
      score -= ((dx * fx + dy * fy) / d) * 1.5;
      if (score < bestScore) { bestScore = score; best = r; bestD = d; }
    }
    if (best) {
      const sp = mutant ? MUTATION.lungeSpeed : WEAPONS[this.team].speed;
      const t = (bestD / sp) * 0.85 + (this.conn.rtt || 0) / 2000;
      const ax = best.x + (best.vx || 0) * t - p.x, ay = best.y + (best.vy || 0) * t - p.y;
      const l = Math.hypot(ax, ay) || 1;
      return [ax / l, ay / l];
    }
    const ml = Math.hypot(this.input.mx, this.input.my);
    if (ml > 0.2) return [this.input.mx / ml, this.input.my / ml];
    return [fx, fy];
  }

  // ------------------------------------------------------------ bucle
  frame(tms) {
    if (!this.running) return;
    this.raf = requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.1, Math.max(0, (tms - this.last) / 1000));
    this.last = tms;
    this.time += dt;
    if (!this.ended && this.latest && !this.paused) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= DT && n < 5) { this.fixedTick(); this.acc -= DT; n++; }
      if (this.acc > DT * 5) this.acc = 0;
    }
    this.render(dt);
  }

  interpolate(rt) {
    const S = this.snaps;
    if (!S.length) return;
    let s0 = S[0], s1 = S[0];
    for (let i = S.length - 1; i >= 0; i--) {
      if (S[i].tm <= rt) { s0 = S[i]; s1 = S[i + 1] || S[i]; break; }
    }
    const span = s1.tm - s0.tm;
    const t = span > 0 ? Math.max(0, Math.min(1, (rt - s0.tm) / span)) : 1;
    const seen = new Set();
    for (const a1 of s1.p) {
      const id = a1[0];
      seen.add(id);
      const a0 = s0.pmap.get(id) || a1;
      let x = lerp(a0[1], a1[1], t), y = lerp(a0[2], a1[2], t);
      if (Math.hypot(a1[1] - a0[1], a1[2] - a0[2]) > 4) { x = a1[1]; y = a1[2]; }
      let r = this.renderPos.get(id);
      if (!r) { r = { id, x, y, face: a1[3], flags: a1[4], vx: 0, vy: 0 }; this.renderPos.set(id, r); }
      r.x = x; r.y = y;
      r.face = lerpAngle(a0[3], a1[3], t);
      r.flags = t < 0.5 ? a0[4] : a1[4];
      r.ult = a1[5];
      r.mutantT = a1[6];
      if (span > 0) { r.vx = (a1[1] - a0[1]) / span; r.vy = (a1[2] - a0[2]) / span; }
    }
    for (const id of this.renderPos.keys()) if (!seen.has(id)) this.renderPos.delete(id);
  }

  render(dt) {
    const now = performance.now() / 1000;
    const L = this.latest;
    if (!L) { this.world.update(dt, { focus: { x: 32, y: 18 }, players: [], flags: [{ state: 0 }, { state: 0 }], myBush: -1 }); this.world.render(); return; }
    const serverNow = now + this.clock;
    const rt = serverNow - this.interpDelay;
    this.interpolate(rt);

    // jugador propio (predicho e interpolado entre ticks)
    const p = this.pred;
    const k = Math.exp(-12 * dt);
    this.smooth.x *= k; this.smooth.y *= k;
    const alpha = Math.min(1, this.acc / DT);
    const meR = this.renderPos.get(this.meId);
    if (meR) {
      if (p.state === 0) {
        meR.x = lerp(this.prevPred.x, p.x, alpha) + this.smooth.x;
        meR.y = lerp(this.prevPred.y, p.y, alpha) + this.smooth.y;
        meR.face = p.face;
        let fl = meR.flags & ~(F.AIR | F.DASH);
        if (p.leapT > 0) fl |= F.AIR;
        if (p.dashT > 0) fl |= F.DASH;
        meR.flags = fl;
      }
    }

    // visibilidad (arbustos)
    const me = meR || { x: p.x, y: p.y };
    const players = [];
    for (const [id, r] of this.renderPos) {
      const info = this.roster.get(id);
      if (!info) continue;
      const enemy = info.team !== this.team;
      r.hidden = enemy && (r.flags & F.BUSH) && !(r.flags & F.CARRY) && Math.hypot(r.x - me.x, r.y - me.y) > 3.2;
      players.push(r);
    }
    this.myBush = meR && (meR.flags & F.BUSH) ? this.bushIndex(meR.x, meR.y) : -1;

    // banderas
    const flags = L.fl.map((f) => ({ state: f[0], x: f[1], y: f[2], carrier: f[3] }));
    for (const f of flags) {
      if (f.state === 1) {
        const c = this.renderPos.get(f.carrier);
        if (c) { f.x = c.x; f.y = c.y; }
      }
    }

    // mirada de la cámara
    const ml = Math.hypot(this.input.mx, this.input.my);
    let lx = ml > 0.1 ? this.input.mx * 1.8 : 0, ly = ml > 0.1 ? this.input.my * 1.4 : 0;
    if (this.input.aiming && this.input.aim) { lx = this.input.aim[0] * 2.5; ly = this.input.aim[1] * 2; }
    this.look.x += (lx - this.look.x) * Math.min(1, dt * 2.5);
    this.look.y += (ly - this.look.y) * Math.min(1, dt * 2.5);
    const focus = p.state === 1 && meR ? { x: meR.x + (this.team === PAPOIS ? 3 : -3), y: meR.y - 3 } : meR || { x: p.x, y: p.y };
    this.world.zoomTarget = p.state === 1 ? 1.25 : p.mutantT > 0 || p.transformT > 0 ? 1.12 : 1;

    this.world.update(dt, { focus, look: p.state === 1 ? null : this.look, players, flags, myBush: this.myBush });

    // proyectiles (servidor + fantasmas locales)
    const ownT = serverNow + (this.conn.rtt || 0) / 2000;
    const list = [];
    for (const a of L.pj) {
      const [id, kind, x, y, vx, vy, owner] = a;
      if (!this.seenProj.has(id)) {
        this.seenProj.add(id);
        if (owner === this.meId && this.ghosts.length) this.ghosts.shift();
        if (this.seenProj.size > 400) this.seenProj = new Set([...this.seenProj].slice(-200));
      }
      const tt = (owner === this.meId ? ownT : rt) - L.tm;
      list.push({ id, kind, vx, vy, x: x + vx * tt, y: y + vy * tt });
    }
    this.ghosts = this.ghosts.filter((g) => {
      const age = (performance.now() - g.born) / 1000;
      if (age > g.life || age > 0.7) return false;
      g.cx = g.x + g.vx * age; g.cy = g.y + g.vy * age;
      if (solidAt(g.cx, g.cy, 0.05)) return false;
      list.push({ id: g.id, kind: g.kind, vx: g.vx, vy: g.vy, x: g.cx, y: g.cy });
      return true;
    });
    this.world.fx.syncProjectiles(list, rt, (q) => ({ x: q.x, y: q.y }));
    this.world.fx.syncClouds(L.cl.map((c) => ({ id: c[0], x: c[1], y: c[2], r: c[3], f: c[4] })));
    this.world.fx.syncPeels(L.pe.map((q) => ({ id: q[0], x: q[1], y: q[2] })));
    this.world.fx.syncSerums(L.su.map((s) => ({ id: s[0], x: s[1], y: s[2] })));

    // polvo y salpicaduras
    for (const r of players) {
      if (r.hidden || (r.flags & F.JAILED)) continue;
      const sp = Math.hypot(r.vx || 0, r.vy || 0);
      const moving = r.id === this.meId ? Math.hypot(this.input.mx, this.input.my) > 0.2 && canActLocal(p) : sp > 1;
      if (!moving) continue;
      if (r.flags & F.WATER) { if (Math.random() < dt * 6) { this.world.fx.splash(r.x, r.y); } }
      else if (Math.random() < dt * 7) this.world.fx.dust(r.x, r.y, territoryOf(r.x) === 0 ? 0xb8bcc4 : 0xb59a6a, 1);
      if (r.flags & F.MUTANT && Math.random() < dt * 20) this.world.fx.sparkle(r.x, r.y, this.roster.get(r.id)?.team === PAPOIS ? 0xa040ff : 0xff3a1a, 1);
    }

    // indicador de apuntado
    if (this.input.aiming && this.input.aim && meR && p.state === 0) {
      const range = p.mutantT > 0 ? MUTATION.lungeSpeed * MUTATION.lungeTime : WEAPONS[this.team].range;
      this.aimMesh.visible = true;
      this.aimMesh.position.set(meR.x, 0.08, meR.y);
      this.aimMesh.scale.set(1, range, 1);
      this.aimMesh.rotation.set(-Math.PI / 2, 0, Math.atan2(-this.input.aim[0], -this.input.aim[1]));
    } else this.aimMesh.visible = false;

    this.world.render();
    this.updateHud(dt, players, flags, L);
  }

  bushIndex(x, y) {
    let best = -1, bd = Infinity;
    this.world.env.bushes.forEach((b, i) => {
      const d = Math.hypot(b.bush.x - x, b.bush.y - y);
      if (d < b.bush.r + 0.3 && d < bd) { bd = d; best = i; }
    });
    return best;
  }

  // ------------------------------------------------------------ HUD
  updateHud(dt, players, flags, L) {
    const hud = this.hud;
    const p = this.pred;
    hud.score(this.score, flags, this.timeLeft, this.phase);
    hud.buttons(p);
    hud.countdown(this.phase === PHASE.COUNTDOWN ? L.cd : 0);
    if (this.phase === PHASE.COUNTDOWN) {
      const c = Math.ceil(L.cd);
      if (c !== this.lastCd && c <= 3 && c > 0) { this.sound.play('beep'); this.lastCd = c; }
    }
    hud.jail(p.state === 1, p.jailT);
    hud.ping(this.conn.rtt || 0, this.conn.isLocal);

    // etiquetas
    const o = this.screenTmp;
    for (const r of players) {
      const h = this.world.charHeight(r.id);
      this.world.toScreen(r.x, r.y, h, o);
      hud.label(r.id, o.x, o.y, o.on && !r.hidden, r.flags, dt);
    }
    hud.updateFloaters(dt, this.world);

    // territorio / estado
    const meR = this.renderPos.get(this.meId);
    if (meR && p.state === 0) {
      const terr = territoryOf(meR.x);
      const own = terr === this.team;
      if (p.mutantT > 0 || p.transformT > 0) hud.territory('carry', `☣️ ¡${TEAMS[this.team].mutant.toUpperCase()}! Derriba a todos`);
      else if (p.carrying >= 0) hud.territory('carry', '🚩 ¡Llévala a tu base!');
      else if (own) hud.territory('safe', '🛡️ Tu territorio · atrapa intrusos');
      else hud.territory('danger', '⚠️ Territorio enemigo · ¡cuidado!');
      hud.danger(!own && p.mutantT <= 0, p.mutantT > 0 || p.transformT > 0);
      if (terr !== this.lastTerr) {
        if (this.lastTerr !== -1 && !own) this.showTip('enemy', '¡Estás en territorio enemigo! Si te tocan, vas a la jaula. Usa tu ataque y habilidad para escapar.');
        this.lastTerr = terr;
      }
    } else {
      hud.territory('', '');
      hud.danger(false, false);
    }
    hud.frost(p.frozenT > 0 && p.state === 0);

    // música
    const carried = flags.some((f) => f.state === 1);
    this.sound.setIntensity(carried ? 1 : this.phase === PHASE.OVERTIME || this.timeLeft < 60 ? 0.6 : 0);

    // flechas
    const arrows = [];
    const myBase = BASES[this.team], enemyBase = BASES[1 - this.team];
    const myFlag = flags[this.team], enemyFlag = flags[1 - this.team];
    const tc = TEAMS[this.team].color, ec = TEAMS[1 - this.team].color;
    if (p.state === 0) {
      if (p.carrying >= 0) arrows.push({ x: myBase.flag.x, y: myBase.flag.y, icon: '🏠', color: tc });
      else if (enemyFlag.state === 1 && this.roster.get(enemyFlag.carrier)?.team === this.team) arrows.push({ x: enemyFlag.x, y: enemyFlag.y, icon: '🏃', color: tc });
      else arrows.push({ x: enemyFlag.x, y: enemyFlag.y, icon: '🚩', color: ec });
      if (myFlag.state !== 0) arrows.push({ x: myFlag.x, y: myFlag.y, icon: '⚠️', color: '#ff4d5a' });
      const prisoners = [...this.renderPos.values()].some((r) => r.id !== this.meId && (r.flags & F.JAILED) && this.roster.get(r.id)?.team === this.team);
      if (prisoners) arrows.push({ x: enemyBase.jail.x, y: enemyBase.jail.y, icon: '⛓️', color: '#ff8a8a' });
      const su = L.su.map((s) => ({ x: s[1], y: s[2] })).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
      if (su) arrows.push({ x: su.x, y: su.y, icon: '🧪', color: '#c77dff' });
    }
    hud.arrows(arrows, this.world, this.world.viewW, this.world.viewH);

    // minimapa (10 Hz)
    this.mmTimer -= dt;
    if (this.mmTimer <= 0) {
      this.mmTimer = 0.1;
      const allies = players.filter((r) => this.roster.get(r.id)?.team === this.team && !(r.flags & F.JAILED));
      const mm = players.map((r) => {
        const info = this.roster.get(r.id);
        const ally = info?.team === this.team;
        const seen = ally || (r.flags & F.CARRY) || (!r.hidden && allies.some((a) => Math.hypot(a.x - r.x, a.y - r.y) < 11));
        return { x: r.x, y: r.y, team: info?.team ?? 0, ally, me: r.id === this.meId, visible: seen, carry: r.flags & F.CARRY };
      });
      const cam = this.world.camTarget;
      hud.minimap({ players: mm, flags, serums: L.su.map((s) => ({ x: s[1], y: s[2] })), view: { x: cam.x, y: cam.z, w: 22, h: 12 } });
    }

    // consejos iniciales
    if (this.tipsEnabled && this.phase !== PHASE.COUNTDOWN) {
      const t = this.settings.duration - this.timeLeft;
      if (t > 0.5) this.showTip('move', 'Muévete con el joystick (izquierda). Toca el botón grande para disparar: ¡apunta solo! Arrástralo para apuntar tú.');
      if (t > 9) this.showTip('goal', 'Cruza el río, toca la bandera enemiga 🚩 y tráela a tu base. En tu lado puedes atrapar intrusos tocándolos.');
      if (t > 20) this.showTip('jail', 'Si atrapan a un aliado, toca la jaula enemiga ⛓️ para liberarlo. ¡Trabajo en equipo!');
      if (t > 32) this.showTip('ult', 'Cuando la barra ☣️ llegue a 100%, ¡MUTA! Toca aliados para contagiarlos.');
    }
  }

  showTip(key, text) {
    if (this.tipsShown.has(key)) return;
    this.tipsShown.add(key);
    this.hud.tip(text, 5500);
  }

  // ------------------------------------------------------------ eventos
  name(id) {
    const r = this.roster.get(id);
    if (!r) return '?';
    return `<span class="p${r.team}">${escapeHtml(r.name)}</span>`;
  }

  posOf(id) {
    if (id === this.meId) {
      const r = this.renderPos.get(id);
      return r ? { x: r.x, y: r.y } : { x: this.pred.x, y: this.pred.y };
    }
    return this.renderPos.get(id) || null;
  }

  sfxAt(name, x, y, base = 1) {
    const me = this.renderPos.get(this.meId) || this.pred;
    const d = Math.hypot(x - me.x, y - me.y);
    const vol = base * Math.max(0.12, Math.min(1, 1.15 - d / 20));
    this.sound.play(name, { vol, pan: (x - me.x) / 14 });
  }

  buzz(ms) {
    if (this.profile.prefs.vibrate && navigator.vibrate) try { navigator.vibrate(ms); } catch { /* */ }
  }

  handleEvent(ev) {
    const [type, a, b, c, d] = ev;
    const fx = this.world.fx;
    const meId = this.meId;
    const teamOf = (id) => this.roster.get(id)?.team;
    switch (type) {
      case 'go':
        this.hud.banner('¡YA!', 'Roba la bandera enemiga', 't' + this.team, 1400);
        this.sound.play('go');
        this.buzz(40);
        break;
      case 'shoot': {
        if (a === meId) break;
        const pp = this.posOf(a);
        if (pp) this.sfxAt(teamOf(a) === PAPOIS ? 'shootIce' : 'throw', pp.x, pp.y, 0.6);
        break;
      }
      case 'phit':
        fx.impact(a, b, c);
        break;
      case 'freeze': {
        const pp = this.posOf(b);
        if (pp) { fx.iceShatter(pp.x, pp.y); this.sfxAt('freeze', pp.x, pp.y); this.world.hitChar(b); }
        if (a === meId) { this.sound.play('hit'); if (pp) this.hud.floater(pp.x, pp.y, 2, '¡CONGELADO!', '#8fe8ff'); this.buzz(15); }
        if (b === meId) { this.world.shake(0.4); this.buzz(80); this.hud.floater(this.pred.x, this.pred.y, 2.2, '🧊', '#8fe8ff', 30); }
        break;
      }
      case 'stun': {
        const pp = this.posOf(b);
        if (pp) { fx.stunHit(pp.x, pp.y); this.sfxAt('bonk', pp.x, pp.y); this.world.hitChar(b); }
        if (a === meId) { this.sound.play('hit'); if (pp) this.hud.floater(pp.x, pp.y, 2, '¡BONK!', '#ffd27a'); this.buzz(15); }
        if (b === meId) { this.world.shake(0.5); this.buzz(80); }
        break;
      }
      case 'immune': {
        fx.impact(b, c, d);
        if (teamOf(a) !== this.team) this.hud.floater(b, c, 2, 'INMUNE', '#ccc', 15);
        break;
      }
      case 'fart': {
        const own = a === meId && this.ownFartT && performance.now() - this.ownFartT < 1500;
        if (!own) { fx.fart(b, c); this.sfxAt('fart', b, c); }
        break;
      }
      case 'leap': {
        const pp = this.posOf(a);
        if (pp) { fx.dust(pp.x, pp.y, 0xc8b48a, 6); if (a !== meId) this.sfxAt('leap', pp.x, pp.y, 0.6); }
        break;
      }
      case 'slip': {
        fx.dust(c, d, 0xffe14a, 6);
        this.sfxAt('slip', c, d);
        const pp = this.posOf(a);
        if (pp) this.hud.floater(pp.x, pp.y, 2, '¡RESBALÓN!', '#ffe14a', 18);
        if (b === meId) { this.sound.play('hit'); }
        if (a === meId) this.buzz(60);
        break;
      }
      case 'lunge': {
        const pp = this.posOf(a);
        if (pp && a !== meId) this.sfxAt('lunge', pp.x, pp.y, 0.7);
        break;
      }
      case 'mutate': {
        const pp = this.posOf(a);
        const t = teamOf(a);
        if (pp) { fx.mutate(pp.x, pp.y, t); this.sfxAt('mutate', pp.x, pp.y, 1.1); this.world.flashChar(a); }
        if (a === meId) {
          this.hud.banner(`¡${TEAMS[t].mutant.toUpperCase()}!`, 'Inmune · derribas a todos · toca aliados para contagiar', 'mut', 2200);
          this.world.shake(0.8, 0.5);
          this.buzz([60, 40, 120]);
        } else {
          this.hud.feed(`☣️ ${this.name(a)} se volvió <b>${TEAMS[t].mutant}</b>`);
          if (t !== this.team && pp && this.pred.state === 0 && Math.hypot(pp.x - this.pred.x, pp.y - this.pred.y) < 14) {
            this.hud.banner('¡MUTANTE CERCA!', '¡Corre!', 'bad', 1300);
          }
        }
        break;
      }
      case 'shock':
        this.world.shake(0.35, 0.3);
        this.sfxAt('shock', b, c, 0.8);
        break;
      case 'infect': {
        const pp = this.posOf(b);
        if (pp) { fx.mutate(pp.x, pp.y, teamOf(b)); this.sfxAt('infect', pp.x, pp.y); this.hud.floater(pp.x, pp.y, 2.4, '¡CONTAGIO!', '#c77dff'); }
        if (b === meId) { this.hud.banner('¡TE CONTAGIARON!', `Ahora eres ${TEAMS[this.team].mutant}`, 'mut', 1800); this.buzz(80); }
        this.hud.feed(`🦠 ${this.name(a)} contagió a ${this.name(b)}`);
        break;
      }
      case 'unmutate': {
        const pp = this.posOf(a);
        if (pp) fx.poof(pp.x, pp.y, teamOf(a) === PAPOIS ? 0xd0a0ff : 0xff9a8a);
        break;
      }
      case 'knock': {
        const pp = this.posOf(b);
        if (pp) { fx.stunHit(pp.x, pp.y); this.sfxAt('knock', pp.x, pp.y); this.hud.floater(pp.x, pp.y, 2.2, '¡DERRIBADO!', '#ff9a6b'); this.world.hitChar(b); }
        if (b === meId) { this.world.shake(0.6); this.buzz(100); }
        break;
      }
      case 'tag': {
        const pp = this.posOf(b);
        if (pp) { fx.poof(pp.x, pp.y); this.sfxAt('tag', pp.x, pp.y); }
        const jailed = c === 1, carrier = d === 1;
        this.hud.feed(`${carrier ? '🚩' : '✋'} ${this.name(a)} atrapó a ${this.name(b)}`);
        if (a === meId) {
          const now = performance.now();
          this.myTags = this.myTags.filter((t) => now - t < 4500);
          this.myTags.push(now);
          const n = this.myTags.length;
          const txt = n >= 3 ? '¡IMPARABLE!' : n === 2 ? '¡DOBLE ATRAPADA!' : carrier ? '¡LADRÓN ATRAPADO!' : '¡ATRAPADO!';
          if (pp) this.hud.floater(pp.x, pp.y, 2.4, txt, '#fff36b', n >= 2 ? 28 : 22);
          if (n >= 2 || carrier) this.hud.banner(txt, carrier ? '¡Bandera recuperable!' : '', 't' + this.team, 1300);
          this.sound.play('hit');
          this.buzz(30);
        }
        if (b === meId && jailed) {
          this.sound.play('jailed');
          this.world.shake(0.5);
          this.buzz([100, 50, 100]);
          this.hud.banner('¡ATRAPADO!', 'Pide ayuda: un aliado puede liberarte', 'bad', 1800);
        }
        break;
      }
      case 'rescue': {
        const pp = this.posOf(a);
        this.sound.play('rescue', { vol: teamOf(a) === this.team ? 1 : 0.5 });
        if (pp) fx.sparkle(pp.x, pp.y, TEAMS[teamOf(a)].colorHex, 30);
        this.hud.feed(`🔓 ${this.name(a)} liberó a ${b} ${b === 1 ? 'aliado' : 'aliados'}`);
        if (a === meId) { this.hud.banner('¡RESCATE!', `Liberaste a ${b}`, 't' + this.team, 1500); this.buzz(40); }
        else if (teamOf(a) === this.team && this.pred.state === 0 && this.wasJailed) {
          this.hud.banner('¡LIBRE!', `Te rescató ${escapeHtml(this.roster.get(a)?.name || '')} · ¡corre!`, 't' + this.team, 1500);
        }
        break;
      }
      case 'release':
        if (a === meId) this.hud.banner('¡Libre!', 'Vuelve a la acción', 't' + this.team, 1100);
        break;
      case 'steal': {
        const t = teamOf(a);
        const ours = b === this.team;
        if (a === meId) {
          this.hud.banner('¡TIENES LA BANDERA!', '¡Corre a tu base! 🏠', 't' + this.team, 1800);
          this.sound.play('steal');
          this.buzz([40, 30, 40]);
        } else if (ours) {
          this.hud.banner('¡NOS ROBARON LA BANDERA!', `¡Atrapen a ${escapeHtml(this.roster.get(a)?.name || '')}!`, 'bad', 1700);
          this.sound.play('stolen');
          this.showTip('stolen', 'Persigue al ladrón: tócalo en tu territorio o congélalo/aturdelo para frenarlo.');
        } else {
          this.hud.banner(`¡${escapeHtml(this.roster.get(a)?.name || '')} TIENE LA BANDERA!`, '¡Escóltalo!', 't' + t, 1500);
          this.sound.play('steal', { vol: 0.6 });
        }
        this.hud.feed(`🚩 ${this.name(a)} robó la bandera`);
        break;
      }
      case 'pickup':
        this.hud.feed(`🚩 ${this.name(a)} recogió la bandera`);
        if (a === meId) this.hud.banner('¡BANDERA RECUPERADA!', '¡A tu base!', 't' + this.team, 1300);
        break;
      case 'drop':
        this.sfxAt('drop', b, c);
        this.hud.feed(`💥 Cayó la bandera ${a === 0 ? 'Papoi' : 'Macaca'}`);
        if (a === this.team) this.showTip('drop', 'Tu bandera cayó: tócala para devolverla a tu base.');
        break;
      case 'freturn':
        this.sound.play('return', { vol: 0.7 });
        if (b >= 0) this.hud.feed(`↩️ ${this.name(b)} devolvió la bandera`);
        else this.hud.feed(`↩️ La bandera ${a === 0 ? 'Papoi' : 'Macaca'} volvió a casa`);
        if (b === meId) { this.hud.floater(this.pred.x, this.pred.y, 2.2, '¡DEVUELTA!', '#7ef0b0'); this.buzz(30); }
        break;
      case 'cap': {
        const t = b;
        const mine = t === this.team;
        this.score = [c, d];
        const base = BASES[t].flag;
        fx.celebrate(base.x, base.y, t === PAPOIS ? [0xffc928, 0x2b5aa8, 0xffffff] : [0x3ddc84, 0x6b3d1e, 0xffe14a]);
        this.sound.play(mine ? 'capture' : 'enemyCapture');
        this.hud.banner(mine ? '¡CAPTURA!' : `Captura de los ${TEAMS[t].name}`, `${this.roster.get(a)?.name || ''} anotó · ${c} - ${d}`, mine ? 't' + t : 'bad', 2400);
        this.hud.feed(`🏆 ${this.name(a)} capturó la bandera`);
        if (a === meId) { this.world.shake(0.7, 0.5); this.buzz([80, 40, 80, 40, 160]); }
        break;
      }
      case 'serumSpawn':
        this.sound.play('serumSpawn', { vol: 0.7 });
        this.hud.feed('🧪 ¡Apareció un Suero Mutante!');
        break;
      case 'serum': {
        const pp = this.posOf(a);
        if (pp) { fx.sparkle(pp.x, pp.y, 0xc77dff, 24); this.sfxAt('serum', pp.x, pp.y); }
        if (a === meId) { this.hud.floater(this.pred.x, this.pred.y, 2.3, '+35% ☣️', '#c77dff', 24); this.buzz(30); }
        break;
      }
      case 'brote':
        this.hud.banner('¡BROTE!', 'Último minuto · todos cargan mutación', 'mut', 2600);
        this.sound.play('brote');
        this.world.shake(0.5, 0.6);
        this.buzz([100, 60, 100]);
        break;
      case 'overtime':
        this.hud.banner('¡GOL DE ORO!', 'Empate: la próxima captura gana', 'mut', 2600);
        this.sound.play('brote');
        break;
      case 'needflag':
        if (a === meId) this.hud.banner('¡Recupera tu bandera!', 'Regla clásica: tu bandera debe estar en casa para anotar', 'bad', 1600);
        break;
      case 'emote': {
        const txt = EMOTES[b] || '';
        this.hud.bubble(a, txt);
        const t = teamOf(a);
        if (t === this.team || a === meId) {
          this.sound.play('emote', { vol: 0.6 });
          if (this.profile.prefs.voices && a !== meId) speak(txt, t);
        }
        break;
      }
      case 'end':
        break;
      default:
        break;
    }
    if (this.pred.state === 1) this.wasJailed = true;
    else if (type !== 'rescue') this.wasJailed = false;
  }

  finish(results) {
    if (this.ended) return;
    this.ended = true;
    const won = results.winner === this.team;
    const draw = results.winner === -1;
    this.hud.banner(draw ? '¡EMPATE!' : won ? '¡VICTORIA!' : 'DERROTA', `${results.score[0]} - ${results.score[1]}`, draw ? 'mut' : won ? 't' + this.team : 'bad', 3000);
    this.sound.play(won ? 'win' : 'lose');
    if (won) {
      const base = BASES[this.team].flag;
      this.world.fx.celebrate(base.x, base.y, this.team === PAPOIS ? [0xffc928, 0x2b5aa8, 0xffffff] : [0x3ddc84, 0x6b3d1e, 0xffe14a]);
    }
    this.input.reset();
    setTimeout(() => {
      if (!this.running) return;
      this.destroy();
      this.onEnd(results, this.meId, this.team);
    }, 3200);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export { escapeHtml, RULES };
