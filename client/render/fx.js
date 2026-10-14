// Efectos visuales: partículas, proyectiles, nubes, cáscaras, sueros, ondas y confeti.
import * as THREE from 'three';
import { softSprite, puffSprite, ringSprite } from './textures.js';
import { PAPOIS } from '../../shared/constants.js';

const tmpC = new THREE.Color();

class Particles {
  constructor(scene, max, texture, additive) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.c0 = new Float32Array(max * 4);
    this.c1 = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    geo.setAttribute('size', this.sizeAttr);
    geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, scale: { value: 600 } },
      vertexShader: `
        attribute float size; attribute vec4 color; varying vec4 vColor; uniform float scale;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map; varying vec4 vColor;
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
          if (gl_FragColor.a < 0.01) discard;
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 5 : 4;
    scene.add(this.points);
  }

  // o: {x,y,z, vx,vy,vz, life, size, size1, color, color1, alpha, alpha1, grav, drag}
  emit(o) {
    let i = this.n;
    if (i >= this.max) i = (Math.random() * this.max) | 0; else this.n++;
    this.pos[i * 3] = o.x; this.pos[i * 3 + 1] = o.y; this.pos[i * 3 + 2] = o.z;
    this.vel[i * 3] = o.vx || 0; this.vel[i * 3 + 1] = o.vy || 0; this.vel[i * 3 + 2] = o.vz || 0;
    this.life[i] = this.maxLife[i] = o.life || 1;
    this.s0[i] = o.size || 0.5; this.s1[i] = o.size1 ?? this.s0[i];
    tmpC.set(o.color ?? 0xffffff);
    this.c0[i * 4] = tmpC.r; this.c0[i * 4 + 1] = tmpC.g; this.c0[i * 4 + 2] = tmpC.b; this.c0[i * 4 + 3] = o.alpha ?? 1;
    tmpC.set(o.color1 ?? o.color ?? 0xffffff);
    this.c1[i * 4] = tmpC.r; this.c1[i * 4 + 1] = tmpC.g; this.c1[i * 4 + 2] = tmpC.b; this.c1[i * 4 + 3] = o.alpha1 ?? 0;
    this.grav[i] = o.grav || 0;
    this.drag[i] = o.drag || 0;
  }

  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // compactar
        const j = --this.n;
        if (i !== j) {
          for (let k = 0; k < 3; k++) { this.pos[i * 3 + k] = this.pos[j * 3 + k]; this.vel[i * 3 + k] = this.vel[j * 3 + k]; }
          for (let k = 0; k < 4; k++) { this.c0[i * 4 + k] = this.c0[j * 4 + k]; this.c1[i * 4 + k] = this.c1[j * 4 + k]; }
          this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j];
          this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j]; this.grav[i] = this.grav[j]; this.drag[i] = this.drag[j];
        }
        continue;
      }
      const t = 1 - this.life[i] / this.maxLife[i];
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 2] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02 && this.grav[i] > 0) { this.pos[i * 3 + 1] = 0.02; this.vel[i * 3 + 1] *= -0.3; }
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      for (let k = 0; k < 4; k++) this.col[i * 4 + k] = this.c0[i * 4 + k] + (this.c1[i * 4 + k] - this.c0[i * 4 + k]) * t;
      i++;
    }
    this.points.geometry.setDrawRange(0, this.n);
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }
}

// Confeti con InstancedMesh
class Confetti {
  constructor(scene, max = 260) {
    this.max = max;
    this.mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.13, 0.22),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
      max,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.items = [];
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3(1, 1, 1);
  }
  burst(x, y, z, colors, n = 120) {
    for (let i = 0; i < n; i++) {
      if (this.items.length >= this.max) this.items.shift();
      const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 7;
      this.items.push({
        x, y, z, vx: Math.cos(a) * sp * 0.6, vy: 6 + Math.random() * 8, vz: Math.sin(a) * sp * 0.6,
        rx: Math.random() * 6, ry: Math.random() * 6, rz: 0, sx: (Math.random() - 0.5) * 14, sy: (Math.random() - 0.5) * 14,
        life: 3 + Math.random() * 1.5, color: colors[(Math.random() * colors.length) | 0],
      });
    }
  }
  update(dt) {
    let n = 0;
    this.items = this.items.filter((c) => (c.life -= dt) > 0);
    for (const c of this.items) {
      c.vy -= 9 * dt;
      c.vx *= Math.exp(-1.5 * dt); c.vz *= Math.exp(-1.5 * dt);
      if (c.vy < -2.2) c.vy = -2.2; // flotan
      c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
      if (c.y < 0.03) { c.y = 0.03; c.vx = c.vz = 0; c.sx = c.sy = 0; }
      c.rx += c.sx * dt; c.ry += c.sy * dt;
      this.e.set(c.rx, c.ry, 0);
      this.q.setFromEuler(this.e);
      this.v.set(c.x, c.y, c.z);
      this.m.compose(this.v, this.q, this.s);
      this.mesh.setMatrixAt(n, this.m);
      tmpC.set(c.color);
      this.mesh.setColorAt(n, tmpC);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

export class FX {
  constructor(scene, quality) {
    this.scene = scene;
    this.quality = quality;
    const soft = softSprite();
    const puff = puffSprite();
    this.glow = new Particles(scene, quality >= 1 ? 900 : 400, soft, true);
    this.smoke = new Particles(scene, quality >= 1 ? 700 : 300, puff, false);
    this.confetti = new Confetti(scene);
    this.ringTex = ringSprite();
    this.rings = [];
    this.projViews = new Map();
    this.cloudViews = new Map();
    this.peelViews = new Map();
    this.serumViews = new Map();
    this.time = 0;

    // geometrías y materiales compartidos
    this.iceCore = new THREE.MeshBasicMaterial({ color: 0xbff6ff });
    this.iceGeo = new THREE.CapsuleGeometry(0.1, 0.4, 4, 8);
    this.iceGeo.rotateX(Math.PI / 2);
    this.cocoMat = new THREE.MeshStandardMaterial({ color: 0x5b3a1e, roughness: 1 });
    this.cocoGeo = new THREE.SphereGeometry(0.2, 12, 10);
    this.glowSpriteMat = new THREE.SpriteMaterial({ map: soft, color: 0x7fe6ff, blending: THREE.AdditiveBlending, depthWrite: false });
    this.shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false });
    this.shadowGeo = new THREE.CircleGeometry(0.22, 12);
    this.shadowGeo.rotateX(-Math.PI / 2);
    // cáscara de plátano
    const peel = [];
    for (let i = 0; i < 4; i++) {
      const g = new THREE.SphereGeometry(0.1, 8, 6);
      g.scale(0.8, 0.35, 2.2);
      g.translate(0, 0.04, 0.17);
      g.rotateY((i / 4) * Math.PI * 2 + 0.4);
      peel.push(g);
    }
    this.peelGeos = peel;
    this.peelMat = new THREE.MeshStandardMaterial({ color: 0xffd93b, roughness: 0.55 });
    this.peelTipMat = new THREE.MeshStandardMaterial({ color: 0x5a3a1a });
    // suero
    this.vialGlass = new THREE.MeshStandardMaterial({ color: 0xe8f4ff, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.1, depthWrite: false });
    this.vialLiquid = new THREE.MeshStandardMaterial({ color: 0xa040ff, emissive: 0x8a2be2, emissiveIntensity: 1.8, roughness: 0.2 });
    this.vialCap = new THREE.MeshStandardMaterial({ color: 0xc8ccd4, metalness: 1, roughness: 0.25 });
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xb15cff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.serumGlowMat = new THREE.SpriteMaterial({ map: soft, color: 0xb15cff, blending: THREE.AdditiveBlending, depthWrite: false });
  }

  setPixelScale(h, fov) {
    const s = h / (2 * Math.tan((fov * Math.PI) / 360));
    this.glow.mat.uniforms.scale.value = s;
    this.smoke.mat.uniforms.scale.value = s;
  }

  // ------------------------------------------------------------ ráfagas
  burst(x, y, z, n, opts) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (opts.speed || 3) * (0.4 + Math.random() * 0.8);
      const up = opts.up ?? 2;
      (opts.smoke ? this.smoke : this.glow).emit({
        x: x + (Math.random() - 0.5) * (opts.spread || 0.3),
        y: y + (Math.random() - 0.5) * (opts.spread || 0.3) * 0.5,
        z: z + (Math.random() - 0.5) * (opts.spread || 0.3),
        vx: Math.cos(a) * sp, vy: up * (0.5 + Math.random()), vz: Math.sin(a) * sp,
        life: (opts.life || 0.6) * (0.6 + Math.random() * 0.8),
        size: opts.size || 0.4, size1: opts.size1 ?? (opts.size || 0.4) * 0.2,
        color: opts.color, color1: opts.color1, alpha: opts.alpha ?? 1, alpha1: 0,
        grav: opts.grav ?? 0, drag: opts.drag ?? 2,
      });
    }
  }

  iceShatter(x, y) {
    this.burst(x, 0.8, y, 26, { color: 0xbff6ff, color1: 0x3ab7ff, speed: 5, up: 3, size: 0.35, life: 0.7, grav: 9, drag: 1.5 });
    this.ring(x, y, 0x7fe6ff, 1.8, 0.4);
  }
  stunHit(x, y) {
    this.burst(x, 0.9, y, 14, { color: 0xffe14a, color1: 0xff8a00, speed: 4, up: 2, size: 0.3, life: 0.5, grav: 6 });
    this.burst(x, 0.8, y, 8, { smoke: true, color: 0x8a6a4a, speed: 2, up: 1, size: 0.6, size1: 1.2, life: 0.6, alpha: 0.6 });
  }
  impact(x, y, kind) {
    if (kind === PAPOIS) this.burst(x, 0.8, y, 12, { color: 0xbff6ff, color1: 0x3ab7ff, speed: 3, size: 0.25, life: 0.4, grav: 5 });
    else this.burst(x, 0.6, y, 10, { smoke: true, color: 0x7a5a3a, speed: 2.5, up: 1.5, size: 0.4, size1: 0.9, life: 0.5, alpha: 0.7 });
  }
  poof(x, y, color = 0xffffff) {
    this.burst(x, 0.6, y, 18, { smoke: true, color, speed: 3, up: 1.5, size: 0.7, size1: 1.6, life: 0.7, alpha: 0.85 });
    this.burst(x, 0.8, y, 12, { color: 0xffffff, speed: 4, up: 3, size: 0.25, life: 0.5, grav: 4 });
  }
  fart(x, y) {
    this.burst(x, 0.4, y, 30, { smoke: true, color: 0x9bd14a, color1: 0x5f8a20, speed: 6, up: 0.6, size: 0.9, size1: 2.2, life: 1.0, alpha: 0.75, drag: 3 });
    this.ring(x, y, 0x9bd14a, 3.4, 0.45);
  }
  dust(x, y, color = 0xc8b48a, n = 2) {
    this.burst(x, 0.08, y, n, { smoke: true, color, speed: 0.6, up: 0.6, size: 0.35, size1: 0.8, life: 0.55, alpha: 0.45, spread: 0.4 });
  }
  splash(x, y) {
    this.burst(x, 0.05, y, 10, { color: 0xd8f6ff, speed: 2, up: 3.5, size: 0.18, life: 0.5, grav: 12, alpha: 0.9 });
    this.ring(x, y, 0xd8f6ff, 1.2, 0.6, -0.08);
  }
  mutate(x, y, team) {
    const c = team === PAPOIS ? 0xa040ff : 0xff3a1a;
    this.burst(x, 1, y, 50, { color: c, color1: 0xffffff, speed: 7, up: 4, size: 0.45, life: 0.9, grav: 3 });
    this.burst(x, 0.5, y, 24, { smoke: true, color: team === PAPOIS ? 0x5a1f8a : 0x5a1010, speed: 4, up: 1, size: 1, size1: 2.4, life: 1.1, alpha: 0.7 });
    this.ring(x, y, c, 3.6, 0.55);
    this.ring(x, y, 0xffffff, 2.2, 0.35);
  }
  sparkle(x, y, color, n = 16) {
    this.burst(x, 1.2, y, n, { color, color1: 0xffffff, speed: 2.5, up: 2.5, size: 0.3, life: 0.8, grav: 1 });
  }
  celebrate(x, y, colors) {
    this.confetti.burst(x, 1.5, y, colors, 160);
    for (let i = 0; i < 4; i++) {
      setTimeout(() => this.burst(x + (Math.random() - 0.5) * 6, 4 + Math.random() * 2, y + (Math.random() - 0.5) * 6, 40,
        { color: colors[i % colors.length], color1: 0xffffff, speed: 6, up: 0, size: 0.4, life: 1.1, grav: 2, drag: 1 }), i * 220);
    }
    this.ring(x, y, colors[0], 5, 0.8);
  }

  ring(x, y, color, radius, dur, h = 0.06) {
    const mat = new THREE.MeshBasicMaterial({ map: this.ringTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, h + 0.1, y);
    mesh.scale.setScalar(0.1);
    this.scene.add(mesh);
    this.rings.push({ mesh, t: 0, dur, radius });
  }

  // ------------------------------------------------------------ entidades sincronizadas
  syncProjectiles(list, renderTime, nowFn) {
    const seen = new Set();
    for (const p of list) {
      seen.add(p.id);
      let v = this.projViews.get(p.id);
      if (!v) {
        v = this.makeProjectile(p.kind);
        this.projViews.set(p.id, v);
      }
      const { x, y } = nowFn(p);
      v.group.position.set(x, 0, y);
      v.group.rotation.y = Math.atan2(p.vx, p.vy);
      v.age += 0.016;
      if (p.kind === PAPOIS) {
        v.core.position.y = 0.9;
        if (Math.random() < 0.9) this.glow.emit({ x: x + (Math.random() - 0.5) * 0.1, y: 0.9, z: y + (Math.random() - 0.5) * 0.1, life: 0.3, size: 0.35, size1: 0.05, color: 0x7fe6ff, alpha: 0.9 });
      } else {
        v.core.position.y = 0.9 + Math.sin(Math.min(1, v.age / 0.5) * Math.PI) * 0.6;
        v.core.rotation.x += 0.4;
      }
    }
    for (const [id, v] of this.projViews) {
      if (!seen.has(id)) {
        this.scene.remove(v.group);
        this.projViews.delete(id);
      }
    }
    void renderTime;
  }

  makeProjectile(kind) {
    const group = new THREE.Group();
    let core;
    if (kind === PAPOIS) {
      core = new THREE.Mesh(this.iceGeo, this.iceCore);
      const g = new THREE.Sprite(this.glowSpriteMat);
      g.scale.setScalar(1.1);
      core.add(g);
    } else {
      core = new THREE.Mesh(this.cocoGeo, this.cocoMat);
      core.castShadow = true;
    }
    group.add(core);
    const sh = new THREE.Mesh(this.shadowGeo, this.shadowMat);
    sh.position.y = 0.04;
    group.add(sh);
    this.scene.add(group);
    return { group, core, age: 0 };
  }

  syncClouds(list) {
    const seen = new Set();
    for (const c of list) {
      seen.add(c.id);
      // emitir humo dentro de la nube
      const n = this.quality >= 1 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * c.r * 0.9;
        this.smoke.emit({
          x: c.x + Math.cos(a) * d, y: 0.2 + Math.random() * 0.6, z: c.y + Math.sin(a) * d,
          vx: (Math.random() - 0.5) * 0.4, vy: 0.3 + Math.random() * 0.3, vz: (Math.random() - 0.5) * 0.4,
          life: 1.1, size: 1.1, size1: 2.0, color: 0xa4d65e, color1: 0x6f9a2a, alpha: 0.55 * Math.min(1, c.f * 2), alpha1: 0,
        });
      }
    }
    void seen;
  }

  syncPeels(list) {
    const seen = new Set();
    for (const p of list) {
      seen.add(p.id);
      if (!this.peelViews.has(p.id)) {
        const g = new THREE.Group();
        for (const geo of this.peelGeos) {
          const m = new THREE.Mesh(geo, this.peelMat);
          m.castShadow = true;
          g.add(m);
        }
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), this.peelTipMat);
        tip.position.y = 0.08;
        g.add(tip);
        g.position.set(p.x, 0.02, p.y);
        g.rotation.y = Math.random() * 6;
        g.scale.setScalar(0.01);
        this.scene.add(g);
        this.peelViews.set(p.id, { g, t: 0 });
      }
    }
    for (const [id, v] of this.peelViews) {
      if (!seen.has(id)) { this.scene.remove(v.g); this.peelViews.delete(id); }
    }
  }

  syncSerums(list) {
    const seen = new Set();
    for (const s of list) {
      seen.add(s.id);
      let v = this.serumViews.get(s.id);
      if (!v) {
        const g = new THREE.Group();
        const vial = new THREE.Group();
        const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.62, 16), this.vialGlass);
        const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.44, 16), this.vialLiquid);
        liquid.position.y = -0.06;
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.1, 16), this.vialCap);
        cap.position.y = 0.36;
        const bottom = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), this.vialGlass);
        bottom.position.y = -0.31;
        vial.add(liquid, glass, cap, bottom);
        vial.rotation.z = 0.35;
        g.add(vial);
        const glow = new THREE.Sprite(this.serumGlowMat);
        glow.scale.setScalar(1.3);
        glow.position.y = 0;
        vial.add(glow);
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.45, 2.6, 16, 1, true), this.beamMat);
        beam.position.y = 1.3;
        g.add(beam);
        g.position.set(s.x, 0, s.y);
        this.scene.add(g);
        v = { g, vial, beam, t: 0 };
        this.serumViews.set(s.id, v);
        this.ring(s.x, s.y, 0xb15cff, 2.5, 0.8);
      }
    }
    for (const [id, v] of this.serumViews) {
      if (!seen.has(id)) { this.scene.remove(v.g); this.serumViews.delete(id); }
    }
  }

  update(dt) {
    this.time += dt;
    this.glow.update(dt);
    this.smoke.update(dt);
    this.confetti.update(dt);
    this.rings = this.rings.filter((r) => {
      r.t += dt;
      const k = r.t / r.dur;
      const s = r.radius * (0.2 + 0.8 * (1 - Math.pow(1 - k, 3)));
      r.mesh.scale.setScalar(s);
      r.mesh.material.opacity = 1 - k;
      if (k >= 1) {
        this.scene.remove(r.mesh);
        r.mesh.geometry.dispose();
        r.mesh.material.dispose();
        return false;
      }
      return true;
    });
    for (const v of this.peelViews.values()) {
      v.t += dt;
      v.g.scale.setScalar(Math.min(1, v.t * 6));
    }
    for (const v of this.serumViews.values()) {
      v.t += dt;
      v.vial.position.y = 1.0 + Math.sin(v.t * 3) * 0.15;
      v.vial.rotation.y += dt * 1.6;
      v.beam.material.opacity = 0.1 + Math.sin(v.t * 4) * 0.04;
      if (Math.random() < 0.25) this.glow.emit({ x: v.g.position.x + (Math.random() - 0.5) * 0.6, y: 0.4, z: v.g.position.z + (Math.random() - 0.5) * 0.6, vy: 1.2, life: 0.9, size: 0.22, size1: 0.02, color: 0xc77dff, alpha: 1 });
    }
  }
}
