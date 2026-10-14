// IA de los bots: roles, rescates, intercepción, escolta, habilidades y mutación.
import { DT, PAPOIS, WEAPONS } from './constants.js';
import { BASES, MID, territoryOf, lineOfSight, inWater, W, H } from './map.js';
import { findPath } from './nav.js';
import { canAct } from './sim.js';

const DIFF = [
  { react: 0.55, aimErr: 0.34, lead: 0.2, abil: 0.35, ult: 0.5, think: 0.42, speedNoise: 0.25 },
  { react: 0.32, aimErr: 0.16, lead: 0.7, abil: 0.7, ult: 0.85, think: 0.28, speedNoise: 0.1 },
  { react: 0.17, aimErr: 0.06, lead: 1, abil: 1, ult: 1, think: 0.18, speedNoise: 0 },
];

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function updateTeamRoles(sim) {
  sim._roleT = (sim._roleT || 0) - DT;
  if (sim._roleT > 0) return;
  sim._roleT = 3;
  for (const team of [0, 1]) {
    const members = sim.players.filter((p) => p.team === team);
    const bots = members.filter((p) => p.bot).sort((a, b) => a.id - b.id);
    const n = members.length;
    const defenders = n >= 4 ? 1 : 0;
    bots.forEach((p, i) => {
      const brain = sim.bots.get(p.id);
      if (brain) brain.role = i < defenders ? 'def' : 'att';
    });
  }
}

export class BotBrain {
  constructor(sim, id, difficulty = 1) {
    this.sim = sim;
    this.id = id;
    this.d = DIFF[Math.max(0, Math.min(2, difficulty))];
    this.role = 'att';
    this.mode = 'idle';
    this.goal = null;
    this.goalEnt = null;
    this.path = [];
    this.pathT = 0;
    this.thinkT = Math.random() * 0.4;
    this.fireT = 0.5 + Math.random();
    this.stuckT = 0;
    this.nudgeT = 0;
    this.nudge = [0, 0];
    this.anchor = { x: 0, y: 0 };
    this.lastMx = 0;
    this.lastMy = 0;
    this.wobble = Math.random() * 10;
    this.avoid = false;
    this.threats = [];
    this.pendingAbility = false;
    this.leapDir = null;
  }

  me() { return this.sim.byId.get(this.id); }

  think() {
    const p = this.me();
    const out = { mx: 0, my: 0, ax: 0, ay: 0, b: 0 };
    if (!p || p.state !== 0 || p.locked) return out;
    this.thinkT -= DT;
    this.pathT -= DT;
    this.fireT -= DT;
    this.wobble += DT;
    if (this.thinkT <= 0) {
      this.decide(p);
      this.thinkT = this.d.think * (0.7 + Math.random() * 0.6);
    }
    const [mx, my] = this.steer(p);
    out.mx = mx; out.my = my;
    this.combat(p, out);
    return out;
  }

  // ------------------------------------------------------------ decisiones
  decide(p) {
    const sim = this.sim;
    const team = p.team, enemy = 1 - team;
    const ownFlag = sim.flags[team], enemyFlag = sim.flags[enemy];
    const myBase = BASES[team], enemyBase = BASES[enemy];
    const mates = sim.players.filter((q) => q.team === team && q !== p && q.state === 0);
    const enemies = sim.players.filter((q) => q.team === enemy && q.state === 0);
    const inEnemy = territoryOf(p.x) !== team;

    this.threats = enemies.filter((e) => canAct(e) && e.shieldT <= 0 &&
      (e.mutantT > 0 || territoryOf(e.x) === enemy || p.carrying >= 0));

    let goal = null, ent = null, mode = 'idle', avoid = false;

    const rankTo = (target, pool) => {
      const d0 = dist(p, target);
      return pool.filter((q) => dist(q, target) < d0).length;
    };

    if (p.mutantT > 0) {
      const infectable = mates.filter((m) => m.mutantT <= 0 && m.transformT <= 0 && m.contagionCD <= 0 && m.carrying < 0 && dist(m, p) < 7);
      if (p.mutantT > 4.5 && infectable.length) {
        ent = infectable.sort((a, b) => dist(a, p) - dist(b, p))[0];
        mode = 'infect';
      } else {
        const prey = enemies.filter((e) => e.mutantT <= 0 && e.shieldT <= 0 && dist(e, p) < 18)
          .sort((a, b) => (b.carrying >= 0) - (a.carrying >= 0) || dist(a, p) - dist(b, p));
        if (prey.length) { ent = prey[0]; mode = 'hunt'; }
        else { goal = enemyBase.flag; mode = 'hunt'; }
      }
    } else if (p.carrying >= 0) {
      goal = myBase.flag; mode = 'carry'; avoid = true;
    } else if (ownFlag.state === 1 && sim.byId.get(ownFlag.carrier) &&
      (this.role === 'def' || rankTo(sim.byId.get(ownFlag.carrier), mates) <= 1)) {
      ent = sim.byId.get(ownFlag.carrier); mode = 'intercept';
    } else if (ownFlag.state === 2 && rankTo(ownFlag, mates) === 0) {
      goal = { x: ownFlag.x, y: ownFlag.y }; mode = 'return';
    } else if (enemyFlag.state === 2 && rankTo(enemyFlag, mates) === 0) {
      goal = { x: enemyFlag.x, y: enemyFlag.y }; mode = 'grab'; avoid = true;
    } else {
      const prisoners = sim.players.filter((q) => q.team === team && q.state === 1);
      const rescuers = mates.filter((m) => m.bot && m.carrying < 0 && m.mutantT <= 0);
      const imRescuer = prisoners.length && (this.role === 'att' || mates.length < 2) &&
        rankTo(enemyBase.jail, rescuers.filter((m) => sim.bots.get(m.id)?.role === 'att')) === 0;
      const carrierMate = enemyFlag.state === 1 ? sim.byId.get(enemyFlag.carrier) : null;
      const serum = sim.serums.filter((s) => dist(s, p) < 8).sort((a, b) => dist(a, p) - dist(b, p))[0];
      if (imRescuer) {
        goal = enemyBase.jail; mode = 'rescue'; avoid = true;
      } else if (serum && p.ult < 0.95) {
        goal = serum; mode = 'serum';
      } else if (carrierMate && carrierMate !== p && this.role === 'att' && dist(carrierMate, p) < 22) {
        // escoltar: ir al lado del portador, entre él y los perseguidores
        const chasers = enemies.filter((e) => dist(e, carrierMate) < 9);
        if (chasers.length) {
          const c = chasers.sort((a, b) => dist(a, carrierMate) - dist(b, carrierMate))[0];
          goal = { x: (c.x + carrierMate.x) / 2, y: (c.y + carrierMate.y) / 2 };
        } else {
          goal = { x: carrierMate.x + (team === PAPOIS ? 2 : -2), y: carrierMate.y + Math.sin(this.wobble) * 2 };
        }
        mode = 'escort';
      } else if (this.role === 'def') {
        const intruders = enemies.filter((e) => territoryOf(e.x) === team && e.shieldT <= 0 && e.mutantT <= 0 && dist(e, myBase.flag) < 20)
          .sort((a, b) => dist(a, myBase.flag) - dist(b, myBase.flag));
        if (intruders.length) { ent = intruders[0]; mode = 'chase'; }
        else {
          const dir = team === PAPOIS ? 1 : -1;
          goal = {
            x: myBase.flag.x + dir * (5 + Math.sin(this.wobble * 0.4) * 2),
            y: myBase.flag.y + Math.sin(this.wobble * 0.27) * 5,
          };
          mode = 'patrol';
        }
      } else {
        // atacante: si hay intrusos cerca en mi lado, atraparlos; si no, ir por la bandera
        const near = enemies.filter((e) => territoryOf(e.x) === team && e.shieldT <= 0 && e.mutantT <= 0 && dist(e, p) < 5);
        if (near.length && !inEnemy) { ent = near[0]; mode = 'chase'; }
        else if (enemyFlag.state === 0) {
          // aproximación por carriles distintos según id
          const lane = [6, 18, 30][this.id % 3];
          const nearSide = Math.abs(p.x - enemyBase.flag.x) < 16;
          goal = nearSide ? { x: enemyBase.flag.x, y: enemyBase.flag.y } : { x: MID + (team === PAPOIS ? 6 : -6), y: lane };
          mode = 'attack'; avoid = true;
        } else {
          goal = { x: MID + (team === PAPOIS ? -4 : 4), y: 18 + Math.sin(this.wobble * 0.3) * 10 };
          mode = 'patrol';
        }
      }
    }

    const prevGoal = this.goal;
    this.mode = mode;
    this.avoid = avoid && p.mutantT <= 0;
    this.goalEnt = ent;
    this.goal = ent ? { x: ent.x, y: ent.y } : goal;
    if (!prevGoal || !this.goal || dist(prevGoal, this.goal) > 1.5 || this.pathT <= 0) this.repath(p);
  }

  repath(p) {
    if (!this.goal) { this.path = []; return; }
    let target = this.goal;
    // anticipar al objetivo móvil
    if (this.goalEnt) {
      const e = this.goalEnt;
      const vx = (e.x - e.lastX) / DT, vy = (e.y - e.lastY) / DT;
      const t = Math.min(1, dist(p, e) / 8);
      target = { x: clamp(e.x + vx * t * 0.6, 0.8, W - 0.8), y: clamp(e.y + vy * t * 0.6, 0.8, H - 0.8) };
    }
    const team = p.team;
    const threats = this.avoid ? this.threats : [];
    const danger = threats.length ? (x, y) => {
      let c = 0;
      for (const e of threats) {
        if (e.mutantT <= 0 && territoryOf(x) !== e.team && p.carrying < 0) continue;
        const d = Math.hypot(x - e.x, y - e.y);
        if (d < 4.5) c += (1 - d / 4.5) * 7;
      }
      return c;
    } : null;
    this.path = findPath(p.x, p.y, target.x, target.y, team, danger);
    this.pathT = this.goalEnt ? 0.35 : 0.9;
  }

  // ------------------------------------------------------------ movimiento
  steer(p) {
    let dx = 0, dy = 0;
    if (this.nudgeT > 0) {
      this.nudgeT -= DT;
      return this.nudge;
    }
    if (this.goalEnt && this.goalEnt.state === 0 && lineOfSight(p.x, p.y, this.goalEnt.x, this.goalEnt.y, 0.45)) {
      const e = this.goalEnt;
      const vx = (e.x - e.lastX) / DT, vy = (e.y - e.lastY) / DT;
      const t = Math.min(0.6, dist(p, e) / 10) * this.d.lead;
      dx = e.x + vx * t - p.x; dy = e.y + vy * t - p.y;
    } else {
      while (this.path.length && Math.hypot(this.path[0].x - p.x, this.path[0].y - p.y) < 0.55) this.path.shift();
      if (this.path.length) {
        dx = this.path[0].x - p.x; dy = this.path[0].y - p.y;
      } else if (this.goal) {
        dx = this.goal.x - p.x; dy = this.goal.y - p.y;
        if (Math.hypot(dx, dy) < 0.4) { dx = 0; dy = 0; }
      }
    }
    let l = Math.hypot(dx, dy);
    if (l > 0) { dx /= l; dy /= l; }
    // evasión local de amenazas
    if (this.avoid && this.threats.length) {
      let rx = 0, ry = 0;
      for (const e of this.threats) {
        if (e.mutantT <= 0 && territoryOf(p.x) !== e.team && p.carrying < 0) continue;
        const ex = p.x - e.x, ey = p.y - e.y;
        const d = Math.hypot(ex, ey);
        const range = e.mutantT > 0 ? 6 : 3.6;
        if (d < range && d > 0.01) {
          const w = (1 - d / range) * 1.6;
          rx += ex / d * w; ry += ey / d * w;
        }
      }
      // no huir hacia atrás del objetivo: componente lateral
      dx += rx; dy += ry;
      l = Math.hypot(dx, dy);
      if (l > 0) { dx /= l; dy /= l; }
    }
    // patrulla: no quedarse quieto
    if (this.mode === 'patrol' && l === 0) {
      dx = Math.cos(this.wobble); dy = Math.sin(this.wobble * 1.3);
      dx *= 0.4; dy *= 0.4;
    }
    // atasco
    const moved = Math.hypot(p.x - p.lastX, p.y - p.lastY);
    if ((dx || dy) && moved < 0.02 && canAct(p)) {
      this.stuckT += DT;
      if (this.stuckT > 0.6) {
        this.stuckT = 0;
        const a = Math.random() * Math.PI * 2;
        this.nudge = [Math.cos(a), Math.sin(a)];
        this.nudgeT = 0.35;
        this.pathT = 0;
      }
    } else this.stuckT = 0;
    // suavizado
    const s = 0.55;
    this.lastMx = this.lastMx * s + dx * (1 - s);
    this.lastMy = this.lastMy * s + dy * (1 - s);
    const ll = Math.hypot(this.lastMx, this.lastMy);
    if (ll < 0.05) return [0, 0];
    let speed = 1 - this.d.speedNoise * (0.5 + 0.5 * Math.sin(this.wobble * 0.7));
    if (this.mode === 'patrol') speed *= 0.6;
    return [this.lastMx / ll * speed, this.lastMy / ll * speed];
  }

  // ------------------------------------------------------------ combate
  combat(p, out) {
    if (!canAct(p)) return;
    const sim = this.sim;
    const team = p.team;
    const inEnemy = territoryOf(p.x) !== team;
    const enemies = sim.players.filter((q) => q.team !== team && q.state === 0);

    // Mutación
    if (p.ult >= 1 && p.carrying < 0 && p.mutantT <= 0 && Math.random() < this.d.ult * 0.08) {
      const near = enemies.filter((e) => dist(e, p) < 7 && e.mutantT <= 0).length;
      const ownFlag = sim.flags[team];
      const chasingCarrier = ownFlag.state === 1 && sim.byId.get(ownFlag.carrier) && dist(sim.byId.get(ownFlag.carrier), p) < 11;
      if (near >= 2 || chasingCarrier || (near >= 1 && inEnemy) || sim.timeLeft < 20) {
        out.b |= 4;
        return;
      }
    }

    // Mutante: embestida
    if (p.mutantT > 0) {
      const prey = enemies.filter((e) => e.mutantT <= 0 && e.shieldT <= 0 && e.leapT <= 0)
        .sort((a, b) => dist(a, p) - dist(b, p))[0];
      if (prey && p.atkCd <= 0 && dist(prey, p) < 3.8 && dist(prey, p) > 1 && this.fireT <= 0) {
        out.ax = prey.x - p.x; out.ay = prey.y - p.y;
        out.b |= 1;
        this.fireT = this.d.react;
      }
      return;
    }

    // Habilidad
    if (p.abiCd <= 0 && Math.random() < this.d.abil * 0.25) {
      const threat = this.threats.filter((e) => e.mutantT <= 0 && dist(e, p) < 3.2)
        .sort((a, b) => dist(a, p) - dist(b, p))[0];
      const fleeing = (inEnemy || p.carrying >= 0) && threat;
      if (team === PAPOIS) {
        const mutantNear = enemies.some((e) => e.mutantT > 0 && dist(e, p) < 3);
        if (fleeing || mutantNear) out.b |= 2;
      } else {
        let leap = null;
        if (fleeing) {
          // saltar lejos de la amenaza, hacia el objetivo
          let ax = p.x - threat.x, ay = p.y - threat.y;
          const l = Math.hypot(ax, ay) || 1;
          ax /= l; ay /= l;
          const gx = out.mx, gy = out.my;
          leap = [ax * 0.6 + gx * 0.8, ay * 0.6 + gy * 0.8];
        } else if (this.mode === 'intercept' && this.goalEnt && dist(this.goalEnt, p) < 6 && dist(this.goalEnt, p) > 2) {
          leap = [this.goalEnt.x - p.x, this.goalEnt.y - p.y];
        } else if ((out.mx || out.my) && inWater(p.x + out.mx * 1.5, p.y + out.my * 1.5)) {
          leap = [out.mx, out.my];
        } else if ((this.mode === 'attack' || this.mode === 'carry' || this.mode === 'rescue') && Math.random() < 0.05) {
          leap = [out.mx, out.my];
        }
        if (leap && (leap[0] || leap[1])) {
          out.mx = leap[0]; out.my = leap[1];
          out.b |= 2;
        }
      }
    }

    // Disparo
    if (this.fireT > 0 || p.atkCd > 0) return;
    const w = WEAPONS[team];
    const ownFlag = sim.flags[team];
    let best = null, bestScore = -1;
    for (const e of enemies) {
      if (e.mutantT > 0 || e.shieldT > 0 || e.leapT > 0 || e.frozenT > 0.3 || e.stunT > 0.3 || e.transformT > 0) continue;
      const d = dist(e, p);
      if (d > w.range * 0.92) continue;
      if (e.bush >= 0 && d > 2.5) continue;
      let score = 10 - d;
      if (ownFlag.carrier === e.id) score += 30;
      if (territoryOf(e.x) === team) score += 8; // intruso
      if ((inEnemy || p.carrying >= 0) && d < 6) score += 10; // amenaza
      if (score > bestScore && lineOfSight(p.x, p.y, e.x, e.y, 0.15)) { best = e; bestScore = score; }
    }
    if (best) {
      const d = dist(best, p);
      const t = d / w.speed * this.d.lead;
      const vx = (best.x - best.lastX) / DT, vy = (best.y - best.lastY) / DT;
      let ax = best.x + vx * t - p.x, ay = best.y + vy * t - p.y;
      const err = (Math.random() - 0.5) * 2 * this.d.aimErr;
      const c = Math.cos(err), s = Math.sin(err);
      out.ax = ax * c - ay * s; out.ay = ax * s + ay * c;
      out.b |= 1;
      this.fireT = this.d.react * (0.6 + Math.random() * 0.8) + 0.15;
    }
  }
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
