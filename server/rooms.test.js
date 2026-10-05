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
