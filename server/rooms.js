// Räume, Spieler und Nachrichten-Handling. Unabhängig vom Transport:
// jede Verbindung ist ein Objekt mit send(obj).

import { randomBytes } from 'node:crypto';
import { Game, GameError, MAX_PLAYERS, MIN_PLAYERS } from './game.js';

const ROOM_TTL_MS = 30 * 60 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // ohne I und O
const MAX_NAME = 20;
// Nur Darstellung (3D-Client): Blickrichtung und Emotes werden an die anderen weitergereicht,
// ohne den Spielzustand zu berühren.
export const EMOTES = ['wave', 'cheers', 'knock', 'cheer', 'facepalm', 'laugh'];
const LOOK_MIN_MS = 80; // höchstens ~12 Blick-Updates pro Sekunde und Verbindung
const EMOTE_MIN_MS = 1000; // höchstens ein Emote pro Sekunde und Spieler

function makeCode(existing) {
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!existing.has(code)) return code;
  }
}

function cleanName(name) {
  const n = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  if (!n) throw new GameError('Bitte gib einen Namen ein.');
  return n;
}

export class Rooms {
  constructor({ trickDelayMs = 1500 } = {}) {
    this.trickDelayMs = trickDelayMs;
    this.rooms = new Map(); // code -> room
    this.sweeper = setInterval(() => this.sweep(), 60 * 1000);
    this.sweeper.unref();
  }

  close() {
    clearInterval(this.sweeper);
    for (const room of this.rooms.values()) clearTimeout(room.trickTimer);
  }

  /** Verarbeitet eine Nachricht eines Clients. `conn.ctx` merkt sich Raum und Spieler. */
  handle(conn, msg) {
    try {
      if (!msg || typeof msg.type !== 'string') throw new GameError('Ungültige Nachricht.');
      switch (msg.type) {
        case 'create':
          return this.create(conn, msg);
        case 'join':
          return this.join(conn, msg);
      }
      const { room, player } = this.ctx(conn);
      switch (msg.type) {
        case 'leave':
          return this.leave(conn, room, player);
        case 'look':
          return this.relayLook(conn, room, player, msg);
        case 'emote':
          return this.relayEmote(room, player, msg);
        case 'setOption':
          this.setOption(room, player, msg);
          break;
        case 'start':
          this.start(room, player);
          break;
        case 'chooseTrump':
          gameOf(room).chooseTrump(player.id, msg.suit);
          break;
        case 'bid':
          gameOf(room).bid(player.id, msg.value);
          break;
        case 'play':
          gameOf(room).play(player.id, msg.cardId);
          if (room.game.completedTrick) this.scheduleCollect(room);
          break;
        case 'nextRound':
          gameOf(room).nextRound();
          break;
        case 'backToLobby':
          if (player.id !== room.hostId) throw new GameError('Nur der Host kann das.');
          if (room.game && room.game.phase !== 'gameOver') throw new GameError('Das Spiel läuft noch.');
          room.game = null;
          room.players = room.players.filter((p) => p.conns.size > 0);
          break;
        default:
          throw new GameError('Unbekannte Aktion.');
      }
      this.broadcast(room);
    } catch (err) {
      if (!(err instanceof GameError)) console.error(err);
      conn.send({ type: 'error', message: err instanceof GameError ? err.message : 'Interner Fehler.' });
    }
  }

  ctx(conn) {
    const room = conn.ctx && this.rooms.get(conn.ctx.code);
    const player = room?.players.find((p) => p.id === conn.ctx.playerId);
    if (!room || !player) throw new GameError('Du bist in keinem Raum.');
    return { room, player };
  }

  create(conn, { token, name }) {
    if (typeof token !== 'string' || token.length < 8) throw new GameError('Ungültiges Token.');
    const code = makeCode(this.rooms);
    const room = { code, hostId: null, players: [], options: { noEvenBids: false }, game: null, touched: Date.now() };
    this.rooms.set(code, room);
    this.detach(conn);
    const player = this.addPlayer(room, token, cleanName(name));
    room.hostId = player.id;
    this.attach(conn, room, player);
    this.broadcast(room);
  }

  join(conn, { token, name, code }) {
    if (typeof token !== 'string' || token.length < 8) throw new GameError('Ungültiges Token.');
    const room = this.rooms.get(String(code ?? '').toUpperCase().trim());
    if (!room) throw new GameError('Diesen Raum gibt es nicht (mehr).');
    let player = room.players.find((p) => p.token === token);
    if (!player) {
      if (room.game) throw new GameError('Das Spiel läuft schon – neue Spieler können nicht mehr beitreten.');
      if (room.players.length >= MAX_PLAYERS) throw new GameError(`Der Raum ist voll (max. ${MAX_PLAYERS}).`);
      player = this.addPlayer(room, token, cleanName(name));
    } else if (!room.game && name) {
      player.name = cleanName(name); // Umbenennen in der Lobby
    }
    this.detach(conn);
    this.attach(conn, room, player);
    if (!room.players.some((p) => p.id === room.hostId)) room.hostId = player.id;
    this.broadcast(room);
  }

  addPlayer(room, token, name) {
    const player = { id: randomBytes(6).toString('hex'), token, name, conns: new Set() };
    room.players.push(player);
    return player;
  }

  attach(conn, room, player) {
    conn.ctx = { code: room.code, playerId: player.id };
    player.conns.add(conn);
    room.touched = Date.now();
  }

  /** Verbindung vom bisherigen Raum lösen (Disconnect oder Raumwechsel). */
  detach(conn) {
    if (!conn.ctx) return;
    const room = this.rooms.get(conn.ctx.code);
    conn.ctx = null;
    if (!room) return;
    for (const p of room.players) p.conns.delete(conn);
    room.touched = Date.now();
    if (!room.game) {
      // In der Lobby verschwinden getrennte Spieler nach kurzer Zeit (Reload-Puffer)
      setTimeout(() => this.pruneLobby(room), 15 * 1000).unref();
    }
    this.broadcast(room);
  }

  pruneLobby(room) {
    if (room.game || !this.rooms.has(room.code)) return;
    const before = room.players.length;
    room.players = room.players.filter((p) => p.conns.size > 0);
    if (room.players.length === 0) {
      this.rooms.delete(room.code);
      return;
    }
    if (!room.players.some((p) => p.id === room.hostId)) room.hostId = room.players[0].id;
    if (room.players.length !== before) this.broadcast(room);
  }

  leave(conn, room, player) {
    if (room.game && room.game.phase !== 'gameOver') {
      throw new GameError('Während eines Spiels kann man nicht austreten.');
    }
    for (const c of player.conns) {
      c.ctx = null;
      c.send({ type: 'left' });
    }
    room.players = room.players.filter((p) => p !== player);
    if (room.players.length === 0) {
      this.rooms.delete(room.code);
      return;
    }
    if (room.hostId === player.id) room.hostId = room.players[0].id;
    this.broadcast(room);
  }

  setOption(room, player, { key, value }) {
    if (player.id !== room.hostId) throw new GameError('Nur der Host kann Optionen ändern.');
    if (room.game) throw new GameError('Das Spiel läuft schon.');
    if (key !== 'noEvenBids') throw new GameError('Unbekannte Option.');
    room.options[key] = !!value;
  }

  start(room, player) {
    if (player.id !== room.hostId) throw new GameError('Nur der Host kann das Spiel starten.');
    if (room.game && room.game.phase !== 'gameOver') throw new GameError('Das Spiel läuft schon.');
    if (room.players.length < MIN_PLAYERS) throw new GameError(`Es braucht mindestens ${MIN_PLAYERS} Spieler.`);
    room.game = new Game(room.players, room.options);
  }

  scheduleCollect(room) {
    clearTimeout(room.trickTimer);
    room.trickTimer = setTimeout(() => {
      room.game?.collectTrick();
      this.broadcast(room);
    }, this.trickDelayMs);
  }

  /** Blickrichtung (relativ zum eigenen Platz) an die anderen weiterreichen. yaw = null gibt den Blick frei. */
  relayLook(conn, room, player, { yaw, pitch, at }) {
    const t = Date.now();
    if (t - (conn.lookSent ?? 0) < LOOK_MIN_MS) return;
    let look = { yaw: null };
    if (yaw !== null) {
      if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return;
      look = {
        yaw: Math.round(Math.max(-1.6, Math.min(1.6, yaw)) * 1000) / 1000,
        pitch: Math.round(Math.max(-1.2, Math.min(1.2, pitch)) * 1000) / 1000,
        at: room.players.some((p) => p.id === at && p !== player) ? at : null,
      };
    }
    conn.lookSent = t;
    this.relay(room, player, { type: 'look', id: player.id, ...look });
  }

  relayEmote(room, player, { kind }) {
    if (!EMOTES.includes(kind)) throw new GameError('Unbekanntes Emote.');
    const t = Date.now();
    if (t - (player.emoteSent ?? 0) < EMOTE_MIN_MS) return;
    player.emoteSent = t;
    this.relay(room, player, { type: 'emote', id: player.id, kind });
  }

  /** Nachricht an alle anderen Spieler im Raum (nicht an den Absender). */
  relay(room, from, msg) {
    for (const p of room.players) {
      if (p === from) continue;
      for (const c of p.conns) c.send(msg);
    }
  }

  broadcast(room) {
    if (!this.rooms.has(room.code)) return;
    room.touched = Date.now();
    const lobby = {
      code: room.code,
      hostId: room.hostId,
      options: room.options,
      players: room.players.map((p) => ({ id: p.id, name: p.name, online: p.conns.size > 0 })),
    };
    for (const p of room.players) {
      const state = { type: 'state', me: p.id, room: lobby, game: room.game ? room.game.viewFor(p.id) : null };
      for (const c of p.conns) c.send(state);
    }
  }

  sweep() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      const online = room.players.some((p) => p.conns.size > 0);
      if (!online && now - room.touched > ROOM_TTL_MS) {
        clearTimeout(room.trickTimer);
        this.rooms.delete(code);
      }
    }
  }
}

function gameOf(room) {
  if (!room.game) throw new GameError('Das Spiel hat noch nicht begonnen.');
  return room.game;
}
