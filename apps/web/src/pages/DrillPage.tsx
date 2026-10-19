import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlayingCard } from "../components/PlayingCard/PlayingCard";
import deckFile from "../data/drill-deck.json";
import {
  AGGRESSIVE,
  actionLabel,
  directionAction,
  gradeAction,
  isFacingBet,
  shuffled,
  type DrillAction,
  type DrillDeckFile,
  type DrillSpot,
  type Grade,
  type SwipeDirection,
} from "../lib/drill";
import { haptic } from "../lib/haptics";
import "./DrillPage.css";

const DECK_FILE = deckFile as unknown as DrillDeckFile;
const SESSION_LENGTH = 15;
// How far (px) a drag has to travel to count as a swipe, and the dominant
// axis has to win by this factor so a diagonal wobble doesn't trigger.
const SWIPE_DISTANCE = 80;

interface Answer {
  spot: DrillSpot;
  chosen: DrillAction;
  grade: Grade;
}

function situationText(spot: DrillSpot): string {
  const villain = spot.villainPosition;
  if (spot.situation === "first_to_act") return `You act first. ${villain} is behind you.`;
  if (spot.situation === "facing_check") return `${villain} checked to you.`;
  const frac = { bet_small: 0.25, bet_medium: 0.75, bet_large: 1.25 }[
    spot.facing as "bet_small"
  ];
  const amount = frac ? ` (${(frac * spot.potBb).toFixed(1)}bb)` : "";
  return `${villain} bet ${actionLabel(spot.facing!, false).replace("Bet ", "")} pot${amount}.`;
}

function pct(p: number): string {
  return p >= 0.995 ? "100%" : p < 0.005 ? "0%" : `${Math.round(p * 100)}%`;
}

export function DrillPage() {
  // Fixed for the life of the page; "Play again" bumps it.
  const [round, setRound] = useState(() => Date.now());
  const cards = useMemo(
    () => shuffled(DECK_FILE.decks[0].spots, round).slice(0, SESSION_LENGTH),
    [round],
  );
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [pickingSize, setPickingSize] = useState(false);
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false });
  const start = useRef<{ x: number; y: number } | null>(null);

  const spot = cards[index];
  const answer = answers.length > index ? answers[index] : null;
  const finished = index >= cards.length;
  const facingBet = spot ? isFacingBet(spot) : false;

  const choose = useCallback(
    (action: DrillAction) => {
      if (!spot || answer) return;
      const grade = gradeAction(spot, action);
      haptic(grade.verdict);
      setAnswers((prev) => [...prev, { spot, chosen: action, grade }]);
      setPickingSize(false);
      setDrag({ x: 0, y: 0, active: false });
    },
    [spot, answer],
  );

  const swipe = useCallback(
    (direction: SwipeDirection) => {
      if (!spot || answer) return;
      const result = directionAction(spot, direction);
      if (result === null) return;
      if (result === "size") setPickingSize(true);
      else choose(result);
    },
    [spot, answer, choose],
  );

  const next = useCallback(() => {
    setPickingSize(false);
    setIndex((i) => i + 1);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") swipe("left");
      else if (e.key === "ArrowRight") swipe("right");
      else if (e.key === "ArrowUp") swipe("up");
      else if ((e.key === "Enter" || e.key === " ") && answer && !finished) {
        e.preventDefault();
        next();
      } else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [swipe, next, answer, finished]);

  function onPointerDown(e: React.PointerEvent) {
    if (answer || pickingSize) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY };
    setDrag({ x: 0, y: 0, active: true });
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!start.current) return;
    setDrag({ x: e.clientX - start.current.x, y: e.clientY - start.current.y, active: true });
  }
  function onPointerEnd() {
    if (!start.current) return;
    const { x, y } = drag;
    start.current = null;
    setDrag({ x: 0, y: 0, active: false });
    if (Math.abs(x) >= SWIPE_DISTANCE && Math.abs(x) > Math.abs(y)) {
      swipe(x < 0 ? "left" : "right");
    } else if (y <= -SWIPE_DISTANCE && Math.abs(y) > Math.abs(x)) {
      swipe("up");
    }
  }

  if (finished) {
    return <Summary answers={answers} onAgain={() => { setRound(Date.now()); setIndex(0); setAnswers([]); }} />;
  }

  const score = answers.reduce((sum, a) => sum + a.grade.points, 0);
  const leftAction = directionAction(spot, "left");
  const rightAction = directionAction(spot, "right");
  const upAction = directionAction(spot, "up");
  const hint =
    Math.abs(drag.x) > Math.abs(drag.y)
      ? drag.x < -20 ? "left" : drag.x > 20 ? "right" : null
      : drag.y < -20 ? "up" : null;
  const aggressive = spot.actions.filter((a) => AGGRESSIVE.has(a));

  return (
    <div className="drill">
      <div className="drill__status">
        <span>
          Card {index + 1} of {cards.length}
        </span>
        <span>{score} pts</span>
      </div>

      <div
        className={`drill__card${drag.active ? " is-dragging" : ""}${answer ? ` is-${answer.grade.verdict}` : ""}`}
        style={{
          transform: `translate(${drag.x}px, ${Math.min(0, drag.y)}px) rotate(${drag.x / 18}deg)`,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        data-testid="drill-card"
      >
        <p className="drill__positions">
          You are <strong>{spot.heroPosition}</strong> vs {spot.villainPosition} &middot;{" "}
          {spot.potBb}bb pot
        </p>
        <p className="drill__situation">{situationText(spot)}</p>

        <div className="drill__label">Board</div>
        <div className="drill__cards">
          {spot.board.map((c) => (
            <PlayingCard key={c} card={c} />
          ))}
        </div>

        <div className="drill__label">Your hand</div>
        <div className="drill__cards">
          {spot.hand.map((c) => (
            <PlayingCard key={c} card={c} size="lg" />
          ))}
        </div>

        {hint && !answer && (
          <div className={`drill__hint drill__hint--${hint}`}>
            {hint === "left" && leftAction && leftAction !== "size" && actionLabel(leftAction, facingBet)}
            {hint === "right" && rightAction && rightAction !== "size" && actionLabel(rightAction, facingBet)}
            {hint === "up" && (upAction === "size" ? (facingBet ? "Raise…" : "Bet…") : upAction ? actionLabel(upAction, facingBet) : "")}
          </div>
        )}
      </div>

      {!answer && !pickingSize && (
        <>
          <p className="drill__prompt">Swipe the card, or tap a button.</p>
          <div className="drill__buttons">
            <button type="button" disabled={!leftAction} onClick={() => swipe("left")}>
              ← {leftAction && leftAction !== "size" ? actionLabel(leftAction, facingBet) : ""}
            </button>
            <button type="button" disabled={!upAction} onClick={() => swipe("up")}>
              ↑ {facingBet ? "Raise" : "Bet"}
            </button>
            <button type="button" disabled={!rightAction} onClick={() => swipe("right")}>
              {rightAction && rightAction !== "size" ? actionLabel(rightAction, facingBet) : "Call"} →
            </button>
          </div>
        </>
      )}

      {!answer && pickingSize && (
        <div className="drill__sizes">
          <p className="drill__prompt">{facingBet ? "Raise to…" : "Bet size"}</p>
          <div className="drill__buttons">
            {aggressive.map((a) => (
              <button key={a} type="button" onClick={() => choose(a)}>
                {actionLabel(a, facingBet)}
              </button>
            ))}
          </div>
          <button type="button" className="drill__cancel" onClick={() => setPickingSize(false)}>
            Back
          </button>
        </div>
      )}

      {answer && <Feedback answer={answer} facingBet={facingBet} onNext={next} last={index === cards.length - 1} />}
    </div>
  );
}

const VERDICT_TEXT = {
  best: "Best move",
  good: "Acceptable — the solver mixes this in",
  miss: "Miss — the solver almost never does this",
};

function Feedback({
  answer,
  facingBet,
  onNext,
  last,
}: {
  answer: Answer;
  facingBet: boolean;
  onNext: () => void;
  last: boolean;
}) {
  const { spot, chosen, grade } = answer;
  const rows = spot.actions
    .map((a) => ({ action: a, p: spot.mix[a] ?? 0 }))
    .filter((r) => r.p >= 0.005 || r.action === chosen);
  return (
    <div className={`drill__feedback is-${grade.verdict}`} role="status">
      <p className="drill__verdict">{VERDICT_TEXT[grade.verdict]}</p>
      <p className="drill__muted">
        You chose {actionLabel(chosen, facingBet)}, which the solver plays {pct(grade.frequency)} of
        the time with this hand.
      </p>
      <ul className="drill__mix">
        {rows.map((r) => (
          <li key={r.action} className={r.action === chosen ? "is-chosen" : undefined}>
            <span className="drill__mix-name">{actionLabel(r.action, facingBet)}</span>
            <span className="drill__mix-bar">
              <span style={{ width: `${Math.round(r.p * 100)}%` }} />
            </span>
            <span className="drill__mix-pct">{pct(r.p)}</span>
          </li>
        ))}
      </ul>
      <button type="button" className="drill__next" onClick={onNext} autoFocus>
        {last ? "See results" : "Next card"}
      </button>
    </div>
  );
}

function Summary({ answers, onAgain }: { answers: Answer[]; onAgain: () => void }) {
  const score = answers.reduce((s, a) => s + a.grade.points, 0);
  const missed = answers.filter((a) => a.grade.verdict === "miss");
  const best = answers.filter((a) => a.grade.verdict === "best").length;
  return (
    <div className="drill">
      <h2 className="drill__summary-title">
        {score} / {answers.length}
      </h2>
      <p className="drill__muted">
        {best} best moves out of {answers.length}.
        {missed.length === 0 ? " No misses." : ` ${missed.length} missed.`}
      </p>
      {missed.length > 0 && (
        <>
          <h3>Worth another look</h3>
          <ul className="drill__missed">
            {missed.map((a) => (
              <li key={a.spot.id}>
                <span className="drill__cards">
                  {a.spot.hand.map((c) => (
                    <PlayingCard key={c} card={c} />
                  ))}
                </span>
                <span>
                  on {a.spot.board.join(" ")}: you chose{" "}
                  {actionLabel(a.chosen, isFacingBet(a.spot))}, the solver prefers{" "}
                  {actionLabel(a.grade.topAction, isFacingBet(a.spot))} (
                  {pct(a.spot.mix[a.grade.topAction] ?? 0)}).
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <button type="button" className="drill__next" onClick={onAgain}>
        Play again
      </button>
    </div>
  );
}
