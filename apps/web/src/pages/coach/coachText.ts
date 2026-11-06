// Plain helpers for the Coach page (no components, so they're testable on their own).
import type { Spot, Street } from "@poker-solver/schema";
import type { PostflopSetup } from "../../lib/parseHandHistory";

export const SUIT_SYMBOL: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };

/** "AhQd" -> "A♥ Q♦"; a hand type ("AQo") stays as it is. */
export function handText(hand: string | null | undefined): string {
  if (!hand) return "";
  if (hand.length !== 4) return hand;
  const card = (c: string) => `${c[0] === "T" ? "10" : c[0]}${SUIT_SYMBOL[c[1]] ?? c[1]}`;
  return `${card(hand.slice(0, 2))} ${card(hand.slice(2))}`;
}

export const MAX_TEXT = 4000;
/** At or under this many messages left, the usage line turns into a warning. */
export const LOW_USAGE = 3;

export function cardsText(cards: string[]): string {
  return cards.map((c) => `${c[0] === "T" ? "10" : c[0]}${SUIT_SYMBOL[c[1]] ?? c[1]}`).join(" ");
}

/** A parsed hand history as the Spot the backend uses directly (spec §4.1):
 * the pot and stacks at the decision, and the first player's check if the
 * history stops after it (apps/api's spot_builder.from_attached). */
export function spotFromHistory(setup: PostflopSetup): Spot {
  const street: Street = setup.board.length >= 5 ? "river" : setup.board.length === 4 ? "turn" : "flop";
  return {
    positions_in_hand: [setup.oopPosition, setup.ipPosition],
    effective_stack_bb: setup.effectiveStackBb,
    pot_bb: setup.potBb,
    board: setup.board as Spot["board"],
    current_street: street,
    actions: setup.oopAlreadyChecked ? [{ position: setup.oopPosition, street, action: "check" }] : [],
    ranges: {},
  };
}

/** Starter prompts for an empty conversation: tapping one fills the box, it doesn't send. */
export const STARTERS = [
  "I have A♥ Q♦ on the button and the flop is Q♠ 5♣ 2♣. What should I do?",
  "BB here. BTN raised to 2.5bb. Should I call with 7♠ 6♠?",
  "Why does the solver check so many strong hands?",
  "Paste a hand history and ask about one decision",
];

/** "Today, 9:41 AM", "Yesterday", or a date. */
export function whenText(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((day(now) - day(d)) / 86_400_000);
  if (diffDays === 0) return `Today, ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

