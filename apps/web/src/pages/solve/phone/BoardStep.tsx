import { useEffect, useState } from "react";
import { ActionBar } from "../../../components/mobile/ActionBar";
import { BottomSheet } from "../../../components/mobile/BottomSheet";
import { computeStreetState } from "../../../lib/handBuilder";
import { bb } from "../solveText";
import type { SolveSetup } from "../useSolveSetup";
import { boardBlocker, parseTypedCards } from "./phoneSteps";

const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"] as const;
const SUITS = [
  { key: "s", symbol: "♠", name: "Spades", red: false },
  { key: "h", symbol: "♥", name: "Hearts", red: true },
  { key: "d", symbol: "♦", name: "Diamonds", red: true },
  { key: "c", symbol: "♣", name: "Clubs", red: false },
] as const;
const SUIT_SYMBOL: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
const SUIT_NAME: Record<string, string> = { s: "spades", h: "hearts", d: "diamonds", c: "clubs" };
const RANK_NAME: Record<string, string> = { A: "Ace", K: "King", Q: "Queen", J: "Jack", T: "Ten" };
const SLOT_NAMES = ["Flop", "Flop", "Flop", "Turn", "River"] as const;
const SHEET_TITLES = ["the 1st flop card", "the 2nd flop card", "the 3rd flop card", "the turn", "the river"];

function cardName(card: string): string {
  return `${RANK_NAME[card[0]] ?? card[0]} of ${SUIT_NAME[card[1]]}`;
}

/**
 * Step 2, "What's on the board?" (docs/mobile-redesign.md §4.2): five card
 * slots filled from a rank-then-suit sheet, or typed. Both edit the same
 * picked cards, so they stay in step with each other.
 */
export function BoardStep({
  s,
  onBack,
  onNext,
  onEditHand,
}: {
  s: SolveSetup;
  onBack: () => void;
  onNext: () => void;
  /** Go to step 1, to enter an earlier street's action. */
  onEditHand: () => void;
}) {
  // The phone always edits the picked cards; typing parses into them. (A
  // board typed on desktop, then the window narrowed, switches over here.)
  const { boardMode, setBoardMode } = s;
  useEffect(() => {
    if (boardMode !== "pick") setBoardMode("pick");
  }, [boardMode, setBoardMode]);
  const cards = s.pickedCards;
  const [slot, setSlot] = useState<number | null>(null);
  const blocker = boardBlocker(s);

  function place(index: number, card: string) {
    const next = [...cards];
    next[index] = card;
    s.setPickedCards(next);
    // Keep going until the flop is complete; the turn and river are one card each.
    const nextEmpty = next.length < 3 ? next.length : null;
    setSlot(nextEmpty);
  }

  function remove(index: number) {
    s.setPickedCards(cards.filter((_, i) => i !== index));
    setSlot(null);
  }

  // Before the flop is down, the hand's pot is still "entering preflop" (0);
  // show what preflop left instead, which is what the flop starts from.
  const afterPreflop =
    s.setupMode === "click" && cards.length < 3 && s.preflopClosed
      ? computeStreetState(s.preflop, s.streets.preflop)
      : null;
  const pot = afterPreflop ? afterPreflop.potAfterBb : s.potBb;
  const stacks = afterPreflop ? afterPreflop.stackAfterBb : s.effectiveStackBb;

  const streetLine =
    cards.length < 3
      ? `Pick ${3 - cards.length} more for the flop`
      : `Solving the ${["flop", "turn", "river"][cards.length - 3]}`;

  return (
    <>
      <div>
        <h1 className="m-step__title">What&rsquo;s on the board?</h1>
        <p className="m-step__lede">3 cards solves the flop, 4 the turn, 5 the river.</p>
      </div>

      <div className="m-slots">
        {SLOT_NAMES.map((name, i) => {
          const card = cards[i];
          const reachable = i <= cards.length;
          return (
            <div key={i} className="m-slots__slot">
              <button
                type="button"
                className="m-slot"
                data-filled={card ? true : undefined}
                data-red={card && (card[1] === "h" || card[1] === "d") ? true : undefined}
                data-picking={slot === i || undefined}
                disabled={!reachable}
                aria-label={card ? `${name}: ${cardName(card)}. Change it` : `Pick ${SHEET_TITLES[i]}`}
                onClick={() => setSlot(i)}
              >
                {card ? (
                  <>
                    <span>{card[0]}</span>
                    <span className="m-slot__suit">{SUIT_SYMBOL[card[1]]}</span>
                  </>
                ) : (
                  <span aria-hidden="true">+</span>
                )}
              </button>
              <span className="m-slots__name">{name}</span>
            </div>
          );
        })}
      </div>

      <div className="m-card m-card--padded">
        <span className="m-card__title">{streetLine}</span>
        <span className="m-note">
          Pot {bb(pot)} · Stacks {bb(stacks)} · {s.oopPosition} acts first
        </span>
        {s.setupMode === "click" && cards.length >= 3 && s.handSummary.blockedReason && (
          <>
            <span className="m-error">{s.handSummary.blockedReason}</span>
            <button type="button" className="m-link" onClick={onEditHand}>
              Enter the {s.handSummary.targetStreet} action
            </button>
          </>
        )}
      </div>

      <TypedBoard cards={cards} onCards={s.setPickedCards} />

      <ActionBar primaryLabel="Next: the ranges" onPrimary={onNext} disabledReason={blocker} onBack={onBack} />

      {slot !== null && (
        <CardSheet
          key={slot}
          index={slot}
          current={cards[slot] ?? null}
          used={cards.filter((_, i) => i !== slot)}
          onPick={(card) => place(slot, card)}
          onRemove={() => remove(slot)}
          onClose={() => setSlot(null)}
        />
      )}
    </>
  );
}

/** "Or type it": kept in step with the slots both ways. */
function TypedBoard({ cards, onCards }: { cards: string[]; onCards: (cards: string[]) => void }) {
  const [text, setText] = useState(cards.join(" "));
  const [synced, setSynced] = useState(cards);
  const [error, setError] = useState<string | null>(null);
  // Cards changed from the slots: show them here.
  if (synced !== cards) {
    setSynced(cards);
    setText(cards.join(" "));
    setError(null);
  }

  return (
    <label className="m-field">
      Or type it
      <input
        type="text"
        className="m-field__mono"
        value={text}
        placeholder="Qs 5c 2c"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          const parsed = parseTypedCards(e.target.value);
          if (parsed.kind === "ok") {
            setError(null);
            setSynced(parsed.cards);
            onCards(parsed.cards);
          } else {
            setError(parsed.reason);
          }
        }}
        aria-invalid={error ? true : undefined}
      />
      {error && <span className="m-error">{error}</span>}
    </label>
  );
}

/**
 * Pick one card (§4.2): the rank first, then the suit. A rank is off once all
 * four of its cards are on the board; a suit is off until a rank is picked,
 * or when that exact card is taken.
 */
function CardSheet({
  index,
  current,
  used,
  onPick,
  onRemove,
  onClose,
}: {
  index: number;
  current: string | null;
  used: string[];
  onPick: (card: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [rank, setRank] = useState<string | null>(current ? current[0] : null);
  const taken = new Set(used);

  return (
    <BottomSheet open onClose={onClose} title={`${current ? "Change" : "Pick"} ${SHEET_TITLES[index]}`}>
      <span className="m-label">1 · Rank</span>
      <div className="m-ranks" role="group" aria-label="Rank">
        {RANKS.map((r) => (
          <button
            key={r}
            type="button"
            className="m-chip"
            aria-pressed={rank === r}
            disabled={SUITS.every((suit) => taken.has(r + suit.key))}
            onClick={() => setRank(r)}
          >
            {r}
          </button>
        ))}
      </div>
      <span className="m-label">2 · Suit</span>
      <div className="m-suits" role="group" aria-label="Suit">
        {SUITS.map((suit) => (
          <button
            key={suit.key}
            type="button"
            className="m-suit"
            data-red={suit.red || undefined}
            disabled={rank === null || taken.has(rank + suit.key)}
            onClick={() => rank && onPick(rank + suit.key)}
          >
            <span aria-hidden="true">{suit.symbol}</span>
            <span className="m-suit__name">{suit.name}</span>
          </button>
        ))}
      </div>
      {current && (
        <button type="button" className="m-btn m-btn--ghost m-btn--danger-text" onClick={onRemove}>
          Remove this card
        </button>
      )}
    </BottomSheet>
  );
}
