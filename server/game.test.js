import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDeck,
  ledSuit,
  legalCards,
  trickWinner,
  scoreFor,
  forbiddenLastBid,
  Game,
  GameError,
} from './game.js';

const c = (suit, value) => ({ id: `${suit}-${value}`, kind: 'num', suit, value });
const Z = (i = 1) => ({ id: `Z${i}`, kind: 'Z' });
const N = (i = 1) => ({ id: `N${i}`, kind: 'N' });
const trickOf = (...cards) => cards.map((card, seat) => ({ seat, card }));

test('Deck hat 60 eindeutige Karten', () => {
  const deck = createDeck();
  assert.equal(deck.length, 60);
  assert.equal(new Set(deck.map((d) => d.id)).size, 60);
  assert.equal(deck.filter((d) => d.kind === 'Z').length, 4);
  assert.equal(deck.filter((d) => d.kind === 'N').length, 4);
});

test('ledSuit: Narren zuerst, Zauberer zuerst, nur Narren', () => {
  assert.equal(ledSuit([]), null);
  assert.equal(ledSuit(trickOf(c('red', 5))), 'red');
  assert.equal(ledSuit(trickOf(N(), c('green', 3))), 'green');
  assert.equal(ledSuit(trickOf(N(), N(2))), null);
  assert.equal(ledSuit(trickOf(Z(), c('green', 3))), null);
  assert.equal(ledSuit(trickOf(N(), Z(), c('green', 3))), null);
});

test('Hausregel: Trumpf darf trotz vorhandener Fehlfarbe gelegt werden', () => {
  const hand = [c('red', 2), c('blue', 9), c('green', 4), Z(), N()];
  const legal = legalCards(hand, trickOf(c('red', 10)), 'blue');
  assert.deepEqual(legal.sort(), ['N1', 'Z1', 'blue-9', 'red-2'].sort());
  assert.ok(!legal.includes('green-4'), 'andere Fehlfarbe bleibt verboten');
});

test('Bei Trumpf-Ausspiel muss Trumpf bedient werden', () => {
  const hand = [c('red', 2), c('blue', 9), Z(), N()];
  const legal = legalCards(hand, trickOf(c('blue', 1)), 'blue');
  assert.deepEqual(legal.sort(), ['N1', 'Z1', 'blue-9'].sort());
});

test('Ohne Trumpf gilt normale Bedienpflicht', () => {
  const hand = [c('red', 2), c('blue', 9), N()];
  assert.deepEqual(legalCards(hand, trickOf(c('red', 10)), null).sort(), ['N1', 'red-2']);
});

test('Wer die ausgespielte Farbe nicht hat, darf alles legen', () => {
  const hand = [c('yellow', 2), c('blue', 9), c('green', 1)];
  assert.equal(legalCards(hand, trickOf(c('red', 10)), 'blue').length, 3);
});

test('Nach Zauberer oder nur Narren gibt es keine Bedienpflicht', () => {
  const hand = [c('red', 2), c('blue', 9)];
  assert.equal(legalCards(hand, trickOf(Z(), c('red', 10)), 'green').length, 2);
  assert.equal(legalCards(hand, trickOf(N()), 'green').length, 2);
});

test('Nach Narr bestimmt die erste Farbkarte die Bedienpflicht', () => {
  const hand = [c('red', 2), c('blue', 9)];
  assert.deepEqual(legalCards(hand, trickOf(N(), c('red', 10)), 'green'), ['red-2']);
});

test('trickWinner', () => {
  // erster Zauberer gewinnt
  assert.equal(trickWinner(trickOf(c('red', 13), Z(1), Z(2)), 'red'), 1);
  // höchster Trumpf schlägt höchste Farbe
  assert.equal(trickWinner(trickOf(c('red', 13), c('blue', 1), c('blue', 5)), 'blue'), 2);
  // höchste Karte der ausgespielten Farbe, Fehlfarbe zählt nicht
  assert.equal(trickWinner(trickOf(c('red', 3), c('green', 13), c('red', 7)), 'blue'), 2);
  // nur Narren: erster Narr
  assert.equal(trickWinner(trickOf(N(1), N(2), N(3)), 'blue'), 0);
  // Narr zuerst, danach bestimmt die Farbe
  assert.equal(trickWinner(trickOf(N(1), c('green', 2), c('green', 9)), null), 2);
  // ohne Trumpf
  assert.equal(trickWinner(trickOf(c('green', 2), c('red', 13), c('green', 3)), null), 2);
});

test('Wertung', () => {
  assert.equal(scoreFor(0, 0), 20);
  assert.equal(scoreFor(3, 3), 50);
  assert.equal(scoreFor(2, 0), -20);
  assert.equal(scoreFor(1, 4), -30);
});

test('forbiddenLastBid', () => {
  assert.equal(forbiddenLastBid([1, 1], 3), 1);
  assert.equal(forbiddenLastBid([2, 2], 3), null); // Summe ist schon größer
  assert.equal(forbiddenLastBid([0, 0], 1), 1);
});

// deterministischer Zufall für Spiel-Tests
function seeded(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));

test('Rundenanzahl hängt von der Spielerzahl ab', () => {
  assert.equal(new Game(players(3)).maxRounds, 20);
  assert.equal(new Game(players(4)).maxRounds, 15);
  assert.equal(new Game(players(5)).maxRounds, 12);
  assert.equal(new Game(players(6)).maxRounds, 10);
  assert.throws(() => new Game(players(2)), GameError);
  assert.throws(() => new Game(players(7)), GameError);
});

test('Ansage-Sperre trifft nur den letzten Ansager', () => {
  const g = new Game(players(3), { noEvenBids: true }, seeded(1));
  if (g.phase === 'chooseTrump') g.chooseTrump(g.players[g.turn].id, 'red');
  // Runde 1: eine Karte
  const order = [g.turn, (g.turn + 1) % 3, (g.turn + 2) % 3];
  assert.equal(g.forbiddenBid(order[0]), null);
  g.bid(`p${order[0]}`, 0);
  g.bid(`p${order[1]}`, 0);
  assert.equal(g.forbiddenBid(order[2]), 1);
  assert.throws(() => g.bid(`p${order[2]}`, 1), GameError);
  g.bid(`p${order[2]}`, 0);
  assert.equal(g.phase, 'playing');
});

test('Zugreihenfolge und Phase werden geprüft', () => {
  const g = new Game(players(3), {}, seeded(7));
  if (g.phase === 'chooseTrump') g.chooseTrump(g.players[g.turn].id, 'red');
  const notTurn = `p${(g.turn + 1) % 3}`;
  assert.throws(() => g.bid(notTurn, 0), /nicht am Zug/);
  assert.throws(() => g.play(`p${g.turn}`, 'Z1'), GameError);
});

test('Trumpfkarte: Zauberer → Geber wählt, letzte Runde → kein Trumpf', () => {
  for (let s = 1; s < 200; s++) {
    const g = new Game(players(3), {}, seeded(s));
    if (g.trumpCard.kind === 'Z') {
      assert.equal(g.phase, 'chooseTrump');
      assert.equal(g.turn, g.dealer);
      assert.throws(() => g.chooseTrump(`p${g.dealer}`, 'lila'), GameError);
      g.chooseTrump(`p${g.dealer}`, 'green');
      assert.equal(g.trump, 'green');
      assert.equal(g.phase, 'bidding');
      return;
    }
    if (g.trumpCard.kind === 'N') assert.equal(g.trump, null);
  }
  assert.fail('kein Seed mit Zauberer als Trumpfkarte gefunden');
});

test('Komplettes Spiel mit zufälligen legalen Zügen', () => {
  for (const n of [3, 4, 5, 6]) {
    const rng = seeded(n * 101);
    const g = new Game(players(n), { noEvenBids: true }, rng);
    while (g.phase !== 'gameOver') {
      if (g.phase === 'roundEnd') g.nextRound();
      if (g.phase === 'chooseTrump') g.chooseTrump(`p${g.turn}`, 'yellow');
      while (g.phase === 'bidding') {
        const seat = g.turn;
        const options = [];
        for (let b = 0; b <= g.round; b++) if (b !== g.forbiddenBid(seat)) options.push(b);
        g.bid(`p${seat}`, options[Math.floor(rng() * options.length)]);
      }
      if (g.options.noEvenBids) {
        assert.notEqual(g.bids.reduce((a, b) => a + b), g.round);
      }
      while (g.phase === 'playing') {
        if (g.completedTrick) {
          g.collectTrick();
          continue;
        }
        const seat = g.turn;
        const legal = g.legalFor(seat);
        assert.ok(legal.length > 0);
        g.play(`p${seat}`, legal[Math.floor(rng() * legal.length)]);
      }
      const last = g.history.at(-1);
      assert.equal(last.tricks.reduce((a, b) => a + b), last.round);
      last.points.forEach((p, i) => assert.equal(p, scoreFor(last.bids[i], last.tricks[i])));
    }
    assert.equal(g.history.length, g.maxRounds);
    assert.equal(g.round, 60 / n);
    // in der letzten Runde werden alle Karten verteilt → kein Trumpf
    assert.equal(g.history.at(-1).trump, null);
  }
});

test('viewFor verbirgt fremde Hände', () => {
  const g = new Game(players(3), {}, seeded(3));
  g.round = 0;
  for (let i = 0; i < 4; i++) g.startRound(); // Runde 4: mehr Karten pro Hand
  const json = JSON.stringify(g.viewFor('p0'));
  for (const card of [...g.hands[1], ...g.hands[2]]) {
    assert.ok(!json.includes(`"${card.id}"`), `${card.id} darf nicht sichtbar sein`);
  }
  for (const card of g.hands[0]) assert.ok(json.includes(`"${card.id}"`));
  assert.deepEqual(g.viewFor('p0').seats.map((s) => s.cardCount), [4, 4, 4]);
});
