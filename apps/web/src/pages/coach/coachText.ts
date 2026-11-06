// Plain helpers for the Coach page (no components, so they're testable on their own).
import type { Spot, Street } from "@poker-solver/schema";
import { parseHandHistoryToPostflopSetup, type PostflopSetup } from "../../lib/parseHandHistory";

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


/** A pasted hand history the app could read: the spot the backend uses as it
 * is, a one-line summary for the chip, and the text the model reads. */
export type AttachedHistory = { spot: Spot; summary: string; text: string };

/** Reads a pasted hand history, or says why it couldn't. */
export function readHistory(text: string): { attached: AttachedHistory } | { problem: string } {
  const result = parseHandHistoryToPostflopSetup(text);
  if (result.kind !== "ok") {
    return {
      problem: `${result.reason} You can still send it as text: paste it into the message box and the Coach will read it.`,
    };
  }
  const s = result.setup;
  return {
    attached: {
      spot: spotFromHistory(s),
      summary: `${s.oopPosition} vs ${s.ipPosition}, ${cardsText(s.board)}`,
      text: text.trim(),
    },
  };
}

/** The message sent with an attached history: the question, then the history
 * itself, so the model can read the user's seat and cards from it. */
export function withHistory(question: string, attached: AttachedHistory | null): string {
  if (!attached) return question.trim();
  const ask = question.trim() || "Here's a hand I played. What should I have done at the end?";
  return `${ask}\n\nHand history:\n${attached.text}`.slice(0, MAX_TEXT);
}
