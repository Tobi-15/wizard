import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rooms } from './rooms.js';

function conn() {
  return {
    out: [],
    send(obj) {
      this.out.push(obj);
    },
    last(type) {
      return this.out.filter((m) => m.type === type).at(-1);
    },
  };
}

/** Raum mit drei Spielern; gibt Verbindungen und Spieler-Ids zurück. */
function table(rooms) {
  const [a, b, c] = [conn(), conn(), conn()];
  rooms.handle(a, { type: 'create', token: 'token-a-123', name: 'Anna' });
  const code = a.last('state').room.code;
  rooms.handle(b, { type: 'join', token: 'token-b-123', name: 'Ben', code });
  rooms.handle(c, { type: 'join', token: 'token-c-123', name: 'Cem', code });
  const ids = c.last('state').room.players.map((p) => p.id);
  for (const x of [a, b, c]) x.out.length = 0;
  return { a, b, c, ids };
}

test('Blickrichtung geht an die anderen, nicht zurück an den Absender', () => {
  const rooms = new Rooms();
  const { a, b, c, ids } = table(rooms);
  rooms.handle(a, { type: 'look', yaw: 0.5, pitch: -0.2, at: ids[1] });
  assert.deepEqual(b.last('look'), { type: 'look', id: ids[0], yaw: 0.5, pitch: -0.2, at: ids[1] });
  assert.deepEqual(c.last('look'), b.last('look'));
  assert.equal(a.out.length, 0);
  assert.equal(b.out.filter((m) => m.type === 'state').length, 0, 'kein Spielzustand verschickt');
  rooms.close();
});

test('Blick: Werte werden begrenzt, fremde Ziele verworfen, zu schnelle Updates gedrosselt', () => {
  const rooms = new Rooms();
  const { a, b, c, ids } = table(rooms);
  rooms.handle(a, { type: 'look', yaw: 99, pitch: -99, at: 'gibtsnicht' });
  assert.deepEqual(b.last('look'), { type: 'look', id: ids[0], yaw: 1.6, pitch: -1.2, at: null });
  rooms.handle(a, { type: 'look', yaw: 0.1, pitch: 0, at: null });
  assert.equal(b.out.length, 1, 'zweites Update direkt danach wird verworfen');
  rooms.handle(b, { type: 'look', yaw: 'x', pitch: 0 });
  rooms.handle(b, { type: 'look', yaw: 0.2, pitch: 0, at: ids[1] }); // sich selbst anschauen geht nicht
  assert.equal(c.last('look').at, null);
  assert.ok(!b.out.some((m) => m.type === 'error'), 'ungültige Blicke erzeugen keine Fehlermeldung');
  rooms.close();
});

test('Blick freigeben mit yaw = null', () => {
  const rooms = new Rooms();
  const { a, b, ids } = table(rooms);
  rooms.handle(a, { type: 'look', yaw: null });
  assert.deepEqual(b.last('look'), { type: 'look', id: ids[0], yaw: null });
  rooms.close();
});

test('Emotes: nur bekannte, höchstens eins pro Sekunde', () => {
  const rooms = new Rooms();
  const { a, b, ids } = table(rooms);
  rooms.handle(a, { type: 'emote', kind: 'cheers' });
  assert.deepEqual(b.last('emote'), { type: 'emote', id: ids[0], kind: 'cheers' });
  rooms.handle(a, { type: 'emote', kind: 'wave' });
  assert.equal(b.out.filter((m) => m.type === 'emote').length, 1);
  rooms.handle(a, { type: 'emote', kind: 'hack' });
  assert.equal(a.last('error').message, 'Unbekanntes Emote.');
  rooms.close();
});

test('Ohne Raum gibt es keinen Blick und kein Emote', () => {
  const rooms = new Rooms();
  const x = conn();
  rooms.handle(x, { type: 'emote', kind: 'wave' });
  assert.equal(x.last('error').message, 'Du bist in keinem Raum.');
  rooms.close();
});

test('Figur wählen: eindeutig im Raum, null = automatisch', () => {
  const rooms = new Rooms();
  const { a, b, c, ids } = table(rooms);
  rooms.handle(a, { type: 'setCharacter', character: 'pirate' });
  assert.equal(c.last('state').room.players.find((p) => p.id === ids[0]).character, 'pirate');
  rooms.handle(b, { type: 'setCharacter', character: 'pirate' });
  assert.equal(b.last('error').message, 'Diese Figur hat schon Anna.');
  rooms.handle(a, { type: 'setCharacter', character: null });
  rooms.handle(b, { type: 'setCharacter', character: 'pirate' });
  const players = c.last('state').room.players;
  assert.deepEqual(players.map((p) => p.character), [null, 'pirate', null]);
  rooms.handle(c, { type: 'setCharacter', character: 'Hack<script>' });
  assert.equal(c.last('error').message, 'Unbekannte Figur.');
  rooms.close();
});

test('Figur: beim Beitreten mitgebracht (wenn frei), während des Spiels gesperrt', () => {
  const rooms = new Rooms();
  const a = conn();
  const b = conn();
  const c = conn();
  rooms.handle(a, { type: 'create', token: 'token-a-123', name: 'Anna', character: 'witch' });
  const code = a.last('state').room.code;
  rooms.handle(b, { type: 'join', token: 'token-b-123', name: 'Ben', code, character: 'witch' });
  rooms.handle(c, { type: 'join', token: 'token-c-123', name: 'Cem', code, character: 'orc' });
  assert.deepEqual(c.last('state').room.players.map((p) => p.character), ['witch', null, 'orc']);
  rooms.handle(a, { type: 'start' });
  rooms.handle(b, { type: 'setCharacter', character: 'dwarf' });
  assert.equal(b.last('error').message, 'Die Figur kannst du nur vor dem Spiel wechseln.');
  rooms.close();
});

test('Theke: Bier erst nachbestellen, wenn es fast leer ist', () => {
  const rooms = new Rooms();
  const { a, b, ids } = table(rooms);
  rooms.handle(a, { type: 'order', item: 'beer' });
  const vice = b.last('state').room.players.find((p) => p.id === ids[0]).vice;
  assert.equal(vice.beer.n, 1);
  assert.ok(vice.beer.age >= 0 && vice.beer.age < 1000);
  rooms.handle(a, { type: 'order', item: 'beer' });
  assert.match(a.last('error').message, /Trink erst mal aus/);
  // Bier ist alt (fast leer): nachbestellen geht
  const code = a.last('state').room.code;
  rooms.rooms.get(code).players[0].vice.beerAt -= 60 * 60 * 1000;
  rooms.handle(a, { type: 'order', item: 'beer' });
  assert.equal(b.last('state').room.players[0].vice.beer.n, 2);
  rooms.handle(a, { type: 'order', item: 'schnaps' });
  assert.equal(a.last('error').message, 'Gibt es hier nicht.');
  rooms.close();
});

test('Theke: Zigarette, ausdrücken, Zigarre nur verdient', () => {
  const rooms = new Rooms();
  const { a, c } = table(rooms);
  const room = [...rooms.rooms.values()][0];
  rooms.handle(a, { type: 'order', item: 'cigarette' });
  assert.equal(c.last('state').room.players[0].vice.smoke.kind, 'cigarette');
  rooms.handle(a, { type: 'order', item: 'cigarette' });
  assert.match(a.last('error').message, /rauchst doch schon/);
  rooms.handle(a, { type: 'order', item: 'putout' });
  assert.equal(c.last('state').room.players[0].vice.smoke, null);
  assert.equal(c.last('state').room.players[0].vice.butts, 1);
  rooms.handle(a, { type: 'order', item: 'cigar' });
  assert.match(a.last('error').message, /mindestens 4 Stichen/);

  // Runde mit Ansagen 4/4 (verdient), 3/3 (zu wenig) und 5/4 (falsch)
  rooms.handle(a, { type: 'start' });
  room.game.history.push({ bids: [4, 3, 5], tricks: [4, 3, 4] });
  rooms.awardCigars(room);
  rooms.awardCigars(room); // nicht doppelt
  assert.deepEqual(room.players.map((p) => p.vice.cigars), [1, 0, 0]);
  rooms.handle(a, { type: 'order', item: 'cigar' });
  const v = c.last('state').room.players[0].vice;
  assert.equal(v.smoke.kind, 'cigar');
  assert.equal(v.cigars, 0);
  // abgebrannt: landet als Kippe im Aschenbecher
  room.players[0].vice.smoke.at -= 60 * 60 * 1000;
  rooms.handle(a, { type: 'order', item: 'cigarette' });
  assert.equal(c.last('state').room.players[0].vice.butts, 2);
  rooms.close();
});

test('Theke-Emotes sip und puff werden weitergereicht', () => {
  const rooms = new Rooms();
  const { a, b, ids } = table(rooms);
  rooms.handle(a, { type: 'emote', kind: 'puff' });
  assert.deepEqual(b.last('emote'), { type: 'emote', id: ids[0], kind: 'puff' });
  rooms.close();
});

test('Bots: nur der Host fügt hinzu/entfernt, Bots zählen nicht als Host', () => {
  const rooms = new Rooms();
  const a = conn();
  const b = conn();
  rooms.handle(a, { type: 'create', token: 'token-a-123', name: 'Anna' });
  const code = a.last('state').room.code;
  rooms.handle(b, { type: 'join', token: 'token-b-123', name: 'Ben', code });
  rooms.handle(b, { type: 'addBot' });
  assert.equal(b.last('error').message, 'Nur der Host kann Bots hinzufügen.');
  rooms.handle(a, { type: 'addBot' });
  rooms.handle(a, { type: 'addBot' });
  const players = a.last('state').room.players;
  assert.deepEqual(players.map((p) => p.name), ['Anna', 'Ben', 'Bot Alrik', 'Bot Hedda']);
  assert.ok(players[2].bot && players[2].online);
  rooms.handle(a, { type: 'removeBot', id: players[2].id });
  assert.deepEqual(a.last('state').room.players.map((p) => p.name), ['Anna', 'Ben', 'Bot Hedda']);
  rooms.handle(a, { type: 'removeBot', id: players[1].id });
  assert.equal(a.last('error').message, 'Diesen Bot gibt es nicht.');
  // Host geht: Ben wird Host, nicht der Bot
  rooms.handle(a, { type: 'leave' });
  assert.equal(b.last('state').room.hostId, players[1].id);
  // Letzter Mensch geht: Raum ist weg
  rooms.handle(b, { type: 'leave' });
  assert.equal(rooms.rooms.size, 0);
  rooms.close();
});

test('Allein gegen zwei Bots: ein ganzes Spiel läuft durch', async () => {
  const rooms = new Rooms({ trickDelayMs: 1, botDelayMs: 1 });
  const a = conn();
  let done;
  const finished = new Promise((r) => (done = r));
  const origSend = a.send.bind(a);
  a.send = (msg) => {
    origSend(msg);
    const g = msg.type === 'state' ? msg.game : null;
    if (!g) return;
    if (g.phase === 'gameOver') return done(g);
    // Mensch spielt zufällig, aber regelkonform (asynchron wie über das Netz)
    setImmediate(() => {
      if (g.phase === 'roundEnd') rooms.handle(a, { type: 'nextRound' });
      else if (g.turn !== g.mySeat) return;
      else if (g.phase === 'chooseTrump') rooms.handle(a, { type: 'chooseTrump', suit: 'red' });
      else if (g.phase === 'bidding') rooms.handle(a, { type: 'bid', value: g.forbiddenBid === 0 ? 1 : 0 });
      else if (g.phase === 'playing' && g.legal.length) rooms.handle(a, { type: 'play', cardId: g.legal[0] });
    });
  };
  rooms.handle(a, { type: 'create', token: 'token-a-123', name: 'Anna' });
  rooms.handle(a, { type: 'addBot' });
  rooms.handle(a, { type: 'addBot' });
  rooms.handle(a, { type: 'setOption', key: 'noEvenBids', value: true });
  rooms.handle(a, { type: 'start' });
  const g = await finished;
  assert.equal(g.history.length, 20);
  assert.ok(!a.out.some((m) => m.type === 'error'), a.out.filter((m) => m.type === 'error').map((m) => m.message).join());
  rooms.close();
});

test('Verlassen während der Partie: ein Bot übernimmt; Host kann abbrechen', () => {
  const rooms = new Rooms({ botDelayMs: 60000 });
  const { a, b, c, ids } = table(rooms);
  rooms.handle(a, { type: 'start' });
  rooms.handle(b, { type: 'leave' });
  assert.equal(b.last('left').type, 'left');
  const players = a.last('state').room.players;
  assert.equal(players.length, 3);
  assert.ok(players[1].bot && players[1].online, 'Ben ist jetzt ein Bot');
  // Ben kommt mit altem Token nicht zurück (Spiel läuft, Platz gehört dem Bot)
  rooms.handle(b, { type: 'join', token: 'token-b-123', name: 'Ben', code: players.length && a.last('state').room.code });
  assert.match(b.last('error').message, /Spiel läuft schon/);
  rooms.handle(c, { type: 'abortGame' });
  assert.equal(c.last('error').message, 'Nur der Host kann das Spiel abbrechen.');
  rooms.handle(a, { type: 'abortGame' });
  assert.equal(c.last('state').game, null);
  assert.deepEqual(c.last('state').room.players.map((p) => p.id), ids);
  // alle Menschen gehen: Raum weg
  rooms.handle(a, { type: 'leave' });
  rooms.handle(c, { type: 'leave' });
  assert.equal(rooms.rooms.size, 0);
  rooms.close();
});

test('Allein mit Bots: Verlassen mitten im Spiel löscht den Raum', () => {
  const rooms = new Rooms({ botDelayMs: 60000 });
  const a = conn();
  rooms.handle(a, { type: 'create', token: 'token-a-123', name: 'Anna' });
  rooms.handle(a, { type: 'addBot' });
  rooms.handle(a, { type: 'addBot' });
  rooms.handle(a, { type: 'start' });
  rooms.handle(a, { type: 'leave' });
  assert.equal(a.last('left').type, 'left');
  assert.equal(rooms.rooms.size, 0);
  rooms.close();
});
