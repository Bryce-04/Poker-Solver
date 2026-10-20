import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ErrorBoundary } from "../components/ErrorBoundary/ErrorBoundary";
import { PlayingCard } from "../components/PlayingCard/PlayingCard";
import deckFile from "../data/drill-deck.json";
import {
  actionParts,
  actionText,
  aggressiveActions,
  betAmount,
  formatBb,
  gradeAction,
  isFacingBet,
  passiveActions,
  shuffled,
  type BetDisplay,
  type DrillAction,
  type DrillDeckFile,
  type DrillSpot,
  type Grade,
} from "../lib/drill";
import {
  DRILL_THEMES,
  readTheme,
  themeById,
  writeTheme,
  type DrillThemeId,
} from "../lib/drillTheme";
import { readBetDisplay, writeBetDisplay } from "../lib/drillSettings";
import { haptic } from "../lib/haptics";
import "./DrillPage.css";

const DECK_FILE = deckFile as unknown as DrillDeckFile;
const DECK = DECK_FILE.decks[0];
const SESSION_LENGTH = 15;
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

/** The one-glance line on what's happening: who owes what. */
function situationChip(spot: DrillSpot): { text: string; tone: "facing" | "free" } {
  if (spot.situation === "first_to_act") return { text: "Your action first", tone: "free" };
  if (spot.situation === "facing_check") {
    return { text: `${spot.villainPosition} checked to you`, tone: "free" };
  }
  return {
    text: `${spot.villainPosition} bets ${formatBb(betAmount(spot))}bb`,
    tone: "facing",
  };
}

function seatLine(spot: DrillSpot): string {
  return spot.situation === "first_to_act" ? "Out of position" : "In position";
}

/** The seat badge: who you are, the thing most worth noticing on the screen. */
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

export function DrillPage() {
  const [theme, setTheme] = useState<DrillThemeId>(readTheme);
  const [betDisplay, setBetDisplay] = useState<BetDisplay>(readBetDisplay);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Tint the browser / status bar to match the table while the drill is open.
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const previous = meta?.content;
    if (meta) meta.content = themeById(theme).chrome;
    return () => {
      if (meta && previous !== undefined) meta.content = previous;
    };
  }, [theme]);

  return (
    <div className="game" data-theme={theme}>
      <ErrorBoundary>
        <Game betDisplay={betDisplay} onSettings={() => setSettingsOpen(true)} />
        {settingsOpen && (
          <Settings
            theme={theme}
            betDisplay={betDisplay}
            onTheme={(id) => {
              setTheme(id);
              writeTheme(id);
            }}
            onBetDisplay={(mode) => {
              setBetDisplay(mode);
              writeBetDisplay(mode);
            }}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </ErrorBoundary>
    </div>
  );
}

function Settings({
  theme,
  betDisplay,
  onTheme,
  onBetDisplay,
  onClose,
}: {
  theme: DrillThemeId;
  betDisplay: BetDisplay;
  onTheme: (id: DrillThemeId) => void;
  onBetDisplay: (mode: BetDisplay) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sheet__backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet__header">
          <h2 id="settings-title" className="sheet__title">
            Settings
          </h2>
          <button type="button" className="sheet__done" onClick={onClose} autoFocus>
            Done
          </button>
        </div>

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

        <fieldset className="segmented">
          <legend>Show bet sizes as</legend>
          <div className="segmented__row">
            <label className="segmented__option">
              <input
                type="radio"
                name="drill-bet-display"
                value="bb"
                checked={betDisplay === "bb"}
                onChange={() => onBetDisplay("bb")}
              />
              <span>
                <strong>4.1bb</strong>
                <small>75% pot</small>
              </span>
            </label>
            <label className="segmented__option">
              <input
                type="radio"
                name="drill-bet-display"
                value="pct"
                checked={betDisplay === "pct"}
                onChange={() => onBetDisplay("pct")}
              />
              <span>
                <strong>75%</strong>
                <small>4.1bb</small>
              </span>
            </label>
          </div>
        </fieldset>
      </div>
    </div>
  );
}

type Phase = "start" | "playing" | "done";

function Game({
  betDisplay,
  onSettings,
}: {
  betDisplay: BetDisplay;
  onSettings: () => void;
}) {
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
          <span className="game__title">Poker Drill</span>
        )}
        <button
          type="button"
          className="game__cog"
          aria-label="Settings"
          onClick={onSettings}
        >
          <CogIcon />
        </button>
      </header>

      {phase === "start" && <Start best={best} onPlay={play} />}
      {phase === "playing" && (
        <Playing
          key={round}
          cards={cards}
          betDisplay={betDisplay}
          onAnswer={(a) => setAnswers((prev) => [...prev, a])}
          onFinish={finish}
          answers={answers}
        />
      )}
      {phase === "done" && (
        <Summary answers={answers} best={best} betDisplay={betDisplay} onAgain={play} />
      )}
    </>
  );
}

function CogIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 14.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01A1.7 1.7 0 0 0 10.2 3.1V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03z" />
    </svg>
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

function Start({ best, onPlay }: { best: number | null; onPlay: () => void }) {
  return (
    <main className="start">
      <h1 className="start__title">Poker Drill</h1>
      <p className="start__deck">{DECK.name}</p>
      <p className="start__desc">{DECK.description}</p>
      <ul className="start__how">
        <li>See the table and your hand.</li>
        <li>Pick your action.</li>
        <li>Get scored against the solver's strategy for those exact cards.</li>
      </ul>
      <p className="start__note">
        {SESSION_LENGTH} hands. Change the table color in settings (top right).
      </p>
      {best !== null && <p className="start__best">Best score: {best} / {SESSION_LENGTH}</p>}
      <button type="button" className="game__primary" onClick={onPlay} autoFocus>
        Play
      </button>
    </main>
  );
}

/** The table: pot in the middle, the board, then your hand. */
function Table({ spot }: { spot: DrillSpot }) {
  const facing = betAmount(spot);
  return (
    <div className="table" data-testid="drill-table">
      <div className="pot">
        <span className="pot__label">Pot</span>
        <span className="pot__value">{formatBb(spot.potBb)}bb</span>
        {facing > 0 && <span className="pot__bet">+ {formatBb(facing)}bb bet</span>}
      </div>
      <div className="table__label">Board</div>
      <div className="card__row">
        {spot.board.map((c) => (
          <PlayingCard key={c} card={c} />
        ))}
      </div>
      <div className="table__label">Your hand</div>
      <div className="card__row card__row--hand">
        {spot.hand.map((c) => (
          <PlayingCard key={c} card={c} size="xl" />
        ))}
      </div>
    </div>
  );
}

function Playing({
  cards,
  answers,
  betDisplay,
  onAnswer,
  onFinish,
}: {
  cards: DrillSpot[];
  answers: Answer[];
  betDisplay: BetDisplay;
  onAnswer: (a: Answer) => void;
  onFinish: (all: Answer[]) => void;
}) {
  const [index, setIndex] = useState(0);

  const spot = cards[index];
  const answer = answers.length > index ? answers[index] : null;

  const choose = useCallback(
    (action: DrillAction) => {
      if (answer) return;
      const grade = gradeAction(spot, action);
      haptic(grade.verdict);
      onAnswer({ spot, chosen: action, grade });
    },
    [spot, answer, onAnswer],
  );

  const next = useCallback(() => {
    if (index >= cards.length - 1) {
      onFinish(answers);
      return;
    }
    setIndex((i) => i + 1);
  }, [index, cards.length, answers, onFinish]);

  // Enter / Space moves on once an answer is showing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.key === "Enter" || e.key === " ") && answer) {
        e.preventDefault();
        next();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, answer]);

  if (answer) {
    return (
      <Feedback
        key={`fb-${index}`}
        answer={answer}
        betDisplay={betDisplay}
        last={index === cards.length - 1}
        onNext={next}
      />
    );
  }

  const facingBet = isFacingBet(spot);
  const chip = situationChip(spot);
  const passive = passiveActions(spot);
  const aggressive = aggressiveActions(spot);

  return (
    <>
      <main className="play" key={`card-${index}`}>
        <SeatBadge spot={spot} />
        <div className="chips">
          <span className={`chip chip--${chip.tone}`}>{chip.text}</span>
          <span className="chip">{formatBb(spot.stackBb)}bb deep</span>
        </div>
        <Table spot={spot} />
      </main>

      <footer className="controls">
        <div className="controls__row">
          {passive.map((a) => (
            <ActionButton key={a} spot={spot} action={a} mode={betDisplay} onChoose={choose} />
          ))}
        </div>
        {aggressive.length > 0 && (
          <>
            <p className="controls__prompt">{facingBet ? "Raise to" : "Bet"}</p>
            <div className="controls__row controls__row--sizes">
              {aggressive.map((a) => (
                <ActionButton key={a} spot={spot} action={a} mode={betDisplay} onChoose={choose} bet />
              ))}
            </div>
          </>
        )}
      </footer>
    </>
  );
}

function ActionButton({
  spot,
  action,
  mode,
  onChoose,
  bet = false,
}: {
  spot: DrillSpot;
  action: DrillAction;
  mode: BetDisplay;
  onChoose: (a: DrillAction) => void;
  bet?: boolean;
}) {
  const { main, sub } = actionParts(spot, action, mode);
  return (
    <button
      type="button"
      className={`btn${bet ? " btn--bet" : ""}`}
      onClick={() => onChoose(action)}
    >
      <span className="btn__main">{main}</span>
      {sub && <span className="btn__sub">{sub}</span>}
    </button>
  );
}

const VERDICT = {
  best: { title: "Best move", sub: "The solver plays this often with your hand." },
  good: { title: "Acceptable", sub: "The solver mixes this in sometimes." },
  miss: { title: "Miss", sub: "The solver almost never does this here." },
};

function Feedback({
  answer,
  betDisplay,
  last,
  onNext,
}: {
  answer: Answer;
  betDisplay: BetDisplay;
  last: boolean;
  onNext: () => void;
}) {
  const { spot, chosen, grade } = answer;
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
          You chose <strong>{actionText(spot, chosen, betDisplay)}</strong>, which the solver plays{" "}
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
              <span className="mix__name">{actionText(spot, r.action, betDisplay)}</span>
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
  betDisplay,
  onAgain,
}: {
  answers: Answer[];
  best: number | null;
  betDisplay: BetDisplay;
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
                    <strong>{actionText(a.spot, a.chosen, betDisplay)}</strong>; the solver prefers{" "}
                    <strong>{actionText(a.spot, a.grade.topAction, betDisplay)}</strong> (
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
