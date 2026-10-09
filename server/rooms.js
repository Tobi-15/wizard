// Räume, Spieler und Nachrichten-Handling. Unabhängig vom Transport:
// jede Verbindung ist ein Objekt mit send(obj).

import { randomBytes } from 'node:crypto';
import { Game, GameError, MAX_PLAYERS, MIN_PLAYERS } from './game.js';
import { VICE, SMOKE_MS, earnsCigar } from '../public/vices.js';
import { botMove } from './bot.js';

const ROOM_TTL_MS = 30 * 60 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // ohne I und O
const MAX_NAME = 20;
// Nur Darstellung (3D-Client): Blickrichtung und Emotes werden an die anderen weitergereicht,
// ohne den Spielzustand zu berühren.
// sip (Schluck Bier) und puff (Zug an Zigarette/Zigarre) gehören zur Theke.
export const EMOTES = ['wave', 'cheers', 'knock', 'cheer', 'facepalm', 'laugh', 'sip', 'puff'];
const ORDERS = ['beer', 'cigarette', 'cigar', 'putout'];
const LOOK_MIN_MS = 80; // höchstens ~12 Blick-Updates pro Sekunde und Verbindung
const EMOTE_MIN_MS = 1000; // höchstens ein Emote pro Sekunde und Spieler
// Spielfigur für die 3D-Kneipe. Welche Figuren es gibt, wissen nur die Clients
// (public/figures.js); der Server prüft nur das Format und dass niemand doppelt ist.
const CHARACTER_RE = /^[a-z][a-z0-9-]{0,23}$/;
// Computer-Gegner (zum Allein-Testen): der Host kann sie in der Lobby hinzufügen
const BOT_NAMES = ['Bot Alrik', 'Bot Hedda', 'Bot Bruno', 'Bot Zora', 'Bot Knut', 'Bot Frieda'];
const human = (p) => !p.bot;

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
  constructor({ trickDelayMs = 1500, botDelayMs = 1100 } = {}) {
    this.trickDelayMs = trickDelayMs;
    this.botDelayMs = botDelayMs;
    this.rooms = new Map(); // code -> room
    this.sweeper = setInterval(() => this.sweep(), 60 * 1000);
    this.sweeper.unref();
  }

  close() {
    clearInterval(this.sweeper);
    for (const room of this.rooms.values()) {
      clearTimeout(room.trickTimer);
      clearTimeout(room.botTimer);
    }
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
        case 'order':
          this.order(room, player, msg.item);
          break;
        case 'setOption':
          this.setOption(room, player, msg);
          break;
        case 'setCharacter':
          this.setCharacter(room, player, msg.character);
          break;
        case 'addBot':
          this.addBot(room, player);
          break;
        case 'removeBot':
          this.removeBot(room, player, msg.id);
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
        case 'abortGame':
          // Host bricht die laufende Partie ab: alle zurück in die Lobby
          if (player.id !== room.hostId) throw new GameError('Nur der Host kann das Spiel abbrechen.');
          if (!room.game) throw new GameError('Es läuft kein Spiel.');
          clearTimeout(room.trickTimer);
          clearTimeout(room.botTimer);
          room.game = null;
          room.players = room.players.filter((p) => p.bot || p.conns.size > 0);
          break;
        case 'backToLobby':
          if (player.id !== room.hostId) throw new GameError('Nur der Host kann das.');
          if (room.game && room.game.phase !== 'gameOver') throw new GameError('Das Spiel läuft noch.');
          room.game = null;
          room.players = room.players.filter((p) => p.bot || p.conns.size > 0);
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

  create(conn, { token, name, character }) {
    if (typeof token !== 'string' || token.length < 8) throw new GameError('Ungültiges Token.');
    const code = makeCode(this.rooms);
    const room = { code, hostId: null, players: [], options: { noEvenBids: false }, game: null, touched: Date.now() };
    this.rooms.set(code, room);
    this.detach(conn);
    const player = this.addPlayer(room, token, cleanName(name));
    this.wishCharacter(room, player, character);
    room.hostId = player.id;
    this.attach(conn, room, player);
    this.broadcast(room);
  }

  join(conn, { token, name, code, character }) {
    if (typeof token !== 'string' || token.length < 8) throw new GameError('Ungültiges Token.');
    const room = this.rooms.get(String(code ?? '').toUpperCase().trim());
    if (!room) throw new GameError('Diesen Raum gibt es nicht (mehr).');
    let player = room.players.find((p) => p.token === token);
    if (!player) {
      if (room.game) throw new GameError('Das Spiel läuft schon – neue Spieler können nicht mehr beitreten.');
      if (room.players.length >= MAX_PLAYERS) throw new GameError(`Der Raum ist voll (max. ${MAX_PLAYERS}).`);
      player = this.addPlayer(room, token, cleanName(name));
      this.wishCharacter(room, player, character);
    } else if (!room.game && name) {
      player.name = cleanName(name); // Umbenennen in der Lobby
    }
    this.detach(conn);
    this.attach(conn, room, player);
    if (!room.players.some((p) => p.id === room.hostId)) room.hostId = player.id;
    this.broadcast(room);
  }

  /** Host fügt in der Lobby einen Bot hinzu. */
  addBot(room, player) {
    if (player.id !== room.hostId) throw new GameError('Nur der Host kann Bots hinzufügen.');
    if (room.game && room.game.phase !== 'gameOver') throw new GameError('Das Spiel läuft schon.');
    if (room.players.length >= MAX_PLAYERS) throw new GameError(`Der Raum ist voll (max. ${MAX_PLAYERS}).`);
    const taken = new Set(room.players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !taken.has(n)) ?? `Bot ${room.players.length + 1}`;
    const bot = this.addPlayer(room, `bot-${randomBytes(8).toString('hex')}`, name);
    bot.bot = true;
  }

  removeBot(room, player, id) {
    if (player.id !== room.hostId) throw new GameError('Nur der Host kann Bots entfernen.');
    if (room.game && room.game.phase !== 'gameOver') throw new GameError('Das Spiel läuft noch.');
    const bot = room.players.find((p) => p.id === id && p.bot);
    if (!bot) throw new GameError('Diesen Bot gibt es nicht.');
    room.players = room.players.filter((p) => p !== bot);
  }

  addPlayer(room, token, name) {
    const player = {
      id: randomBytes(6).toString('hex'), token, name, character: null, conns: new Set(),
      // Theke: Bier (bestellt um beerAt, insgesamt beers), Rauchwaren, verdiente Zigarren, Kippen im Aschenbecher
      vice: { beerAt: null, beers: 0, smoke: null, cigars: 0, butts: 0 },
    };
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
    room.players = room.players.filter((p) => p.bot || p.conns.size > 0);
    if (!room.players.some(human)) {
      this.rooms.delete(room.code);
      return;
    }
    if (!room.players.some((p) => p.id === room.hostId)) room.hostId = room.players.find(human).id;
    if (room.players.length !== before) this.broadcast(room);
  }

  /**
   * Tisch verlassen. Während einer Partie übernimmt ein Bot den Platz, damit die anderen
   * weiterspielen können; ist kein Mensch mehr da, wird der Raum gelöscht.
   */
  leave(conn, room, player) {
    for (const c of player.conns) {
      c.ctx = null;
      c.send({ type: 'left' });
    }
    player.conns.clear();
    const running = room.game && room.game.phase !== 'gameOver';
    if (running) {
      player.bot = true;
      player.token = `bot-${randomBytes(8).toString('hex')}`; // der alte Browser kommt nicht wieder auf den Platz
    } else {
      room.players = room.players.filter((p) => p !== player);
    }
    if (!room.players.some(human)) {
      clearTimeout(room.botTimer);
      this.rooms.delete(room.code);
      return;
    }
    if (room.hostId === player.id) room.hostId = room.players.find(human).id;
    this.broadcast(room);
  }

  /** Figur wählen (null = automatisch). Geht nicht während einer laufenden Partie. */
  setCharacter(room, player, character) {
    if (room.game && room.game.phase !== 'gameOver') throw new GameError('Die Figur kannst du nur vor dem Spiel wechseln.');
    if (character !== null && (typeof character !== 'string' || !CHARACTER_RE.test(character))) {
      throw new GameError('Unbekannte Figur.');
    }
    const owner = character && room.players.find((p) => p !== player && p.character === character);
    if (owner) throw new GameError(`Diese Figur hat schon ${owner.name}.`);
    player.character = character;
  }

  /** Mitgebrachte Lieblingsfigur beim Betreten übernehmen, wenn sie gültig und frei ist. */
  wishCharacter(room, player, character) {
    try {
      if (character) this.setCharacter(room, player, character);
    } catch {
      // vergeben oder ungültig: dann eben automatisch
    }
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
    room.awarded = 0;
    // Die Bots gönnen sich zum Start manchmal ein Bier oder eine Zigarette
    for (const p of room.players.filter((x) => x.bot)) {
      if (Math.random() < 0.7) this.tryOrder(room, p, 'beer');
      if (Math.random() < 0.35) this.tryOrder(room, p, 'cigarette');
    }
  }

  tryOrder(room, player, item) {
    try {
      this.order(room, player, item);
    } catch {
      // geht gerade nicht (Bier noch voll, raucht schon …)
    }
  }

  /** Ist ein Bot am Zug, zieht er nach kurzer Pause (wie ein Mensch, der überlegt). */
  scheduleBots(room) {
    clearTimeout(room.botTimer);
    const g = room.game;
    if (!g || g.turn == null || g.completedTrick || !['chooseTrump', 'bidding', 'playing'].includes(g.phase)) return;
    const id = g.players[g.turn].id;
    const bot = room.players.find((p) => p.id === id && p.bot);
    if (!bot) return;
    const delay = this.botDelayMs * (0.7 + Math.random() * 0.6);
    room.botTimer = setTimeout(() => {
      if (!this.rooms.has(room.code) || room.game !== g) return;
      const move = botMove(g, g.turn);
      if (!move || g.players[g.turn]?.id !== bot.id) return;
      try {
        if (move.type === 'chooseTrump') g.chooseTrump(bot.id, move.suit);
        else if (move.type === 'bid') g.bid(bot.id, move.value);
        else {
          g.play(bot.id, move.cardId);
          if (g.completedTrick) this.scheduleCollect(room);
        }
      } catch (err) {
        console.error('Bot-Zug fehlgeschlagen', err);
        return;
      }
      this.broadcast(room);
    }, delay);
    room.botTimer.unref?.();
  }

  /**
   * Theke: Bier bestellen (erst wieder, wenn das alte fast leer ist), Zigarette anzünden,
   * Zigarre (nur mit verdienter Zigarre) oder ausdrücken. Ändert nichts am Spiel.
   */
  order(room, player, item) {
    if (!ORDERS.includes(item)) throw new GameError('Gibt es hier nicht.');
    const v = player.vice;
    const t = Date.now();
    settleSmoke(v, t);
    if (item === 'beer') {
      const full = v.beerAt != null && t - v.beerAt < VICE.serveMs + VICE.beerMs * (1 - VICE.refillBelow);
      if (full) throw new GameError('Trink erst mal aus – dein Bier ist noch gut voll.');
      v.beerAt = t;
      v.beers += 1;
    } else if (item === 'putout') {
      if (!v.smoke) throw new GameError('Du rauchst gerade nichts.');
      v.smoke = null;
      v.butts += 1;
    } else {
      if (v.smoke) throw new GameError(v.smoke.kind === 'cigar' ? 'Du hast doch schon eine Zigarre.' : 'Du rauchst doch schon eine.');
      if (item === 'cigar') {
        if (v.cigars < 1) throw new GameError(`Zigarren gibt's nur für eine richtige Ansage von mindestens ${VICE.cigarMinBid} Stichen.`);
        v.cigars -= 1;
      }
      v.smoke = { kind: item, at: t };
    }
  }

  /** Nach jeder fertigen Runde: Zigarre für alle, die mehr als 3 Stiche richtig angesagt haben. */
  awardCigars(room) {
    const hist = room.game?.history ?? [];
    for (let r = room.awarded ?? 0; r < hist.length; r++) {
      room.game.players.forEach((gp, i) => {
        if (!earnsCigar(hist[r].bids[i], hist[r].tricks[i])) return;
        const p = room.players.find((x) => x.id === gp.id);
        if (p) p.vice.cigars += 1;
      });
    }
    room.awarded = hist.length;
  }

  /** Nach einer Runde: Bots zünden verdiente Zigarren an und bestellen nach. */
  botsAfterRound(room) {
    const g = room.game;
    if (!g || (g.phase !== 'roundEnd' && g.phase !== 'gameOver')) return;
    for (const p of room.players.filter((x) => x.bot)) {
      if (p.vice.cigars > 0 && p.vice.smoke?.kind !== 'cigar') {
        if (p.vice.smoke) this.tryOrder(room, p, 'putout');
        this.tryOrder(room, p, 'cigar');
      }
      if (Math.random() < 0.5) this.tryOrder(room, p, 'beer');
      if (Math.random() < 0.15) this.tryOrder(room, p, 'cigarette');
    }
  }

  scheduleCollect(room) {
    clearTimeout(room.trickTimer);
    room.trickTimer = setTimeout(() => {
      room.game?.collectTrick();
      this.awardCigars(room);
      this.botsAfterRound(room);
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
      players: room.players.map((p) => ({
        id: p.id, name: p.name, online: p.bot || p.conns.size > 0, character: p.character, vice: viceView(p.vice), ...(p.bot && { bot: true }),
      })),
    };
    for (const p of room.players) {
      const state = { type: 'state', me: p.id, room: lobby, game: room.game ? room.game.viewFor(p.id) : null };
      for (const c of p.conns) c.send(state);
    }
    this.scheduleBots(room);
  }

  sweep() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      const online = room.players.some((p) => p.conns.size > 0);
      if (!online && now - room.touched > ROOM_TTL_MS) {
        clearTimeout(room.trickTimer);
        clearTimeout(room.botTimer);
        this.rooms.delete(code);
      }
    }
  }
}

/** Abgebrannte Zigarette/Zigarre landet als Kippe im Aschenbecher. */
function settleSmoke(v, t) {
  if (v.smoke && t - v.smoke.at > SMOKE_MS[v.smoke.kind] + VICE.serveMs) {
    v.smoke = null;
    v.butts += 1;
  }
}

/** Theke-Zustand für die Clients: Alter statt Uhrzeit (die Uhren der Clients gehen anders). */
function viceView(v) {
  const t = Date.now();
  settleSmoke(v, t);
  return {
    beer: v.beerAt == null ? null : { age: t - v.beerAt, n: v.beers },
    smoke: v.smoke ? { kind: v.smoke.kind, age: t - v.smoke.at } : null,
    cigars: v.cigars,
    butts: Math.min(v.butts, 30),
  };
}

function gameOf(room) {
  if (!room.game) throw new GameError('Das Spiel hat noch nicht begonnen.');
  return room.game;
}
