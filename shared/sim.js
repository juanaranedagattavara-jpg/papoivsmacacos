// Motor de simulación autoritativo (corre en el servidor o en el navegador en modo offline).
import {
  DT, PLAYER, WEAPONS, ABILITIES, MUTATION, ULT, RULES, F, PAPOIS, MACACOS,
} from './constants.js';
import {
  W, H, MID, BASES, SERUM_SPOTS, collideCircle, inWater, bushAt, solidAt, territoryOf,
} from './map.js';

export const PHASE = { COUNTDOWN: 0, PLAY: 1, OVERTIME: 2, ENDED: 3 };

export function radiusOf(p) {
  return p.mutantT > 0 ? PLAYER.mutantRadius : PLAYER.radius;
}

export function canAct(p) {
  return p.state === 0 && p.frozenT <= 0 && p.stunT <= 0 && p.transformT <= 0 && p.leapT <= 0 && p.dashT <= 0;
}

function len(x, y) { return Math.hypot(x, y); }

// Movimiento dirigido por input. Compartido con la predicción del cliente.
export function moveByInput(p, inp, dt) {
  if (p.state !== 0) return;
  let vx = 0, vy = 0;
  if (p.leapT > 0) {
    const s = ABILITIES[1].speed;
    vx = p.leapDx * s; vy = p.leapDy * s;
    p.leapT = Math.max(0, p.leapT - dt);
    if (p.leapT <= 0) p.landT = 0.35; // aterrizaje: no puede atrapar por un instante
  } else if (p.dashT > 0) {
    const s = MUTATION.lungeSpeed;
    vx = p.dashDx * s; vy = p.dashDy * s;
    p.dashT = Math.max(0, p.dashT - dt);
  } else if (p.transformT > 0 || p.frozenT > 0 || p.stunT > 0 || p.locked) {
    // inmóvil
  } else {
    let mx = inp.mx || 0, my = inp.my || 0;
    const l = len(mx, my);
    if (l > 1) { mx /= l; my /= l; }
    let sp = PLAYER.speed[p.team];
    const mut = p.mutantT > 0;
    if (mut) sp *= PLAYER.mutantSpeed;
    if (p.carrying >= 0) sp *= PLAYER.carrySpeed;
    if (!mut && p.slowT > 0) sp *= PLAYER.slowFactor;
    if (p.boostT > 0) sp *= PLAYER.boostSpeed;
    if (p.group) sp *= 1 + p.group;
    if (inWater(p.x, p.y)) sp *= PLAYER.waterSpeed[p.team];
    vx = mx * sp; vy = my * sp;
    if (l > 0.1 && p.aimT <= 0) p.face = Math.atan2(my, mx);
  }
  p.x += vx * dt;
  p.y += vy * dt;
  collideCircle(p, radiusOf(p));
  if (p.zoneOn && p.carrying < 0) zoneCollide(p);
}

// Zona protegida: un jugador no puede entrar al círculo de su propia bandera (si está en casa)
export function zoneCollide(p) {
  const f = BASES[p.team].flag;
  const dx = p.x - f.x, dy = p.y - f.y;
  const rr = RULES.flagZone + radiusOf(p);
  const d2 = dx * dx + dy * dy;
  if (d2 < rr * rr) {
    const d = Math.sqrt(d2) || 1e-3;
    const nx = d2 > 1e-6 ? dx / d : (p.team === 0 ? 1 : -1), ny = d2 > 1e-6 ? dy / d : 0;
    p.x = f.x + nx * rr;
    p.y = f.y + ny * rr;
    collideCircle(p, radiusOf(p));
  }
}

let nextEntityId = 1;

export function makePlayer(info) {
  return {
    id: info.id,
    name: info.name,
    team: info.team,
    bot: !!info.bot,
    skin: info.skin || {},
    level: info.level || 1,
    x: 0, y: 0, face: info.team === PAPOIS ? 0 : Math.PI,
    kx: 0, ky: 0,
    state: 0, // 0 vivo, 1 en la cárcel
    jailT: 0, jailSlot: 0, jailTeam: -1,
    frozenT: 0, stunT: 0, slowT: 0, shieldT: 0, ccImmT: 0, boostT: 0, aimT: 0,
    leapT: 0, leapDx: 0, leapDy: 0, landT: 0,
    dashT: 0, dashDx: 0, dashDy: 0,
    transformT: 0, pendingMutant: 0, mutantT: 0, contagionCD: 0,
    atkCd: 0, abiCd: 0, ult: 0,
    carrying: -1,
    group: 0,
    zoneOn: true,
    locked: false,
    moving: false, bush: -1, water: false,
    inputs: [], ack: 0, lastX: 0, lastY: 0,
    emoteCd: 0, needFlagCd: 0,
    stats: { caps: 0, tags: 0, rescues: 0, hits: 0, returns: 0, steals: 0, infects: 0, jailed: 0, serums: 0 },
  };
}

export class Sim {
  constructor(settings, roster) {
    this.settings = settings;
    this.time = 0;
    this.phase = PHASE.COUNTDOWN;
    this.phaseT = RULES.countdown;
    this.timeLeft = settings.duration;
    this.score = [0, 0];
    this.winner = -1;
    this.events = [];
    this.players = [];
    this.byId = new Map();
    this.projectiles = [];
    this.clouds = [];
    this.peels = [];
    this.serums = [];
    this.serumT = 10;
    this.serumEvery = RULES.serumEvery;
    this.broteDone = false;
    this.flags = [0, 1].map((t) => ({
      team: t, state: 0, x: BASES[t].flag.x, y: BASES[t].flag.y, carrier: -1, dropT: 0,
    })); // state: 0 casa, 1 cargada, 2 caída
    this.bots = new Map();
    this.spawnCount = [0, 0];
    for (const info of roster) this.addPlayer(info);
  }

  emit(...ev) { this.events.push(ev); }

  addPlayer(info) {
    const p = makePlayer(info);
    this.players.push(p);
    this.byId.set(p.id, p);
    this.placeAtSpawn(p);
    if (this.phase === PHASE.COUNTDOWN) p.locked = true;
    return p;
  }

  removePlayer(id) {
    const p = this.byId.get(id);
    if (!p) return;
    if (p.carrying >= 0) this.dropFlag(p);
    this.players = this.players.filter((q) => q !== p);
    this.byId.delete(id);
    this.bots.delete(id);
  }

  placeAtSpawn(p) {
    const sp = BASES[p.team].spawns;
    const s = sp[this.spawnCount[p.team]++ % sp.length];
    p.x = s.x + (Math.random() - 0.5) * 0.6;
    p.y = s.y + (Math.random() - 0.5) * 0.6;
    p.face = p.team === PAPOIS ? 0 : Math.PI;
    collideCircle(p, radiusOf(p));
  }

  // --------------------------------------------------------------- input
  queueInput(id, inp) {
    const p = this.byId.get(id);
    if (!p || p.bot) return;
    p.inputs.push(inp);
    if (p.inputs.length > 12) p.inputs.splice(0, p.inputs.length - 12);
  }

  // --------------------------------------------------------------- tick
  step() {
    this.time += DT;
    if (this.phase === PHASE.ENDED) return;

    if (this.phase === PHASE.COUNTDOWN) {
      this.phaseT -= DT;
      if (this.phaseT <= 0) {
        this.phase = PHASE.PLAY;
        for (const p of this.players) p.locked = false;
        this.emit('go');
      }
    } else {
      this.timeLeft -= DT;
      if (!this.broteDone && this.phase === PHASE.PLAY && this.timeLeft <= RULES.broteAt && this.settings.duration > 90) {
        this.broteDone = true;
        this.serumEvery = RULES.serumEvery / 2;
        this.serumT = Math.min(this.serumT, 2);
        for (const p of this.players) p.ult = Math.min(1, p.ult + ULT.brote);
        this.emit('brote');
      }
      if (this.timeLeft <= 0) this.timeUp();
      if (this.phase === PHASE.ENDED) return;
    }

    // Inputs + acciones
    for (const p of this.players) {
      if (p.bot) {
        const brain = this.bots.get(p.id);
        const inp = brain ? brain.think() : { mx: 0, my: 0, b: 0 };
        this.applyInput(p, inp);
      } else {
        let n = 0;
        while (p.inputs.length && n < 3) {
          this.applyInput(p, p.inputs.shift());
          n++;
        }
        if (n === 0) this.applyInput(p, { mx: 0, my: 0, b: 0, s: p.ack, idle: true });
      }
    }

    this.updatePlayers();
    this.updateProjectiles();
    this.updateClouds();
    this.updatePeels();
    this.resolveContacts();
    this.updateFlags();
    this.updateJail();
    this.updateSerums();
  }

  applyInput(p, inp) {
    if (inp.s !== undefined && !inp.idle) p.ack = inp.s;
    if (p.state !== 0) return;
    if (inp.idle) {
      // Sin input este tick: los movimientos especiales siguen su curso
      if (p.leapT > 0 || p.dashT > 0) moveByInput(p, inp, DT);
      return;
    }
    moveByInput(p, inp, DT);
    if (this.phase !== PHASE.PLAY && this.phase !== PHASE.OVERTIME) return;
    const b = inp.b | 0;
    if (b & 1) this.tryAttack(p, inp);
    if (b & 2) this.tryAbility(p, inp);
    if (b & 4) this.tryUlt(p);
  }

  aimOf(p, inp) {
    let ax = inp.ax, ay = inp.ay;
    let l = len(ax || 0, ay || 0);
    if (!l) { ax = Math.cos(p.face); ay = Math.sin(p.face); l = 1; }
    return [ax / l, ay / l];
  }

  tryAttack(p, inp) {
    if (!canAct(p) || p.atkCd > 0) return;
    const [ax, ay] = this.aimOf(p, inp);
    p.face = Math.atan2(ay, ax);
    p.aimT = 0.35;
    if (p.mutantT > 0) {
      p.dashT = MUTATION.lungeTime;
      p.dashDx = ax; p.dashDy = ay;
      p.atkCd = MUTATION.lungeCooldown;
      this.emit('lunge', p.id);
      return;
    }
    const w = WEAPONS[p.team];
    const id = nextEntityId++;
    this.projectiles.push({
      id, team: p.team, owner: p.id, kind: p.team,
      x: p.x + ax * 0.55, y: p.y + ay * 0.55,
      vx: ax * w.speed, vy: ay * w.speed,
      life: w.range / w.speed, r: w.radius,
    });
    p.atkCd = w.cooldown;
    this.emit('shoot', p.id, id);
  }

  tryAbility(p, inp) {
    if (!canAct(p) || p.abiCd > 0 || p.mutantT > 0) return;
    const a = ABILITIES[p.team];
    if (p.team === PAPOIS) {
      // Pistola de pedos
      this.clouds.push({ id: nextEntityId++, team: p.team, owner: p.id, x: p.x, y: p.y, r: a.radius, life: a.life, max: a.life });
      for (const q of this.players) {
        if (q.team === p.team || q.state !== 0) continue;
        const dx = q.x - p.x, dy = q.y - p.y;
        const d = len(dx, dy);
        if (d < a.radius) this.push(q, dx / (d || 1), dy / (d || 1), a.knock * (1 - d / a.radius * 0.5));
      }
      p.boostT = a.boost;
      p.abiCd = a.cooldown;
      this.emit('fart', p.id, r2(p.x), r2(p.y));
    } else {
      // Salto de liana
      let dx = inp.mx || 0, dy = inp.my || 0;
      let l = len(dx, dy);
      if (l < 0.2) { dx = Math.cos(p.face); dy = Math.sin(p.face); l = 1; }
      p.leapDx = dx / l; p.leapDy = dy / l;
      p.face = Math.atan2(p.leapDy, p.leapDx);
      p.leapT = p.carrying >= 0 ? a.carryTime : a.time;
      p.abiCd = a.cooldown;
      // deja una cáscara de plátano
      const mine = this.peels.filter((x) => x.owner === p.id);
      if (mine.length >= a.peelMax) this.peels.splice(this.peels.indexOf(mine[0]), 1);
      this.peels.push({ id: nextEntityId++, team: p.team, owner: p.id, x: p.x, y: p.y, life: a.peelLife });
      this.emit('leap', p.id);
    }
  }

  tryUlt(p) {
    if (!canAct(p) || p.ult < 1 || p.carrying >= 0 || p.mutantT > 0) return;
    p.ult = 0;
    p.transformT = MUTATION.transform;
    p.pendingMutant = MUTATION.duration;
    this.emit('mutate', p.id);
    // onda expansiva
    for (const q of this.players) {
      if (q.team === p.team || q.state !== 0) continue;
      const dx = q.x - p.x, dy = q.y - p.y;
      const d = len(dx, dy);
      if (d < MUTATION.shockRadius) {
        this.push(q, dx / (d || 1), dy / (d || 1), MUTATION.shockKnock);
        this.applyCC(q, 'stun', 0.4, true);
      }
    }
    this.emit('shock', p.id, r2(p.x), r2(p.y));
  }

  // --------------------------------------------------------------- efectos
  immune(q) {
    return q.state !== 0 || q.mutantT > 0 || q.transformT > 0 || q.shieldT > 0 || q.leapT > 0;
  }

  push(q, nx, ny, force) {
    if (this.immune(q) || q.carrying >= 0) return;
    q.kx += nx * force;
    q.ky += ny * force;
  }

  applyCC(q, kind, dur, ignoreImm = false) {
    if (this.immune(q)) return false;
    if (q.ccImmT > 0 && !ignoreImm) return false;
    if (q.carrying >= 0) {
      // adrenalina: el portador no se congela, sólo se ralentiza
      q.slowT = Math.max(q.slowT, RULES.carrierSlow);
      q.ccImmT = RULES.carrierSlow + 0.4;
      return true;
    }
    if (kind === 'freeze') q.frozenT = Math.max(q.frozenT, dur);
    else q.stunT = Math.max(q.stunT, dur);
    q.dashT = 0;
    return true;
  }

  updatePlayers() {
    for (const p of this.players) {
      p.atkCd = Math.max(0, p.atkCd - DT);
      p.abiCd = Math.max(0, p.abiCd - DT);
      p.emoteCd = Math.max(0, p.emoteCd - DT);
      p.needFlagCd = Math.max(0, p.needFlagCd - DT);
      p.aimT = Math.max(0, p.aimT - DT);
      p.landT = Math.max(0, p.landT - DT);
      p.slowT = Math.max(0, p.slowT - DT);
      p.boostT = Math.max(0, p.boostT - DT);
      p.shieldT = Math.max(0, p.shieldT - DT);
      p.ccImmT = Math.max(0, p.ccImmT - DT);
      p.contagionCD = Math.max(0, p.contagionCD - DT);
      if (p.frozenT > 0) { p.frozenT -= DT; if (p.frozenT <= 0) { p.frozenT = 0; p.ccImmT = RULES.ccImmune; } }
      if (p.stunT > 0) { p.stunT -= DT; if (p.stunT <= 0) { p.stunT = 0; p.ccImmT = RULES.ccImmune; } }
      if (p.transformT > 0) {
        p.transformT -= DT;
        if (p.transformT <= 0) {
          p.transformT = 0;
          p.mutantT = p.pendingMutant || MUTATION.duration;
          p.frozenT = 0; p.stunT = 0; p.slowT = 0;
        }
      } else if (p.mutantT > 0) {
        p.mutantT -= DT;
        if (p.mutantT <= 0) {
          p.mutantT = 0;
          p.contagionCD = MUTATION.contagionCooldown;
          this.emit('unmutate', p.id);
          collideCircle(p, radiusOf(p));
        }
      }
      if (p.state !== 0) continue;
      p.zoneOn = this.flags[p.team].state === 0;
      if (p.zoneOn && p.carrying < 0) zoneCollide(p);

      // empuje (knockback)
      if (p.kx || p.ky) {
        p.x += p.kx * DT;
        p.y += p.ky * DT;
        const k = Math.exp(-7 * DT);
        p.kx *= k; p.ky *= k;
        if (Math.abs(p.kx) < 0.05 && Math.abs(p.ky) < 0.05) { p.kx = 0; p.ky = 0; }
        if (collideCircle(p, radiusOf(p))) { p.kx *= 0.5; p.ky *= 0.5; }
      }

      // carga de la mutación
      if (this.phase === PHASE.PLAY || this.phase === PHASE.OVERTIME) {
        if (p.mutantT <= 0 && p.transformT <= 0) {
          p.ult = Math.min(1, p.ult + ULT.passive * DT + (p.carrying >= 0 ? ULT.carry * DT : 0));
        }
      }

      // bono de grupo de los Papois
      if (p.team === PAPOIS) {
        let n = 0;
        for (const q of this.players) {
          if (q === p || q.team !== p.team || q.state !== 0) continue;
          if (Math.abs(q.x - p.x) < PLAYER.groupRange && Math.abs(q.y - p.y) < PLAYER.groupRange && len(q.x - p.x, q.y - p.y) < PLAYER.groupRange) n++;
        }
        p.group = Math.min(2, n) * PLAYER.groupBonus;
      }

      const dx = p.x - p.lastX, dy = p.y - p.lastY;
      p.moving = dx * dx + dy * dy > 0.0004;
      p.lastX = p.x; p.lastY = p.y;
      p.bush = bushAt(p.x, p.y);
      p.water = inWater(p.x, p.y);
    }
  }

  updateProjectiles() {
    const out = [];
    for (const pr of this.projectiles) {
      let alive = true;
      for (let s = 0; s < 2 && alive; s++) {
        pr.x += pr.vx * DT / 2;
        pr.y += pr.vy * DT / 2;
        if (solidAt(pr.x, pr.y, 0.05)) {
          this.emit('phit', r2(pr.x), r2(pr.y), pr.kind);
          alive = false;
          break;
        }
        for (const q of this.players) {
          if (q.team === pr.team || q.state !== 0 || q.leapT > 0) continue;
          const rr = radiusOf(q) + pr.r;
          const dx = q.x - pr.x, dy = q.y - pr.y;
          if (dx * dx + dy * dy < rr * rr) {
            alive = false;
            this.hitPlayer(pr, q);
            break;
          }
        }
      }
      pr.life -= DT;
      if (alive && pr.life <= 0) {
        this.emit('phit', r2(pr.x), r2(pr.y), pr.kind);
        alive = false;
      }
      if (alive) out.push(pr);
    }
    this.projectiles = out;
  }

  hitPlayer(pr, q) {
    const owner = this.byId.get(pr.owner);
    const w = WEAPONS[pr.kind];
    let ok;
    if (pr.kind === PAPOIS) {
      ok = this.applyCC(q, 'freeze', w.freeze);
      if (ok) this.emit('freeze', pr.owner, q.id);
    } else {
      const sp = len(pr.vx, pr.vy) || 1;
      this.push(q, pr.vx / sp, pr.vy / sp, w.knock);
      ok = this.applyCC(q, 'stun', w.stun);
      if (ok) this.emit('stun', pr.owner, q.id);
    }
    if (!ok) this.emit('immune', q.id, r2(pr.x), r2(pr.y), pr.kind);
    else if (owner) {
      owner.stats.hits++;
      owner.ult = Math.min(1, owner.ult + ULT.hit);
    }
  }

  updateClouds() {
    this.clouds = this.clouds.filter((c) => {
      c.life -= DT;
      for (const q of this.players) {
        if (q.team === c.team || q.state !== 0 || q.mutantT > 0) continue;
        const dx = q.x - c.x, dy = q.y - c.y;
        if (dx * dx + dy * dy < c.r * c.r) q.slowT = Math.max(q.slowT, 0.35);
      }
      return c.life > 0;
    });
  }

  updatePeels() {
    const a = ABILITIES[MACACOS];
    this.peels = this.peels.filter((pe) => {
      pe.life -= DT;
      if (pe.life <= 0) return false;
      for (const q of this.players) {
        if (q.team === pe.team || this.immune(q)) continue;
        const dx = q.x - pe.x, dy = q.y - pe.y;
        if (dx * dx + dy * dy < 0.75 * 0.75) {
          // resbalón
          let mx = q.x - q.lastX, my = q.y - q.lastY;
          let l = len(mx, my);
          if (l < 0.001) { mx = Math.cos(q.face); my = Math.sin(q.face); l = 1; }
          q.kx += (mx / l) * a.slipSpeed;
          q.ky += (my / l) * a.slipSpeed;
          this.applyCC(q, 'stun', a.slip, true);
          const owner = this.byId.get(pe.owner);
          if (owner) { owner.stats.hits++; owner.ult = Math.min(1, owner.ult + ULT.hit); }
          this.emit('slip', q.id, pe.owner, r2(pe.x), r2(pe.y));
          return false;
        }
      }
      return true;
    });
  }

  // --------------------------------------------------------------- contactos
  canTag(p) {
    return p.state === 0 && p.frozenT <= 0 && p.stunT <= 0 && p.transformT <= 0 && p.leapT <= 0 && p.landT <= 0;
  }

  taggable(q) {
    return q.state === 0 && q.shieldT <= 0 && (q.leapT <= 0 || q.carrying >= 0) && q.transformT <= 0 && q.mutantT <= 0;
  }

  resolveContacts() {
    if (this.phase !== PHASE.PLAY && this.phase !== PHASE.OVERTIME) return;
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i];
      if (a.state !== 0) continue;
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j];
        if (b.state !== 0) continue;
        const rr = radiusOf(a) + radiusOf(b);
        const dx = b.x - a.x, dy = b.y - a.y;
        if (dx * dx + dy * dy >= rr * rr) continue;
        if (a.team === b.team) {
          this.contagion(a, b);
          this.contagion(b, a);
          continue;
        }
        const am = a.mutantT > 0, bm = b.mutantT > 0;
        if (am && bm) {
          const d = len(dx, dy) || 1;
          a.kx -= dx / d * 9; a.ky -= dy / d * 9;
          b.kx += dx / d * 9; b.ky += dy / d * 9;
          continue;
        }
        if (am) { if (this.taggable(b)) this.mutantHit(a, b); continue; }
        if (bm) { if (this.taggable(a)) this.mutantHit(b, a); continue; }
        // reglas clásicas: sólo atrapas a quien invade TU territorio
        const aCan = this.canTag(a) && this.taggable(b) && territoryOf(b.x) === a.team;
        const bCan = this.canTag(b) && this.taggable(a) && territoryOf(a.x) === b.team;
        if (aCan) this.tag(a, b, false);
        if (bCan && a.state === 0) this.tag(b, a, false);
      }
    }
  }

  contagion(m, t) {
    if (m.mutantT <= 0 || t.mutantT > 0 || t.transformT > 0 || t.contagionCD > 0 || t.carrying >= 0) return;
    if (!canAct(t) && t.frozenT <= 0 && t.stunT <= 0) return;
    t.frozenT = 0; t.stunT = 0;
    t.transformT = 0.45;
    t.pendingMutant = Math.max(MUTATION.contagionMin, m.mutantT);
    m.stats.infects++;
    this.emit('infect', m.id, t.id);
  }

  // El mutante derriba a cualquiera; en su territorio (o al portador) lo manda a la cárcel.
  mutantHit(m, v) {
    if (territoryOf(v.x) === m.team || v.carrying >= 0) { this.tag(m, v, true); return; }
    const d = len(v.x - m.x, v.y - m.y) || 1;
    v.kx += (v.x - m.x) / d * 11;
    v.ky += (v.y - m.y) / d * 11;
    v.stunT = Math.max(v.stunT, MUTATION.knockdown);
    v.dashT = 0;
    v.shieldT = MUTATION.knockdown + 0.8;
    m.stats.hits++;
    this.emit('knock', m.id, v.id);
  }

  tag(tagger, victim, byMutant) {
    const wasCarrying = victim.carrying >= 0;
    if (wasCarrying) this.dropFlag(victim);
    tagger.stats.tags++;
    tagger.ult = Math.min(1, tagger.ult + ULT.tag);
    const enemyTerritory = territoryOf(victim.x) === tagger.team;
    if (byMutant || enemyTerritory) {
      this.jail(victim, tagger.team);
      this.emit('tag', tagger.id, victim.id, 1, wasCarrying ? 1 : 0);
    } else {
      // portador atrapado en su propio territorio: suelta la bandera y queda aturdido
      const d = len(victim.x - tagger.x, victim.y - tagger.y) || 1;
      victim.kx += (victim.x - tagger.x) / d * 8;
      victim.ky += (victim.y - tagger.y) / d * 8;
      victim.stunT = Math.max(victim.stunT, RULES.carrierTagStun);
      victim.shieldT = 0.8;
      this.emit('tag', tagger.id, victim.id, 0, wasCarrying ? 1 : 0);
    }
  }

  jail(p, captorTeam) {
    if (p.carrying >= 0) this.dropFlag(p);
    p.state = 1;
    p.jailT = RULES.jailTime;
    p.jailTeam = captorTeam;
    const others = this.players.filter((q) => q.state === 1 && q !== p && q.jailTeam === captorTeam).length;
    p.jailSlot = others;
    this.positionInJail(p);
    p.kx = p.ky = 0;
    p.frozenT = p.stunT = p.slowT = p.leapT = p.dashT = p.boostT = 0;
    p.mutantT = 0; p.transformT = 0;
    p.stats.jailed++;
  }

  positionInJail(p) {
    const j = BASES[p.jailTeam].jail;
    const a = p.jailSlot * 1.3 + 0.4;
    const r = p.jailSlot === 0 ? 0.3 : 1.15;
    p.x = j.x + Math.cos(a) * r;
    p.y = j.y + Math.sin(a) * r;
  }

  release(p, x, y, shield) {
    p.state = 0;
    p.jailT = 0;
    p.x = x; p.y = y;
    p.lastX = x; p.lastY = y;
    p.shieldT = shield;
    p.inputs.length = 0;
    collideCircle(p, radiusOf(p));
  }

  updateJail() {
    // liberación automática
    for (const p of this.players) {
      if (p.state !== 1) continue;
      p.jailT -= DT;
      if (p.jailT <= 0) {
        const sp = BASES[p.team].spawns;
        const s = sp[this.spawnCount[p.team]++ % sp.length];
        this.release(p, s.x, s.y, RULES.respawnShield);
        this.emit('release', p.id);
      }
    }
    if (this.phase !== PHASE.PLAY && this.phase !== PHASE.OVERTIME) return;
    // rescate: un aliado toca la jaula enemiga
    for (const t of [0, 1]) {
      const captor = 1 - t;
      const prisoners = this.players.filter((q) => q.state === 1 && q.team === t && q.jailTeam === captor);
      if (!prisoners.length) continue;
      const j = BASES[captor].jail;
      for (const r of this.players) {
        if (r.team !== t || !this.canTag(r)) continue;
        const d = len(r.x - j.x, r.y - j.y);
        if (d < RULES.jailRadius + radiusOf(r) + 0.15) {
          prisoners.forEach((q, i) => {
            const a = Math.atan2(r.y - j.y, r.x - j.x) + (i - (prisoners.length - 1) / 2) * 0.6;
            const rad = RULES.jailRadius + 0.9;
            this.release(q, j.x + Math.cos(a) * rad, j.y + Math.sin(a) * rad, RULES.rescueShield);
          });
          r.stats.rescues += prisoners.length;
          r.ult = Math.min(1, r.ult + ULT.rescue + ULT.rescueEach * prisoners.length);
          this.emit('rescue', r.id, prisoners.length);
          break;
        }
      }
    }
  }

  // --------------------------------------------------------------- banderas
  dropFlag(p) {
    const f = this.flags[p.carrying];
    p.carrying = -1;
    if (!f) return;
    f.state = 2;
    f.carrier = -1;
    f.dropT = RULES.dropReturn;
    // no dejarla dentro de un obstáculo
    const pos = { x: p.x, y: p.y };
    collideCircle(pos, 0.4);
    f.x = pos.x; f.y = pos.y;
    this.emit('drop', f.team, r2(f.x), r2(f.y), p.id);
  }

  returnFlag(f, byId) {
    f.state = 0;
    f.carrier = -1;
    f.x = BASES[f.team].flag.x;
    f.y = BASES[f.team].flag.y;
    this.emit('freturn', f.team, byId);
  }

  updateFlags() {
    const playing = this.phase === PHASE.PLAY || this.phase === PHASE.OVERTIME;
    for (const f of this.flags) {
      if (f.state === 1) {
        const c = this.byId.get(f.carrier);
        if (!c || c.state !== 0 || c.carrying !== f.team) {
          if (c && c.carrying === f.team) this.dropFlag(c);
          else { f.state = 2; f.carrier = -1; f.dropT = RULES.dropReturn; }
          continue;
        }
        f.x = c.x; f.y = c.y;
        // ¿captura?
        const home = BASES[c.team].flag;
        if (len(c.x - home.x, c.y - home.y) < RULES.baseRadius) {
          const ownFlag = this.flags[c.team];
          if (this.settings.classic && ownFlag.state !== 0) {
            if (c.needFlagCd <= 0) { this.emit('needflag', c.id); c.needFlagCd = 3; }
          } else {
            this.capture(c, f);
          }
        }
        continue;
      }
      if (f.state === 2) {
        f.dropT -= DT;
        if (f.dropT <= 0) { this.returnFlag(f, -1); continue; }
      }
      if (!playing) continue;
      for (const p of this.players) {
        if (!this.canTag(p) && p.leapT <= 0) continue;
        if (p.state !== 0 || p.transformT > 0) continue;
        const d = len(p.x - f.x, p.y - f.y);
        if (d > RULES.flagGrab + 0.1) continue;
        if (p.team === f.team) {
          if (f.state === 2) {
            p.stats.returns++;
            p.ult = Math.min(1, p.ult + ULT.ret);
            this.returnFlag(f, p.id);
            break;
          }
        } else if (p.mutantT <= 0 && p.carrying < 0) {
          const fromHome = f.state === 0;
          f.state = 1;
          f.carrier = p.id;
          p.carrying = f.team;
          p.shieldT = fromHome ? RULES.stealShield : 0;
          p.boostT = Math.max(p.boostT, PLAYER.stealBoost);
          if (fromHome) p.stats.steals++;
          this.emit(fromHome ? 'steal' : 'pickup', p.id, f.team);
          break;
        }
      }
    }
  }

  capture(c, f) {
    c.carrying = -1;
    c.stats.caps++;
    c.ult = Math.min(1, c.ult + ULT.capture);
    this.score[c.team]++;
    f.state = 0;
    f.carrier = -1;
    f.x = BASES[f.team].flag.x;
    f.y = BASES[f.team].flag.y;
    this.emit('cap', c.id, c.team, this.score[0], this.score[1]);
    if (this.phase === PHASE.OVERTIME || this.score[c.team] >= this.settings.capsToWin) {
      this.finish(c.team);
    }
  }

  timeUp() {
    if (this.score[0] !== this.score[1]) {
      this.finish(this.score[0] > this.score[1] ? 0 : 1);
    } else if (this.phase === PHASE.PLAY) {
      this.phase = PHASE.OVERTIME;
      this.timeLeft = RULES.overtime;
      this.emit('overtime');
    } else {
      this.finish(-1);
    }
  }

  finish(winner) {
    this.phase = PHASE.ENDED;
    this.winner = winner;
    this.timeLeft = Math.max(0, this.timeLeft);
    this.emit('end', winner);
  }

  // --------------------------------------------------------------- suero
  updateSerums() {
    if (this.phase !== PHASE.PLAY && this.phase !== PHASE.OVERTIME) return;
    this.serumT -= DT;
    if (this.serumT <= 0) {
      this.serumT = this.serumEvery;
      if (this.serums.length < RULES.serumMax) {
        const free = SERUM_SPOTS.filter((s) => !this.serums.some((x) => x.x === s.x && x.y === s.y));
        const s = free[(Math.random() * free.length) | 0];
        if (s) {
          const id = nextEntityId++;
          this.serums.push({ id, x: s.x, y: s.y });
          this.emit('serumSpawn', id, s.x, s.y);
        }
      }
    }
    this.serums = this.serums.filter((s) => {
      for (const p of this.players) {
        if (p.state !== 0 || p.mutantT > 0 || p.transformT > 0) continue;
        const d = len(p.x - s.x, p.y - s.y);
        if (d < RULES.serumRadius + radiusOf(p)) {
          p.ult = Math.min(1, p.ult + ULT.serum);
          p.stats.serums++;
          this.emit('serum', p.id, s.id);
          return false;
        }
      }
      return true;
    });
  }

  emote(id, idx) {
    const p = this.byId.get(id);
    if (!p || p.emoteCd > 0) return;
    p.emoteCd = 1.2;
    this.emit('emote', id, idx | 0);
  }

  // --------------------------------------------------------------- snapshot
  flagsOf(p) {
    let f = 0;
    if (p.state === 1) f |= F.JAILED;
    if (p.frozenT > 0) f |= F.FROZEN;
    if (p.stunT > 0) f |= F.STUNNED;
    if (p.slowT > 0) f |= F.SLOWED;
    if (p.shieldT > 0) f |= F.SHIELD;
    if (p.leapT > 0) f |= F.AIR;
    if (p.mutantT > 0) f |= F.MUTANT;
    if (p.transformT > 0) f |= F.TRANSFORM;
    if (p.carrying >= 0) f |= F.CARRY;
    if (p.dashT > 0) f |= F.DASH;
    if (p.boostT > 0) f |= F.BOOST;
    if (p.bush >= 0) f |= F.BUSH;
    if (p.water) f |= F.WATER;
    if (p.moving) f |= F.MOVING;
    return f;
  }

  snapshot() {
    return {
      t: 's',
      tm: r3(this.time),
      ph: this.phase,
      tl: r2(Math.max(0, this.timeLeft)),
      cd: r2(Math.max(0, this.phaseT)),
      sc: this.score,
      p: this.players.map((p) => [
        p.id, r2(p.x), r2(p.y), r2(p.face), this.flagsOf(p), Math.round(p.ult * 100),
        r2(p.mutantT), r2(p.jailT),
      ]),
      pr: this.projectiles.map((q) => [q.id, q.kind, r2(q.x), r2(q.y), r2(q.vx), r2(q.vy), q.owner]),
      cl: this.clouds.map((c) => [c.id, r2(c.x), r2(c.y), r2(c.r), r2(c.life / c.max)]),
      pe: this.peels.map((q) => [q.id, r2(q.x), r2(q.y)]),
      fl: this.flags.map((f) => [f.state, r2(f.x), r2(f.y), f.carrier, r2(f.dropT)]),
      su: this.serums.map((s) => [s.id, s.x, s.y]),
    };
  }

  // Estado propio detallado (para predicción y HUD)
  selfState(id) {
    const p = this.byId.get(id);
    if (!p) return null;
    return {
      id,
      ack: p.ack,
      x: r3(p.x), y: r3(p.y),
      a: r2(p.atkCd), b: r2(p.abiCd), u: r3(p.ult),
      fz: r2(p.frozenT), st: r2(p.stunT), sl: r2(p.slowT), bo: r2(p.boostT),
      lp: r3(p.leapT), ldx: r3(p.leapDx), ldy: r3(p.leapDy),
      ds: r3(p.dashT), ddx: r3(p.dashDx), ddy: r3(p.dashDy),
      tr: r2(p.transformT), mu: r2(p.mutantT), g: r2(p.group),
      sh: r2(p.shieldT), cr: p.carrying, zo: p.zoneOn ? 1 : 0, s: p.state, j: r2(p.jailT), lk: p.locked ? 1 : 0,
    };
  }

  results() {
    return {
      winner: this.winner,
      score: this.score,
      players: this.players.map((p) => ({
        id: p.id, name: p.name, team: p.team, bot: p.bot, level: p.level, skin: p.skin,
        stats: p.stats,
        mvp: mvpScore(p.stats),
      })),
    };
  }
}

export function mvpScore(s) {
  return s.caps * 100 + s.tags * 25 + s.rescues * 30 + s.returns * 20 + s.hits * 5 + s.steals * 15 + s.infects * 10;
}

function r2(v) { return Math.round(v * 100) / 100; }
function r3(v) { return Math.round(v * 1000) / 1000; }

export { W, H, MID };
