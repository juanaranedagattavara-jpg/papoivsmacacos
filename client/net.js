// Conexiones: online (WebSocket) y local (sala corriendo en el navegador, modo bots).
import { Room } from '../shared/room.js';
import { TICK_RATE } from '../shared/constants.js';

export class LocalConnection {
  constructor() {
    this.isLocal = true;
    this.handler = () => {};
    this.rtt = 0;
    this.paused = false;
    this.room = new Room('BOTS', {
      snapshotEvery: 1,
      send: (cid, msg, self) => this.deliver(self !== undefined ? { ...msg, you: self } : msg),
    });
    const STEP = 1000 / TICK_RATE;
    let acc = 0, last = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      acc += now - last;
      last = now;
      if (this.paused) { acc = 0; return; }
      let n = 0;
      while (acc >= STEP && n < 4) { this.room.tick(); acc -= STEP; n++; }
      if (acc > STEP * 4) acc = 0;
    }, 8);
  }

  onMessage(fn) { this.handler = fn; }

  deliver(msg) {
    // entrega asíncrona para imitar la red y evitar reentradas
    queueMicrotask(() => this.handler(msg));
  }

  // Simula el handshake del servidor
  hello(profile) {
    this.profile = profile;
    this.deliver({ t: 'hi', id: 'me' });
  }

  create(team, settings) {
    this.room.settings = { ...this.room.settings, ...settings };
    this.room.join('me', { ...this.profile, team });
  }

  send(msg) {
    if (!msg) return;
    if (msg.t === 'leave') { this.close(); return; }
    this.room.message('me', msg);
  }

  setPaused(p) { this.paused = p; }

  close() {
    clearInterval(this.timer);
    this.room.leave('me');
  }
}

export class NetConnection {
  constructor(url) {
    this.isLocal = false;
    this.handler = () => {};
    this.onClose = () => {};
    this.rtt = 0;
    this.queue = [];
    this.closed = false;
    this.ws = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = () => {
        for (const m of this.queue) this.ws.send(m);
        this.queue = [];
        resolve();
      };
      this.ws.onerror = () => reject(new Error('No se pudo conectar al servidor'));
    });
    this.ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.t === 'pong') {
        const r = performance.now() - msg.c;
        this.rtt = this.rtt ? this.rtt * 0.8 + r * 0.2 : r;
        return;
      }
      this.handler(msg);
    };
    this.ws.onclose = () => {
      clearInterval(this.pingTimer);
      if (!this.closed) this.onClose();
      this.closed = true;
    };
    this.pingTimer = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
  }

  onMessage(fn) { this.handler = fn; }

  send(msg) {
    const s = JSON.stringify(msg);
    if (this.ws.readyState === 1) this.ws.send(s);
    else if (this.ws.readyState === 0) this.queue.push(s);
  }

  setPaused() {}

  close() {
    this.closed = true;
    clearInterval(this.pingTimer);
    try { this.ws.close(); } catch { /* */ }
  }
}

export function serverUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

export function onlineAvailable() {
  return !window.PVM_STANDALONE && /^https?:$/.test(location.protocol);
}
