// Mapa simétrico: izquierda = Laboratorio de los Papois, derecha = Selva de los Macacos.
// Se define la mitad izquierda y se refleja en X.

export const W = 64;
export const H = 36;
export const MID = W / 2;

export const RIVER = { x0: 30, x1: 34 };
export const BRIDGES = [
  { y0: 4, y1: 8 },
  { y0: 16, y1: 20 },
  { y0: 28, y1: 32 },
];

// Obstáculos de la mitad izquierda. kind sólo afecta lo visual.
const LEFT_RECTS = [
  // Muros de la base
  { x: 10, y: 10.5, w: 1.2, h: 4.5, kind: 'wall' },
  { x: 10, y: 21, w: 1.2, h: 4.5, kind: 'wall' },
  // Caja central frente a la base
  { x: 14, y: 17, w: 1.6, h: 2, kind: 'crate' },
  // Máquinas grandes
  { x: 16, y: 3.2, w: 4, h: 3, kind: 'machine' },
  { x: 16, y: 29.8, w: 4, h: 3, kind: 'machine' },
  // Coberturas medias
  { x: 21.5, y: 13.2, w: 2.2, h: 1.4, kind: 'crate' },
  { x: 21.5, y: 21.4, w: 2.2, h: 1.4, kind: 'crate' },
  { x: 25.6, y: 9.8, w: 1.5, h: 1.5, kind: 'crate' },
  { x: 25.6, y: 24.7, w: 1.5, h: 1.5, kind: 'crate' },
  { x: 25.2, y: 16.6, w: 1, h: 2.8, kind: 'wall' },
];

const LEFT_CIRCLES = [
  { x: 12.8, y: 6, r: 0.75, kind: 'barrel' },
  { x: 21.8, y: 8.6, r: 0.75, kind: 'barrel' },
  { x: 21.8, y: 27.4, r: 0.75, kind: 'barrel' },
  { x: 13, y: 26.4, r: 0.75, kind: 'barrel' },
  { x: 7.5, y: 12, r: 0.6, kind: 'barrel' },
  { x: 7.5, y: 24, r: 0.6, kind: 'barrel' },
];

const LEFT_BUSHES = [
  { x: 18.6, y: 11.4, r: 1.7 },
  { x: 18.6, y: 24.6, r: 1.7 },
  { x: 27.6, y: 13.4, r: 1.3 },
  { x: 27.6, y: 22.6, r: 1.3 },
  { x: 6, y: 4.4, r: 1.5 },
];

const RIGHT_KIND = { wall: 'ruin', crate: 'rock', machine: 'temple', barrel: 'tree' };

function mirrorRect(r) {
  return { x: W - r.x - r.w, y: r.y, w: r.w, h: r.h, kind: RIGHT_KIND[r.kind] || r.kind, side: 1 };
}
function mirrorCircle(c) {
  return { x: W - c.x, y: c.y, r: c.r, kind: RIGHT_KIND[c.kind] || c.kind, side: 1 };
}

export const RECTS = [
  ...LEFT_RECTS.map((r) => ({ ...r, side: 0 })),
  ...LEFT_RECTS.map(mirrorRect),
];
export const CIRCLES = [
  ...LEFT_CIRCLES.map((c) => ({ ...c, side: 0 })),
  ...LEFT_CIRCLES.map(mirrorCircle),
];
export const BUSHES = [
  ...LEFT_BUSHES.map((b) => ({ ...b, side: 0 })),
  ...LEFT_BUSHES.map((b) => ({ x: W - b.x, y: b.y, r: b.r, side: 1 })),
];

// Bases
export const BASES = [
  {
    team: 0,
    flag: { x: 5.5, y: 18 },
    jail: { x: 6.5, y: 30.5 }, // aquí van los Macacos atrapados
    spawns: [
      { x: 2.4, y: 15 }, { x: 2.4, y: 21 }, { x: 2.4, y: 18 },
      { x: 3.6, y: 13 }, { x: 3.6, y: 23 }, { x: 1.6, y: 11 }, { x: 1.6, y: 25 },
    ],
  },
  {
    team: 1,
    flag: { x: W - 5.5, y: 18 },
    jail: { x: W - 6.5, y: 30.5 },
    spawns: [
      { x: W - 2.4, y: 15 }, { x: W - 2.4, y: 21 }, { x: W - 2.4, y: 18 },
      { x: W - 3.6, y: 13 }, { x: W - 3.6, y: 23 }, { x: W - 1.6, y: 11 }, { x: W - 1.6, y: 25 },
    ],
  },
];

export const SERUM_SPOTS = [
  { x: 32, y: 18 },
  { x: 32, y: 6 },
  { x: 32, y: 30 },
  { x: 24, y: 1.8 },
  { x: 40, y: 34.2 },
  { x: 40, y: 1.8 },
  { x: 24, y: 34.2 },
];

export function inWater(x, y) {
  if (x < RIVER.x0 || x > RIVER.x1) return false;
  for (const b of BRIDGES) if (y >= b.y0 && y <= b.y1) return false;
  return true;
}

export function bushAt(x, y) {
  for (let i = 0; i < BUSHES.length; i++) {
    const b = BUSHES[i];
    const dx = x - b.x, dy = y - b.y;
    if (dx * dx + dy * dy < b.r * b.r) return i;
  }
  return -1;
}

// Territorio al que pertenece una posición (0 = Papois, 1 = Macacos)
export function territoryOf(x) {
  return x < MID ? 0 : 1;
}

// Empuja un círculo fuera de los obstáculos. Devuelve true si hubo colisión.
export function collideCircle(p, r) {
  let hit = false;
  for (let iter = 0; iter < 2; iter++) {
    for (const o of RECTS) {
      const cx = Math.max(o.x, Math.min(p.x, o.x + o.w));
      const cy = Math.max(o.y, Math.min(p.y, o.y + o.h));
      let dx = p.x - cx, dy = p.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < r * r) {
        hit = true;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          p.x = cx + (dx / d) * r;
          p.y = cy + (dy / d) * r;
        } else {
          // centro dentro del rectángulo: sacar por el lado más cercano
          const l = p.x - o.x, rr = o.x + o.w - p.x, t = p.y - o.y, b = o.y + o.h - p.y;
          const m = Math.min(l, rr, t, b);
          if (m === l) p.x = o.x - r;
          else if (m === rr) p.x = o.x + o.w + r;
          else if (m === t) p.y = o.y - r;
          else p.y = o.y + o.h + r;
        }
      }
    }
    for (const o of CIRCLES) {
      const dx = p.x - o.x, dy = p.y - o.y;
      const rr = r + o.r;
      const d2 = dx * dx + dy * dy;
      if (d2 < rr * rr) {
        hit = true;
        const d = Math.sqrt(d2) || 1e-4;
        p.x = o.x + (dx / d) * rr;
        p.y = o.y + (dy / d) * rr;
      }
    }
  }
  if (p.x < r) { p.x = r; hit = true; }
  if (p.x > W - r) { p.x = W - r; hit = true; }
  if (p.y < r) { p.y = r; hit = true; }
  if (p.y > H - r) { p.y = H - r; hit = true; }
  return hit;
}

// ¿Un punto está dentro de un obstáculo sólido (inflado por r)?
export function solidAt(x, y, r = 0) {
  if (x < r || y < r || x > W - r || y > H - r) return true;
  for (const o of RECTS) {
    if (x > o.x - r && x < o.x + o.w + r && y > o.y - r && y < o.y + o.h + r) {
      // esquinas redondeadas
      const cx = Math.max(o.x, Math.min(x, o.x + o.w));
      const cy = Math.max(o.y, Math.min(y, o.y + o.h));
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy < r * r || (dx === 0 && dy === 0)) return true;
    }
  }
  for (const o of CIRCLES) {
    const dx = x - o.x, dy = y - o.y, rr = o.r + r;
    if (dx * dx + dy * dy < rr * rr) return true;
  }
  return false;
}

// Línea de visión (los arbustos no bloquean)
export function lineOfSight(x0, y0, x1, y1, r = 0) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const steps = Math.ceil(len / 0.35);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (solidAt(x0 + dx * t, y0 + dy * t, r)) return false;
  }
  return true;
}
