// Grilla de navegación + A* para los bots.
import { W, H, solidAt, inWater, lineOfSight } from './map.js';
import { PLAYER } from './constants.js';

export const CELL = 0.5;
export const GW = Math.round(W / CELL);
export const GH = Math.round(H / CELL);

const blocked = new Uint8Array(GW * GH);
const water = new Uint8Array(GW * GH);
let built = false;

export function buildNav() {
  if (built) return;
  built = true;
  const r = PLAYER.radius + 0.08;
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const x = (gx + 0.5) * CELL, y = (gy + 0.5) * CELL;
      const i = gy * GW + gx;
      blocked[i] = solidAt(x, y, r) ? 1 : 0;
      water[i] = inWater(x, y) ? 1 : 0;
    }
  }
}

function cellOf(x, y) {
  const gx = Math.max(0, Math.min(GW - 1, Math.floor(x / CELL)));
  const gy = Math.max(0, Math.min(GH - 1, Math.floor(y / CELL)));
  return [gx, gy];
}

function nearestFree(gx, gy) {
  if (!blocked[gy * GW + gx]) return [gx, gy];
  for (let r = 1; r < 12; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = gx + dx, y = gy + dy;
        if (x < 0 || y < 0 || x >= GW || y >= GH) continue;
        if (!blocked[y * GW + x]) return [x, y];
      }
    }
  }
  return [gx, gy];
}

// Heap binario mínimo
class Heap {
  constructor() { this.a = []; this.f = []; }
  push(i, f) {
    const a = this.a, fa = this.f;
    a.push(i); fa.push(f);
    let n = a.length - 1;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (fa[p] <= fa[n]) break;
      [a[p], a[n]] = [a[n], a[p]];
      [fa[p], fa[n]] = [fa[n], fa[p]];
      n = p;
    }
  }
  pop() {
    const a = this.a, fa = this.f;
    const top = a[0];
    const li = a.pop(), lf = fa.pop();
    if (a.length) {
      a[0] = li; fa[0] = lf;
      let n = 0;
      for (;;) {
        const l = 2 * n + 1, r = l + 1;
        let m = n;
        if (l < a.length && fa[l] < fa[m]) m = l;
        if (r < a.length && fa[r] < fa[m]) m = r;
        if (m === n) break;
        [a[m], a[n]] = [a[n], a[m]];
        [fa[m], fa[n]] = [fa[n], fa[m]];
        n = m;
      }
    }
    return top;
  }
  get size() { return this.a.length; }
}

const gScore = new Float32Array(GW * GH);
const came = new Int32Array(GW * GH);
const stamp = new Uint32Array(GW * GH);
const closed = new Uint32Array(GW * GH);
const dangerCache = new Float32Array(GW * GH);
const dangerStamp = new Uint32Array(GW * GH);
let curStamp = 1;
export const navStats = { calls: 0, iters: 0, maxIters: 0 };

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

// danger(x, y) -> costo extra opcional
export function findPath(sx, sy, tx, ty, team, danger) {
  buildNav();
  let [ax, ay] = nearestFree(...cellOf(sx, sy));
  let [bx, by] = nearestFree(...cellOf(tx, ty));
  const start = ay * GW + ax, goal = by * GW + bx;
  if (start === goal) return [{ x: tx, y: ty }];
  curStamp++;
  const waterCost = team === 0 ? 2.6 : 1.4;
  const heap = new Heap();
  stamp[start] = curStamp;
  gScore[start] = 0;
  came[start] = -1;
  const h = (i) => {
    const x = i % GW, y = (i / GW) | 0;
    const dx = Math.abs(x - bx), dy = Math.abs(y - by);
    return (dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy));
  };
  heap.push(start, h(start));
  let found = false;
  let iter = 0;
  while (heap.size && iter++ < 6000) {
    const cur = heap.pop();
    if (cur === goal) { found = true; break; }
    if (closed[cur] === curStamp) continue;
    closed[cur] = curStamp;
    const cx = cur % GW, cy = (cur / GW) | 0;
    for (const [dx, dy, c] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const ni = ny * GW + nx;
      if (blocked[ni]) continue;
      if (dx && dy && (blocked[cy * GW + nx] || blocked[ny * GW + cx])) continue;
      let cost = c * (water[ni] ? waterCost : 1);
      if (danger) {
        if (dangerStamp[ni] !== curStamp) {
          dangerStamp[ni] = curStamp;
          dangerCache[ni] = danger((nx + 0.5) * CELL, (ny + 0.5) * CELL);
        }
        cost += dangerCache[ni] * c;
      }
      const g = gScore[cur] + cost;
      if (stamp[ni] !== curStamp || g < gScore[ni]) {
        stamp[ni] = curStamp;
        gScore[ni] = g;
        came[ni] = cur;
        heap.push(ni, g + h(ni));
      }
    }
  }
  navStats.calls++;
  navStats.iters += iter;
  navStats.maxIters = Math.max(navStats.maxIters, iter);
  if (!found) return [{ x: tx, y: ty }];
  const cells = [];
  for (let c = goal; c !== -1; c = came[c]) cells.push(c);
  cells.reverse();
  const pts = cells.map((c) => ({ x: (c % GW + 0.5) * CELL, y: (((c / GW) | 0) + 0.5) * CELL }));
  pts[pts.length - 1] = { x: tx, y: ty };
  // suavizado: saltar puntos con línea de visión (sin cruzar agua si el camino original no lo hacía)
  const wp = [0];
  for (let k = 0; k < pts.length; k++) wp.push(wp[k] + (inWater(pts[k].x, pts[k].y) ? 1 : 0));
  const out = [];
  let i = 0;
  const r = PLAYER.radius * 0.9;
  let from = { x: sx, y: sy };
  let fromIdx = 0;
  while (i < pts.length) {
    let j = Math.min(pts.length - 1, i + 24);
    while (j > i && !(lineOfSight(from.x, from.y, pts[j].x, pts[j].y, r) &&
      (wp[j + 1] - wp[fromIdx] > 0 || !segWater(from.x, from.y, pts[j].x, pts[j].y)))) j--;
    out.push(pts[j]);
    from = pts[j];
    fromIdx = j;
    i = j + 1;
  }
  return out;
}

function segWater(x0, y0, x1, y1) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.4);
  for (let k = 1; k < n; k++) if (inWater(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n)) return true;
  return false;
}

export function isBlocked(x, y) {
  buildNav();
  const [gx, gy] = cellOf(x, y);
  return !!blocked[gy * GW + gx];
}
