// Wizard – Browser-Client. Der Server ist die einzige Wahrheit; der Client
// zeigt nur den Zustand an, den er zugeschickt bekommt, und sendet Aktionen.

const SUITS = ['red', 'yellow', 'green', 'blue'];
const SUIT_NAMES = { red: 'Rot', yellow: 'Gelb', green: 'Grün', blue: 'Blau' };
const SUIT_COLORS = { red: 'var(--red)', yellow: 'var(--yellow)', green: 'var(--green)', blue: 'var(--blue)' };
const SVGNS = 'http://www.w3.org/2000/svg';

const $ = (id) => document.getElementById(id);

// ---------- kleine DOM-Hilfen (Texte immer als textContent) ----------
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

// ---------- Speicher (kann in privaten Fenstern fehlen) ----------
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
let state = null; // letzte 'state'-Nachricht
let prevGame = null; // vorheriger Spielzustand (für Sounds & Animationen)
let wantedRoom = new URLSearchParams(location.search).get('room')?.toUpperCase() || store.get('wizard.room');
let reconnectDelay = 500;
let dealtRound = null;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Verbindung ----------
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.addEventListener('open', () => {
    reconnectDelay = 500;
    $('conn-banner').hidden = true;
    const name = store.get('wizard.name');
    if (wantedRoom && name) send({ type: 'join', token, name, code: wantedRoom });
    else render();
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'state') {
      prevGame = state?.game ?? null;
      state = msg;
      wantedRoom = msg.room.code;
      store.set('wizard.room', wantedRoom);
      if (new URLSearchParams(location.search).get('room') !== wantedRoom) {
        history.replaceState(null, '', `?room=${wantedRoom}`);
      }
      render();
      effects(prevGame, state.game);
    } else if (msg.type === 'error') {
      toast(msg.message, true);
      if (!state && /Raum|Spiel läuft schon|voll/.test(msg.message)) leaveLocal(false);
    } else if (msg.type === 'left') {
      leaveLocal(true);
    } else if (msg.type === 'emote') {
      showEmote(msg.id, msg.kind);
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
  else toast('Keine Verbindung zum Server.', true);
}

function leaveLocal(keepCodeInput) {
  state = null;
  prevGame = null;
  wantedRoom = null;
  store.set('wizard.room', null);
  history.replaceState(null, '', location.pathname);
  if (!keepCodeInput) $('code-input').value = '';
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

// ---------- Sound (kleine WebAudio-Töne, keine Dateien) ----------
let audio = null;
let soundOn = store.get('wizard.sound') !== 'off';
function unlockAudio() {
  if (audio || !soundOn) return;
  try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { audio = null; }
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
const SOUNDS = {
  card: () => { tone(220, 0, 0.07, 'triangle', 0.16); tone(140, 0.005, 0.06, 'sine', 0.1); },
  turn: () => { tone(660, 0, 0.16); tone(880, 0.12, 0.22); },
  win: () => { tone(784, 0, 0.14); tone(988, 0.09, 0.14); tone(1319, 0.18, 0.3); },
  fanfare: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.35, 'triangle', 0.14)); },
};
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

// Sounds und Konfetti aus dem Unterschied zwischen altem und neuem Zustand
function effects(prev, g) {
  if (!g) return;
  const me = g.mySeat;
  if (prev && prev.round === g.round) {
    const prevCount = prev.trick.length;
    if (g.trick.length > prevCount || (g.trickWinner != null && prev.trickWinner == null)) play('card');
    if (g.trickWinner === me && prev.trickWinner !== me) setTimeout(() => play('win'), 180);
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
  function frame(now) {
    const t = now - start;
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

// ---------- Rendering ----------
function show(screen) {
  for (const s of ['start', 'lobby', 'game']) $(`screen-${s}`).hidden = s !== screen;
}

// Emotes von Spielern in der 3D-Ansicht als Sprechblase am Platz bzw. in der Lobby-Liste
const EMOTE_TEXT = { wave: '👋 Hallo!', cheers: '🍺 Prost!', knock: '✊ Klopf, klopf!', cheer: '🎉 Jaaa!', laugh: '😂 Hahaha!', facepalm: '🤦 Oh nein …' };
const emotes = new Map(); // Spieler-Id -> { text, until }
function showEmote(id, kind) {
  if (!state || !EMOTE_TEXT[kind]) return;
  emotes.set(id, { text: EMOTE_TEXT[kind], until: Date.now() + 2600 });
  render();
  setTimeout(() => state && render(), 2700);
}
function emoteFor(id) {
  const e = emotes.get(id);
  return e && e.until > Date.now() ? e.text : null;
}

function render() {
  if (!state) {
    show('start');
    if (wantedRoom && !$('code-input').value) $('code-input').value = wantedRoom;
    document.title = 'Wizard';
    return;
  }
  if (!state.game) {
    show('lobby');
    renderLobby();
    document.title = `Wizard · ${state.room.code}`;
    return;
  }
  show('game');
  renderGame();
}

function renderLobby() {
  const { room, me } = state;
  const isHost = room.hostId === me;
  $('lobby-code').textContent = room.code;
  $('invite-link').value = `${location.origin}${location.pathname}?room=${room.code}`;
  $('lobby-count').textContent = `(${room.players.length}/6)`;
  $('lobby-players').replaceChildren(
    ...room.players.map((p) =>
      h('li', {},
        h('span', { class: `dot${p.online ? '' : ' off'}`, title: p.online ? 'online' : 'offline' }),
        h('span', { class: 'name' }, p.name),
        emoteFor(p.id) && h('span', { class: 'lobby-emote' }, emoteFor(p.id)),
        p.id === room.hostId && h('span', { class: 'tag' }, 'Host'),
        p.id === me && h('span', { class: 'tag you' }, 'Du'),
      ),
    ),
  );
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

// Eigene Bilder für Zauberer und Narren (Karten ohne Bild zeigen Stern bzw. Narrenkappe)
const CARD_ART = {
  Z1: 'img/cards/z1.jpg',
  Z2: 'img/cards/z2.jpg',
  Z3: 'img/cards/z3.jpg',
  Z4: 'img/cards/z4.jpg',
  N1: 'img/cards/n1.jpg',
  N2: 'img/cards/n2.jpg',
  N3: 'img/cards/n3.jpg',
  N4: 'img/cards/n4.jpg',
};
for (const src of Object.values(CARD_ART)) new Image().src = src; // vorladen, damit nichts flackert

function cardEl(card, extra = '') {
  if (card.kind === 'Z' || card.kind === 'N') {
    const name = card.kind === 'Z' ? 'Zauberer' : 'Narr';
    const art = CARD_ART[card.id];
    if (art) {
      return h('div', { class: `card ${card.kind} art ${extra}`, 'data-id': card.id, role: 'img', 'aria-label': name, title: name },
        h('div', { class: 'photo', style: `background-image:url('${art}')` }),
        h('span', { class: 'corner' }, card.kind),
        h('span', { class: 'label' }, name.toUpperCase()));
    }
    return h('div', { class: `card ${card.kind} ${extra}`, 'data-id': card.id, role: 'img', 'aria-label': name, title: name },
      h('div', { class: 'frame' }),
      icon(card.kind, 'emblem'),
      h('span', { class: 'corner' }, card.kind),
      h('span', { class: 'corner br' }, card.kind),
      h('span', { class: 'label' }, name.toUpperCase()));
  }
  const name = `${SUIT_NAMES[card.suit]} ${card.value}`;
  return h('div', { class: `card ${card.suit} ${extra}`, 'data-id': card.id, role: 'img', 'aria-label': name, title: name },
    h('div', { class: 'frame' }, icon(card.suit, 'wm')),
    h('span', { class: 'big' }, card.value),
    h('span', { class: 'corner' }, card.value, icon(card.suit)),
    h('span', { class: 'corner br' }, card.value, icon(card.suit)));
}

function suitChip(suit) {
  if (!suit) return h('span', { class: 'suit-chip' }, 'kein Trumpf');
  return h('span', { class: 'suit-chip', style: `color:${SUIT_COLORS[suit]}` },
    icon(suit), h('span', { style: 'color:var(--ink)' }, SUIT_NAMES[suit]));
}

function nameOf(seat) {
  return state.game.seats[seat]?.name ?? '?';
}
function isOnline(playerId) {
  return state.room.players.find((p) => p.id === playerId)?.online ?? false;
}

// Richtung eines Platzes vom Tischmittelpunkt aus (ich sitze unten, im Uhrzeigersinn weiter)
function seatAngle(g, seat) {
  const n = g.seats.length;
  const rel = (seat - g.mySeat + n) % n;
  return ((90 + (rel * 360) / n) * Math.PI) / 180;
}
function hash(str) {
  let x = 0;
  for (const ch of str) x = (x * 31 + ch.charCodeAt(0)) | 0;
  return x;
}
function leaders(g) {
  if (!g.history.length) return new Set();
  const best = Math.max(...g.seats.map((s) => s.total));
  return new Set(g.seats.filter((s) => s.total === best).map((s) => s.id));
}

// Hand sortieren: Narren, Fehlfarben, Trumpf, Zauberer
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
  const n = g.seats.length;
  const crowns = leaders(g);

  document.title = myTurn ? '● Du bist dran – Wizard' : `Wizard · Runde ${g.round}`;
  renderSoundButton();

  // Kopfzeile
  $('g-round').textContent = `Runde ${g.round} / ${g.maxRounds}`;
  const bidSum = g.seats.reduce((a, s) => a + (s.bid ?? 0), 0);
  const allBid = g.seats.every((s) => s.bid != null);
  const arrow = allBid ? ` ${bidSum > g.round ? '↑' : bidSum < g.round ? '↓' : '='}` : '';
  $('g-bidsum').replaceChildren(
    h('span', { class: 'long' }, `Angesagt ${bidSum} von ${g.round}${arrow}`),
    h('span', { class: 'short' }, `Ansagen ${bidSum}/${g.round}${arrow}`));
  $('g-trump').replaceChildren(
    g.trumpCard ? cardEl(g.trumpCard, 'trump-card') : h('span', { class: 'muted small' }, 'letzte Runde'),
    h('span', {}, 'Trumpf: ', g.phase === 'chooseTrump' ? h('span', { class: 'muted' }, 'wird gewählt …') : suitChip(g.trump)),
  );
  $('btn-last').disabled = !g.lastTrick;

  // Plätze rund um den Tisch
  const seats = [];
  for (let rel = 1; rel < n; rel++) {
    const i = (me + rel) % n;
    const a = seatAngle(g, i);
    seats.push(seatEl(g, i, 50 + Math.cos(a) * 46, 50 + Math.sin(a) * 43, crowns));
  }
  $('g-seats').replaceChildren(...seats);

  // Stich: jede Karte liegt in Richtung ihres Spielers und fliegt von dort herein
  const trick = $('g-trick');
  const shown = new Set([...trick.querySelectorAll('.card')].map((el) => el.dataset.id));
  const winA = g.trickWinner != null ? seatAngle(g, g.trickWinner) : null;
  const spreadX = n >= 5 ? 1.1 : 0.8;
  const spreadY = n >= 5 ? 0.95 : 0.65;
  trick.replaceChildren(
    ...g.trick.map(({ seat, card }) => {
      const a = seatAngle(g, seat);
      const cos = Math.cos(a).toFixed(3);
      const sin = Math.sin(a).toFixed(3);
      const rot = (hash(card.id) % 9) * 1.2;
      const cls = [shown.has(card.id) ? '' : 'new', g.trickWinner === seat ? 'win' : '', winA != null && !reduceMotion ? 'collect' : '']
        .filter(Boolean).join(' ');
      const el = cardEl(card, cls);
      el.style.cssText =
        `--tx:calc(var(--card-w) * ${spreadX} * ${cos});--ty:calc(var(--card-w) * ${spreadY} * ${sin});--rot:${rot}deg;` +
        `--fx:calc(var(--card-w) * 3.2 * ${cos});--fy:calc(var(--card-w) * 2.6 * ${sin});` +
        (winA != null ? `--cx:calc(var(--card-w) * 4 * ${Math.cos(winA).toFixed(3)});--cy:calc(var(--card-w) * 3.2 * ${Math.sin(winA).toFixed(3)});` : '');
      return el;
    }),
  );

  // Status
  const status = $('g-status');
  status.className = `status${myTurn ? ' mine' : ''}`;
  status.textContent = statusText(g);

  // Aktionen
  $('g-actions').replaceChildren(...actionEls(g, isHost));

  // Meine Infos
  const mine = g.seats[me];
  const myStat = mine.bid == null ? '' : mine.tricks === mine.bid ? ' hit' : mine.tricks > mine.bid ? ' over' : '';
  $('g-me').replaceChildren(...[
    crowns.has(mine.id) && icon('crown', 'crown'),
    h('span', { class: 'nm' }, mine.name),
    g.dealer === me && h('span', { class: 'badge', title: 'Geber' }, 'Geber'),
    h('span', { class: 'stat-chip' }, 'Ansage ', h('b', {}, mine.bid ?? '–')),
    h('span', { class: `stat-chip${myStat}` }, 'Stiche ', h('b', {}, mine.tricks)),
    h('span', { class: 'stat-chip' }, 'Punkte ', h('b', {}, mine.total)),
  ].filter(Boolean));

  renderHand(g, myTurn);

  if ($('dlg-scores').open) renderScores();
  if ($('dlg-last').open) renderLastTrick();
}

function seatEl(g, i, x, y, crowns) {
  const s = g.seats[i];
  const offline = !isOnline(s.id);
  const statClass = s.bid == null ? '' : s.tricks === s.bid ? ' hit' : s.tricks > s.bid ? ' over' : '';
  const emote = emoteFor(s.id);
  return h('div', { class: `seat${g.turn === i ? ' turn' : ''}${offline ? ' offline' : ''}`, style: `--x:${x.toFixed(1)}%;--y:${y.toFixed(1)}%` },
    emote && h('div', { class: 'seat-bubble' }, emote),
    h('div', { class: 'seat-name' },
      crowns.has(s.id) && icon('crown'),
      h('span', { class: 'nm' }, s.name),
      g.dealer === i && h('span', { class: 'badge', title: 'Geber' }, 'G'),
      offline && h('span', { class: 'badge off' }, 'offline')),
    h('div', { class: 'seat-stats' },
      s.bid == null
        ? h('span', { class: 'stat-chip' }, 'Ansage ', h('b', {}, '–'))
        : h('span', { class: `stat-chip${statClass}`, title: 'Stiche / Ansage' }, 'Stiche ', h('b', {}, `${s.tricks}/${s.bid}`))),
    h('div', { class: 'seat-foot' },
      h('span', { class: 'seat-points' }, h('b', {}, s.total), ' P.'),
      h('div', { class: 'backs', title: `${s.cardCount} Karten` },
        ...Array.from({ length: Math.min(s.cardCount, 10) }, () => h('div', { class: 'back' })))),
  );
}

// Hand als Fächer: überlappend in einer Reihe, bei sehr vielen Karten in zwei Reihen
function renderHand(g, myTurn) {
  const canPlay = g.phase === 'playing' && myTurn && g.legal.length > 0;
  const hand = $('g-hand');
  hand.className = `hand${canPlay ? ' active' : ''}`;
  const deal = dealtRound !== g.round && !reduceMotion;
  dealtRound = g.round;
  const cards = sortHand(g.hand, g.trump).map((card, i) => {
    const legal = g.legal.includes(card.id);
    const isTrump = g.trump && card.kind === 'num' && card.suit === g.trump;
    const el = cardEl(card, `${legal ? 'legal' : 'illegal'}${isTrump ? ' is-trump' : ''}${deal ? ' deal' : ''}`);
    el.style.setProperty('--i', i);
    if (canPlay && legal) {
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      const playCard = () => send({ type: 'play', cardId: card.id });
      el.addEventListener('click', playCard);
      el.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), playCard()));
    } else if (canPlay) {
      el.addEventListener('click', () => toast('Diese Karte darfst du gerade nicht spielen.', true));
    }
    return el;
  });
  hand.replaceChildren();
  layoutHand(hand, cards);
}

function layoutHand(hand, cards) {
  const n = cards.length;
  if (!n) return;
  const probe = cards[0];
  hand.append(h('div', { class: 'hand-row' }, probe));
  const cw = probe.offsetWidth || 60;
  const avail = Math.max(hand.clientWidth - 8, cw);
  hand.replaceChildren();
  const fits = (count) => count * cw + (count - 1) * 6 <= avail;
  let rows = [cards];
  let step = 6;
  if (!fits(n)) {
    const one = (avail - cw) / (n - 1) - cw;
    if (cw + one >= cw * 0.42) {
      step = one;
    } else {
      const m = Math.ceil(n / 2);
      rows = [cards.slice(0, m), cards.slice(m)];
      step = Math.min(6, (avail - cw) / (m - 1) - cw);
    }
  }
  hand.style.setProperty('--overlap', `${step}px`);
  hand.append(...rows.map((r) => h('div', { class: 'hand-row' }, ...r)));
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
      if (g.turn === me) return g.trick.length === 0 ? 'Du spielst aus' : 'Du bist dran';
      return `${nameOf(g.turn)} ist am Zug …`;
    case 'roundEnd':
      return `Runde ${g.round} ist vorbei`;
    case 'gameOver':
      return 'Spiel vorbei!';
  }
  return '';
}

function actionEls(g, isHost) {
  const me = g.mySeat;
  const myTurn = g.turn === me;

  if (g.phase === 'chooseTrump' && myTurn) {
    return [h('div', { class: 'action-box' },
      h('h3', {}, 'Trumpffarbe wählen'),
      h('div', { class: 'suit-buttons' },
        ...SUITS.map((suit) =>
          h('button', { class: 'btn', style: `background:${SUIT_COLORS[suit]}`, onclick: () => send({ type: 'chooseTrump', suit }) },
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
        h('button', { class: 'btn primary', onclick: () => send({ type: 'nextRound' }) }, `Weiter zu Runde ${g.round + 1}`))];
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
            h('button', { class: 'btn primary', onclick: () => send({ type: 'start' }) }, 'Nochmal spielen'))
        : h('div', { class: 'muted small' }, 'Der Host kann eine neue Partie starten.'))];
  }

  return [];
}

function fmtPoints(p) {
  return p > 0 ? `+${p}` : String(p);
}

// ---------- Punkteblock ----------
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
        cardEl(card), h('div', { class: 'who' }, seat === g.mySeat ? 'Du' : nameOf(seat)))),
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
  if (name) send({ type: 'create', token, name });
});
function joinFromInput() {
  const name = requireName();
  const code = $('code-input').value.trim().toUpperCase();
  if (!name) return;
  if (code.length !== 4) return toast('Der Raumcode hat 4 Buchstaben.', true);
  wantedRoom = code;
  send({ type: 'join', token, name, code });
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
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ title: 'Wizard', text: 'Spiel mit mir Wizard!', url: link });
      return;
    }
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
    play('turn');
  }
  renderSoundButton();
});
$('btn-scores').addEventListener('click', openScores);
$('btn-last').addEventListener('click', () => {
  renderLastTrick();
  $('dlg-last').showModal();
});
for (const dlg of document.querySelectorAll('dialog')) {
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
  });
}

// Hand bei Größenänderung neu auffächern
let resizeTimer;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (state?.game) renderHand(state.game, state.game.turn === state.game.mySeat);
  }, 120);
});

render();
connect();
