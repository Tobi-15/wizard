// Wizard – Browser-Client. Der Server ist die einzige Wahrheit; der Client
// zeigt nur den Zustand an, den er zugeschickt bekommt, und sendet Aktionen.

const SUIT_NAMES = { red: 'Rot', yellow: 'Gelb', green: 'Grün', blue: 'Blau' };
const SUIT_COLORS = { red: 'var(--red)', yellow: 'var(--yellow)', green: 'var(--green)', blue: 'var(--blue)' };

const $ = (id) => document.getElementById(id);

// ---------- kleine DOM-Hilfe (setzt Texte immer als textContent) ----------
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
let wantedRoom = new URLSearchParams(location.search).get('room')?.toUpperCase() || store.get('wizard.room');
let reconnectDelay = 500;
let lastTrickShown = null;

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
      state = msg;
      wantedRoom = msg.room.code;
      store.set('wizard.room', wantedRoom);
      if (new URLSearchParams(location.search).get('room') !== wantedRoom) {
        history.replaceState(null, '', `?room=${wantedRoom}`);
      }
      render();
    } else if (msg.type === 'error') {
      toast(msg.message, true);
      // Raum existiert nicht mehr → zurück zum Start
      if (!state && /Raum|Spiel läuft schon|voll/.test(msg.message)) {
        leaveLocal(false);
      }
    } else if (msg.type === 'left') {
      leaveLocal(true);
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

// ---------- Rendering ----------
function show(screen) {
  for (const s of ['start', 'lobby', 'game']) $(`screen-${s}`).hidden = s !== screen;
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
    ? `Es braucht mindestens 3 Spieler – schick den Link an deine Freunde.`
    : isHost
      ? 'Alle da? Dann los!'
      : `Warte, bis ${hostName} das Spiel startet …`;
}

function cardEl(card, extra = '') {
  if (!card) return h('div', { class: 'card' });
  if (card.kind === 'Z') {
    return h('div', { class: `card Z ${extra}`, 'data-id': card.id, title: 'Zauberer' },
      h('span', { class: 'big' }, 'Z'), h('span', { class: 'label' }, 'ZAUBERER'));
  }
  if (card.kind === 'N') {
    return h('div', { class: `card N ${extra}`, 'data-id': card.id, title: 'Narr' },
      h('span', { class: 'big' }, 'N'), h('span', { class: 'label' }, 'NARR'));
  }
  return h('div', { class: `card ${card.suit} ${extra}`, 'data-id': card.id, title: `${SUIT_NAMES[card.suit]} ${card.value}` },
    h('span', { class: 'corner' }, card.value),
    h('span', { class: 'big' }, card.value),
    h('span', { class: 'corner br' }, card.value));
}

function suitChip(suit) {
  if (!suit) return h('span', { class: 'suit-chip' }, 'kein Trumpf');
  return h('span', { class: 'suit-chip' },
    h('span', { class: 'suit-dot', style: `background:${SUIT_COLORS[suit]}` }), SUIT_NAMES[suit]);
}

function nameOf(seat) {
  return state.game.seats[seat]?.name ?? '?';
}

function isOnline(playerId) {
  return state.room.players.find((p) => p.id === playerId)?.online ?? false;
}

function renderGame() {
  const g = state.game;
  const me = g.mySeat;
  const myTurn = g.turn === me && g.turn != null;
  const isHost = state.room.hostId === state.me;
  const n = g.seats.length;

  document.title = myTurn ? '● Du bist dran – Wizard' : `Wizard · Runde ${g.round}`;

  // Kopfzeile
  $('g-round').textContent = `Runde ${g.round} / ${g.maxRounds}`;
  const bidSum = g.seats.reduce((a, s) => a + (s.bid ?? 0), 0);
  const allBid = g.seats.every((s) => s.bid != null);
  $('g-bidsum').textContent = allBid
    ? `Angesagt ${bidSum} von ${g.round} ${bidSum > g.round ? '↑' : bidSum < g.round ? '↓' : '='}`
    : `Angesagt ${bidSum} von ${g.round}`;
  const trumpBox = $('g-trump');
  trumpBox.replaceChildren(
    g.trumpCard ? cardEl(g.trumpCard, 'trump-card') : h('span', { class: 'muted small' }, 'letzte Runde'),
    h('span', {}, 'Trumpf: ', g.phase === 'chooseTrump' ? h('span', { class: 'muted' }, 'wird gewählt …') : suitChip(g.trump)),
  );
  $('btn-last').disabled = !g.lastTrick;

  // Gegner im Uhrzeigersinn ab links von mir
  const order = [];
  for (let i = 1; i < n; i++) order.push((me + i) % n);
  $('g-opponents').replaceChildren(...order.map((i) => seatEl(g, i)));

  // Stich – nur neu gelegte Karten animieren
  const trick = $('g-trick');
  const shown = new Set([...trick.querySelectorAll('.card')].map((el) => el.dataset.id));
  trick.replaceChildren(
    ...g.trick.map(({ seat, card }) =>
      h('div', { class: `trick-slot${g.trickWinner === seat ? ' win' : ''}${shown.has(card.id) ? '' : ' new'}` },
        cardEl(card), h('div', { class: 'who' }, seat === me ? 'Du' : nameOf(seat)))),
  );

  // Status
  const status = $('g-status');
  status.className = 'status';
  status.textContent = statusText(g);
  if (myTurn) status.classList.add('mine');

  // Aktionen
  $('g-actions').replaceChildren(...actionEls(g, isHost));

  // Meine Infos + Hand
  const mine = g.seats[me];
  const meInfo = $('g-me');
  meInfo.className = `me-info${myTurn ? ' turn' : ''}`;
  meInfo.replaceChildren(
    h('span', {}, h('b', {}, mine.name), g.dealer === me ? ' · Geber' : ''),
    h('span', {}, 'Ansage ', h('b', {}, mine.bid ?? '–')),
    h('span', {}, 'Stiche ', h('b', {}, mine.tricks)),
    h('span', {}, 'Punkte ', h('b', {}, mine.total)),
  );

  const canPlay = g.phase === 'playing' && myTurn && g.legal.length > 0;
  const hand = $('g-hand');
  hand.className = `hand${canPlay ? ' active' : ''}`;
  hand.replaceChildren(
    ...g.hand.map((card) => {
      const legal = g.legal.includes(card.id);
      const isTrump = g.trump && card.kind === 'num' && card.suit === g.trump;
      const el = cardEl(card, `${legal ? 'legal' : 'illegal'}${isTrump ? ' is-trump' : ''}`);
      if (canPlay && legal) {
        el.setAttribute('role', 'button');
        el.tabIndex = 0;
        const play = () => send({ type: 'play', cardId: card.id });
        el.addEventListener('click', play);
        el.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && play());
      } else if (canPlay) {
        el.addEventListener('click', () => toast('Diese Karte darfst du gerade nicht spielen.', true));
      }
      return el;
    }),
  );

  // Punkteblock aktuell halten, falls offen
  if ($('dlg-scores').open) renderScores();
  if (g.lastTrick && lastTrickShown !== g.lastTrick && $('dlg-last').open) renderLastTrick();
}

function seatEl(g, i) {
  const s = g.seats[i];
  const offline = !isOnline(s.id);
  const statClass = s.bid == null ? '' : s.tricks === s.bid ? 'hit' : s.tricks > s.bid ? 'over' : '';
  return h('div', { class: `seat${g.turn === i ? ' turn' : ''}${offline ? ' offline' : ''}` },
    h('div', { class: 'seat-name' },
      h('span', {}, s.name),
      g.dealer === i && h('span', { class: 'badge', title: 'Geber' }, 'G'),
      offline && h('span', { class: 'badge off' }, 'offline')),
    h('div', { class: 'seat-stats' },
      h('span', {}, 'Ansage ', h('b', {}, s.bid ?? '–')),
      h('span', { class: statClass }, 'Stiche ', h('b', {}, s.tricks))),
    h('div', { class: 'seat-stats' }, h('span', {}, 'Punkte ', h('b', {}, s.total))),
    h('div', { class: 'backs', title: `${s.cardCount} Karten` },
      ...Array.from({ length: s.cardCount }, () => h('div', { class: 'back' }))),
  );
}

function statusText(g) {
  const me = g.mySeat;
  const who = g.turn != null ? (g.turn === me ? 'Du bist' : `${nameOf(g.turn)} ist`) : '';
  switch (g.phase) {
    case 'chooseTrump':
      return g.turn === me
        ? 'Ein Zauberer wurde aufgedeckt – du bist Geber und wählst Trumpf.'
        : `Ein Zauberer wurde aufgedeckt – ${nameOf(g.turn)} wählt Trumpf …`;
    case 'bidding':
      return g.turn === me ? 'Wie viele Stiche machst du?' : `${nameOf(g.turn)} sagt an …`;
    case 'playing':
      if (g.trickWinner != null) {
        return g.trickWinner === me ? 'Du gewinnst den Stich!' : `${nameOf(g.trickWinner)} gewinnt den Stich.`;
      }
      if (g.turn === me) return g.trick.length === 0 ? 'Du spielst aus.' : 'Du bist dran.';
      return `${who} am Zug …`;
    case 'roundEnd':
      return `Runde ${g.round} ist vorbei.`;
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
        ...Object.keys(SUIT_NAMES).map((suit) =>
          h('button', { class: 'btn', style: `background:${SUIT_COLORS[suit]}`, onclick: () => send({ type: 'chooseTrump', suit }) },
            SUIT_NAMES[suit]))))];
  }

  if (g.phase === 'bidding' && myTurn) {
    const buttons = [];
    for (let v = 0; v <= g.round; v++) {
      const forbidden = v === g.forbiddenBid;
      buttons.push(h('button', {
        class: 'btn',
        disabled: forbidden,
        title: forbidden ? 'Die Ansagen dürfen nicht aufgehen' : null,
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
      h('h3', {}, ranking.filter((r) => r.total === best).map((r) => r.name).join(' & ') + ' gewinnt! 🏆'),
      h('div', { class: 'podium' }, ...ranking.map((r, k) =>
        h('div', { class: `podium-row${r.total === best ? ' first' : ''}` },
          h('span', {}, `${k + 1}. ${r.name}${r.i === me ? ' (du)' : ''}`), h('span', {}, `${r.total} Punkte`)))),
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
  lastTrickShown = g.lastTrick;
  $('last-trick').replaceChildren(
    ...g.lastTrick.cards.map(({ seat, card }) =>
      h('div', { class: `trick-slot${g.lastTrick.winner === seat ? ' win' : ''}` },
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

render();
connect();
