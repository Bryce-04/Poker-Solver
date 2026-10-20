import { useEffect, useRef, useState } from "react";
import { CardPicker } from "../../components/CardPicker/CardPicker";
import { PlayingCard } from "../../components/PlayingCard/PlayingCard";
import { boardFromCards, parseBoardText } from "../../lib/cards";

const SLOT_NAME = ["Flop", "Flop", "Flop", "Turn", "River"];
const SUIT_NAME: Record<string, string> = { s: "spades", h: "hearts", d: "diamonds", c: "clubs" };

/**
 * The board as five card slots (docs/desktop-redesign.md §6.1): dealt cards
 * as white card faces, then dashed "Turn +" / "River +" slots. Clicking a
 * slot opens the existing CardPicker in a popover anchored to it; picking a
 * card fills (or replaces) that slot. "Or type it" edits the same cards
 * through lib/cards.ts's parser. Both converge on the same card list.
 *
 * `openSlot` is controlled so the page can open a slot itself ("Deal a turn
 * card").
 */
export function BoardSlots({
  cards,
  onChange,
  openSlot,
  onOpenSlot,
}: {
  cards: string[];
  onChange: (cards: string[]) => void;
  openSlot: number | null;
  onOpenSlot: (slot: number | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const typed = draft !== null && draft.trim() !== "" ? parseBoardText(draft) : null;
  const picked = boardFromCards(cards);

  // Close the popover on Escape or a click outside the board.
  useEffect(() => {
    if (openSlot === null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onOpenSlot(null);
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onOpenSlot(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [openSlot, onOpenSlot]);

  function pick(next: string[]) {
    if (openSlot === null) return;
    const added = next.find((c) => !cards.includes(c));
    const removed = cards.find((c) => !next.includes(c));
    let result = cards;
    if (added) {
      result = openSlot < cards.length ? cards.map((c, i) => (i === openSlot ? added : c)) : [...cards, added];
    } else if (removed) {
      result = cards.filter((c) => c !== removed);
    }
    onChange(result);
    // Keep dealing the flop one card at a time; otherwise close.
    onOpenSlot(result.length < 3 ? result.length : null);
  }

  // The slot being filled: an existing card's index, or the next empty one.
  const activeIndex = openSlot === null ? null : Math.min(openSlot, cards.length);
  const replacing = activeIndex !== null && activeIndex < cards.length;

  return (
    <div className="board-slots" ref={wrapRef}>
      <div className="board-slots__row">
        {[0, 1, 2, 3, 4].map((i) => {
          const card = cards[i];
          const reachable = i <= cards.length;
          return (
            <span key={i} className="board-slots__slot-wrap" data-gap={i === 3 || undefined}>
              {card ? (
                <button
                  type="button"
                  className="board-slots__slot board-slots__slot--card"
                  aria-label={`${SLOT_NAME[i]} card: ${card[0]} of ${SUIT_NAME[card[1]]}. Change it`}
                  aria-expanded={activeIndex === i}
                  onClick={() => onOpenSlot(activeIndex === i ? null : i)}
                >
                  <PlayingCard card={card} size="lg" />
                </button>
              ) : (
                <button
                  type="button"
                  className="board-slots__slot board-slots__slot--empty"
                  aria-label={`Add the ${SLOT_NAME[i].toLowerCase()} card`}
                  aria-expanded={activeIndex === i}
                  disabled={!reachable}
                  onClick={() => onOpenSlot(activeIndex === i ? null : i)}
                >
                  {SLOT_NAME[i]}
                  <br />+
                </button>
              )}
            </span>
          );
        })}
      </div>

      {activeIndex !== null && (
        <div className="board-slots__popover" role="dialog" aria-label={`Pick the ${SLOT_NAME[activeIndex].toLowerCase()} card`}>
          <div className="board-slots__popover-head">
            <span>
              {replacing ? `Change the ${SLOT_NAME[activeIndex].toLowerCase()} card` : `Pick the ${SLOT_NAME[activeIndex].toLowerCase()} card`}
            </span>
            {replacing && (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  onChange(cards.filter((_, i) => i !== activeIndex));
                  onOpenSlot(null);
                }}
              >
                Remove
              </button>
            )}
          </div>
          {/* Replacing a card on a full board: let every card be clickable. */}
          <CardPicker value={cards} onChange={pick} max={replacing ? 6 : 5} />
        </div>
      )}

      <label className="board-slots__type">
        Or type it
        <input
          type="text"
          value={draft ?? cards.join(" ")}
          placeholder="Qs 5c 2c"
          onFocus={() => setDraft(cards.join(" "))}
          onBlur={() => setDraft(null)}
          onChange={(e) => {
            setDraft(e.target.value);
            const parsed = parseBoardText(e.target.value);
            if (e.target.value.trim() === "") onChange([]);
            else if (parsed.kind === "ok") onChange(parsed.cards);
          }}
        />
      </label>
      {typed?.kind === "error" ? (
        <p className="spot-builder__field-error">{typed.reason}</p>
      ) : draft === null && cards.length > 0 && picked.kind === "error" ? (
        <p className="spot-builder__field-error">{picked.reason}</p>
      ) : (
        <p className="board-slots__hint">Click a card to change it. 3 cards solves the flop, 4 the turn, 5 the river.</p>
      )}
    </div>
  );
}
