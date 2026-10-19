import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ErrorBoundary } from "../components/ErrorBoundary/ErrorBoundary";
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
import {
  DRILL_THEMES,
  readTheme,
  themeById,
  writeTheme,
  type DrillThemeId,
} from "../lib/drillTheme";
import { haptic } from "../lib/haptics";
import "./DrillPage.css";

const DECK_FILE = deckFile as unknown as DrillDeckFile;
const DECK = DECK_FILE.decks[0];
const SESSION_LENGTH = 15;
// How far (px) a drag has to travel to count as a swipe.
const SWIPE_DISTANCE = 80;
// Matches the .is-thrown transition in DrillPage.css.
const THROW_MS = 200;
const BEST_KEY = "drill.bestScore";

interface Answer {
  spot: DrillSpot;
  chosen: DrillAction;
  grade: Grade;
}

function readBest(): number | null {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    return raw === null ? null : Number(raw);
  } catch {
    return null;
  }
}

function writeBest(score: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(score));
  } catch {
    // A remembered best score is a nicety; private mode shouldn't break the game.
  }
}

function pct(p: number): string {
  return p >= 0.995 ? "100%" : p < 0.005 ? "0%" : `${Math.round(p * 100)}%`;
}

const BET_FRACTION: Record<string, number> = {
  bet_small: 0.25,
  bet_medium: 0.75,
  bet_large: 1.25,
};

/** The one-glance line on what's happening: who owes what. */
function situationChip(spot: DrillSpot): { text: string; tone: "facing" | "free" } {
  if (spot.situation === "first_to_act") return { text: "Your action first", tone: "free" };
  if (spot.situation === "facing_check") {
    return { text: `${spot.villainPosition} checked to you`, tone: "free" };
  }
  const frac = BET_FRACTION[spot.facing ?? ""];
  const amount = frac ? `${(frac * spot.potBb).toFixed(1)}bb` : "a bet";
  return { text: `${spot.villainPosition} bets ${amount}`, tone: "facing" };
}

function seatLine(spot: DrillSpot): string {
  return spot.situation === "first_to_act" ? "Out of position" : "In position";
}

/** The seat badge: who you are, the thing most worth noticing on the card. */
function SeatBadge({ spot }: { spot: DrillSpot }) {
  return (
    <div className="seat">
      <div className="seat__you" data-seat={spot.heroPosition}>
        <span className="seat__you-label">You</span>
        <span className="seat__name">{spot.heroPosition}</span>
      </div>
      <div className="seat__meta">
        <span className="seat__position">{seatLine(spot)}</span>
        <span className="seat__vs">vs {spot.villainPosition}</span>
      </div>
    </div>
  );
}

function Chips({ spot }: { spot: DrillSpot }) {
  const chip = situationChip(spot);
  return (
    <div className="chips">
      <span className={`chip chip--${chip.tone}`}>{chip.text}</span>
      <span className="chip">Pot {spot.potBb}bb</span>
      <span className="chip">{spot.stackBb}bb deep</span>
    </div>
  );
}

export function DrillPage() {
  const [theme, setTheme] = useState<DrillThemeId>(readTheme);

  // Tint the browser / status bar to match the table while the drill is open.
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const previous = meta?.content;
    if (meta) meta.content = themeById(theme).chrome;
    return () => {
      if (meta && previous !== undefined) meta.content = previous;
    };
  }, [theme]);

  function pickTheme(id: DrillThemeId) {
    setTheme(id);
    writeTheme(id);
  }

  return (
    <div className="game" data-theme={theme}>
      <ErrorBoundary>
        <Game theme={theme} onTheme={pickTheme} />
      </ErrorBoundary>
    </div>
  );
}

type Phase = "start" | "playing" | "done";

function Game({ theme, onTheme }: { theme: DrillThemeId; onTheme: (id: DrillThemeId) => void }) {
  const [phase, setPhase] = useState<Phase>("start");
  const [round, setRound] = useState(() => Date.now());
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [best, setBest] = useState<number | null>(readBest);

  const cards = useMemo(() => shuffled(DECK.spots, round).slice(0, SESSION_LENGTH), [round]);

  function play() {
    setRound(Date.now());
    setAnswers([]);
    setPhase("playing");
  }

  function finish(final: Answer[]) {
    const score = final.reduce((s, a) => s + a.grade.points, 0);
    if (best === null || score > best) {
      setBest(score);
      writeBest(score);
    }
    setAnswers(final);
    setPhase("done");
  }

  return (
    <>
      <header className="game__top">
        <Link to="/" className="game__exit" aria-label="Exit the drill">
          <span aria-hidden="true">✕</span>
        </Link>
        {phase === "playing" ? (
          <Progress answers={answers} total={cards.length} />
        ) : (
          <span className="game__title">Swipe Drill</span>
        )}
      </header>

      {phase === "start" && <Start best={best} onPlay={play} theme={theme} onTheme={onTheme} />}
      {phase === "playing" && (
        <Playing
          key={round}
          cards={cards}
          onAnswer={(a) => setAnswers((prev) => [...prev, a])}
          onFinish={finish}
          answers={answers}
        />
      )}
      {phase === "done" && <Summary answers={answers} best={best} onAgain={play} />}
    </>
  );
}

function streakOf(answers: Answer[]): number {
  let n = 0;
  for (let i = answers.length - 1; i >= 0 && answers[i].grade.verdict !== "miss"; i--) n++;
  return n;
}

function Progress({ answers, total }: { answers: Answer[]; total: number }) {
  const score = answers.reduce((s, a) => s + a.grade.points, 0);
  const streak = streakOf(answers);
  return (
    <div className="progress">
      <div
        className="progress__bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={answers.length}
        aria-label={`${answers.length} of ${total} cards`}
      >
        <span style={{ width: `${(answers.length / total) * 100}%` }} />
      </div>
      <div className="progress__stats">
        <span>
          {Math.min(answers.length + 1, total)} / {total}
        </span>
        {streak >= 2 && <span className="progress__streak">Streak {streak}</span>}
        <span>{score} pts</span>
      </div>
    </div>
  );
}

function Start({
  best,
  onPlay,
  theme,
  onTheme,
}: {
  best: number | null;
  onPlay: () => void;
  theme: DrillThemeId;
  onTheme: (id: DrillThemeId) => void;
}) {
  return (
    <main className="start">
      <h1 className="start__title">Swipe Drill</h1>
      <p className="start__deck">{DECK.name}</p>
      <p className="start__desc">{DECK.description}</p>
      <ul className="start__how">
        <li>
          <span className="start__key">←</span> Fold or check
        </li>
        <li>
          <span className="start__key">→</span> Call
        </li>
        <li>
          <span className="start__key">↑</span> Bet or raise
        </li>
      </ul>
      <p className="start__note">
        {SESSION_LENGTH} hands. Scored against a solved strategy for your exact cards.
      </p>
      <fieldset className="themes">
        <legend>Table color</legend>
        <div className="themes__row">
          {DRILL_THEMES.map((t) => (
            <label key={t.id} className="themes__option">
              <input
                type="radio"
                name="drill-theme"
                value={t.id}
                checked={theme === t.id}
                onChange={() => onTheme(t.id)}
              />
              <span
                className="themes__swatch"
                style={{
                  ["--swatch-felt" as string]: t.felt,
                  ["--swatch-edge" as string]: t.edge,
                  ["--swatch-rail" as string]: t.rail,
                  ["--swatch-rim" as string]: t.rim,
                }}
              />
              {t.label}
            </label>
          ))}
        </div>
      </fieldset>
      {best !== null && <p className="start__best">Best score: {best} / {SESSION_LENGTH}</p>}
      <button type="button" className="game__primary" onClick={onPlay} autoFocus>
        Play
      </button>
    </main>
  );
}

function Playing({
  cards,
  answers,
  onAnswer,
  onFinish,
}: {
  cards: DrillSpot[];
  answers: Answer[];
  onAnswer: (a: Answer) => void;
  onFinish: (all: Answer[]) => void;
}) {
  const [index, setIndex] = useState(0);
  const [pickingSize, setPickingSize] = useState(false);
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false });
  const [thrown, setThrown] = useState<SwipeDirection | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const spot = cards[index];
  const answer = answers.length > index ? answers[index] : null;
  const facingBet = isFacingBet(spot);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const choose = useCallback(
    (action: DrillAction) => {
      if (answer) return;
      const grade = gradeAction(spot, action);
      haptic(grade.verdict);
      onAnswer({ spot, chosen: action, grade });
      setPickingSize(false);
      setThrown(null);
      setDrag({ x: 0, y: 0, active: false });
    },
    [spot, answer, onAnswer],
  );

  /** `animate` is for finger swipes: fly the card off first, then grade. */
  const swipe = useCallback(
    (direction: SwipeDirection, animate = false) => {
      if (answer || thrown) return;
      const result = directionAction(spot, direction);
      if (result === null) return;
      if (result === "size") {
        setPickingSize(true);
        return;
      }
      if (!animate) {
        choose(result);
        return;
      }
      setThrown(direction);
      timer.current = window.setTimeout(() => choose(result), THROW_MS);
    },
    [spot, answer, thrown, choose],
  );

  const next = useCallback(() => {
    if (index >= cards.length - 1) {
      onFinish(answers);
      return;
    }
    setPickingSize(false);
    setIndex((i) => i + 1);
  }, [index, cards.length, answers, onFinish]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") swipe("left");
      else if (e.key === "ArrowRight") swipe("right");
      else if (e.key === "ArrowUp") swipe("up");
      else if ((e.key === "Enter" || e.key === " ") && answer) next();
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [swipe, next, answer]);

  function onPointerDown(e: React.PointerEvent) {
    if (answer || pickingSize || thrown) return;
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
      swipe(x < 0 ? "left" : "right", true);
    } else if (y <= -SWIPE_DISTANCE && Math.abs(y) > Math.abs(x)) {
      swipe("up", true);
    }
  }

  const leftAction = directionAction(spot, "left");
  const rightAction = directionAction(spot, "right");
  const upAction = directionAction(spot, "up");
  const aggressive = spot.actions.filter((a) => AGGRESSIVE.has(a));

  const labelFor = (a: DrillAction | "size" | null, fallback: string) =>
    a === null ? "" : a === "size" ? fallback : actionLabel(a, facingBet);
  const leftLabel = labelFor(leftAction, "");
  const rightLabel = labelFor(rightAction, "");
  const upLabel = labelFor(upAction, facingBet ? "Raise" : "Bet");

  // 0..1 how far the drag has pulled toward each zone, so its label can
  // brighten and the card can tint toward it.
  const pull = (distance: number) => Math.max(0, Math.min(1, distance / SWIPE_DISTANCE));
  const horizontal = Math.abs(drag.x) > Math.abs(drag.y);
  const pulls = {
    left: horizontal && leftAction ? pull(-drag.x) : 0,
    right: horizontal && rightAction ? pull(drag.x) : 0,
    up: !horizontal && upAction ? pull(-drag.y) : 0,
  };

  let transform = `translate(${drag.x}px, ${Math.min(0, drag.y)}px) rotate(${drag.x / 18}deg)`;
  if (thrown === "left") transform = "translate(-130vw, 0) rotate(-24deg)";
  if (thrown === "right") transform = "translate(130vw, 0) rotate(24deg)";
  if (thrown === "up") transform = "translate(0, -130vh)";

  if (answer) {
    return <Feedback key={`fb-${index}`} answer={answer} last={index === cards.length - 1} onNext={next} />;
  }

  return (
    <>
      <main className="play" key={`card-${index}`}>
        <SeatBadge spot={spot} />
        <Chips spot={spot} />

        <div className="zones" aria-hidden="true">
          <span className="zone zone--left" style={{ opacity: 0.35 + 0.65 * pulls.left }}>
            ← {leftLabel}
          </span>
          <span className="zone zone--up" style={{ opacity: 0.35 + 0.65 * pulls.up }}>
            ↑ {upLabel}
          </span>
          <span className="zone zone--right" style={{ opacity: 0.35 + 0.65 * pulls.right }}>
            {rightLabel && `${rightLabel} →`}
          </span>
        </div>

        <div
          className={`card${drag.active ? " is-dragging" : ""}${thrown ? " is-thrown" : ""}`}
          style={{
            transform,
            ["--tint" as string]: Math.max(pulls.left, pulls.right, pulls.up),
          }}
          data-pull={
            pulls.up > 0 ? "up" : pulls.left > 0 ? "left" : pulls.right > 0 ? "right" : undefined
          }
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          data-testid="drill-card"
        >
          <div className="card__label">Board</div>
          <div className="card__row">
            {spot.board.map((c) => (
              <PlayingCard key={c} card={c} />
            ))}
          </div>
          <div className="card__label">Your hand</div>
          <div className="card__row card__row--hand">
            {spot.hand.map((c) => (
              <PlayingCard key={c} card={c} size="xl" />
            ))}
          </div>
        </div>
      </main>

      <footer className="controls">
        {pickingSize ? (
          <>
            <p className="controls__prompt">{facingBet ? "Raise size" : "Bet size"}</p>
            <div className="controls__row">
              {aggressive.map((a) => (
                <button key={a} type="button" className="btn btn--bet" onClick={() => choose(a)}>
                  {actionLabel(a, facingBet)}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn--ghost" onClick={() => setPickingSize(false)}>
              Back
            </button>
          </>
        ) : (
          <div className="controls__row">
            <button type="button" className="btn" disabled={!leftAction} onClick={() => swipe("left")}>
              ← {leftLabel}
            </button>
            <button type="button" className="btn btn--bet" disabled={!upAction} onClick={() => swipe("up")}>
              ↑ {facingBet ? "Raise" : "Bet"}
            </button>
            <button type="button" className="btn" disabled={!rightAction} onClick={() => swipe("right")}>
              {rightAction ? `${rightLabel} →` : "—"}
            </button>
          </div>
        )}
      </footer>
    </>
  );
}

const VERDICT = {
  best: { title: "Best move", sub: "The solver plays this often with your hand." },
  good: { title: "Acceptable", sub: "The solver mixes this in sometimes." },
  miss: { title: "Miss", sub: "The solver almost never does this here." },
};

function Feedback({
  answer,
  last,
  onNext,
}: {
  answer: Answer;
  last: boolean;
  onNext: () => void;
}) {
  const { spot, chosen, grade } = answer;
  const facingBet = isFacingBet(spot);
  const rows = spot.actions
    .map((a) => ({ action: a, p: spot.mix[a] ?? 0 }))
    .filter((r) => r.p >= 0.005 || r.action === chosen)
    .sort((a, b) => b.p - a.p);
  return (
    <>
      <main className="play">
        <div className={`verdict verdict--${grade.verdict}`} role="status">
          <span className="verdict__title">{VERDICT[grade.verdict].title}</span>
          <span className="verdict__points">
            {grade.points > 0 ? `+${grade.points}` : "+0"}
          </span>
        </div>
        <p className="verdict__sub">
          You chose <strong>{actionLabel(chosen, facingBet)}</strong>, which the solver plays{" "}
          {pct(grade.frequency)} of the time with this hand. {VERDICT[grade.verdict].sub}
        </p>

        <div className="recap">
          <div className="card__row">
            {spot.board.map((c) => (
              <PlayingCard key={c} card={c} />
            ))}
          </div>
          <div className="card__row">
            {spot.hand.map((c) => (
              <PlayingCard key={c} card={c} size="lg" />
            ))}
          </div>
        </div>

        <ul className="mix">
          {rows.map((r) => (
            <li
              key={r.action}
              className={`mix__row${r.action === chosen ? " is-chosen" : ""}${r.action === grade.topAction ? " is-top" : ""}`}
            >
              <span className="mix__name">{actionLabel(r.action, facingBet)}</span>
              <span className="mix__bar">
                <span data-kind={r.action} style={{ width: `${Math.round(r.p * 100)}%` }} />
              </span>
              <span className="mix__pct">{pct(r.p)}</span>
            </li>
          ))}
        </ul>
        <p className="mix__legend">Your pick is bold. The solver's favorite has a ★.</p>
      </main>
      <footer className="controls">
        <button type="button" className="game__primary" onClick={onNext} autoFocus>
          {last ? "See results" : "Next hand"}
        </button>
      </footer>
    </>
  );
}

function Summary({
  answers,
  best,
  onAgain,
}: {
  answers: Answer[];
  best: number | null;
  onAgain: () => void;
}) {
  const score = answers.reduce((s, a) => s + a.grade.points, 0);
  const missed = answers.filter((a) => a.grade.verdict === "miss");
  const bestMoves = answers.filter((a) => a.grade.verdict === "best").length;
  return (
    <>
      <main className="play">
        <div className="summary__score">
          <span className="summary__big">{score}</span>
          <span className="summary__of">/ {answers.length}</span>
        </div>
        <p className="verdict__sub">
          {bestMoves} best moves.
          {missed.length === 0 ? " No misses." : ` ${missed.length} missed.`}
          {best !== null && score >= best ? " That's your best score." : ""}
        </p>
        {missed.length > 0 && (
          <>
            <h2 className="summary__heading">Worth another look</h2>
            <ul className="missed">
              {missed.map((a) => (
                <li key={a.spot.id}>
                  <span className="card__row">
                    {a.spot.hand.map((c) => (
                      <PlayingCard key={c} card={c} />
                    ))}
                  </span>
                  <span>
                    {a.spot.heroPosition} on {a.spot.board.join(" ")}: you chose{" "}
                    <strong>{actionLabel(a.chosen, isFacingBet(a.spot))}</strong>; the solver
                    prefers <strong>{actionLabel(a.grade.topAction, isFacingBet(a.spot))}</strong> (
                    {pct(a.spot.mix[a.grade.topAction] ?? 0)}).
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
      <footer className="controls">
        <button type="button" className="game__primary" onClick={onAgain} autoFocus>
          Play again
        </button>
        <Link to="/" className="btn btn--ghost">
          Back to the app
        </Link>
      </footer>
    </>
  );
}
