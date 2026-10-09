// Der Wirt: steht hinter der Theke und poliert Gläser. Bestellt jemand ein Bier oder eine
// Zigarre, läuft er mit dem Tablett um den Tisch, stellt es an den Platz und geht zurück.
// Jeder Client lässt ihn selbst laufen; der Server kennt nur die Bestellung.

import * as THREE from 'three';
import { flat } from './characters.js';
import { makeBeer, makeUnlitCigar, MUG_REST, ASH_REST } from './props.js';
import { TABLE, BAR } from './layout.js';
import { clamp, smooth, envelope } from './util.js';

const HOME = new THREE.Vector3(BAR.x, 0, BAR.z - 0.6); // hinter der Theke
const EXIT = [new THREE.Vector3(BAR.x - BAR.len / 2 - 0.42, 0, HOME.z), new THREE.Vector3(BAR.x - BAR.len / 2 - 0.42, 0, BAR.z + 1.0)];
const WALK = { rx: TABLE.rx + 1.28, rz: TABLE.rz + 1.2 }; // Laufweg um den Tisch (hinter den Stühlen)
// Neben dem Gast (Stuhl-Koordinaten): Bier von rechts (Krug), Zigarre von links (Aschenbecher)
const STAND = { beer: new THREE.Vector3(-0.66, 0, 0.32), cigar: new THREE.Vector3(0.7, 0, 0.3) };
const SPEED = 1.55;
const SKIN = '#e2b08a';

function box(parent, w, h, d, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), flat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

function onWalk(a, out = new THREE.Vector3()) {
  return out.set(-Math.sin(a) * WALK.rx, 0, Math.cos(a) * WALK.rz);
}
const angleOf = (p) => Math.atan2(-p.x / WALK.rx, p.z / WALK.rz);

export class Waiter {
  constructor() {
    this.root = new THREE.Group();
    this.root.position.copy(HOME);
    this.queue = [];
    this.state = 'idle';
    this.job = null;
    this.path = [];
    this.seg = 0;
    this.walked = 0;
    this.heading = 0;
    this.build();
  }

  build() {
    const r = this.root;
    const trousers = '#1b1a1f';
    // Beine (Hüfte bei y = 0,9)
    this.legs = [-1, 1].map((sx) => {
      const g = new THREE.Group();
      g.position.set(sx * 0.1, 0.9, 0);
      box(g, 0.14, 0.86, 0.15, trousers, 0, -0.43, 0);
      box(g, 0.13, 0.07, 0.25, '#0d0a08', 0, -0.865, 0.05);
      r.add(g);
      return g;
    });
    // Oberkörper: Hemd, Weste, Schürze, Fliege
    const torso = (this.torso = new THREE.Group());
    torso.position.y = 0.88;
    r.add(torso);
    const prof = [[0, 0], [0.2, 0], [0.225, 0.1], [0.215, 0.3], [0.23, 0.46], [0.18, 0.56], [0.08, 0.62], [0, 0.625]];
    const lathe = (pts, color, sz = 0.8) => {
      const m = new THREE.Mesh(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 10), flat(color));
      m.scale.z = sz;
      m.castShadow = true;
      torso.add(m);
      return m;
    };
    lathe(prof, '#ece6d8');
    lathe([[0.212, 0.06], [0.236, 0.12], [0.226, 0.3], [0.24, 0.46], [0.205, 0.53]], '#4a1219', 0.82);
    box(torso, 0.07, 0.4, 0.02, '#ece6d8', 0, 0.33, 0.188).rotation.x = -0.05;
    for (const y of [0.2, 0.3, 0.4]) box(torso, 0.018, 0.018, 0.012, '#c9a23a', 0.05, y, 0.196);
    const tie = new THREE.Group();
    tie.position.set(0, 0.56, 0.155);
    torso.add(tie);
    for (const sx of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.06, 4), flat('#111'));
      c.rotation.z = (sx * Math.PI) / 2;
      c.position.x = sx * 0.028;
      tie.add(c);
    }
    box(torso, 0.4, 0.5, 0.025, '#f4f0e6', 0, -0.17, 0.19).rotation.x = 0.06; // lange Schürze
    box(torso, 0.42, 0.04, 0.03, '#f4f0e6', 0, 0.07, 0.17);
    // Kopf
    const head = (this.head = new THREE.Group());
    head.position.y = 0.62;
    torso.add(head);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 6), flat(SKIN));
    neck.position.y = 0.03;
    head.add(neck);
    const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.135, 1), flat(SKIN));
    skull.scale.set(1, 1.08, 0.98);
    skull.position.y = 0.17;
    skull.castShadow = true;
    head.add(skull);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.142, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), flat('#1d1410'));
    hair.position.set(0, 0.19, -0.01);
    hair.rotation.x = -0.35;
    head.add(hair);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 5), flat('#1a1210'));
      eye.position.set(sx * 0.05, 0.2, 0.122);
      head.add(eye);
      const brow = box(head, 0.05, 0.012, 0.02, '#1d1410', sx * 0.05, 0.235, 0.125);
      brow.rotation.z = sx * 0.15;
      const stache = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.09, 5), flat('#1d1410'));
      stache.rotation.z = sx * 1.85;
      stache.position.set(sx * 0.04, 0.122, 0.13);
      head.add(stache);
      const ear = new THREE.Mesh(new THREE.IcosahedronGeometry(0.03, 0), flat(SKIN));
      ear.position.set(sx * 0.135, 0.17, 0);
      ear.scale.set(0.6, 1, 0.8);
      head.add(ear);
    }
    const nose = new THREE.Mesh(new THREE.IcosahedronGeometry(0.03, 0), flat(SKIN));
    nose.position.set(0, 0.16, 0.14);
    nose.scale.set(0.9, 1.1, 1.1);
    head.add(nose);
    // Arme: links das Tablett (angewinkelt), rechts frei
    this.arms = [1, -1].map((sx) => {
      const sh = new THREE.Group();
      sh.position.set(sx * 0.245, 0.5, 0);
      torso.add(sh);
      const up = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.05, 0.28, 6).translate(0, -0.14, 0), flat('#ece6d8'));
      up.castShadow = true;
      sh.add(up);
      const el = new THREE.Group();
      el.position.y = -0.28;
      sh.add(el);
      const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.042, 0.26, 6).translate(0, -0.13, 0), flat('#ece6d8'));
      fore.castShadow = true;
      el.add(fore);
      const hand = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 0), flat(SKIN));
      hand.position.y = -0.3;
      el.add(hand);
      return { sh, el, hand };
    });
    // Tablett auf der linken Hand
    this.tray = new THREE.Group();
    this.arms[0].el.add(this.tray);
    this.tray.position.set(0, -0.31, 0.02);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.18, 0.015, 20), new THREE.MeshStandardMaterial({ color: '#8d9096', roughness: 0.45, metalness: 0.8, envMapIntensity: 0.5 }));
    plate.position.y = 0.035;
    plate.castShadow = true;
    this.tray.add(plate);
    this.trayItem = null;
    // Lappen in der rechten Hand (zum Gläserpolieren)
    this.cloth = box(this.arms[1].el, 0.08, 0.12, 0.05, '#e9e3d2', 0, -0.36, 0.02);
    this.glass = makeBeer();
    this.glass.userData.liquid.visible = false;
    this.glass.userData.foam.visible = false;
    this.glass.userData.cap.visible = false;
    this.glass.scale.setScalar(0.7);
    this.arms[0].el.add(this.glass);
    this.glass.position.set(0, -0.38, 0.03);
  }

  /** job: { target: Object3D in Stuhl-Koordinaten, item: 'beer'|'cigar', onArrive() } */
  enqueue(job) {
    this.queue.push(job);
  }

  pathTo(stand) {
    const pts = [HOME.clone(), ...EXIT.map((p) => p.clone())];
    const a1 = angleOf(EXIT[1]);
    const a2 = angleOf(stand);
    let d = a2 - a1;
    d = Math.atan2(Math.sin(d), Math.cos(d)); // kürzerer Weg um den Tisch
    const steps = Math.max(1, Math.ceil(Math.abs(d) / 0.2));
    for (let i = 0; i <= steps; i++) pts.push(onWalk(a1 + (d * i) / steps));
    pts.push(stand.clone());
    return pts;
  }

  startPath(pts) {
    this.path = pts;
    this.seg = 0;
    this.segT = 0;
  }

  /** Läuft den Pfad entlang; true, wenn das Ende erreicht ist. */
  walk(dt) {
    let move = SPEED * dt;
    while (move > 0 && this.seg < this.path.length - 1) {
      const a = this.path[this.seg];
      const b = this.path[this.seg + 1];
      const len = a.distanceTo(b);
      const left = len * (1 - this.segT);
      if (move >= left || len < 1e-4) {
        move -= left;
        this.seg += 1;
        this.segT = 0;
      } else {
        this.segT += move / len;
        move = 0;
      }
    }
    if (this.seg >= this.path.length - 1) {
      this.root.position.copy(this.path.at(-1));
      return true;
    }
    const a = this.path[this.seg];
    const b = this.path[this.seg + 1];
    this.root.position.lerpVectors(a, b, this.segT);
    this.turnTo(Math.atan2(b.x - a.x, b.z - a.z), dt);
    this.walked += SPEED * dt;
    return false;
  }

  turnTo(goal, dt, speed = 9) {
    let d = goal - this.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.heading += d * (1 - Math.exp(-dt * speed));
    this.root.rotation.y = this.heading;
  }

  loadTray(item) {
    if (this.trayItem) this.tray.remove(this.trayItem);
    this.trayItem = item === 'cigar' ? makeUnlitCigar() : makeBeer();
    if (item === 'cigar') {
      this.trayItem.rotation.y = 0.4;
      this.trayItem.position.set(-0.06, 0.052, 0.02);
    } else {
      this.trayItem.position.set(0, 0.043, 0);
    }
    this.tray.add(this.trayItem);
    this.glass.visible = false;
  }

  update(t, dt) {
    const [L, Rr] = this.arms;
    let walking = false;
    let reach = 0;
    if (this.state === 'idle') {
      this.turnTo(0, dt, 4);
      if (this.queue.length) {
        const job = this.queue.shift();
        if (job.target.parent) {
          this.job = job;
          job.target.updateWorldMatrix(true, false);
          job.stand = job.target.localToWorld(STAND[job.item].clone()).setY(0);
          const rest = job.item === 'cigar' ? ASH_REST.clone().add(new THREE.Vector3(-0.03, 0.026, -0.015)) : MUG_REST.clone();
          job.place = job.target.localToWorld(rest);
          this.loadTray(job.item);
          this.startPath(this.pathTo(job.stand));
          this.state = 'go';
        }
      }
    } else if (this.state === 'go') {
      walking = true;
      if (!this.job.target.parent) this.goHome();
      else if (this.walk(dt)) {
        this.state = 'serve';
        this.serveT = 0;
        this.itemFrom = new THREE.Vector3();
      }
    } else if (this.state === 'serve') {
      const job = this.job;
      this.serveT += dt;
      const s = this.serveT;
      const p = job.place;
      // so drehen, dass die rechte Hand (die serviert) zum Platz zeigt
      this.turnTo(Math.atan2(p.x - this.root.position.x, p.z - this.root.position.z) + 0.35, dt, 6);
      reach = envelope(s / 1.6, 0.35);
      // Ware vom Tablett an den Platz (in Weltkoordinaten bewegt)
      if (this.trayItem && s > 0.35) {
        if (this.trayItem.parent === this.tray) {
          this.trayItem.getWorldPosition(this.itemFrom);
          this.root.parent.attach(this.trayItem);
        }
        const k = smooth(clamp((s - 0.35) / 0.6, 0, 1));
        this.trayItem.position.lerpVectors(this.itemFrom, p, k);
        this.trayItem.position.y += Math.sin(k * Math.PI) * 0.12;
        if (k >= 1) {
          this.trayItem.parent.remove(this.trayItem);
          this.trayItem = null;
          if (job.target.parent) job.onArrive?.();
        }
      }
      if (s > 1.7) this.goHome();
    } else if (this.state === 'back') {
      walking = true;
      if (this.walk(dt)) {
        this.state = 'idle';
        this.glass.visible = true;
      }
    }

    // Gliedmaßen
    const ph = this.walked * 4.2;
    const swing = walking ? Math.sin(ph) : 0;
    this.legs[0].rotation.x = swing * 0.42;
    this.legs[1].rotation.x = -swing * 0.42;
    this.torso.position.y = 0.88 + (walking ? Math.abs(Math.cos(ph)) * 0.025 : Math.sin(t * 1.6) * 0.004);
    this.torso.rotation.z = walking ? Math.sin(ph) * 0.03 : 0;
    // links: Tablett vor der Brust (beim Laufen ruhig)
    L.sh.rotation.set(-0.3, 0, 0.12);
    L.el.rotation.set(-1.45, 0, 0);
    // rechts: polieren (in Ruhe), schwingen (laufen) oder hinreichen (servieren)
    const idle = this.state === 'idle' ? 1 : 0;
    const pol = Math.sin(t * 5);
    // beim Servieren: leicht vorbeugen, Arm schräg nach unten zur Tischplatte
    Rr.sh.rotation.set(
      -0.55 * idle + swing * 0.35 * (1 - reach) - 0.62 * reach,
      0,
      -0.25 * idle + 0.12 * reach,
    );
    Rr.el.rotation.set(-1.25 * idle - 0.15 * reach + pol * 0.12 * idle, 0, pol * 0.2 * idle);
    this.torso.rotation.x = 0.22 * reach;
    this.cloth.visible = this.state === 'idle';
    this.head.rotation.x = 0.12 * reach + (idle ? 0.25 : 0);
    if (idle) {
      // Glas in der linken Hand während des Polierens
      L.sh.rotation.set(-0.5, 0, 0.3);
      L.el.rotation.set(-1.0, 0, 0.4);
    }
    this.tray.visible = this.state !== 'idle';
  }

  goHome() {
    const back = this.pathTo(this.job?.stand ?? EXIT[1]).reverse();
    back[0] = this.root.position.clone();
    this.startPath(back);
    this.state = 'back';
    this.job = null;
    if (this.trayItem) {
      this.trayItem.parent?.remove(this.trayItem);
      this.trayItem = null;
    }
  }
}
