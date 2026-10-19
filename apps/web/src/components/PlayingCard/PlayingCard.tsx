import "./PlayingCard.css";

const SUIT_SYMBOL: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
const SUIT_NAME: Record<string, string> = {
  s: "spades",
  h: "hearts",
  d: "diamonds",
  c: "clubs",
};

/** One face-up card from a "Ah"-style string. */
export function PlayingCard({ card, size = "md" }: { card: string; size?: "md" | "lg" | "xl" }) {
  const rank = card[0] === "T" ? "10" : card[0];
  const suit = card[1].toLowerCase();
  return (
    <span
      className={`playing-card playing-card--${size}`}
      data-suit={suit}
      role="img"
      aria-label={`${rank} of ${SUIT_NAME[suit]}`}
    >
      <span className="playing-card__rank">{rank}</span>
      <span className="playing-card__suit">{SUIT_SYMBOL[suit]}</span>
    </span>
  );
}
