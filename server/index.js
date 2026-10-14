// Servidor: archivos estáticos + WebSocket con salas por código.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room, sanitizeName, sanitizeSkin } from '../shared/room.js';
import { TICK_RATE, LIMITS } from '../shared/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, '../public');
const PORT = +process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

const gzCache = new Map();

function serveStatic(req, res) {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/') url = '/index.html';
  const file = path.resolve(PUBLIC, '.' + url);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('No encontrado');
    }
    const ext = path.extname(file);
    const type = MIME[ext] || 'application/octet-stream';
    const headers = {
      'content-type': type,
      'cache-control': ext === '.png' ? 'public, max-age=86400' : 'no-cache',
    };
    const compressible = ['.html', '.js', '.css', '.json', '.svg', '.webmanifest'].includes(ext);
    if (compressible && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      const key = file + ':' + st.mtimeMs;
      let buf = gzCache.get(key);
      if (!buf) {
        buf = zlib.gzipSync(fs.readFileSync(file), { level: 9 });
        gzCache.set(key, buf);
      }
      headers['content-encoding'] = 'gzip';
      headers['content-length'] = buf.length;
      res.writeHead(200, headers);
      return res.end(buf);
    }
    headers['content-length'] = st.size;
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
}

const rooms = new Map();
const clients = new Map(); // id -> { ws, room, profile }
let clientSeq = 1;

function stats() {
  let playing = 0;
  for (const r of rooms.values()) playing += r.size;
  return { rooms: rooms.size, players: clients.size, inRooms: playing };
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, ...stats() }));
  }
  serveStatic(req, res);
});

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
    if (!rooms.has(c)) return c;
  }
}

// Envío con caché del snapshot serializado (se serializa una vez por tick)
let lastSnap = null, lastSnapStr = '';
function sendTo(clientId, msg, self) {
  const c = clients.get(clientId);
  if (!c || c.ws.readyState !== 1) return;
  if (self !== undefined) {
    if (c.ws.bufferedAmount > 256 * 1024) return; // cliente lento: saltar snapshot
    if (msg !== lastSnap) {
      lastSnap = msg;
      lastSnapStr = JSON.stringify(msg).slice(0, -1);
    }
    c.ws.send(lastSnapStr + ',"you":' + JSON.stringify(self) + '}');
  } else {
    c.ws.send(JSON.stringify(msg));
  }
}

function createRoom(isPublic, settings) {
  const code = newCode();
  const room = new Room(code, { isPublic, send: sendTo, settings });
  rooms.set(code, room);
  return room;
}

function leaveRoom(c) {
  if (!c.room) return;
  const room = c.room;
  c.room = null;
  room.leave(c.id);
  if (room.size === 0) rooms.delete(room.code);
}

function joinRoom(c, room, team) {
  leaveRoom(c);
  const res = room.join(c.id, { ...c.profile, team });
  if (res.error) {
    sendTo(c.id, { t: 'error', msg: res.error });
    if (room.size === 0) rooms.delete(room.code);
    return false;
  }
  c.room = room;
  return true;
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });

wss.on('connection', (ws) => {
  const id = 'c' + clientSeq++;
  const c = { id, ws, room: null, profile: { name: 'Jugador', skin: sanitizeSkin({}), level: 1 }, alive: true, msgs: 0 };
  clients.set(id, c);
  ws.on('pong', () => { c.alive = true; });

  ws.on('message', (data) => {
    c.msgs++;
    if (c.msgs > 150) return; // límite por segundo
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'hello':
        c.profile = {
          name: sanitizeName(msg.name),
          skin: sanitizeSkin(msg.skin),
          level: Math.max(1, Math.min(99, msg.level | 0 || 1)),
        };
        sendTo(id, { t: 'hi', id, server: stats() });
        if (c.room) c.room.message(id, { t: 'profile', ...c.profile });
        break;
      case 'create': {
        const room = createRoom(!!msg.public, msg.settings);
        joinRoom(c, room, msg.team);
        break;
      }
      case 'join': {
        const code = String(msg.code || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
        const room = rooms.get(code);
        if (!room) sendTo(id, { t: 'error', msg: `No existe la sala ${code || ''}`.trim() });
        else joinRoom(c, room, msg.team);
        break;
      }
      case 'quick': {
        let best = null;
        for (const r of rooms.values()) {
          if (!r.isPublic || r.size >= LIMITS.maxPlayers) continue;
          if (!best || r.size > best.size) best = r;
        }
        joinRoom(c, best || createRoom(true, {}), undefined);
        break;
      }
      case 'leave':
        leaveRoom(c);
        sendTo(id, { t: 'left' });
        break;
      default:
        if (c.room) c.room.message(id, msg);
    }
  });

  ws.on('close', () => {
    leaveRoom(c);
    clients.delete(id);
  });
  ws.on('error', () => {});
});

// Latido para detectar conexiones muertas + reinicio del límite de mensajes
setInterval(() => {
  for (const c of clients.values()) c.msgs = 0;
}, 1000);
setInterval(() => {
  for (const c of clients.values()) {
    if (!c.alive) { c.ws.terminate(); continue; }
    c.alive = false;
    try { c.ws.ping(); } catch { /* ignore */ }
  }
  // salas abandonadas
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (r.size === 0 || now - r.lastActive > 2 * 3600 * 1000) rooms.delete(code);
  }
}, 15000);

// Bucle de simulación a 30 Hz con corrección de deriva
const STEP = 1000 / TICK_RATE;
let acc = 0;
let last = performance.now();
setInterval(() => {
  const now = performance.now();
  acc += now - last;
  last = now;
  let n = 0;
  while (acc >= STEP && n < 4) {
    for (const r of rooms.values()) {
      try { r.tick(); } catch (e) { console.error('Error en sala', r.code, e); }
    }
    acc -= STEP;
    n++;
  }
  if (acc > STEP * 4) acc = 0;
}, 5);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🍌 Papois vs Macacos corriendo en http://localhost:${PORT}`);
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) console.log(`   En tu red WiFi: http://${n.address}:${PORT}`);
    }
  }
  console.log('');
});
