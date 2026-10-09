// Einfache Computer-Gegner zum Testen und Allein-Spielen. Reine Funktionen auf dem
// Game-Objekt: was würde der Bot auf Platz `seat` jetzt tun?

import { SUITS, legalCards, trickWinner } from './game.js';

/** Stärke einer Karte im aktuellen Stich (höher = gewinnt eher). */
function strength(card, led, trump) {
  if (card.kind === 'Z') return 1000;
  if (card.kind === 'N') return -1;
  if (trump && card.suit === trump) return 100 + card.value;
  if (card.suit === led) return 50 + card.value;
  return card.value / 100; // Fehlfarbe: gewinnt nie
}

/** Würde `card` den Stich (so wie er jetzt liegt) gewinnen? */
function wouldWin(trick, card, seat, trump) {
  const t = [...trick, { seat, card }];
  return trickWinner(t, trump) === t.length - 1;
}

/** Trumpffarbe wählen: die Farbe, von der der Bot am meisten (und die höchsten) Karten hat. */
export function botTrump(hand) {
  let best = SUITS[0];
  let bestScore = -1;
  for (const s of SUITS) {
    const score = hand.filter((c) => c.kind === 'num' && c.suit === s).reduce((a, c) => a + 10 + c.value, 0);
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

/** Ansage schätzen: Zauberer, hohe Trümpfe und Asse der Fehlfarben zählen. */
export function botBid(hand, trump, round, forbidden) {
  let est = 0;
  for (const c of hand) {
    if (c.kind === 'Z') est += 1;
    else if (c.kind === 'num' && trump && c.suit === trump) est += c.value >= 10 ? 0.9 : c.value >= 6 ? 0.45 : 0.2;
    else if (c.kind === 'num') est += c.value === 13 ? 0.6 : c.value === 12 ? 0.3 : 0;
  }
  let bid = Math.max(0, Math.min(round, Math.round(est)));
  if (bid === forbidden) bid = bid > 0 && (est < bid || bid === round) ? bid - 1 : bid + 1;
  return Math.max(0, Math.min(round, bid));
}

/** Karte wählen: braucht der Bot noch Stiche, gewinnt er möglichst billig, sonst wirft er ab. */
export function botCard(hand, trick, trump, need) {
  const ids = new Set(legalCards(hand, trick, trump));
  const legal = hand.filter((c) => ids.has(c.id));
  const led = trick.find((t) => t.card.kind === 'num')?.card.suit ?? null;
  const seat = -1;
  const by = (f) => legal.slice().sort((a, b) => f(a) - f(b));
  const str = (c) => strength(c, led ?? c.suit, trump);
  if (!trick.length) {
    // Ausspielen: stark, wenn noch Stiche fehlen, sonst schwach
    const sorted = by(str);
    return (need > 0 ? sorted.at(-1) : sorted[0]).id;
  }
  const winners = by(str).filter((c) => wouldWin(trick, c, seat, trump));
  const losers = by(str).filter((c) => !wouldWin(trick, c, seat, trump));
  if (need > 0) return (winners[0] ?? losers[0]).id; // billigster Gewinner, sonst Müll
  return (losers.at(-1) ?? winners[0]).id; // höchste Karte, die nicht gewinnt
}

/** Nächster Zug des Bots auf `seat` als Nachricht (wie vom Client) oder null. */
export function botMove(game, seat) {
  if (game.turn !== seat) return null;
  const hand = game.hands[seat];
  if (game.phase === 'chooseTrump') return { type: 'chooseTrump', suit: botTrump(hand) };
  if (game.phase === 'bidding') return { type: 'bid', value: botBid(hand, game.trump, game.round, game.forbiddenBid(seat)) };
  if (game.phase === 'playing' && !game.completedTrick) {
    return { type: 'play', cardId: botCard(hand, game.trick, game.trump, game.bids[seat] - game.tricks[seat]) };
  }
  return null;
}
