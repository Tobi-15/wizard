// Spieltisch in 3D: gleicht den Serverzustand mit der Szene ab und animiert die
// Unterschiede (Austeilen, Ausspielen, Stich einsammeln, Reaktionen der Gäste).

import * as THREE from 'three';
import { makeCard, setCardFace, CARD_ASPECT, backMesh, handTint } from './cards.js';
import { Character, assignArchetypes, flat } from './characters.js';
import { TABLE, seatAngle, seatPos, trickSpot, pileSpot, ringSpot, deckSpot, tangent } from './layout.js';
import { tween, after, cancel, cancelGroup, now, hashStr, clamp, easeOut, easeInOut } from './util.js';

const TRICK_H = 0.4; // Höhe einer Karte im Stich (Meter)
const PILE_H = 0.24; // Höhe einer Karte im Stichstapel
const DECK_H = 0.24;
const FAN_H = 0.17;

const WHITE = new THREE.Color(1, 1, 1);
const DIM = new THREE.Color(0.14, 0.13, 0.12); // linear → wirkt etwa 40 % hell

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const Y = new THREE.Vector3(0, 1, 0);

function quatFlat(faceUp, rotY, spin = 0) {
  // Karte flach hinlegen: Vorderseite nach oben (faceUp) oder unten, Oberkante zeigt nach -z,
  // danach um die Hochachse drehen.
  const q = new THREE.Quaternion().setFromEuler(_e.set(faceUp ? -Math.PI / 2 : Math.PI / 2, 0, faceUp ? spin : -spin));
  return new THREE.Quaternion().setFromAxisAngle(Y, rotY).multiply(q);
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 160;
  const ctx = c.getContext('2d');
  ctx.filter = 'blur(10px)';
  ctx.fillStyle = 'rgba(255, 210, 120, 1)';
  ctx.beginPath();
  ctx.roundRect(22, 22, 84, 116, 14);
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class TableView {
  constructor(world, hooks) {
    this.world = world;
    this.scene = world.scene;
    this.camera = world.camera;
    this.hooks = hooks; // { sortHand, sound(name), bubble(seat, text), play(cardId), illegal() }
    this.chars = new Map(); // `${id}:${arch}` -> { char, target }
    this.seatChars = [];
    this.n = 0;
    this.mySeat = 0;
    this.g = null;
    this.roundKey = null;
    this.round = Symbol('round');
    this.hand = new Map(); // id -> { obj, hit, card, index, lift, hover, ... }
    this.trick = new Map(); // id -> { obj, seat }
    this.piles = [];
    this.dealing = false;
    this.collecting = 0;
    this.hovered = null;
    this.pressed = null;
    this.pending = null;
    this.handLayout = { upp: 0.001, ch: 150 };
    this.cheerAt = 0;

    this.handGroup = new THREE.Group();
    this.camera.add(this.handGroup);
    // Alles, was zu einer Runde gehört (Stich, fliegende Karten, Stapel, Trumpf), hängt hier.
    // So bleibt beim Rundenwechsel nichts liegen, auch wenn eine Animation abgebrochen wird.
    this.roundRoot = new THREE.Group();
    this.scene.add(this.roundRoot);
    this.raycaster = new THREE.Raycaster();

    // Kamera
    this.mode = 'orbit';
    this.camPos = this.camera.position.clone();
    this.camLook = new THREE.Vector3(0, 1, 0);
    this.fit = { pos: new THREE.Vector3(0, 2.4, 4.5), look: new THREE.Vector3(0, 0.95, -0.1) };
    this.fitKey = '';
    this.scratchCam = new THREE.PerspectiveCamera();
    this.inset = 0; // linker Bildbereich, der von einem Panel verdeckt ist (px)
    this.insetCur = 0;

    // Leuchtring für den Spieler am Zug
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.13, 0.19, 40),
      new THREE.MeshBasicMaterial({ color: '#ffcf6a', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.ring.renderOrder = 3;
    this.scene.add(this.ring);
    this.ringTarget = new THREE.Vector3();

    // Glühen unter der Siegerkarte
    this.glow = new THREE.Mesh(
      new THREE.PlaneGeometry(CARD_ASPECT * 1.55, 1.42),
      new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.glow.visible = false;
    this.glow.renderOrder = 2;
    this.scene.add(this.glow);
    this.glowFor = null;

    // Geberstapel
    this.deck = new THREE.Group();
    this.deckBox = new THREE.Mesh(new THREE.BoxGeometry(DECK_H * CARD_ASPECT * 0.96, 1, DECK_H * 0.96), flat('#d9ceb2'));
    this.deckBox.castShadow = true;
    this.deckTop = backMesh();
    this.deckTop.scale.setScalar(DECK_H);
    this.deckTop.rotation.x = -Math.PI / 2;
    this.deck.add(this.deckBox, this.deckTop);
    this.deck.visible = false;
    this.scene.add(this.deck);
    this.deckCount = 0;
    this.trumpObj = null;
  }

  angle(seat) {
    return seatAngle(seat, this.mySeat, this.n);
  }

  // ---------- Sitzordnung & Figuren ----------
  setSeating(players, myIndex) {
    const n = players.length;
    const changed = n !== this.n || myIndex !== this.mySeat;
    this.n = n;
    this.mySeat = myIndex;
    const arch = assignArchetypes(players.map((p) => p.id), hashStr);
    const keep = new Set();
    this.seatChars = players.map((p, i) => {
      if (i === myIndex) return null;
      const key = `${p.id}:${arch[i]}`;
      keep.add(key);
      let entry = this.chars.get(key);
      const a = seatAngle(i, myIndex, n);
      const pos = seatPos(a);
      const rotY = Math.atan2(-pos.x, -pos.z);
      if (!entry) {
        const char = new Character(arch[i], hashStr(p.id));
        char.root.position.copy(pos);
        char.root.rotation.y = rotY;
        this.scene.add(char.root);
        entry = { char, pos: pos.clone(), rotY };
        char.seatEntry = entry;
        this.chars.set(key, entry);
        char.react('wave', now(), { delay: 0.3 + Math.random() * 0.4 });
      }
      entry.pos.copy(pos);
      entry.rotY = rotY;
      return entry.char;
    });
    for (const [key, entry] of this.chars) {
      if (!keep.has(key)) {
        this.scene.remove(entry.char.root);
        this.chars.delete(key);
      }
    }
    if (changed) this.fitKey = '';
  }

  charAt(seat) {
    return this.seatChars[seat] ?? null;
  }

  // ---------- Zustand abgleichen ----------
  /** Lobby: nur Figuren zeigen, kein Spiel. */
  showLobby(room, meId) {
    this.clearGame();
    const idx = Math.max(0, room.players.findIndex((p) => p.id === meId));
    this.setSeating(room.players, idx);
    this.mode = 'seat';
  }

  showStart() {
    this.clearGame();
    // Stammgäste, damit die Kneipe nicht leer ist
    const demo = ['me', 'Stammgast-Alrik', 'Stammgast-Hedda', 'Stammgast-Bruno', 'Stammgast-Zora'].map((id) => ({ id }));
    this.setSeating(demo, 0);
    this.seatChars.forEach((c, i) => c?.setCardCount(3 + i));
    this.mode = 'orbit';
  }

  clearGame() {
    if (!this.g && !this.roundKey) return;
    this.clearRound();
    this.g = null;
    this.roundKey = null;
    for (const c of this.seatChars) if (c) c.setTurn(false, now());
  }

  clearRound() {
    cancelGroup(this.round);
    this.round = Symbol('round');
    for (const h of this.hand.values()) this.handGroup.remove(h.obj, h.hit);
    this.hand.clear();
    this.trick.clear();
    this.roundRoot.clear();
    this.piles = [];
    this.trumpObj = null;
    this.deck.visible = false;
    this.glow.visible = false;
    this.glowFor = null;
    this.ring.visible = false;
    this.dealing = false;
    this.collecting = 0;
    this.pending = null;
    this.hovered = null;
    for (const c of this.seatChars) if (c) c.setCardCount(0);
  }

  sync(state) {
    const g = state.game;
    if (!g) return this.showLobby(state.room, state.me);
    this.mode = 'seat';
    this.setSeating(g.seats, g.mySeat);
    const prev = this.g;
    this.g = g;
    const key = `${g.round}|${g.maxRounds}|${g.seats.map((s) => s.id).join(',')}`;
    if (key !== this.roundKey || (prev && g.history.length < prev.history.length)) {
      this.roundKey = key;
      this.startRound(g);
      return;
    }
    if (this.pending && !g.hand.some((c) => c.id === this.pending)) this.pending = null;
    this.syncTrick(g, prev, false);
    if (!this.dealing) {
      this.syncHand(g);
      this.syncCounts(g);
    }
    if (!this.collecting) this.syncPiles(g);
    this.syncReactions(g, prev);
    this.syncTurn(g);
    this.syncDeck(g);
  }

  /** Ein Fehler vom Server: angeklickte Karte wieder freigeben. */
  rejectPending() {
    this.pending = null;
  }

  startRound(g) {
    this.clearRound();
    const fresh =
      (g.phase === 'bidding' || g.phase === 'chooseTrump') &&
      g.trick.length === 0 &&
      g.seats.every((s) => s.cardCount === g.round && s.tricks === 0);
    const dealer = g.dealer;
    this.deckCount = 60 - (fresh ? 0 : g.seats.length * g.round);
    this.placeDeck(dealer);
    if (fresh && !this.hooks.reduceMotion) {
      this.deal(g);
    } else {
      this.syncTrick(g, null, true);
      this.syncHand(g, true);
      this.syncCounts(g);
      this.syncPiles(g);
      this.showTrump(g, true);
      this.syncDeck(g);
    }
    this.syncTurn(g);
  }

  // ---------- Geberstapel & Trumpf ----------
  placeDeck(dealer) {
    const a = this.angle(dealer);
    deckSpot(a, this.deck.position);
    this.deck.rotation.y = -a;
    this.updateDeckHeight();
  }

  updateDeckHeight() {
    const h = Math.max(this.deckCount, 0) * 0.0016;
    this.deck.visible = this.deckCount > 0;
    this.deckBox.scale.y = Math.max(h, 0.001);
    this.deckBox.position.y = h / 2;
    this.deckTop.position.y = h + 0.0008;
  }

  deckTopWorld(out = new THREE.Vector3()) {
    return this.deck.localToWorld(out.set(0, this.deckTop.position.y + 0.002, 0));
  }

  trumpSpot(out = new THREE.Vector3()) {
    // neben dem Stapel, zur Tischmitte hin
    const a = this.angle(this.g.dealer);
    out.copy(this.deck.position);
    out.addScaledVector(tangent(a), 0.27);
    out.addScaledVector(_v.copy(this.deck.position).setY(0).normalize(), -0.03);
    out.y = TABLE.y + 0.005;
    return out;
  }

  showTrump(g, instant) {
    if (!g.trumpCard) return;
    const obj = makeCard(g.trumpCard, 'world');
    const a = this.angle(g.dealer);
    const target = this.trumpSpot();
    const q = quatFlat(true, -a + Math.PI / 2 + 0.12);
    this.trumpObj = obj;
    this.roundRoot.add(obj);
    if (instant) {
      obj.position.copy(target);
      obj.quaternion.copy(q);
      obj.scale.setScalar(DECK_H);
      return;
    }
    this.deckTopWorld(obj.position);
    obj.quaternion.copy(quatFlat(false, -a));
    obj.scale.setScalar(DECK_H);
    this.deckCount -= 1;
    this.updateDeckHeight();
    this.fly(obj, target, q, DECK_H, 0.55, { arc: 0.22, onDone: () => this.hooks.sound('card') });
  }

  syncDeck(g) {
    if (this.dealing) return;
    const rest = 60 - g.seats.length * g.round - (g.trumpCard ? 1 : 0);
    if (rest !== this.deckCount) {
      this.deckCount = rest;
      this.updateDeckHeight();
    }
  }

  // ---------- Austeilen ----------
  deal(g) {
    this.dealing = true;
    const n = g.seats.length;
    const order = [];
    for (let k = 0; k < g.round; k++) for (let i = 1; i <= n; i++) order.push((g.dealer + i) % n);
    const step = clamp(1.6 / order.length, 0.035, 0.12);
    const counts = g.seats.map(() => 0);
    const myCards = this.hooks.sortHand(g.hand, g.trump);
    let mine = 0;
    const group = this.round;
    const a0 = this.angle(g.dealer);
    order.forEach((seat, j) => {
      after(
        j * step,
        () => {
          const fly = makeCard(null, 'world');
          this.deckTopWorld(fly.position);
          fly.quaternion.copy(quatFlat(false, -a0));
          fly.scale.setScalar(DECK_H);
          this.roundRoot.add(fly);
          this.deckCount -= 1;
          this.updateDeckHeight();
          if (j % 2 === 0) this.hooks.sound('deal');
          let dest;
          let q;
          let size;
          if (seat === this.mySeat) {
            dest = this.handEntryWorld();
            q = this.camera.quaternion.clone();
            size = 0.12;
          } else {
            const ch = this.charAt(seat);
            dest = ch ? ch.fanWorld() : seatPos(this.angle(seat)).setY(1);
            q = new THREE.Quaternion();
            if (ch) ch.fan.getWorldQuaternion(q);
            size = FAN_H;
          }
          this.fly(fly, dest, q, size, 0.34, {
            arc: 0.25,
            ease: easeOut,
            onDone: () => {
              this.roundRoot.remove(fly);
              if (seat === this.mySeat) {
                const card = myCards[mine++];
                if (card) {
                  this.addHandCard(card, false);
                  this.layoutHand();
                }
              } else {
                counts[seat] += 1;
                this.charAt(seat)?.setCardCount(counts[seat]);
              }
            },
          });
        },
        group,
      );
    });
    after(
      order.length * step + 0.42,
      () => {
        this.dealing = false;
        const latest = this.g;
        if (!latest) return;
        this.showTrump(latest, false);
        this.syncHand(latest);
        this.syncCounts(latest);
        this.syncTrick(latest, null, false);
        this.syncPiles(latest);
        this.syncDeck(latest);
      },
      group,
    );
  }

  // ---------- Fliegende Karten ----------
  fly(obj, pos, quat, scale, dur, { arc = 0.15, delay = 0, ease = easeInOut, onDone } = {}) {
    cancel(obj.userData.tw);
    const p0 = new THREE.Vector3();
    const q0 = new THREE.Quaternion();
    const target = pos.clone();
    const tq = quat.clone();
    let s0 = 1;
    obj.userData.tw = tween(
      dur,
      (e, raw) => {
        obj.position.lerpVectors(p0, target, e);
        obj.position.y += Math.sin(raw * Math.PI) * arc;
        obj.quaternion.slerpQuaternions(q0, tq, e);
        obj.scale.setScalar(s0 + (scale - s0) * e);
      },
      {
        delay,
        ease,
        group: this.round,
        onStart: () => {
          p0.copy(obj.position);
          q0.copy(obj.quaternion);
          s0 = obj.scale.x;
        },
        onDone,
      },
    );
  }

  // ---------- Stich ----------
  syncTrick(g, prev, instant) {
    const ids = new Set(g.trick.map((t) => t.card.id));
    const gone = [...this.trick.entries()].filter(([id]) => !ids.has(id));
    if (gone.length) {
      const firstId = gone[0][0];
      const winner = g.lastTrick?.cards.some((c) => c.card.id === firstId) ? g.lastTrick.winner : (prev?.trickWinner ?? null);
      for (const [id] of gone) this.trick.delete(id);
      this.collect(gone.map(([, t]) => t), winner, instant);
    }
    let fresh = 0;
    g.trick.forEach(({ seat, card }, idx) => {
      if (this.trick.has(card.id)) return;
      const t = this.placeTrickCard(seat, card, idx, instant, fresh * 0.18);
      this.trick.set(card.id, t);
      if (!instant && card.kind === 'Z' && !g.trick.slice(0, idx).some((c) => c.card.kind === 'Z')) {
        // Erster Zauberer im Stich: die anderen staunen
        this.seatChars.forEach((c, s) => c && s !== seat && c.react('shock', now(), { delay: 0.35 + Math.random() * 0.25 }));
      }
      fresh += 1;
    });
    // Siegerkarte hervorheben
    if (g.trickWinner != null) {
      const w = g.trick.find((t) => t.seat === g.trickWinner);
      if (w && this.glowFor !== w.card.id) {
        this.glowFor = w.card.id;
        const t = this.trick.get(w.card.id);
        const delay = instant ? 0 : 0.5;
        after(delay, () => {
          if (this.glowFor !== w.card.id || !this.trick.has(w.card.id)) return;
          this.glow.visible = true;
          this.glow.position.copy(t.final).setY(TABLE.y + 0.002);
          this.glow.quaternion.copy(t.quat);
          this.glow.scale.setScalar(TRICK_H);
          this.fly(t.obj, _v.copy(t.final).setY(t.final.y + 0.03), t.quat, TRICK_H * 1.08, 0.25, { arc: 0 });
        }, this.round);
      }
    } else if (this.glowFor && !this.trick.has(this.glowFor)) {
      this.glowFor = null;
      this.glow.visible = false;
    }
  }

  placeTrickCard(seat, card, idx, instant, delay) {
    const a = this.angle(seat);
    const final = trickSpot(a, this.n);
    final.y += idx * 0.0025;
    const spin = (((hashStr(card.id) % 17) - 8) * 0.014) + Math.sin(a) * 0.12;
    const quat = quatFlat(true, 0, spin);
    let obj;
    const h = this.hand.get(card.id);
    if (seat === this.mySeat && h) {
      obj = h.obj;
      this.handGroup.remove(h.hit);
      this.hand.delete(card.id);
      if (this.hovered === card.id) this.hovered = null;
      this.roundRoot.attach(obj);
      setCardFace(obj, card, 'world');
      for (const m of [obj.userData.front, obj.userData.back]) m.renderOrder = 0;
      this.layoutHand();
    } else {
      obj = makeCard(card, 'world');
      this.roundRoot.add(obj);
      const ch = this.charAt(seat);
      if (ch && !instant) {
        ch.fanWorld(obj.position);
        ch.fan.getWorldQuaternion(obj.quaternion);
        obj.quaternion.multiply(_q.setFromAxisAngle(Y, Math.PI));
        obj.scale.setScalar(FAN_H);
        ch.setCardCount(ch.count - 1);
        ch.react('play', now(), { target: final, delay });
      } else if (!instant) {
        // eigene Karte ohne Handobjekt (z. B. nach Neuladen): von unten ins Bild
        obj.position.copy(this.handEntryWorld());
        obj.quaternion.copy(this.camera.quaternion);
        obj.scale.setScalar(0.12);
      }
    }
    if (instant) {
      obj.position.copy(final);
      obj.quaternion.copy(quat);
      obj.scale.setScalar(TRICK_H);
    } else {
      this.fly(obj, final, quat, TRICK_H, 0.42, { arc: 0.2, delay, onDone: () => this.hooks.sound('card') });
    }
    return { obj, seat, final, quat };
  }

  collect(entries, winner, instant) {
    if (this.glowFor && entries.some((t) => t.obj.userData.card?.id === this.glowFor)) {
      this.glowFor = null;
      this.glow.visible = false;
    }
    if (winner == null || instant) {
      for (const t of entries) this.roundRoot.remove(t.obj);
      if (this.g) this.syncPiles(this.g);
      return;
    }
    this.collecting += 1;
    const a = this.angle(winner);
    const base = pileSpot(a);
    const count = this.piles[winner]?.children.length ?? 0;
    const dest = base.clone().setY(TABLE.y + 0.004 + count * 0.004);
    const q = quatFlat(false, -a + (count % 2 ? 0.5 : -0.1));
    let left = entries.length;
    entries.forEach((t, i) => {
      this.fly(t.obj, dest, q, PILE_H, 0.5, {
        arc: 0.14,
        delay: i * 0.06,
        onDone: () => {
          this.roundRoot.remove(t.obj);
          if (--left === 0) {
            this.collecting = Math.max(0, this.collecting - 1);
            if (this.g) this.syncPiles(this.g);
          }
        },
      });
    });
  }

  syncPiles(g) {
    g.seats.forEach((s, i) => {
      let pile = this.piles[i];
      if (!pile) {
        pile = this.piles[i] = new THREE.Group();
        this.roundRoot.add(pile);
      }
      const a = this.angle(i);
      pileSpot(a, pile.position);
      if (pile.children.length === s.tricks) return;
      pile.clear();
      for (let j = 0; j < s.tricks; j++) {
        const m = backMesh();
        m.scale.setScalar(PILE_H);
        m.position.y = 0.004 + j * 0.004;
        m.quaternion.copy(quatFlat(false, -a + (j % 2 ? 0.5 : -0.1)));
        // Rückseite zeigt nach oben: backMesh ist eine einseitige Fläche → umdrehen
        m.quaternion.multiply(_q.setFromAxisAngle(Y, Math.PI));
        pile.add(m);
      }
    });
  }

  syncCounts(g) {
    g.seats.forEach((s, i) => this.charAt(i)?.setCardCount(s.cardCount));
  }

  // ---------- Reaktionen ----------
  syncReactions(g, prev) {
    if (!prev || prev.round !== g.round) return;
    const t = now();
    g.seats.forEach((s, i) => {
      const ch = this.charAt(i);
      if (prev.seats[i]?.bid == null && s.bid != null) {
        ch?.react('bid', t);
        if (i !== this.mySeat) this.hooks.bubble(i, s.bid === 1 ? '1 Stich' : `${s.bid} Stiche`);
      }
    });
    if (prev.phase === 'chooseTrump' && g.phase !== 'chooseTrump' && g.trump && prev.turn != null) {
      this.charAt(prev.turn)?.react('trump', t);
      if (prev.turn !== this.mySeat) this.hooks.bubble(prev.turn, `Trumpf: ${this.hooks.suitName(g.trump)}`);
    }
    if (g.trickWinner != null && prev.trickWinner == null) {
      const ch = this.charAt(g.trickWinner);
      ch?.react('win', t, { delay: 0.45 });
    }
    if (prev.phase === 'playing' && (g.phase === 'roundEnd' || g.phase === 'gameOver')) {
      g.seats.forEach((s, i) => this.charAt(i)?.react(s.bid === s.tricks ? 'happy' : 'sad', t, { delay: 0.6 + Math.random() * 0.4 }));
    }
  }

  syncTurn(g) {
    const active = ['bidding', 'playing', 'chooseTrump'].includes(g.phase) && g.turn != null;
    const t = now();
    this.seatChars.forEach((c, i) => c?.setTurn(active && g.turn === i, t));
    this.ring.visible = active;
    if (active) ringSpot(this.angle(g.turn), this.ringTarget);
  }

  // ---------- Eigene Hand ----------
  /** Weltpunkt knapp unter der Bildmitte, wo Karten in die Hand fliegen. */
  handEntryWorld(out = new THREE.Vector3()) {
    const { upp } = this.handLayout;
    return this.camera.localToWorld(out.set(0, -innerHeight * 0.5 * upp * 0.9, -1));
  }

  addHandCard(card, instant) {
    const obj = makeCard(card, 'hand');
    const hit = new THREE.Mesh(obj.userData.front.geometry, new THREE.MeshBasicMaterial({ visible: false }));
    hit.userData.cardId = card.id;
    const h = { obj, hit, card, index: 0, lift: 0, x: 0, y: 0, rot: 0, s: 1, tx: 0, ty: 0, tr: 0, ts: 1, z: -1, legal: false };
    obj.position.set(0, -innerHeight * 0.6 * this.handLayout.upp, -1);
    this.handGroup.add(obj, hit);
    this.hand.set(card.id, h);
    h.fresh = !instant;
    return h;
  }

  syncHand(g, instant = false) {
    const sorted = this.hooks.sortHand(g.hand, g.trump);
    const ids = new Set(sorted.map((c) => c.id));
    for (const [id, h] of this.hand) {
      if (!ids.has(id)) {
        this.handGroup.remove(h.obj, h.hit);
        this.hand.delete(id);
      }
    }
    sorted.forEach((card, i) => {
      const h = this.hand.get(card.id) ?? this.addHandCard(card, instant);
      h.index = i;
    });
    this.layoutHand(instant);
  }

  layoutHand(instant = false) {
    const cam = this.camera;
    const D = 1;
    const vh = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * D;
    const upp = vh / innerHeight;
    const ch = clamp(innerHeight * 0.22, 120, 240);
    const cw = ch * CARD_ASPECT;
    this.handLayout = { upp, ch };
    const list = [...this.hand.values()].sort((a, b) => a.index - b.index);
    const n = list.length;
    if (!n) return;
    const avail = Math.min(innerWidth - 80, 1400);
    const step = n > 1 ? Math.min(cw + 10, (avail - cw) / (n - 1)) : 0;
    const maxRot = Math.min(0.16, 0.022 * n);
    list.forEach((h, i) => {
      const u = n > 1 ? (i - (n - 1) / 2) / ((n - 1) / 2) : 0;
      h.tx = (i - (n - 1) / 2) * step * upp;
      h.ty = (-innerHeight / 2 + ch * 0.4 - u * u * ch * 0.07) * upp;
      h.tr = -u * maxRot;
      h.ts = ch * upp;
      h.z = -D + i * 0.0006;
      h.hit.position.set(h.tx, h.ty + ch * 0.12 * upp, h.z);
      h.hit.rotation.z = h.tr;
      h.hit.scale.set(h.ts, h.ts * 1.24, 1);
      if (instant) {
        h.x = h.tx;
        h.y = h.ty;
        h.rot = h.tr;
        h.s = h.ts;
      }
    });
  }

  /** NDC-Koordinaten → Karten-Id unter dem Zeiger (oder null). */
  pick(ndc) {
    if (!this.hand.size) return null;
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects([...this.hand.values()].map((h) => h.hit), false);
    return hits[0]?.object.userData.cardId ?? null;
  }

  canPlay() {
    const g = this.g;
    return !!g && g.phase === 'playing' && g.turn === g.mySeat && g.trickWinner == null && !this.pending && !this.dealing;
  }

  pointerMove(ndc) {
    this.hovered = this.pick(ndc);
    return this.hovered;
  }

  click(ndc) {
    const id = this.pick(ndc);
    if (!id || !this.g) return false;
    if (!this.canPlay()) return true;
    if (!this.g.legal.includes(id)) {
      this.hooks.illegal();
      return true;
    }
    this.pending = id;
    this.hooks.play(id);
    return true;
  }

  updateHand(dt) {
    const g = this.g;
    const active = this.canPlay();
    const { upp, ch } = this.handLayout;
    const k = 1 - Math.exp(-dt * 14);
    for (const h of this.hand.values()) {
      const legal = !!g && g.legal.includes(h.card.id);
      const hover = this.hovered === h.card.id && (active ? legal : true);
      let lift = 0;
      if (active && legal) lift += ch * 0.05;
      if (hover) lift += ch * (active ? 0.16 : 0.08);
      if (this.pending === h.card.id) lift += ch * 0.32;
      h.x += (h.tx - h.x) * k;
      h.y += (h.ty + lift * upp - h.y) * k;
      h.rot += ((hover ? h.tr * 0.4 : h.tr) - h.rot) * k;
      const ts = h.ts * (hover ? 1.07 : 1);
      h.s += (ts - h.s) * k;
      h.obj.position.set(h.x, h.y, h.z + (hover ? 0.02 : 0));
      h.obj.rotation.set(0, 0, h.rot);
      h.obj.scale.setScalar(h.s);
      const order = 1000 + (hover ? 200 : h.index * 2);
      h.obj.userData.front.renderOrder = order;
      h.obj.userData.back.renderOrder = order;
      handTint(h.obj, active && !legal ? DIM : WHITE);
    }
  }

  /** Bildschirmpositionen der eigenen Karten (für Tests und Tastatur). */
  handScreenPoints() {
    const out = [];
    for (const h of [...this.hand.values()].sort((a, b) => a.index - b.index)) {
      h.hit.updateWorldMatrix(true, false);
      // Punkt im oberen Drittel der Karte (dort überlappen die Nachbarn nicht)
      const p = h.hit.localToWorld(new THREE.Vector3(-CARD_ASPECT * 0.3, 0.3, 0)).project(this.camera);
      out.push({ id: h.card.id, x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight, legal: !!this.g?.legal.includes(h.card.id) });
    }
    return out;
  }

  // ---------- Kamera ----------
  computeFit() {
    const key = `${this.n}|${innerWidth}x${innerHeight}|${this.inset}`;
    if (key === this.fitKey) return;
    this.fitKey = key;
    const cam = this.scratchCam;
    cam.fov = this.camera.fov;
    cam.aspect = (innerWidth - this.inset) / innerHeight;
    cam.near = 0.05;
    cam.far = 40;
    cam.updateProjectionMatrix();
    const n = Math.max(this.n, 3);
    const tops = [];
    const sides = [];
    for (let rel = 1; rel < n; rel++) {
      const a = (rel * Math.PI * 2) / n;
      const p = seatPos(a);
      tops.push(p.clone().setY(2.02));
      const tan = tangent(a);
      sides.push(p.clone().setY(1.0).addScaledVector(tan, 0.38), p.clone().setY(1.0).addScaledVector(tan, -0.38));
    }
    const near = new THREE.Vector3(0, TABLE.y, TABLE.rz * 0.45);
    const look = new THREE.Vector3(0, 0.92, -0.12);
    const dir = new THREE.Vector3();
    const MAX_Y = 3.25; // unter den Deckenbalken bleiben
    const ok = (dist) => {
      cam.position.copy(look).addScaledVector(dir, dist);
      cam.lookAt(look);
      cam.updateMatrixWorld();
      for (const p of tops) {
        const s = _v.copy(p).project(cam);
        if (Math.abs(s.x) > 0.9 || s.y > 0.74) return false;
      }
      for (const p of sides) {
        const s = _v.copy(p).project(cam);
        if (Math.abs(s.x) > 1.04) return false;
      }
      return _v.copy(near).project(cam).y > -0.46;
    };
    // Steiler Blick bevorzugt; wird die Kamera dafür zu hoch, flacher werden
    let dist = 8;
    for (const elev of [0.5, 0.45, 0.4, 0.35, 0.3, 0.26]) {
      dir.set(0, Math.sin(elev), Math.cos(elev));
      let lo = 2;
      let hi = 9;
      for (let i = 0; i < 26; i++) {
        const mid = (lo + hi) / 2;
        if (ok(mid)) hi = mid;
        else lo = mid;
      }
      dist = Math.min(hi, (MAX_Y - look.y) / dir.y);
      if (look.y + dir.y * hi <= MAX_Y) break;
    }
    this.fit.pos.copy(look).addScaledVector(dir, dist);
    this.fit.look.copy(look);
  }

  updateCamera(t, dt) {
    let pos;
    let look;
    if (this.mode === 'orbit') {
      const a = t * 0.06;
      pos = _v.set(Math.sin(a) * 4.6, 2.3 + Math.sin(t * 0.2) * 0.15, Math.cos(a) * 4.0);
      look = new THREE.Vector3(0, 1.0, 0);
    } else {
      this.computeFit();
      pos = _v.copy(this.fit.pos);
      pos.x += Math.sin(t * 0.31) * 0.025;
      pos.y += Math.sin(t * 0.43) * 0.015;
      look = this.fit.look;
    }
    const k = 1 - Math.exp(-dt * 2.2);
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, k);
    // Liegt links ein Panel, wird die Kamera seitlich verschoben, damit der Tisch
    // in der Mitte des freien Bereichs steht.
    this.insetCur += (this.inset - this.insetCur) * (1 - Math.exp(-dt * 4));
    if (Math.abs(this.insetCur - this.inset) < 0.5) this.insetCur = this.inset;
    const cam = this.camera;
    cam.aspect = innerWidth / innerHeight;
    cam.updateProjectionMatrix();
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
    if (this.insetCur > 0.5) {
      const dist = this.camPos.distanceTo(this.camLook);
      const wpp = (2 * dist * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / innerHeight;
      const right = _v.set(1, 0, 0).applyQuaternion(cam.quaternion);
      cam.position.addScaledVector(right, -(this.insetCur / 2) * wpp);
    }
  }

  setInset(px) {
    if (px !== this.inset) {
      this.inset = px;
      this.fitKey = '';
    }
  }

  /** Kamera sofort an ihr Ziel setzen (z. B. beim ersten Laden ins laufende Spiel). */
  snapCamera() {
    this.computeFit();
    if (this.mode === 'seat') {
      this.camPos.copy(this.fit.pos);
      this.camLook.copy(this.fit.look);
    }
  }

  // ---------- Frame ----------
  update(t, dt) {
    this.updateCamera(t, dt);
    this.camera.updateMatrixWorld();
    const g = this.g;
    // Wohin die Gäste schauen
    const focus = _v.set(0, TABLE.y, 0);
    let focusChar = null;
    if (g && !this.trick.size && g.turn != null) focusChar = g.turn;
    this.seatChars.forEach((c, i) => {
      if (!c) return;
      const entry = c.seatEntry;
      if (entry) {
        c.root.position.lerp(entry.pos, 1 - Math.exp(-dt * 3));
        c.root.rotation.y += (entry.rotY - c.root.rotation.y) * (1 - Math.exp(-dt * 3));
      }
      if (focusChar != null && focusChar !== i) {
        const fc = this.charAt(focusChar);
        if (fc) fc.labelAnchor.getWorldPosition(c.focus).setY(1.3);
        else c.focus.copy(this.camera.position);
      } else c.focus.copy(focus);
      c.camPos.copy(this.camera.position);
      c.update(t, dt);
    });
    // Leuchtring
    if (this.ring.visible) {
      this.ring.position.lerp(this.ringTarget, 1 - Math.exp(-dt * 8));
      this.ring.material.opacity = 0.55 + Math.sin(t * 4) * 0.25;
      const s = 1 + Math.sin(t * 4) * 0.06;
      this.ring.scale.set(s, s, s);
    }
    if (this.glow.visible) this.glow.material.opacity = 0.75 + Math.sin(t * 6) * 0.25;
    // Stammgäste auf dem Startbildschirm tun ab und zu etwas
    if (this.mode === 'orbit' && t > (this.demoAt ?? 0)) {
      this.demoAt = t + 2.5 + Math.random() * 2.5;
      const cs = this.seatChars.filter(Boolean);
      if (cs.length) cs[Math.floor(Math.random() * cs.length)].react(['win', 'bid', 'shock', 'happy', 'wave', 'trump'][Math.floor(Math.random() * 6)], t);
    }
    // Jubel am Spielende
    if (g?.phase === 'gameOver' && t > this.cheerAt) {
      this.cheerAt = t + 4.2;
      const best = Math.max(...g.seats.map((s) => s.total));
      g.seats.forEach((s, i) => this.charAt(i)?.react(s.total === best ? 'cheer' : 'sad', t, { delay: Math.random() * 0.4 }));
    }
    this.updateHand(dt);
  }

  /** Bildschirmposition über dem Kopf eines Gastes (für Namensschilder). */
  labelPoint(seat) {
    const c = this.charAt(seat);
    if (!c) return null;
    const p = c.labelAnchor.getWorldPosition(new THREE.Vector3()).project(this.camera);
    if (p.z > 1) return null;
    return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight };
  }
}
