// Texturas procedurales (canvas) para no depender de archivos externos.
import * as THREE from 'three';
import { W, H, RIVER, BRIDGES, BASES, BUSHES } from '../../shared/map.js';
import { RULES } from '../../shared/constants.js';

export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Ruido de valor periódico (tileable) en escala de grises
export function noiseCanvas(size = 256, cells = 8, octaves = 4, seed = 7) {
  const r = rng(seed);
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const layers = [];
  for (let o = 0; o < octaves; o++) {
    const n = cells << o;
    const grid = new Float32Array(n * n);
    for (let i = 0; i < grid.length; i++) grid[i] = r();
    layers.push({ n, grid, amp: Math.pow(0.5, o) });
  }
  const smooth = (t) => t * t * (3 - 2 * t);
  let total = 0;
  for (const l of layers) total += l.amp;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (const l of layers) {
        const fx = (x / size) * l.n, fy = (y / size) * l.n;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = smooth(fx - x0), ty = smooth(fy - y0);
        const x1 = (x0 + 1) % l.n, y1 = (y0 + 1) % l.n;
        const a = l.grid[y0 * l.n + x0], b = l.grid[y0 * l.n + x1];
        const c2 = l.grid[y1 * l.n + x0], d = l.grid[y1 * l.n + x1];
        v += (a + (b - a) * tx + (c2 - a) * ty + (a - b - c2 + d) * tx * ty) * l.amp;
      }
      v /= total;
      const i = (y * size + x) * 4;
      const b8 = Math.max(0, Math.min(255, v * 255));
      img.data[i] = img.data[i + 1] = img.data[i + 2] = b8;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

let _noise = null;
function noise() {
  if (!_noise) _noise = noiseCanvas(256, 6, 5, 11);
  return _noise;
}

function overlayNoise(g, x, y, w, h, scale, alpha, op = 'overlay') {
  const pat = g.createPattern(noise(), 'repeat');
  g.save();
  g.globalAlpha = alpha;
  g.globalCompositeOperation = op;
  g.translate(x, y);
  g.scale(scale, scale);
  g.fillStyle = pat;
  g.fillRect(0, 0, w / scale, h / scale);
  g.restore();
}

function finish(c, repeat = false, aniso = 4) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ------------------------------------------------------------------ suelo de la arena
export function groundTexture(pxPerM = 32, aniso = 8) {
  const PW = W * pxPerM, PH = H * pxPerM;
  const c = canvas(PW, PH);
  const g = c.getContext('2d');
  const r = rng(42);
  const m = (v) => v * pxPerM;

  // --- Laboratorio (izquierda)
  const labW = m(RIVER.x0);
  g.fillStyle = '#8d9096';
  g.fillRect(0, 0, labW, PH);
  // baldosas de 2 m con variación
  const tile = m(2);
  for (let ty = 0; ty < PH; ty += tile) {
    for (let tx = 0; tx < labW; tx += tile) {
      const v = 128 + (r() - 0.5) * 22;
      g.fillStyle = `rgb(${v + 6},${v + 8},${v + 12})`;
      g.fillRect(tx + 1, ty + 1, tile - 2, tile - 2);
      // remaches
      g.fillStyle = 'rgba(40,40,45,0.5)';
      for (const [ax, ay] of [[0.12, 0.12], [0.88, 0.12], [0.12, 0.88], [0.88, 0.88]]) {
        g.beginPath(); g.arc(tx + tile * ax, ty + tile * ay, m(0.04), 0, 7); g.fill();
      }
    }
  }
  // juntas
  g.strokeStyle = 'rgba(30,32,38,0.55)';
  g.lineWidth = Math.max(1, m(0.05));
  for (let x = 0; x <= labW; x += tile) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, PH); g.stroke(); }
  for (let y = 0; y <= PH; y += tile) { g.beginPath(); g.moveTo(0, y); g.lineTo(labW, y); g.stroke(); }
  overlayNoise(g, 0, 0, labW, PH, pxPerM / 12, 0.45, 'multiply');
  // manchas de aceite / suero
  for (let i = 0; i < 40; i++) {
    const x = r() * labW, y = r() * PH, rad = m(0.3 + r() * 1.2);
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    const purple = r() < 0.25;
    gr.addColorStop(0, purple ? 'rgba(110,40,150,0.35)' : 'rgba(25,25,30,0.35)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.beginPath(); g.ellipse(x, y, rad, rad * (0.5 + r() * 0.5), r() * 3, 0, 7); g.fill();
  }
  // pasillos amarillos
  g.strokeStyle = 'rgba(255,200,40,0.85)';
  g.lineWidth = m(0.14);
  g.setLineDash([m(1), m(0.6)]);
  g.beginPath(); g.moveTo(m(11.5), m(18)); g.lineTo(m(29.5), m(18)); g.stroke();
  g.beginPath(); g.moveTo(m(3), m(6)); g.lineTo(m(29.5), m(6)); g.stroke();
  g.beginPath(); g.moveTo(m(3), m(30)); g.lineTo(m(29.5), m(30)); g.stroke();
  g.setLineDash([]);

  // --- Selva (derecha)
  const jx = m(RIVER.x1);
  g.fillStyle = '#4f7a2a';
  g.fillRect(jx, 0, PW - jx, PH);
  overlayNoise(g, jx, 0, PW - jx, PH, pxPerM / 6, 0.55, 'overlay');
  overlayNoise(g, jx, 0, PW - jx, PH, pxPerM / 20, 0.35, 'multiply');
  // parches de tierra
  for (let i = 0; i < 26; i++) {
    const x = jx + r() * (PW - jx), y = r() * PH, rad = m(0.8 + r() * 2.2);
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(120,90,50,0.55)');
    gr.addColorStop(1, 'rgba(120,90,50,0)');
    g.fillStyle = gr;
    g.beginPath(); g.ellipse(x, y, rad, rad * 0.7, r() * 3, 0, 7); g.fill();
  }
  // briznas de pasto
  const blades = Math.round((PW - jx) * PH / 70);
  for (let i = 0; i < blades; i++) {
    const x = jx + r() * (PW - jx), y = r() * PH;
    const l = m(0.06 + r() * 0.14);
    const a = -Math.PI / 2 + (r() - 0.5) * 1.2;
    const gv = 90 + r() * 90;
    g.strokeStyle = `rgba(${gv * 0.45 | 0},${gv | 0},${gv * 0.25 | 0},${0.35 + r() * 0.4})`;
    g.lineWidth = Math.max(1, m(0.015));
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  // hojas caídas
  for (let i = 0; i < 260; i++) {
    const x = jx + r() * (PW - jx), y = r() * PH;
    g.fillStyle = `rgba(${150 + r() * 80 | 0},${110 + r() * 60 | 0},${30 + r() * 30 | 0},0.6)`;
    g.save(); g.translate(x, y); g.rotate(r() * 6);
    g.beginPath(); g.ellipse(0, 0, m(0.09), m(0.04), 0, 0, 7); g.fill(); g.restore();
  }
  // plaza de piedra del templo (base Macaca)
  const tb = BASES[1].flag;
  stonePlaza(g, m(tb.x - 7), m(tb.y - 8), m(7.5), m(16), m, r);

  // --- Orillas y río
  const bank = (x0, x1, flip) => {
    const gr = g.createLinearGradient(m(x0), 0, m(x1), 0);
    gr.addColorStop(flip ? 1 : 0, 'rgba(160,135,90,0)');
    gr.addColorStop(flip ? 0 : 1, 'rgba(160,135,90,0.95)');
    g.fillStyle = gr;
    g.fillRect(m(x0), 0, m(x1 - x0), PH);
  };
  bank(RIVER.x0 - 1.2, RIVER.x0, false);
  bank(RIVER.x1, RIVER.x1 + 1.2, true);
  const riverGr = g.createLinearGradient(m(RIVER.x0), 0, m(RIVER.x1), 0);
  riverGr.addColorStop(0, '#6f7f55');
  riverGr.addColorStop(0.5, '#1d4a52');
  riverGr.addColorStop(1, '#6f7f55');
  g.fillStyle = riverGr;
  g.fillRect(m(RIVER.x0), 0, m(RIVER.x1 - RIVER.x0), PH);
  overlayNoise(g, m(RIVER.x0), 0, m(RIVER.x1 - RIVER.x0), PH, pxPerM / 10, 0.5, 'overlay');
  // piedritas en las orillas
  for (let i = 0; i < 300; i++) {
    const side = r() < 0.5;
    const x = side ? m(RIVER.x0 - r() * 1.2) : m(RIVER.x1 + r() * 1.2);
    const y = r() * PH;
    const v = 120 + r() * 80;
    g.fillStyle = `rgb(${v},${v * 0.95 | 0},${v * 0.85 | 0})`;
    g.beginPath(); g.ellipse(x, y, m(0.05 + r() * 0.08), m(0.04 + r() * 0.06), r() * 3, 0, 7); g.fill();
  }

  // --- Bases: zona protegida, círculo de captura y jaula
  for (const b of BASES) {
    const col = b.team === 0 ? '255,201,40' : '61,220,132';
    const fx = m(b.flag.x), fy = m(b.flag.y);
    // zona protegida (franjas)
    g.save();
    g.beginPath(); g.arc(fx, fy, m(RULES.flagZone), 0, 7); g.clip();
    g.fillStyle = `rgba(${col},0.12)`;
    g.fillRect(fx - m(5), fy - m(5), m(10), m(10));
    g.strokeStyle = `rgba(${col},0.18)`;
    g.lineWidth = m(0.25);
    for (let k = -12; k < 12; k++) {
      g.beginPath(); g.moveTo(fx + m(k * 0.7) - m(5), fy - m(5)); g.lineTo(fx + m(k * 0.7) + m(5), fy + m(5)); g.stroke();
    }
    g.restore();
    g.strokeStyle = `rgba(${col},0.9)`;
    g.lineWidth = m(0.12);
    g.setLineDash([m(0.5), m(0.3)]);
    g.beginPath(); g.arc(fx, fy, m(RULES.flagZone), 0, 7); g.stroke();
    g.setLineDash([]);
    g.lineWidth = m(0.18);
    g.strokeStyle = `rgba(${col},1)`;
    g.beginPath(); g.arc(fx, fy, m(RULES.baseRadius), 0, 7); g.stroke();
    // jaula
    const jx2 = m(b.jail.x), jy2 = m(b.jail.y);
    g.fillStyle = b.team === 0 ? 'rgba(40,40,46,0.9)' : 'rgba(80,60,36,0.9)';
    g.beginPath(); g.arc(jx2, jy2, m(RULES.jailRadius + 0.2), 0, 7); g.fill();
    g.strokeStyle = 'rgba(255,60,60,0.85)';
    g.lineWidth = m(0.12);
    g.setLineDash([m(0.35), m(0.25)]);
    g.beginPath(); g.arc(jx2, jy2, m(RULES.jailRadius + 0.45), 0, 7); g.stroke();
    g.setLineDash([]);
    // rejilla
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = Math.max(1, m(0.03));
    for (let k = -2.2; k <= 2.2; k += 0.4) {
      g.beginPath(); g.moveTo(jx2 + m(k), jy2 - m(2.2)); g.lineTo(jx2 + m(k), jy2 + m(2.2)); g.stroke();
      g.beginPath(); g.moveTo(jx2 - m(2.2), jy2 + m(k)); g.lineTo(jx2 + m(2.2), jy2 + m(k)); g.stroke();
    }
  }

  // sombra suave bajo arbustos
  for (const bu of BUSHES) {
    const x = m(bu.x), y = m(bu.y), rad = m(bu.r * 1.15);
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(10,30,5,0.5)');
    gr.addColorStop(1, 'rgba(10,30,5,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
  }
  void BRIDGES;
  return finish(c, false, aniso);
}

function stonePlaza(g, x, y, w, h, m, r) {
  const s = m(1.1);
  for (let ty = y; ty < y + h; ty += s) {
    for (let tx = x; tx < x + w; tx += s) {
      if (r() < 0.12) continue; // baldosas faltantes (pasto)
      const v = 120 + r() * 40;
      g.fillStyle = `rgb(${v},${v * 0.97 | 0},${v * 0.88 | 0})`;
      g.fillRect(tx + 2, ty + 2, s - 4, s - 4);
      if (r() < 0.4) {
        g.fillStyle = 'rgba(70,110,40,0.45)'; // musgo
        g.beginPath(); g.ellipse(tx + r() * s, ty + r() * s, s * 0.3, s * 0.2, r() * 3, 0, 7); g.fill();
      }
    }
  }
  overlayNoise(g, x, y, w, h, 1.5, 0.3, 'multiply');
}

// Suelo exterior (fuera de la arena), repetible
export function outerTexture(kind) {
  const c = canvas(256, 256);
  const g = c.getContext('2d');
  const r = rng(kind === 'lab' ? 3 : 4);
  if (kind === 'lab') {
    g.fillStyle = '#6c6f74'; g.fillRect(0, 0, 256, 256);
    overlayNoise(g, 0, 0, 256, 256, 1, 0.5, 'multiply');
    g.strokeStyle = 'rgba(30,30,35,0.4)'; g.lineWidth = 2;
    for (let i = 0; i <= 256; i += 64) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke();
    }
  } else {
    g.fillStyle = '#3f6a22'; g.fillRect(0, 0, 256, 256);
    overlayNoise(g, 0, 0, 256, 256, 1, 0.6, 'overlay');
    for (let i = 0; i < 2500; i++) {
      const x = r() * 256, y = r() * 256;
      const gv = 70 + r() * 90;
      g.strokeStyle = `rgba(${gv * 0.4 | 0},${gv | 0},${gv * 0.2 | 0},0.5)`;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 3, y - 3 - r() * 3); g.stroke();
    }
  }
  return finish(c, true);
}

// ------------------------------------------------------------------ materiales de objetos
export function woodTexture() {
  const c = canvas(128, 128);
  const g = c.getContext('2d');
  const r = rng(5);
  g.fillStyle = '#a2713c'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 128; i += 16) {
    g.fillStyle = `rgb(${150 + r() * 30 | 0},${100 + r() * 20 | 0},${50 + r() * 15 | 0})`;
    g.fillRect(0, i + 1, 128, 14);
    g.strokeStyle = 'rgba(70,40,15,0.35)';
    for (let k = 0; k < 4; k++) {
      g.beginPath(); g.moveTo(0, i + 3 + r() * 10);
      g.bezierCurveTo(40, i + r() * 14, 80, i + r() * 14, 128, i + 3 + r() * 10); g.stroke();
    }
  }
  g.strokeStyle = '#5a3615'; g.lineWidth = 10; g.strokeRect(5, 5, 118, 118);
  g.lineWidth = 7;
  g.beginPath(); g.moveTo(8, 8); g.lineTo(120, 120); g.stroke();
  overlayNoise(g, 0, 0, 128, 128, 0.5, 0.3, 'multiply');
  return finish(c, true);
}

export function metalTexture(stripe = true) {
  const c = canvas(128, 128);
  const g = c.getContext('2d');
  const r = rng(9);
  g.fillStyle = '#9aa0a8'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 400; i++) {
    g.strokeStyle = `rgba(255,255,255,${r() * 0.08})`;
    const y = r() * 128;
    g.beginPath(); g.moveTo(0, y); g.lineTo(128, y + (r() - 0.5) * 2); g.stroke();
  }
  if (stripe) {
    for (let i = -128; i < 256; i += 24) {
      g.fillStyle = '#f2c230';
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 12, 0); g.lineTo(i + 12 - 20, 20); g.lineTo(i - 20, 20); g.fill();
      g.fillStyle = '#222';
      g.beginPath(); g.moveTo(i + 12, 0); g.lineTo(i + 24, 0); g.lineTo(i + 4, 20); g.lineTo(i - 8, 20); g.fill();
    }
  }
  overlayNoise(g, 0, 0, 128, 128, 0.5, 0.35, 'multiply');
  return finish(c, true);
}

export function stoneTexture() {
  const c = canvas(128, 128);
  const g = c.getContext('2d');
  const r = rng(13);
  g.fillStyle = '#8f8a7c'; g.fillRect(0, 0, 128, 128);
  for (let row = 0; row < 4; row++) {
    const off = row % 2 ? 16 : 0;
    for (let col = -1; col < 4; col++) {
      const v = 130 + r() * 40;
      g.fillStyle = `rgb(${v},${v * 0.96 | 0},${v * 0.86 | 0})`;
      g.fillRect(col * 32 + off + 2, row * 32 + 2, 28, 28);
    }
  }
  overlayNoise(g, 0, 0, 128, 128, 0.5, 0.45, 'multiply');
  // musgo
  for (let i = 0; i < 18; i++) {
    g.fillStyle = `rgba(${60 + r() * 30 | 0},${110 + r() * 40 | 0},${30 | 0},0.5)`;
    g.beginPath(); g.ellipse(r() * 128, r() * 40, 8 + r() * 14, 4 + r() * 8, 0, 0, 7); g.fill();
  }
  return finish(c, true);
}

export function furTexture(base = [122, 78, 40]) {
  const c = canvas(128, 128);
  const g = c.getContext('2d');
  const r = rng(21);
  g.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 3000; i++) {
    const x = r() * 128, y = r() * 128;
    const k = 0.6 + r() * 0.8;
    g.strokeStyle = `rgba(${base[0] * k | 0},${base[1] * k | 0},${base[2] * k | 0},0.6)`;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 2, y + 3 + r() * 3); g.stroke();
  }
  return finish(c, true);
}

// Piel: textura neutra (gris claro) que se tiñe con el color del material
export function furDetail() {
  const c = canvas(128, 128);
  const g = c.getContext('2d');
  const r = rng(23);
  g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 3500; i++) {
    const x = r() * 128, y = r() * 128;
    const v = 150 + r() * 105;
    g.strokeStyle = `rgba(${v | 0},${v | 0},${v | 0},0.7)`;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 2.5, y + 2 + r() * 4); g.stroke();
  }
  return finish(c, true);
}

export function denimTexture() {
  const c = canvas(64, 64);
  const g = c.getContext('2d');
  const r = rng(31);
  g.fillStyle = '#3566b8'; g.fillRect(0, 0, 64, 64);
  for (let i = -64; i < 128; i += 3) {
    g.strokeStyle = `rgba(20,40,90,${0.2 + r() * 0.2})`;
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 64); g.stroke();
  }
  for (let i = 0; i < 300; i++) {
    g.fillStyle = `rgba(255,255,255,${r() * 0.12})`;
    g.fillRect(r() * 64, r() * 64, 1, 1);
  }
  return finish(c, true);
}

// Normal map de agua a partir de ruido
export function waterNormal() {
  const size = 256;
  const n = noiseCanvas(size, 8, 3, 77);
  const src = n.getContext('2d').getImageData(0, 0, size, size).data;
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const h = (x, y) => src[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * 3;
      const dy = (h(x, y + 1) - h(x, y - 1)) * 3;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((-dx / l) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((-dy / l) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ------------------------------------------------------------------ sprites
export function softSprite() {
  const c = canvas(64, 64);
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function puffSprite() {
  const c = canvas(64, 64);
  const g = c.getContext('2d');
  const r = rng(55);
  for (let i = 0; i < 9; i++) {
    const x = 18 + r() * 28, y = 18 + r() * 28, rad = 10 + r() * 12;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
  }
  return new THREE.CanvasTexture(c);
}

export function starSprite() {
  const c = canvas(64, 64);
  const g = c.getContext('2d');
  g.translate(32, 32);
  g.fillStyle = '#fff';
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rad = i % 2 ? 11 : 28;
    g.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  g.fill();
  return new THREE.CanvasTexture(c);
}

export function ringSprite() {
  const c = canvas(128, 128);
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 40, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,0)');
  gr.addColorStop(0.75, 'rgba(255,255,255,1)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// Emblemas de bandera
export function flagTexture(team) {
  const c = canvas(256, 160);
  const g = c.getContext('2d');
  if (team === 0) {
    g.fillStyle = '#ffc928'; g.fillRect(0, 0, 256, 160);
    g.fillStyle = '#2b5aa8'; g.fillRect(0, 118, 256, 42);
    // gafas
    g.fillStyle = '#333'; g.fillRect(20, 62, 216, 22);
    g.fillStyle = '#c9ccd2'; g.beginPath(); g.arc(128, 72, 44, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(128, 72, 34, 0, 7); g.fill();
    g.fillStyle = '#7a4a1e'; g.beginPath(); g.arc(128, 74, 16, 0, 7); g.fill();
    g.fillStyle = '#111'; g.beginPath(); g.arc(128, 74, 8, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(122, 68, 4, 0, 7); g.fill();
  } else {
    g.fillStyle = '#2f9e5a'; g.fillRect(0, 0, 256, 160);
    g.fillStyle = '#1f6b3c';
    for (let i = 0; i < 6; i++) { g.beginPath(); g.ellipse(30 + i * 42, 150, 30, 16, 0.4, 0, 7); g.fill(); }
    // cara de mono
    g.fillStyle = '#6b3d1e'; g.beginPath(); g.arc(128, 74, 48, 0, 7); g.fill();
    g.beginPath(); g.arc(78, 70, 18, 0, 7); g.fill(); g.beginPath(); g.arc(178, 70, 18, 0, 7); g.fill();
    g.fillStyle = '#e3bd8f';
    g.beginPath(); g.ellipse(128, 86, 34, 28, 0, 0, 7); g.fill();
    g.beginPath(); g.arc(112, 62, 14, 0, 7); g.fill(); g.beginPath(); g.arc(144, 62, 14, 0, 7); g.fill();
    g.fillStyle = '#111';
    g.beginPath(); g.arc(112, 63, 6, 0, 7); g.fill(); g.beginPath(); g.arc(144, 63, 6, 0, 7); g.fill();
    g.strokeStyle = '#4a2a10'; g.lineWidth = 4;
    g.beginPath(); g.arc(128, 92, 14, 0.2, Math.PI - 0.2); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function labelTexture(text, color = '#fff', bg = 'rgba(0,0,0,0.6)') {
  const c = canvas(256, 64);
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.beginPath(); g.roundRect(4, 8, 248, 48, 20); g.fill();
  g.fillStyle = color;
  g.font = 'bold 30px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 33);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
