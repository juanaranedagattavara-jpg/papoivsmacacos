// Modelos 3D procedurales de Papois y Macacos (+ formas mutantes y gorros).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { F, PAPOIS, TEAMS } from '../../shared/constants.js';
import { denimTexture, furDetail, flagTexture, starSprite } from './textures.js';

const FUR_COLORS = [0x7a4a26, 0xb07a32, 0x77777e, 0x3a2e28];
const FUR_FACE = [0xe3bd8f, 0xf0cf9a, 0xd9c6b0, 0xc9a27e];

let R = null; // recursos compartidos
function res() {
  if (R) return R;
  const denim = denimTexture();
  denim.repeat.set(2, 2);
  const fur = furDetail();
  fur.repeat.set(2, 2);
  R = {
    denim,
    fur,
    mats: {
      denim: new THREE.MeshStandardMaterial({ map: denim, roughness: 0.85, color: 0xffffff }),
      black: new THREE.MeshStandardMaterial({ color: 0x1b1b1e, roughness: 0.55 }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x232326, roughness: 0.9 }),
      metal: new THREE.MeshStandardMaterial({ color: 0xc8ccd4, metalness: 1, roughness: 0.22 }),
      white: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 }),
      iris: new THREE.MeshStandardMaterial({ color: 0x6b3f1d, roughness: 0.4 }),
      pupil: new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.2 }),
      mouth: new THREE.MeshStandardMaterial({ color: 0x2a0d0d, roughness: 0.7 }),
      tooth: new THREE.MeshStandardMaterial({ color: 0xf4f0e0, roughness: 0.4 }),
      gun: new THREE.MeshStandardMaterial({ color: 0x5a6270, metalness: 0.7, roughness: 0.35 }),
      ice: new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x3ab7ff, emissiveIntensity: 0.9, roughness: 0.2 }),
      coconut: new THREE.MeshStandardMaterial({ color: 0x5b3a1e, roughness: 1, map: fur }),
      purpleHair: new THREE.MeshStandardMaterial({ color: 0x3a1460, roughness: 0.9 }),
      feralSpike: new THREE.MeshStandardMaterial({ color: 0x1e0808, roughness: 0.9 }),
      eyeGlowRed: new THREE.MeshBasicMaterial({ color: 0xff3a1a }),
      eyeGlowYellow: new THREE.MeshBasicMaterial({ color: 0xffe14a }),
      iceBlock: new THREE.MeshStandardMaterial({
        color: 0xc6f1ff, emissive: 0x2a8fc0, emissiveIntensity: 0.25, transparent: true, opacity: 0.55, roughness: 0.05, metalness: 0.1, depthWrite: false,
      }),
      gold: new THREE.MeshStandardMaterial({ color: 0xffc83d, metalness: 1, roughness: 0.25 }),
      red: new THREE.MeshStandardMaterial({ color: 0xd63a32, roughness: 0.6 }),
      orange: new THREE.MeshStandardMaterial({ color: 0xff9f1c, roughness: 0.45 }),
      pink: new THREE.MeshStandardMaterial({ color: 0xff5fa2, roughness: 0.6 }),
      cream: new THREE.MeshStandardMaterial({ color: 0xf3e6c4, roughness: 0.5 }),
      gray: new THREE.MeshStandardMaterial({ color: 0x8a9099, metalness: 0.8, roughness: 0.35 }),
      leaf: new THREE.MeshStandardMaterial({ color: 0x4caf50, roughness: 0.6 }),
    },
    star: new THREE.SpriteMaterial({ map: starSprite(), color: 0xffe14a, depthWrite: false }),
    flagTex: [flagTexture(0), flagTexture(1)],
  };
  return R;
}

// Combina piezas rígidas por material: menos draw calls
class Parts {
  constructor() { this.byMat = new Map(); }
  add(geo, mat, pos = [0, 0, 0], rot = [0, 0, 0], scl = [1, 1, 1]) {
    const g = geo.index ? geo.clone() : geo.clone();
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...pos),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
      new THREE.Vector3(...scl),
    );
    g.applyMatrix4(m);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    if (!this.byMat.has(mat)) this.byMat.set(mat, []);
    this.byMat.get(mat).push(g);
    return this;
  }
  build(shadow = true) {
    const grp = new THREE.Group();
    for (const [mat, list] of this.byMat) {
      const geo = mergeGeometries(list, false);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = shadow;
      grp.add(mesh);
    }
    return grp;
  }
}

const SPH = (r, w = 16, h = 12) => new THREE.SphereGeometry(r, w, h);
const CYL = (rt, rb, h, s = 12, open = false, ts = 0, tl = Math.PI * 2) => new THREE.CylinderGeometry(rt, rb, h, s, 1, open, ts, tl);

// ------------------------------------------------------------------ gorros
function buildHat(kind, M) {
  const p = new Parts();
  switch (kind) {
    case 'gorra':
      p.add(new THREE.SphereGeometry(0.27, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.red, [0, 0, 0]);
      p.add(CYL(0.2, 0.2, 0.02, 16, false, -Math.PI / 2, Math.PI), M.red, [0, 0.01, 0.16], [0, 0, 0], [1, 1, 1.3]);
      p.add(SPH(0.04), M.white, [0, 0.27, 0]);
      break;
    case 'casco':
      p.add(new THREE.SphereGeometry(0.29, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.orange, [0, 0, 0]);
      p.add(CYL(0.38, 0.38, 0.03, 20), M.orange, [0, 0.01, 0.02]);
      p.add(CYL(0.05, 0.05, 0.06, 10), M.white, [0, 0.17, 0.24], [Math.PI / 2.6, 0, 0]);
      break;
    case 'fiesta':
      p.add(new THREE.ConeGeometry(0.15, 0.42, 14), M.pink, [0, 0.2, 0]);
      p.add(SPH(0.06), M.gold, [0, 0.43, 0]);
      break;
    case 'corona':
      p.add(CYL(0.22, 0.2, 0.13, 16, true), M.gold, [0, 0.06, 0]);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        p.add(new THREE.ConeGeometry(0.05, 0.12, 6), M.gold, [Math.sin(a) * 0.21, 0.18, Math.cos(a) * 0.21]);
        p.add(SPH(0.025, 8, 6), M.red, [Math.sin(a) * 0.215, 0.07, Math.cos(a) * 0.215]);
      }
      break;
    case 'vikingo':
      p.add(new THREE.SphereGeometry(0.3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.gray, [0, -0.02, 0]);
      p.add(new THREE.ConeGeometry(0.06, 0.3, 8), M.cream, [0.3, 0.12, 0], [0, 0, -0.9]);
      p.add(new THREE.ConeGeometry(0.06, 0.3, 8), M.cream, [-0.3, 0.12, 0], [0, 0, 0.9]);
      break;
    case 'pirata':
      p.add(CYL(0.24, 0.27, 0.16, 16), M.black, [0, 0.08, 0]);
      p.add(CYL(0.4, 0.4, 0.03, 3), M.black, [0, 0.02, 0], [0, Math.PI, 0]);
      p.add(SPH(0.045, 8, 6), M.white, [0, 0.1, 0.25]);
      break;
    case 'flor':
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        p.add(SPH(0.07, 8, 6), M.pink, [0.18 + Math.cos(a) * 0.08, 0.02, 0.05 + Math.sin(a) * 0.08]);
      }
      p.add(SPH(0.06, 8, 6), M.gold, [0.18, 0.04, 0.05]);
      p.add(new THREE.BoxGeometry(0.03, 0.12, 0.03), M.leaf, [0.12, -0.05, 0.03], [0, 0, 0.5]);
      break;
    default:
      return null;
  }
  return p.build();
}

// ------------------------------------------------------------------ Papoi
function buildPapoi(view, skin) {
  const M = res().mats;
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xf6d13c, roughness: 0.42 });
  const mutMat = new THREE.MeshStandardMaterial({ color: 0x6a2bb0, roughness: 0.85, map: res().fur, emissive: 0x24063d, emissiveIntensity: 0.6 });
  view.skinMat = skinMat;
  view.mutMat = mutMat;
  const Rb = 0.38, L = 0.42;
  const torsoY = 0.14 + Rb + L / 2;
  const root = view.inner;

  // Piernas
  view.legs = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.14, 0.17, 0);
    const p = new Parts();
    p.add(CYL(0.075, 0.07, 0.16, 10), M.denim, [0, -0.06, 0]);
    p.add(SPH(0.09, 12, 8), M.rubber, [0, -0.13, 0.04], [0, 0, 0], [1, 0.62, 1.35]);
    pivot.add(p.build());
    root.add(pivot);
    view.legs.push(pivot);
  }

  // Torso
  const torso = new THREE.Group();
  torso.position.y = torsoY;
  root.add(torso);
  view.torso = torso;
  view.torsoY = torsoY;

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(Rb, L, 8, 20), skinMat);
  body.castShadow = true;
  torso.add(body);
  view.body = body;

  const p = new Parts();
  // overol (torno)
  const prof = [];
  const Ro = Rb + 0.012;
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * (Math.PI / 2);
    prof.push(new THREE.Vector2(Math.max(0.001, Math.cos(a) * Ro), -L / 2 + Math.sin(a) * Ro));
  }
  prof.push(new THREE.Vector2(Ro, -0.03));
  p.add(new THREE.LatheGeometry(prof, 22), M.denim);
  // peto
  p.add(CYL(Ro, Ro, 0.22, 10, true, -0.75, 1.5), M.denim, [0, 0.08, 0]);
  // tirantes
  for (const sx of [-1, 1]) {
    p.add(new THREE.BoxGeometry(0.05, 0.36, 0.02), M.denim, [sx * 0.24, 0.3, 0.27], [-0.5, 0, sx * -0.35]);
    p.add(SPH(0.025, 8, 6), M.black, [sx * 0.24, 0.18, 0.345]);
  }
  // logo del bolsillo
  p.add(new THREE.CircleGeometry(0.055, 16), M.black, [0, 0.06, Ro + 0.003]);
  // banda de las gafas
  const eyeY = 0.22;
  p.add(CYL(Rb + 0.006, Rb + 0.006, 0.085, 22, true), M.black, [0, eyeY, 0]);
  // gafas
  const two = skin.eyes !== 1;
  const eyes = two ? [[-0.13, 0.105], [0.13, 0.105]] : [[0, 0.15]];
  view.pupils = [];
  for (const [ex, er] of eyes) {
    const ez = Math.sqrt(Math.max(0, Rb * Rb - ex * ex)) - 0.02;
    p.add(new THREE.TorusGeometry(er, 0.032, 10, 24), M.metal, [ex, eyeY, ez + 0.03]);
    p.add(CYL(er, er, 0.08, 20, true), M.metal, [ex, eyeY, ez - 0.005], [Math.PI / 2, 0, 0]);
    p.add(SPH(er * 0.92, 18, 12), M.white, [ex, eyeY, ez - 0.01], [0, 0, 0], [1, 1, 0.55]);
  }
  // boca
  p.add(new THREE.TorusGeometry(0.075, 0.013, 6, 14, Math.PI), M.mouth, [0, 0.0, Rb - 0.005], [Math.PI, 0, 0]);
  // pelos
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    p.add(CYL(0.006, 0.008, 0.14, 4), M.black, [Math.cos(a) * 0.06, L / 2 + Rb + 0.04, Math.sin(a) * 0.06], [Math.sin(a) * 0.5, 0, Math.cos(a) * 0.5]);
  }
  torso.add(p.build());

  // iris (para que miren)
  const eyeParts = new Parts();
  for (const [ex, er] of eyes) {
    const ez = Math.sqrt(Math.max(0, Rb * Rb - ex * ex)) - 0.02 + er * 0.5;
    eyeParts.add(new THREE.CircleGeometry(er * 0.45, 16), M.iris, [ex, eyeY - 0.005, ez + 0.002]);
    eyeParts.add(new THREE.CircleGeometry(er * 0.22, 12), M.pupil, [ex, eyeY - 0.005, ez + 0.004]);
    eyeParts.add(new THREE.CircleGeometry(er * 0.08, 8), M.white, [ex - er * 0.12, eyeY + er * 0.12, ez + 0.006]);
  }
  view.irises = eyeParts.build(false);
  torso.add(view.irises);

  // brazos
  view.arms = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * (Rb - 0.02), -0.02, 0);
    pivot.rotation.z = sx * 0.35;
    const a = new Parts();
    a.add(new THREE.CapsuleGeometry(0.058, 0.2, 4, 8), skinMat, [0, -0.13, 0]);
    a.add(SPH(0.075, 10, 8), M.black, [0, -0.28, 0]);
    const g = a.build();
    pivot.add(g);
    pivot.userData.skinMesh = g.children.find((m) => m.material === skinMat);
    torso.add(pivot);
    view.arms.push(pivot);
  }
  // Rayo congelador en la mano derecha
  const gun = new Parts();
  gun.add(new THREE.BoxGeometry(0.1, 0.1, 0.22), M.gun, [0, 0, 0.05]);
  gun.add(CYL(0.035, 0.05, 0.2, 10), M.ice, [0, 0.01, 0.24], [Math.PI / 2, 0, 0]);
  gun.add(new THREE.TorusGeometry(0.05, 0.015, 6, 12), M.metal, [0, 0.01, 0.17]);
  gun.add(new THREE.BoxGeometry(0.04, 0.1, 0.05), M.black, [0, -0.08, 0.0]);
  view.weapon = gun.build();
  view.weapon.position.set(0, -0.3, 0.08);
  view.arms[1].add(view.weapon);

  // --- Extras mutantes (pelos locos + dientes)
  const mut = new Parts();
  const rr = Math.random;
  for (let i = 0; i < 26; i++) {
    const a = rr() * Math.PI * 2, el = rr() * 0.9;
    const hx = Math.cos(a) * Math.sin(el) * 0.3, hz = Math.sin(a) * Math.sin(el) * 0.3;
    mut.add(new THREE.ConeGeometry(0.035 + rr() * 0.03, 0.2 + rr() * 0.22, 5), M.purpleHair,
      [hx, L / 2 + Rb - 0.02 + Math.cos(el) * 0.08, hz], [hz * 3 + (rr() - 0.5) * 0.6, 0, -hx * 3 + (rr() - 0.5) * 0.6]);
  }
  for (let i = -2; i <= 2; i++) {
    mut.add(new THREE.ConeGeometry(0.018, 0.05, 4), M.tooth, [i * 0.03, -0.015, Rb - 0.01], [Math.PI, 0, 0]);
  }
  view.mutantParts = mut.build();
  view.mutantParts.visible = false;
  torso.add(view.mutantParts);

  // gorro
  const hat = buildHat(skin.hat, M);
  if (hat) {
    hat.position.set(0, L / 2 + Rb - 0.05, 0);
    torso.add(hat);
    view.hat = hat;
  }
  view.headY = torsoY + L / 2 + Rb;
  view.mutantColor = new THREE.Color(0x6a2bb0);
  view.normalColor = new THREE.Color(0xf6d13c);
}

// ------------------------------------------------------------------ Macaco
function buildMacaco(view, skin) {
  const M = res().mats;
  const furCol = FUR_COLORS[skin.fur || 0];
  const faceCol = FUR_FACE[skin.fur || 0];
  const furMat = new THREE.MeshStandardMaterial({ color: furCol, roughness: 0.95, map: res().fur });
  const mutMat = new THREE.MeshStandardMaterial({ color: 0x4a0f12, roughness: 1, map: res().fur, emissive: 0x2a0000, emissiveIntensity: 0.6 });
  const faceMat = new THREE.MeshStandardMaterial({ color: faceCol, roughness: 0.7 });
  view.skinMat = furMat;
  view.mutMat = mutMat;
  const root = view.inner;

  view.legs = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.15, 0.36, 0);
    const p = new Parts();
    p.add(new THREE.CapsuleGeometry(0.085, 0.18, 4, 8), furMat, [0, -0.16, 0]);
    p.add(SPH(0.085, 10, 8), faceMat, [0, -0.32, 0.06], [0, 0, 0], [1, 0.55, 1.5]);
    const g = p.build();
    pivot.add(g);
    root.add(pivot);
    view.legs.push(pivot);
  }

  const torso = new THREE.Group();
  torso.position.y = 0.66;
  root.add(torso);
  view.torso = torso;
  view.torsoY = 0.66;

  const body = new THREE.Mesh(SPH(0.36, 20, 16), furMat);
  body.scale.set(1, 1.1, 0.88);
  body.castShadow = true;
  torso.add(body);
  view.body = body;

  const p = new Parts();
  p.add(SPH(0.27, 16, 12), faceMat, [0, -0.04, 0.16], [0, 0, 0], [0.85, 1, 0.55]);
  torso.add(p.build());

  // cabeza
  const head = new THREE.Group();
  head.position.set(0, 0.47, 0.03);
  torso.add(head);
  view.head = head;
  const headMesh = new THREE.Mesh(SPH(0.3, 20, 16), furMat);
  headMesh.castShadow = true;
  head.add(headMesh);
  view.headMesh = headMesh;
  const h = new Parts();
  h.add(SPH(0.22, 16, 12), faceMat, [0, -0.02, 0.17], [0, 0, 0], [1.15, 1, 0.6]);
  h.add(SPH(0.13, 14, 10), faceMat, [0, -0.1, 0.27], [0, 0, 0], [1.4, 0.9, 1]);
  h.add(SPH(0.02, 6, 4), M.pupil, [-0.04, -0.07, 0.4]);
  h.add(SPH(0.02, 6, 4), M.pupil, [0.04, -0.07, 0.4]);
  h.add(new THREE.TorusGeometry(0.06, 0.012, 6, 12, Math.PI), M.mouth, [0, -0.13, 0.37], [Math.PI + 0.3, 0, 0]);
  for (const sx of [-1, 1]) {
    h.add(SPH(0.058, 12, 10), M.white, [sx * 0.085, 0.045, 0.27]);
    h.add(CYL(0.1, 0.1, 0.035, 14), faceMat, [sx * 0.3, 0.02, -0.02], [0, 0, Math.PI / 2]);
    h.add(CYL(0.065, 0.065, 0.04, 12), M.mouth, [sx * 0.31, 0.02, -0.02], [0, 0, Math.PI / 2]);
  }
  h.add(new THREE.CapsuleGeometry(0.035, 0.2, 4, 8), M.rubber, [0, 0.12, 0.24], [0, 0, Math.PI / 2]);
  head.add(h.build());
  const e = new Parts();
  for (const sx of [-1, 1]) e.add(SPH(0.032, 10, 8), M.pupil, [sx * 0.085, 0.045, 0.318]);
  view.irises = e.build(false);
  head.add(view.irises);
  // ojos brillantes (mutante)
  const glow = new Parts();
  for (const sx of [-1, 1]) glow.add(SPH(0.04, 10, 8), M.eyeGlowRed, [sx * 0.085, 0.045, 0.322]);
  view.glowEyes = glow.build(false);
  view.glowEyes.visible = false;
  head.add(view.glowEyes);

  // brazos largos
  view.arms = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.33, 0.14, 0);
    pivot.rotation.z = sx * 0.25;
    const a = new Parts();
    a.add(new THREE.CapsuleGeometry(0.068, 0.36, 4, 8), furMat, [0, -0.22, 0]);
    a.add(SPH(0.08, 10, 8), faceMat, [0, -0.44, 0.02]);
    pivot.add(a.build());
    torso.add(pivot);
    view.arms.push(pivot);
  }
  // coco en la mano
  const coco = new THREE.Mesh(SPH(0.1, 12, 10), M.coconut);
  coco.position.set(0, -0.52, 0.06);
  coco.castShadow = true;
  view.arms[1].add(coco);
  view.weapon = coco;

  // cola
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.2, -0.28),
    new THREE.Vector3(0, -0.35, -0.55),
    new THREE.Vector3(0, -0.05, -0.75),
    new THREE.Vector3(0, 0.3, -0.7),
    new THREE.Vector3(0, 0.42, -0.5),
  ]);
  const tail = new THREE.Group();
  const tailMesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.045, 8), furMat);
  tailMesh.castShadow = true;
  tail.add(tailMesh);
  torso.add(tail);
  view.tail = tail;

  // pinchos del macaco salvaje
  const mut = new Parts();
  const rr = Math.random;
  for (let i = 0; i < 22; i++) {
    const a = -Math.PI * 0.9 + rr() * Math.PI * 0.8;
    const y = -0.1 + rr() * 0.5;
    mut.add(new THREE.ConeGeometry(0.04, 0.16 + rr() * 0.14, 5), M.feralSpike,
      [Math.cos(a) * 0.3, y, Math.sin(a) * 0.3], [Math.sin(a) * -1.2, 0, Math.cos(a) * 1.2]);
  }
  for (let i = 0; i < 10; i++) {
    const a = rr() * Math.PI * 2;
    mut.add(new THREE.ConeGeometry(0.035, 0.18, 5), M.feralSpike, [Math.cos(a) * 0.12, 0.72 + rr() * 0.05, Math.sin(a) * 0.12 - 0.05], [Math.sin(a) * 0.8, 0, -Math.cos(a) * 0.8]);
  }
  for (const sx of [-1, 1]) mut.add(new THREE.ConeGeometry(0.02, 0.08, 4), M.tooth, [sx * 0.04, 0.33, 0.36], [Math.PI, 0, 0]);
  view.mutantParts = mut.build();
  view.mutantParts.visible = false;
  torso.add(view.mutantParts);

  const hat = buildHat(skin.hat, M);
  if (hat) {
    hat.position.set(0, 0.25, 0);
    hat.scale.setScalar(0.95);
    head.add(hat);
    view.hat = hat;
  }
  view.headY = 0.66 + 0.47 + 0.3;
  view.mutantColor = new THREE.Color(0x4a0f12);
  view.normalColor = new THREE.Color(furCol);
}

// ------------------------------------------------------------------ vista de personaje
const tmpColor = new THREE.Color();

export class CharacterView {
  constructor(info, isMe, isAlly) {
    this.info = info;
    this.team = info.team;
    this.isMe = isMe;
    this.isAlly = isAlly;
    this.group = new THREE.Group();
    this.inner = new THREE.Group();
    this.group.add(this.inner);
    const skin = info.skin || {};
    if (info.team === PAPOIS) buildPapoi(this, skin);
    else buildMacaco(this, skin);

    const M = res().mats;
    // anillo de equipo
    const ringCol = isMe ? 0xffffff : TEAMS[info.team].colorHex;
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(isMe ? 0.62 : 0.6, isMe ? 0.76 : 0.7, 32),
      new THREE.MeshBasicMaterial({ color: ringCol, transparent: true, opacity: isMe ? 0.95 : 0.7, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.03;
    this.group.add(this.ring);
    if (isMe) {
      this.ring2 = new THREE.Mesh(
        new THREE.RingGeometry(0.78, 0.84, 32),
        new THREE.MeshBasicMaterial({ color: TEAMS[info.team].colorHex, transparent: true, opacity: 0.8, depthWrite: false }),
      );
      this.ring2.rotation.x = -Math.PI / 2;
      this.ring2.position.y = 0.031;
      this.group.add(this.ring2);
    }

    // bloque de hielo
    this.ice = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.45, 1.05), M.iceBlock);
    this.ice.position.y = 0.72;
    this.ice.visible = false;
    this.ice.renderOrder = 2;
    this.group.add(this.ice);

    // estrellas de aturdido
    this.stars = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Sprite(res().star);
      s.scale.setScalar(0.22);
      this.stars.add(s);
    }
    this.stars.visible = false;
    this.group.add(this.stars);

    // escudo
    this.shield = new THREE.Mesh(
      new THREE.SphereGeometry(0.95, 20, 14),
      new THREE.MeshBasicMaterial({ color: TEAMS[info.team].colorHex, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.shield.position.y = 0.7;
    this.shield.visible = false;
    this.group.add(this.shield);

    // bandera en la espalda
    this.backFlag = new THREE.Group();
    const pole = new THREE.Mesh(CYL(0.02, 0.02, 1.3, 6), M.metal);
    pole.position.y = 0.65;
    this.backFlag.add(pole);
    this.backCloth = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.4, 6, 1), new THREE.MeshStandardMaterial({ map: res().flagTex[1 - info.team], side: THREE.DoubleSide, roughness: 0.8 }));
    this.backCloth.position.set(0.31, 1.1, 0);
    this.backFlag.add(this.backCloth);
    this.backFlag.position.set(0, 0.5, -0.36);
    this.backFlag.visible = false;
    this.inner.add(this.backFlag);

    // estado de animación
    this.face = info.team === PAPOIS ? 0 : Math.PI;
    this.walk = 0;
    this.moveAmt = 0;
    this.airT = 0;
    this.mutVis = 0;
    this.transT = 0;
    this.wasMutant = false;
    this.flashT = 0;
    this.hitT = 0;
    this.squash = 0;
    this.time = Math.random() * 10;
    this.prevX = null;
    this.prevY = null;
    this.speed = 0;
    this.visibleState = true;
    this.lookAt = 0;
  }

  // s: { x, y, face, flags }
  update(dt, s, camQuat) {
    this.time += dt;
    const flags = s.flags;
    const g = this.group;
    // velocidad estimada
    if (this.prevX !== null && dt > 0) {
      const v = Math.hypot(s.x - this.prevX, s.y - this.prevY) / dt;
      this.speed += (Math.min(v, 12) - this.speed) * Math.min(1, dt * 10);
    }
    this.prevX = s.x; this.prevY = s.y;
    const wading = (flags & F.WATER) && !(flags & F.AIR);
    g.position.set(s.x, wading ? -0.22 : 0, s.y);

    // rotación suave
    let target = Math.PI / 2 - s.face;
    let d = target - this.inner.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const frozen = flags & F.FROZEN;
    if (!frozen) this.inner.rotation.y += d * Math.min(1, dt * 14);

    const mutant = !!(flags & F.MUTANT);
    const transforming = !!(flags & F.TRANSFORM);
    // mutación (color + escala + piezas)
    const mutTarget = mutant || transforming ? 1 : 0;
    this.mutVis += (mutTarget - this.mutVis) * Math.min(1, dt * (transforming ? 4 : 6));
    const useMut = this.mutVis > 0.5;
    if (useMut !== this.wasMutant) {
      this.wasMutant = useMut;
      this.body.material = useMut ? this.mutMat : this.skinMat;
      if (this.headMesh) this.headMesh.material = useMut ? this.mutMat : this.skinMat;
      for (const a of this.arms) a.traverse((m) => {
        if (m.isMesh && (m.material === this.skinMat || m.material === this.mutMat)) m.material = useMut ? this.mutMat : this.skinMat;
      });
      for (const l of this.legs) l.traverse((m) => {
        if (m.isMesh && (m.material === this.skinMat || m.material === this.mutMat)) m.material = useMut ? this.mutMat : this.skinMat;
      });
      if (this.tail) this.tail.children[0].material = useMut ? this.mutMat : this.skinMat;
      this.mutantParts.visible = useMut;
      if (this.glowEyes) { this.glowEyes.visible = useMut; this.irises.visible = !useMut; }
      if (this.hat) this.hat.visible = !useMut;
    }
    let scale = 1 + this.mutVis * 0.32;
    if (transforming) {
      this.transT += dt;
      scale *= 1 + Math.sin(this.transT * 40) * 0.06;
      this.mutMat.emissiveIntensity = 0.6 + Math.abs(Math.sin(this.transT * 20)) * 2;
    } else {
      this.transT = 0;
      if (mutant) this.mutMat.emissiveIntensity = 0.5 + Math.sin(this.time * 6) * 0.25;
    }
    // golpe: aplastamiento
    if (this.hitT > 0) this.hitT -= dt;
    const squash = this.hitT > 0 ? Math.sin(this.hitT * 30) * 0.08 * (this.hitT / 0.3) : 0;
    this.inner.scale.set(scale * (1 + squash), scale * (1 - squash), scale * (1 + squash));
    // destello blanco
    if (this.flashT > 0) {
      this.flashT -= dt;
      const m = this.body.material;
      m.emissive = m.emissive || new THREE.Color();
      tmpColor.setRGB(1, 1, 1).multiplyScalar(Math.max(0, this.flashT) * 3);
      m.emissive.copy(useMut ? (this.team === 0 ? new THREE.Color(0x24063d) : new THREE.Color(0x2a0000)) : new THREE.Color(0)).add(tmpColor);
    }

    // caminar
    const moving = this.speed > 0.6 && !frozen && !(flags & F.STUNNED) && !(flags & F.JAILED);
    this.moveAmt += ((moving ? 1 : 0) - this.moveAmt) * Math.min(1, dt * 10);
    if (!frozen) this.walk += dt * (2 + this.speed * 2.1);
    const w = this.walk, a = this.moveAmt;
    const monkey = this.team !== PAPOIS;

    // salto
    if (flags & F.AIR) this.airT += dt; else this.airT = 0;
    const air = this.airT > 0 ? Math.sin(Math.min(1, this.airT / 0.32) * Math.PI) : 0;
    this.inner.position.y = air * 1.0;

    if (!frozen) {
      for (let i = 0; i < 2; i++) {
        const sgn = i ? 1 : -1;
        this.legs[i].rotation.x = Math.sin(w + i * Math.PI) * 0.75 * a - air * 0.9;
        const armSwing = Math.sin(w + i * Math.PI + Math.PI) * (monkey ? 0.9 : 0.6) * a;
        this.arms[i].rotation.x = armSwing - air * 2.2 - (monkey ? 0.15 * a : 0);
        this.arms[i].rotation.z = sgn * (monkey ? 0.25 : 0.35) + sgn * air * 0.6;
      }
      const bob = Math.abs(Math.sin(w)) * (monkey ? 0.07 : 0.045) * a;
      const breathe = Math.sin(this.time * 2.4) * 0.012 * (1 - a);
      this.torso.position.y = this.torsoY + bob + breathe;
      this.torso.rotation.x = (monkey ? 0.22 : 0.1) * a;
      this.torso.rotation.z = Math.sin(w) * 0.05 * a;
      if (this.tail) {
        this.tail.rotation.y = Math.sin(this.time * 3 + w * 0.5) * 0.35;
        this.tail.rotation.x = Math.sin(this.time * 2) * 0.1;
      }
      if (this.head) this.head.rotation.y = Math.sin(this.time * 0.7) * 0.25 * (1 - a);
    }
    // aturdido: tambaleo
    const stunned = flags & F.STUNNED;
    if (stunned) {
      this.inner.rotation.z = Math.sin(this.time * 9) * 0.18;
      this.stars.visible = true;
      this.stars.position.y = this.headY * scale + 0.15;
      this.stars.children.forEach((st, i) => {
        const an = this.time * 5 + (i / 3) * Math.PI * 2;
        st.position.set(Math.cos(an) * 0.35, Math.sin(an * 2) * 0.05, Math.sin(an) * 0.35);
      });
    } else {
      this.inner.rotation.z *= 0.8;
      this.stars.visible = false;
    }
    // congelado
    this.ice.visible = !!frozen;
    if (frozen) this.ice.scale.setScalar(scale);
    // escudo
    this.shield.visible = !!(flags & F.SHIELD) && !(flags & F.JAILED);
    if (this.shield.visible) this.shield.material.opacity = 0.16 + Math.sin(this.time * 8) * 0.07;
    // bandera en la espalda
    this.backFlag.visible = !!(flags & F.CARRY);
    if (this.backFlag.visible) {
      const pos = this.backCloth.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        pos.setZ(i, Math.sin(this.time * 9 - x * 7) * 0.06 * (x + 0.31));
      }
      pos.needsUpdate = true;
    }
    // anillo
    this.ring.visible = !(flags & F.JAILED);
    if (this.ring2) {
      const p = 1 + Math.sin(this.time * 4) * 0.05;
      this.ring2.scale.set(p, p, p);
    }
    void camQuat;
  }

  hit() { this.hitT = 0.3; this.flashT = 0.25; }
  flash() { this.flashT = 0.5; }

  setHidden(hidden) {
    this.group.visible = !hidden;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
    });
    this.skinMat.dispose();
    this.mutMat.dispose();
  }
}

export function preloadCharacterResources() { res(); }
