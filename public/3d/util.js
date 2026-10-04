// Kleine Helfer: deterministischer Zufall, Easing, Tweens auf einer gemeinsamen Uhr.

export function hashStr(str) {
  let x = 2166136261;
  for (const ch of String(str)) {
    x ^= ch.charCodeAt(0);
    x = Math.imul(x, 16777619);
  }
  return x >>> 0;
}

export function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const easeOut = (t) => 1 - (1 - t) ** 3;
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const easeIn = (t) => t * t * t;
/** Glocke 0 → 1 → 0 über t ∈ [0, 1] mit weichen Rändern (Einblend-/Ausblendanteil e). */
export function envelope(t, e = 0.2) {
  if (t <= 0 || t >= 1) return 0;
  if (t < e) return smooth(t / e);
  if (t > 1 - e) return smooth((1 - t) / e);
  return 1;
}

// ---------- Tweens ----------
let clock = 0; // Sekunden, wird vom Renderloop gesetzt
const tweens = new Set();

export function now() {
  return clock;
}

/**
 * Startet einen Tween. onUpdate(eased, raw) wird jeden Frame aufgerufen.
 * Optionen: delay (s), ease, onStart, onDone, group (zum gemeinsamen Abbrechen).
 */
export function tween(duration, onUpdate, opts = {}) {
  const tw = {
    t0: clock + (opts.delay ?? 0),
    duration: Math.max(duration, 0.0001),
    onUpdate,
    ease: opts.ease ?? easeInOut,
    onStart: opts.onStart,
    onDone: opts.onDone,
    group: opts.group,
    started: false,
    cancelled: false,
  };
  tweens.add(tw);
  return tw;
}

/** Ruft fn nach `delay` Sekunden auf (über dieselbe Uhr, also abbrechbar). */
export function after(delay, fn, group) {
  return tween(0.0001, () => {}, { delay, onDone: fn, group });
}

export function cancel(tw) {
  if (!tw) return;
  tw.cancelled = true;
  tweens.delete(tw);
}

export function cancelGroup(group) {
  for (const tw of tweens) if (tw.group === group) cancel(tw);
}

export function updateTweens(t) {
  clock = t;
  for (const tw of [...tweens]) {
    if (tw.cancelled || t < tw.t0) continue;
    if (!tw.started) {
      tw.started = true;
      tw.onStart?.();
      if (tw.cancelled) continue;
    }
    const raw = Math.min(1, (t - tw.t0) / tw.duration);
    tw.onUpdate(tw.ease(raw), raw);
    if (raw >= 1) {
      tweens.delete(tw);
      tw.onDone?.();
    }
  }
}
