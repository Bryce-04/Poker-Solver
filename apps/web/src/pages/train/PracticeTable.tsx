import { useState } from "react";
import { PlayingCard } from "../../components/PlayingCard/PlayingCard";
import {
  SEATS,
  actionLabel,
  applyAction,
  dealHand,
  describeNode,
  mulberry32,
  type Action,
  type HeroNode,
  type Outcome,
  type PracticeFilter,
  type Seat,
  type TableState,
} from "../../lib/practiceTable";
import { CoachPanel } from "./CoachPanel";
import "../TrainPage.css";
import "./PracticeTable.css";

const FILTERS: Array<{ id: PracticeFilter; label: string }> = [
  { id: "all", label: "Mixed" },
  { id: "open", label: "Opening" },
  { id: "defend", label: "Defending" },
];

/** Where each seat sits, with you at the bottom and the action going clockwise. */
const SLOTS = [
  { left: 50, top: 90 },
  { left: 11, top: 70 },
  { left: 11, top: 26 },
  { left: 50, top: 8 },
  { left: 89, top: 26 },
  { left: 89, top: 70 },
];

const fmt = (n: number) => (Number.isInteger(n) ? `${n}` : n.toFixed(1));

/**
 * The 6-max practice table (docs/decisions.md): a hand is dealt, the bots in
 * front of you act from the reference charts, you choose, the bots answer from
 * the same charts, and each decision of yours is graded against them. It stops
 * where the charts run out (see lib/practiceTable.ts), so this practices the
 * preflop lessons; it is not a solver and it says so.
 */
export function PracticeTable({
  filter,
  onFilter,
  onExit,
  seed,
}: {
  filter: PracticeFilter;
  onFilter: (f: PracticeFilter) => void;
  onExit: () => void;
  /** Fixes the deal, for tests; otherwise every visit deals differently. */
  seed?: number;
}) {
  const [rng] = useState(() => mulberry32(seed ?? Date.now() % 2147483647));
  const [state, setState] = useState(() => dealHand(rng, filter));
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [picked, setPicked] = useState<Action | null>(null);
  const [score, setScore] = useState({ right: 0, total: 0 });

  const { deal, node } = state;

  function choose(action: Action) {
    if (outcome) return;
    const result = applyAction(deal, node, action);
    setPicked(action);
    setOutcome(result);
    setScore((s) => ({ right: s.right + (result.correct ? 1 : 0), total: s.total + 1 }));
  }

  function newHand(next: PracticeFilter = filter) {
    setState(dealHand(rng, next));
    setOutcome(null);
    setPicked(null);
  }

  function keepGoing() {
    if (!outcome?.next) return;
    setState({ deal, node: outcome.next });
    setOutcome(null);
    setPicked(null);
  }

  function changeFilter(next: PracticeFilter) {
    onFilter(next);
    newHand(next);
  }

  const shown = outcome ? outcome.table : node.table;
  const hand = deal.hands[node.seat];

  return (
    <div className="train practice">
      <div className="train__bar">
        <button type="button" className="train__back" onClick={onExit}>
          ← Back
        </button>
        <span className="train__progress" aria-label="Session score">
          {score.right} of {score.total} right
        </span>
      </div>

      <div className="practice__filters" role="group" aria-label="What to practice">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className="train__chip"
            aria-pressed={filter === f.id}
            onClick={() => changeFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Felt hero={node.seat} table={shown} />

      <section className="practice__spot" aria-label="Your decision">
        <p className="train__text practice__prompt">{describeNode(node)}</p>
        <div className="train__hand" aria-label="Your hand">
          <PlayingCard card={hand[0]} size="lg" />
          <PlayingCard card={hand[1]} size="lg" />
        </div>

        {!outcome ? (
          <ul className="train__choices">
            {node.options.map((action) => (
              <li key={action}>
                <button type="button" className="train__choice" onClick={() => choose(action)}>
                  {actionLabel(node, action)}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Feedback
            node={node}
            cards={hand}
            outcome={outcome}
            picked={picked as Action}
            onNext={() => newHand()}
            onContinue={keepGoing}
          />
        )}
      </section>
    </div>
  );
}

function Felt({ hero, table }: { hero: Seat; table: TableState }) {
  const pot = SEATS.reduce((sum, seat) => sum + table.bets[seat], 0);
  return (
    <div className="pt-felt" role="group" aria-label="The table">
      <div className="pt-felt__pot" aria-label="Pot">
        <span className="pt-felt__pot-label">Pot</span>
        <span className="pt-felt__pot-amount">{fmt(pot)}bb</span>
      </div>
      {SEATS.map((seat) => {
        const offset = (SEATS.indexOf(seat) - SEATS.indexOf(hero) + SEATS.length) % SEATS.length;
        const slot = SLOTS[offset];
        const isHero = seat === hero;
        return (
          <div
            key={seat}
            className="pt-seat"
            data-hero={isHero || undefined}
            data-folded={table.folded[seat] || undefined}
            style={{ left: `${slot.left}%`, top: `${slot.top}%` }}
            aria-label={`${seat}${isHero ? ", you" : ""}${table.folded[seat] ? ", folded" : ""}`}
          >
            <span className="pt-seat__name">
              {seat}
              {seat === "BTN" && (
                <span className="pt-seat__dealer" title="Dealer button" aria-hidden="true">
                  D
                </span>
              )}
            </span>
            <span className="pt-seat__stack">{isHero ? "You" : table.folded[seat] ? "Fold" : "100bb"}</span>
            {table.bets[seat] > 0 && !table.folded[seat] && <span className="pt-seat__bet">{fmt(table.bets[seat])}bb</span>}
          </div>
        );
      })}
    </div>
  );
}

function Feedback({
  node,
  cards,
  outcome,
  picked,
  onNext,
  onContinue,
}: {
  node: HeroNode;
  cards: [string, string];
  outcome: Outcome;
  picked: Action;
  onNext: () => void;
  onContinue: () => void;
}) {
  const bestLabel = actionLabel(node, outcome.best);
  // What the bots did in answer to you: the log lines after your action.
  const after = outcome.table.log.slice(node.table.log.length);
  return (
    <div className="train__feedback" role="status">
      <p className="train__feedback-title">{outcome.correct ? "Right." : "Not quite."}</p>
      {!outcome.correct && (
        <p className="train__text">
          You chose <strong>{actionLabel(node, picked)}</strong>. The chart says <strong>{bestLabel}</strong>.
        </p>
      )}
      <p className="train__text">{outcome.explanation}</p>
      {after.length > 0 && <p className="train__hint practice__log">{after.join(" · ")}</p>}
      {outcome.summary && <p className="train__text practice__summary">{outcome.summary}</p>}

      <CoachPanel
        key={`${node.kind}-${node.hand}-${node.seat}-${node.table.log.length}`}
        context={{
          lesson_title: "Practice table (preflop)",
          prompt: describeNode(node),
          board: [],
          hand: [...cards],
          picked: actionLabel(node, picked),
          correct: bestLabel,
          explanation: outcome.explanation,
        }}
      />

      <div className="train__actions">
        {outcome.next ? (
          <button type="button" className="train__primary" onClick={onContinue} autoFocus>
            Continue: {nextLabel(outcome.next)}
          </button>
        ) : (
          <button type="button" className="train__primary" onClick={onNext} autoFocus>
            Next hand
          </button>
        )}
      </div>
    </div>
  );
}

function nextLabel(next: HeroNode): string {
  return next.kind === "vs-3bet" ? "you face a 3-bet" : "you face a 4-bet";
}
