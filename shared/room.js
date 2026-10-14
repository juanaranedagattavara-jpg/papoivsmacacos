// Sala: lobby + partida. Independiente del transporte (WebSocket o local en el navegador).
import { DEFAULT_SETTINGS, LIMITS, SNAPSHOT_EVERY, PAPOI_NAMES, MACACO_NAMES, PAPOIS, MACACOS } from './constants.js';
import { Sim, PHASE } from './sim.js';
import { BotBrain, updateTeamRoles } from './bots.js';

const HATS = ['none', 'gorra', 'casco', 'fiesta', 'corona', 'vikingo', 'pirata', 'flor'];

// Texto seguro para mostrar y compartir: sin caracteres de control, invisibles ni sustitutos
// sueltos (sí conserva emojis compuestos), cortado por caracteres y no por unidades UTF-16.
export function cleanText(s, max = 64) {
  const out = [];
  for (const ch of String(s ?? '').normalize('NFC')) {
    if (/[\p{Cc}\p{Co}\p{Cs}<>]/u.test(ch)) continue;
    if (/\p{Cf}/u.test(ch) && ch !== '\u200d') continue;
    out.push(ch);
    if (out.length >= max) break;
  }
  return out.join('').trim();
}

export function sanitizeName(n) {
  return cleanText(n, LIMITS.nameLen) || 'Jugador';
}

export function sanitizeSkin(s) {
  s = s && typeof s === 'object' ? s : {};
  return {
    hat: HATS.includes(s.hat) ? s.hat : 'none',
    eyes: s.eyes === 1 ? 1 : 2,
    fur: Math.max(0, Math.min(3, s.fur | 0)),
  };
}

export function sanitizeSettings(s, prev = DEFAULT_SETTINGS) {
  const out = { ...prev };
  if (!s || typeof s !== 'object') return out;
  if (s.teamSize !== undefined) out.teamSize = Math.max(1, Math.min(LIMITS.maxTeam, s.teamSize | 0));
  if (s.duration !== undefined) out.duration = [120, 180, 300, 420, 600].includes(s.duration | 0) ? s.duration | 0 : prev.duration;
  if (s.capsToWin !== undefined) out.capsToWin = Math.max(1, Math.min(9, s.capsToWin | 0));
  if (s.difficulty !== undefined) out.difficulty = Math.max(0, Math.min(2, s.difficulty | 0));
  if (s.bots !== undefined) out.bots = !!s.bots;
  if (s.classic !== undefined) out.classic = !!s.classic;
  return out;
}

let nextPid = 1;

export class Room {
  constructor(code, opts = {}) {
    this.code = code;
    this.isPublic = !!opts.isPublic;
    this.send = opts.send; // (clientId, msg)
    this.clients = new Map();
    this.order = [];
    this.hostId = null;
    this.settings = sanitizeSettings(opts.settings || {}, DEFAULT_SETTINGS);
    this.phase = 'lobby';
    this.sim = null;
    this.tickCount = 0;
    this.created = Date.now();
    this.lastActive = Date.now();
    this.botSeq = 1000;
    this.snapshotEvery = opts.snapshotEvery || SNAPSHOT_EVERY;
  }

  get size() { return this.clients.size; }

  humansOn(team) {
    let n = 0;
    for (const c of this.clients.values()) if (c.team === team) n++;
    return n;
  }

  join(clientId, info = {}) {
    if (this.clients.size >= LIMITS.maxPlayers) return { error: 'La sala está llena (máx. 10)' };
    const team = info.team === 0 || info.team === 1
      ? info.team
      : (this.humansOn(PAPOIS) <= this.humansOn(MACACOS) ? PAPOIS : MACACOS);
    const c = {
      id: clientId,
      pid: nextPid++,
      name: sanitizeName(info.name),
      skin: sanitizeSkin(info.skin),
      level: Math.max(1, Math.min(99, info.level | 0 || 1)),
      team,
    };
    this.clients.set(clientId, c);
    this.order.push(clientId);
    if (!this.hostId) this.hostId = clientId;
    this.lastActive = Date.now();
    if (this.phase === 'match' && this.sim) this.joinMidMatch(c);
    this.broadcastLobby();
    return { ok: true };
  }

  joinMidMatch(c) {
    const sim = this.sim;
    // equipo con menos humanos
    const t0 = sim.players.filter((p) => p.team === 0 && !p.bot).length;
    const t1 = sim.players.filter((p) => p.team === 1 && !p.bot).length;
    c.team = t0 <= t1 ? 0 : 1;
    const bot = sim.players.find((p) => p.team === c.team && p.bot && p.state === 0) ||
      sim.players.find((p) => p.team === c.team && p.bot);
    if (bot) {
      sim.bots.delete(bot.id);
      bot.bot = false;
      bot.name = c.name;
      bot.skin = c.skin;
      bot.level = c.level;
      bot.inputs = [];
      c.pid = bot.id;
    } else {
      sim.addPlayer({ id: c.pid, name: c.name, team: c.team, skin: c.skin, level: c.level, bot: false });
    }
    this.send(c.id, { t: 'start', you: c.pid, roster: this.roster(), settings: this.settings, code: this.code });
    this.broadcast({ t: 'roster', roster: this.roster() });
  }

  leave(clientId) {
    const c = this.clients.get(clientId);
    if (!c) return;
    this.clients.delete(clientId);
    this.order = this.order.filter((x) => x !== clientId);
    if (this.hostId === clientId) this.hostId = this.order[0] || null;
    if (this.sim) {
      const p = this.sim.byId.get(c.pid);
      if (p) {
        p.bot = true;
        p.inputs = [];
        this.sim.bots.set(p.id, new BotBrain(this.sim, p.id, this.settings.difficulty));
      }
      this.broadcast({ t: 'roster', roster: this.roster() });
    }
    this.broadcastLobby();
  }

  message(clientId, msg) {
    const c = this.clients.get(clientId);
    if (!c || !msg || typeof msg !== 'object') return;
    this.lastActive = Date.now();
    switch (msg.t) {
      case 'in':
        if (this.sim && Number.isFinite(msg.s)) {
          this.sim.queueInput(c.pid, {
            s: msg.s | 0,
            mx: num(msg.mx), my: num(msg.my),
            ax: num(msg.ax), ay: num(msg.ay),
            b: msg.b | 0,
          });
        }
        break;
      case 'emote':
        if (this.sim) this.sim.emote(c.pid, msg.e);
        break;
      case 'team':
        if (this.phase === 'lobby' && (msg.team === 0 || msg.team === 1)) {
          c.team = msg.team;
          this.broadcastLobby();
        }
        break;
      case 'profile':
        c.name = sanitizeName(msg.name);
        c.skin = sanitizeSkin(msg.skin);
        if (msg.level) c.level = Math.max(1, Math.min(99, msg.level | 0));
        this.broadcastLobby();
        break;
      case 'settings':
        if (clientId === this.hostId && this.phase === 'lobby') {
          this.settings = sanitizeSettings(msg.settings, this.settings);
          this.broadcastLobby();
        }
        break;
      case 'start':
        if (clientId === this.hostId && this.phase === 'lobby') {
          const err = this.startMatch();
          if (err) this.send(clientId, { t: 'error', msg: err });
        }
        break;
      case 'ping':
        this.send(clientId, { t: 'pong', c: msg.c });
        break;
      default:
        break;
    }
  }

  roster() {
    if (!this.sim) return [];
    return this.sim.players.map((p) => ({ id: p.id, name: p.name, team: p.team, bot: p.bot, skin: p.skin, level: p.level }));
  }

  startMatch() {
    const s = this.settings;
    const humans = [...this.clients.values()];
    const counts = [humans.filter((c) => c.team === 0).length, humans.filter((c) => c.team === 1).length];
    if (!s.bots && (counts[0] === 0 || counts[1] === 0)) {
      return 'Sin bots, cada equipo necesita al menos un jugador';
    }
    const size = s.bots ? Math.max(s.teamSize, counts[0], counts[1]) : 0;
    const roster = humans.map((c) => ({ id: c.pid, name: c.name, team: c.team, skin: c.skin, level: c.level, bot: false }));
    const botIds = [];
    for (const team of [0, 1]) {
      const pool = shuffle((team === 0 ? PAPOI_NAMES : MACACO_NAMES).slice());
      for (let i = counts[team]; i < size; i++) {
        const id = this.botSeq++;
        botIds.push(id);
        roster.push({
          id, team, bot: true,
          name: pool[i % pool.length],
          level: 1 + ((Math.random() * 12) | 0),
          skin: sanitizeSkin({
            hat: Math.random() < 0.35 ? HATS[1 + ((Math.random() * 7) | 0)] : 'none',
            eyes: Math.random() < 0.3 ? 1 : 2,
            fur: (Math.random() * 4) | 0,
          }),
        });
      }
    }
    this.sim = new Sim(s, roster);
    for (const id of botIds) this.sim.bots.set(id, new BotBrain(this.sim, id, s.difficulty));
    this.phase = 'match';
    this.tickCount = 0;
    for (const c of this.clients.values()) {
      this.send(c.id, { t: 'start', you: c.pid, roster: this.roster(), settings: s, code: this.code });
    }
    this.broadcastLobby();
    return null;
  }

  tick() {
    if (this.phase !== 'match' || !this.sim) return;
    const sim = this.sim;
    sim.step();
    updateTeamRoles(sim);
    this.tickCount++;
    const ended = sim.phase === PHASE.ENDED;
    if (this.tickCount % this.snapshotEvery === 0 || ended) {
      const snap = sim.snapshot();
      snap.ev = sim.events;
      sim.events = [];
      for (const c of this.clients.values()) {
        this.send(c.id, snap, sim.selfState(c.pid));
      }
    }
    if (ended) {
      const results = sim.results();
      this.broadcast({ t: 'end', results });
      this.sim = null;
      this.phase = 'lobby';
      this.broadcastLobby();
    }
  }

  lobbyState() {
    return {
      t: 'lobby',
      code: this.code,
      phase: this.phase,
      host: this.clients.get(this.hostId)?.pid ?? null,
      isPublic: this.isPublic,
      settings: this.settings,
      players: [...this.clients.values()].map((c) => ({ id: c.pid, name: c.name, team: c.team, skin: c.skin, level: c.level })),
    };
  }

  broadcastLobby() {
    const st = this.lobbyState();
    for (const c of this.clients.values()) this.send(c.id, { ...st, you: c.pid });
  }

  broadcast(msg) {
    for (const c of this.clients.values()) this.send(c.id, msg);
  }
}

function num(v) {
  v = +v;
  if (!Number.isFinite(v)) return 0;
  return Math.max(-50, Math.min(50, v));
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export { HATS };
