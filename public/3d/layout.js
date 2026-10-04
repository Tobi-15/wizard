// Geometrie des Tisches: ovaler Tisch im Ursprung, ich sitze bei +z (vorne, Kamera),
// die anderen im Uhrzeigersinn: der nächste Spieler sitzt links von mir (wie im 2D-Client).

import * as THREE from 'three';

export const TABLE = { rx: 1.42, rz: 1.02, y: 0.78 };
const SEAT_OUT = 0.5; // Abstand Tischkante → Sitzmitte

/** Winkel eines Platzes relativ zu mir (0 = ich, vorne). */
export function seatAngle(seat, mySeat, n) {
  const rel = (seat - mySeat + n) % n;
  return (rel * Math.PI * 2) / n;
}

/** Punkt auf einer Ellipse um die Tischmitte. */
export function onEllipse(a, rx, rz, y = 0, out = new THREE.Vector3()) {
  return out.set(-Math.sin(a) * rx, y, Math.cos(a) * rz);
}

/** Richtung entlang der Tischkante (im Uhrzeigersinn, für mich = nach links). */
export function tangent(a, out = new THREE.Vector3()) {
  return out.set(-Math.cos(a), 0, -Math.sin(a));
}

export function seatPos(a, out) {
  return onEllipse(a, TABLE.rx + SEAT_OUT, TABLE.rz + SEAT_OUT, 0, out);
}

/** Wo die Karte eines Spielers im Stich liegt. */
export function trickSpot(a, n, out = new THREE.Vector3()) {
  const k = n >= 5 ? 1.1 : 1;
  return onEllipse(a, 0.5 * k, 0.34 * k, TABLE.y + 0.004, out);
}

/** Stapel der gewonnenen Stiche: an der Tischkante, vom Spieler aus rechts. */
export function pileSpot(a, out = new THREE.Vector3()) {
  if (a === 0) return out.set(0.62, TABLE.y + 0.003, TABLE.rz - 0.3);
  onEllipse(a, TABLE.rx - 0.3, TABLE.rz - 0.24, TABLE.y + 0.003, out);
  const t = tangent(a);
  return out.addScaledVector(t, -0.3);
}

/** Leuchtring vor dem Spieler, der am Zug ist. */
export function ringSpot(a, out = new THREE.Vector3()) {
  if (a === 0) return out.set(0, TABLE.y + 0.006, TABLE.rz - 0.24);
  return onEllipse(a, TABLE.rx - 0.27, TABLE.rz - 0.2, TABLE.y + 0.006, out);
}

/** Kartenstapel des Gebers: vor ihm, leicht nach links versetzt. */
export function deckSpot(a, out = new THREE.Vector3()) {
  if (a === 0) return out.set(-0.55, TABLE.y + 0.003, TABLE.rz - 0.3);
  onEllipse(a, TABLE.rx - 0.33, TABLE.rz - 0.27, TABLE.y + 0.003, out);
  return out.addScaledVector(tangent(a), 0.28);
}
