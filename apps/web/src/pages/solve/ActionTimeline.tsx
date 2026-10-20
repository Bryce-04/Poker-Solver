import { useState } from "react";
import type { BuilderAction } from "../../lib/handBuilder";
import type { SolveSetup } from "./useSolveSetup";
import { bb, describeAction, runningPots, streetBlocks, type StreetBlock } from "./solveText";

const STREET_NAME = { preflop: "Preflop", flop: "Flop", turn: "Turn", river: "River" } as const;

/**
 * The hand so far as a compact timeline (docs/desktop-redesign.md §6.1): one
 * block per street with each action and the pot after it, and the live
 * street's block -- tinted -- saying who's to act and offering the legal
 * actions. A restyle of StreetActions over the same lib/handBuilder
 * bookkeeping, not new logic.
 */
export function ActionTimeline({ setup }: { setup: SolveSetup }) {
  const { oopPosition, ipPosition, startingStackBb, streets, handSummary, boardLength } = setup;
  const blocks = streetBlocks(oopPosition, ipPosition, startingStackBb, streets, handSummary.targetStreet);
  const current = blocks[blocks.length - 1];

  return (
    <div className="action-timeline">
      <ol className="action-timeline__blocks">
        {blocks.map((block) =>
          block === current ? (
            <CurrentStreet key={block.street} block={block} setup={setup} />
          ) : (
            <li key={block.street} className="action-timeline__block">
              <span className="section-label">{STREET_NAME[block.street]}</span>
              <ActionRows block={block} />
            </li>
          ),
        )}
      </ol>
      {handSummary.blockedReason && boardLength >= 3 && (
        <p className="spot-builder__field-error">{handSummary.blockedReason}</p>
      )}
      {setup.hasActions && (
        <button type="button" className="btn-ghost action-timeline__undo" onClick={setup.goBack}>
          &larr; Undo last action
        </button>
      )}
    </div>
  );
}

function ActionRows({ block }: { block: StreetBlock }) {
  const pots = runningPots(block);
  return (
    <>
      {block.actions.map((action, i) => (
        <span key={i} className="action-timeline__row">
          <span>{describeAction(action)}</span>
          <span className="action-timeline__pot tabular-nums">pot {bb(pots[i])}</span>
        </span>
      ))}
    </>
  );
}

function CurrentStreet({ block, setup }: { block: StreetBlock; setup: SolveSetup }) {
  const { state, street } = block;
  const [sizing, setSizing] = useState(false);
  const stack = Math.min(...Object.values(state.remainingBb));
  const other = state.toAct === setup.oopPosition ? setup.ipPosition : setup.oopPosition;
  const isSolveTarget = street !== "preflop" && setup.boardLength >= 3;

  function add(action: BuilderAction) {
    setup.setStreetActions(street, [...block.actions, action]);
    setSizing(false);
  }

  let status: string;
  if (state.folded) status = `${state.folded} folded: the hand ends here.`;
  else if (state.isTerminal)
    status =
      street === "preflop"
        ? "Preflop is done. Pick the flop below to go on."
        : street === "river"
          ? "The river's action is closed: there's no decision left to solve."
          : `The ${street}'s action is closed. Add the next card to the board to go on.`;
  else if (isSolveTarget)
    status = `This is the decision the solver will work out. Add an action first if you want to solve ${other}'s reply instead.`;
  else status = "Enter what happened before the flop: the blinds are already in.";

  const live = !state.isTerminal && !state.folded;

  return (
    <li className="action-timeline__block action-timeline__block--current">
      <span className="action-timeline__current-head">
        <span className="section-label action-timeline__current-label">
          {STREET_NAME[street]}
          {live && ` · ${state.toAct} to act`}
        </span>
        <span className="action-timeline__current-meta tabular-nums">
          Pot {bb(state.potNowBb)} · Stacks {bb(stack)}
        </span>
      </span>
      {block.actions.length > 0 && <ActionRows block={block} />}
      <span className="action-timeline__status">{status}</span>
      {live && !sizing && (
        <span className="action-timeline__buttons">
          {state.facingBet ? (
            <>
              <button type="button" className="btn-secondary" onClick={() => add({ position: state.toAct, action: "fold" })}>
                {state.toAct} folds
              </button>
              <button type="button" className="btn-secondary" onClick={() => add({ position: state.toAct, action: "call" })}>
                {state.toAct} calls {bb(state.toCallBb)}
              </button>
            </>
          ) : (
            <button type="button" className="btn-secondary" onClick={() => add({ position: state.toAct, action: "check" })}>
              {state.toAct} checks
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={() => setSizing(true)}>
            {state.toAct} {state.aggressiveLabel === "bet" ? "bets" : "raises"}&hellip;
          </button>
        </span>
      )}
      {live && sizing && (
        <SizePicker
          block={block}
          onAdd={(toBb) => add({ position: state.toAct, action: state.aggressiveLabel, toBb })}
          onAllIn={() => add({ position: state.toAct, action: "all_in" })}
          onCancel={() => setSizing(false)}
        />
      )}
    </li>
  );
}

/** Choose a bet or raise size: in bb, with the solver's own menu (25 / 75 /
 * 125% of the pot) as one-click presets after the flop. Any size works; the
 * solver maps it onto that menu at solve time and says so. */
function SizePicker({
  block,
  onAdd,
  onAllIn,
  onCancel,
}: {
  block: StreetBlock;
  onAdd: (toBb: number) => void;
  onAllIn: () => void;
  onCancel: () => void;
}) {
  const { state, street } = block;
  const contributed = block.ctx.stackBeforeBb - state.remainingBb[state.toAct];
  const highest = contributed + state.toCallBb;
  const verb = state.aggressiveLabel === "bet" ? "Bet" : "Raise to";
  const presets =
    street === "preflop"
      ? highest <= 1
        ? [2.5, 3]
        : [Math.round(highest * 3 * 2) / 2]
      : [0.25, 0.75, 1.25].map((f) => Math.round((highest + f * (state.potNowBb + state.toCallBb)) * 10) / 10);
  const [size, setSize] = useState(String(presets[0]));
  const value = Number(size);
  const valid = Number.isFinite(value) && value > highest;

  return (
    <span className="action-timeline__sizing">
      <span className="action-timeline__presets">
        {presets.map((p, i) => (
          <button key={p} type="button" className="btn-secondary" onClick={() => onAdd(p)}>
            {street === "preflop" ? bb(p) : `${["25", "75", "125"][i]}% · ${bb(p)}`}
          </button>
        ))}
        <button type="button" className="btn-secondary" onClick={onAllIn}>
          All-in
        </button>
      </span>
      <label className="action-timeline__size-field">
        {verb} (bb)
        <input type="number" min={0} step="any" value={size} onChange={(e) => setSize(e.target.value)} />
      </label>
      <span className="action-timeline__buttons">
        <button type="button" className="btn-secondary" disabled={!valid} onClick={() => onAdd(value)}>
          Add
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </span>
    </span>
  );
}
