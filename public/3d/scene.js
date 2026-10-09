// Die Kneipe: Renderer, Kamera, Licht, Raum, Requisiten, Nebel, Staub und Rauch.
// Alles prozedural aus Grundkörpern und Canvas-Texturen – keine externen Assets.

import * as THREE from 'three';
import { flat } from './characters.js';
import { TABLE, BAR } from './layout.js';
import { rng, clamp } from './util.js';
import { mergeStatic } from './merge.js';
import { createPost } from './post.js';
import { makeBeer } from './props.js';

const R = rng(1234);

// ---------- Canvas-Texturen ----------
function canvasTex(w, h, draw, { repeat, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.anisotropy = 8;
  return t;
}

const rgb = (c, k = 1) => `rgb(${Math.round(clamp(c[0] * k, 0, 255))},${Math.round(clamp(c[1] * k, 0, 255))},${Math.round(clamp(c[2] * k, 0, 255))})`;

function planks(ctx, w, h, { n, base, vary = 0.14, seam = 'rgba(15,8,4,0.85)', grain = 16 }) {
  const ph = h / n;
  for (let i = 0; i < n; i++) {
    const k = 1 + (R() - 0.5) * vary * 2;
    ctx.fillStyle = rgb(base, k);
    ctx.fillRect(0, i * ph, w, ph);
    for (let j = 0; j < grain; j++) {
      ctx.strokeStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,220,170'},${0.03 + R() * 0.06})`;
      ctx.lineWidth = 0.6 + R() * 1.6;
      ctx.beginPath();
      const y0 = i * ph + R() * ph;
      const amp = R() * 2.5;
      const f = 0.005 + R() * 0.02;
      ctx.moveTo(0, y0);
      for (let x = 0; x <= w; x += 16) ctx.lineTo(x, y0 + Math.sin(x * f + j) * amp);
      ctx.stroke();
    }
    ctx.fillStyle = seam;
    ctx.fillRect(0, i * ph, w, Math.max(1.5, h / 300));
    const jx = R() * w;
    ctx.fillRect(jx, i * ph, Math.max(1.5, w / 300), ph);
  }
}

function noise(ctx, w, h, n, alpha) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,240,220'},${R() * alpha})`;
    const s = 1 + R() * 3;
    ctx.fillRect(R() * w, R() * h, s, s);
  }
}

function softBlob(ctx, w, h) {
  for (let i = 0; i < 9; i++) {
    const x = w * (0.3 + R() * 0.4);
    const y = h * (0.3 + R() * 0.4);
    const r = w * (0.18 + R() * 0.22);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}

/** Schmutz: dunkle Flecken, Wasserläufe von oben, Ruß unter der Decke. */
function grime(ctx, w, h, { stains = 18, streaks = 30, soot = 0.35 } = {}) {
  for (let i = 0; i < stains; i++) {
    const x = R() * w;
    const y = R() * h;
    const r = 20 + R() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(30,18,8,${0.1 + R() * 0.18})`);
    g.addColorStop(1, 'rgba(30,18,8,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  for (let i = 0; i < streaks; i++) {
    const x = R() * w;
    const len = h * (0.15 + R() * 0.5);
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, `rgba(25,15,6,${0.08 + R() * 0.12})`);
    g.addColorStop(1, 'rgba(25,15,6,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 1 + R() * 3, len);
  }
  const g = ctx.createLinearGradient(0, 0, 0, h * 0.5);
  g.addColorStop(0, `rgba(10,6,3,${soot})`);
  g.addColorStop(1, 'rgba(10,6,3,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** Bierränder und Brandflecken (Tischplatte, Filz). */
function rings(ctx, w, h, n, { burns = 0 } = {}) {
  for (let i = 0; i < n; i++) {
    const x = w * (0.1 + R() * 0.8);
    const y = h * (0.1 + R() * 0.8);
    const r = w * (0.03 + R() * 0.012);
    ctx.strokeStyle = `rgba(40,22,8,${0.18 + R() * 0.2})`;
    ctx.lineWidth = 2 + R() * 3;
    ctx.beginPath();
    ctx.arc(x, y, r, R() * 6, R() * 6 + 3.5 + R() * 2.8);
    ctx.stroke();
  }
  for (let i = 0; i < burns; i++) {
    const x = w * (0.15 + R() * 0.7);
    const y = h * (0.15 + R() * 0.7);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(R() * Math.PI);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 14);
    g.addColorStop(0, 'rgba(15,8,2,0.75)');
    g.addColorStop(1, 'rgba(15,8,2,0)');
    ctx.fillStyle = g;
    ctx.scale(2.4, 0.7);
    ctx.fillRect(-14, -14, 28, 28);
    ctx.restore();
  }
}

/** Leuchtschrift wie aus Neonröhren (bunter Schein, heller Kern) auf transparentem Grund. */
function neonTexture(w, h, draw) {
  return canvasTex(w, h, (ctx) => {
    ctx.lineCap = ctx.lineJoin = 'round';
    for (const [lw, a, white] of [[18, 0.18, false], [10, 0.5, false], [5, 1, false], [2, 1, true]]) {
      ctx.save();
      ctx.globalAlpha = a;
      draw(ctx, lw, white);
      ctx.restore();
    }
  });
}

const bottleMats = new Map();
function bottleMat(c) {
  if (!bottleMats.has(c)) {
    bottleMats.set(c, new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.18, roughness: 0.12, metalness: 0.1 }));
  }
  return bottleMats.get(c);
}

/** Heller Farbwert über 1 (leuchtet mit Bloom). */
const hdr = (c, k) => new THREE.Color(c).multiplyScalar(k);

// ---------- Welt ----------
export function createWorld(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  const maxDpr = Math.min(devicePixelRatio || 1, 2);
  renderer.setPixelRatio(maxDpr);
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  const fogColor = new THREE.Color('#140c08');
  scene.background = fogColor;
  scene.fog = new THREE.Fog(fogColor, 5.5, 14);

  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 40);
  camera.position.set(0, 2.6, 4.6);
  scene.add(camera);

  // ---------- Licht ----------
  const hemi = new THREE.HemisphereLight('#ffcf9a', '#22120a', 0.42);
  scene.add(hemi);

  const lampY = 2.55;
  const spot = new THREE.SpotLight('#ffc47e', 32, 0, 0.95, 0.55, 2);
  spot.position.set(0, lampY - 0.05, 0);
  spot.target.position.set(0, TABLE.y, 0);
  spot.castShadow = true;
  spot.shadow.mapSize.set(2048, 2048);
  spot.shadow.bias = -0.0004;
  spot.shadow.normalBias = 0.02;
  spot.shadow.camera.near = 0.4;
  spot.shadow.camera.far = 4;
  scene.add(spot, spot.target);

  const fireLight = new THREE.PointLight('#ff7a2a', 9, 9, 1.6);
  fireLight.position.set(-5.2, 0.8, -1.6);
  scene.add(fireLight);

  // Neonschein über der Theke (rosa) und am Bier-Schild (rot)
  const barLight = new THREE.PointLight('#ff6f8a', 4.2, 6.5, 1.6);
  barLight.position.set(BAR.x, 2.7, -4.9);
  const neonLight = new THREE.PointLight('#ff2a1a', 3.2, 4.5, 1.7);
  neonLight.position.set(-4.3, 2.2, -5.0);
  scene.add(neonLight);
  scene.add(barLight);

  const moon = new THREE.DirectionalLight('#7f98ff', 0.35);
  moon.position.set(6, 3, 1);
  scene.add(moon);

  // Weiches Fülllicht von vorne (aus Richtung der Kamera), damit die Gesichter lesbar sind
  const fill = new THREE.DirectionalLight('#ffd2a0', 0.8);
  fill.position.set(0, 3.2, 6);
  fill.target.position.set(0, 1, -1);
  scene.add(fill, fill.target);

  // ---------- Raum ----------
  const room = new THREE.Group();
  scene.add(room);
  const RX = 6.2;
  const RZB = -5.6;
  const RZF = 9.5;
  const RH = 3.7;

  const floorTex = canvasTex(1024, 1024, (ctx, w, h) => {
    planks(ctx, w, h, { n: 10, base: [78, 50, 30], vary: 0.2 });
    grime(ctx, w, h, { stains: 26, streaks: 0, soot: 0 });
    rings(ctx, w, h, 6, { burns: 10 });
  }, { repeat: [3, 3] });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(RX * 2, RZF - RZB), new THREE.MeshLambertMaterial({ map: floorTex }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = (RZF + RZB) / 2;
  floor.receiveShadow = true;
  room.add(floor);

  // Teppich unter dem Tisch
  const rugTex = canvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#5a1a16';
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    const rings = [[0.47, '#c9a24a', 6], [0.43, '#2a0c0a', 10], [0.36, '#c9a24a', 3]];
    for (const [r, c, lw] of rings) {
      ctx.strokeStyle = c;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, w * r, h * r, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ctx.fillStyle = '#c9a24a';
      ctx.beginPath();
      ctx.arc(w / 2 + Math.cos(a) * w * 0.4, h / 2 + Math.sin(a) * h * 0.4, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    noise(ctx, w, h, 5000, 0.12);
  });
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshLambertMaterial({ map: rugTex, transparent: true }));
  rug.rotation.x = -Math.PI / 2;
  rug.scale.set(TABLE.rx + 1.25, TABLE.rz + 1.25, 1);
  rug.position.y = 0.005;
  rug.receiveShadow = true;
  room.add(rug);

  // Wände: unten Holzvertäfelung, oben Putz mit Fachwerk
  const plasterTex = canvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#8a7258';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      const g = ctx.createRadialGradient(R() * w, R() * h, 0, R() * w, R() * h, 40 + R() * 120);
      g.addColorStop(0, `rgba(${R() < 0.5 ? '60,40,20' : '200,180,150'},0.12)`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    noise(ctx, w, h, 9000, 0.1);
    grime(ctx, w, h);
  }, { repeat: [3, 1] });
  const panelTex = canvasTex(512, 256, (ctx, w, h) => {
    ctx.save();
    ctx.translate(w, 0);
    ctx.rotate(Math.PI / 2);
    planks(ctx, h, w, { n: 12, base: [62, 37, 21], vary: 0.14 });
    ctx.restore();
    grime(ctx, w, h, { stains: 10, streaks: 0, soot: 0 });
  }, { repeat: [4, 1] });
  const plasterMat = new THREE.MeshLambertMaterial({ map: plasterTex });
  const panelMat = new THREE.MeshLambertMaterial({ map: panelTex });
  const beam = '#2e1b0f';

  function wall(len, pos, rotY) {
    const g = new THREE.Group();
    g.position.copy(pos);
    g.rotation.y = rotY;
    const up = new THREE.Mesh(new THREE.PlaneGeometry(len, RH - 1.2), plasterMat);
    up.position.y = 1.2 + (RH - 1.2) / 2;
    up.receiveShadow = true;
    const low = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.2), panelMat);
    low.position.y = 0.6;
    low.receiveShadow = true;
    g.add(up, low);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.08), flat(beam));
    rail.position.set(0, 1.22, 0.04);
    g.add(rail);
    // Fachwerk
    const posts = Math.round(len / 1.8);
    for (let i = 0; i <= posts; i++) {
      const x = -len / 2 + (i * len) / posts;
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.16, RH - 1.2, 0.08), flat(beam));
      p.position.set(x, 1.2 + (RH - 1.2) / 2, 0.04);
      g.add(p);
      if (i < posts && i % 2 === 0) {
        const dx = len / posts;
        const dy = RH - 1.2 - 0.2;
        const d = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(dx, dy), 0.12, 0.06), flat(beam));
        d.position.set(x + dx / 2, 1.3 + dy / 2, 0.035);
        d.rotation.z = Math.atan2(dy, dx) * (i % 4 === 0 ? 1 : -1);
        g.add(d);
      }
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(len, 0.16, 0.1), flat(beam));
    top.position.set(0, RH - 0.08, 0.05);
    g.add(top);
    room.add(g);
    return g;
  }
  wall(RX * 2, new THREE.Vector3(0, 0, RZB), 0);
  wall(RZF - RZB, new THREE.Vector3(-RX, 0, (RZF + RZB) / 2), Math.PI / 2);
  const rightWall = wall(RZF - RZB, new THREE.Vector3(RX, 0, (RZF + RZB) / 2), -Math.PI / 2);
  wall(RX * 2, new THREE.Vector3(0, 0, RZF), Math.PI);

  // Decke mit Balken
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(RX * 2, RZF - RZB), flat('#1e120a'));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, RH, (RZF + RZB) / 2);
  room.add(ceil);
  for (let z = RZB + 0.8; z < RZF; z += 1.7) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(RX * 2, 0.22, 0.2), flat(beam));
    b.position.set(0, RH - 0.11, z);
    room.add(b);
  }

  // Fenster rechts mit Mondlicht
  const win = new THREE.Group();
  win.position.set(-0.75 - (RZF + RZB) / 2, 1.95, 0.02); // Welt-z ≈ -0.75
  rightWall.add(win);
  const glassMat = new THREE.MeshBasicMaterial({ color: '#2f4d96', fog: false });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.2), glassMat);
  win.add(glass);
  const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(0.11, 16), new THREE.MeshBasicMaterial({ color: hdr('#f4f0d8', 2.5), fog: false }));
  moonDisc.position.set(0.22, 0.25, 0.005);
  win.add(moonDisc);
  for (const [w, h, x, y] of [[1.26, 0.1, 0, 0.65], [1.26, 0.1, 0, -0.65], [0.1, 1.4, 0.58, 0], [0.1, 1.4, -0.58, 0], [1.1, 0.06, 0, 0], [0.06, 1.2, 0, 0]]) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), flat('#24150b'));
    f.position.set(x, y, 0.04);
    win.add(f);
  }

  // Kamin links
  const fire = new THREE.Group();
  fire.position.set(-RX + 0.35, 0, -1.6);
  fire.rotation.y = Math.PI / 2;
  room.add(fire);
  const stone = ['#5d5650', '#4f4842', '#6a625a'];
  for (let i = 0; i < 26; i++) {
    const row = Math.floor(i / 6);
    const col = i % 6;
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.26, 0.5), flat(stone[(i * 7) % 3]));
    const x = -1.05 + col * 0.42 + (row % 2) * 0.21;
    const y = 0.13 + row * 0.27;
    if (Math.abs(x) < 0.5 && y < 0.95) continue; // Feueröffnung
    s.position.set(x, y, 0);
    s.castShadow = true;
    fire.add(s);
  }
  const mantel = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 0.62), flat('#3a2213'));
  mantel.position.set(0, 1.15, 0.05);
  fire.add(mantel);
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(1.7, RH - 1.2, 0.45), flat('#4f4842'));
  chimney.position.set(0, 1.2 + (RH - 1.2) / 2, -0.05);
  fire.add(chimney);
  const hearth = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.75, 0.05), new THREE.MeshBasicMaterial({ color: '#0a0503' }));
  hearth.position.set(0, 0.45, -0.2);
  fire.add(hearth);
  for (const [x, r] of [[-0.15, 0.2], [0.15, -0.2]]) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 6), flat('#3a2414'));
    log.rotation.set(0, r, Math.PI / 2);
    log.position.set(x * 0.3, 0.09, 0.05);
    fire.add(log);
  }
  const flames = [];
  for (let i = 0; i < 7; i++) {
    const hot = i % 3 === 0;
    const f = new THREE.Mesh(
      new THREE.ConeGeometry(0.06 + R() * 0.05, 0.3 + R() * 0.25, 5),
      new THREE.MeshBasicMaterial({ color: hdr(hot ? '#ffd27a' : '#ff7a26', 2.2), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    f.position.set(-0.24 + (i / 6) * 0.48, 0.25, 0.02 + (hot ? 0.05 : 0));
    f.userData.base = f.position.y;
    f.userData.ph = R() * 10;
    fire.add(f);
    flames.push(f);
  }

  // Theke hinten rechts mit Flaschenregal
  const bar = new THREE.Group();
  bar.position.set(BAR.x, 0, BAR.z);
  room.add(bar);
  const counter = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.05, 0.62), new THREE.MeshLambertMaterial({ map: panelTex }));
  counter.position.y = 0.525;
  counter.castShadow = counter.receiveShadow = true;
  bar.add(counter);
  const counterTop = new THREE.Mesh(new THREE.BoxGeometry(3.55, 0.07, 0.78), new THREE.MeshStandardMaterial({ color: '#3b2414', roughness: 0.28 }));
  counterTop.position.y = 1.08;
  counterTop.receiveShadow = true;
  bar.add(counterTop);
  const bottleColors = ['#2e6b3a', '#6b3a12', '#a8721e', '#2a4a7a', '#7a1f2a', '#c9b98a'];
  for (const sy of [1.55, 2.15]) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.05, 0.3), flat('#3b2414'));
    shelf.position.set(0, sy, -1.05);
    bar.add(shelf);
    for (let i = 0; i < 13; i++) {
      const c = bottleColors[Math.floor(R() * bottleColors.length)];
      const m = bottleMat(c);
      const h = 0.22 + R() * 0.12;
      const bt = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, h, 6), m);
      bt.position.set(-1.45 + i * 0.24 + R() * 0.05, sy + h / 2 + 0.025, -1.05);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.03, 0.1, 5), m);
      neck.position.copy(bt.position);
      neck.position.y += h / 2 + 0.05;
      bar.add(bt, neck);
    }
  }
  // Zapfanlage und ein paar Gläser auf der Theke
  const chrome = new THREE.MeshStandardMaterial({ color: '#d8d8dc', roughness: 0.18, metalness: 1 });
  const tapBase = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.12), chrome);
  tapBase.position.set(-0.4, 1.28, -0.12);
  bar.add(tapBase);
  for (let i = 0; i < 3; i++) {
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.12, 8), chrome);
    spout.rotation.x = Math.PI / 2;
    spout.position.set(-0.55 + i * 0.15, 1.3, -0.01);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.012, 0.2, 8), flat(['#7a1f1f', '#1f3a7a', '#1f1f1f'][i]));
    handle.position.set(-0.55 + i * 0.15, 1.53, -0.07);
    bar.add(spout, handle);
  }
  for (const [x, z, full] of [[0.55, 0.12, 1], [0.85, 0.05, 0.3], [-1.2, 0.1, 0.7]]) {
    const b = makeBeer(full);
    b.position.set(x, 1.115, z);
    b.rotation.y = R() * 6;
    bar.add(b);
  }
  for (let i = 0; i < 3; i++) {
    const st = new THREE.Group();
    st.position.set(-1.1 + i * 1.1, 0, 0.75);
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 8), flat('#4a2e1a'));
    seat.position.y = 0.75;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.75, 6), flat('#3a2213'));
    leg.position.y = 0.375;
    st.add(seat, leg);
    bar.add(st);
  }

  // Fässer hinten links
  const barrelGeo = new THREE.LatheGeometry(
    [[0, 0], [0.3, 0], [0.36, 0.2], [0.38, 0.4], [0.36, 0.6], [0.3, 0.8], [0, 0.8]].map(([x, y]) => new THREE.Vector2(x, y)),
    10,
  );
  const ringGeo = new THREE.TorusGeometry(1, 0.05, 4, 10);
  function barrel(x, z, lying = false, ry = 0) {
    const g = new THREE.Group();
    const b = new THREE.Mesh(barrelGeo, flat('#6b4326'));
    b.castShadow = b.receiveShadow = true;
    g.add(b);
    for (const [y, r] of [[0.14, 0.345], [0.66, 0.345]]) {
      const ring = new THREE.Mesh(ringGeo, flat('#3a3a3a'));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      ring.scale.setScalar(r);
      g.add(ring);
    }
    g.position.set(x, lying ? 0.38 : 0, z);
    if (lying) g.rotation.set(0, ry, Math.PI / 2);
    else g.rotation.y = ry;
    room.add(g);
  }
  barrel(-4.9, -4.7);
  barrel(-4.1, -4.9, false, 0.4);
  barrel(-4.5, -4.2);
  barrel(-3.3, -4.8, true, 0.3);

  // Wandleuchter
  const sconces = [];
  for (const [x, z, ry] of [[-1.6, RZB + 0.05, 0], [1.0, RZB + 0.05, 0], [-RX + 0.05, 2.0, Math.PI / 2]]) {
    const g = new THREE.Group();
    g.position.set(x, 2.0, z);
    g.rotation.y = ry;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.03), flat('#3a2a1a'));
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.22), flat('#3a2a1a'));
    arm.position.set(0, -0.08, 0.11);
    const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 6), flat('#efe6cf'));
    candle.position.set(0, 0.0, 0.22);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.07, 5), new THREE.MeshBasicMaterial({ color: hdr('#ffd27a', 3) }));
    flame.position.set(0, 0.11, 0.22);
    g.add(plate, arm, candle, flame);
    room.add(g);
    flame.userData.ph = R() * 10;
    sconces.push(flame);
  }
  const sconceLight = new THREE.PointLight('#ffa850', 2.2, 5, 1.8);
  sconceLight.position.set(-1.6, 2.1, RZB + 0.4);
  scene.add(sconceLight);

  // Bild an der Rückwand (eigener Entwurf: Mond über Hügeln)
  const picTex = canvasTex(256, 192, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1f2a4a');
    g.addColorStop(1, '#6a4a3a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f2e6b0';
    ctx.beginPath();
    ctx.arc(w * 0.7, h * 0.3, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2a2a1a';
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) ctx.lineTo(x, h * 0.72 - Math.sin(x * 0.03) * 18 - Math.sin(x * 0.011) * 14);
    ctx.lineTo(w, h);
    ctx.fill();
  });
  const pic = new THREE.Group();
  pic.position.set(-0.3, 2.25, RZB + 0.04);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.78, 0.05), flat('#5a3a12'));
  const canvasM = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.64), new THREE.MeshLambertMaterial({ map: picTex }));
  canvasM.position.z = 0.03;
  pic.add(frame, canvasM);
  room.add(pic);


  // ---------- Kneipen-Kram: Neon, Kreidetafel, Plakate, Jukebox, Dartscheibe ----------
  const neons = [];
  function neon(tex, w, h, pos, rotY, color, k = 2.6) {
    const m = new THREE.MeshBasicMaterial({ map: tex, color: hdr(color, k), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    mesh.position.copy(pos);
    mesh.rotation.y = rotY;
    mesh.renderOrder = 5;
    mesh.userData = { k, color: new THREE.Color(color), ph: R() * 10, flicker: 0 };
    room.add(mesh);
    neons.push(mesh);
    return mesh;
  }
  // „Zum Zauberer“ über dem Flaschenregal
  neon(neonTexture(1024, 256, (ctx, lw, white) => {
    ctx.strokeStyle = white ? '#fff6fb' : '#ff4f9a';
    ctx.lineWidth = lw;
    ctx.font = 'italic 700 132px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.strokeText('Zum Zauberer', 512, 170);
    ctx.beginPath(); // Stern
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? 16 : 40;
      ctx.lineTo(70 + Math.cos(a) * r, 60 + Math.sin(a) * r);
    }
    ctx.stroke();
  }), 2.5, 0.62, new THREE.Vector3(BAR.x, 2.95, RZB + 0.12), 0, '#ff4f9a');
  // „BIER“ mit Krug über den Fässern
  const beerSign = neon(neonTexture(768, 256, (ctx, lw, white) => {
    ctx.strokeStyle = white ? '#fff3e6' : '#ff3a1c';
    ctx.lineWidth = lw;
    ctx.font = '700 150px Georgia, serif';
    ctx.textAlign = 'left';
    ctx.strokeText('BIER', 200, 190);
    ctx.strokeStyle = white ? '#fffbe6' : '#ffb21c';
    ctx.strokeRect(40, 80, 70, 110);
    ctx.beginPath();
    ctx.arc(115, 135, 28, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
  }), 2.1, 0.7, new THREE.Vector3(-4.3, 2.25, RZB + 0.12), 0, '#ff3a1c');

  // Kreidetafel mit der Karte der Theke
  const chalkTex = canvasTex(512, 640, (ctx, w, h) => {
    ctx.fillStyle = '#1e2420';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.015 + R() * 0.03})`;
      ctx.beginPath();
      ctx.ellipse(R() * w, R() * h, 30 + R() * 90, 10 + R() * 30, R() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#efeadc';
    ctx.textAlign = 'center';
    ctx.font = '700 52px Georgia, serif';
    ctx.fillText('Theke', w / 2, 78);
    ctx.fillRect(w / 2 - 110, 96, 220, 3);
    ctx.textAlign = 'left';
    const rows = [
      ['Zauberbräu Hell', '3,80', '#efeadc'],
      ['Zigarette', '0,50', '#efeadc'],
      ['Zigarre', '* ', '#f0c95a'],
    ];
    ctx.font = '600 34px Georgia, serif';
    rows.forEach(([a, b, c], i) => {
      ctx.fillStyle = c;
      ctx.fillText(a, 40, 175 + i * 64);
      ctx.textAlign = 'right';
      ctx.fillText(b, w - 40, 175 + i * 64);
      ctx.textAlign = 'left';
    });
    ctx.fillStyle = '#f0c95a';
    ctx.font = 'italic 26px Georgia, serif';
    ctx.fillText('* nur für Ansage-Könige:', 40, 390);
    ctx.fillText('  mehr als 3 Stiche angesagt', 40, 426);
    ctx.fillText('  und genau bekommen!', 40, 462);
    ctx.fillStyle = '#c9d6e8';
    ctx.font = '600 26px Georgia, serif';
    ctx.fillText('Kein Anschreiben.', 40, 540);
    ctx.fillText('Narren zahlen doppelt.', 40, 580);
    noise(ctx, w, h, 3000, 0.06);
  });
  const board = new THREE.Group();
  board.position.set(-2.55, 1.9, RZB + 0.05);
  const boardFrame = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.24, 0.05), flat('#4a2e16'));
  const boardFace = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.12), new THREE.MeshLambertMaterial({ map: chalkTex }));
  boardFace.position.z = 0.028;
  board.add(boardFrame, boardFace);
  room.add(board);

  // Plakate (eigene Entwürfe)
  function poster(draw, w, h, pos, rotY, tilt = 0) {
    const tex = canvasTex(256, Math.round((256 * h) / w), (ctx, cw, ch) => {
      draw(ctx, cw, ch);
      // vergilbt, mit Knicken und Rand
      const g = ctx.createRadialGradient(cw / 2, ch / 2, cw * 0.2, cw / 2, ch / 2, cw * 0.8);
      g.addColorStop(0, 'rgba(120,80,30,0)');
      g.addColorStop(1, 'rgba(90,55,20,0.45)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cw, ch);
      ctx.strokeStyle = 'rgba(60,40,20,0.25)';
      ctx.beginPath();
      ctx.moveTo(0, ch / 2);
      ctx.lineTo(cw, ch / 2 + 6);
      ctx.stroke();
      noise(ctx, cw, ch, 1500, 0.08);
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: tex }));
    m.position.copy(pos);
    m.rotation.set(0, rotY, tilt);
    room.add(m);
  }
  const center = (ctx, text, y, font, color) => {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(text, 128, y);
  };
  poster((ctx, w, h) => {
    ctx.fillStyle = '#e8d6ad';
    ctx.fillRect(0, 0, w, h);
    center(ctx, 'GESUCHT', 48, '700 40px Georgia, serif', '#3a1d0e');
    ctx.fillStyle = '#3a1d0e';
    ctx.beginPath(); // Narrenkappe
    ctx.moveTo(60, 190);
    ctx.quadraticCurveTo(70, 90, 128, 80);
    ctx.quadraticCurveTo(186, 90, 196, 190);
    ctx.fill();
    for (const [x, y] of [[60, 190], [128, 78], [196, 190]]) {
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.fill();
    }
    center(ctx, 'Der Narr', 240, 'italic 700 30px Georgia, serif', '#3a1d0e');
    center(ctx, 'verliert jeden Stich', 272, '20px Georgia, serif', '#3a1d0e');
    center(ctx, 'Belohnung: 1 Bier', 320, '700 22px Georgia, serif', '#7a1f1f');
  }, 0.62, 0.86, new THREE.Vector3(-RX + 0.03, 1.85, 3.6), Math.PI / 2, 0.03);
  poster((ctx, w, h) => {
    ctx.fillStyle = '#7a1f1f';
    ctx.fillRect(0, 0, w, h);
    center(ctx, 'ZAUBERBRÄU', 60, '700 32px Georgia, serif', '#f2d48a');
    ctx.fillStyle = '#f2b13a';
    ctx.fillRect(88, 90, 80, 130);
    ctx.fillStyle = '#fff6e0';
    ctx.fillRect(84, 80, 88, 22);
    ctx.strokeStyle = '#f2d48a';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(170, 150, 26, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
    center(ctx, 'Hell wie ein Trumpf.', 270, 'italic 24px Georgia, serif', '#f2d48a');
  }, 0.6, 0.8, new THREE.Vector3(-RX + 0.03, 1.75, 0.6), Math.PI / 2, -0.02);
  poster((ctx, w, h) => {
    ctx.fillStyle = '#1f2a3a';
    ctx.fillRect(0, 0, w, h);
    center(ctx, 'GROSSES', 50, '700 30px Georgia, serif', '#e9c46a');
    center(ctx, 'WIZARD', 92, '700 44px Georgia, serif', '#e9c46a');
    center(ctx, 'TURNIER', 132, '700 30px Georgia, serif', '#e9c46a');
    center(ctx, 'Freitag · 20 Uhr', 190, '24px Georgia, serif', '#f6eedc');
    center(ctx, 'Startgeld: ein Narr', 226, 'italic 20px Georgia, serif', '#c4b49a');
    ctx.fillStyle = '#e9c46a';
    ctx.beginPath();
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? 14 : 34;
      ctx.lineTo(128 + Math.cos(a) * r, 290 + Math.sin(a) * r);
    }
    ctx.fill();
  }, 0.58, 0.82, new THREE.Vector3(RX - 0.03, 1.8, -2.6), -Math.PI / 2, 0.025);

  // Dartscheibe
  const dartTex = canvasTex(256, 256, (ctx, w) => {
    const c = w / 2;
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(c, c, c, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 20; i++) {
      for (const [r0, r1, col] of [[110, 120, i % 2 ? '#1d6b3a' : '#a01e1e'], [20, 110, i % 2 ? '#e8dcc0' : '#1a1a1a'], [62, 70, i % 2 ? '#1d6b3a' : '#a01e1e']]) {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(c, c, r1, (i / 20) * Math.PI * 2, ((i + 1) / 20) * Math.PI * 2);
        ctx.arc(c, c, r0, ((i + 1) / 20) * Math.PI * 2, (i / 20) * Math.PI * 2, true);
        ctx.fill();
      }
    }
    ctx.fillStyle = '#1d6b3a';
    ctx.beginPath();
    ctx.arc(c, c, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#a01e1e';
    ctx.beginPath();
    ctx.arc(c, c, 9, 0, Math.PI * 2);
    ctx.fill();
  });
  const dart = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.04, 32), [flat('#2a2a2a'), new THREE.MeshLambertMaterial({ map: dartTex }), flat('#2a2a2a')]);
  dart.rotation.z = Math.PI / 2; // Scheibe zeigt in den Raum (-x)
  dart.position.set(RX - 0.03, 1.7, 1.9);
  room.add(dart);
  for (const [dy, dz] of [[0.05, 0.03], [-0.08, -0.06], [0.01, -0.1]]) {
    const d = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.004, 0.14, 5), flat('#c9a23a'));
    d.rotation.z = Math.PI / 2 + 0.2;
    d.position.set(RX - 0.12, 1.7 + dy, 1.9 + dz);
    room.add(d);
  }

  // Jukebox in der Ecke hinten rechts (leuchtende Röhren)
  const juke = new THREE.Group();
  juke.position.set(RX - 0.45, 0, -4.2);
  juke.rotation.y = -Math.PI / 2 + 0.35;
  room.add(juke);
  const jbody = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.15, 0.5), new THREE.MeshStandardMaterial({ color: '#4a1f12', roughness: 0.35, metalness: 0.2 }));
  jbody.position.y = 0.575;
  jbody.castShadow = true;
  const jtop = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.5, 20, 1, false, 0, Math.PI), new THREE.MeshStandardMaterial({ color: '#4a1f12', roughness: 0.35, metalness: 0.2 }));
  jtop.rotation.set(Math.PI / 2, Math.PI / 2, 0);
  jtop.position.y = 1.15;
  juke.add(jbody, jtop);
  const jukeTex = canvasTex(256, 384, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#ff5a2a');
    g.addColorStop(0.35, '#ffd23a');
    g.addColorStop(0.65, '#3affb0');
    g.addColorStop(1, '#5a6aff');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = g;
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(30, h);
    ctx.lineTo(30, 128);
    ctx.arc(128, 128, 98, Math.PI, 0);
    ctx.lineTo(226, h);
    ctx.stroke();
    ctx.lineWidth = 6;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(60 + i * 34, h - 20);
      ctx.lineTo(60 + i * 34, 190);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,240,200,0.9)';
    ctx.fillRect(70, 110, 116, 60);
  });
  const jlight = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 1.08), new THREE.MeshBasicMaterial({ map: jukeTex, color: hdr('#ffffff', 1.8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  jlight.position.set(0, 0.86, 0.252);
  jlight.renderOrder = 5;
  juke.add(jlight);
  neons.push(Object.assign(jlight, { userData: { k: 1.8, color: new THREE.Color('#ffffff'), ph: 3, flicker: 0, juke: true } }));

  // Hängelampen über der Theke (nur Glühbirne und Lichthof, kein eigenes Licht)
  const pendants = [];
  for (const x of [-1.1, 0, 1.1]) {
    const g = new THREE.Group();
    g.position.set(BAR.x + x, 2.35, BAR.z + 0.05);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, RH - 2.35, 4), flat('#111'));
    cord.position.y = (RH - 2.35) / 2;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.06, 8), new THREE.MeshStandardMaterial({ color: '#b08a4a', roughness: 0.3, metalness: 0.9 }));
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), new THREE.MeshBasicMaterial({ color: hdr('#ffd9a0', 3.2) }));
    b.position.y = -0.06;
    g.add(cord, cap, b);
    room.add(g);
    pendants.push(b);
  }

  // Raum ist unbewegt: gleiche Materialien zusammenfassen (Flammen bleiben einzeln)
  mergeStatic(room, new Set([...flames, ...sconces, ...pendants]));

  // ---------- Tisch ----------
  const tableG = new THREE.Group();
  scene.add(tableG);
  const topTex = canvasTex(1024, 1024, (ctx, w, h) => {
    planks(ctx, w, h, { n: 7, base: [104, 62, 32], vary: 0.14, grain: 26 });
    rings(ctx, w, h, 14, { burns: 6 });
  });
  const feltTex = canvasTex(1024, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#1a5039';
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.06)');
    g.addColorStop(0.75, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    noise(ctx, w, h, 30000, 0.07);
    // abgewetzte Stellen vor den Plätzen, Flecken, Brandlöcher
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const x = w / 2 + Math.cos(a) * w * 0.36;
      const y = h / 2 + Math.sin(a) * h * 0.36;
      const g2 = ctx.createRadialGradient(x, y, 0, x, y, w * 0.12);
      g2.addColorStop(0, 'rgba(200,230,200,0.06)');
      g2.addColorStop(1, 'rgba(200,230,200,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, w, h);
    }
    grime(ctx, w, h, { stains: 9, streaks: 0, soot: 0 });
    rings(ctx, w, h, 3, { burns: 0 });
    ctx.strokeStyle = 'rgba(233,196,106,0.55)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.46, 0, Math.PI * 2);
    ctx.stroke();
  });
  // Lackiertes Holz: spiegelt Lampe und Kerzen (Umgebungsbild siehe unten)
  const tableTop = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.08, 48), [
    new THREE.MeshStandardMaterial({ color: '#5a3820', roughness: 0.35 }),
    new THREE.MeshStandardMaterial({ map: topTex, roughness: 0.32 }),
    flat('#3a2414'),
  ]);
  tableTop.scale.set(TABLE.rx, 1, TABLE.rz);
  tableTop.position.y = TABLE.y - 0.04;
  tableTop.receiveShadow = true;
  tableTop.castShadow = true;
  tableG.add(tableTop);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.045, 8, 64), new THREE.MeshStandardMaterial({ color: '#3e2614', roughness: 0.3 }));
  rim.rotation.x = Math.PI / 2;
  rim.scale.set(TABLE.rx, TABLE.rz, 1);
  rim.position.y = TABLE.y - 0.01;
  rim.receiveShadow = true;
  tableG.add(rim);
  const felt = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshLambertMaterial({ map: feltTex }));
  felt.rotation.x = -Math.PI / 2;
  felt.scale.set(TABLE.rx - 0.2, TABLE.rz - 0.2, 1);
  felt.position.y = TABLE.y + 0.001;
  felt.receiveShadow = true;
  tableG.add(felt);
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, TABLE.y - 0.08, 8), flat('#3a2414'));
  pedestal.position.y = (TABLE.y - 0.08) / 2;
  pedestal.castShadow = true;
  tableG.add(pedestal);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.08, 8), flat('#3a2414'));
  foot.position.y = 0.04;
  tableG.add(foot);
  // Kerze und Krug als Deko am Rand (zwischen den Plätzen variiert die Lage nicht)
  const candleG = new THREE.Group();
  candleG.position.set(TABLE.rx - 0.32, TABLE.y, -0.42);
  const holder = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.03, 8), flat('#8a6a2a'));
  holder.position.y = 0.015;
  const wax = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.033, 0.16, 7), flat('#efe6cf'));
  wax.position.y = 0.11;
  const candleFlame = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.06, 5), new THREE.MeshBasicMaterial({ color: hdr('#ffd27a', 3) }));
  candleFlame.position.y = 0.22;
  candleG.add(holder, wax, candleFlame);
  holder.castShadow = wax.castShadow = true;
  tableG.add(candleG);

  // Hängelampe
  const lamp = new THREE.Group();
  lamp.position.set(0, lampY, 0);
  scene.add(lamp);
  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.42, 0.26, 12, 1, true),
    new THREE.MeshStandardMaterial({ color: '#2b4536', side: THREE.DoubleSide, roughness: 0.35, metalness: 0.7 }),
  );
  shade.position.y = 0.13;
  const shadeIn = new THREE.Mesh(
    new THREE.CylinderGeometry(0.098, 0.415, 0.255, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: '#ffd9a0', side: THREE.BackSide }),
  );
  shadeIn.position.y = 0.13;
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color: hdr('#fff2cf', 3) }));
  bulb.position.y = 0.04;
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, RH - lampY - 0.26, 4), flat('#111'));
  cord.position.y = 0.26 + (RH - lampY - 0.26) / 2;
  lamp.add(shade, shadeIn, bulb, cord);

  // Lichtkegel (weicher Volumen-Fake)
  const coneMat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color('#ffc98a') }, opacity: { value: 0.2 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vH;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); vH = uv.y; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 color; uniform float opacity; varying vec3 vN; varying vec3 vV; varying float vH;
      void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 2.2); float a = f * smoothstep(0.0, 1.0, vH) * opacity; gl_FragColor = vec4(color * a, a); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const coneH = lampY - TABLE.y + 0.1;
  const lightCone = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.75, coneH, 32, 1, true), coneMat);
  lightCone.position.y = lampY - coneH / 2;
  lightCone.renderOrder = 5;
  scene.add(lightCone);

  // Staub im Licht
  const DUST = 180;
  const dustPos = new Float32Array(DUST * 3);
  const dustSeed = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) {
    dustSeed[i * 3] = R() * Math.PI * 2;
    dustSeed[i * 3 + 1] = Math.sqrt(R());
    dustSeed[i * 3 + 2] = R();
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dotTex = canvasTex(64, 64, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({ map: dotTex, size: 0.022, color: '#ffd9a0', transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  dust.frustumCulled = false;
  scene.add(dust);

  // Rauchschwaden
  const smokeTex = canvasTex(256, 256, softBlob);
  const smokes = [];
  for (let i = 0; i < 15; i++) {
    const m = new THREE.SpriteMaterial({ map: smokeTex, color: '#b8a088', transparent: true, opacity: 0.07 + R() * 0.06, depthWrite: false });
    const s = new THREE.Sprite(m);
    const sc = 1.6 + R() * 1.8;
    s.scale.set(sc, sc, 1);
    s.userData = { a: R() * Math.PI * 2, r: 0.6 + R() * 2.2, y: 1.75 + R() * 1.0, sp: (R() - 0.5) * 0.06, rot: (R() - 0.5) * 0.1 };
    s.renderOrder = 6;
    scene.add(s);
    smokes.push(s);
  }

  // Lichthöfe um Flammen und Lampe (additive Sprites statt teurer Nachbearbeitung)
  const haloTex = canvasTex(128, 128, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.35)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.08)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
  const halos = [];
  function halo(parent, pos, size, color, strength = 1) {
    const m = new THREE.SpriteMaterial({ map: haloTex, color, transparent: true, opacity: strength, blending: THREE.AdditiveBlending, depthWrite: false });
    const sp = new THREE.Sprite(m);
    sp.position.copy(pos);
    sp.scale.setScalar(size);
    sp.renderOrder = 7;
    sp.userData = { size, strength, ph: R() * 10 };
    parent.add(sp);
    halos.push(sp);
    return sp;
  }
  for (const f of sconces) halo(f.parent, f.position, 0.42, '#ffb35a', 0.7);
  halo(candleG, candleFlame.position, 0.3, '#ffb35a', 0.75);
  halo(lamp, bulb.position, 1.1, '#ffcf8a', 0.55);
  halo(fire, new THREE.Vector3(0, 0.4, 0.25), 1.9, '#ff7a26', 0.5);
  for (const b of pendants) halo(b.parent, b.position, 0.55, '#ffc070', 0.5);

  // ---------- Animation der Umgebung ----------
  function animateEnv(t) {
    const fl = 0.85 + Math.sin(t * 11) * 0.06 + Math.sin(t * 17.3) * 0.05 + Math.sin(t * 5.1) * 0.06;
    fireLight.intensity = 9 * fl;
    for (const f of flames) {
      const ph = f.userData.ph;
      f.scale.y = 0.8 + Math.sin(t * 9 + ph) * 0.2 + Math.sin(t * 15 + ph * 2) * 0.1;
      f.position.y = f.userData.base + Math.sin(t * 7 + ph) * 0.02;
    }
    for (const s of sconces) s.scale.y = 0.9 + Math.sin(t * 13 + s.userData.ph) * 0.15;
    candleFlame.scale.set(1 + Math.sin(t * 19) * 0.08, 0.9 + Math.sin(t * 13) * 0.15, 1);
    sconceLight.intensity = 2.2 * (0.92 + Math.sin(t * 9.3) * 0.06);
    // Neon: ruhiges Summen, ab und zu ein kurzes Flackern
    for (const n of neons) {
      const u = n.userData;
      if (u.juke) {
        n.material.color.setHSL((t * 0.05) % 1, 0.5, 0.5).multiplyScalar(u.k * 1.6);
        continue;
      }
      if (u.flicker <= 0 && Math.random() < 0.0015) u.flicker = 0.35;
      u.flicker -= 1 / 60;
      u.level = (u.flicker > 0 && Math.sin(t * 90 + u.ph) > 0.2 ? 0.25 : 1) * (0.96 + Math.sin(t * 50 + u.ph) * 0.04);
      n.material.color.copy(u.color).multiplyScalar(u.k * u.level);
    }
    neonLight.intensity = 3.2 * beerSign.userData.level;
    lamp.rotation.z = Math.sin(t * 0.5) * 0.012;
    lamp.rotation.x = Math.sin(t * 0.37) * 0.01;

    for (let i = 0; i < DUST; i++) {
      const a = dustSeed[i * 3] + t * 0.03 * (0.5 + dustSeed[i * 3 + 2]);
      const h = (dustSeed[i * 3 + 2] + t * 0.012 * (0.4 + dustSeed[i * 3 + 1])) % 1;
      const y = TABLE.y + 0.15 + h * (lampY - TABLE.y - 0.25);
      const rr = (1.55 - h * 1.1) * dustSeed[i * 3 + 1];
      dustPos[i * 3] = Math.cos(a) * rr + Math.sin(t * 0.3 + i) * 0.04;
      dustPos[i * 3 + 1] = y;
      dustPos[i * 3 + 2] = Math.sin(a) * rr;
    }
    dustGeo.attributes.position.needsUpdate = true;

    for (const h of halos) {
      const u = h.userData;
      const k = 0.88 + Math.sin(t * 9.7 + u.ph) * 0.06 + Math.sin(t * 15.3 + u.ph * 2) * 0.05;
      h.scale.setScalar(u.size * k);
      h.material.opacity = u.strength * k;
    }
    for (const s of smokes) {
      const u = s.userData;
      const a = u.a + t * u.sp;
      s.position.set(Math.cos(a) * u.r, u.y + Math.sin(t * 0.2 + u.a) * 0.15, Math.sin(a) * u.r * 0.8 - 0.4);
      s.material.rotation = u.a + t * u.rot;
    }
  }

  // ---------- Größe ----------
  // ---------- Spiegelungen: Umgebungsbild der Kneipe (einmal, vom Platz über dem Tisch) ----------
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(scene, 0.03, 0.1, 30, { size: 128, position: new THREE.Vector3(0, 1.45, 0.6) }).texture;
  scene.environmentIntensity = 0.7;
  pmrem.dispose();

  // ---------- Nachbearbeitung (Bloom, Farben, Vignette, Korn); ?nofx schaltet sie ab ----------
  const params = new URLSearchParams(location.search);
  const post = params.has('nofx') ? null : createPost(renderer, scene, camera);
  if (!post) document.body.classList.add('nofx');

  function render(t) {
    if (post) post.render(t);
    else renderer.render(scene, camera);
  }

  function setDpr(dpr) {
    renderer.setPixelRatio(dpr);
    renderer.setSize(innerWidth, innerHeight);
    post?.setSize(innerWidth, innerHeight, dpr);
  }

  function resize() {
    renderer.setSize(innerWidth, innerHeight);
    post?.setSize(innerWidth, innerHeight, renderer.getPixelRatio());
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);

  // Bildrate halten: Liegt die Bildrate zweimal hintereinander (je 2 s) unter 40 FPS,
  // werden zuerst Extras abgeschaltet (cheapSteps: Bloom), danach wird die Pixelratio in
  // kleinen Schritten gesenkt (nie unter 1). Schatten, Farbgebung und Lichteffekte
  // bleiben. ?hq schaltet das ab.
  const fixed = params.has('hq');
  const perf = { dpr: maxDpr, t0: 0, frames: 0, low: 0, start: 0 };
  const cheapSteps = [];
  if (post) cheapSteps.push(() => (post.bloom.enabled = false));
  function adaptQuality(t) {
    if (fixed || document.hidden || (perf.dpr <= 1 && !cheapSteps.length)) return;
    if (!perf.start) perf.start = t;
    if (t - perf.start < 4) return; // Shader-Kompilierung am Anfang ignorieren
    if (!perf.t0 || t - perf.t0 > 5) {
      perf.t0 = t; // auch nach Pausen (Tab im Hintergrund) neu beginnen
      perf.frames = 0;
      return;
    }
    perf.frames += 1;
    const span = t - perf.t0;
    if (span < 2) return;
    const fps = perf.frames / span;
    perf.t0 = t;
    perf.frames = 0;
    perf.low = fps < 40 ? perf.low + 1 : 0;
    if (perf.low >= 2) {
      perf.low = 0;
      if (cheapSteps.length) {
        cheapSteps.shift()();
        return;
      }
      perf.dpr = Math.max(1, perf.dpr - 0.25);
      setDpr(perf.dpr);
    }
  }

  return { renderer, scene, camera, animateEnv, adaptQuality, cheapSteps, perf, spot, fill, lampY, render, post };
}
