// Spielfiguren der 3D-Kneipe – gemeinsam für den 3D-Client (Auswahl, Aussehen) und den
// 2D-Client (Auswahl in der Lobby). Der Server kennt die Liste nicht, er prüft nur, dass
// niemand eine Figur doppelt hat. Neue eingebaute Figuren: hier eintragen und in
// public/3d/characters.js (ARCHETYPES) bauen. Neue Modell-Figuren: GLB nach public/3d/models/
// und hier mit `model`, `fallback` und `credit` eintragen.

export const FIGURES = [
  { key: 'wizard', name: 'Zauberer', blurb: 'Hat immer einen Trumpf im Ärmel.' },
  { key: 'pirate', name: 'Pirat', blurb: 'Nimmt jeden Stich, den er kriegen kann.' },
  { key: 'goblin', name: 'Goblin', blurb: 'Zählt heimlich die Karten mit.' },
  { key: 'dwarf', name: 'Zwerg', blurb: 'Klein, stur und nie um eine Ansage verlegen.' },
  { key: 'witch', name: 'Hexe', blurb: 'Sieht deine Karten. Behauptet sie.' },
  { key: 'gentleman', name: 'Gentleman', blurb: 'Verliert mit Stil – meistens.' },
  { key: 'cowboy', name: 'Cowboy', blurb: 'Schnellster Kartenspieler im Westen.' },
  { key: 'orc', name: 'Ork', blurb: 'Haut gern auf den Tisch.' },
  // Figuren aus 3D-Modellen (public/3d/models/<model>.glb, CC BY 4.0 – Urheber stehen in `credit`).
  // fallback: eingebaute Figur, die man sieht, bis das Modell geladen ist.
  {
    key: 'netanyahu', name: 'Netanyahu', model: 'netanyahu', fallback: 'gentleman', height: 1.73,
    credit: { author: 'Sebastian.BA', url: 'https://sketchfab.com/3d-models/benjamin-netanyahu-640d41edc88f43bc91a34bddfb382f0c' },
  },
  {
    key: 'kirk', name: 'Charlie Kirk', model: 'kirk', fallback: 'cowboy', height: 1.8,
    credit: { author: '1PlayerChryyzz', url: 'https://sketchfab.com/3d-models/charlie-kirk-freedom-shirt-5221d24464ae48a3b6e1ce24c416d608' },
  },
  {
    key: 'epstein', name: 'Epstein', model: 'epstein', fallback: 'gentleman', height: 1.8,
    credit: { author: 'SigmaGrindsetMog', url: 'https://sketchfab.com/3d-models/jeffrey-epstein-bd6c6bf543184c8da1f457fc7bf0c494' },
  },
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
