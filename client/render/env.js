// Escenario 3D: laboratorio (Papois) vs selva (Macacos), río, puentes, bases y jaulas.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { W, H, RIVER, BRIDGES, RECTS, CIRCLES, BUSHES, BASES } from '../../shared/map.js';
import { RULES } from '../../shared/constants.js';
import {
  groundTexture, outerTexture, woodTexture, metalTexture, stoneTexture, waterNormal, flagTexture, rng,
} from './textures.js';

// Acumula geometría estática por material y la fusiona
class Batch {
  constructor() { this.map = new Map(); }
  add(geo, mat, pos, rot = [0, 0, 0], scl = [1, 1, 1], opts = {}) {
    const g = geo.clone();
    g.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scl)));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const g2 = g.index ? g.toNonIndexed() : g;
    const key = mat.uuid + (opts.cast === false ? ':n' : ':c');
    if (!this.map.has(key)) this.map.set(key, { mat, list: [], cast: opts.cast !== false });
    this.map.get(key).list.push(g2);
  }
  build(parent, receive = true) {
    for (const { mat, list, cast } of this.map.values()) {
      const mesh = new THREE.Mesh(mergeGeometries(list, false), mat);
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      parent.add(mesh);
    }
  }
}

export function buildEnvironment(scene, quality) {
  const root = new THREE.Group();
  scene.add(root);
  const r = rng(99);
  const hi = quality >= 2;
  const ppm = quality >= 2 ? 32 : quality === 1 ? 24 : 16;

  // ---------------------------------------------------------------- suelo
  const groundTex = groundTexture(ppm, hi ? 8 : 4);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(W, H),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.92, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(W / 2, 0, H / 2);
  ground.receiveShadow = true;
  root.add(ground);

  // suelo exterior
  const outerLab = outerTexture('lab');
  outerLab.repeat.set(20, 30);
  const outerJungle = outerTexture('jungle');
  outerJungle.repeat.set(20, 30);
  const o1 = new THREE.Mesh(new THREE.PlaneGeometry(80, 120), new THREE.MeshStandardMaterial({ map: outerLab, roughness: 0.95 }));
  o1.rotation.x = -Math.PI / 2; o1.position.set(W / 2 - 40, -0.02, H / 2);
  o1.receiveShadow = true;
  const o2 = new THREE.Mesh(new THREE.PlaneGeometry(80, 120), new THREE.MeshStandardMaterial({ map: outerJungle, roughness: 1 }));
  o2.rotation.x = -Math.PI / 2; o2.position.set(W / 2 + 40, -0.02, H / 2);
  o2.receiveShadow = true;
  root.add(o1, o2);

  // ---------------------------------------------------------------- materiales
  const wood = woodTexture();
  const metalS = metalTexture(true);
  const metalP = metalTexture(false);
  const stone = stoneTexture();
  const M = {
    wood: new THREE.MeshStandardMaterial({ map: wood, roughness: 0.8 }),
    metal: new THREE.MeshStandardMaterial({ map: metalP, metalness: 0.75, roughness: 0.38, color: 0xb8bec8 }),
    hazard: new THREE.MeshStandardMaterial({ map: metalS, metalness: 0.5, roughness: 0.45 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x3b4048, metalness: 0.8, roughness: 0.35 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0xa3a5a8, roughness: 0.95, map: metalP }),
    yellowPaint: new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.5, metalness: 0.2 }),
    purpleGlow: new THREE.MeshStandardMaterial({ color: 0x9a3cff, emissive: 0x7a1fff, emissiveIntensity: 1.6, roughness: 0.3 }),
    greenGlow: new THREE.MeshStandardMaterial({ color: 0x5cff8a, emissive: 0x22dd66, emissiveIntensity: 1.3, roughness: 0.3 }),
    screen: new THREE.MeshStandardMaterial({ color: 0x0b2a3a, emissive: 0x29b6f6, emissiveIntensity: 0.9, roughness: 0.2 }),
    barrelBody: new THREE.MeshStandardMaterial({ color: 0x6b2fa0, metalness: 0.6, roughness: 0.35 }),
    stone: new THREE.MeshStandardMaterial({ map: stone, roughness: 0.95 }),
    rock: new THREE.MeshStandardMaterial({ color: 0x7d776d, roughness: 0.95, flatShading: true }),
    moss: new THREE.MeshStandardMaterial({ color: 0x4f8a2b, roughness: 1 }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x7a5533, roughness: 1 }),
    palm: new THREE.MeshStandardMaterial({ color: 0x3f9a35, roughness: 0.8, side: THREE.DoubleSide }),
    palmDark: new THREE.MeshStandardMaterial({ color: 0x2c7a2c, roughness: 0.85, side: THREE.DoubleSide }),
    bush: new THREE.MeshStandardMaterial({ color: 0x3b8a2e, roughness: 0.9, flatShading: true }),
    bushLab: new THREE.MeshStandardMaterial({ color: 0x5a9b3a, roughness: 0.9, flatShading: true }),
    planter: new THREE.MeshStandardMaterial({ color: 0x5b6068, metalness: 0.5, roughness: 0.5 }),
    plank: new THREE.MeshStandardMaterial({ map: wood, roughness: 0.85, color: 0xd8b98f }),
    rope: new THREE.MeshStandardMaterial({ color: 0xc9a96e, roughness: 1 }),
    bamboo: new THREE.MeshStandardMaterial({ color: 0xc8b26a, roughness: 0.7 }),
    cageMetal: new THREE.MeshStandardMaterial({ color: 0x2f3338, metalness: 0.9, roughness: 0.3 }),
    pole: new THREE.MeshStandardMaterial({ color: 0xdfe3ea, metalness: 0.9, roughness: 0.2 }),
    banana: new THREE.MeshStandardMaterial({ color: 0xffd93b, roughness: 0.5 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xffc83d, metalness: 1, roughness: 0.25 }),
    mountain: new THREE.MeshStandardMaterial({ color: 0x5f7f4a, roughness: 1, flatShading: true }),
    building: new THREE.MeshStandardMaterial({ color: 0x8c9199, metalness: 0.4, roughness: 0.6 }),
    window: new THREE.MeshStandardMaterial({ color: 0x1b2a3a, emissive: 0xffd36a, emissiveIntensity: 0.35, roughness: 0.2 }),
    line: new THREE.MeshBasicMaterial({ color: 0xffffff }),
  };

  const B = new Batch();
  const Bn = new Batch(); // sin sombra propia (decoración)

  // ---------------------------------------------------------------- obstáculos
  for (const o of RECTS) {
    const cx = o.x + o.w / 2, cz = o.y + o.h / 2;
    switch (o.kind) {
      case 'wall': {
        B.add(new THREE.BoxGeometry(o.w, 1.6, o.h), M.concrete, [cx, 0.8, cz]);
        B.add(new THREE.BoxGeometry(o.w + 0.06, 0.25, o.h + 0.06), M.hazard, [cx, 1.55, cz]);
        break;
      }
      case 'crate': {
        const n = Math.max(1, Math.round((o.w * o.h) / 2.2));
        if (n === 1) {
          const s = Math.min(o.w, o.h);
          B.add(new THREE.BoxGeometry(o.w, s * 0.9, o.h), M.wood, [cx, s * 0.45, cz]);
        } else {
          // pila de cajas
          const horiz = o.w >= o.h;
          const cnt = Math.round((horiz ? o.w : o.h) / Math.min(o.w, o.h));
          const s = Math.min(o.w, o.h);
          for (let i = 0; i < cnt; i++) {
            const px = horiz ? o.x + s * (i + 0.5) * (o.w / (s * cnt)) : cx;
            const pz = horiz ? cz : o.y + s * (i + 0.5) * (o.h / (s * cnt));
            const hgt = s * (0.85 + r() * 0.15);
            B.add(new THREE.BoxGeometry(horiz ? o.w / cnt : o.w, hgt, horiz ? o.h : o.h / cnt), M.wood, [px, hgt / 2, pz], [0, (r() - 0.5) * 0.08, 0]);
            if (r() < 0.5) B.add(new THREE.BoxGeometry(s * 0.7, s * 0.6, s * 0.7), M.wood, [px, hgt + s * 0.3, pz], [0, r() * 0.6, 0]);
          }
        }
        break;
      }
      case 'machine': {
        B.add(new THREE.BoxGeometry(o.w, 1.3, o.h), M.darkMetal, [cx, 0.65, cz]);
        B.add(new THREE.BoxGeometry(o.w * 0.96, 0.18, o.h * 0.96), M.hazard, [cx, 1.38, cz]);
        // tanques de suero
        for (let i = 0; i < 2; i++) {
          const tx = o.x + o.w * (0.28 + i * 0.44);
          B.add(new THREE.CylinderGeometry(0.55, 0.55, 1.5, 18), M.metal, [tx, 2.15, cz]);
          Bn.add(new THREE.CylinderGeometry(0.42, 0.42, 1.0, 18), M.purpleGlow, [tx, 2.15, cz + 0.16], [0, 0, 0], [1, 1, 0.75], { cast: false });
          B.add(new THREE.SphereGeometry(0.55, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.metal, [tx, 2.9, cz]);
        }
        // pantalla y tubos
        Bn.add(new THREE.BoxGeometry(o.w * 0.5, 0.5, 0.05), M.screen, [cx, 0.85, o.y + o.h + 0.03], [0, 0, 0], [1, 1, 1], { cast: false });
        B.add(new THREE.TorusGeometry(0.6, 0.09, 8, 16, Math.PI), M.metal, [cx, 2.6, cz], [0, 0, 0]);
        break;
      }
      case 'ruin': {
        // muro de piedra irregular
        const rows = 3;
        for (let k = 0; k < rows; k++) {
          const hgt = 0.5;
          const shrink = k * 0.08;
          B.add(new THREE.BoxGeometry(o.w - shrink, hgt, o.h - shrink - r() * 0.2), M.stone, [cx + (r() - 0.5) * 0.06, hgt * (k + 0.5), cz], [0, (r() - 0.5) * 0.05, 0]);
        }
        Bn.add(new THREE.DodecahedronGeometry(0.5, 0), M.moss, [cx + (r() - 0.5) * 0.2, 1.52, cz + (r() - 0.5) * o.h * 0.3], [r(), r(), r()], [o.w * 0.7, 0.12, o.h * 0.45], { cast: false });
        break;
      }
      case 'rock': {
        const s = Math.max(o.w, o.h);
        B.add(new THREE.DodecahedronGeometry(0.5, 0), M.rock, [cx, s * 0.35, cz], [r(), r(), r()], [o.w * 1.05, s * 0.75, o.h * 1.05]);
        if (r() < 0.6) Bn.add(new THREE.DodecahedronGeometry(0.3, 0), M.moss, [cx, s * 0.62, cz], [r(), r(), r()], [o.w * 0.8, 0.25, o.h * 0.8], { cast: false });
        break;
      }
      case 'temple': {
        B.add(new THREE.BoxGeometry(o.w, 0.7, o.h), M.stone, [cx, 0.35, cz]);
        B.add(new THREE.BoxGeometry(o.w * 0.78, 0.6, o.h * 0.78), M.stone, [cx, 1.0, cz]);
        B.add(new THREE.BoxGeometry(o.w * 0.55, 0.55, o.h * 0.55), M.stone, [cx, 1.55, cz]);
        // ídolo de mono dorado
        B.add(new THREE.SphereGeometry(0.42, 16, 12), M.gold, [cx, 2.2, cz]);
        B.add(new THREE.CylinderGeometry(0.17, 0.17, 0.06, 12), M.gold, [cx - 0.42, 2.25, cz], [0, 0, Math.PI / 2]);
        B.add(new THREE.CylinderGeometry(0.17, 0.17, 0.06, 12), M.gold, [cx + 0.42, 2.25, cz], [0, 0, Math.PI / 2]);
        Bn.add(new THREE.SphereGeometry(0.07, 8, 6), M.greenGlow, [cx - 0.14, 2.28, cz + 0.37], [0, 0, 0], [1, 1, 1], { cast: false });
        Bn.add(new THREE.SphereGeometry(0.07, 8, 6), M.greenGlow, [cx + 0.14, 2.28, cz + 0.37], [0, 0, 0], [1, 1, 1], { cast: false });
        // lianas
        for (let i = 0; i < 6; i++) {
          Bn.add(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 4), M.moss, [o.x + r() * o.w, 0.9, o.y + (r() < 0.5 ? 0 : o.h)], [0, 0, (r() - 0.5) * 0.3], [1, 1, 1], { cast: false });
        }
        break;
      }
      default:
        B.add(new THREE.BoxGeometry(o.w, 1.2, o.h), M.concrete, [cx, 0.6, cz]);
    }
  }

  for (const c of CIRCLES) {
    if (c.kind === 'barrel') {
      B.add(new THREE.CylinderGeometry(c.r, c.r, 1.15, 20), M.barrelBody, [c.x, 0.575, c.y]);
      B.add(new THREE.TorusGeometry(c.r, 0.04, 6, 20), M.darkMetal, [c.x, 0.3, c.y], [Math.PI / 2, 0, 0]);
      B.add(new THREE.TorusGeometry(c.r, 0.04, 6, 20), M.darkMetal, [c.x, 0.85, c.y], [Math.PI / 2, 0, 0]);
      Bn.add(new THREE.CylinderGeometry(c.r * 0.85, c.r * 0.85, 0.04, 20), M.purpleGlow, [c.x, 1.16, c.y], [0, 0, 0], [1, 1, 1], { cast: false });
      Bn.add(new THREE.BoxGeometry(c.r * 0.9, 0.25, 0.02), M.yellowPaint, [c.x, 0.6, c.y + c.r + 0.005], [0, 0, 0], [1, 1, 1], { cast: false });
    } else if (c.kind === 'tree') {
      palmTree(B, Bn, M, c.x, c.y, c.r, r);
    }
  }

  // ---------------------------------------------------------------- arbustos
  const bushMeshes = [];
  for (const b of BUSHES) {
    const grp = new THREE.Group();
    const lab = b.side === 0;
    const mat = (lab ? M.bushLab : M.bush).clone();
    mat.transparent = true;
    const parts = [];
    const n = Math.round(6 + b.r * 4);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r();
      const d = b.r * (0.25 + r() * 0.55);
      const s = b.r * (0.42 + r() * 0.3);
      const geo = new THREE.IcosahedronGeometry(1, 1);
      geo.applyMatrix4(new THREE.Matrix4().compose(
        new THREE.Vector3(Math.cos(a) * d, s * 0.75, Math.sin(a) * d), new THREE.Quaternion(), new THREE.Vector3(s, s * 0.85, s)));
      parts.push(geo);
    }
    const top = new THREE.IcosahedronGeometry(1, 1);
    top.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(0, b.r * 0.85, 0), new THREE.Quaternion(), new THREE.Vector3(b.r * 0.6, b.r * 0.5, b.r * 0.6)));
    parts.push(top);
    const mesh = new THREE.Mesh(mergeGeometries(parts, false), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    grp.add(mesh);
    if (lab) {
      // jardinera metálica
      const planter = new THREE.Mesh(new THREE.CylinderGeometry(b.r * 1.02, b.r * 0.95, 0.35, 20, 1, true), M.planter);
      planter.position.y = 0.17;
      grp.add(planter);
    }
    grp.position.set(b.x, 0, b.y);
    root.add(grp);
    bushMeshes.push({ mesh, mat, bush: b });
  }

  // ---------------------------------------------------------------- río y puentes
  const wn = waterNormal();
  wn.repeat.set(2, 9);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(RIVER.x1 - RIVER.x0 + 0.6, H + 30),
    new THREE.MeshStandardMaterial({
      color: 0x2c8fb0, roughness: 0.08, metalness: 0.25, transparent: true, opacity: 0.82, normalMap: wn,
      normalScale: new THREE.Vector2(0.6, 0.6),
    }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set((RIVER.x0 + RIVER.x1) / 2, -0.12, H / 2);
  water.receiveShadow = true;
  root.add(water);
  // cauce más profundo que el suelo: recorte visual con bordes
  for (const bx of [RIVER.x0 - 0.3, RIVER.x1 + 0.3]) {
    Bn.add(new THREE.BoxGeometry(0.6, 0.12, H), M.rock, [bx, 0.0, H / 2], [0, 0, 0], [1, 1, 1], { cast: false });
  }
  for (const br of BRIDGES) {
    const zc = (br.y0 + br.y1) / 2, len = RIVER.x1 - RIVER.x0 + 2.4, wid = br.y1 - br.y0;
    const xc = (RIVER.x0 + RIVER.x1) / 2;
    const n = Math.round(len / 0.36);
    for (let i = 0; i < n; i++) {
      const x = xc - len / 2 + (i + 0.5) * (len / n);
      B.add(new THREE.BoxGeometry(len / n - 0.04, 0.08, wid + 0.2), M.plank, [x, 0.06, zc], [0, 0, (r() - 0.5) * 0.02], [1, 1, 1]);
    }
    for (const side of [-1, 1]) {
      const z = zc + side * (wid / 2 + 0.15);
      for (let i = 0; i <= 4; i++) {
        B.add(new THREE.CylinderGeometry(0.07, 0.08, 0.9, 8), M.trunk, [xc - len / 2 + (i / 4) * len, 0.4, z]);
      }
      Bn.add(new THREE.CylinderGeometry(0.03, 0.03, len, 6), M.rope, [xc, 0.75, z], [0, 0, Math.PI / 2], [1, 1, 1], { cast: false });
    }
    // línea de territorio en el puente
    Bn.add(new THREE.BoxGeometry(0.12, 0.02, wid + 0.2), M.line, [32, 0.105, zc], [0, 0, 0], [1, 1, 1], { cast: false });
  }

  // ---------------------------------------------------------------- bordes de la arena
  // lado laboratorio: muro metálico
  const fenceH = 1.1;
  B.add(new THREE.BoxGeometry(RIVER.x0 + 1, fenceH, 0.4), M.hazard, [(RIVER.x0 - 1) / 2, fenceH / 2, -0.2]);
  B.add(new THREE.BoxGeometry(RIVER.x0 + 1, fenceH, 0.4), M.hazard, [(RIVER.x0 - 1) / 2, fenceH / 2, H + 0.2]);
  B.add(new THREE.BoxGeometry(0.4, fenceH, H + 0.8), M.hazard, [-0.2, fenceH / 2, H / 2]);
  // lado selva: muro de piedra
  B.add(new THREE.BoxGeometry(W - RIVER.x1 + 1, fenceH, 0.5), M.stone, [(W + RIVER.x1 + 1) / 2, fenceH / 2, -0.25]);
  B.add(new THREE.BoxGeometry(W - RIVER.x1 + 1, fenceH, 0.5), M.stone, [(W + RIVER.x1 + 1) / 2, fenceH / 2, H + 0.25]);
  B.add(new THREE.BoxGeometry(0.5, fenceH, H + 1), M.stone, [W + 0.25, fenceH / 2, H / 2]);

  // ---------------------------------------------------------------- decoración exterior
  // laboratorio: edificios, silos y un cohete
  for (let i = 0; i < 9; i++) {
    const z = -8 + i * 6.5 + r() * 2;
    const x = -6 - r() * 10;
    const h = 3 + r() * 6;
    const w = 3 + r() * 3;
    B.add(new THREE.BoxGeometry(w, h, 4), M.building, [x, h / 2, z]);
    for (let k = 1; k < h / 1.4; k++) Bn.add(new THREE.BoxGeometry(w * 0.8, 0.35, 0.05), M.window, [x, k * 1.4, z + 2.03], [0, 0, 0], [1, 1, 1], { cast: false });
  }
  for (const [x, z] of [[4, -5], [12, -6], [20, -5], [4, H + 5], [13, H + 6], [22, H + 5]]) {
    B.add(new THREE.CylinderGeometry(1.4, 1.4, 4.5, 20), M.metal, [x, 2.25, z]);
    B.add(new THREE.SphereGeometry(1.4, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.metal, [x, 4.5, z]);
    Bn.add(new THREE.CylinderGeometry(1.42, 1.42, 0.4, 20), M.yellowPaint, [x, 3.2, z], [0, 0, 0], [1, 1, 1], { cast: false });
  }
  // cohete
  B.add(new THREE.CylinderGeometry(1.2, 1.4, 10, 20), M.metal, [-12, 5, H / 2]);
  B.add(new THREE.ConeGeometry(1.2, 3, 20), M.yellowPaint, [-12, 11.5, H / 2]);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    B.add(new THREE.BoxGeometry(0.2, 2.5, 1.5), M.yellowPaint, [-12 + Math.cos(a) * 1.4, 1.4, H / 2 + Math.sin(a) * 1.4], [0, -a, 0]);
  }
  // selva: palmeras densas y montañas
  for (let i = 0; i < 70; i++) {
    let x, z;
    const side = r();
    if (side < 0.35) { x = W + 1.5 + r() * 14; z = -6 + r() * (H + 12); }
    else if (side < 0.67) { x = RIVER.x1 + r() * (W - RIVER.x1 + 10); z = -1.5 - r() * 9; }
    else { x = RIVER.x1 + r() * (W - RIVER.x1 + 10); z = H + 1.5 + r() * 9; }
    palmTree(B, Bn, M, x, z, 0.35 + r() * 0.3, r, false);
  }
  for (let i = 0; i < 40; i++) {
    const side = r() < 0.5;
    const x = RIVER.x1 + 2 + r() * 40;
    const z = side ? -3 - r() * 6 : H + 3 + r() * 6;
    const s = 0.8 + r() * 1.4;
    Bn.add(new THREE.IcosahedronGeometry(s, 1), M.bush, [x, s * 0.6, z], [r(), r(), r()], [1, 0.8, 1], { cast: false });
  }
  for (let i = 0; i < 7; i++) {
    const h = 10 + r() * 14;
    Bn.add(new THREE.ConeGeometry(9 + r() * 6, h, 7), M.mountain, [W + 28 + r() * 10, h / 2 - 1, -10 + i * 9], [0, r() * 3, 0], [1, 1, 1], { cast: false });
  }
  // río fuera de la arena
  for (const z of [-6, H + 6]) {
    Bn.add(new THREE.BoxGeometry(RIVER.x1 - RIVER.x0, 0.05, 12), M.rock, [32, -0.3, z], [0, 0, 0], [1, 1, 1], { cast: false });
  }

  // ---------------------------------------------------------------- bases
  const flags = [];
  for (const b of BASES) {
    const team = b.team;
    const col = team === 0 ? 0xffc928 : 0x3ddc84;
    // pedestal
    B.add(new THREE.CylinderGeometry(0.9, 1.05, 0.25, 24), team === 0 ? M.darkMetal : M.stone, [b.flag.x, 0.125, b.flag.y]);
    const glowRing = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.05, 8, 32), new THREE.MeshBasicMaterial({ color: col }));
    glowRing.rotation.x = Math.PI / 2;
    glowRing.position.set(b.flag.x, 0.26, b.flag.y);
    root.add(glowRing);
    // cúpula de la zona protegida (muy sutil)
    const dome = new THREE.Mesh(
      new THREE.CylinderGeometry(RULES.flagZone, RULES.flagZone, 0.6, 48, 1, true),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    dome.position.set(b.flag.x, 0.3, b.flag.y);
    root.add(dome);
    // bandera
    const flag = makeFlag(team, M);
    flag.group.position.set(b.flag.x, 0.25, b.flag.y);
    root.add(flag.group);
    flags.push({ ...flag, home: { x: b.flag.x, y: b.flag.y }, dome, glowRing });

    // jaula
    const j = b.jail;
    const bars = 18;
    const barMat = team === 0 ? M.cageMetal : M.bamboo;
    for (let i = 0; i < bars; i++) {
      const a = (i / bars) * Math.PI * 2;
      if (team === 1 && i % 2) continue;
      B.add(new THREE.CylinderGeometry(0.05, 0.05, 2.1, 6), barMat,
        [j.x + Math.cos(a) * RULES.jailRadius, 1.05, j.y + Math.sin(a) * RULES.jailRadius]);
    }
    B.add(new THREE.TorusGeometry(RULES.jailRadius, 0.07, 8, 40), barMat, [j.x, 2.1, j.y], [Math.PI / 2, 0, 0]);
    B.add(new THREE.TorusGeometry(RULES.jailRadius, 0.05, 8, 40), barMat, [j.x, 0.6, j.y], [Math.PI / 2, 0, 0]);
    if (team === 1) {
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + 0.2;
        B.add(new THREE.CylinderGeometry(0.06, 0.06, 2.3, 6), M.bamboo, [j.x + Math.cos(a) * (RULES.jailRadius + 0.05), 1.1, j.y + Math.sin(a) * (RULES.jailRadius + 0.05)]);
      }
    }
    // cartel
    Bn.add(new THREE.BoxGeometry(1.6, 0.5, 0.06), M.yellowPaint, [j.x, 2.6, j.y - RULES.jailRadius], [0, 0, 0], [1, 1, 1], { cast: false });
  }

  B.build(root);
  Bn.build(root, true);

  return {
    root,
    water,
    waterNormal: wn,
    flags,
    bushes: bushMeshes,
  };
}

function palmTree(B, Bn, M, x, z, rad, r, collide = true) {
  const h = 3 + r() * 1.6;
  const lean = (r() - 0.5) * 0.25;
  const segs = 5;
  for (let i = 0; i < segs; i++) {
    const t = i / segs;
    const rr = rad * (0.75 - t * 0.35) * (collide ? 0.75 : 1);
    B.add(new THREE.CylinderGeometry(rr * 0.92, rr, h / segs + 0.02, 10), M.trunk,
      [x + lean * t * h, (t + 0.5 / segs) * h, z], [0, 0, -lean]);
  }
  const tx = x + lean * h, ty = h;
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r();
    const leafLen = 1.6 + r() * 0.6;
    const geo = new THREE.PlaneGeometry(leafLen, 0.5, 4, 1);
    // curvar la hoja hacia abajo
    const pos = geo.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const lx = pos.getX(k) + leafLen / 2;
      pos.setZ(k, -lx * lx * 0.18);
      pos.setY(k, pos.getY(k) * (1 - lx / leafLen * 0.7));
    }
    geo.computeVertexNormals();
    geo.translate(leafLen / 2, 0, 0);
    Bn.add(geo, i % 2 ? M.palm : M.palmDark, [tx, ty, z], [-Math.PI / 2 + 0.25, 0, a], [1, 1, 1], { cast: true });
  }
  Bn.add(new THREE.SphereGeometry(0.22, 8, 6), M.trunk, [tx, ty - 0.1, z], [0, 0, 0], [1, 1, 1], { cast: false });
  void collide;
}

function makeFlag(team, M) {
  const group = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 3, 10), M.pole);
  pole.position.y = 1.5;
  pole.castShadow = true;
  group.add(pole);
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), M.gold);
  top.position.y = 3.05;
  group.add(top);
  const geo = new THREE.PlaneGeometry(1.5, 0.95, 14, 6);
  geo.translate(0.75, 0, 0);
  const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: flagTexture(team), side: THREE.DoubleSide, roughness: 0.75 }));
  cloth.position.y = 2.45;
  cloth.castShadow = true;
  group.add(cloth);
  const base = geo.attributes.position.array.slice();
  return {
    group, cloth, base,
    wave(t) {
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3];
        const y = base[i * 3 + 1];
        pos.setZ(i, Math.sin(t * 4 - x * 4 + y) * 0.12 * (x / 1.5) + Math.sin(t * 7 - x * 6) * 0.03 * x);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
    },
  };
}
