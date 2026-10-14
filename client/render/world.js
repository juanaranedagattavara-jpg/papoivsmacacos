// Mundo 3D: renderer, luces, cámara, escenario, personajes y efectos.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildEnvironment } from './env.js';
import { CharacterView, preloadCharacterResources } from './characters.js';
import { FX } from './fx.js';
import { W, H } from '../../shared/map.js';
import { F } from '../../shared/constants.js';

export class World {
  constructor(canvas, quality = 2) {
    this.quality = quality;
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({
      canvas, antialias: quality >= 2, powerPreference: 'high-performance', stencil: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, [1, 1.5, 2][quality]));
    renderer.shadowMap.enabled = quality >= 1;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9fd4f5);
    scene.fog = new THREE.Fog(0x9fd4f5, 38, 85);
    this.scene = scene;

    if (quality >= 1) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environmentIntensity = 0.35;
      pmrem.dispose();
    }

    const hemi = new THREE.HemisphereLight(0xcfe9ff, 0x5a6b3a, quality >= 1 ? 1.1 : 1.6);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0d6, 2.4);
    sun.position.set(-12, 22, 10);
    if (quality >= 1) {
      sun.castShadow = true;
      const s = quality >= 2 ? 2048 : 1024;
      sun.shadow.mapSize.set(s, s);
      const ext = 17;
      sun.shadow.camera.left = -ext; sun.shadow.camera.right = ext;
      sun.shadow.camera.top = ext; sun.shadow.camera.bottom = -ext;
      sun.shadow.camera.near = 1; sun.shadow.camera.far = 70;
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.03;
    }
    scene.add(sun);
    scene.add(sun.target);
    this.sun = sun;

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 160);
    this.camTarget = new THREE.Vector3(W / 2, 0, H / 2);
    this.camPos = new THREE.Vector3();
    this.shakeT = 0;
    this.shakeAmp = 0;
    this.zoom = 1;
    this.zoomTarget = 1;

    preloadCharacterResources();
    this.env = buildEnvironment(scene, quality);
    this.fx = new FX(scene, quality);
    this.chars = new Map();
    this.time = 0;
    this.droppedGlow = [];
    for (const f of this.env.flags) {
      const glow = new THREE.Mesh(
        new THREE.RingGeometry(0.6, 1.0, 32),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      glow.rotation.x = -Math.PI / 2;
      glow.visible = false;
      scene.add(glow);
      this.droppedGlow.push(glow);
    }
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fx.setPixelScale(h * this.renderer.getPixelRatio(), this.camera.fov);
    this.viewW = w; this.viewH = h;
  }

  setPlayers(roster, meId, myTeam) {
    for (const [id, v] of this.chars) {
      if (!roster.find((r) => r.id === id)) {
        this.scene.remove(v.group);
        v.dispose();
        this.chars.delete(id);
      }
    }
    for (const r of roster) {
      const existing = this.chars.get(r.id);
      if (existing && existing.info.team === r.team && JSON.stringify(existing.info.skin) === JSON.stringify(r.skin)) {
        existing.info = r;
        continue;
      }
      if (existing) { this.scene.remove(existing.group); existing.dispose(); }
      const v = new CharacterView(r, r.id === meId, r.team === myTeam);
      this.scene.add(v.group);
      this.chars.set(r.id, v);
    }
  }

  shake(amp, dur = 0.35) {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeT = Math.max(this.shakeT, dur);
  }

  // frame: { focus:{x,y}, look:{x,y}, players:[{id,x,y,face,flags,hidden}], flags:[{state,x,y}], myBush }
  update(dt, frame) {
    this.time += dt;
    const t = this.time;

    // personajes
    for (const p of frame.players) {
      const v = this.chars.get(p.id);
      if (!v) continue;
      v.setHidden(!!p.hidden);
      v.update(dt, p);
    }

    // banderas
    frame.flags.forEach((f, i) => {
      const fl = this.env.flags[i];
      const glow = this.droppedGlow[i];
      if (f.state === 1) {
        fl.group.visible = false;
        glow.visible = false;
      } else {
        fl.group.visible = true;
        if (f.state === 0) {
          fl.group.position.set(fl.home.x, 0.25, fl.home.y);
          glow.visible = false;
        } else {
          fl.group.position.set(f.x, Math.sin(t * 4) * 0.08, f.y);
          glow.visible = true;
          glow.position.set(f.x, 0.05, f.y);
          const s = 1 + Math.sin(t * 6) * 0.15;
          glow.scale.set(s, s, s);
          glow.material.color.set(i === 0 ? 0xffc928 : 0x3ddc84);
        }
        fl.wave(t + i);
      }
      fl.dome.visible = f.state === 0;
      fl.dome.material.opacity = 0.08 + Math.sin(t * 2 + i) * 0.03;
    });

    // arbustos: transparentes si estoy dentro
    this.env.bushes.forEach((b, i) => {
      const inside = frame.myBush === i;
      const target = inside ? 0.42 : 1;
      b.mat.opacity += (target - b.mat.opacity) * Math.min(1, dt * 8);
      b.mat.depthWrite = b.mat.opacity > 0.95;
    });

    // agua
    this.env.waterNormal.offset.y = (this.env.waterNormal.offset.y + dt * 0.035) % 1;
    this.env.waterNormal.offset.x = Math.sin(t * 0.3) * 0.05;

    this.fx.update(dt);

    // cámara
    const aspect = this.camera.aspect;
    const visW = aspect >= 1 ? 25 : 14;
    let dist = visW / (2 * Math.tan((this.camera.fov * Math.PI) / 360) * aspect);
    dist = Math.max(15.5, Math.min(27, dist));
    this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, dt * 3);
    dist *= this.zoom;
    if (frame.orbit) {
      // modo vitrina (menú): órbita alrededor del foco
      const o = frame.orbit;
      this.camTarget.set(frame.focus.x, o.lookY ?? 1, frame.focus.y);
      this.camera.position.set(frame.focus.x + Math.sin(o.angle) * o.dist, o.height, frame.focus.y + Math.cos(o.angle) * o.dist);
      this.camera.lookAt(frame.focus.x + (o.offsetX || 0), o.lookY ?? 1, frame.focus.y);
      this.sun.position.set(frame.focus.x - 12, 22, frame.focus.y + 9);
      this.sun.target.position.set(frame.focus.x, 0, frame.focus.y);
      return;
    }
    const pitch = 0.98; // ~56°
    const fx = frame.focus.x + (frame.look ? frame.look.x : 0);
    const fz = frame.focus.y + (frame.look ? frame.look.y : 0);
    const k = Math.min(1, dt * 7);
    this.camTarget.x += (fx - this.camTarget.x) * k;
    this.camTarget.z += (fz - this.camTarget.z) * k;
    this.camTarget.x = Math.max(4, Math.min(W - 4, this.camTarget.x));
    this.camTarget.z = Math.max(1, Math.min(H + 1, this.camTarget.z));
    this.camPos.set(this.camTarget.x, Math.sin(pitch) * dist, this.camTarget.z + Math.cos(pitch) * dist);
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const a = this.shakeAmp * Math.max(0, this.shakeT) * 2.5;
      this.camPos.x += (Math.random() - 0.5) * a;
      this.camPos.y += (Math.random() - 0.5) * a;
      if (this.shakeT <= 0) this.shakeAmp = 0;
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget.x, 0, this.camTarget.z - 1.2);

    // sombra sigue a la cámara
    this.sun.position.set(this.camTarget.x - 12, 22, this.camTarget.z + 9);
    this.sun.target.position.set(this.camTarget.x, 0, this.camTarget.z - 2);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  // Proyecta una posición del mundo a píxeles de pantalla (CSS)
  toScreen(x, y, h, out) {
    const v = this._v || (this._v = new THREE.Vector3());
    v.set(x, h, y).project(this.camera);
    out.x = (v.x * 0.5 + 0.5) * this.viewW;
    out.y = (-v.y * 0.5 + 0.5) * this.viewH;
    out.on = v.z < 1 && out.x > -60 && out.x < this.viewW + 60 && out.y > -60 && out.y < this.viewH + 60;
    return out;
  }

  charHeight(id) {
    const v = this.chars.get(id);
    if (!v) return 1.6;
    return v.headY * v.inner.scale.y + v.inner.position.y + 0.35;
  }

  hitChar(id) { this.chars.get(id)?.hit(); }
  flashChar(id) { this.chars.get(id)?.flash(); }

  dispose() {
    this.renderer.dispose();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) { if (m.map) m.map.dispose(); m.dispose(); }
      }
    });
  }

  static flagsHas(flags, f) { return (flags & f) !== 0; }
}

export { F };
