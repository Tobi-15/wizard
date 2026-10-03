// Ende-zu-Ende-Test: startet den Server und lässt N Bots über echte WebSockets
// ein komplettes Spiel mit zufälligen legalen Zügen spielen.
//   node scripts/bots.js [spielerzahl] [--even]   (--even = Ansagen dürfen nicht aufgehen)
// Mit URL=ws://host/ws wird ein laufender Server statt eines eigenen benutzt.

import { WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { scoreFor } from '../server/game.js';

const n = Number(process.argv[2]) || 4;
const noEvenBids = process.argv.includes('--even');
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const server = process.env.URL ? null : await startServer({ port: 0, trickDelayMs: 5 });
const url = process.env.URL ?? `ws://localhost:${server.port}/ws`;

function bot(name) {
  const ws = new WebSocket(url);
  const token = randomBytes(12).toString('hex');
  const b = { name, ws, token, last: null, errors: [] };
  b.send = (obj) => ws.send(JSON.stringify(obj));
  b.ready = new Promise((r) => ws.once('open', r));
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.type === 'error') b.errors.push(msg.message);
    if (msg.type === 'state') {
      b.last = msg;
      b.onState?.(msg);
    }
  });
  return b;
}

const bots = Array.from({ length: n }, (_, i) => bot(`Bot${i + 1}`));
await Promise.all(bots.map((b) => b.ready));

const waitFor = (b, pred) =>
  new Promise((resolve) => {
    if (b.last && pred(b.last)) return resolve(b.last);
    const prev = b.onState;
    b.onState = (s) => {
      prev?.(s);
      if (pred(s)) resolve(s);
    };
  });

// Raum erstellen, beitreten
const host = bots[0];
host.send({ type: 'create', token: host.token, name: host.name });
const { room } = await waitFor(host, (s) => s.room);
for (const b of bots.slice(1)) b.send({ type: 'join', token: b.token, name: b.name, code: room.code });
await waitFor(host, (s) => s.room.players.length === n);
host.send({ type: 'setOption', key: 'noEvenBids', value: noEvenBids });
await waitFor(host, (s) => s.room.options.noEvenBids === noEvenBids);

let checkedRounds = 0;
const done = new Promise((resolve) => {
  for (const b of bots) {
    const prev = b.onState;
    b.onState = (s) => {
      prev?.(s);
      const g = s.game;
      if (!g) return;
      // fremde Hände dürfen nie mitgeschickt werden
      assert.equal(g.hand.length, g.seats[g.mySeat].cardCount);
      if (g.phase === 'gameOver') return b === host && resolve(g);
      if (g.phase === 'roundEnd') {
        if (b === host && checkedRounds < g.round) {
          checkedRounds = g.round;
          checkRound(g);
          b.send({ type: 'nextRound' });
        }
        return;
      }
      if (g.turn !== g.mySeat) return;
      if (g.phase === 'chooseTrump') b.send({ type: 'chooseTrump', suit: pick(['red', 'yellow', 'green', 'blue']) });
      else if (g.phase === 'bidding') {
        const opts = [];
        for (let v = 0; v <= g.round; v++) if (v !== g.forbiddenBid) opts.push(v);
        b.send({ type: 'bid', value: pick(opts) });
      } else if (g.phase === 'playing' && g.legal.length) {
        b.send({ type: 'play', cardId: pick(g.legal) });
      }
    };
  }
});

function checkRound(g) {
  const h = g.history.at(-1);
  assert.equal(h.round, g.round);
  assert.equal(h.tricks.reduce((a, b) => a + b), h.round, 'Stiche ergeben Kartenzahl');
  h.points.forEach((p, i) => assert.equal(p, scoreFor(h.bids[i], h.tricks[i])));
  if (noEvenBids) assert.notEqual(h.bids.reduce((a, b) => a + b), h.round, 'Ansagen gehen nicht auf');
}

host.send({ type: 'start' });
const timeout = setTimeout(() => {
  console.error('Timeout! Fehler:', bots.map((b) => b.errors), 'Letzter Zustand:', JSON.stringify(host.last?.game, null, 1).slice(0, 2000));
  process.exit(1);
}, 30000);
const final = await done;
checkRound(final);
clearTimeout(timeout);

const errors = bots.flatMap((b) => b.errors);
assert.deepEqual(errors, [], 'Bots haben nur legale Züge gemacht');
assert.equal(final.history.length, 60 / n);
console.log(`✔ ${n} Spieler, ${final.history.length} Runden, noEvenBids=${noEvenBids}`);
console.log('  Endstand:', final.seats.map((s) => `${s.name} ${s.total}`).join(', '));

for (const b of bots) b.ws.close();
await server?.close();
