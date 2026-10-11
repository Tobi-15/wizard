// Theke am Platz: Bierglas mit Füllstand, Bierdeckel mit Strichliste, Aschenbecher mit Kippen,
// Zigarette bzw. Zigarre mit Glut, Zigarettenschachtel – und der Rauch dazu.
// Alles liegt in Stuhl-Koordinaten (wie in characters.js: der Gast schaut +z, Tisch bei y = 0,78).

import * as THREE from 'three';
import { VICE, SMOKE_MS, beerLevel } from '../vices.js';
import { clamp, rng } from './util.js';

export const MUG_REST = new THREE.Vector3(-0.21, 0.78, 0.66); // rechts vor dem Gast
export const ASH_REST = new THREE.Vector3(0.42, 0.78, 0.6); // links vor dem Gast (neben dem Geberstapel)
export const PACK_REST = new THREE.Vector3(-0.4, 0.78, 0.55); // rechts neben dem Bier

const R = rng(77);

// ---------- Materialien ----------
let M = null;
function mats() {
  if (M) return M;
  M = {
    glass: new THREE.MeshStandardMaterial({
      color: '#e8efe6', roughness: 0.06, metalness: 0, transparent: true, opacity: 0.28, envMapIntensity: 0.6, depthWrite: false, side: THREE.DoubleSide,
    }),
    glassThick: new THREE.MeshStandardMaterial({ color: '#cfdccf', roughness: 0.15, transparent: true, opacity: 0.5, depthWrite: false, envMapIntensity: 0.4 }),
    beer: new THREE.MeshStandardMaterial({
      color: '#d98a12', emissive: '#7a3c00', emissiveIntensity: 0.25, roughness: 0.3, envMapIntensity: 0.5, transparent: true, opacity: 0.88, depthWrite: false,
    }),
    foam: new THREE.MeshLambertMaterial({ color: '#f6efdc' }),
    ashtray: new THREE.MeshStandardMaterial({ color: '#7d828a', roughness: 0.32, metalness: 0.85 }),
    ash: new THREE.MeshLambertMaterial({ color: '#8d8a84' }),
    paper: new THREE.MeshLambertMaterial({ color: '#f2eee4' }),
    filter: new THREE.MeshLambertMaterial({ color: '#c98a3e' }),
    cigar: new THREE.MeshLambertMaterial({ color: '#5a3416' }),
    band: new THREE.MeshStandardMaterial({ color: '#c9a23a', roughness: 0.3, metalness: 0.8 }),
    butt: new THREE.MeshLambertMaterial({ color: '#d7c9ab' }),
    flame: new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.6, 0.5), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
  };
  return M;
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---------- Bierglas (Boden im Ursprung, Henkel bei +x) ----------
const GLASS_H = 0.15;
const GLASS_R = 0.043;
export function makeBeer(level = 1) {
  const m = mats();
  const g = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(GLASS_R, GLASS_R * 0.93, GLASS_H, 18, 1, true), m.glass);
  wall.position.y = GLASS_H / 2;
  wall.renderOrder = 4;
  const bottom = new THREE.Mesh(new THREE.CylinderGeometry(GLASS_R * 0.93, GLASS_R * 0.93, 0.014, 18), m.glassThick);
  bottom.position.y = 0.007;
  bottom.renderOrder = 4;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.009, 6, 14, Math.PI * 1.15), m.glassThick);
  handle.rotation.z = -Math.PI * 0.575 + Math.PI / 2;
  handle.position.set(GLASS_R + 0.004, GLASS_H * 0.52, 0);
  handle.scale.set(0.85, 1.25, 1);
  handle.renderOrder = 4;
  // Bier: Säule, die mit dem Füllstand schrumpft, oben Schaum
  const liquid = new THREE.Mesh(new THREE.CylinderGeometry(GLASS_R * 0.92, GLASS_R * 0.86, 1, 16).translate(0, 0.5, 0), m.beer);
  liquid.position.y = 0.014;
  liquid.renderOrder = 3;
  const foam = new THREE.Mesh(new THREE.CylinderGeometry(GLASS_R * 0.95, GLASS_R * 0.92, 1, 16).translate(0, 0.5, 0), m.foam);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(GLASS_R * 0.95, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), m.foam);
  cap.scale.y = 0.35;
  g.add(liquid, foam, cap, bottom, wall, handle);
  for (const o of g.children) o.castShadow = o.material !== m.glass;
  g.userData = { liquid, foam, cap };
  setBeerLevel(g, level);
  return g;
}

/** Füllstand 0 … 1 (0 = leer, nur Schaumreste). */
export function setBeerLevel(g, level) {
  const { liquid, foam, cap } = g.userData;
  const full = GLASS_H - 0.03;
  const h = Math.max(0, level) * full;
  liquid.visible = h > 0.002;
  liquid.scale.y = Math.max(h, 0.001);
  const foamH = level > 0 ? 0.012 + 0.014 * Math.min(1, level * 2) : 0.004;
  foam.position.y = 0.014 + h;
  foam.scale.y = foamH;
  cap.position.y = 0.014 + h + foamH;
  cap.visible = level > 0.5;
  cap.scale.y = 0.35 * clamp((level - 0.5) * 3, 0, 1);
}

// ---------- Bierdeckel mit Strichliste ----------
const coasterTex = new Map();
function coasterTexture(n) {
  if (coasterTex.has(n)) return coasterTex.get(n);
  const t = canvasTex(256, 256, (ctx, w) => {
    ctx.fillStyle = '#efe4c9';
    ctx.beginPath();
    ctx.arc(w / 2, w / 2, w / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#8a1f1f';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.arc(w / 2, w / 2, w / 2 - 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#8a1f1f';
    ctx.font = '700 30px Cinzel, Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('ZAUBERBRÄU', w / 2, 66);
    ctx.font = '600 15px Georgia, serif';
    ctx.fillText('seit 1871 · hell', w / 2, 88);
    // Bierflecken
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = `rgba(150,100,40,${0.12 + R() * 0.1})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(w / 2 + (R() - 0.5) * 40, w / 2 + (R() - 0.5) * 40, 70 + R() * 20, R() * 6, R() * 6 + 4);
      ctx.stroke();
    }
    // Striche in Fünferbündeln (Bleistift)
    ctx.strokeStyle = '#2a2622';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const bundle = Math.floor(i / 5);
      const k = i % 5;
      const bx = 62 + (bundle % 3) * 50;
      const by = 118 + Math.floor(bundle / 3) * 62;
      ctx.beginPath();
      if (k < 4) {
        ctx.moveTo(bx + k * 9, by);
        ctx.lineTo(bx + k * 9 + 2, by + 44);
      } else {
        ctx.moveTo(bx - 6, by + 36);
        ctx.lineTo(bx + 36, by + 6);
      }
      ctx.stroke();
    }
  });
  coasterTex.set(n, t);
  return t;
}

// ---------- Aschenbecher ----------
const ASH_GEO = () =>
  new THREE.LatheGeometry(
    [[0, 0], [0.058, 0], [0.064, 0.008], [0.064, 0.022], [0.056, 0.024], [0.047, 0.014], [0, 0.012]].map(([x, y]) => new THREE.Vector2(x, y)),
    20,
  );

// ---------- Zigarette und Zigarre (Mundende im Ursprung, Glut bei +x) ----------
function makeSmokeStick(kind) {
  const m = mats();
  const g = new THREE.Group();
  const cigar = kind === 'cigar';
  const r = cigar ? 0.0095 : 0.0042;
  const L = cigar ? 0.13 : 0.075;
  const tip = cigar ? 0.012 : 0.02; // Filter bzw. Mundstück
  const head = new THREE.Mesh(new THREE.CylinderGeometry(r, r, tip, 10).rotateZ(Math.PI / 2).translate(tip / 2, 0, 0), cigar ? m.cigar : m.filter);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 10).rotateZ(Math.PI / 2).translate(0.5, 0, 0), cigar ? m.cigar : m.paper);
  body.position.x = tip;
  const ash = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.97, r * 0.97, 1, 10).rotateZ(Math.PI / 2).translate(0.5, 0, 0), m.ash);
  const emberMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.55, 0.12) });
  const ember = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r * 0.75, r * 0.9, 10).rotateZ(-Math.PI / 2), emberMat);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex(), color: '#ff7a2a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.setScalar(r * 9);
  halo.renderOrder = 7;
  ember.add(halo);
  g.add(head, body, ash, ember);
  if (cigar) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.06, r * 1.06, 0.012, 10).rotateZ(Math.PI / 2), m.band);
    band.position.x = 0.03;
    g.add(band);
  }
  for (const o of [head, body]) o.castShadow = true;
  g.userData = { kind, r, L, tip, body, ash, ember, emberMat, halo };
  setBurn(g, 0, 0);
  return g;
}

/** Unangezündete Zigarre (für das Tablett des Wirts). */
export function makeUnlitCigar() {
  const g = makeSmokeStick('cigar');
  g.userData.ember.visible = false;
  g.userData.ash.visible = false;
  return g;
}

/** burn 0 … 1 (wie weit abgebrannt), glow 0 … 1 (beim Ziehen hell). */
function setBurn(g, burn, glow) {
  const { L, tip, body, ash, ember, emberMat, halo, r } = g.userData;
  const rest = Math.max(0.006, L * (1 - burn * 0.82));
  body.scale.x = rest;
  // etwas Asche vorne, die nach dem Abklopfen nachwächst
  const ashLen = Math.min(0.018, L * burn * 0.4 + 0.003);
  ash.position.x = tip + rest;
  ash.scale.x = ashLen * (1 - glow * 0.4);
  ember.position.x = tip + rest + ash.scale.x + r * 0.2;
  const k = 0.6 + glow * 2.4;
  emberMat.color.setRGB(2.2 * k, 0.55 * k, 0.12 * k);
  halo.material.opacity = 0.35 + glow * 0.65;
  halo.scale.setScalar(r * (7 + glow * 9));
}

let _halo = null;
function haloTex() {
  if (_halo) return _halo;
  _halo = canvasTex(64, 64, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.4)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
  return _halo;
}

/** Feuerzeugflamme (Spitze nach +y). */
export function makeFlame() {
  const f = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.03, 8).translate(0, 0.015, 0), mats().flame);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex(), color: '#ffb35a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.setScalar(0.12);
  halo.position.y = 0.015;
  f.add(halo);
  f.renderOrder = 8;
  return f;
}

function makePack() {
  const tex = canvasTex(128, 192, (ctx, w, h) => {
    ctx.fillStyle = '#f1ece2';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#9c1c22';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w, 0);
    ctx.lineTo(w, h * 0.45);
    ctx.lineTo(w / 2, h * 0.3);
    ctx.lineTo(0, h * 0.45);
    ctx.fill();
    ctx.fillStyle = '#1d1a17';
    ctx.font = '700 20px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('MERLIN', w / 2, h * 0.62);
    ctx.font = '600 12px Georgia, serif';
    ctx.fillText('Filter · 20', w / 2, h * 0.72);
    ctx.fillStyle = '#111';
    ctx.fillRect(8, h * 0.8, w - 16, h * 0.13);
    ctx.fillStyle = '#fff';
    ctx.font = '700 9px sans-serif';
    ctx.fillText('RAUCHEN KANN', w / 2, h * 0.85);
    ctx.fillText('ZAUBERN BEENDEN', w / 2, h * 0.9);
  });
  const side = new THREE.MeshLambertMaterial({ color: '#e9e2d4' });
  const top = new THREE.MeshLambertMaterial({ map: tex });
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.022, 0.085), [side, side, top, side, side, side]);
  box.position.y = 0.011;
  box.castShadow = true;
  const g = new THREE.Group();
  g.add(box);
  return g;
}

// ---------- Rauch: ein gemeinsames Partikelsystem für alle ----------
const MAX_P = 900;
class Smoke {
  constructor() {
    this.pos = new Float32Array(MAX_P * 3);
    this.size = new Float32Array(MAX_P);
    this.alpha = new Float32Array(MAX_P);
    this.rot = new Float32Array(MAX_P);
    this.p = Array.from({ length: MAX_P }, () => ({ alive: false }));
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('rot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = geo;
    const tex = canvasTex(128, 128, (ctx, w) => {
      for (let i = 0; i < 7; i++) {
        const x = w * (0.35 + R() * 0.3);
        const y = w * (0.35 + R() * 0.3);
        const g = ctx.createRadialGradient(x, y, 0, x, y, w * (0.2 + R() * 0.2));
        g.addColorStop(0, 'rgba(255,255,255,0.5)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, w);
      }
    });
    tex.colorSpace = THREE.NoColorSpace;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, scale: { value: 800 }, color: { value: new THREE.Color('#c9bba8') } },
      vertexShader: `attribute float size; attribute float alpha; attribute float rot;
        uniform float scale; varying float vA; varying float vR; varying float vH;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = min(size * scale / max(-mv.z, 0.05), 400.0); vA = alpha; vR = rot; vH = position.y; }`,
      fragmentShader: `uniform sampler2D map; uniform vec3 color; varying float vA; varying float vR; varying float vH;
        void main(){ vec2 c = gl_PointCoord - 0.5; float s = sin(vR), co = cos(vR);
          vec2 uv = vec2(co*c.x - s*c.y, s*c.x + co*c.y) + 0.5;
          float a = texture2D(map, uv).a * vA; if (a < 0.003) discard;
          // oben im Lampenlicht wärmer und heller
          float lit = smoothstep(0.9, 2.3, vH);
          gl_FragColor = vec4(color * (0.75 + lit * 0.5), a); }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.emitters = [];
  }

  add(x, y, z, vx, vy, vz, { life = 3, s0 = 0.02, s1 = 0.15, a = 0.3, swirl = 1 } = {}) {
    const p = this.p[this.next];
    this.next = (this.next + 1) % MAX_P;
    Object.assign(p, { alive: true, x, y, z, vx, vy, vz, age: 0, life, s0, s1, a, swirl, ph: R() * 100, r: R() * 6, vr: (R() - 0.5) * 0.8 });
  }

  /** Dünner Faden aus der Glut. */
  wisp(v, strength = 1) {
    this.add(v.x, v.y, v.z, (R() - 0.5) * 0.01, 0.06 + R() * 0.04, (R() - 0.5) * 0.01, {
      life: 3.2 + R() * 1.5, s0: 0.012 * strength, s1: 0.16 * strength, a: 0.22 + 0.1 * strength, swirl: 1,
    });
  }

  /** Ausatmen: über `dur` Sekunden eine Wolke von v aus in Richtung dir. */
  exhale(v, dir, { dur = 0.9, amount = 1 } = {}) {
    this.emitters.push({ v: v.clone(), dir: dir.clone().normalize(), t: 0, dur, rate: 34 * amount, acc: 0, amount });
  }

  update(dt, camera, viewportH) {
    this.mat.uniforms.scale.value = (viewportH * camera.projectionMatrix.elements[5]) / 2;
    for (const e of this.emitters) {
      e.t += dt;
      e.acc += e.rate * dt;
      const k = 1 - e.t / e.dur;
      while (e.acc >= 1) {
        e.acc -= 1;
        const sp = 0.28 * k + 0.08;
        this.add(
          e.v.x, e.v.y, e.v.z,
          e.dir.x * sp + (R() - 0.5) * 0.08, e.dir.y * sp + 0.02 + (R() - 0.5) * 0.05, e.dir.z * sp + (R() - 0.5) * 0.08,
          { life: 2.6 + R(), s0: 0.03, s1: 0.32 * e.amount, a: 0.32, swirl: 0.6 },
        );
      }
    }
    this.emitters = this.emitters.filter((e) => e.t < e.dur);
    for (let i = 0; i < MAX_P; i++) {
      const p = this.p[i];
      if (!p.alive) {
        this.alpha[i] = 0;
        continue;
      }
      p.age += dt;
      if (p.age >= p.life) {
        p.alive = false;
        this.alpha[i] = 0;
        continue;
      }
      const u = p.age / p.life;
      // bremsen, aufsteigen, leicht verwirbeln
      const drag = Math.exp(-dt * 1.6);
      p.vx = p.vx * drag + Math.sin(p.age * 1.7 + p.ph) * 0.03 * p.swirl * dt * 6;
      p.vz = p.vz * drag + Math.cos(p.age * 1.3 + p.ph * 1.7) * 0.03 * p.swirl * dt * 6;
      p.vy = p.vy * drag + 0.35 * dt; // Auftrieb
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.r += p.vr * dt;
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
      this.size[i] = p.s0 + (p.s1 - p.s0) * Math.sqrt(u);
      this.alpha[i] = p.a * Math.min(1, u * 8) * (1 - u) ** 1.6;
      this.rot[i] = p.r;
    }
    for (const name of ['position', 'size', 'alpha', 'rot']) this.geo.attributes[name].needsUpdate = true;
  }
}

export const smoke = new Smoke();

// ---------- Requisiten eines Platzes ----------
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class SeatProps {
  constructor() {
    const m = mats();
    this.group = new THREE.Group();
    this.mug = makeBeer();
    this.mug.position.copy(MUG_REST);
    this.mug.rotation.y = 2.4;
    this.mug.visible = false;
    this.group.add(this.mug);

    this.coasterMat = new THREE.MeshLambertMaterial({ map: coasterTexture(0) });
    const edge = new THREE.MeshLambertMaterial({ color: '#d9cdb0' });
    this.coaster = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.004, 24), [edge, this.coasterMat, edge]);
    this.coaster.position.copy(MUG_REST).setY(MUG_REST.y + 0.002);
    this.coaster.rotation.y = 0.6;
    this.coaster.receiveShadow = true;
    this.coaster.visible = false;
    this.group.add(this.coaster);
    this.coasterCount = 0;

    this.ashtray = new THREE.Group();
    this.ashtray.position.copy(ASH_REST);
    const tray = new THREE.Mesh(ASH_GEO(), m.ashtray);
    tray.castShadow = tray.receiveShadow = true;
    this.ashtray.add(tray);
    this.ashtray.visible = false;
    this.butts = new THREE.Group();
    this.ashtray.add(this.butts);
    this.group.add(this.ashtray);
    this.buttCount = 0;

    this.pack = makePack();
    this.pack.position.copy(PACK_REST);
    this.pack.rotation.y = -0.4;
    this.pack.visible = false;
    this.group.add(this.pack);

    this.stick = null; // Zigarette/Zigarre
    this.held = false; // gerade in der Hand (sonst liegt sie im Aschenbecher)
    this.glow = 0; // beim Ziehen
    this.beer = null; // { n }
    this.smoking = null; // { kind, litAt, dur }
    this.wispAcc = 0;
    this.level = 0; // Füllstand laut Server (nach den getrunkenen Schlucken)
    this.shown = 0; // angezeigter Füllstand, sinkt beim Trinken langsam auf `level`
    this.drain = null; // { from, at, dur }
    this.drinkAt = -1e9; // Beginn der letzten Trink-Animation (vnow())
    this.drinkKind = 'sip';
  }

  // Zeiten in Sekunden (performance.now()/1000), wie in table.js: vnow()
  serveBeer(n, sips = 0) {
    this.beer = { n };
    this.level = this.shown = beerLevel(sips);
    this.drain = null;
    setBeerLevel(this.mug, this.shown);
    this.mug.visible = true;
    this.coaster.visible = true;
    if (n !== this.coasterCount) {
      this.coasterCount = n;
      this.coasterMat.map = coasterTexture(Math.min(n, 30));
      this.coasterMat.needsUpdate = true;
    }
  }

  /** Gerade wird getrunken (sip oder cheers): der Füllstand sinkt erst, wenn der Krug am Mund ist. */
  drinking(kind, vt) {
    this.drinkKind = kind;
    this.drinkAt = vt;
  }

  /** Neue Zahl getrunkener Schlucke vom Server. `animate` = langsam absenken statt springen. */
  setSips(sips, vt, animate) {
    const level = beerLevel(sips);
    if (level === this.level) return;
    this.level = level;
    if (!animate || level > this.shown) {
      this.shown = level;
      this.drain = null;
      setBeerLevel(this.mug, level);
      return;
    }
    // passend zur Animation: Schluck nach ~0,9 s am Mund, beim Prost erst nach dem Anstoßen
    const start = this.drinkAt + (this.drinkKind === 'cheers' ? 2.0 : 0.9);
    this.drain = { from: this.shown, at: Math.max(vt, start), dur: 0.8 };
  }

  light(kind, litAt) {
    if (this.stick) this.group.remove(this.stick);
    this.stick = makeSmokeStick(kind);
    this.group.add(this.stick);
    this.smoking = { kind, litAt, dur: SMOKE_MS[kind] / 1000 };
    this.ashtray.visible = true;
    if (kind === 'cigarette') this.pack.visible = true;
    this.held = false;
  }

  putOut() {
    if (!this.stick) return;
    this.stick.parent?.remove(this.stick); // liegt evtl. gerade an der Kamera (Ego-Perspektive)
    this.stick = null;
    this.smoking = null;
    this.setButts(this.buttCount + 1);
  }

  setButts(n) {
    n = Math.min(n, 9);
    if (n > 0) this.ashtray.visible = true;
    if (n === this.buttCount) return;
    this.buttCount = n;
    this.butts.clear();
    const Rb = rng(n * 31 + 7);
    for (let i = 0; i < n; i++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.024, 6), mats().butt);
      const a = Rb() * Math.PI * 2;
      const r = 0.012 + Rb() * 0.026;
      b.position.set(Math.cos(a) * r, 0.016 + i * 0.002, Math.sin(a) * r);
      b.rotation.set(Math.PI / 2 + (Rb() - 0.5) * 0.4, 0, Rb() * Math.PI);
      this.butts.add(b);
    }
  }

  canDrink() {
    return !!this.beer && this.mug.visible && this.level > 0.02;
  }

  isSmoking() {
    return !!this.stick;
  }

  /** Ruheplatz der Zigarette: auf dem Rand des Aschenbechers, Glut nach außen. */
  restStick() {
    if (!this.stick) return;
    const cigar = this.smoking?.kind === 'cigar';
    this.stick.position.copy(ASH_REST).add(_v.set(-0.03, cigar ? 0.03 : 0.026, -0.015));
    this.stick.rotation.set(0, 0.5, cigar ? 0.08 : 0.12);
  }

  /** Glut-Position in Weltkoordinaten. */
  emberWorld(out = new THREE.Vector3()) {
    const e = this.stick.userData.ember;
    return e.getWorldPosition(out);
  }

  update(vt, dt) {
    if (this.drain) {
      const k = clamp((vt - this.drain.at) / this.drain.dur, 0, 1);
      this.shown = this.drain.from + (this.level - this.drain.from) * k;
      setBeerLevel(this.mug, this.shown);
      if (k >= 1) this.drain = null;
    }
    if (!this.stick) return;
    if (!this.held) this.restStick();
    const burn = clamp((vt - this.smoking.litAt) / this.smoking.dur, 0, 1);
    setBurn(this.stick, burn, this.glow);
    if (burn >= 1) {
      this.putOut();
      return;
    }
    // Rauchfaden aus der Glut (Zigarre qualmt mehr)
    const cigar = this.smoking.kind === 'cigar';
    this.wispAcc += dt * (cigar ? 9 : 6) * (1 + this.glow * 2);
    if (this.wispAcc >= 1 && this.group.parent?.visible !== false) {
      this.group.updateWorldMatrix(true, true);
      this.emberWorld(_w);
      while (this.wispAcc >= 1) {
        this.wispAcc -= 1;
        smoke.wisp(_w, cigar ? 1.5 : 1);
      }
    }
    this.wispAcc = Math.min(this.wispAcc, 3);
  }
}

export { VICE };
