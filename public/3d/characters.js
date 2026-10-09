// Prozedurale Low-Poly-Kneipengäste aus Three.js-Grundkörpern (keine externen Modelle).
// Jeder Gast sitzt auf einem Stuhl, schaut +z (zum Tisch), hält seine Karten als Fächer
// und hat Idle-Animation (Atmen, Umschauen, Blinzeln) sowie Reaktionen.

import * as THREE from 'three';
import { rng, clamp, envelope, smooth } from './util.js';
import { backMaterial, cardGeometry } from './cards.js';
import { mergeStatic } from './merge.js';
import { loadModel, findBones, rotateWorld, aimBone, partOf } from './models.js';
import { figureByKey } from '../figures.js';
import { SeatProps, MUG_REST, ASH_REST, PACK_REST, makeFlame, smoke } from './props.js';

// ---------- Material- und Geometrie-Cache ----------
const mats = new Map();
export function flat(color, opts = {}) {
  const key = `${color}|${JSON.stringify(opts)}`;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });
    mats.set(key, m);
  }
  return m;
}

const G = new Map();
const geo = (key, make) => {
  let g = G.get(key);
  if (!g) G.set(key, (g = make()));
  return g;
};
const ICO1 = () => geo('ico1', () => new THREE.IcosahedronGeometry(1, 1));
const ICO0 = () => geo('ico0', () => new THREE.IcosahedronGeometry(1, 0));
const SPH = () => geo('sph', () => new THREE.SphereGeometry(1, 8, 6));
const HEMI = () => geo('hemi', () => new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2));
const BOX = () => geo('box', () => new THREE.BoxGeometry(1, 1, 1));
const CYL = (seg = 8) => geo(`cyl${seg}`, () => new THREE.CylinderGeometry(1, 1, 1, seg));
const CONE = (seg = 8) => geo(`cone${seg}`, () => new THREE.ConeGeometry(1, 1, seg));
const TORUS = (arc = Math.PI * 2) => geo(`torus${arc.toFixed(3)}`, () => new THREE.TorusGeometry(1, 0.22, 5, 12, arc));
const LIMB = (r1, r2, len) =>
  geo(`limb${r1}|${r2}|${len}`, () => new THREE.CylinderGeometry(r1, r2, len, 6).translate(0, -len / 2, 0));
const LATHE = (name, pts) =>
  geo(`lathe-${name}`, () => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 8));
const FAN_CARD = () => geo('fancard', () => cardGeometry().clone().translate(0, 0.5, 0));

function part(parent, geometry, color, { p, r, s, shadow = true, mat } = {}) {
  const m = new THREE.Mesh(geometry, mat ?? flat(color));
  if (p) m.position.set(p[0], p[1], p[2]);
  if (r) m.rotation.set(r[0], r[1], r[2]);
  if (s !== undefined) typeof s === 'number' ? m.scale.setScalar(s) : m.scale.set(s[0], s[1], s[2]);
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// ---------- Typen ----------
const HUMAN = ['#f1c7a5', '#e0ac85', '#c68b62', '#a06a45', '#6e4329'];
const PROFILES = {
  normal: [[0, 0], [0.22, 0], [0.25, 0.1], [0.25, 0.28], [0.24, 0.42], [0.19, 0.52], [0.08, 0.58], [0, 0.585]],
  stout: [[0, 0], [0.27, 0], [0.31, 0.14], [0.3, 0.3], [0.27, 0.44], [0.2, 0.53], [0.09, 0.58], [0, 0.585]],
  slim: [[0, 0], [0.19, 0], [0.21, 0.12], [0.21, 0.3], [0.21, 0.42], [0.17, 0.52], [0.07, 0.58], [0, 0.585]],
};
const SHOULDER = { normal: 0.25, stout: 0.29, slim: 0.215 };

export const ARCHETYPES = [
  { key: 'wizard', build: 'slim', skins: ['#f1c7a5', '#e0ac85'], cloths: ['#4b3a8c', '#2f5a8c', '#7a2f5a'], hair: '#ece8de', pants: '#2a2340' },
  { key: 'pirate', build: 'normal', skins: HUMAN, cloths: ['#e9e1cf'], sash: ['#a32626', '#2a5a9c', '#3a7a3a'], hair: '#1f1611', pants: '#2a2018' },
  { key: 'goblin', build: 'slim', skins: ['#7fa35a', '#8fb05e', '#6d9a4f'], cloths: ['#6b4a2b', '#4a5a2b', '#5a3a4a'], hair: '#2a1a0a', pants: '#3a2a18', headR: 0.19 },
  { key: 'dwarf', build: 'stout', skins: ['#e3a882', '#d09070', '#b47a58'], cloths: ['#7a4b2a', '#2f5a3a', '#8a2f2a'], hair: '#c0602a', pants: '#3a2a1a' },
  { key: 'witch', build: 'slim', skins: ['#f3d2bb', '#e8c0a0', '#c9e0b4'], cloths: ['#3a2a4a', '#24402e', '#5a1f2e'], hair: '#9a3a3a', pants: '#1d1826' },
  { key: 'gentleman', build: 'normal', skins: HUMAN, cloths: ['#2b2b33', '#3a2a2a', '#1f2a3a'], hair: '#3b2a1d', pants: '#1f1f24' },
  { key: 'cowboy', build: 'normal', skins: HUMAN, cloths: ['#8a5a32', '#5a6a7a', '#6a3a2a'], hair: '#4a2f1a', pants: '#3a4a6a' },
  { key: 'orc', build: 'stout', skins: ['#8a9a72', '#7a8a6a', '#96a07a'], cloths: ['#5b3b2b', '#3b3b3b', '#4a2a2a'], hair: '#1a1a1a', pants: '#2a2018' },
];

/** Index in ARCHETYPES zu einem Figuren-Schlüssel aus public/figures.js. */
export function archetypeIndex(key) {
  return Math.max(0, ARCHETYPES.findIndex((a) => a.key === key));
}

const DARK = '#2a1512';
// Reaktionen mit der rechten Hand an Krug oder Zigarette schließen sich gegenseitig aus
const HAND_ACTS = new Set(['drink', 'cheers', 'puff', 'light']);

/** Glatter Pfad durch Schlüsselpunkte [[tau, Vector3], …] (tau aufsteigend). */
function along(tau, keys, out) {
  if (tau <= keys[0][0]) return out.copy(keys[0][1]);
  for (let i = 1; i < keys.length; i++) {
    const [t1, p1] = keys[i];
    if (tau <= t1) {
      const [t0, p0] = keys[i - 1];
      return out.copy(p0).lerp(p1, smooth((tau - t0) / Math.max(t1 - t0, 1e-6)));
    }
  }
  return out.copy(keys.at(-1)[1]);
}
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _d = new THREE.Vector3();
const _pp = new THREE.Vector3();
const _u = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _f = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _mug = new THREE.Vector3();
const _hand = new THREE.Vector3();
const MOUTH = new THREE.Vector3(-0.03, 0.74, 0.2); // Krug am Mund (Körper-Koordinaten)
const TOAST = new THREE.Vector3(-0.1, 0.98, 0.5); // Krug zum Anstoßen hoch über den Tisch
const MOUTH_CIG = new THREE.Vector3(-0.05, 0.72, 0.25); // Zigarette an den Lippen (Körper-Koordinaten)
const HOLD_CIG = new THREE.Vector3(-0.2, 0.5, 0.36); // Zigarette locker in der Hand beim Ausatmen
const _ash = new THREE.Vector3();
const _pack = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _mq = new THREE.Quaternion();

export class Character {
  constructor(archIndex, seed) {
    const A = ARCHETYPES[archIndex % ARCHETYPES.length];
    const R = rng(seed);
    const pick = (arr) => arr[Math.floor(R() * arr.length)];
    this.A = A;
    this.skin = pick(A.skins);
    this.cloth = pick(A.cloths);
    this.accent = A.sash ? pick(A.sash) : '#e9c46a';
    this.phase = R() * 100;
    this.root = new THREE.Group();
    this.reactions = [];
    this.turn = false;
    this.turnSince = 0;
    this.count = 0;
    this.blinkAt = 1 + R() * 3;
    this.glanceAt = 0;
    this.lookGoal = new THREE.Vector3(0, 0.8, 0);
    this.look = new THREE.Vector3(0, 0.8, 0);
    this.focus = new THREE.Vector3(0, 0.8, 0);
    this.camPos = new THREE.Vector3(0, 1.4, 3);
    this.yaw = 0;
    this.pitch = 0.2;
    this.mood = 'neutral';
    this.remoteGoal = null; // echter Blick des Spielers (3D-Client), sonst null
    this.nextDrink = 0;
    this.nextPuff = 0;

    this.buildChair();
    this.buildBody(A);
    this.buildHead(A, R);
    this.left = this.buildArm(1);
    this.right = this.buildArm(-1);
    this.fan = new THREE.Group();
    this.body.add(this.fan);
    this.base = {
      left: new THREE.Vector3(0.11, 0.36, 0.36),
      right: new THREE.Vector3(-0.1, 0.33, 0.37),
    };
    this.labelAnchor = new THREE.Object3D();
    this.labelAnchor.position.set(0, this.topY + 0.16, 0);
    this.root.add(this.labelAnchor);
    // Unbewegte Teile zusammenfassen (Augenbrauen, Münder und Hände bleiben einzeln)
    mergeStatic(this.root, new Set([...this.brows, ...Object.values(this.mouth), this.left.hand, this.right.hand]));
    // Theke am Platz: Bier, Bierdeckel, Aschenbecher, Zigarette (erst nach dem Zusammenfassen,
    // weil sich daran ständig etwas ändert)
    this.props = new SeatProps();
    this.root.add(this.props.group);
    this.mug = this.props.mug;
    this.flame = makeFlame();
    this.flame.visible = false;
    this.root.add(this.flame);
    this.root.traverse((o) => (o.userData.character = this));
  }

  // ---------- Aufbau ----------
  buildChair() {
    const wood = '#4a2e1a';
    const dark = '#3a2213';
    const c = new THREE.Group();
    part(c, BOX(), wood, { p: [0, 0.44, -0.04], s: [0.52, 0.06, 0.48] });
    for (const [x, z] of [[-0.22, 0.16], [0.22, 0.16], [-0.22, -0.24], [0.22, -0.24]]) {
      part(c, BOX(), dark, { p: [x, 0.21, z], s: [0.05, 0.44, 0.05] });
    }
    for (const x of [-0.22, 0.22]) part(c, BOX(), dark, { p: [x, 0.78, -0.27], s: [0.05, 0.66, 0.05] });
    part(c, BOX(), wood, { p: [0, 1.06, -0.27], s: [0.56, 0.11, 0.06] });
    part(c, BOX(), wood, { p: [0, 0.84, -0.27], s: [0.44, 0.06, 0.04] });
    this.root.add(c);
  }

  buildBody(A) {
    const body = (this.body = new THREE.Group());
    body.position.set(0, 0.5, 0);
    this.root.add(body);
    const prof = PROFILES[A.build];
    this.shoulderW = SHOULDER[A.build];
    part(body, LATHE(A.build, prof), this.cloth, { s: [1, 1, 0.82] });
    // Beine (meist unter dem Tisch)
    for (const x of [-0.11, 0.11]) {
      part(this.root, BOX(), A.pants, { p: [x, 0.5, 0.17], s: [0.14, 0.13, 0.42] });
      part(this.root, BOX(), A.pants, { p: [x, 0.26, 0.36], s: [0.12, 0.46, 0.12] });
      part(this.root, BOX(), '#1f140c', { p: [x, 0.04, 0.4], s: [0.13, 0.08, 0.2] });
    }
    const top = prof.at(-2)[1];
    const k = A.key;
    if (k === 'pirate') {
      part(body, TORUS(), this.accent, { p: [0, 0.16, 0], r: [Math.PI / 2, 0, 0], s: [0.255, 0.21, 0.4] });
      part(body, BOX(), '#a07a5a', { p: [0, 0.42, 0.17], r: [0.3, 0, 0], s: [0.1, 0.12, 0.02] });
    } else if (k === 'wizard') {
      part(body, TORUS(), '#e9c46a', { p: [0, 0.01, 0], r: [Math.PI / 2, 0, 0], s: [0.21, 0.17, 0.3] });
      part(body, TORUS(), '#e9c46a', { p: [0, 0.5, 0], r: [Math.PI / 2, 0, 0], s: [0.17, 0.14, 0.4] });
      part(body, ICO0(), '#e9c46a', { p: [0.1, 0.36, 0.19], s: 0.035 });
    } else if (k === 'dwarf' || k === 'orc') {
      part(body, TORUS(), '#3a2414', { p: [0, 0.15, 0], r: [Math.PI / 2, 0, 0], s: [0.305, 0.25, 0.35] });
      part(body, BOX(), '#e9c46a', { p: [0, 0.15, 0.25], s: [0.08, 0.06, 0.03] });
      if (k === 'orc') part(body, HEMI(), '#8d959e', { p: [-0.22, 0.47, 0], r: [0, 0, 0.6], s: [0.12, 0.08, 0.12] });
    } else if (k === 'gentleman') {
      part(body, BOX(), '#f1ece0', { p: [0, 0.4, 0.15], r: [0.2, 0, 0], s: [0.12, 0.2, 0.04] });
      part(body, CONE(4), '#8f1d2c', { p: [0.04, 0.5, 0.17], r: [0, 0, -Math.PI / 2], s: [0.035, 0.07, 0.02] });
      part(body, CONE(4), '#8f1d2c', { p: [-0.04, 0.5, 0.17], r: [0, 0, Math.PI / 2], s: [0.035, 0.07, 0.02] });
    } else if (k === 'cowboy') {
      part(body, CONE(3), '#d8c8a8', { p: [0, 0.47, 0.155], r: [Math.PI, 0, 0], s: [0.07, 0.14, 0.03] });
      part(body, TORUS(), '#3a2414', { p: [0, 0.08, 0], r: [Math.PI / 2, 0, 0], s: [0.255, 0.21, 0.35] });
    } else if (k === 'witch') {
      part(body, ICO0(), '#4cc38a', { p: [0, 0.47, 0.16], s: 0.03, mat: flat('#4cc38a', { emissive: '#1a6a3a' }) });
      part(body, TORUS(), '#2a1a2a', { p: [0, 0.52, 0], r: [Math.PI / 2, 0, 0], s: [0.15, 0.12, 0.5] });
    } else if (k === 'goblin') {
      part(body, CONE(8), this.cloth, { p: [0, 0.5, -0.03], s: [0.27, 0.16, 0.24] });
    }
    this.neckY = top;
  }

  buildHead(A, R) {
    const HR = A.headR ?? 0.2;
    this.HR = HR;
    const neck = (this.neck = new THREE.Group());
    neck.position.set(0, 0.55, 0);
    this.body.add(neck);
    part(neck, CYL(6), this.skin, { p: [0, 0.04, 0], s: [0.07, 0.1, 0.07] });
    const head = (this.head = new THREE.Group());
    head.position.set(0, 0.07, 0);
    head.rotation.order = 'YXZ';
    neck.add(head);
    const cy = HR * 0.92;
    part(head, ICO1(), this.skin, { p: [0, cy, 0], s: [HR, HR * 1.06, HR * 0.96] });
    const face = (this.face = new THREE.Group());
    face.position.set(0, cy, 0);
    head.add(face);
    const fz = HR * 0.84;
    const k = A.key;

    // Augen
    const sclera = k === 'goblin' ? '#f0e070' : '#f6f2e8';
    this.eyes = [];
    for (const sx of [-1, 1]) {
      const e = new THREE.Group();
      e.position.set(sx * HR * 0.37, HR * 0.14, fz);
      face.add(e);
      part(e, SPH(), sclera, { s: [HR * 0.21, HR * 0.23, HR * 0.13], shadow: false });
      part(e, SPH(), '#1a1210', { p: [0, -HR * 0.01, HR * 0.1], s: [HR * 0.1, HR * 0.12, HR * 0.06], shadow: false });
      this.eyes.push(e);
    }
    if (k === 'pirate') {
      // Augenklappe über dem rechten Auge
      part(face, CYL(8), '#111', { p: [-HR * 0.37, HR * 0.14, fz + 0.012], r: [Math.PI / 2, 0, 0], s: [HR * 0.25, 0.02, HR * 0.25] });
      part(face, TORUS(), '#111', { p: [0, HR * 0.32, 0], r: [0.25, 0, 0], s: [HR * 0.99, HR * 0.99, 0.04] });
      this.eyes[0].visible = false;
    }
    // Augenbrauen
    const browColor = k === 'wizard' ? '#f4f1ea' : k === 'dwarf' ? A.hair : k === 'orc' ? '#1a1a1a' : DARK;
    const browW = k === 'wizard' || k === 'dwarf' || k === 'orc' ? 1.5 : 1;
    this.brows = [-1, 1].map((sx) =>
      part(face, BOX(), browColor, { p: [sx * HR * 0.37, HR * 0.43, fz + 0.005], s: [HR * 0.4 * browW, HR * 0.09 * browW, 0.03], shadow: false }),
    );
    this.brows.forEach((b, i) => (b.userData.sx = i === 0 ? -1 : 1));

    // Nase
    const nz = HR * 0.93;
    if (k === 'goblin') part(face, CONE(6), this.skin, { p: [0, -HR * 0.05, nz + 0.06], r: [Math.PI / 2 - 0.25, 0, 0], s: [0.045, 0.2, 0.045] });
    else if (k === 'witch' || k === 'wizard') part(face, CONE(6), this.skin, { p: [0, -HR * 0.06, nz + 0.03], r: [Math.PI / 2 + 0.3, 0, 0], s: [0.035, 0.12, 0.04] });
    else if (k === 'orc') part(face, SPH(), this.skin, { p: [0, -HR * 0.08, nz], s: [0.06, 0.04, 0.04] });
    else part(face, ICO0(), this.skin, { p: [0, -HR * 0.08, nz], s: [0.045, 0.05, 0.045] });

    // Mund (vier Varianten für Mimik)
    const lip = k === 'witch' ? '#a8243a' : '#4a1d1a';
    const mouth = new THREE.Group();
    mouth.position.set(0, -HR * 0.45, fz - 0.005);
    face.add(mouth);
    this.mouth = {
      neutral: part(mouth, BOX(), lip, { s: [HR * 0.38, 0.014, 0.03], shadow: false }),
      smile: part(mouth, TORUS(Math.PI), lip, { p: [0, 0.02, 0], r: [0, 0, Math.PI], s: [HR * 0.2, HR * 0.2, 0.02], shadow: false }),
      frown: part(mouth, TORUS(Math.PI), lip, { p: [0, -0.025, 0], s: [HR * 0.18, HR * 0.15, 0.02], shadow: false }),
      open: part(mouth, SPH(), '#3a0f0f', { s: [HR * 0.17, HR * 0.15, 0.03], shadow: false }),
    };
    this.setMouth('smile');
    if (k === 'orc') {
      for (const sx of [-1, 1]) part(face, CONE(5), '#f2ead6', { p: [sx * HR * 0.25, -HR * 0.38, fz + 0.02], s: [0.018, 0.06, 0.018] });
    }

    // Ohren
    if (k === 'goblin') {
      for (const sx of [-1, 1]) part(face, CONE(5), this.skin, { p: [sx * HR * 1.25, HR * 0.15, -0.02], r: [0, 0, -sx * 1.25], s: [0.06, 0.26, 0.03] });
    } else if (k === 'orc') {
      for (const sx of [-1, 1]) part(face, CONE(5), this.skin, { p: [sx * HR * 1.05, HR * 0.1, -0.02], r: [0, 0, -sx * 1.1], s: [0.04, 0.12, 0.025] });
    } else if (k !== 'witch') {
      for (const sx of [-1, 1]) part(face, ICO0(), this.skin, { p: [sx * HR * 0.98, 0, 0], s: [0.03, 0.055, 0.04] });
      if (k === 'pirate') part(face, TORUS(), '#e9c46a', { p: [HR * 1.0, -0.06, 0.01], r: [0, Math.PI / 2, 0], s: 0.02 });
    }

    // Haare, Bärte, Hüte
    const top = cy + HR * 1.06; // Scheitel relativ zum Kopf
    let hatTop = top;
    const hair = A.hair;
    if (k === 'wizard') {
      part(face, CONE(7), hair, { p: [0, -HR * 1.12, HR * 0.5], r: [Math.PI + 0.25, 0, 0], s: [HR * 0.8, HR * 1.8, HR * 0.55] });
      for (const sx of [-1, 1]) part(face, CONE(5), hair, { p: [sx * HR * 0.18, -HR * 0.32, fz + 0.01], r: [0, 0, sx * 1.9], s: [0.03, 0.12, 0.025] });
      part(head, CYL(10), '#2f2a6b', { p: [0, top - 0.03, 0], s: [HR * 1.4, 0.025, HR * 1.4] });
      const hat = new THREE.Group();
      hat.position.set(0, top - 0.03, 0);
      hat.rotation.set(-0.18, 0, 0.08);
      head.add(hat);
      part(hat, CONE(8), '#2f2a6b', { p: [0, 0.24, 0], s: [HR * 0.95, 0.48, HR * 0.95] });
      part(hat, CYL(8), '#e9c46a', { p: [0, 0.035, 0], s: [HR * 0.93, 0.04, HR * 0.93] });
      part(hat, ICO0(), '#e9c46a', { p: [0.06, 0.2, HR * 0.6], s: 0.035, mat: flat('#e9c46a', { emissive: '#6a5010' }) });
      hatTop = top + 0.45;
    } else if (k === 'pirate') {
      part(face, CONE(6), hair, { p: [0, -HR * 0.82, HR * 0.6], r: [Math.PI + 0.2, 0, 0], s: [HR * 0.25, HR * 0.4, HR * 0.2] });
      // Dreispitz: Kuppel in einer nach oben aufgeklappten, dreieckigen Krempe (Spitze nach vorn)
      const hat = new THREE.Group();
      hat.position.set(0, top - 0.08, 0);
      hat.rotation.x = -0.1;
      head.add(hat);
      part(hat, HEMI(), '#1f1a17', { p: [0, 0.02, 0], s: [HR * 0.98, HR * 0.95, HR * 0.98] });
      const TRI = geo('tricorn', () => new THREE.CylinderGeometry(1.3, 1, 1, 3));
      part(hat, TRI, '#1f1a17', { p: [0, 0.05, 0], s: [HR * 1.3, 0.11, HR * 1.3] });
      part(hat, TRI, '#e9c46a', { p: [0, 0.108, 0], s: [HR * 1.35, 0.012, HR * 1.35] });
      hatTop = top + 0.16;
    } else if (k === 'goblin') {
      const hood = part(head, SPH(), this.cloth, { p: [0, cy + 0.02, -0.04], s: [HR * 1.14, HR * 1.16, HR * 1.08] });
      hood.material = flat(this.cloth, { side: THREE.BackSide });
      part(head, HEMI(), this.cloth, { p: [0, cy + 0.03, -0.03], r: [-0.5, 0, 0], s: [HR * 1.12, HR * 1.12, HR * 1.06] });
      hatTop = top + 0.04;
    } else if (k === 'dwarf') {
      part(face, ICO1(), hair, { p: [0, -HR * 0.75, HR * 0.55], s: [HR * 0.95, HR * 0.8, HR * 0.6] });
      part(face, CONE(6), hair, { p: [0, -HR * 1.5, HR * 0.6], r: [Math.PI + 0.15, 0, 0], s: [HR * 0.6, HR * 0.9, HR * 0.4] });
      for (const sx of [-1, 1]) part(face, CONE(5), hair, { p: [sx * HR * 0.2, -HR * 0.3, fz + 0.02], r: [0, 0, sx * 1.8], s: [0.04, 0.14, 0.03] });
      part(head, HEMI(), '#8d959e', { p: [0, cy + HR * 0.42, -0.01], r: [-0.12, 0, 0], s: [HR * 1.06, HR * 0.95, HR * 1.04] });
      part(head, TORUS(), '#6d757e', { p: [0, cy + HR * 0.44, -0.01], r: [Math.PI / 2 - 0.12, 0, 0], s: [HR * 1.04, HR * 1.0, 0.12] });
      for (const sx of [-1, 1]) {
        part(head, CONE(6), '#efe6cf', { p: [sx * HR * 1.12, cy + HR * 0.9, 0], r: [0, 0, -sx * 0.75], s: [0.05, 0.22, 0.05] });
      }
      hatTop = top + 0.12;
    } else if (k === 'witch') {
      part(head, BOX(), hair, { p: [0, cy - HR * 0.6, -HR * 0.55], s: [HR * 2.0, HR * 2.6, HR * 0.6] });
      part(head, HEMI(), hair, { p: [0, cy + 0.01, -0.02], r: [-0.75, 0, 0], s: [HR * 1.06, HR * 1.08, HR * 1.02] });
      part(head, CYL(12), '#1d1826', { p: [0, top - 0.02, 0], s: [HR * 1.55, 0.022, HR * 1.55] });
      const hat = new THREE.Group();
      hat.position.set(0, top - 0.01, 0);
      head.add(hat);
      part(hat, CONE(8), '#1d1826', { p: [0, 0.16, 0], s: [HR * 0.95, 0.32, HR * 0.95] });
      part(hat, CONE(6), '#1d1826', { p: [0.04, 0.38, -0.04], r: [-0.5, 0, -0.4], s: [HR * 0.38, 0.2, HR * 0.38] });
      part(hat, CYL(8), '#7a3fa0', { p: [0, 0.03, 0], s: [HR * 0.93, 0.04, HR * 0.93] });
      hatTop = top + 0.45;
    } else if (k === 'gentleman') {
      for (const sx of [-1, 1]) {
        part(face, CONE(5), hair, { p: [sx * HR * 0.22, -HR * 0.3, fz + 0.02], r: [0, 0, sx * 2.1], s: [0.03, 0.13, 0.025] });
      }
      part(face, TORUS(), '#e9c46a', { p: [HR * 0.37, HR * 0.14, fz + 0.04], s: [HR * 0.26, HR * 0.26, 0.15] });
      part(head, HEMI(), hair, { p: [0, cy - 0.01, -0.02], r: [-0.8, 0, 0], s: [HR * 1.05, HR * 0.95, HR * 1.02] });
      part(head, CYL(12), '#1a1a1f', { p: [0, top - 0.05, 0], s: [HR * 1.45, 0.02, HR * 1.45] });
      part(head, CYL(10), '#1a1a1f', { p: [0, top + 0.1, 0], s: [HR * 0.82, 0.3, HR * 0.82] });
      part(head, CYL(10), '#7a1d2c', { p: [0, top - 0.01, 0], s: [HR * 0.84, 0.05, HR * 0.84] });
      hatTop = top + 0.25;
    } else if (k === 'cowboy') {
      part(face, BOX(), hair, { p: [0, -HR * 0.28, fz + 0.025], s: [HR * 0.7, 0.04, 0.04] });
      part(face, CONE(4), this.accent === '#e9c46a' ? '#b8322f' : '#b8322f', { p: [0, -HR * 1.25, HR * 0.6], r: [Math.PI + 0.3, Math.PI / 4, 0], s: [HR * 0.6, HR * 0.5, HR * 0.3] });
      part(head, CYL(12), '#6b4a2a', { p: [0, top - 0.05, 0], s: [HR * 1.6, 0.02, HR * 1.45] });
      part(head, CYL(8), '#6b4a2a', { p: [0, top + 0.03, 0], s: [HR * 0.85, 0.17, HR * 0.95] });
      part(head, CYL(8), '#2a1a0f', { p: [0, top - 0.03, 0], s: [HR * 0.87, 0.04, HR * 0.97] });
      hatTop = top + 0.13;
    } else if (k === 'orc') {
      for (let i = 0; i < 5; i++) {
        part(head, BOX(), hair, { p: [0, top - 0.01 + Math.sin((i / 4) * Math.PI) * 0.02, HR * (0.6 - i * 0.3)], s: [0.04, 0.08, 0.07] });
      }
      hatTop = top + 0.06;
    }
    this.topY = 0.5 + 0.55 + 0.07 + hatTop; // Weltkoordinate relativ zum Stuhlboden
  }

  /** Mittelpunkt des Kopfes in Weltkoordinaten (für Blickkontakt). */
  headWorld(out = new THREE.Vector3()) {
    return this.face.getWorldPosition(out);
  }

  /** Mund in Weltkoordinaten (hier kommt der Rauch heraus). */
  mouthWorld(out = new THREE.Vector3()) {
    return this.face.localToWorld(out.set(0, -this.HR * 0.45, this.HR * 0.95));
  }

  buildArm(side) {
    const sh = new THREE.Group();
    sh.position.set(side * this.shoulderW, 0.45, 0);
    this.body.add(sh);
    part(sh, ICO0(), this.cloth, { s: 0.075 });
    const L1 = 0.27;
    const L2 = 0.26;
    part(sh, LIMB(0.062, 0.052, L1), this.cloth);
    const elbow = new THREE.Group();
    elbow.position.y = -L1;
    sh.add(elbow);
    part(elbow, LIMB(0.052, 0.045, L2), this.cloth);
    const cuffColor = this.A.key === 'wizard' ? '#e9c46a' : this.A.key === 'gentleman' ? '#f1ece0' : this.cloth;
    part(elbow, CYL(6), cuffColor, { p: [0, -L2 + 0.02, 0], s: [0.05, 0.035, 0.05] });
    const hand = part(elbow, ICO0(), this.skin, { p: [0, -L2 - 0.035, 0], s: [0.052, 0.06, 0.045] });
    return { sh, elbow, hand, L1, L2: L2 + 0.035, side, target: new THREE.Vector3(), pole: new THREE.Vector3(side, -0.7, -0.45).normalize() };
  }

  // ---------- Steuerung ----------
  setMouth(kind) {
    for (const [k, m] of Object.entries(this.mouth)) m.visible = k === kind;
  }

  setCardCount(n) {
    n = Math.max(0, Math.min(n, 20));
    if (n === this.count) return;
    this.count = n;
    this.fan.clear();
    const spread = Math.min(0.17, 1.3 / Math.max(n, 1));
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(FAN_CARD(), backMaterial());
      m.castShadow = true;
      m.scale.setScalar(0.17);
      m.rotation.z = -(i - (n - 1) / 2) * spread;
      m.position.set(0, 0, i * 0.0025);
      this.fan.add(m);
    }
  }

  /** Weltposition der obersten Karte im Fächer (für fliegende Karten). */
  fanWorld(out = new THREE.Vector3()) {
    return this.fan.localToWorld(out.set(0, 0.09, 0.02));
  }

  setTurn(on, t) {
    if (on && !this.turn) this.turnSince = t;
    this.turn = on;
  }

  /**
   * Reaktion abspielen: play, bid, win, happy, sad, cheer, trump, wave, shock, drink
   * sowie die Emotes cheers (Prost), knock (auf den Tisch klopfen), facepalm, laugh und von
   * der Theke puff (Zug an der Zigarette) und light (Zigarette/Zigarre anzünden).
   */
  react(type, t, opts = {}) {
    const dur = {
      play: 0.8, bid: 1.5, win: 1.6, happy: 1.5, sad: 2.2, cheer: 3.6, trump: 1.6, wave: 1.8, shock: 1.1,
      drink: 2.8, cheers: 3.4, knock: 1.3, facepalm: 1.9, laugh: 2.1, puff: 3.8, light: 3.6,
    }[type] ?? 1;
    // Krug- und Zigaretten-Reaktionen schließen sich gegenseitig aus
    if (HAND_ACTS.has(type)) this.reactions = this.reactions.filter((r) => !HAND_ACTS.has(r.type));
    // gleiche Reaktion nicht stapeln
    this.reactions = this.reactions.filter((r) => r.type !== type);
    this.reactions.push({ type, t0: t + (opts.delay ?? 0), dur, target: opts.target?.clone() });
  }

  // ---------- Animation ----------
  update(t, dt) {
    const ph = this.phase;
    const breath = Math.sin(t * 1.7 + ph);
    let lean = 0.05 + 0.02 * Math.sin(t * 0.55 + ph);
    let roll = 0.025 * Math.sin(t * 0.43 + ph * 1.3);
    let bodyY = 0.5 + breath * 0.004;
    let headPitch = 0;
    let headRoll = 0;
    let browLift = 0;
    let browTilt = 0;
    let mouth = 'smile';
    const L = this.left.target.copy(this.base.left);
    const Rh = this.right.target.copy(this.base.right);
    let mugHeld = 0;
    let mugTilt = 0;
    let cigHeld = false;
    let inhale = 0;
    let flame = 0;
    const props = this.props;
    // Ab und zu einen Schluck nehmen bzw. ziehen (nicht, wenn gerade etwas anderes passiert)
    if (!this.nextDrink) this.nextDrink = t + 6 + Math.random() * 30;
    if (t > this.nextDrink) {
      this.nextDrink = t + 22 + Math.random() * 40;
      if (!this.turn && !this.reactions.length && props.canDrink()) this.react('drink', t);
    }
    if (props.isSmoking()) {
      if (!this.nextPuff) this.nextPuff = t + 5 + Math.random() * 10;
      if (t > this.nextPuff) {
        this.nextPuff = t + 14 + Math.random() * 22;
        if (!this.turn && !this.reactions.length) this.react('puff', t);
      }
    }
    // Krugplatz in Körper-Koordinaten (Ziel für die rechte Hand)
    this.body.updateWorldMatrix(true, false);
    const mugBody = this.body.worldToLocal(this.root.localToWorld(_mug.copy(MUG_REST)));
    mugBody.y += 0.06;
    mugBody.x += 0.035;
    L.y += 0.008 * Math.sin(t * 1.1 + ph);
    Rh.y += 0.01 * Math.sin(t * 1.3 + ph + 1);

    // Am Zug: nachdenken, Hand ans Kinn
    if (this.turn) {
      const w = smooth(clamp((t - this.turnSince - 0.9) / 0.6, 0, 1));
      Rh.lerp(_v.set(-0.04, 0.6, 0.21), w);
      headRoll += 0.12 * w;
      headPitch += 0.08 * w;
      browTilt += 0.3 * w;
      lean += 0.06 * w;
      mouth = w > 0.5 ? 'neutral' : mouth;
    }

    for (const rx of this.reactions) {
      const tau = (t - rx.t0) / rx.dur;
      if (tau < 0) continue;
      const e = envelope(tau, 0.22);
      switch (rx.type) {
        case 'play': {
          const reach = Math.sin(Math.min(tau, 1) * Math.PI);
          if (rx.target) {
            this.body.worldToLocal(_v2.copy(rx.target));
            _v2.y += 0.05;
            Rh.lerp(_v2, reach * 0.85);
          }
          lean += 0.2 * reach;
          headPitch += 0.15 * reach;
          break;
        }
        case 'bid':
          Rh.lerp(_v.set(-0.24, 0.88, 0.22), e);
          headPitch += -0.1 * Math.sin(tau * Math.PI * 4) * e;
          mouth = tau < 0.65 ? (Math.sin(tau * 28) > 0 ? 'open' : 'neutral') : 'smile';
          browLift += 0.012 * e;
          break;
        case 'trump':
          Rh.lerp(_v.set(-0.08, 0.5, 0.55), e);
          mouth = tau < 0.6 ? (Math.sin(tau * 28) > 0 ? 'open' : 'neutral') : 'smile';
          lean += 0.1 * e;
          break;
        case 'win': {
          const pump = Math.sin(tau * Math.PI * 6) * 0.06;
          Rh.lerp(_v.set(-0.3, 1.0 - pump, 0.12), e);
          bodyY += 0.035 * e * Math.abs(Math.sin(tau * Math.PI * 3));
          headPitch -= 0.25 * e;
          lean -= 0.12 * e;
          mouth = 'open';
          browLift += 0.02 * e;
          break;
        }
        case 'cheer': {
          const pump = Math.sin(tau * Math.PI * 10) * 0.07;
          L.lerp(_v.set(0.26, 1.05 + pump, 0.1), e);
          Rh.lerp(_v.set(-0.26, 1.05 - pump, 0.1), e);
          bodyY += 0.05 * e * Math.abs(Math.sin(tau * Math.PI * 5));
          headPitch -= 0.3 * e;
          mouth = 'open';
          browLift += 0.02 * e;
          break;
        }
        case 'happy':
          headPitch += 0.14 * Math.sin(tau * Math.PI * 4) * e;
          mouth = 'smile';
          browLift += 0.015 * e;
          break;
        case 'sad':
          headPitch += 0.35 * e;
          lean += 0.12 * e;
          bodyY -= 0.025 * e;
          Rh.lerp(_v.set(-0.16, 0.26, 0.42), e);
          mouth = 'frown';
          browTilt -= 0.45 * e;
          headRoll += 0.08 * Math.sin(tau * Math.PI * 3) * e;
          break;
        case 'shock':
          lean -= 0.15 * e;
          mouth = 'open';
          browLift += 0.025 * e;
          headPitch -= 0.08 * e;
          break;
        case 'wave':
          Rh.lerp(_v.set(-0.3 + Math.sin(tau * 22) * 0.07, 0.92, 0.18), e);
          mouth = 'smile';
          break;
        case 'drink':
        case 'cheers': {
          // Hand → Krug → (hoch zum Anstoßen →) Mund, trinken, zurückstellen
          const keys = rx.type === 'drink'
            ? [[0, this.base.right], [0.18, mugBody], [0.34, MOUTH], [0.64, MOUTH], [0.8, mugBody], [1, this.base.right]]
            : [[0, this.base.right], [0.12, mugBody], [0.28, TOAST], [0.46, TOAST], [0.6, MOUTH], [0.78, MOUTH], [0.9, mugBody], [1, this.base.right]];
          const [grab, drinkFrom, drinkTo, release] = rx.type === 'drink' ? [0.18, 0.34, 0.64, 0.8] : [0.12, 0.6, 0.78, 0.9];
          along(tau, keys, Rh);
          if (rx.type === 'cheers' && tau > 0.28 && tau < 0.46) Rh.y += Math.sin((tau - 0.28) * Math.PI * 11) * 0.03;
          if (tau >= grab && tau <= release) mugHeld = Math.max(mugHeld, 1);
          if (tau > drinkFrom && tau < drinkTo) {
            const d = envelope((tau - drinkFrom) / (drinkTo - drinkFrom), 0.3);
            mugTilt = 1.1 * d;
            headPitch -= 0.32 * d;
            mouth = 'open';
          } else if (rx.type === 'cheers' && tau > 0.2 && tau < 0.5) {
            mouth = 'open';
            browLift += 0.02;
            headPitch -= 0.12;
          }
          lean += 0.05 * e;
          break;
        }
        case 'puff':
        case 'light': {
          // Hand → Aschenbecher (bzw. Schachtel) → Lippen, ziehen → Hand runter, ausatmen → zurück
          if (!props.isSmoking()) break;
          const fromPack = rx.type === 'light' && props.smoking.kind === 'cigarette';
          const pick = this.body.worldToLocal(this.root.localToWorld(fromPack ? _pack.copy(PACK_REST).setY(PACK_REST.y + 0.05) : _ash.copy(ASH_REST).add(_v2.set(-0.02, 0.045, -0.015))));
          const ashBody = this.body.worldToLocal(this.root.localToWorld(_ash.copy(ASH_REST).add(_v2.set(-0.02, 0.045, -0.015))));
          const keys = [[0, this.base.right], [0.16, pick], [0.34, MOUTH_CIG], [0.58, MOUTH_CIG], [0.7, HOLD_CIG], [0.86, HOLD_CIG], [0.95, ashBody], [1, this.base.right]];
          along(tau, keys, Rh);
          if (tau >= 0.16 && tau <= 0.95) cigHeld = true;
          if (tau > 0.34 && tau < 0.58) {
            inhale = envelope((tau - 0.34) / 0.24, 0.3);
            headPitch -= 0.06 * inhale;
            mouth = 'neutral';
            browTilt -= 0.15 * inhale;
          }
          if (rx.type === 'light' && tau > 0.3 && tau < 0.5) flame = envelope((tau - 0.3) / 0.2, 0.15);
          const out = envelope((tau - 0.6) / 0.32, 0.25);
          headPitch -= 0.16 * out;
          if (out > 0.2) mouth = 'open';
          if (tau > 0.62 && !rx.exhaled) {
            rx.exhaled = true;
            this.exhale(props.smoking.kind === 'cigar' ? 1.4 : 1);
          }
          lean += 0.04 * e;
          break;
        }
        case 'knock': {
          // drei Schläge mit der Faust auf den Tisch (bei 0,35 / 0,55 / 0,75 s)
          const s = tau * rx.dur;
          const lift = 0.17 * (s < 0.25 || s > 0.85 ? 1 : Math.abs(Math.cos(((s - 0.25) / 0.2) * Math.PI)));
          // Ziel über der Tischplatte (Stuhl-Koordinaten) → Körper-Koordinaten (der Körper ist vorgebeugt)
          this.body.worldToLocal(this.root.localToWorld(_v.set(-0.12, MUG_REST.y + 0.045 + lift, 0.6)));
          Rh.lerp(_v, e);
          lean += 0.14 * e;
          headPitch += 0.12 * e;
          browTilt += 0.35 * e;
          mouth = 'neutral';
          break;
        }
        case 'facepalm':
          Rh.lerp(_v.set(-0.02, 0.79, 0.2), e);
          headPitch += 0.3 * e;
          headRoll += 0.07 * Math.sin(tau * Math.PI * 5) * e;
          browTilt -= 0.4 * e;
          mouth = 'frown';
          lean += 0.08 * e;
          break;
        case 'laugh':
          headPitch -= 0.28 * e;
          bodyY += 0.012 * e * Math.sin(tau * Math.PI * 16);
          lean -= 0.08 * e;
          L.lerp(_v.set(0.08, 0.2, 0.25), e * 0.6);
          Rh.lerp(_v.set(-0.08, 0.22, 0.26), e);
          mouth = 'open';
          browLift += 0.02 * e;
          break;
      }
    }
    this.reactions = this.reactions.filter((r) => t - r.t0 < r.dur);

    // Körper
    const b = this.body;
    b.position.y = bodyY;
    b.rotation.set(lean, 0, roll);
    b.scale.set(1 + breath * 0.007, 1 + breath * 0.01, 1 + breath * 0.007);

    // Arme
    this.solveArm(this.left);
    this.solveArm(this.right);

    // Krug: auf dem Tisch oder in der rechten Hand
    if (mugHeld || cigHeld) {
      this.right.hand.updateWorldMatrix(true, false);
      this.root.worldToLocal(this.right.hand.getWorldPosition(_hand));
    }
    // Zigarette: in der Hand (Glut nach vorn) oder im Aschenbecher (macht props.update)
    props.held = cigHeld && props.isSmoking();
    props.glow = inhale;
    if (props.held) {
      props.stick.position.set(_hand.x - 0.01, _hand.y + 0.01, _hand.z + 0.02);
      props.stick.rotation.set(0, -Math.PI / 2 + 0.35, -0.12 - inhale * 0.1);
    }
    this.flame.visible = flame > 0.05 && props.held;
    if (this.flame.visible) {
      props.stick.updateMatrixWorld(true);
      this.root.worldToLocal(props.emberWorld(this.flame.position));
      this.flame.position.y -= 0.03;
      this.flame.scale.setScalar(flame * (0.9 + Math.sin(t * 40) * 0.1));
    }
    if (mugHeld) {
      this.mug.position.set(_hand.x - 0.035, _hand.y - 0.065, _hand.z);
      this.mug.rotation.set(-mugTilt, 2.4, 0);
    } else {
      this.mug.position.copy(MUG_REST);
      this.mug.rotation.set(0, 2.4, 0);
    }

    // Kartenfächer bleibt in der linken Hand (die nur beim großen Jubel mit hochgeht)
    this.fan.position.set(L.x - 0.03, L.y + 0.02, L.z + 0.03);
    this.fan.rotation.set(-0.35, 0, 0.1);
    this.fan.visible = this.count > 0;

    // Blick: echter Blick des Spielers (3D-Client) oder umherschauen
    if (this.remoteGoal) {
      this.lookGoal.copy(this.remoteGoal);
    } else {
      if (t > this.glanceAt) {
        const r = Math.random();
        if (r < 0.55) this.lookGoal.copy(this.focus);
        else if (r < 0.8) this.lookGoal.copy(this.camPos);
        else this.lookGoal.set((Math.random() - 0.5) * 4, 0.8 + Math.random() * 1.2, (Math.random() - 0.5) * 4);
        this.glanceAt = t + 1.4 + Math.random() * 2.8;
      }
      if (this.turn) this.lookGoal.copy(this.fanWorld(_v));
    }
    const k = 1 - Math.exp(-dt * (this.remoteGoal ? 7 : 5));
    this.look.lerp(this.lookGoal, k);
    this.neck.updateWorldMatrix(true, false);
    this.neck.worldToLocal(_v.copy(this.look));
    _v.y -= 0.07 + this.HR * 0.92;
    const yaw = clamp(Math.atan2(_v.x, _v.z), -1.0, 1.0);
    const pitch = clamp(Math.atan2(-_v.y, Math.hypot(_v.x, _v.z)), -0.45, 0.5);
    this.yaw += (yaw - this.yaw) * k;
    this.pitch += (pitch - this.pitch) * k;
    this.head.rotation.set(this.pitch + headPitch, this.yaw, headRoll);

    // Blinzeln
    let eyeY = 1;
    if (t > this.blinkAt) {
      const bt = t - this.blinkAt;
      eyeY = bt < 0.13 ? 0.12 : 1;
      if (bt > 0.13) this.blinkAt = t + 1.8 + Math.random() * 3.5;
    }
    for (const e of this.eyes) e.scale.y = eyeY;

    // Mimik
    for (const br of this.brows) {
      br.position.y = this.HR * 0.43 + browLift;
      br.rotation.z = br.userData.sx * browTilt * 0.5;
    }
    this.setMouth(mouth);
  }

  /** Rauch ausatmen: aus dem Mund nach vorn und etwas nach oben. */
  exhale(amount = 1) {
    this.root.updateMatrixWorld(true);
    const m = this.mouthWorld(new THREE.Vector3());
    this.root.getWorldQuaternion(_mq);
    _fwd.set(0, 0.35, 1).applyQuaternion(_mq);
    smoke.exhale(m, _fwd, { amount });
  }

  /** Zwei-Knochen-IK: Hand an arm.target (im Körper-Raum), Ellbogen Richtung arm.pole. */
  solveArm(arm) {
    const S = arm.sh.position;
    _d.subVectors(arm.target, S);
    const L1 = arm.L1;
    const L2 = arm.L2;
    const D = clamp(_d.length(), 0.08, (L1 + L2) * 0.999);
    _d.normalize();
    const cosA = clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1);
    const A = Math.acos(cosA);
    _pp.copy(arm.pole).addScaledVector(_d, -arm.pole.dot(_d));
    if (_pp.lengthSq() < 1e-6) _pp.set(0, -1, 0).addScaledVector(_d, _d.y);
    _pp.normalize();
    _u.copy(_d).multiplyScalar(Math.cos(A)).addScaledVector(_pp, Math.sin(A)); // Oberarm-Richtung
    _y.copy(_u).negate();
    _x.crossVectors(_d, _pp).normalize();
    _z.crossVectors(_x, _y).normalize();
    _m.makeBasis(_x, _y, _z);
    arm.sh.quaternion.setFromRotationMatrix(_m);
    // Unterarm: vom Ellbogen zum (begrenzten) Ziel, im Schulter-Raum ausgedrückt
    _f.copy(_d).multiplyScalar(D).addScaledVector(_u, -L1).normalize();
    const fy = _f.dot(_y);
    const fz = _f.dot(_z);
    arm.elbow.rotation.set(Math.atan2(-fz, -fy), 0, 0);
  }
}

// ---------- Figuren aus 3D-Modellen ----------
const _w = new THREE.Vector3();
const _w2 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _rq = new THREE.Quaternion();
const _rqi = new THREE.Quaternion();
const _cq = new THREE.Quaternion();
const _hq = new THREE.Quaternion();
const _nq = new THREE.Quaternion();
const _sq = new THREE.Quaternion();
const _eu = new THREE.Euler();
const HIP = new THREE.Vector3(0, 0.56, 0.0); // Hüftgelenke auf dem Stuhl (Stuhl-Koordinaten)
const SEAT_TOP = 0.47; // Sitzfläche (für Figuren ohne Beine)
const PALM = 0.07; // vom Handgelenk bis zur Handmitte (dorthin zielen die Handziele der Puppe)

/** Neue Figur zum Schlüssel aus public/figures.js. */
export function makeCharacter(key, seed) {
  const fig = figureByKey[key];
  if (fig?.model) return new ModelCharacter(fig, seed);
  return new Character(archetypeIndex(key), seed);
}

/**
 * Figur aus einem glTF-Modell. Darunter steckt eine unsichtbare Low-Poly-Puppe, die wie
 * jede andere Figur schaut, reagiert und Handziele hat; ihre Bewegung wird jeden Frame auf
 * die Knochen des Modells übertragen (Wirbelsäule, Hals/Kopf, Arme per IK). Stuhl, Krug und
 * Kartenfächer der Puppe bleiben sichtbar. Bis das Modell geladen ist, sieht man die Puppe.
 */
export class ModelCharacter extends Character {
  constructor(fig, seed) {
    super(archetypeIndex(fig.fallback), seed);
    this.fig = fig;
    this.rig = null;
    // Ruhehaltung der Hände pro Figur verschieben ([außen, hoch, vor]), z. B. damit kleine
    // Figuren ihre Karten nicht vor dem Gesicht halten
    if (fig.hands) {
      const [x, y, z] = fig.hands;
      this.base.left.add(_w.set(x, y, z));
      this.base.right.add(_w.set(-x, y, z));
    }
    loadModel(`models/${fig.model}.glb`, { height: fig.height, rig: fig.rig, hide: fig.hide })
      .then((model) => this.attachModel(model))
      .catch((err) => console.warn(`Modell ${fig.model} lädt nicht, bleibe bei der Ersatzfigur`, err));
  }

  attachModel(model) {
    this.blob = this.fig.pose === 'blob'; // Figur ohne richtige Beine: nur auf den Stuhl setzen
    const { bones, missing } = findBones(model, this.fig.bones, { legs: !this.blob });
    if (missing.length) return console.warn(`Modell ${this.fig.model}: Knochen fehlen`, missing);
    for (const c of this.root.children) if (c.isMesh) c.visible = false; // Beine der Puppe
    this.body.traverse((o) => {
      if (!o.isMesh) return;
      for (let p = o; p; p = p.parent) if (p === this.fan) return;
      o.visible = false;
    });
    this.root.add(model);
    this.model = model;
    this.rig = { bones, seatQ: new Map(), baseY: 0 };
    this.seat();
  }

  /** Einmalig: aus der T-/A-Pose auf den Stuhl setzen und diese Pose merken. */
  seat() {
    const B = this.rig.bones;
    this.root.updateMatrixWorld(true);
    this.root.getWorldQuaternion(_rq);
    const dir = (x, y, z) => _dir.set(x, y, z).applyQuaternion(_rq).normalize();
    for (const [s, sx] of [['L', 1], ['R', -1]]) {
      if (!this.blob) {
        aimBone(B[`upLeg${s}`], B[`leg${s}`], dir(sx * 0.1, -0.12, 1));
        aimBone(B[`leg${s}`], B[`foot${s}`], dir(0, -1, 0.1));
      }
      aimBone(B[`upperArm${s}`], B[`foreArm${s}`], dir(sx * 0.15, -1, 0.1));
    }
    const posed = [...B.spine, ...B.neck, B.head, B.upperArmL, B.upperArmR, B.foreArmL, B.foreArmR, B.handL, B.handR];
    for (const b of posed) this.rig.seatQ.set(b, b.quaternion.clone());
    if (this.blob) {
      // Unterseite auf die Sitzfläche, etwas nach hinten an die Lehne
      const box = new THREE.Box3().setFromObject(this.model);
      const bottom = this.root.worldToLocal(_w.set((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2));
      this.model.position.add(_w2.set(-bottom.x, SEAT_TOP - bottom.y, -0.06 - bottom.z));
    } else {
      // Hüftgelenke auf den Stuhl
      const mid = this.root.worldToLocal(B.upLegL.getWorldPosition(_w).add(B.upLegR.getWorldPosition(_w2)).multiplyScalar(0.5));
      this.model.position.add(_w2.copy(HIP).sub(mid));
    }
    this.rig.baseY = this.model.position.y;
    this.model.updateMatrixWorld(true);
    // Namensschild über den echten Kopf
    const head = this.root.worldToLocal(B.head.getWorldPosition(_w));
    this.labelAnchor.position.y = head.y + 0.36;
  }

  setMouth(kind) {
    if (!this.rig) super.setMouth(kind);
  }

  headWorld(out = new THREE.Vector3()) {
    if (!this.rig) return super.headWorld(out);
    return this.rig.bones.head.getWorldPosition(out).add(_w.set(0, 0.1, 0));
  }

  mouthWorld(out = new THREE.Vector3()) {
    if (!this.rig) return super.mouthWorld(out);
    this.rig.bones.head.getWorldPosition(out);
    this.head.getWorldQuaternion(_mq);
    return out.add(_w.set(0, 0.04, 0.11).applyQuaternion(_mq));
  }

  update(t, dt) {
    super.update(t, dt);
    if (this.rig) this.drive();
  }

  /** Bewegung der Puppe auf das Modell übertragen. */
  drive() {
    const B = this.rig.bones;
    for (const [bone, q] of this.rig.seatQ) bone.quaternion.copy(q);
    this.model.position.y = this.rig.baseY + (this.body.position.y - 0.5);
    this.model.updateMatrixWorld(true);
    this.root.getWorldQuaternion(_rq);
    _rqi.copy(_rq).invert();

    // Oberkörper vorbeugen/neigen wie die Puppe, verteilt auf die Wirbel
    if (B.spine.length) {
      _cq.setFromEuler(_eu.set(this.body.rotation.x, 0, this.body.rotation.z));
      _cq.premultiply(_rq).multiply(_rqi); // Stuhl-Raum → Welt
      for (const b of B.spine) rotateWorld(b, partOf(_cq, 1 / B.spine.length, _sq));
    }

    // Kopf: Drehung des Puppenkopfs relativ zu seinem Hals, ein Teil davon in den Hals
    this.neck.getWorldQuaternion(_nq);
    _hq.copy(_nq).multiply(this.head.quaternion).multiply(_nq.invert());
    const neckShare = B.neck.length ? 0.35 : 0;
    for (const b of B.neck) rotateWorld(b, partOf(_hq, neckShare / B.neck.length, _sq));
    rotateWorld(B.head, partOf(_hq, 1 - neckShare, _sq));

    // Arme: Zwei-Knochen-IK zu den Handzielen der Puppe
    this.armIK(B.upperArmL, B.foreArmL, B.handL, this.left.target, 1);
    this.armIK(B.upperArmR, B.foreArmR, B.handR, this.right.target, -1);
  }

  armIK(upper, fore, hand, bodyTarget, side) {
    const S = upper.getWorldPosition(new THREE.Vector3());
    const E0 = fore.getWorldPosition(_w);
    const H0 = hand.getWorldPosition(_w2);
    const L1 = S.distanceTo(E0);
    const L2 = E0.distanceTo(H0) + PALM;
    const T = this.body.localToWorld(_e2.copy(bodyTarget));
    const d = T.sub(S);
    const D = clamp(d.length(), 0.05, (L1 + L2) * 0.999);
    d.normalize();
    const cosA = clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    _pole.set(side * 0.45, -0.75, -0.35).applyQuaternion(_rq);
    _pole.addScaledVector(d, -_pole.dot(d)).normalize();
    const E = _w.copy(S).addScaledVector(d, cosA * L1).addScaledVector(_pole, sinA * L1);
    aimBone(upper, fore, _dir.copy(E).sub(S).normalize());
    const P = _w2.copy(S).addScaledVector(d, D);
    aimBone(fore, hand, _dir.copy(P).sub(E).normalize());
  }
}
