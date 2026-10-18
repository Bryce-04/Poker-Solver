// Suit-level view of a HandRange. A range's keys are 169-type labels ("AKs")
// and/or specific combos ("AhKh"); a combo key overrides its label's weight
// for that one combo, exactly as services/solver's combos.expand_range reads
// them. This module is the frontend's mirror of that rule, so the grid and
// the combo editor agree with what a solve will actually use.

import type { HandRange } from "@poker-solver/schema";

// Same orders as services/solver's cards.py (RANKS / SUITS), so a canonical
// combo key here is byte-for-byte what the API returns: higher card first.
const RANK_ORDER = "23456789TJQKA";
export const SUITS = ["s", "h", "d", "c"] as const;
export type Suit = (typeof SUITS)[number];

const SUIT_ORDER = "shdc";

const COMBO_KEY_RE = /^([2-9TJQKA])([shdc])([2-9TJQKA])([shdc])$/i;

function cardValue(rank: string, suit: string): number {
  return RANK_ORDER.indexOf(rank) * 4 + SUIT_ORDER.indexOf(suit);
}

export function isComboKey(key: string): boolean {
  return key.length === 4;
}

/** Two cards ("Ah", "Kh") to the canonical combo key ("AhKh"), higher first. */
export function comboKey(cardA: string, cardB: string): string {
  const a = cardValue(cardA[0].toUpperCase(), cardA[1].toLowerCase());
  const b = cardValue(cardB[0].toUpperCase(), cardB[1].toLowerCase());
  return a >= b ? cardA[0].toUpperCase() + cardA[1].toLowerCase() + cardB[0].toUpperCase() + cardB[1].toLowerCase()
    : cardB[0].toUpperCase() + cardB[1].toLowerCase() + cardA[0].toUpperCase() + cardA[1].toLowerCase();
}

/** Normalizes any spelling of a combo key ("khah") to canonical form, or
 * null if it isn't a valid two-distinct-card combo. */
export function canonicalComboKey(key: string): string | null {
  const m = COMBO_KEY_RE.exec(key);
  if (!m) return null;
  const first = m[1].toUpperCase() + m[2].toLowerCase();
  const second = m[3].toUpperCase() + m[4].toLowerCase();
  if (first === second) return null;
  return comboKey(first, second);
}

/** The two cards of a canonical combo key. */
export function comboCards(key: string): [string, string] {
  return [key.slice(0, 2), key.slice(2, 4)];
}

/** The 169-type label a combo belongs to: "AhKh" -> "AKs", "AhAs" -> "AA". */
export function comboLabel(key: string): string {
  const [a, b] = comboCards(key);
  if (a[0] === b[0]) return a[0] + b[0];
  return a[0] + b[0] + (a[1] === b[1] ? "s" : "o");
}

/** Every concrete combo of a label, canonical keys: AA 6, AKs 4, AKo 12. */
export function labelCombos(label: string): string[] {
  const high = label[0];
  const low = label[1];
  if (label.length === 2) {
    const out: string[] = [];
    for (let i = 0; i < 4; i++)
      for (let j = i + 1; j < 4; j++) out.push(comboKey(high + SUITS[i], low + SUITS[j]));
    return out;
  }
  const suited = label[2] === "s";
  const out: string[] = [];
  for (const hs of SUITS)
    for (const ls of SUITS) {
      if (suited ? hs === ls : hs !== ls) out.push(comboKey(high + hs, low + ls));
    }
  return out;
}

/** One square of the suit layout shared by the range editor and the strategy
 * view. `combo` is null for a blank square (offsuit hands only: the diagonal
 * of the 4x4, where the two suits would be the same). */
export interface ComboSlot {
  combo: string | null;
  high: string;
  low: string;
}

/** Columns of the suit layout: suited hands are one row of four, pairs two
 * rows of three, offsuit hands a 4x4 (rows are the higher card's suit,
 * columns the lower card's) with its diagonal left blank. */
export function comboColumns(label: string): number {
  if (label.length === 2) return 3;
  return 4;
}

export function comboSlots(label: string): ComboSlot[] {
  const isPair = label.length === 2;
  const suited = label[2] === "s";
  const slots: ComboSlot[] = [];
  SUITS.forEach((rowSuit, r) =>
    SUITS.forEach((colSuit, c) => {
      const high = label[0] + rowSuit;
      const low = label[1] + colSuit;
      if (isPair) {
        if (c > r) slots.push({ combo: comboKey(high, low), high, low });
      } else if (suited) {
        if (r === c) slots.push({ combo: comboKey(high, low), high, low });
      } else {
        slots.push({ combo: r !== c ? comboKey(high, low) : null, high, low });
      }
    }),
  );
  return slots;
}

/** A range split once into label weights and per-label combo overrides, so
 * the 169 grid cells don't each rescan every key. */
export interface RangeIndex {
  labels: Record<string, number>;
  overrides: Map<string, Record<string, number>>;
}

export function indexRange(range: HandRange): RangeIndex {
  const labels: Record<string, number> = {};
  const overrides = new Map<string, Record<string, number>>();
  for (const [key, weight] of Object.entries(range)) {
    if (!isComboKey(key)) {
      labels[key] = weight;
      continue;
    }
    const canonical = canonicalComboKey(key);
    if (canonical === null) continue; // not a combo this app understands
    const label = comboLabel(canonical);
    const group = overrides.get(label) ?? {};
    group[canonical] = weight;
    overrides.set(label, group);
  }
  return { labels, overrides };
}

/** Weight of every combo of `label` (0 for combos that are out), label
 * weight first, then combo overrides on top -- the solver's rule. */
export function comboWeights(index: RangeIndex, label: string): Record<string, number> {
  const base = index.labels[label] ?? 0;
  const over = index.overrides.get(label);
  const out: Record<string, number> = {};
  for (const combo of labelCombos(label)) out[combo] = over?.[combo] ?? base;
  return out;
}

/** Mean combo weight of a label -- what a grid cell shades by. */
export function labelWeight(index: RangeIndex, label: string): number {
  const weights = Object.values(comboWeights(index, label));
  return weights.reduce((sum, w) => sum + w, 0) / weights.length;
}

/** True when a label's combos don't all share one weight. */
export function isPartial(index: RangeIndex, label: string): boolean {
  if (!index.overrides.has(label)) return false;
  const weights = Object.values(comboWeights(index, label));
  return weights.some((w) => w !== weights[0]);
}

/** Total weighted combos in the range (the grid's "N combos"). */
export function totalCombos(index: RangeIndex): number {
  const labels = new Set([...Object.keys(index.labels), ...index.overrides.keys()]);
  let total = 0;
  for (const label of labels) {
    for (const w of Object.values(comboWeights(index, label))) if (w > 0) total += w;
  }
  return total;
}

/** Hand type -> how many combos' worth of it are in the range (its mean
 * combo weight times its combo count). Only hand types with any weight. */
export function handMass(index: RangeIndex): Record<string, number> {
  const labels = new Set([...Object.keys(index.labels), ...index.overrides.keys()]);
  const mass: Record<string, number> = {};
  for (const label of labels) {
    const weights = Object.values(comboWeights(index, label));
    const total = weights.reduce((sum, w) => sum + w, 0);
    if (total > 0) mass[label] = total;
  }
  return mass;
}

/** How many concrete combos carry any weight at all -- as opposed to
 * totalCombos, which adds the weights up (so 300 combos at 3% each is "9"). */
export function liveComboCount(index: RangeIndex): number {
  const labels = new Set([...Object.keys(index.labels), ...index.overrides.keys()]);
  let count = 0;
  for (const label of labels) {
    for (const w of Object.values(comboWeights(index, label))) if (w > 0) count += 1;
  }
  return count;
}

function withoutLabel(range: HandRange, label: string): HandRange {
  const next: HandRange = {};
  for (const [key, weight] of Object.entries(range)) {
    if (key === label) continue;
    if (isComboKey(key)) {
      const canonical = canonicalComboKey(key);
      if (canonical !== null && comboLabel(canonical) === label) continue;
    }
    next[key] = weight;
  }
  return next;
}

/** Sets a whole hand type (every suit combo) to one weight, dropping any
 * per-combo overrides it had. Weight <= 0 removes it. */
export function setLabelWeight(range: HandRange, label: string, weight: number): HandRange {
  const next = withoutLabel(range, label);
  if (weight > 0) next[label] = weight;
  return next;
}

/** Sets one specific combo's weight, re-encoding its hand type compactly:
 * back to a single label key if every combo now agrees, otherwise one key
 * per live combo (no label key, so absent combos stay out). */
export function setComboWeight(
  range: HandRange,
  label: string,
  combo: string,
  weight: number,
): HandRange {
  const weights = comboWeights(indexRange(range), label);
  weights[combo] = Math.max(0, weight);
  const values = Object.values(weights);
  if (values.every((w) => w === values[0])) return setLabelWeight(range, label, values[0]);
  const next = withoutLabel(range, label);
  for (const [key, w] of Object.entries(weights)) if (w > 0) next[key] = w;
  return next;
}
