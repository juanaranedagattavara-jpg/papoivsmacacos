// Multijugador dentro de la nube de Claude (capacidad `room` de los Artifacts).
//
// Habla el mismo protocolo que el servidor WebSocket (hello/create/join/quick/leave,
// lobby/start/s/roster/end/error), así main.js y game.js casi no cambian:
// - Anfitrión: quien crea la sala corre la Room (motor autoritativo) en su navegador y
//   publica el estado en su `presence` de la sala nombrada `pvm-<código>`.
// - Invitado: publica sus controles en su `presence` y lee el estado del anfitrión.
// La presencia es "último valor gana" (máx. 4 KiB, ~30 envíos/s), así que los mensajes
// se convierten en campos con número de secuencia y los botones en contadores.
// Las etiquetas `peer` son opacas: nunca se usan como claves de objeto, sólo como valores.
import { Room, cleanText } from '../shared/room.js';
import { TICK_RATE, LIMITS } from '../shared/constants.js';

const SELF_KEYS = ['ack', 'x', 'y', 'a', 'b', 'u', 'fz', 'st', 'sl', 'bo', 'lp', 'ldx', 'ldy', 'ds', 'ddx', 'ddy', 'tr', 'mu', 'g', 'sh', 'cr', 'zo', 's', 'j', 'lk'];
const MAX_BYTES = 3700; // margen bajo el límite de 4 KiB de presence
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const HOST_TIMEOUT = 9000; // sin anfitrión tras unirse: la sala no existe
const GRACE_MS = 5000; // ausencias breves (reconexiones) no expulsan a nadie
const INPUT_STALE_MS = 250; // controles sin cambios por más tiempo = invitado inactivo
const ADMIT_TIMEOUT = 60000; // anfitrión visible que no nos admite (juego en segundo plano)
const TERMINAL = new Set(['revoked', 'not_granted', 'capability_disabled', 'capability_removed', 'transform_error']);
const enc = new TextEncoder();
const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const roomName = (code) => 'pvm-' + String(code).toLowerCase();

export function encodeSelf(s) { return SELF_KEYS.map((k) => (typeof s[k] === 'number' ? s[k] : 0)); }
export function decodeSelf(a) {
  const o = {};
  SELF_KEYS.forEach((k, i) => { o[k] = Array.isArray(a) && typeof a[i] === 'number' ? a[i] : 0; });
  return o;
}

// Jugadores en forma compacta: [id, nombre, equipo, bot, nivel, gorro, ojos, pelaje]
function packPlayer(p) {
  const sk = p.skin || {};
  return [p.id, cleanText(p.name, LIMITS.nameLen), p.team, p.bot ? 1 : 0, p.level || 1, sk.hat || 'none', sk.eyes === 1 ? 1 : 2, sk.fur | 0];
}
function unpackPlayer(a) {
  return { id: a[0], name: cleanText(String(a[1] ?? ''), LIMITS.nameLen) || '?', team: a[2] === 1 ? 1 : 0, bot: a[3] === 1, level: a[4] | 0 || 1, skin: { hat: String(a[5] || 'none'), eyes: a[6] === 1 ? 1 : 2, fur: a[7] | 0 } };
}

function packLobby(m) {
  return { c: m.code, ph: m.phase, h: m.host, se: m.settings, pl: m.players.map(packPlayer) };
}
function unpackLobby(d, you) {
  return { t: 'lobby', code: d.c, phase: d.ph, host: d.h, isPublic: false, settings: clone(d.se), players: (d.pl || []).map(unpackPlayer), you };
}

function packResults(r) {
  return {
    w: r.winner, sc: [...r.score],
    pl: r.players.map((p) => [p.id, cleanText(p.name, LIMITS.nameLen), p.team, p.bot ? 1 : 0, p.level || 1, p.mvp,
      [p.stats.caps, p.stats.tags, p.stats.rescues, p.stats.hits, p.stats.returns, p.stats.steals, p.stats.infects, p.stats.jailed, p.stats.serums]]),
  };
}
function unpackResults(d) {
  const K = ['caps', 'tags', 'rescues', 'hits', 'returns', 'steals', 'infects', 'jailed', 'serums'];
  return {
    winner: d.w, score: clone(d.sc),
    players: (d.pl || []).map((a) => {
      const stats = {};
      K.forEach((k, i) => { stats[k] = (a[6] && a[6][i]) | 0; });
      return { id: a[0], name: cleanText(String(a[1] ?? ''), LIMITS.nameLen) || '?', team: a[2] === 1 ? 1 : 0, bot: a[3] === 1, level: a[4] | 0, mvp: a[5] | 0, stats, skin: {} };
    }),
  };
}

// Busca la entrada de un peer en una lista [[peer, ...datos], ...]
function entry(list, peer) {
  if (!Array.isArray(list) || !peer) return null;
  return list.find((e) => Array.isArray(e) && e[0] === peer) || null;
}

export class CloudConnection {
  constructor(api, profile) {
    this.api = api; // namespace de claude.use("room")
    this.isLocal = false;
    this.persistent = true;
    this.rtt = 0;
    this.closed = false;
    this.busy = false;
    this.gen = 0;
    this.handler = () => {};
    this.onClose = () => {};
    this.onGames = () => {};
    this.onUnavailable = () => {};
    this.onBusy = () => {};
    this.setProfile(profile);
    this.mode = null; // 'host' | 'client'
    this.named = null;
    this.unsubs = [];
    this.gameUnsubs = [];
    this.timer = null;
    this.watch = null;
    this.leaving = null;
    this.interpDelay = 0.16;
    // contadores del invitado: nunca vuelven atrás (el anfitrión recuerda el peer tras un reingreso)
    this.tqN = 0;
    this.emN = 0;
    this.emIdx = 0;
    this.inArr = [0, 0, 0, 0, 0, 0, 0, 0];
    // lobby general: anuncia y descubre salas abiertas
    this.unsubs.push(api.onPeers(() => this.onGames(this.openGames()), (e) => this.fatal(e)));
    this.unsubs.push(api.onConnection(() => {}, (e) => this.fatal(e)));
    this.lobbyPresence();
  }

  setProfile(p) {
    const sk = p.skin || {};
    this.profile = {
      name: cleanText(p.name, LIMITS.nameLen) || 'Jugador',
      skin: { hat: typeof sk.hat === 'string' ? sk.hat : 'none', eyes: sk.eyes === 1 ? 1 : 2, fur: sk.fur | 0 },
      level: Math.max(1, Math.min(99, p.level | 0 || 1)),
    };
  }

  onMessage(fn) { this.handler = fn; }
  deliver(msg) { queueMicrotask(() => { if (!this.closed) this.handler(msg); }); }
  setBusy(b) { this.busy = b; this.onBusy(b); }

  // Un error terminal de la plataforma: esta vista no puede usar salas
  fatal(e) {
    if (!e || this.closed) return;
    if (TERMINAL.has(e.code)) {
      const wasPlaying = !!this.mode;
      this.leaveGame(false);
      this.closed = true;
      this.onUnavailable(e.code);
      if (wasPlaying) this.onClose('Se perdió el acceso a las salas de esta página');
    }
  }

  lobbyPresence(extra = {}) {
    if (this.closed) return;
    const p = { app: 'pvm', nm: this.profile.name, lv: this.profile.level, g: null, gc: 0, gm: 0, ...extra };
    const key = JSON.stringify(p);
    if (key === this.lobbyKey) return; // sólo cambios (presupuesto de ~40 envíos/s)
    this.lobbyKey = key;
    this.api.presence(p).catch((e) => { this.lobbyKey = null; this.fatal(e); });
  }

  // Salas abiertas anunciadas por otros en el lobby general
  openGames() {
    let peers = [];
    try { peers = this.api.peers(); } catch { peers = []; }
    return peers
      .filter((p) => !p.sameTab && p.presence && p.presence.app === 'pvm' && typeof p.presence.g === 'string' && /^[A-Z]{4}$/.test(p.presence.g))
      .map((p) => ({ code: p.presence.g, host: cleanText(p.presence.nm, LIMITS.nameLen) || 'Alguien', count: p.presence.gc | 0, inMatch: !!p.presence.gm }));
  }

  send(msg) {
    if (!msg || this.closed) return;
    switch (msg.t) {
      case 'hello':
        this.setProfile(msg);
        this.deliver({ t: 'hi', id: 'cloud' });
        if (this.mode === 'host') this.room.message('me', { t: 'profile', ...this.profile });
        else if (this.mode === 'client') this.clientPresence();
        else this.lobbyPresence();
        return;
      case 'create': if (!this.busy) this.startHost(msg.team, msg.settings); return;
      case 'join': if (!this.busy) this.startClient(msg.code, msg.team); return;
      case 'quick': {
        if (this.busy) return;
        const g = this.openGames().filter((x) => x.count < LIMITS.maxPlayers).sort((a, b) => b.count - a.count)[0];
        if (g) this.startClient(g.code, msg.team);
        else this.startHost(msg.team, {});
        return;
      }
      case 'leave': this.leaveGame(); this.deliver({ t: 'left' }); return;
      case 'ping': return;
      default:
        if (this.mode === 'host') this.room.message('me', msg);
        else if (this.mode === 'client') this.clientCommand(msg);
    }
  }

  setPaused() {}

  // Une la sala nombrada (esperando que termine una salida anterior). null si se canceló.
  async joinNamed(code, gen) {
    if (this.leaving) { try { await this.leaving; } catch { /* */ } }
    const named = await this.api.join(roomName(code));
    if (gen !== this.gen || this.closed) {
      if (named !== this.named) named.leave().catch(() => {});
      return null;
    }
    return named;
  }

  joinError(e, fallback) {
    if (e && (e.code === 'not_permitted' || TERMINAL.has(e.code))) {
      this.closed = e.code !== 'not_permitted' ? true : this.closed;
      this.onUnavailable(e.code);
      this.deliver({ t: 'error', msg: 'Esta vista no puede usar salas. Abre la página con tu cuenta de Claude.' });
      return;
    }
    this.deliver({ t: 'error', msg: e && e.code === 'limit_reached' ? 'Claude no puede abrir otra sala ahora. Intenta en un momento.' : fallback });
  }

  // Escucha errores de la sala nombrada: si se pierde tras una reconexión, se vuelve a unir
  bindNamed() {
    const named = this.named;
    const onErr = (e) => this.namedError(e, named);
    this.gameUnsubs.push(named.onConnection((ok) => { if (ok) this.dirty = true; }, onErr));
    if (this.mode === 'client') this.gameUnsubs.push(named.onPeers((ch) => this.onClientPeers(ch.peers), onErr));
  }

  namedError(e, named) {
    if (named !== this.named || !this.mode) return;
    if (TERMINAL.has(e && e.code)) { this.fatal(e); return; }
    if (e && e.code === 'not_permitted') { this.lost('Se perdió la conexión con la sala'); return; }
    this.rejoin();
  }

  async rejoin() {
    if (this.rejoining || !this.mode || !this.code) return;
    this.rejoining = true;
    const gen = this.gen;
    for (let attempt = 0; attempt < 4; attempt++) {
      await sleep(600 * (attempt + 1));
      if (gen !== this.gen || this.closed) { this.rejoining = false; return; }
      try {
        for (const u of this.gameUnsubs) { try { u(); } catch { /* */ } }
        this.gameUnsubs = [];
        const named = await this.api.join(roomName(this.code));
        if (gen !== this.gen || this.closed) { named.leave().catch(() => {}); this.rejoining = false; return; }
        this.named = named;
        this.bindNamed();
        this.dirty = true;
        if (this.mode === 'client') { this.lastHost = null; this.clientPresence(); }
        this.rejoining = false;
        return;
      } catch (e) {
        if (e && (e.code === 'not_permitted' || TERMINAL.has(e.code))) break;
      }
    }
    this.rejoining = false;
    if (gen === this.gen) this.lost('Se perdió la conexión con la sala');
  }

  // ------------------------------------------------------------ anfitrión
  async startHost(team, settings) {
    this.leaveGame();
    const gen = this.gen;
    this.setBusy(true);
    const taken = new Set(this.openGames().map((g) => g.code));
    let code = '';
    do {
      code = '';
      for (let i = 0; i < 4; i++) code += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
    } while (taken.has(code));
    let named;
    try {
      named = await this.joinNamed(code, gen);
    } catch (e) {
      if (gen === this.gen) { this.setBusy(false); this.joinError(e, 'No se pudo crear la sala en Claude. Intenta de nuevo.'); }
      return;
    }
    if (!named) return;
    this.setBusy(false);
    this.mode = 'host';
    this.named = named;
    this.code = code;
    this.interpDelay = 0.07;
    this.remote = new Map(); // peer -> estado de sus controles
    this.lb = null; this.ss = null; this.ro = null; this.st = null; this.end = null;
    this.er = new Map(); // peer -> [seq, mensaje]
    this.selves = new Map(); // peer -> estado propio codificado
    this.events = [];
    this.evSeq = 0;
    this.simTime = 0;
    this.seq = { lb: 0, ss: 0, ro: 0, end: 0, er: 0 };
    this.lastSnapObj = null;
    this.dirty = true;
    this.tickN = 0;
    this.warned = false;
    this.room = new Room(code, {
      snapshotEvery: 1,
      settings,
      send: (cid, m, self) => this.hostSend(cid, m, self),
    });
    this.room.join('me', { ...this.profile, team });
    this.bindNamed();
    this.hidden = false;
    // al irse a otra app se publica la pausa de inmediato (después el navegador puede congelar la página)
    const onVis = () => { if (gen === this.gen && this.mode === 'host' && document.hidden) { this.hidden = true; this.publish(); } };
    document.addEventListener('visibilitychange', onVis);
    this.gameUnsubs.push(() => document.removeEventListener('visibilitychange', onVis));
    clearInterval(this.timer);
    const STEP = 1000 / TICK_RATE;
    let acc = 0, last = performance.now();
    this.timer = setInterval(() => {
      if (gen !== this.gen) return;
      const now = performance.now();
      acc += now - last;
      last = now;
      let n = 0;
      while (acc >= STEP && n < 4) { this.hostTick(); acc -= STEP; n++; }
      if (acc > STEP * 4) acc = 0;
    }, 8);
  }

  hostSend(cid, m, self) {
    if (cid === 'me') this.deliver(self !== undefined ? { ...m, you: self } : m);
    switch (m.t) {
      case 's':
        if (m !== this.lastSnapObj) {
          this.lastSnapObj = m;
          const { ev, ...rest } = m;
          this.st = rest;
          this.simTime = m.tm;
          for (const e of ev || []) this.events.push([++this.evSeq, m.tm, ...e]);
        }
        if (cid !== 'me' && self) this.selves.set(cid, encodeSelf(self));
        break;
      case 'lobby': {
        const { you, ...rest } = m;
        void you;
        this.lb = { n: ++this.seq.lb, d: packLobby(rest) };
        this.dirty = true;
        break;
      }
      case 'start':
        // también llega a quien entra a mitad de partida: sólo 'me' marca una partida nueva (ss.n = id de partida)
        if (cid === 'me') {
          this.ss = { n: ++this.seq.ss, se: m.settings };
          this.end = null; this.events = []; this.selves = new Map();
        }
        this.ro = { n: ++this.seq.ro, r: m.roster.map(packPlayer) };
        this.dirty = true;
        break;
      case 'roster':
        this.ro = { n: ++this.seq.ro, r: m.roster.map(packPlayer) };
        this.dirty = true;
        break;
      case 'end':
        // se mantiene el último snapshot junto al resultado: así llegan los eventos finales (captura)
        this.end = { n: ++this.seq.end, r: packResults(m.results) };
        this.ss = null;
        this.selves = new Map();
        this.dirty = true;
        break;
      case 'error':
        if (cid !== 'me') { this.er.set(cid, [++this.seq.er, cleanText(m.msg, 120)]); this.dirty = true; }
        break;
      default:
        break;
    }
  }

  hostTick() {
    if (this.mode !== 'host' || !this.named) return;
    const hidden = typeof document !== 'undefined' && document.hidden;
    if (hidden !== this.hidden) { this.hidden = hidden; this.dirty = true; }
    this.readRemote();
    if (hidden && this.room.phase === 'match') {
      // en segundo plano el navegador frena los timers: mejor pausar que correr en cámara lenta
      if (this.dirty) this.publish();
      return;
    }
    this.room.tick();
    this.tickN++;
    const inMatch = this.room.phase === 'match';
    if (this.tickN % 2 === 0 && (inMatch || this.dirty)) this.publish();
  }

  readRemote() {
    let peers = [];
    try { peers = this.named.peers(); } catch { peers = []; }
    const now = performance.now();
    const present = new Set();
    const leftNow = new Set();
    const inMatch = this.room.phase === 'match';
    for (const peer of peers) {
      if (peer.sameTab || peer.kind !== 'viewer') continue;
      const pr = peer.presence;
      if (pr && pr.x === 1) { leftNow.add(peer.peer); continue; } // se fue a propósito
      if (!pr || pr.c !== 1) continue;
      present.add(peer.peer);
      const inArr = Array.isArray(pr.in) ? pr.in : null;
      const tq = Array.isArray(pr.tq) ? pr.tq : null;
      let st = this.remote.get(peer.peer);
      if (!st) {
        st = {
          atk: inArr ? inArr[5] : 0, abi: inArr ? inArr[6] : 0, ult: inArr ? inArr[7] : 0,
          seq: inArr ? inArr[0] : 0, seqAt: 0,
          em: Array.isArray(pr.em) ? pr.em[0] : 0, tq: tq ? tq[0] : 0, pendingTeam: null,
          prof: profKey(pr), joined: false, goneAt: 0,
        };
        this.remote.set(peer.peer, st);
        const res = this.room.join(peer.peer, { name: pr.nm, skin: skinOf(pr), level: pr.lv, team: pr.tm });
        if (res && res.error) this.er.set(peer.peer, [++this.seq.er, res.error]);
        else st.joined = true;
        this.dirty = true;
        continue;
      }
      st.goneAt = 0;
      if (!st.joined) continue;
      // pedido de cambio de equipo (contador): sólo se aplica en el lobby
      if (tq && tq[0] !== st.tq) { st.tq = tq[0]; st.pendingTeam = tq[1] === 1 ? 1 : 0; }
      if (st.pendingTeam !== null && !inMatch) {
        this.room.message(peer.peer, { t: 'team', team: st.pendingTeam });
        st.pendingTeam = null;
      }
      const pk = profKey(pr);
      if (pk !== st.prof) { st.prof = pk; this.room.message(peer.peer, { t: 'profile', name: pr.nm, skin: skinOf(pr), level: pr.lv }); }
      if (Array.isArray(pr.em) && pr.em[0] !== st.em) { st.em = pr.em[0]; this.room.message(peer.peer, { t: 'emote', e: pr.em[1] | 0 }); }
      if (inMatch && inArr) {
        let b = 0;
        if (inArr[5] !== st.atk) { b |= 1; st.atk = inArr[5]; }
        if (inArr[6] !== st.abi) { b |= 2; st.abi = inArr[6]; }
        if (inArr[7] !== st.ult) { b |= 4; st.ult = inArr[7]; }
        if (inArr[0] !== st.seq) { st.seq = inArr[0]; st.seqAt = now; }
        // si el invitado dejó de mandar controles (cambió de app), su personaje se detiene
        if (b || now - st.seqAt < INPUT_STALE_MS) {
          this.room.message(peer.peer, { t: 'in', s: inArr[0] | 0, mx: +inArr[1] || 0, my: +inArr[2] || 0, ax: +inArr[3] || 0, ay: +inArr[4] || 0, b });
        }
      }
    }
    // ausencias: se espera un margen antes de convertirlo en bot (reconexiones breves)
    for (const [id, st] of this.remote) {
      if (present.has(id)) continue;
      if (!st.joined) { this.remote.delete(id); this.er.delete(id); this.dirty = true; continue; }
      if (!leftNow.has(id)) {
        if (!st.goneAt) { st.goneAt = now; continue; }
        if (now - st.goneAt < GRACE_MS) continue;
      }
      if (st.joined) this.room.leave(id);
      this.remote.delete(id);
      this.selves.delete(id);
      this.er.delete(id);
      this.dirty = true;
    }
  }

  publish() {
    this.dirty = false;
    const inMatch = this.room.phase === 'match' && !!this.st;
    const ended = !inMatch && !!this.end;
    const pm = [];
    for (const [cid, c] of this.room.clients) if (cid !== 'me') pm.push([cid, c.pid]);
    // eventos de los últimos ~1,5 s de juego (los invitados descartan los ya vistos)
    const now = this.simTime || 0;
    this.events = this.events.filter((e) => now - e[1] < 1.5).slice(-40);
    const me = [];
    if (inMatch) for (const [peer, arr] of this.selves) me.push([peer, ...arr]);
    const er = [];
    for (const [peer, v] of this.er) er.push([peer, v[0], v[1]]);
    const pr = {
      h: 1, v: 1, code: this.code, pm, pz: this.hidden ? 1 : 0,
      lb: inMatch ? null : this.lb,
      ss: inMatch ? this.ss : null,
      ro: inMatch || ended ? this.ro : null,
      st: inMatch || ended ? this.st : null,
      me: inMatch ? me : null,
      ev: inMatch || ended ? this.events.map((e) => [e[0], ...e.slice(2)]) : null,
      end: ended ? this.end : null,
      er: er.length ? er : null,
    };
    // nunca pasar de 4 KiB: recortar lo menos importante primero
    let json = JSON.stringify(pr);
    const size = () => enc.encode(json).length;
    while (size() > MAX_BYTES && pr.ev && pr.ev.length) { pr.ev.shift(); json = JSON.stringify(pr); }
    if (size() > MAX_BYTES && pr.st) { pr.st = { ...pr.st, pj: [] }; json = JSON.stringify(pr); }
    if (size() > MAX_BYTES && pr.st) { pr.st = { ...pr.st, cl: [], pe: [] }; json = JSON.stringify(pr); }
    if (size() > MAX_BYTES && ended) { pr.st = null; pr.ev = null; pr.ro = null; json = JSON.stringify(pr); }
    if (size() > MAX_BYTES) { this.dirty = true; return; } // no publicar algo que la plataforma rechazaría
    // se publica una copia: el motor sigue mutando sus propios objetos
    this.named.presence(JSON.parse(json)).catch((e) => {
      this.dirty = true;
      if (e && e.code === 'invalid_argument' && !this.warned) { this.warned = true; console.warn('presence rechazada:', e.message); }
    });
    this.lobbyPresence({ g: this.code, gc: this.room.clients.size, gm: inMatch ? 1 : 0 });
  }

  // ------------------------------------------------------------ invitado
  async startClient(code, team) {
    this.leaveGame();
    code = String(code || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    if (code.length !== 4) { this.deliver({ t: 'error', msg: 'El código tiene 4 letras' }); return; }
    const gen = this.gen;
    this.setBusy(true);
    let named;
    try {
      named = await this.joinNamed(code, gen);
    } catch (e) {
      if (gen === this.gen) { this.setBusy(false); this.joinError(e, 'No se pudo entrar a la sala en Claude. Intenta de nuevo.'); }
      return;
    }
    if (!named) return;
    this.setBusy(false);
    this.mode = 'client';
    this.named = named;
    this.code = code;
    this.interpDelay = 0.16;
    this.team = team === 1 ? 1 : 0;
    this.tqN++; // así el anfitrión aplica el equipo pedido aunque recuerde un pedido anterior
    this.inArr = [0, 0, 0, 0, 0, this.inArr[5], this.inArr[6], this.inArr[7]];
    this.sentAt = new Map();
    this.waitSent = false;
    this.hostPaused = false;
    this.admitted = false;
    this.myPeer = null;
    this.hostPeer = null;
    this.hostGoneAt = 0;
    this.lastHost = null;
    this.got = { lb: -1, ss: -1, ro: -1, end: -1, er: -1 };
    this.roster = [];
    this.started = false;
    this.startPid = null;
    this.lastEv = -1;
    this.stTm = -1;
    this.clientPresence();
    this.bindNamed();
    const joinedAt = performance.now();
    clearInterval(this.watch);
    // vigilante: anfitrión que nunca aparece o que se fue de verdad (no una reconexión breve)
    this.watch = setInterval(() => {
      if (gen !== this.gen || this.mode !== 'client') return;
      const now = performance.now();
      if (!this.hostPeer && now - joinedAt > HOST_TIMEOUT) {
        this.deliver({ t: 'error', msg: `No encontramos la sala ${code}. Revisa el código o crea una nueva.` });
        this.leaveGame();
      } else if (this.hostPeer && this.hostGoneAt && now - this.hostGoneAt > GRACE_MS) {
        this.lost('Se perdió la conexión con el anfitrión');
      } else if (this.hostPeer && !this.admitted) {
        // el anfitrión existe pero no nos agrega: probablemente tiene el juego en segundo plano
        if (!this.waitSent && now - joinedAt > 1500) { this.waitSent = true; this.deliver({ t: 'waiting', code }); }
        if (now - joinedAt > ADMIT_TIMEOUT) {
          this.deliver({ t: 'error', msg: `La sala ${code} no responde. El anfitrión debe tener el juego abierto en pantalla.` });
          this.leaveGame();
        }
      }
    }, 500);
    this.lobbyPresence({ g: null });
  }

  clientPresence() {
    if (!this.named) return;
    const sk = this.profile.skin || {};
    this.named.presence({
      c: 1, v: 1, nm: this.profile.name, lv: this.profile.level || 1,
      sk: [sk.hat || 'none', sk.eyes === 1 ? 1 : 2, sk.fur | 0],
      tm: this.team, tq: [this.tqN, this.team], in: [...this.inArr], em: [this.emN, this.emIdx | 0], x: null,
    }).catch((e) => this.fatal(e));
  }

  clientCommand(m) {
    switch (m.t) {
      case 'in': {
        const a = this.inArr;
        let atk = a[5], abi = a[6], ult = a[7], ax = a[3], ay = a[4];
        if (m.b & 1) { atk++; ax = m.ax; ay = m.ay; }
        if (m.b & 2) abi++;
        if (m.b & 4) ult++;
        this.inArr = [m.s, m.mx, m.my, ax, ay, atk, abi, ult];
        this.sentAt.set(m.s, performance.now());
        if (this.sentAt.size > 200) this.sentAt.delete(this.sentAt.keys().next().value);
        this.named.presence({ in: [...this.inArr] }).catch(() => {});
        break;
      }
      case 'emote':
        this.emN++;
        this.emIdx = m.e | 0;
        this.named.presence({ em: [this.emN, this.emIdx] }).catch(() => {});
        break;
      case 'team':
        if (m.team === 0 || m.team === 1) {
          this.team = m.team;
          this.tqN++;
          this.named.presence({ tm: m.team, tq: [this.tqN, m.team] }).catch(() => {});
        }
        break;
      case 'profile':
        this.clientPresence();
        break;
      default:
        break; // settings/start: sólo el anfitrión
    }
  }

  onClientPeers(peers) {
    if (this.mode !== 'client') return;
    const me = peers.find((p) => p.sameTab);
    if (me) this.myPeer = me.peer;
    const host = peers.find((p) => !p.sameTab && p.kind === 'viewer' && p.presence && p.presence.h === 1 && p.presence.code === this.code);
    if (!host) {
      if (this.hostPeer && !this.hostGoneAt) this.hostGoneAt = performance.now();
      return;
    }
    this.hostGoneAt = 0;
    this.hostPeer = host.peer;
    if (host.presence === this.lastHost) return;
    this.lastHost = host.presence;
    this.consumeHost(host.presence);
  }

  consumeHost(pr) {
    if (pr.x === 1) { this.lost('El anfitrión cerró la sala'); return; }
    const paused = pr.pz === 1;
    if (paused !== this.hostPaused) {
      this.hostPaused = paused;
      if (this.started) this.deliver({ t: 'hostpaused', on: paused });
    }
    const pmE = entry(pr.pm, this.myPeer);
    const pid = pmE ? pmE[1] : undefined;
    const erE = entry(pr.er, this.myPeer);
    if (erE && erE[1] !== this.got.er) {
      this.got.er = erE[1];
      this.deliver({ t: 'error', msg: String(erE[2]) });
      if (pid === undefined) { this.leaveGame(); return; }
    }
    if (pid === undefined) return; // el anfitrión aún no nos agrega
    this.admitted = true;
    if (pr.lb && pr.lb.n !== this.got.lb) {
      this.got.lb = pr.lb.n;
      this.deliver(unpackLobby(pr.lb.d, pid));
    }
    if (pr.ro && pr.ro.n !== this.got.ro) {
      this.got.ro = pr.ro.n;
      this.roster = pr.ro.r.map(unpackPlayer);
      if (this.started) this.deliver({ t: 'roster', roster: clone(this.roster) });
    }
    if (pr.ss && this.roster.length && (pr.ss.n !== this.got.ss || !this.started || pid !== this.startPid)) {
      // partida nueva (aunque nos perdiéramos el final), o el anfitrión nos reasignó otro personaje
      this.got.ss = pr.ss.n;
      this.started = true;
      this.startPid = pid;
      this.stTm = -1;
      this.lastEv = Array.isArray(pr.ev) && pr.ev.length ? pr.ev[pr.ev.length - 1][0] : -1;
      this.deliver({ t: 'start', you: pid, roster: clone(this.roster), settings: clone(pr.ss.se), code: this.code, match: `${this.code}:${pr.ss.n}` });
    }
    if (this.started && pr.st && pr.st.tm !== this.stTm) {
      this.stTm = pr.st.tm;
      const ev = [];
      for (const e of pr.ev || []) {
        if (e[0] > this.lastEv) { ev.push(e.slice(1)); this.lastEv = e[0]; }
      }
      const selfE = entry(pr.me, this.myPeer);
      const you = selfE ? decodeSelf(selfE.slice(1)) : null;
      if (you) {
        you.id = pid;
        const t0 = this.sentAt.get(you.ack);
        if (t0) {
          const r = performance.now() - t0;
          this.rtt = this.rtt ? this.rtt * 0.85 + r * 0.15 : r;
        }
      }
      const snap = clone(pr.st);
      snap.ev = clone(ev);
      if (you) snap.you = you;
      this.deliver(snap);
    }
    if (pr.end && pr.end.n !== this.got.end) {
      this.got.end = pr.end.n;
      if (this.started) {
        this.started = false;
        this.startPid = null;
        this.deliver({ t: 'end', results: unpackResults(pr.end.r) });
      }
    }
  }

  lost(msg) {
    this.leaveGame();
    this.deliver({ t: 'error', msg });
    queueMicrotask(() => this.onClose(msg));
  }

  // ------------------------------------------------------------ salir
  leaveGame(announce = true) {
    this.gen++;
    clearInterval(this.timer);
    clearInterval(this.watch);
    this.timer = null;
    this.watch = null;
    for (const u of this.gameUnsubs) { try { u(); } catch { /* */ } }
    this.gameUnsubs = [];
    if (this.named) {
      const named = this.named;
      // salida intencional: el anfitrión avisa "sala cerrada" y el invitado "me voy", para que
      // nadie espere el margen de reconexión (la presence se agrupa: se deja un instante antes de salir)
      const signal = this.mode === 'host' ? { x: 1, st: null, ss: null, me: null, ev: null }
        : this.mode === 'client' ? { x: 1, in: null } : null;
      const p = (signal ? named.presence(signal).catch(() => {}).then(() => sleep(600)) : Promise.resolve())
        .then(() => named.leave()).catch(() => {});
      this.leaving = p;
      p.then(() => { if (this.leaving === p) this.leaving = null; });
    }
    this.named = null;
    this.room = null;
    this.mode = null;
    this.started = false;
    this.rejoining = false;
    if (this.busy) this.setBusy(false);
    if (announce && !this.closed) this.lobbyPresence();
  }

  close() {
    this.leaveGame(false);
    for (const u of this.unsubs) { try { u(); } catch { /* */ } }
    this.unsubs = [];
    if (!this.closed) this.api.presence({ app: null, nm: null, lv: null, g: null, gc: null, gm: null }).catch(() => {});
    this.closed = true;
  }
}

function skinOf(pr) {
  const sk = Array.isArray(pr.sk) ? pr.sk : [];
  return { hat: sk[0], eyes: sk[1], fur: sk[2] };
}
function profKey(pr) {
  return JSON.stringify([pr.nm, pr.lv, pr.sk]);
}
