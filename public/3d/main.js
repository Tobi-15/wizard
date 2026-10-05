// Wizard 3D – Kneipen-Client. Gleiches WebSocket-Protokoll und gleiche gespeicherte
// Daten (Token, Name, Raum) wie der 2D-Client unter /, man kann also jederzeit wechseln.
// Der Server ist die einzige Wahrheit; hier wird nur angezeigt und Aktionen gesendet.

import * as THREE from 'three';
import { createWorld } from './scene.js';
import { TableView } from './table.js';
import { SUITS, SUIT_NAMES, SUIT_HEX, cardImage, redrawAll, setAnisotropy } from './cards.js';
import { updateTweens, hashStr } from './util.js';
import { FIGURES, figureByKey, assignFigures } from '../figures.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const $ = (id) => document.getElementById(id);

// ---------- DOM-Hilfen (Texte immer als textContent) ----------
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
function icon(id, cls = '') {
  const svg = document.createElementNS(SVGNS, 'svg');
  if (cls) svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVGNS, 'use');
  use.setAttribute('href', `#i-${id}`);
  svg.append(use);
  return svg;
}

// ---------- Speicher (wie im 2D-Client) ----------
const store = {
  get(k) {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k, v) {
    try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {}
  },
};
function randomToken() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
const token = store.get('wizard.token') || randomToken();
store.set('wizard.token', token);

// ---------- Zustand ----------
let ws = null;
let state = null;
let prevGame = null;
let wantedRoom = new URLSearchParams(location.search).get('room')?.toUpperCase() || store.get('wizard.room');
let reconnectDelay = 500;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Filmkorn: kleines Rauschbild einmal erzeugen
{
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  document.documentElement.style.setProperty('--grain', `url(${c.toDataURL('image/png')})`);
}

// ---------- 3D ----------
let world;
try {
  world = createWorld($('stage'));
} catch (err) {
  console.error(err);
  $('loading-text').textContent = 'Dein Browser kann leider kein 3D (WebGL).';
  $('loading-fallback').hidden = false;
  throw err;
}
setAnisotropy(world.renderer.capabilities.getMaxAnisotropy());
// Wird es zu langsam, fällt zuerst das Filmkorn weg (bevor die Auflösung sinkt)
world.cheapSteps.push(() => $('grain').remove());

const table = new TableView(world, {
  // Wer weniger Bewegung möchte, startet in der ruhigen Übersicht (Kopf folgt dort nicht der Maus)
  view: store.get('wizard.view3d') ?? (reduceMotion ? 'overview' : 'ego'),
  sortHand,
  reduceMotion,
  sound: (name) => play(name),
  bubble: (seat, text) => showBubble(seat, text),
  play: (cardId) => send({ type: 'play', cardId }),
  illegal: () => toast('Diese Karte darfst du gerade nicht spielen.', true),
  suitName: (s) => SUIT_NAMES[s],
});

// ---------- Verbindung ----------
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.addEventListener('open', () => {
    reconnectDelay = 500;
    $('conn-banner').hidden = true;
    const name = store.get('wizard.name');
    if (wantedRoom && name) send({ type: 'join', token, name, code: wantedRoom, character: store.get('wizard.character') });
    else render();
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'state') {
      prevGame = state?.game ?? null;
      const first = !state;
      state = msg;
      wantedRoom = msg.room.code;
      store.set('wizard.room', wantedRoom);
      if (new URLSearchParams(location.search).get('room') !== wantedRoom) {
        history.replaceState(null, '', `?room=${wantedRoom}`);
      }
      table.sync(state);
      if (first) table.snapCamera();
      render();
      effects(prevGame, state.game);
    } else if (msg.type === 'error') {
      toast(msg.message, true);
      table.rejectPending();
      if (!state && /Raum|Spiel läuft schon|voll/.test(msg.message)) leaveLocal(false);
    } else if (msg.type === 'left') {
      leaveLocal(true);
    } else if (msg.type === 'look') {
      table.remoteLook(msg.id, msg);
    } else if (msg.type === 'emote') {
      receiveEmote(msg.id, msg.kind);
    }
  });
  ws.addEventListener('close', () => {
    ws = null;
    if (state) $('conn-banner').hidden = false;
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 5000);
  });
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  else {
    toast('Keine Verbindung zum Server.', true);
    table.rejectPending();
  }
}

function leaveLocal(keepCodeInput) {
  state = null;
  prevGame = null;
  wantedRoom = null;
  store.set('wizard.room', null);
  history.replaceState(null, '', location.pathname);
  if (!keepCodeInput) $('code-input').value = '';
  table.showStart();
  render();
}

// ---------- Toast ----------
let toastTimer;
function toast(text, isError = false) {
  const t = $('toast');
  t.textContent = text;
  t.classList.toggle('err', isError);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

// ---------- Sound (WebAudio-Töne wie im 2D-Client) ----------
let audio = null;
let soundOn = store.get('wizard.sound') !== 'off';
function unlockAudio() {
  if (audio || !soundOn) return;
  try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { audio = null; }
  startAmbience();
}
addEventListener('pointerdown', unlockAudio, { passive: true });
addEventListener('keydown', unlockAudio);
function tone(freq, start, dur, type = 'sine', vol = 0.12) {
  const t0 = audio.currentTime + start;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(audio.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}
// Kurzes gefiltertes Rauschen (Klopfen, Klatschen)
function noise(start, dur, { freq = 800, q = 1, vol = 0.2, type = 'lowpass' } = {}) {
  const len = Math.ceil(audio.sampleRate * dur);
  const buf = audio.createBuffer(1, len, audio.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = audio.createBufferSource();
  src.buffer = buf;
  const f = audio.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = audio.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(audio.destination);
  src.start(audio.currentTime + start);
}
const SOUNDS = {
  // Emotes (Zeitpunkte passend zu den Animationen in characters.js)
  knock: () => { for (const t of [0.35, 0.55, 0.75]) { noise(t, 0.14, { freq: 220, vol: 0.9 }); tone(85, t, 0.14, 'sine', 0.3); } },
  cheers: () => { tone(2637, 0.9, 0.6, 'sine', 0.07); tone(3520, 0.905, 0.45, 'sine', 0.05); tone(1976, 0.9, 0.3, 'triangle', 0.03); },
  facepalm: () => { noise(0.42, 0.09, { freq: 1700, type: 'bandpass', q: 0.8, vol: 0.6 }); },
  laugh: () => { for (let i = 0; i < 5; i++) tone(330 - i * 18, 0.12 + i * 0.15, 0.09, 'triangle', 0.05); },
  cheer: () => { tone(523, 0, 0.12, 'triangle', 0.08); tone(659, 0.1, 0.12, 'triangle', 0.08); tone(784, 0.2, 0.3, 'triangle', 0.09); },
  wave: () => {},
  card: () => { tone(220, 0, 0.07, 'triangle', 0.16); tone(140, 0.005, 0.06, 'sine', 0.1); },
  deal: () => { tone(320 + Math.random() * 60, 0, 0.035, 'triangle', 0.05); },
  turn: () => { tone(660, 0, 0.16); tone(880, 0.12, 0.22); },
  win: () => { tone(784, 0, 0.14); tone(988, 0.09, 0.14); tone(1319, 0.18, 0.3); },
  fanfare: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.35, 'triangle', 0.14)); },
};
// Kneipen-Geräusche: leises Raumrauschen und Kaminknistern (nur bei eingeschaltetem Ton)
let ambience = null;
function startAmbience() {
  if (ambience || !audio || !soundOn) return;
  const len = audio.sampleRate * 4;
  const buf = audio.createBuffer(1, len, audio.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; // braunes Rauschen
    d[i] = last * 3.5;
  }
  const src = audio.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const lp = audio.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 380;
  const g = audio.createGain();
  g.gain.value = 0.03;
  src.connect(lp).connect(g).connect(audio.destination);
  src.start();
  const timer = setInterval(() => {
    if (document.hidden || Math.random() > 0.45) return;
    noise(Math.random() * 0.12, 0.004 + Math.random() * 0.012, { freq: 1500 + Math.random() * 3000, type: 'bandpass', q: 1.2, vol: 0.02 + Math.random() * 0.05 });
  }, 140);
  ambience = { src, timer };
}
function stopAmbience() {
  if (!ambience) return;
  ambience.src.stop();
  clearInterval(ambience.timer);
  ambience = null;
}

function play(name) {
  if (!soundOn || !audio) return;
  if (audio.state === 'suspended') audio.resume();
  try { SOUNDS[name](); } catch {}
}
function renderSoundButton() {
  const b = $('btn-sound');
  b.replaceChildren(icon(soundOn ? 'sound' : 'mute'));
  b.setAttribute('aria-label', soundOn ? 'Ton aus' : 'Ton an');
  b.setAttribute('aria-pressed', String(!soundOn));
}

function effects(prev, g) {
  if (!g) return;
  const me = g.mySeat;
  if (prev && prev.round === g.round) {
    if (g.trickWinner === me && prev.trickWinner !== me) setTimeout(() => play('win'), 500);
  }
  const myTurn = g.turn === me && ['playing', 'bidding', 'chooseTrump'].includes(g.phase);
  const wasMyTurn = prev && prev.turn === me && prev.phase === g.phase && prev.round === g.round;
  if (myTurn && !wasMyTurn) setTimeout(() => play('turn'), 250);
  if (g.phase === 'gameOver' && prev && prev.phase !== 'gameOver') {
    play('fanfare');
    confetti();
  }
}

// ---------- Konfetti ----------
function confetti() {
  if (reduceMotion) return;
  const canvas = $('confetti');
  const ctx = canvas.getContext('2d');
  canvas.hidden = false;
  const dpr = devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const colors = ['#e9c46a', '#d23c3c', '#2b67c9', '#22914a', '#d39b00', '#8f6fe0', '#fffaf0'];
  const parts = Array.from({ length: 180 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * innerWidth * 0.3,
    y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 12,
    vy: -Math.random() * 13 - 4,
    w: 6 + Math.random() * 6,
    h: 8 + Math.random() * 8,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  const start = performance.now();
  function frame(nowMs) {
    const t = nowMs - start;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.32;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t / 4200);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot * 2)));
      ctx.restore();
    }
    if (t < 4200) requestAnimationFrame(frame);
    else canvas.hidden = true;
  }
  requestAnimationFrame(frame);
}

// ---------- Rendering der Overlays ----------
function show(screen) {
  $('screen-start').hidden = screen !== 'start';
  $('screen-lobby').hidden = screen !== 'lobby';
  $('hud').hidden = screen !== 'game';
  document.body.dataset.screen = screen;
  document.body.dataset.view = screen === 'game' ? table.view : '';
  updateInset();
}

function updateInset() {
  const screen = document.body.dataset.screen;
  const panelSide = innerWidth >= 900 && (screen === 'start' || screen === 'lobby');
  table.setInset(panelSide ? Math.min(520, 60 + 440) : 0);
}

function render() {
  for (const id of ['link-2d-start', 'link-2d-lobby', 'link-2d-game']) {
    $(id).href = state ? `../?room=${state.room.code}` : '../';
  }
  if (!state) {
    show('start');
    if (wantedRoom && !$('code-input').value) $('code-input').value = wantedRoom;
    document.title = 'Wizard · Kneipe';
    renderPlates();
    return;
  }
  if (!state.game) {
    show('lobby');
    renderLobby();
    renderPlates();
    document.title = `Wizard · ${state.room.code}`;
    return;
  }
  show('game');
  renderGame();
  renderPlates();
}

function renderLobby() {
  const { room, me } = state;
  const isHost = room.hostId === me;
  $('lobby-code').textContent = room.code;
  $('invite-link').value = `${location.origin}${location.pathname}?room=${room.code}`;
  $('lobby-count').textContent = `(${room.players.length}/6)`;
  const figs = assignFigures(room.players, hashStr);
  $('lobby-players').replaceChildren(
    ...room.players.map((p, i) =>
      h('li', {},
        h('span', { class: `dot${p.online ? '' : ' off'}`, title: p.online ? 'online' : 'offline' }),
        h('span', { class: 'name' }, p.name),
        h('span', { class: 'fig', title: p.character ? 'gewählte Figur' : 'automatisch zugeteilt' }, figureByKey[figs[i]]?.name),
        p.id === room.hostId && h('span', { class: 'tag' }, 'Host'),
        p.id === me && h('span', { class: 'tag you' }, 'Du'),
      ),
    ),
  );
  renderPicker();
  const opt = $('opt-noEvenBids');
  opt.checked = room.options.noEvenBids;
  opt.disabled = !isHost;
  const enough = room.players.length >= 3;
  $('btn-start').hidden = !isHost;
  $('btn-start').disabled = !enough;
  const hostName = room.players.find((p) => p.id === room.hostId)?.name ?? 'Host';
  $('lobby-hint').textContent = !enough
    ? 'Es braucht mindestens 3 Spieler – schick den Link an deine Freunde.'
    : isHost
      ? 'Alle da? Dann los!'
      : `Warte, bis ${hostName} das Spiel startet …`;
}

// ---------- Figurenauswahl ----------
// Die eigene Figur sitzt in der Lobby am Platz und wird von vorn gezeigt. Wer nichts wählt,
// bekommt automatisch eine; von anderen gewählte Figuren sind gesperrt.
function figureState() {
  const { room, me } = state;
  const figs = assignFigures(room.players, hashStr);
  const idx = room.players.findIndex((p) => p.id === me);
  const takenBy = new Map(room.players.filter((p) => p.id !== me && p.character).map((p) => [p.character, p.name]));
  return { figs, current: figs[idx], explicit: room.players[idx]?.character ?? null, takenBy };
}

function renderPicker() {
  const { current, explicit, takenBy } = figureState();
  const f = figureByKey[current];
  $('pick-name').textContent = f?.name ?? '';
  $('pick-blurb').textContent = f?.blurb ?? '';
  $('pick-blurb').hidden = !f?.blurb;
  // Modell-Figuren: Urheber nennen (CC BY 4.0)
  $('pick-credit').hidden = !f?.credit;
  if (f?.credit) {
    $('pick-credit').replaceChildren('3D-Modell: ', h('a', { href: f.credit.url, target: '_blank', rel: 'noopener' }, f.credit.author), ' · CC BY 4.0');
  }
  $('pick-state').textContent = explicit ? 'Mit ‹ › oder den Pfeiltasten wechseln' : 'Automatisch zugeteilt – blättern zum Wählen';
  $('pick-dots').replaceChildren(
    ...FIGURES.map((fig) => {
      const owner = takenBy.get(fig.key);
      return h('button', {
        class: `pick-dot${fig.key === current ? ' mine' : ''}${owner ? ' taken' : ''}`,
        title: owner ? `${fig.name} – hat ${owner}` : fig.name,
        'aria-label': owner ? `${fig.name}, vergeben an ${owner}` : fig.name,
        'aria-pressed': String(fig.key === current),
        disabled: !!owner,
        onclick: () => chooseFigure(fig.key),
      });
    }),
  );
}

function chooseFigure(key) {
  if (!state || state.game) return;
  store.set('wizard.character', key);
  send({ type: 'setCharacter', character: key });
}

/** Zur nächsten freien Figur blättern (dir = ±1). */
function stepFigure(dir) {
  if (!state || state.game) return;
  const { current, takenBy } = figureState();
  let i = FIGURES.findIndex((f) => f.key === current);
  for (let k = 0; k < FIGURES.length; k++) {
    i = (i + dir + FIGURES.length) % FIGURES.length;
    if (!takenBy.has(FIGURES[i].key)) return chooseFigure(FIGURES[i].key);
  }
}

function suitChip(suit) {
  if (!suit) return h('span', { class: 'suit-chip' }, 'kein Trumpf');
  return h('span', { class: 'suit-chip', style: `color:${SUIT_HEX[suit]}` }, icon(suit), h('span', { class: 'ink' }, SUIT_NAMES[suit]));
}

function nameOf(seat) {
  return state.game.seats[seat]?.name ?? '?';
}
function isOnline(playerId) {
  return state.room.players.find((p) => p.id === playerId)?.online ?? false;
}
function leaders(g) {
  if (!g.history.length) return new Set();
  const best = Math.max(...g.seats.map((s) => s.total));
  return new Set(g.seats.filter((s) => s.total === best).map((s) => s.id));
}

// Hand sortieren: Narren, Fehlfarben, Trumpf, Zauberer (wie im 2D-Client)
function sortHand(hand, trump) {
  const order = SUITS.filter((s) => s !== trump).concat(trump ? [trump] : []);
  const key = (c) => (c.kind === 'N' ? -1 : c.kind === 'Z' ? 1000 : order.indexOf(c.suit) * 20 + c.value);
  return hand.slice().sort((a, b) => key(a) - key(b));
}

function renderGame() {
  const g = state.game;
  const me = g.mySeat;
  const myTurn = g.turn === me && g.turn != null;
  const isHost = state.room.hostId === state.me;
  const crowns = leaders(g);

  document.title = myTurn ? '● Du bist dran – Wizard' : `Wizard · Runde ${g.round}`;
  $('hud').dataset.phase = g.phase;
  renderSoundButton();

  $('g-round').textContent = `Runde ${g.round} / ${g.maxRounds}`;
  const bidSum = g.seats.reduce((a, s) => a + (s.bid ?? 0), 0);
  const allBid = g.seats.every((s) => s.bid != null);
  const arrow = allBid ? ` ${bidSum > g.round ? '↑' : bidSum < g.round ? '↓' : '='}` : '';
  $('g-bidsum').textContent = `Angesagt ${bidSum} von ${g.round}${arrow}`;
  $('g-trump').replaceChildren(
    ...[
      g.trumpCard ? cardImage(g.trumpCard, 'trump-card') : null,
      h('span', {}, 'Trumpf: ', g.phase === 'chooseTrump' ? h('span', { class: 'muted' }, 'wird gewählt …') : suitChip(g.trump)),
    ].filter(Boolean),
  );
  $('btn-last').disabled = !g.lastTrick;
  renderViewButton();

  const status = $('g-status');
  status.className = `status${myTurn ? ' mine' : ''}`;
  status.textContent = statusText(g);

  $('g-actions').replaceChildren(...actionEls(g, isHost));

  const mine = g.seats[me];
  const myStat = mine.bid == null ? '' : mine.tricks === mine.bid ? ' hit' : mine.tricks > mine.bid ? ' over' : '';
  $('g-me').replaceChildren(
    ...[
      crowns.has(mine.id) && icon('crown', 'crown'),
      h('span', { class: 'nm' }, mine.name),
      g.dealer === me && h('span', { class: 'badge', title: 'Geber' }, 'Geber'),
      h('span', { class: 'stat-chip' }, 'Ansage ', h('b', {}, mine.bid ?? '–')),
      h('span', { class: `stat-chip${myStat}` }, 'Stiche ', h('b', {}, mine.tricks)),
      h('span', { class: 'stat-chip' }, 'Punkte ', h('b', {}, mine.total)),
    ].filter(Boolean),
  );

  if ($('dlg-scores').open) renderScores();
  if ($('dlg-last').open) renderLastTrick();
}

function renderViewButton() {
  const ego = table.view === 'ego';
  $('btn-view').textContent = ego ? 'Übersicht' : 'Am Tisch';
  $('btn-view').title = ego ? 'Von oben auf den ganzen Tisch schauen (Taste V)' : 'Zurück auf deinen Platz (Taste V)';
}

function toggleView() {
  table.setView(table.view === 'ego' ? 'overview' : 'ego');
  store.set('wizard.view3d', table.view);
  if (document.body.dataset.screen === 'game') document.body.dataset.view = table.view;
  renderViewButton();
}

function statusText(g) {
  const me = g.mySeat;
  switch (g.phase) {
    case 'chooseTrump':
      return g.turn === me ? 'Zauberer aufgedeckt – du wählst Trumpf' : `Zauberer aufgedeckt – ${nameOf(g.turn)} wählt Trumpf`;
    case 'bidding':
      return g.turn === me ? 'Wie viele Stiche machst du?' : `${nameOf(g.turn)} sagt an …`;
    case 'playing':
      if (g.trickWinner != null) return g.trickWinner === me ? 'Du gewinnst den Stich!' : `${nameOf(g.trickWinner)} gewinnt den Stich`;
      if (g.turn === me) return g.trick.length === 0 ? 'Du spielst aus – klick eine Karte' : 'Du bist dran – klick eine Karte';
      return `${nameOf(g.turn)} ist am Zug …`;
    case 'roundEnd':
      return `Runde ${g.round} ist vorbei`;
    case 'gameOver':
      return 'Spiel vorbei!';
  }
  return '';
}

function fmtPoints(p) {
  return p > 0 ? `+${p}` : String(p);
}

function actionEls(g, isHost) {
  const me = g.mySeat;
  const myTurn = g.turn === me;

  if (g.phase === 'chooseTrump' && myTurn) {
    return [h('div', { class: 'action-box' },
      h('h3', {}, 'Trumpffarbe wählen'),
      h('div', { class: 'suit-buttons' },
        ...SUITS.map((suit) =>
          h('button', { class: 'btn', style: `background:${SUIT_HEX[suit]}`, onclick: () => send({ type: 'chooseTrump', suit }) },
            icon(suit), SUIT_NAMES[suit]))))];
  }

  if (g.phase === 'bidding' && myTurn) {
    const buttons = [];
    for (let v = 0; v <= g.round; v++) {
      const forbidden = v === g.forbiddenBid;
      buttons.push(h('button', {
        class: 'btn',
        disabled: forbidden,
        title: forbidden ? 'Die Ansagen dürfen nicht aufgehen' : null,
        'aria-label': forbidden ? `${v} (gesperrt)` : `${v} Stiche ansagen`,
        'data-bid': v,
        onclick: () => send({ type: 'bid', value: v }),
      }, v));
    }
    const sum = g.seats.reduce((a, s) => a + (s.bid ?? 0), 0);
    return [h('div', { class: 'action-box' },
      h('h3', {}, 'Deine Ansage'),
      h('div', { class: 'bid-buttons' }, ...buttons),
      h('div', { class: 'muted small' },
        `Bisher angesagt: ${sum} von ${g.round}`,
        g.forbiddenBid != null ? ` · ${g.forbiddenBid} ist gesperrt` : ''))];
  }

  if (g.phase === 'roundEnd' || g.phase === 'gameOver') {
    const last = g.history.at(-1);
    const table = h('table', { class: 'results' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Spieler'), h('th', {}, 'Ansage'), h('th', {}, 'Stiche'), h('th', {}, 'Punkte'), h('th', {}, 'Gesamt'))),
      h('tbody', {}, ...g.seats.map((s, i) =>
        h('tr', {},
          h('td', {}, i === me ? `${s.name} (du)` : s.name),
          h('td', {}, last.bids[i]),
          h('td', {}, last.tricks[i]),
          h('td', { class: last.points[i] >= 0 ? 'pos' : 'neg' }, fmtPoints(last.points[i])),
          h('td', {}, last.totals[i])))));

    if (g.phase === 'roundEnd') {
      return [h('div', { class: 'action-box' },
        h('h3', {}, `Ergebnis Runde ${g.round}`),
        table,
        h('button', { class: 'btn primary', id: 'btn-next', onclick: () => send({ type: 'nextRound' }) }, `Weiter zu Runde ${g.round + 1}`))];
    }

    const ranking = g.seats.map((s, i) => ({ ...s, i })).sort((a, b) => b.total - a.total);
    const best = ranking[0].total;
    return [h('div', { class: 'action-box' },
      h('h3', {}, ranking.filter((r) => r.total === best).map((r) => r.name).join(' & ') + ' gewinnt!'),
      h('div', { class: 'podium' }, ...ranking.map((r, k) =>
        h('div', { class: `podium-row${r.total === best ? ' first' : ''}` },
          h('span', { class: 'who' }, r.total === best && icon('crown'), `${k + 1}. ${r.name}${r.i === me ? ' (du)' : ''}`),
          h('span', {}, `${r.total} Punkte`)))),
      h('button', { class: 'btn small', onclick: openScores }, 'Ganzen Punkteblock zeigen'),
      isHost
        ? h('div', { class: 'row' },
            h('button', { class: 'btn', onclick: () => send({ type: 'backToLobby' }) }, 'Zur Lobby'),
            h('button', { class: 'btn primary', id: 'btn-again', onclick: () => send({ type: 'start' }) }, 'Nochmal spielen'))
        : h('div', { class: 'muted small' }, 'Der Host kann eine neue Partie starten.'))];
  }

  return [];
}

// ---------- Emotes ----------
const EMOTES = [
  { kind: 'wave', icon: '👋', label: 'Winken', text: '👋 Hallo!' },
  { kind: 'cheers', icon: '🍺', label: 'Prost', text: '🍺 Prost!' },
  { kind: 'knock', icon: '✊', label: 'Klopfen', text: '✊ Klopf, klopf!' },
  { kind: 'cheer', icon: '🎉', label: 'Jubeln', text: '🎉 Jaaa!' },
  { kind: 'laugh', icon: '😂', label: 'Lachen', text: '😂 Hahaha!' },
  { kind: 'facepalm', icon: '🤦', label: 'Facepalm', text: '🤦 Oh nein …' },
];
const emoteByKind = Object.fromEntries(EMOTES.map((e) => [e.kind, e]));
let lastEmote = 0;

function emoteButtons(onPick) {
  return EMOTES.map((e, i) =>
    h('button', { class: 'emote-btn', title: `${e.label} (Taste ${i + 1})`, 'aria-label': e.label, onclick: () => onPick(e.kind) },
      h('span', { class: 'emoji' }, e.icon), h('span', { class: 'lbl' }, e.label), h('kbd', {}, i + 1)));
}
$('emote-menu').replaceChildren(...emoteButtons((kind) => { sendEmote(kind); toggleEmoteMenu(false); }));
$('lobby-emotes').replaceChildren(...emoteButtons(sendEmote));

function toggleEmoteMenu(open = $('emote-menu').hidden) {
  $('emote-menu').hidden = !open;
  $('btn-emote').setAttribute('aria-expanded', String(open));
}

function sendEmote(kind) {
  if (!state || !emoteByKind[kind]) return;
  const t = performance.now();
  if (t - lastEmote < 1000) return;
  lastEmote = t;
  send({ type: 'emote', kind });
  // Mich selbst sehe ich nicht – also Sprechblase, Ton und ein kleiner Effekt aus meiner Sicht
  myBubble(emoteByKind[kind].text);
  play(kind);
  table.selfEmote(kind);
}

function receiveEmote(id, kind) {
  const e = emoteByKind[kind];
  if (!e || !state) return;
  if (!table.remoteEmote(id, kind)) return;
  play(kind);
  const seats = state.game ? state.game.seats : state.room.players;
  const seat = seats.findIndex((p) => p.id === id);
  if (seat >= 0) showBubble(seat, e.text);
}

let myBubbleTimer;
function myBubble(text) {
  const el = $('my-bubble');
  el.textContent = text;
  el.hidden = false;
  el.classList.remove('pop');
  void el.offsetWidth; // Animation neu starten
  el.classList.add('pop');
  clearTimeout(myBubbleTimer);
  myBubbleTimer = setTimeout(() => (el.hidden = true), 2400);
}

// Blick an die anderen schicken (nur in der Ego-Perspektive, gedrosselt)
const gazeSent = { yaw: 0, pitch: 0, at: null, t: 0, active: false };
function sendGaze(nowMs) {
  if (!state || !ws || ws.readyState !== WebSocket.OPEN) return;
  const gz = table.myGaze();
  if (!gz) {
    if (gazeSent.active) {
      gazeSent.active = false;
      send({ type: 'look', yaw: null });
    }
    return;
  }
  const changed = !gazeSent.active || gz.at !== gazeSent.at || Math.abs(gz.yaw - gazeSent.yaw) > 0.035 || Math.abs(gz.pitch - gazeSent.pitch) > 0.035;
  const since = nowMs - gazeSent.t;
  if ((changed && since > 120) || since > 2500) {
    Object.assign(gazeSent, gz, { t: nowMs, active: true });
    send({ type: 'look', yaw: +gz.yaw.toFixed(3), pitch: +gz.pitch.toFixed(3), at: gz.at });
  }
}

// ---------- Namensschilder über den Köpfen ----------
const plates = new Map(); // seat -> element
const bubbles = new Map(); // seat -> { text, until }

function showBubble(seat, text) {
  bubbles.set(seat, { text, until: performance.now() + 2600 });
  renderPlates();
  setTimeout(renderPlates, 2700);
}

function renderPlates() {
  const container = $('labels');
  const seats = [];
  if (state?.game) {
    const g = state.game;
    const crowns = leaders(g);
    g.seats.forEach((s, i) => {
      if (i === g.mySeat) return;
      const offline = !isOnline(s.id);
      const stat = s.bid == null ? '' : s.tricks === s.bid ? ' hit' : s.tricks > s.bid ? ' over' : '';
      seats.push({
        seat: i,
        cls: `plate${g.turn === i ? ' turn' : ''}${offline ? ' offline' : ''}${g.trickWinner === i ? ' winner' : ''}`,
        children: [
          h('div', { class: 'plate-name' },
            crowns.has(s.id) && icon('crown'),
            h('span', { class: 'nm' }, s.name),
            g.dealer === i && h('span', { class: 'badge', title: 'Geber' }, 'G'),
            offline && h('span', { class: 'badge off' }, 'offline')),
          h('div', { class: 'plate-stats' },
            s.bid == null
              ? h('span', { class: 'stat-chip' }, 'Ansage ', h('b', {}, '–'))
              : h('span', { class: `stat-chip${stat}`, title: 'Stiche / Ansage' }, 'Stiche ', h('b', {}, `${s.tricks}/${s.bid}`)),
            h('span', { class: 'stat-chip' }, h('b', {}, s.total), ' P.')),
        ],
      });
    });
  } else if (state) {
    const { room, me } = state;
    room.players.forEach((p, i) => {
      if (p.id === me) return;
      seats.push({
        seat: i,
        cls: `plate${p.online ? '' : ' offline'}`,
        children: [h('div', { class: 'plate-name' }, h('span', { class: 'nm' }, p.name), p.id === room.hostId && h('span', { class: 'badge' }, 'Host'))],
      });
    });
  }
  const t = performance.now();
  const keep = new Set();
  for (const s of seats) {
    keep.add(s.seat);
    let el = plates.get(s.seat);
    if (!el) {
      el = h('div', {});
      plates.set(s.seat, el);
      container.append(el);
    }
    el.className = s.cls;
    const b = bubbles.get(s.seat);
    const bubble = b && b.until > t ? h('div', { class: 'bubble' }, b.text) : null;
    el.replaceChildren(...[bubble, ...s.children].filter(Boolean));
    el._size = null;
  }
  for (const [seat, el] of plates) {
    if (!keep.has(seat)) {
      el.remove();
      plates.delete(seat);
    }
  }
}

function positionPlates() {
  const rects = [];
  for (const [seat, el] of plates) {
    const p = table.labelPoint(seat);
    if (!p) {
      el.style.visibility = 'hidden';
      continue;
    }
    el.style.visibility = '';
    // Sitznachbarn außerhalb des Bildes (Ego-Perspektive): Schild am Rand mit Pfeil
    const edge = p.off < 0 ? 'l' : p.off > 0 ? 'r' : '';
    if (el.dataset.edge !== edge) el.dataset.edge = edge;
    // Größe nur nach Inhaltsänderung messen (sonst Layout in jedem Frame)
    el._size ??= [el.offsetWidth || 120, el.offsetHeight || 50];
    const [w, hgt] = el._size;
    rects.push({
      el,
      w,
      h: hgt,
      x: Math.min(Math.max(p.x, w / 2 + (edge ? 24 : 8)), innerWidth - w / 2 - (edge ? 24 : 8)),
      y: Math.max(p.y, 58 + hgt + 8), // y = Unterkante; nicht unter die Kopfzeile
    });
  }
  // Überlappende Schilder auseinanderschieben: das obere weicht nach oben aus
  for (let iter = 0; iter < 4; iter++) {
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        if (Math.abs(a.x - b.x) >= (a.w + b.w) / 2 + 6) continue;
        const [up, low] = a.y <= b.y ? [a, b] : [b, a];
        const overlap = up.y - (low.y - low.h) + 6;
        if (overlap <= 0) continue;
        const room = up.y - (58 + up.h + 8);
        const moveUp = Math.min(overlap, Math.max(room, 0));
        up.y -= moveUp;
        low.y += overlap - moveUp;
      }
    }
  }
  for (const r of rects) {
    r.el.style.transform = `translate(${r.x.toFixed(1)}px, ${r.y.toFixed(1)}px) translate(-50%, -100%)`;
  }
}

// ---------- Punkteblock & letzter Stich ----------
function renderScores() {
  const g = state?.game;
  if (!g) return;
  const head = h('tr', {}, h('th', {}, 'Runde'), ...g.seats.map((s) => h('th', {}, s.name)));
  const rows = g.history.map((r) =>
    h('tr', {},
      h('td', { class: 'r' }, r.round),
      ...g.seats.map((_, i) =>
        h('td', {},
          h('div', { class: 'pts' }, r.totals[i]),
          h('div', { class: 'bid' }, `${r.bids[i]}/${r.tricks[i]} · ${fmtPoints(r.points[i])}`)))));
  const foot = h('tr', {}, h('td', {}, 'Σ'), ...g.seats.map((s) => h('td', {}, s.total)));
  $('score-table').replaceChildren(
    g.history.length
      ? h('table', { class: 'score' }, h('thead', {}, head), h('tbody', {}, ...rows), h('tfoot', {}, foot))
      : h('p', { class: 'muted' }, 'Noch keine Runde gespielt.'),
    h('p', { class: 'muted small' }, 'Pro Zelle: Gesamtpunkte, darunter Ansage/Stiche · Punkte der Runde.'),
  );
}
function openScores() {
  renderScores();
  $('dlg-scores').showModal();
}
function renderLastTrick() {
  const g = state?.game;
  if (!g?.lastTrick) return;
  $('last-trick').replaceChildren(
    ...g.lastTrick.cards.map(({ seat, card }) =>
      h('div', { class: `slot${g.lastTrick.winner === seat ? ' win' : ''}` },
        cardImage(card), h('div', { class: 'who' }, seat === g.mySeat ? 'Du' : nameOf(seat)))),
  );
}

// ---------- Ereignisse ----------
function requireName() {
  const name = $('name-input').value.trim();
  if (!name) {
    toast('Bitte gib zuerst deinen Namen ein.', true);
    $('name-input').focus();
    return null;
  }
  store.set('wizard.name', name);
  return name;
}

$('name-input').value = store.get('wizard.name') ?? '';
$('btn-create').addEventListener('click', () => {
  const name = requireName();
  if (name) send({ type: 'create', token, name, character: store.get('wizard.character') });
});
function joinFromInput() {
  const name = requireName();
  const code = $('code-input').value.trim().toUpperCase();
  if (!name) return;
  if (code.length !== 4) return toast('Der Raumcode hat 4 Buchstaben.', true);
  wantedRoom = code;
  send({ type: 'join', token, name, code, character: store.get('wizard.character') });
}
$('btn-join').addEventListener('click', joinFromInput);
$('code-input').addEventListener('keydown', (e) => e.key === 'Enter' && joinFromInput());
$('name-input').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if ($('code-input').value.trim().length === 4) joinFromInput();
  else $('btn-create').click();
});
$('btn-copy').addEventListener('click', async () => {
  const link = $('invite-link').value;
  try {
    await navigator.clipboard.writeText(link);
    toast('Link kopiert – schick ihn deinen Freunden.');
  } catch {
    $('invite-link').select();
    toast('Link markiert – jetzt kopieren (Strg+C).');
  }
});
$('btn-leave').addEventListener('click', () => send({ type: 'leave' }));
$('btn-start').addEventListener('click', () => send({ type: 'start' }));
$('opt-noEvenBids').addEventListener('change', (e) => send({ type: 'setOption', key: 'noEvenBids', value: e.target.checked }));
$('btn-sound').addEventListener('click', () => {
  soundOn = !soundOn;
  store.set('wizard.sound', soundOn ? null : 'off');
  if (soundOn) {
    unlockAudio();
    startAmbience();
    play('turn');
  } else stopAmbience();
  renderSoundButton();
});
$('btn-scores').addEventListener('click', openScores);
$('btn-view').addEventListener('click', toggleView);
$('pick-prev').addEventListener('click', () => stepFigure(-1));
$('pick-next').addEventListener('click', () => stepFigure(1));
$('btn-emote').addEventListener('click', () => toggleEmoteMenu());
addEventListener('pointerdown', (e) => {
  if (!$('emote-menu').hidden && !e.target.closest('#emote-menu, #btn-emote')) toggleEmoteMenu(false);
});
$('btn-last').addEventListener('click', () => {
  renderLastTrick();
  $('dlg-last').showModal();
});
for (const dlg of document.querySelectorAll('dialog')) {
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
  });
}

// Maus auf der Szene: eigene Karten per Raycasting
const stage = $('stage');
const ndc = new THREE.Vector2();
function toNdc(e) {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  return ndc;
}
let pressedCard = null;
stage.addEventListener('pointermove', (e) => {
  const id = table.pointerMove(toNdc(e));
  stage.style.cursor = id && table.canPlay() && state?.game?.legal.includes(id) ? 'pointer' : '';
});
stage.addEventListener('pointerdown', (e) => {
  pressedCard = table.pick(toNdc(e));
});
stage.addEventListener('pointerup', (e) => {
  const id = table.pick(toNdc(e));
  if (id && id === pressedCard) table.click(ndc);
  pressedCard = null;
});
stage.addEventListener('pointerleave', () => {
  table.hovered = null;
});
// Ego-Perspektive: der Kopf folgt der Maus (auch über den HUD-Elementen)
addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch' || document.querySelector('dialog[open]')) return;
  table.setPointer((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
}, { passive: true });
document.documentElement.addEventListener('mouseleave', () => table.setPointer(0, 0));
addEventListener('blur', () => table.setPointer(0, 0));

// Tastatur: ←/→ wählt eine Karte, Enter spielt sie, V wechselt die Ansicht, 1–6 Emotes
addEventListener('keydown', (e) => {
  if (!state || document.querySelector('dialog[open]') || e.target.closest?.('input')) return;
  if (e.key >= '1' && e.key <= '6' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    sendEmote(EMOTES[Number(e.key) - 1].kind);
    return;
  }
  if (e.key === 'Escape') toggleEmoteMenu(false);
  const g = state.game;
  if (!g) {
    // Lobby: ←/→ blättert durch die Figuren
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.target.closest?.('button')) {
      stepFigure(e.key === 'ArrowLeft' ? -1 : 1);
      e.preventDefault();
    }
    return;
  }
  if ((e.key === 'v' || e.key === 'V') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    toggleView();
    return;
  }
  if (e.target.closest?.('button')) return;
  const ids = sortHand(g.hand, g.trump).map((c) => c.id);
  if (!ids.length) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const i = ids.indexOf(table.hovered);
    const d = e.key === 'ArrowLeft' ? -1 : 1;
    table.hovered = ids[i < 0 ? 0 : (i + d + ids.length) % ids.length];
    e.preventDefault();
  } else if ((e.key === 'Enter' || e.key === ' ') && table.hovered && table.canPlay()) {
    if (!g.legal.includes(table.hovered)) toast('Diese Karte darfst du gerade nicht spielen.', true);
    else {
      table.pending = table.hovered;
      send({ type: 'play', cardId: table.hovered });
    }
    e.preventDefault();
  }
});

function updateHandVar() {
  const ch = Math.max(120, Math.min(innerHeight * 0.22, 240));
  document.documentElement.style.setProperty('--hand-top', `${Math.round(ch * 1.1)}px`);
}
updateHandVar();
addEventListener('resize', () => {
  updateInset();
  updateHandVar();
  table.layoutHand();
});

// ---------- Renderloop ----------
let lastT = 0;
let frames = 0;
const timeScale = Number(new URLSearchParams(location.search).get('slow')) || 1; // ?slow=0.25 für Tests: Zeitlupe
function frame(ms) {
  const t = (ms / 1000) * timeScale;
  const dt = Math.min(0.1, lastT ? t - lastT : 0.016);
  lastT = t;
  updateTweens(t);
  world.animateEnv(t);
  table.update(t, dt);
  sendGaze(ms);
  positionPlates();
  world.renderer.render(world.scene, world.camera);
  world.adaptQuality(t);
  frames += 1;
  if (frames === 2) {
    $('loading').classList.add('gone');
    window.__wizard3dReady = true;
  }
  requestAnimationFrame(frame);
}

// Schrift laden, damit die Karten in Cinzel gezeichnet werden
Promise.race([
  Promise.all([document.fonts.load('700 64px Cinzel'), document.fonts.load('700 16px "Nunito Sans"')]),
  new Promise((r) => setTimeout(r, 2500)),
]).then(() => redrawAll());
document.fonts.addEventListener?.('loadingdone', () => redrawAll());

// Für Tests und Fehlersuche im Browser
window.wizard3d = {
  table,
  world,
  state: () => state,
  handPoints: () => table.handScreenPoints(),
  headPoint: (id) => table.headScreenPoint(id),
};

table.showStart();
render();
connect();
requestAnimationFrame(frame);
