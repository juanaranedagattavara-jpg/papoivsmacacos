// Multijugador dentro de la nube de Claude (capacidad `room` de los Artifacts).
//
// Habla el mismo protocolo que el servidor WebSocket (hello/create/join/quick/leave,
// lobby/start/s/roster/end/error), así main.js y game.js no cambian:
// - Anfitrión: quien crea la sala corre la Room (motor autoritativo) en su navegador y
//   publica el estado en su `presence` de la sala nombrada `pvm-<código>`.
// - Invitado: publica sus controles en su `presence` y lee el estado del anfitrión.
// La presencia es "último valor gana" (máx. 4 KiB, ~30 envíos/s), así que los mensajes
// se convierten en campos con número de secuencia y los botones en contadores.
import { Room } from '../shared/room.js';
import { TICK_RATE, LIMITS } from '../shared/constants.js';

const SELF_KEYS = ['ack', 'x', 'y', 'a', 'b', 'u', 'fz', 'st', 'sl', 'bo', 'lp', 'ldx', 'ldy', 'ds', 'ddx', 'ddy', 'tr', 'mu', 'g', 'sh', 'cr', 'zo', 's', 'j', 'lk'];
const MAX_BYTES = 3700; // margen bajo el límite de 4 KiB de presence
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const HOST_TIMEOUT = 8000;
const enc = new TextEncoder();
const bytes = (o) => enc.encode(JSON.stringify(o)).length;
const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
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
  return [p.id, p.name, p.team, p.bot ? 1 : 0, p.level || 1, sk.hat || 'none', sk.eyes === 1 ? 1 : 2, sk.fur | 0];
}
function unpackPlayer(a) {
  return { id: a[0], name: String(a[1] ?? ''), team: a[2] === 1 ? 1 : 0, bot: a[3] === 1, level: a[4] | 0 || 1, skin: { hat: String(a[5] || 'none'), eyes: a[6] === 1 ? 1 : 2, fur: a[7] | 0 } };
}

function packLobby(m) {
  return { c: m.code, ph: m.phase, h: m.host, se: m.settings, pl: m.players.map(packPlayer) };
}
function unpackLobby(d, you) {
  return { t: 'lobby', code: d.c, phase: d.ph, host: d.h, isPublic: false, settings: clone(d.se), players: (d.pl || []).map(unpackPlayer), you };
}

function packResults(r) {
  return {
    w: r.winner, sc: r.score,
    pl: r.players.map((p) => [p.id, p.name, p.team, p.bot ? 1 : 0, p.level || 1, p.mvp,
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
      return { id: a[0], name: String(a[1] ?? ''), team: a[2] === 1 ? 1 : 0, bot: a[3] === 1, level: a[4] | 0, mvp: a[5] | 0, stats, skin: {} };
    }),
  };
}

export class CloudConnection {
  constructor(api, profile) {
    this.api = api; // namespace de claude.use("room")
    this.isLocal = false;
    this.persistent = true;
    this.rtt = 0;
    this.closed = false;
    this.handler = () => {};
    this.onClose = () => {};
    this.onGames = () => {};
    this.profile = { name: profile.name || 'Jugador', skin: profile.skin, level: profile.level };
    this.mode = null; // 'host' | 'client'
    this.named = null;
    this.unsubs = [];
    this.gameUnsubs = [];
    this.timer = null;
    this.interpDelay = 0.16;
    // presencia en el lobby general: anuncia salas abiertas
    this.unsubs.push(api.onPeers(() => this.onGames(this.openGames()), () => {}));
    this.lobbyPresence();
  }

  onMessage(fn) { this.handler = fn; }
  deliver(msg) { queueMicrotask(() => { if (!this.closed) this.handler(msg); }); }

  lobbyPresence(extra = {}) {
    const p = { app: 'pvm', nm: this.profile.name, lv: this.profile.level, g: null, gc: 0, gm: 0, ...extra };
    const key = JSON.stringify(p);
    if (key === this.lobbyKey) return; // sólo enviar cambios (cuida el presupuesto de ~40 envíos/s)
    this.lobbyKey = key;
    this.api.presence(p).catch(() => { this.lobbyKey = null; });
  }

  // Salas abiertas anunciadas por otros en el lobby general
  openGames() {
    let peers = [];
    try { peers = this.api.peers(); } catch { peers = []; }
    return peers
      .filter((p) => !p.sameTab && p.presence && p.presence.app === 'pvm' && typeof p.presence.g === 'string' && /^[A-Z]{4}$/.test(p.presence.g))
      .map((p) => ({ code: p.presence.g, host: String(p.presence.nm || 'Alguien').slice(0, LIMITS.nameLen), count: p.presence.gc | 0, inMatch: !!p.presence.gm }));
  }

  send(msg) {
    if (!msg || this.closed) return;
    switch (msg.t) {
      case 'hello':
        this.profile = { name: msg.name || 'Jugador', skin: msg.skin, level: msg.level || 1 };
        this.deliver({ t: 'hi', id: 'cloud' });
        if (this.mode === 'host') this.room.message('me', { t: 'profile', ...this.profile });
        else if (this.mode === 'client') this.clientPresence();
        if (!this.mode) this.lobbyPresence();
        return;
      case 'create': this.startHost(msg.team, msg.settings); return;
      case 'join': this.startClient(msg.code, msg.team); return;
      case 'quick': {
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

  // ------------------------------------------------------------ anfitrión
  async startHost(team, settings) {
    this.leaveGame();
    const taken = new Set(this.openGames().map((g) => g.code));
    let code = '';
    do {
      code = '';
      for (let i = 0; i < 4; i++) code += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
    } while (taken.has(code));
    let named;
    try {
      named = await this.api.join(roomName(code));
    } catch (e) {
      this.deliver({ t: 'error', msg: e && e.code === 'limit_reached' ? 'No se pudo abrir otra sala ahora. Intenta de nuevo.' : 'No se pudo crear la sala en Claude.' });
      return;
    }
    if (this.closed) { named.leave().catch(() => {}); return; }
    this.mode = 'host';
    this.named = named;
    this.code = code;
    this.interpDelay = 0.07;
    this.remote = new Map(); // peer -> estado de sus controles
    this.lb = null; this.ss = null; this.ro = null; this.st = null; this.end = null;
    this.er = {};
    this.selves = {};
    this.events = [];
    this.evSeq = 0;
    this.seq = { lb: 0, ss: 0, ro: 0, end: 0, er: 0 };
    this.lastSnapObj = null;
    this.dirty = true;
    this.tickN = 0;
    this.room = new Room(code, {
      snapshotEvery: 1,
      settings,
      send: (cid, m, self) => this.hostSend(cid, m, self),
    });
    this.room.join('me', { ...this.profile, team });
    this.gameUnsubs.push(named.onConnection((ok) => { if (ok) this.dirty = true; }, () => {}));
    const STEP = 1000 / TICK_RATE;
    let acc = 0, last = performance.now();
    this.timer = setInterval(() => {
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
        if (cid !== 'me' && self) this.selves[cid] = encodeSelf(self);
        break;
      case 'lobby': {
        const { you, ...rest } = m;
        void you;
        this.lb = { n: ++this.seq.lb, d: packLobby(rest) };
        this.dirty = true;
        break;
      }
      case 'start':
        // también llega a un invitado que entra a mitad de partida: sólo 'me' marca partida nueva
        this.ss = { n: ++this.seq.ss, se: m.settings };
        this.ro = { n: ++this.seq.ro, r: m.roster.map(packPlayer) };
        if (cid === 'me') { this.end = null; this.events = []; this.selves = {}; }
        this.dirty = true;
        break;
      case 'roster':
        this.ro = { n: ++this.seq.ro, r: m.roster.map(packPlayer) };
        this.dirty = true;
        break;
      case 'end':
        // se mantiene el último snapshot junto al resultado: así llegan los eventos finales (captura)
        this.end = { n: ++this.seq.end, r: packResults(m.results) };
        this.ss = null; this.selves = {};
        this.dirty = true;
        break;
      case 'error':
        if (cid !== 'me') { this.er[cid] = [++this.seq.er, String(m.msg).slice(0, 120)]; this.dirty = true; }
        break;
      default:
        break;
    }
  }

  hostTick() {
    if (this.mode !== 'host' || !this.named) return;
    this.readRemote();
    this.room.tick();
    this.tickN++;
    const inMatch = this.room.phase === 'match';
    if ((inMatch && this.tickN % 2 === 0) || (!inMatch && this.dirty && this.tickN % 2 === 0)) this.publish();
  }

  readRemote() {
    let peers = [];
    try { peers = this.named.peers(); } catch { peers = []; }
    const present = new Set();
    const inMatch = this.room.phase === 'match';
    for (const peer of peers) {
      if (peer.sameTab || peer.kind !== 'viewer') continue;
      const pr = peer.presence;
      if (!pr || pr.c !== 1) continue;
      present.add(peer.peer);
      const inArr = Array.isArray(pr.in) ? pr.in : null;
      let st = this.remote.get(peer.peer);
      if (!st) {
        st = {
          atk: inArr ? inArr[5] : 0, abi: inArr ? inArr[6] : 0, ult: inArr ? inArr[7] : 0,
          em: Array.isArray(pr.em) ? pr.em[0] : 0, tm: pr.tm, prof: profKey(pr), joined: false,
        };
        this.remote.set(peer.peer, st);
        const res = this.room.join(peer.peer, { name: pr.nm, skin: skinOf(pr), level: pr.lv, team: pr.tm });
        if (res && res.error) {
          this.er[peer.peer] = [++this.seq.er, res.error];
          st.rejected = true;
        } else st.joined = true;
        this.dirty = true;
        continue;
      }
      if (!st.joined) continue;
      if (pr.tm !== st.tm && (pr.tm === 0 || pr.tm === 1)) { st.tm = pr.tm; this.room.message(peer.peer, { t: 'team', team: pr.tm }); }
      const pk = profKey(pr);
      if (pk !== st.prof) { st.prof = pk; this.room.message(peer.peer, { t: 'profile', name: pr.nm, skin: skinOf(pr), level: pr.lv }); }
      if (Array.isArray(pr.em) && pr.em[0] !== st.em) { st.em = pr.em[0]; this.room.message(peer.peer, { t: 'emote', e: pr.em[1] | 0 }); }
      if (inMatch && inArr) {
        let b = 0;
        if (inArr[5] !== st.atk) { b |= 1; st.atk = inArr[5]; }
        if (inArr[6] !== st.abi) { b |= 2; st.abi = inArr[6]; }
        if (inArr[7] !== st.ult) { b |= 4; st.ult = inArr[7]; }
        this.room.message(peer.peer, { t: 'in', s: inArr[0] | 0, mx: +inArr[1] || 0, my: +inArr[2] || 0, ax: +inArr[3] || 0, ay: +inArr[4] || 0, b });
      }
    }
    for (const [id, st] of this.remote) {
      if (!present.has(id)) {
        if (st.joined) this.room.leave(id);
        this.remote.delete(id);
        delete this.selves[id];
        delete this.er[id];
        this.dirty = true;
      }
    }
  }

  publish() {
    this.dirty = false;
    const inMatch = this.room.phase === 'match' && !!this.st;
    const ended = !inMatch && !!this.end;
    const pm = {};
    for (const [cid, c] of this.room.clients) if (cid !== 'me') pm[cid] = c.pid;
    // eventos de los últimos ~1,5 s de juego (los invitados descartan los ya vistos)
    const now = this.simTime || 0;
    this.events = this.events.filter((e) => now - e[1] < 1.5).slice(-40);
    const pr = {
      h: 1, v: 1, code: this.code, pm,
      lb: inMatch ? null : this.lb,
      ss: inMatch ? this.ss : null,
      ro: inMatch || ended ? this.ro : null,
      st: inMatch || ended ? this.st : null,
      me: inMatch ? this.selves : null,
      ev: inMatch || ended ? this.events.map((e) => [e[0], ...e.slice(2)]) : null,
      end: ended ? this.end : null,
      er: Object.keys(this.er).length ? this.er : null,
    };
    // nunca pasar de 4 KiB: recortar lo menos importante primero
    let size = bytes(pr);
    while (size > MAX_BYTES && pr.ev && pr.ev.length) { pr.ev.shift(); size = bytes(pr); }
    if (size > MAX_BYTES && pr.st) { pr.st = { ...pr.st, pj: [] }; size = bytes(pr); }
    if (size > MAX_BYTES && pr.st) { pr.st = { ...pr.st, cl: [], pe: [] }; size = bytes(pr); }
    if (size > MAX_BYTES && ended) { pr.st = null; pr.ev = null; pr.ro = null; size = bytes(pr); }
    if (size > MAX_BYTES) { this.dirty = true; return; } // no publicar algo que la plataforma rechazaría
    this.named.presence(pr).catch(() => { this.dirty = true; });
    this.lobbyPresence({ g: this.code, gc: this.room.clients.size, gm: inMatch ? 1 : 0 });
  }

  // ------------------------------------------------------------ invitado
  async startClient(code, team) {
    this.leaveGame();
    code = String(code || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    if (code.length !== 4) { this.deliver({ t: 'error', msg: 'El código tiene 4 letras' }); return; }
    let named;
    try {
      named = await this.api.join(roomName(code));
    } catch {
      this.deliver({ t: 'error', msg: 'No se pudo entrar a la sala en Claude.' });
      return;
    }
    if (this.closed) { named.leave().catch(() => {}); return; }
    this.mode = 'client';
    this.named = named;
    this.code = code;
    this.interpDelay = 0.16;
    this.team = team === 1 ? 1 : 0;
    this.inArr = [0, 0, 0, 0, 0, 0, 0, 0];
    this.emN = 0;
    this.sentAt = new Map();
    this.myPeer = null;
    this.hostPeer = null;
    this.lastHost = null;
    this.got = { lb: -1, ss: -1, ro: -1, end: -1, er: -1 };
    this.roster = [];
    this.started = false;
    this.lastEv = -1;
    this.stTm = -1;
    this.clientPresence();
    this.gameUnsubs.push(named.onPeers((ch) => this.onClientPeers(ch.peers), () => {}));
    this.hostTimer = setTimeout(() => {
      if (!this.hostPeer && this.mode === 'client') {
        this.deliver({ t: 'error', msg: `No encontramos la sala ${code}. Revisa el código o crea una nueva.` });
        this.leaveGame();
      }
    }, HOST_TIMEOUT);
    this.lobbyPresence({ g: null });
  }

  clientPresence() {
    if (!this.named) return;
    const sk = this.profile.skin || {};
    this.named.presence({
      c: 1, v: 1, nm: this.profile.name, lv: this.profile.level || 1,
      sk: [sk.hat || 'none', sk.eyes === 1 ? 1 : 2, sk.fur | 0],
      tm: this.team, in: this.inArr, em: [this.emN, this.emIdx | 0],
    }).catch(() => {});
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
        this.named.presence({ in: this.inArr }).catch(() => {});
        break;
      }
      case 'emote':
        this.emN++;
        this.emIdx = m.e | 0;
        this.named.presence({ em: [this.emN, this.emIdx] }).catch(() => {});
        break;
      case 'team':
        if (m.team === 0 || m.team === 1) { this.team = m.team; this.named.presence({ tm: m.team }).catch(() => {}); }
        break;
      case 'profile':
        this.clientPresence();
        break;
      default:
        break; // settings/start: solo el anfitrión
    }
  }

  onClientPeers(peers) {
    if (this.mode !== 'client') return;
    const me = peers.find((p) => p.sameTab);
    if (me) this.myPeer = me.peer;
    const host = peers.find((p) => !p.sameTab && p.kind === 'viewer' && p.presence && p.presence.h === 1 && p.presence.code === this.code);
    if (!host) {
      if (this.hostPeer) this.lost('El anfitrión cerró la sala');
      return;
    }
    this.hostPeer = host.peer;
    clearTimeout(this.hostTimer);
    if (host.presence === this.lastHost) return;
    this.lastHost = host.presence;
    this.consumeHost(host.presence);
  }

  consumeHost(pr) {
    const pid = pr.pm && this.myPeer ? pr.pm[this.myPeer] : undefined;
    if (pr.er && this.myPeer && Array.isArray(pr.er[this.myPeer]) && pr.er[this.myPeer][0] !== this.got.er) {
      this.got.er = pr.er[this.myPeer][0];
      this.deliver({ t: 'error', msg: String(pr.er[this.myPeer][1]) });
      if (pid === undefined) { this.leaveGame(); return; }
    }
    if (pid === undefined) return; // el anfitrión aún no nos agrega
    if (pr.lb && pr.lb.n !== this.got.lb) {
      this.got.lb = pr.lb.n;
      this.deliver(unpackLobby(pr.lb.d, pid));
    }
    if (pr.ro && pr.ro.n !== this.got.ro) {
      this.got.ro = pr.ro.n;
      this.roster = pr.ro.r.map(unpackPlayer);
      if (this.started) this.deliver({ t: 'roster', roster: clone(this.roster) });
    }
    if (pr.ss && pr.ss.n !== this.got.ss && this.roster.length) {
      this.got.ss = pr.ss.n;
      if (!this.started) {
        this.started = true;
        this.stTm = -1;
        this.lastEv = Array.isArray(pr.ev) && pr.ev.length ? pr.ev[pr.ev.length - 1][0] : -1;
        this.deliver({ t: 'start', you: pid, roster: clone(this.roster), settings: clone(pr.ss.se), code: this.code });
      }
    }
    if (this.started && pr.st && pr.st.tm !== this.stTm) {
      this.stTm = pr.st.tm;
      const ev = [];
      for (const e of pr.ev || []) {
        if (e[0] > this.lastEv) { ev.push(e.slice(1)); this.lastEv = e[0]; }
      }
      const selfArr = pr.me && this.myPeer ? pr.me[this.myPeer] : null;
      const you = selfArr ? decodeSelf(selfArr) : null;
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
  leaveGame() {
    clearInterval(this.timer);
    clearTimeout(this.hostTimer);
    this.timer = null;
    for (const u of this.gameUnsubs) { try { u(); } catch { /* */ } }
    this.gameUnsubs = [];
    if (this.named) { this.named.leave().catch(() => {}); }
    this.named = null;
    this.room = null;
    this.mode = null;
    this.started = false;
    if (!this.closed) this.lobbyPresence();
  }

  close() {
    this.leaveGame();
    this.closed = true;
    for (const u of this.unsubs) { try { u(); } catch { /* */ } }
    this.unsubs = [];
    this.api.presence({ app: null, nm: null, lv: null, g: null, gc: null, gm: null }).catch(() => {});
  }
}

function skinOf(pr) {
  const sk = Array.isArray(pr.sk) ? pr.sk : [];
  return { hat: sk[0], eyes: sk[1], fur: sk[2] };
}
function profKey(pr) {
  return JSON.stringify([pr.nm, pr.lv, pr.sk]);
}
