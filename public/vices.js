// Theke: Bier, Zigarette und Zigarre – gemeinsame Regeln für Server und 3D-Client.
// Der Server führt pro Spieler Bestellung und Zeitpunkt, die Clients zeigen es an
// (Füllstand, Glut, Rauch). Nur Darstellung, der Spielstand bleibt davon unberührt.

export const VICE = {
  beerSips: 8, // so viele Schlucke hat ein Bier (leer wird es nur durchs Trinken)
  refillBelow: 0.25, // nachbestellen erst, wenn höchstens noch ein Viertel drin ist
  cigaretteMs: 3 * 60 * 1000,
  cigarMs: 7 * 60 * 1000,
  serveMs: 12 * 1000, // Puffer für den Weg des Wirts (Bier und Zigarre bringt er an den Platz)
  cigarMinBid: 4, // Zigarre gibt es für eine richtige Ansage von mehr als 3 Stichen
};

export const SMOKE_MS = { cigarette: VICE.cigaretteMs, cigar: VICE.cigarMs };

/** Verdient diese Runde eine Zigarre? Richtig angesagt und mehr als 3 Stiche. */
export function earnsCigar(bid, tricks) {
  return bid === tricks && bid >= VICE.cigarMinBid;
}

/** Füllstand 1 … 0 eines Biers nach `sips` Schlucken (Prost zählt auch als Schluck). */
export function beerLevel(sips) {
  return Math.max(0, Math.min(1, 1 - sips / VICE.beerSips));
}
