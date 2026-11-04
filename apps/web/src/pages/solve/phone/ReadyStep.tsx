import { ActionBar } from "../../../components/mobile/ActionBar";
import { bb, describePreflop } from "../solveText";
import { SolveProblem } from "../SolveProblem";
import type { SolveSetup } from "../useSolveSetup";
import { accuracyLine, boardBlocker, handBlocker, rangePercent, rangesBlocker, solvedIn, type SolveStep } from "./phoneSteps";

const SUIT_SYMBOL: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
const SUIT_NAME: Record<string, string> = { s: "spades", h: "hearts", d: "diamonds", c: "clubs" };

type Solved = NonNullable<SolveSetup["lastSolved"]>;

/**
 * Step 4 (docs/mobile-redesign.md §4.4). Ready: a summary of the setup with an
 * Edit link per row, and the Solve button. Solving: an indeterminate bar
 * (the API reports no progress, so none is faked) and Cancel. Done: how long
 * it took and how accurate it is, then "See the result". A failed solve
 * shows desktop's wording with Try again.
 *
 * The solve itself lives in the setup hook, which stays mounted while you're
 * on another tab, so it keeps running there.
 */
export function ReadyStep({
  s,
  acknowledged,
  onGo,
  onSeeResult,
}: {
  s: SolveSetup;
  /** The result last opened; a newer one shows as Done here. */
  acknowledged: Solved | null;
  onGo: (step: SolveStep) => void;
  onSeeResult: () => void;
}) {
  const decision = s.decisionPosition;
  const street = s.currentStreet;

  if (s.outcome.kind === "loading") {
    return (
      <>
        <div className="m-status">
          <div className="m-progress" role="progressbar" aria-label="Solving">
            <span className="m-progress__bar" />
          </div>
          <h1 className="m-step__title">
            Solving {decision}&rsquo;s {street}&hellip;
          </h1>
          <p className="m-step__lede">
            It keeps refining until the strategy is within 0.5% of the pot of perfect play. You can switch tabs;
            we&rsquo;ll keep going.
          </p>
        </div>
        <ActionBar primaryLabel="Cancel" onPrimary={s.cancelSolve} variant="secondary" />
      </>
    );
  }

  if (s.outcome.kind === "solved" && s.outcome !== acknowledged) {
    return (
      <>
        <div className="m-status">
          <span className="m-status__check" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <path d="M5 12l5 5 9-10" />
            </svg>
          </span>
          <h1 className="m-step__title">{solvedIn(s.outcome.elapsedMs)}</h1>
          <p className="m-step__lede">{accuracyLine(s.outcome)}</p>
        </div>
        <ActionBar primaryLabel="See the result" onPrimary={onSeeResult} />
      </>
    );
  }

  const blocker = handBlocker(s)
    ? "Finish the hand first"
    : boardBlocker(s)
      ? "Pick the board first"
      : rangesBlocker(s)
        ? "Add both ranges first"
        : null;
  const failed = !["idle", "loading", "solved"].includes(s.outcome.kind);
  const cards = s.board.kind === "ok" ? s.board.cards : [];
  const firstAction = s.currentStreetActions.length === 0;

  return (
    <>
      <div>
        <h1 className="m-step__title">Ready to solve</h1>
        {!blocker && (
          <p className="m-step__lede">
            {decision} {firstAction ? "acts first" : "is next to act"} on the {street}, so the solver works out{" "}
            {decision}&rsquo;s best mix of plays.
          </p>
        )}
      </div>

      <dl className="m-card m-summary">
        <div className="m-summary__row">
          <div>
            <dt className="m-label">Hand</dt>
            <dd>
              {s.oopPosition} vs {s.ipPosition} ·{" "}
              {s.setupMode === "paste" ? "from a hand history" : describePreflop(s.streets.preflop) || "not entered yet"}
            </dd>
          </div>
          <button type="button" className="m-link" onClick={() => onGo("hand")} aria-label="Edit the hand">
            Edit
          </button>
        </div>
        <div className="m-summary__row">
          <div>
            <dt className="m-label">Board</dt>
            <dd className="m-summary__cards">
              {cards.length > 0
                ? cards.map((card) => (
                    <span
                      key={card}
                      className="m-mini-card"
                      data-red={card[1] === "h" || card[1] === "d" || undefined}
                      role="img"
                      aria-label={`${card[0]} of ${SUIT_NAME[card[1]]}`}
                    >
                      <span>{card[0]}</span>
                      <span>{SUIT_SYMBOL[card[1]]}</span>
                    </span>
                  ))
                : "Not picked yet"}
            </dd>
          </div>
          <button type="button" className="m-link" onClick={() => onGo("board")} aria-label="Edit the board">
            Edit
          </button>
        </div>
        <div className="m-summary__row">
          <div>
            <dt className="m-label">Pot · Stacks</dt>
            <dd>
              {bb(s.potBb)} · {bb(s.effectiveStackBb)}
            </dd>
          </div>
        </div>
        <div className="m-summary__row">
          <div>
            <dt className="m-label">Ranges</dt>
            <dd>
              {s.oopPosition} {rangePercent(s.oopRange)}% · {s.ipPosition} {rangePercent(s.ipRange)}% of hands
            </dd>
          </div>
          <button type="button" className="m-link" onClick={() => onGo("ranges")} aria-label="Edit the ranges">
            Edit
          </button>
        </div>
      </dl>

      {failed && (
        <div className="m-section m-section--tight">
          <SolveProblem outcome={s.outcome} />
          <button type="button" className="m-btn m-btn--secondary" onClick={() => void s.solve()} disabled={!s.canSubmit}>
            Try again
          </button>
        </div>
      )}

      <p className="m-note">
        Usually takes 10–90 seconds. This is a real solve, not a lookup. You can switch tabs while it runs.
      </p>

      {s.lastSolved && (
        <button type="button" className="m-link" onClick={onSeeResult}>
          See the last result
        </button>
      )}

      <ActionBar
        primaryLabel={`Solve ${decision}'s ${street}`}
        onPrimary={() => void s.solve()}
        disabledReason={blocker}
        onBack={() => onGo("ranges")}
      />
    </>
  );
}
