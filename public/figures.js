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
  {
    // eigenes Skelett mit eigenen Namen; der runde Körper hängt an den Hals-/Kopfknochen
    key: 'mike', name: 'Mike Wazowski', model: 'mike', fallback: 'goblin', height: 1.45,
    hide: ['eyeouter'], // Schatten-Schicht ohne Alphakanal, würde das ganze Auge schwarz abdecken
    hands: [0.17, -0.04, 0], // Karten neben statt vor dem großen Auge
    bones: {
      hips: 'root hips', spine: [], neck: ['head neck lower'], head: 'head neck upper',
      upperArmL: 'arm left shoulder 2', foreArmL: 'arm left elbow', handL: 'arm left wrist',
      upperArmR: 'arm right shoulder 2', foreArmR: 'arm right elbow', handR: 'arm right wrist',
      upLegL: 'leg left thigh', legL: 'leg left knee', footL: 'leg left ankle',
      upLegR: 'leg right thigh', legR: 'leg right knee', footR: 'leg right ankle',
    },
    credit: { author: 'Guilherme Navarro', url: 'https://sketchfab.com/3d-models/mike-wazowski-monsters-inc-kh3-4861367425474a119eecde16ae5a1b75' },
  },
  {
    // ohne Skelett und praktisch ohne Beine: wird nur auf den Stuhl gesetzt
    key: 'chungus', name: 'Big Chungus', model: 'chungus', fallback: 'dwarf', height: 1.2, pose: 'blob',
    rig: { hips: 0.22, spine: 0.38, chest: 0.5, neck: 0.62, head: 0.7, shoulderY: 0.58, shoulderX: 0.21, legs: false },
    credit: { author: 'L3gap4', url: 'https://sketchfab.com/3d-models/bugs-bunny-big-chungus-meme-1d10a18d04e2409dbcb77348873489bf' },
  },
  {
    // ohne Skelett, Baumstamm-Körper auf dünnen Beinen
    key: 'tung', name: 'Tung Tung Tung Sahur', model: 'tung', fallback: 'orc', height: 1.5,
    rig: { hips: 0.4, spine: 0.5, chest: 0.62, neck: 0.74, head: 0.82, shoulderY: 0.675, shoulderX: 0.107, upLeg: 0.38, knee: 0.19, ankle: 0.04 },
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
