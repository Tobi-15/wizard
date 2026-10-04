// Karten als Three.js-Objekte. Die Vorderseiten werden auf Canvas gezeichnet –
// im selben Design wie im 2D-Client (gleiche Symbole, Farben und Bildkarten).

import * as THREE from 'three';

export const CARD_ASPECT = 5 / 7.2; // Breite / Höhe wie .card im 2D-Client
const W = 256;
const H = 368;

export const SUITS = ['red', 'yellow', 'green', 'blue'];
export const SUIT_NAMES = { red: 'Rot', yellow: 'Gelb', green: 'Grün', blue: 'Blau' };
export const SUIT_HEX = { red: '#d23c3c', yellow: '#d39b00', green: '#22914a', blue: '#2b67c9' };
// Auf den Karten selbst ist Gelb etwas dunkler, damit es unter warmem Licht lesbar bleibt
const INK = { ...SUIT_HEX, yellow: '#b67c00' };

// Eigene Bilder für Zauberer und Narren (wie CARD_ART in public/client.js)
export const CARD_ART = {
  Z1: '../img/cards/z1.jpg',
  Z2: '../img/cards/z2.jpg',
  Z3: '../img/cards/z3.jpg',
  Z4: '../img/cards/z4.jpg',
  N1: '../img/cards/n1.jpg',
  N2: '../img/cards/n2.jpg',
  N3: '../img/cards/n3.jpg',
  N4: '../img/cards/n4.jpg',
};

// Pfade aus dem SVG-Sprite (viewBox 0 0 24 24)
const PATHS = {
  red: 'M12.2 1.8c.9 3.4 4.9 5.9 4.9 11a5.1 5.1 0 0 1-10.2 0c0-2.6 1.2-4.2 2.4-5.5.3 1.7 1.2 2.7 2.3 3.1-.6-2.9-.4-5.6.6-8.6z',
  green: 'M20.5 3.2C10.6 3.4 4 8.6 4 15c0 2 .6 3.5 1.4 4.4.8-4 3.6-7.7 8.6-10-3.8 2.8-6 6.3-6.9 10.3 1.1.8 2.5 1.3 4.3 1.3 6.4 0 9.3-6.3 9.1-17.8z',
  blue: 'M12 2.4c3.6 4.7 6.7 8.5 6.7 12.3a6.7 6.7 0 0 1-13.4 0c0-3.8 3.1-7.6 6.7-12.3z',
  sunRays: 'M12 2.2v2.6M12 19.2v2.6M2.2 12h2.6M19.2 12h2.6M5.1 5.1l1.8 1.8M17.1 17.1l1.8 1.8M5.1 18.9l1.8-1.8M17.1 6.9l1.8-1.8',
  Z: 'M12 1.8l3 6.3 6.8.8-5 4.8 1.3 6.8L12 17.3l-6.1 3.2 1.3-6.8-5-4.8 6.8-.8z',
  N: 'M4.6 15.2L3.2 6.6l5.3 3.9L12 3.6l3.5 6.9 5.3-3.9-1.4 8.6z M4 16.6h16l-.8 2.8H4.8z',
};
const path2d = {};
const P = (k) => (path2d[k] ??= new Path2D(PATHS[k]));

/** Zeichnet ein Symbol (Farbe, Z oder N) zentriert bei x/y mit Kantenlänge size. */
export function drawIcon(ctx, kind, x, y, size, color) {
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  if (kind === 'yellow') {
    ctx.beginPath();
    ctx.arc(12, 12, 4.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.stroke(P('sunRays'));
  } else {
    ctx.fill(P(kind));
    if (kind === 'N') {
      for (const [cx, cy] of [[3.2, 5.4], [12, 2.4], [20.8, 5.4]]) {
        ctx.beginPath();
        ctx.arc(cx, cy, 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// ---------- Bilder für Zauberer/Narren ----------
const images = {};
const imageListeners = new Set();
for (const [id, src] of Object.entries(CARD_ART)) {
  const img = new Image();
  img.onload = () => {
    images[id] = img;
    for (const fn of imageListeners) fn(id);
  };
  img.src = src;
}

const DISPLAY = '"Cinzel", Georgia, serif';

function drawFront(ctx, card) {
  ctx.clearRect(0, 0, W, H);
  const r = W * 0.11;
  if (card.kind === 'Z' || card.kind === 'N') return drawSpecial(ctx, card, r);

  const c = INK[card.suit];
  // Elfenbein-Grund
  const bg = ctx.createLinearGradient(0, 0, W * 0.4, H);
  bg.addColorStop(0, '#fffdf7');
  bg.addColorStop(0.55, '#fffaf0');
  bg.addColorStop(1, '#f3ead6');
  roundRect(ctx, 1.5, 1.5, W - 3, H - 3, r);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(40, 30, 20, 0.55)';
  ctx.stroke();
  // Rahmen in Farbe
  const ins = W * 0.065;
  roundRect(ctx, ins, ins, W - 2 * ins, H - 2 * ins, W * 0.07);
  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = c;
  ctx.fill();
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = 2;
  ctx.strokeStyle = c;
  ctx.stroke();
  ctx.restore();
  // Wasserzeichen
  ctx.save();
  ctx.globalAlpha = 0.16;
  drawIcon(ctx, card.suit, W / 2, H * 0.52, W * 0.68, c);
  ctx.restore();
  // Große Zahl
  ctx.fillStyle = c;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(W * 0.46)}px ${DISPLAY}`;
  ctx.fillText(String(card.value), W / 2, H / 2 + W * 0.03);
  // Ecken (oben links, unten rechts gedreht)
  const corner = () => {
    ctx.font = `700 ${Math.round(W * 0.2)}px ${DISPLAY}`;
    ctx.fillText(String(card.value), W * 0.17, W * 0.2);
    drawIcon(ctx, card.suit, W * 0.17, W * 0.39, W * 0.16, c);
  };
  corner();
  ctx.save();
  ctx.translate(W, H);
  ctx.rotate(Math.PI);
  corner();
  ctx.restore();
}

function drawSpecial(ctx, card, r) {
  const isZ = card.kind === 'Z';
  const c = isZ ? '#e9c46a' : '#ffffff';
  const bg = ctx.createLinearGradient(0, 0, W * 0.5, H);
  bg.addColorStop(0, isZ ? '#6c4cc4' : '#a2a9b0');
  bg.addColorStop(1, isZ ? '#2f1f66' : '#5b6168');
  roundRect(ctx, 1.5, 1.5, W - 3, H - 3, r);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = isZ ? '#1d1347' : '#3e4348';
  ctx.stroke();
  const name = isZ ? 'ZAUBERER' : 'NARR';
  const img = images[card.id];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (img) {
    // Foto füllt die Karte, Schriftband unten, rundes Abzeichen oben links
    const x = W * 0.07;
    const y = H * 0.055;
    const w = W * 0.86;
    const h = H * (1 - 0.055 - 0.19);
    ctx.save();
    roundRect(ctx, x, y, w, h, W * 0.06);
    ctx.clip();
    const s = Math.max(w / img.width, h / img.height);
    const dw = img.width * s;
    const dh = img.height * s;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) * 0.3, dw, dh);
    ctx.restore();
    roundRect(ctx, x, y, w, h, W * 0.06);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = isZ ? 'rgba(233,196,106,0.7)' : 'rgba(255,255,255,0.6)';
    ctx.stroke();
    ctx.fillStyle = c;
    ctx.font = `700 ${Math.round(W * 0.13)}px ${DISPLAY}`;
    ctx.fillText(name, W / 2, H - W * 0.15);
    // Abzeichen
    const br = W * 0.13;
    ctx.beginPath();
    ctx.arc(W * 0.02 + br + 4, W * 0.02 + br + 4, br, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = isZ ? '#1c1438' : '#2b2f33';
    ctx.font = `700 ${Math.round(W * 0.15)}px ${DISPLAY}`;
    ctx.fillText(card.kind, W * 0.02 + br + 4, W * 0.02 + br + 6);
    return;
  }

  const ins = W * 0.065;
  roundRect(ctx, ins, ins, W - 2 * ins, H - 2 * ins, W * 0.07);
  ctx.lineWidth = 2;
  ctx.strokeStyle = isZ ? 'rgba(233,196,106,0.55)' : 'rgba(255,255,255,0.55)';
  ctx.stroke();
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  drawIcon(ctx, card.kind, W / 2, H / 2, W * 0.56, c);
  ctx.restore();
  ctx.fillStyle = c;
  ctx.font = `700 ${Math.round(W * 0.2)}px ${DISPLAY}`;
  ctx.fillText(card.kind, W * 0.17, W * 0.2);
  ctx.font = `700 ${Math.round(W * 0.12)}px ${DISPLAY}`;
  ctx.fillText(name, W / 2, H - W * 0.17);
}

function drawBack(ctx) {
  ctx.clearRect(0, 0, W, H);
  const r = W * 0.11;
  const bg = ctx.createLinearGradient(0, 0, W * 0.5, H);
  bg.addColorStop(0, '#6c4cc4');
  bg.addColorStop(1, '#2f1f66');
  roundRect(ctx, 1.5, 1.5, W - 3, H - 3, r);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#1d1347';
  ctx.stroke();
  // Punktmuster
  ctx.save();
  roundRect(ctx, W * 0.07, W * 0.07, W - W * 0.14, H - W * 0.14, W * 0.07);
  ctx.clip();
  ctx.fillStyle = 'rgba(233,196,106,0.5)';
  const step = W / 11;
  for (let y = step / 2; y < H; y += step) {
    for (let x = step / 2; x < W; x += step) {
      ctx.beginPath();
      ctx.arc(x, y, W * 0.012, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  roundRect(ctx, W * 0.07, W * 0.07, W - W * 0.14, H - W * 0.14, W * 0.07);
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(233,196,106,0.85)';
  ctx.stroke();
  // Medaillon mit Stern
  ctx.beginPath();
  ctx.ellipse(W / 2, H / 2, W * 0.27, W * 0.33, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#2a1b5c';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#e9c46a';
  ctx.stroke();
  drawIcon(ctx, 'Z', W / 2, H / 2, W * 0.36, '#e9c46a');
}

// ---------- Texturen (lazy, gecacht) ----------
let maxAniso = 1;
export function setAnisotropy(n) {
  maxAniso = n;
}

const faces = new Map(); // id -> { canvas, ctx, tex, card }
function makeTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

function face(card) {
  let f = faces.get(card.id);
  if (!f) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    drawFront(ctx, card);
    f = { canvas, ctx, card, tex: makeTexture(canvas) };
    faces.set(card.id, f);
  }
  return f;
}

let backFace = null;
function back() {
  if (!backFace) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    drawBack(ctx);
    backFace = { canvas, ctx, tex: makeTexture(canvas) };
  }
  return backFace;
}

function redraw(f) {
  drawFront(f.ctx, f.card);
  f.tex.needsUpdate = true;
  f.url = null;
}
imageListeners.add((id) => {
  const f = faces.get(id);
  if (f) redraw(f);
});
/** Nach dem Laden der Schrift alle bisher gezeichneten Karten neu zeichnen. */
export function redrawAll() {
  for (const f of faces.values()) redraw(f);
  if (backFace) {
    drawBack(backFace.ctx);
    backFace.tex.needsUpdate = true;
  }
}

/** Karte als <img> für HTML-Overlays (Trumpfanzeige, letzter Stich). */
export function cardImage(card, cls = '') {
  const img = document.createElement('img');
  img.className = `card-img ${cls}`;
  img.alt = card.kind === 'Z' ? 'Zauberer' : card.kind === 'N' ? 'Narr' : `${SUIT_NAMES[card.suit]} ${card.value}`;
  const f = face(card);
  img.src = f.url ??= f.canvas.toDataURL('image/png');
  return img;
}

// ---------- Materialien & Meshes ----------
const geo = new THREE.PlaneGeometry(CARD_ASPECT, 1);
const mats = new Map();

function material(key, tex, mode) {
  const k = `${mode}:${key}`;
  let m = mats.get(k);
  if (!m) {
    if (mode === 'hand') {
      // transparent, damit die Hand nach Rauch/Staub gezeichnet wird (renderOrder hoch)
      m = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, transparent: true, fog: false, depthTest: false, depthWrite: false, toneMapped: false });
    } else {
      // ohne Tonemapping, damit Zahlen und Farben auf dem Tisch kräftig bleiben
      m = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.22, toneMapped: false });
    }
    mats.set(k, m);
  }
  return m;
}

/**
 * Neue Karte (Gruppe aus Vorder- und Rückseite, Höhe 1, Breite CARD_ASPECT).
 * card = null erzeugt eine Karte, deren Vorderseite (noch) unbekannt ist.
 * mode: 'world' (beleuchtet, im Raum) oder 'hand' (immer sichtbar, vor der Kamera).
 */
export function makeCard(card, mode = 'world') {
  const g = new THREE.Group();
  const frontMat = card ? material(card.id, face(card).tex, mode) : material('back', back().tex, mode);
  const front = new THREE.Mesh(geo, frontMat);
  const backMesh = new THREE.Mesh(geo, material('back', back().tex, mode));
  backMesh.rotation.y = Math.PI;
  front.castShadow = backMesh.castShadow = mode === 'world';
  g.add(front, backMesh);
  g.userData = { card, front, back: backMesh, mode };
  return g;
}

/** Vorderseite nachträglich aufdecken (z. B. beim Austeilen) bzw. Modus wechseln. */
export function setCardFace(g, card, mode = g.userData.mode) {
  g.userData.card = card;
  g.userData.mode = mode;
  g.userData.front.material = card ? material(card.id, face(card).tex, mode) : material('back', back().tex, mode);
  g.userData.back.material = material('back', back().tex, mode);
  g.userData.front.castShadow = g.userData.back.castShadow = mode === 'world';
}

/** Einzelnes Kartenrücken-Mesh (für Fächer in den Händen der Mitspieler und Stichstapel). */
export function backMesh() {
  const m = new THREE.Mesh(geo, material('back', back().tex, 'world'));
  m.castShadow = true;
  return m;
}
export function backMaterial() {
  return material('back', back().tex, 'world');
}
export function cardGeometry() {
  return geo;
}

/** Hand-Material einer Karte (eigene Instanz pro Karte, damit sie abgedunkelt werden kann). */
export function handTint(g, color) {
  const m = g.userData.front.material;
  if (!m.color.equals(color)) m.color.copy(color);
}
