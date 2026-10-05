// Spielfiguren der 3D-Kneipe – gemeinsam für den 3D-Client (Auswahl, Aussehen) und den
// 2D-Client (Auswahl in der Lobby). Der Server kennt die Liste nicht, er prüft nur, dass
// niemand eine Figur doppelt hat. Neue Figuren: hier eintragen und in
// public/3d/characters.js (ARCHETYPES) bauen.

export const FIGURES = [
  { key: 'wizard', name: 'Zauberer', blurb: 'Hat immer einen Trumpf im Ärmel.' },
  { key: 'pirate', name: 'Pirat', blurb: 'Nimmt jeden Stich, den er kriegen kann.' },
  { key: 'goblin', name: 'Goblin', blurb: 'Zählt heimlich die Karten mit.' },
  { key: 'dwarf', name: 'Zwerg', blurb: 'Klein, stur und nie um eine Ansage verlegen.' },
  { key: 'witch', name: 'Hexe', blurb: 'Sieht deine Karten. Behauptet sie.' },
  { key: 'gentleman', name: 'Gentleman', blurb: 'Verliert mit Stil – meistens.' },
  { key: 'cowboy', name: 'Cowboy', blurb: 'Schnellster Kartenspieler im Westen.' },
  { key: 'orc', name: 'Ork', blurb: 'Haut gern auf den Tisch.' },
];

export const FIGURE_KEYS = FIGURES.map((f) => f.key);
export const figureByKey = Object.fromEntries(FIGURES.map((f) => [f.key, f]));

/**
 * Figur für jeden Spieler. Gewählte Figuren gehen vor; wer nichts gewählt hat, bekommt
 * aus seiner Id eine „Wunschfigur“, doppelte werden der Reihe nach weitergeschoben.
 * Alle Clients rechnen gleich, also sieht jeder dieselben Figuren.
 * @param {{id: string, character?: string|null}[]} players in Sitzreihenfolge
 * @param {(s: string) => number} hash
 */
export function assignFigures(players, hash) {
  const used = new Set();
  const out = players.map((p) => {
    if (!figureByKey[p.character] || used.has(p.character)) return null;
    used.add(p.character);
    return p.character;
  });
  return out.map((key, i) => {
    if (key) return key;
    let k = hash(players[i].id) % FIGURE_KEYS.length;
    while (used.has(FIGURE_KEYS[k]) && used.size < FIGURE_KEYS.length) k = (k + 1) % FIGURE_KEYS.length;
    used.add(FIGURE_KEYS[k]);
    return FIGURE_KEYS[k];
  });
}
