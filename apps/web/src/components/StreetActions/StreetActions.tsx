import { useState } from "react";
import type { Street } from "@poker-solver/schema";
import { computeStreetState } from "../../lib/handBuilder";
import type { BuilderAction, StreetContext } from "../../lib/handBuilder";
import "../SpotBuilder/SpotBuilder.css";
import "./StreetActions.css";

const VERB: Record<BuilderAction["action"], (a: BuilderAction) => string> = {
  fold: () => "folds",
  check: () => "checks",
  call: () => "calls",
  bet: (a) => `bets to ${a.toBb}bb`,
  raise: (a) => `raises to ${a.toBb}bb`,
  all_in: () => "goes all-in",
};

export interface StreetActionsProps {
  street: Street;
  ctx: StreetContext;
  actions: BuilderAction[];
  onChange: (next: BuilderAction[]) => void;
  /** The whole hand already ended on an earlier street (a fold) or an
   * earlier street hasn't closed yet -- this street can't be built. */
  disabled?: boolean;
}

/**
 * One street's action log plus controls to add the next action -- real
 * actions with real bb sizes (not the solver's fixed bet-size menu;
 * apps/api/app/solve.py buckets an arbitrary size onto that at solve time,
 * see docs/decisions.md's 2026-10-07 entry), so this doubles as "what
 * actually happened" bookkeeping for pot_bb/effective_stack_bb regardless
 * of whether this particular street ends up being the one that's solved.
 */
export function StreetActions({ street, ctx, actions, onChange, disabled }: StreetActionsProps) {
  const [sizeInput, setSizeInput] = useState(() => String(Math.round(ctx.potBeforeBb) || 1));
  const state = computeStreetState(ctx, actions);

  function add(action: BuilderAction["action"], toBb?: number) {
    onChange([...actions, { position: state.toAct, action, toBb }]);
  }

  function undo() {
    onChange(actions.slice(0, -1));
  }

  const streetLabel = street.charAt(0).toUpperCase() + street.slice(1);

  return (
    <div className="street-actions">
      {actions.length > 0 && (
        <ol className="street-actions__log">
          {actions.map((a, i) => (
            <li key={i} className="street-actions__log-item">
              {a.position} {VERB[a.action](a)}
            </li>
          ))}
        </ol>
      )}

      {disabled ? null : state.folded ? (
        <p className="street-actions__status">
          {state.folded} folds -- the hand ends here on the {street}.
        </p>
      ) : state.isTerminal ? (
        <p className="street-actions__status">
          {streetLabel} action is closed. {actions.length > 0 && (
            <button type="button" className="spot-builder__reset" onClick={undo}>
              Undo last action
            </button>
          )}
        </p>
      ) : (
        <div className="street-actions__controls">
          <p className="street-actions__hint">
            Pot: {state.potNowBb.toLocaleString()}bb &middot; {state.toAct} to act
            {state.facingBet && <> &middot; facing {state.toCallBb.toLocaleString()}bb</>}
          </p>
          <div className="street-actions__buttons">
            {state.facingBet ? (
              <>
                <button type="button" className="spot-builder__reset" onClick={() => add("fold")}>
                  Fold
                </button>
                <button type="button" className="spot-builder__reset" onClick={() => add("call")}>
                  Call {state.toCallBb.toLocaleString()}bb
                </button>
              </>
            ) : (
              <button type="button" className="spot-builder__reset" onClick={() => add("check")}>
                Check
              </button>
            )}
            <label className="street-actions__size-field">
              to (bb)
              <input
                type="number"
                min={0}
                step="any"
                value={sizeInput}
                onChange={(e) => setSizeInput(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="spot-builder__reset"
              onClick={() => add(state.aggressiveLabel, Number(sizeInput))}
              disabled={!Number.isFinite(Number(sizeInput)) || Number(sizeInput) <= 0}
            >
              {state.aggressiveLabel === "bet" ? "Bet" : "Raise"}
            </button>
            <button type="button" className="spot-builder__reset" onClick={() => add("all_in")}>
              All-in
            </button>
          </div>
          {actions.length > 0 && (
            <button type="button" className="spot-builder__reset" onClick={undo}>
              Undo last action
            </button>
          )}
        </div>
      )}
    </div>
  );
}
