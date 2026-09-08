import { useState } from "react";
import type { FormEvent } from "react";
import type { Position, Spot } from "@poker-solver/schema";
import { POSITIONS } from "../../lib/positions";
import { fetchReferenceStrategy, type ReferenceStrategyResponse } from "../../lib/api";
import { RangeGrid } from "../RangeGrid/RangeGrid";
import "./SpotBuilder.css";

type Status = "idle" | "loading" | "no-match" | "error";

/**
 * The button/dropdown spot builder -- Stage 2's other headline deliverable
 * alongside the range grid. See docs/plan.md.
 *
 * STARTER SCAFFOLD -- position + stack depth, submitting to
 * apps/api's /spots/reference-strategy, and displaying the result (reusing
 * RangeGrid in read-only mode) are wired up and working end to end. The
 * following are intentionally left as TODOs:
 *
 *   - Action sequence builder (raise/call/fold + bet sizing, in order).
 *     Not wired up yet because apps/api/app/reference_charts.py only
 *     matches "no action yet" spots so far -- build this once chart
 *     entries exist for facing-a-raise spots (see that file's TODOs).
 *   - Board card picker. Same reasoning -- nothing preflop-only needs it
 *     yet; matters once postflop reference charts or Stage 5 exist.
 *   - The real visual pass (this is functional baseline styling only).
 *   - Richer error/loading states than the bare minimum here.
 */
export function SpotBuilder() {
  const [position, setPosition] = useState<Position>("UTG");
  const [effectiveStackBb, setEffectiveStackBb] = useState(100);
  const [result, setResult] = useState<ReferenceStrategyResponse | null>(null);
  const [status, setStatus] = useState<Status>("idle");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus("loading");
    setResult(null);

    // TODO: once the action sequence builder and board picker exist, fill
    // in `actions` and `board` here too. Omitted fields fall back to the
    // Spot schema's own defaults (empty board, no actions, preflop).
    const spot: Spot = {
      positions_in_hand: [position],
      effective_stack_bb: effectiveStackBb,
    };

    try {
      const response = await fetchReferenceStrategy(spot);
      if (response === null) {
        setStatus("no-match");
        return;
      }
      setResult(response);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="spot-builder">
      <form className="spot-builder__form" onSubmit={handleSubmit}>
        <label className="spot-builder__field">
          Position
          <select value={position} onChange={(e) => setPosition(e.target.value as Position)}>
            {POSITIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>

        <label className="spot-builder__field">
          Effective stack (bb)
          <input
            type="number"
            min={1}
            value={effectiveStackBb}
            onChange={(e) => setEffectiveStackBb(Number(e.target.value))}
          />
        </label>

        {/* TODO: action sequence builder (raise/call/fold + sizing) */}
        {/* TODO: board card picker */}

        <button type="submit" disabled={status === "loading"}>
          Get reference strategy
        </button>
      </form>

      {status === "no-match" && (
        <p className="spot-builder__status">No reference chart for this spot yet.</p>
      )}
      {status === "error" && (
        <p className="spot-builder__status spot-builder__status--error">
          Couldn't reach the API -- is apps/api running? (uvicorn app.main:app --reload)
        </p>
      )}

      {result && (
        <div className="spot-builder__result">
          <p className="spot-builder__source-label">
            Reference chart (not a live solve): {result.chart_description}
          </p>
          <RangeGrid value={result.ranges[position] ?? {}} onChange={() => {}} readOnly />
        </div>
      )}
    </div>
  );
}
