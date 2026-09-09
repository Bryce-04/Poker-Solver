import { useState } from "react";
import type { FormEvent } from "react";
import type { BettingAction, Position, Spot } from "@poker-solver/schema";
import { POSITIONS } from "../../lib/positions";
import {
  fetchReferenceStrategy,
  type ReferenceStrategyResponse,
  type SpotValidationIssue,
} from "../../lib/api";
import { RangeGrid } from "../RangeGrid/RangeGrid";
import "./SpotBuilder.css";

/**
 * The button/dropdown spot builder -- Stage 2's other headline deliverable
 * alongside the range grid. See docs/plan.md.
 *
 * Position + effective stack + a "situation" choice assemble a Spot
 * client-side; it's POSTed to apps/api's /spots/reference-strategy and the
 * matched range is shown read-only via RangeGrid. Every outcome the
 * endpoint can produce (match / 404 no-match / 422 invalid / unreachable)
 * gets its own message.
 *
 * Stage 2's reference charts only answer two shapes, so the UI only offers
 * those: an unopened pot (open charts), or hero facing a single preflop
 * raise from one other seat (defend charts). Arbitrary action sequences
 * wait for Stage 5's live solver -- see apps/api/app/reference_charts.py.
 *
 * Not here: board card picker (out of scope until Stage 5). Visual polish
 * is a separate shared ticket; this file is functional baseline styling.
 */

type Situation = "unopened" | "vs-raise";

// UI state machine: the api result tags plus idle/loading.
type Outcome =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "match"; data: ReferenceStrategyResponse }
  | { kind: "no-match" }
  | { kind: "invalid"; issues: SpotValidationIssue[] }
  | { kind: "network-error" }
  | { kind: "error"; status: number };

export function SpotBuilder() {
  // "BTN" + "unopened" is a supported spot, so a first submit is a 200.
  const [position, setPosition] = useState<Position>("BTN");
  const [effectiveStackBb, setEffectiveStackBb] = useState(100);
  const [situation, setSituation] = useState<Situation>("unopened");
  const [raiser, setRaiser] = useState<Position>("CO");
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });

  const stackIsValid = Number.isFinite(effectiveStackBb) && effectiveStackBb > 0;

  function buildSpot(): Spot {
    // Stage 2 charts key off position + one optional preflop raise. Raise
    // size doesn't affect the match, so the UI doesn't ask for it.
    const actions: BettingAction[] =
      situation === "vs-raise"
        ? [{ position: raiser, street: "preflop", action: "raise" }]
        : [];

    return {
      positions_in_hand: [position],
      effective_stack_bb: effectiveStackBb,
      current_street: "preflop",
      actions,
    };
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!stackIsValid) return;
    setOutcome({ kind: "loading" });

    const result = await fetchReferenceStrategy(buildSpot());
    switch (result.kind) {
      case "match":
        setOutcome({ kind: "match", data: result.data });
        return;
      case "no-match":
        setOutcome({ kind: "no-match" });
        return;
      case "invalid":
        setOutcome({ kind: "invalid", issues: result.issues });
        return;
      case "network-error":
        setOutcome({ kind: "network-error" });
        return;
      case "error":
        setOutcome({ kind: "error", status: result.status });
        return;
    }
  }

  return (
    <div className="spot-builder">
      <form className="spot-builder__form" onSubmit={handleSubmit}>
        <section className="spot-builder__section">
          <h2 className="spot-builder__legend">Spot</h2>

          <label className="spot-builder__field">
            Your position
            <select
              value={position}
              onChange={(e) => setPosition(e.target.value as Position)}
            >
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
          {!stackIsValid && (
            <p className="spot-builder__field-error">
              Enter a stack size greater than 0.
            </p>
          )}
          <p className="spot-builder__hint">
            Reference charts currently cover ~40bb and ~100bb, preflop only.
          </p>
        </section>

        <section className="spot-builder__section">
          <h2 className="spot-builder__legend">Situation</h2>

          <label className="spot-builder__field spot-builder__field--radio">
            <input
              type="radio"
              name="situation"
              checked={situation === "unopened"}
              onChange={() => setSituation("unopened")}
            />
            First to act &mdash; unopened pot (opening range)
          </label>

          <label className="spot-builder__field spot-builder__field--radio">
            <input
              type="radio"
              name="situation"
              checked={situation === "vs-raise"}
              onChange={() => setSituation("vs-raise")}
            />
            Facing a single raise (defending range)
          </label>

          {situation === "vs-raise" && (
            <label className="spot-builder__field">
              Raise came from
              <select
                value={raiser}
                onChange={(e) => setRaiser(e.target.value as Position)}
              >
                {POSITIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>

        <button type="submit" disabled={outcome.kind === "loading" || !stackIsValid}>
          Get reference strategy
        </button>
      </form>

      <div className="spot-builder__status" role="status" aria-live="polite">
        {outcome.kind === "idle" && (
          <p>Build a spot and submit to see its reference range.</p>
        )}
        {outcome.kind === "loading" && <p>Loading reference strategy&hellip;</p>}

        {outcome.kind === "no-match" && (
          <div className="spot-builder__status-block spot-builder__status-block--info">
            <p className="spot-builder__status-title">
              No reference chart for this spot yet.
            </p>
            <p>The built-in reference charts (6-max) currently cover:</p>
            <ul>
              <li>Opening ranges (unopened pot): UTG, HJ, CO, BTN, SB.</li>
              <li>
                Defending a single raise: BB vs any of UTG/HJ/CO/BTN/SB; BTN vs
                HJ or CO; SB vs CO or BTN.
              </li>
              <li>Effective stack ~40bb (30&ndash;50) or ~100bb (80&ndash;120).</li>
              <li>Preflop only &mdash; single raised pot, no 3-bet pots yet.</li>
            </ul>
          </div>
        )}

        {outcome.kind === "invalid" && (
          <div className="spot-builder__status-block spot-builder__status-block--error">
            <p className="spot-builder__status-title">Invalid spot.</p>
            <p>The server rejected the spot:</p>
            <ul className="spot-builder__issues">
              {outcome.issues.map((issue, idx) => (
                <li key={idx}>
                  <code className="spot-builder__issue-loc">
                    {issue.loc.join(" > ")}
                  </code>
                  {" — "}
                  {issue.msg}
                </li>
              ))}
              {outcome.issues.length === 0 && (
                <li>The server did not return field-level details.</li>
              )}
            </ul>
          </div>
        )}

        {outcome.kind === "network-error" && (
          <div className="spot-builder__status-block spot-builder__status-block--error">
            <p className="spot-builder__status-title">Couldn&rsquo;t reach the API.</p>
            <p>
              Is <code>apps/api</code> running? Start it with{" "}
              <code>cd apps/api &amp;&amp; uvicorn app.main:app --reload</code>.
            </p>
          </div>
        )}

        {outcome.kind === "error" && (
          <div className="spot-builder__status-block spot-builder__status-block--error">
            <p className="spot-builder__status-title">Unexpected API response.</p>
            <p>The request failed with HTTP {outcome.status}.</p>
          </div>
        )}
      </div>

      {outcome.kind === "match" && (
        <div className="spot-builder__result">
          <p className="spot-builder__source-label">
            Reference chart (not a live solve): {outcome.data.chart_description}
          </p>
          <RangeGrid
            value={Object.values(outcome.data.ranges)[0] ?? {}}
            onChange={() => {}}
            readOnly
          />
        </div>
      )}
    </div>
  );
}
