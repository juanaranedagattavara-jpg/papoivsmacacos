// Simulador de la capacidad `room` de los Artifacts de Claude, SOLO para pruebas locales.
// Se inyecta antes de cargar la página (Playwright addInitScript). Varias pestañas del mismo
// navegador se ven entre sí vía BroadcastChannel, con latencia, agrupación (~30 Hz),
// límite de 4 KiB por presencia y objetos congelados, como en la plataforma real.
(() => {
  const LAT_MIN = +(window.__MOCK_LAT_MIN ?? 40);
  const LAT_MAX = +(window.__MOCK_LAT_MAX ?? 110);
  const enc = new TextEncoder();
  const deepFreeze = (o) => {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      for (const k of Object.keys(o)) deepFreeze(o[k]);
    }
    return o;
  };
  const rand = () => Math.random().toString(36).slice(2, 10);
  const myPeer = (rand() + rand()).slice(0, 16);
  const bc = new BroadcastChannel('pvm-mock-room');
  const stats = { presenceCalls: 0, sends: 0, maxBytes: 0, rejected: 0 };
  window.__mockRoomStats = stats;
  const later = (fn) => setTimeout(fn, LAT_MIN + Math.random() * (LAT_MAX - LAT_MIN));
  const err = (code, message) => Object.assign(new Error(message), { code, message });
  // Claves de presence: gramática de identificador en todos los niveles (más estricto que lo mínimo)
  const KEY = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
  const BAD = new Set(['prototype', ...Object.getOwnPropertyNames(Object.prototype)]);
  const badKey = (o, depth = 0) => {
    if (depth > 8) return 'too deep';
    if (Array.isArray(o)) { for (const v of o) { const b = badKey(v, depth + 1); if (b) return b; } return null; }
    if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o)) {
        if (!KEY.test(k) || BAD.has(k)) return 'bad key ' + k;
        const b = badKey(v, depth + 1);
        if (b) return b;
      }
    }
    return null;
  };
  let blipUntil = 0; // simula una reconexión: los demás dejan de vernos un momento
  window.__mockBlip = (ms) => { blipUntil = Date.now() + ms; bc.postMessage({ room: '*', kind: 'bye', peer: myPeer }); };

  function makeRoom(name) {
    const peers = new Map(); // peer -> {presence, updatedAt}
    let mine = {};
    let dirty = false;
    let timer = null;
    let left = false;
    const peerHandlers = new Set();
    const topicHandlers = new Map();
    let snapshot = Object.freeze([]);
    let pending = { joined: new Set(), left: new Set(), updated: new Set() };
    let frameQueued = false;

    const build = () => {
      const list = [{ peer: myPeer, presence: deepFreeze(JSON.parse(JSON.stringify(mine))), updatedAt: Date.now(), me: true }];
      for (const [peer, v] of peers) list.push({ peer, presence: v.presence, updatedAt: v.updatedAt });
      return Object.freeze(list.map((p) => Object.freeze({
        peer: p.peer, by: null, isMe: !!p.me, sameTab: !!p.me, kind: 'viewer', guest: false,
        presence: p.presence, updatedAt: p.updatedAt,
      })));
    };
    const notify = (kind, peer) => {
      pending[kind].add(peer);
      if (frameQueued) return;
      frameQueued = true;
      requestAnimationFrame(() => {
        frameQueued = false;
        snapshot = build();
        const byPeer = (set) => snapshot.filter((p) => set.has(p.peer));
        const change = { peers: snapshot, joined: byPeer(pending.joined), left: [...pending.left].map((peer) => ({ peer })), updated: byPeer(pending.updated) };
        pending = { joined: new Set(), left: new Set(), updated: new Set() };
        for (const h of peerHandlers) { try { h(change); } catch (e) { console.error(e); } }
      });
    };
    const flush = () => {
      timer = null;
      if (!dirty || left) return;
      if (Date.now() < blipUntil) { timer = setTimeout(flush, 50); return; }
      dirty = false;
      stats.sends++;
      const data = JSON.parse(JSON.stringify(mine));
      bc.postMessage({ room: name, kind: 'state', peer: myPeer, presence: data });
    };
    const onMsg = (ev) => {
      const m = ev.data;
      if (!m || (m.room !== name && m.room !== '*') || m.peer === myPeer || left) return;
      if (Date.now() < blipUntil) return;
      later(() => {
        if (left) return;
        if (m.kind === 'hello') {
          bc.postMessage({ room: name, kind: 'state', peer: myPeer, presence: JSON.parse(JSON.stringify(mine)) });
          if (!peers.has(m.peer)) { peers.set(m.peer, { presence: deepFreeze({}), updatedAt: Date.now() }); notify('joined', m.peer); }
        } else if (m.kind === 'state') {
          const isNew = !peers.has(m.peer);
          peers.set(m.peer, { presence: deepFreeze(m.presence), updatedAt: Date.now() });
          notify(isNew ? 'joined' : 'updated', m.peer);
        } else if (m.kind === 'bye') {
          if (peers.delete(m.peer)) notify('left', m.peer);
        } else if (m.kind === 'emit') {
          for (const h of topicHandlers.get(m.topic) || []) h({ topic: m.topic, data: deepFreeze(m.data), peer: m.peer, by: null, isMe: false, sameTab: false, kind: 'viewer', guest: false });
        }
      });
    };
    bc.addEventListener('message', onMsg);
    bc.postMessage({ room: name, kind: 'hello', peer: myPeer });
    window.addEventListener('pagehide', () => bc.postMessage({ room: name, kind: 'bye', peer: myPeer }));
    queueMicrotask(() => notify('joined', myPeer));

    return {
      name,
      presence(patch) {
        stats.presenceCalls++;
        if (left) return Promise.reject(err('invalid_argument', 'left'));
        const bk = badKey(patch || {});
        if (bk) { stats.rejected++; stats.lastError = bk; return Promise.reject(err('invalid_argument', bk)); }
        // como la plataforma real, se queda con el patch tal cual y lo congela
        deepFreeze(patch);
        const next = { ...mine };
        for (const [k, v] of Object.entries(patch || {})) { if (v === null) delete next[k]; else next[k] = v; }
        const size = enc.encode(JSON.stringify(next)).length;
        stats.maxBytes = Math.max(stats.maxBytes, size);
        if (size > 4096) { stats.rejected++; return Promise.reject(err('invalid_argument', `presence is ${size} bytes, limit 4096`)); }
        mine = next;
        dirty = true;
        notify('updated', myPeer);
        if (!timer) timer = setTimeout(flush, 33);
        return Promise.resolve();
      },
      peers() { return snapshot; },
      onPeers(h) { peerHandlers.add(h); queueMicrotask(() => notify('joined', myPeer)); return () => peerHandlers.delete(h); },
      emit(topic, data) {
        bc.postMessage({ room: name, kind: 'emit', peer: myPeer, topic, data });
        return Promise.resolve();
      },
      on(topic, h) {
        if (!topicHandlers.has(topic)) topicHandlers.set(topic, new Set());
        topicHandlers.get(topic).add(h);
        return () => topicHandlers.get(topic).delete(h);
      },
      connected() { return !left; },
      onConnection(h) { queueMicrotask(() => h(true)); return () => {}; },
      leave() {
        if (!left) { left = true; bc.postMessage({ room: name, kind: 'bye', peer: myPeer }); bc.removeEventListener('message', onMsg); }
        return Promise.resolve();
      },
    };
  }

  const lobby = makeRoom('');
  const named = new Map();
  const api = Object.freeze({
    ...lobby,
    join(name) {
      if (!/^[a-z0-9][a-z0-9_.-]{0,47}$/.test(name)) return Promise.reject(err('invalid_argument', 'bad name'));
      if (named.has(name)) return Promise.resolve(named.get(name).api);
      const r = makeRoom(name);
      const wrapped = Object.freeze({ ...r, leave() { named.delete(name); return r.leave(); } });
      named.set(name, { api: wrapped });
      return new Promise((res) => later(() => res(wrapped)));
    },
    sendToClaudeSession() { return Promise.reject(err('claude_unavailable', 'mock')); },
    canSendToClaudeSession() { return Promise.resolve('off'); },
  });
  window.claude = Object.freeze({ use: (n) => new Promise((res) => setTimeout(() => res(n === 'room' ? api : null), 300)) });
})();
