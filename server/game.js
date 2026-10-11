// Reine Spiellogik für Wizard – ohne Netzwerk, ohne Timer.
// Hausregel: Bei einer ausgespielten Fehlfarbe darf immer Trumpf gelegt werden,
// auch wenn man die ausgespielte Farbe auf der Hand hat.

export const SUITS = ['red', 'yellow', 'green', 'blue'];
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 6;
export const DECK_SIZE = 60;

export class GameError extends Error {}

export function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (let value = 1; value <= 13; value++) {
      deck.push({ id: `${suit}-${value}`, kind: 'num', suit, value });
    }
  }
  for (let i = 1; i <= 4; i++) {
    deck.push({ id: `Z${i}`, kind: 'Z' });
    deck.push({ id: `N${i}`, kind: 'N' });
  }
  return deck;
}

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Farbe, die bedient werden muss, oder null (Zauberer zuerst / nur Narren / leerer Stich). */
export function ledSuit(trick) {
  for (const { card } of trick) {
    if (card.kind === 'Z') return null;
    if (card.kind === 'num') return card.suit;
  }
  return null;
}

/** Ids der Karten aus `hand`, die in den aktuellen Stich gespielt werden dürfen. */
export function legalCards(hand, trick, trump) {
  const led = ledSuit(trick);
  // Hausregel: Liegt ein Zauberer im Stich (egal an welcher Stelle), ist alles erlaubt
  const wizard = trick.some(({ card }) => card.kind === 'Z');
  if (!led || wizard || !hand.some((c) => c.kind === 'num' && c.suit === led)) {
    return hand.map((c) => c.id);
  }
  return hand
    .filter((c) => c.kind !== 'num' || c.suit === led || (trump && c.suit === trump))
    .map((c) => c.id);
}

/** Index (Position im Stich) der gewinnenden Karte. */
export function trickWinner(trick, trump) {
  const firstWizard = trick.findIndex(({ card }) => card.kind === 'Z');
  if (firstWizard !== -1) return firstWizard;
  const led = ledSuit(trick);
  if (!led) return 0; // nur Narren: der erste Narr gewinnt
  let best = -1;
  let bestScore = -1;
  trick.forEach(({ card }, i) => {
    if (card.kind !== 'num') return;
    let score = -1;
    if (trump && card.suit === trump) score = 100 + card.value;
    else if (card.suit === led) score = card.value;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

export function scoreFor(bid, tricks) {
  return bid === tricks ? 20 + 10 * tricks : -10 * Math.abs(bid - tricks);
}

/** Ansage, die der letzte Ansager nicht machen darf (oder null). */
export function forbiddenLastBid(otherBids, cards) {
  const sum = otherBids.reduce((a, b) => a + b, 0);
  const f = cards - sum;
  return f >= 0 && f <= cards ? f : null;
}

export class Game {
  /**
   * @param {{id: string, name: string}[]} players Sitzreihenfolge
   * @param {{noEvenBids?: boolean}} options
   * @param {() => number} rng
   */
  constructor(players, options = {}, rng = Math.random) {
    if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
      throw new GameError(`Wizard braucht ${MIN_PLAYERS}–${MAX_PLAYERS} Spieler.`);
    }
    this.players = players.map((p) => ({ id: p.id, name: p.name }));
    this.options = { noEvenBids: !!options.noEvenBids };
    this.rng = rng;
    this.maxRounds = DECK_SIZE / this.players.length;
    this.round = 0;
    this.dealer = Math.floor(rng() * this.players.length);
    this.history = []; // pro Runde: { round, bids, tricks, points, trump }
    this.totals = this.players.map(() => 0);
    this.phase = 'init';
    this.startRound();
  }

  get n() {
    return this.players.length;
  }

  seatOf(playerId) {
    const seat = this.players.findIndex((p) => p.id === playerId);
    if (seat === -1) throw new GameError('Unbekannter Spieler.');
    return seat;
  }

  startRound() {
    this.round += 1;
    if (this.round > 1) this.dealer = (this.dealer + 1) % this.n;
    const deck = shuffle(createDeck(), this.rng);
    const r = this.round;
    this.hands = this.players.map((_, i) => deck.slice(i * r, (i + 1) * r));
    sortHands(this.hands);
    const rest = deck.slice(this.n * r);
    this.trumpCard = rest.length ? rest[0] : null;
    this.trump = this.trumpCard && this.trumpCard.kind === 'num' ? this.trumpCard.suit : null;
    this.bids = this.players.map(() => null);
    this.tricks = this.players.map(() => 0);
    this.trick = [];
    this.completedTrick = null;
    this.lastTrick = null;
    this.leader = (this.dealer + 1) % this.n;
    if (this.trumpCard && this.trumpCard.kind === 'Z') {
      this.phase = 'chooseTrump';
      this.turn = this.dealer;
    } else {
      this.phase = 'bidding';
      this.turn = this.leader;
    }
  }

  assertTurn(seat, phase) {
    if (this.phase !== phase) throw new GameError('Das geht gerade nicht.');
    if (this.turn !== seat) throw new GameError('Du bist nicht am Zug.');
  }

  chooseTrump(playerId, suit) {
    const seat = this.seatOf(playerId);
    this.assertTurn(seat, 'chooseTrump');
    if (!SUITS.includes(suit)) throw new GameError('Ungültige Farbe.');
    this.trump = suit;
    this.phase = 'bidding';
    this.turn = this.leader;
  }

  /** Ansage, die `seat` gerade nicht machen darf (oder null). */
  forbiddenBid(seat) {
    if (!this.options.noEvenBids || this.phase !== 'bidding') return null;
    const others = this.bids.filter((b, i) => i !== seat && b !== null);
    if (others.length !== this.n - 1) return null; // nicht der letzte Ansager
    return forbiddenLastBid(others, this.round);
  }

  bid(playerId, value) {
    const seat = this.seatOf(playerId);
    this.assertTurn(seat, 'bidding');
    if (!Number.isInteger(value) || value < 0 || value > this.round) {
      throw new GameError(`Ansage muss zwischen 0 und ${this.round} liegen.`);
    }
    if (value === this.forbiddenBid(seat)) {
      throw new GameError(`${value} ist nicht erlaubt – die Ansagen dürfen nicht aufgehen.`);
    }
    this.bids[seat] = value;
    if (this.bids.every((b) => b !== null)) {
      this.phase = 'playing';
      this.turn = this.leader;
    } else {
      this.turn = (seat + 1) % this.n;
    }
  }

  legalFor(seat) {
    if (this.phase !== 'playing' || this.turn !== seat || this.completedTrick) return [];
    return legalCards(this.hands[seat], this.trick, this.trump);
  }

  play(playerId, cardId) {
    const seat = this.seatOf(playerId);
    this.assertTurn(seat, 'playing');
    if (this.completedTrick) throw new GameError('Der Stich wird gerade eingesammelt.');
    const hand = this.hands[seat];
    const idx = hand.findIndex((c) => c.id === cardId);
    if (idx === -1) throw new GameError('Diese Karte hast du nicht.');
    if (!legalCards(hand, this.trick, this.trump).includes(cardId)) {
      throw new GameError('Du musst bedienen (oder Trumpf, Zauberer bzw. Narr spielen).');
    }
    const [card] = hand.splice(idx, 1);
    this.trick.push({ seat, card });
    if (this.trick.length === this.n) {
      const winner = this.trick[trickWinner(this.trick, this.trump)].seat;
      this.completedTrick = { cards: this.trick, winner };
      this.turn = null;
    } else {
      this.turn = (seat + 1) % this.n;
    }
  }

  /** Wird nach einer kurzen Anzeigepause aufgerufen, wenn ein Stich voll ist. */
  collectTrick() {
    if (!this.completedTrick) return;
    const { winner } = this.completedTrick;
    this.tricks[winner] += 1;
    this.lastTrick = this.completedTrick;
    this.completedTrick = null;
    this.trick = [];
    if (this.hands.every((h) => h.length === 0)) {
      this.finishRound();
    } else {
      this.leader = winner;
      this.turn = winner;
    }
  }

  finishRound() {
    const points = this.players.map((_, i) => scoreFor(this.bids[i], this.tricks[i]));
    points.forEach((p, i) => (this.totals[i] += p));
    this.history.push({
      round: this.round,
      trump: this.trump,
      bids: this.bids.slice(),
      tricks: this.tricks.slice(),
      points,
      totals: this.totals.slice(),
    });
    this.turn = null;
    this.phase = this.round >= this.maxRounds ? 'gameOver' : 'roundEnd';
  }

  nextRound() {
    if (this.phase !== 'roundEnd') throw new GameError('Die Runde ist noch nicht vorbei.');
    this.startRound();
  }

  /** Spielzustand aus Sicht eines Spielers – fremde Hände sind verborgen. */
  viewFor(playerId) {
    const seat = this.players.findIndex((p) => p.id === playerId);
    return {
      phase: this.phase,
      round: this.round,
      maxRounds: this.maxRounds,
      options: this.options,
      dealer: this.dealer,
      turn: this.turn,
      mySeat: seat,
      trumpCard: this.trumpCard,
      trump: this.trump,
      seats: this.players.map((p, i) => ({
        id: p.id,
        name: p.name,
        bid: this.bids[i],
        tricks: this.tricks[i],
        cardCount: this.hands[i].length,
        total: this.totals[i],
      })),
      hand: seat === -1 ? [] : this.hands[seat],
      legal: seat === -1 ? [] : this.legalFor(seat),
      forbiddenBid: seat === -1 ? null : this.forbiddenBid(seat),
      trick: this.completedTrick ? this.completedTrick.cards : this.trick,
      trickWinner: this.completedTrick ? this.completedTrick.winner : null,
      lastTrick: this.lastTrick,
      history: this.history,
    };
  }
}

const SUIT_ORDER = { red: 0, yellow: 1, green: 2, blue: 3 };
function cardSortKey(c) {
  if (c.kind === 'Z') return 1000;
  if (c.kind === 'N') return -1;
  return SUIT_ORDER[c.suit] * 20 + c.value;
}
function sortHands(hands) {
  for (const h of hands) h.sort((a, b) => cardSortKey(a) - cardSortKey(b));
}
