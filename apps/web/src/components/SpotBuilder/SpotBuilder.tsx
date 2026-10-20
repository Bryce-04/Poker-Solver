import { useState } from "react";
import type { FormEvent } from "react";
import type { Position, Spot } from "@poker-solver/schema";
import { OPENABLE_POSITIONS, SIX_MAX_POSITIONS } from "../../lib/positions";
import { buildOpenSpot, buildVsRaiseSpot } from "../../lib/spot";
import { useReferenceChart } from "../../lib/useReferenceChart";
import { RangeGrid } from "../RangeGrid/RangeGrid";
import "./SpotBuilder.css";

/**
 * The button/dropdown spot builder -- Stage 2's other headline deliverable
 * alongside the range grid. See docs/plan.md.
 *
 * Position + effective stack + a "situation" choice assemble a Spot
 * client-side; it's POSTed to apps/api's /spots/reference-strategy and the
 * matched range is shown via an editable RangeGrid -- the chart is the
 * starting point, not the final word, and "Save this spot" persists
 * whatever the grid currently shows, not the untouched chart. Every
 * outcome the endpoint can produce (match / 404 no-match / 422 invalid /
 * unreachable) gets its own message.
 *
 * Stage 2's reference charts only answer two shapes, so the UI only offers
 * those: an unopened pot (open charts), or hero facing a single preflop
 * raise from one other seat (defend charts). Arbitrary action sequences
 * wait for Stage 5's live solver -- see apps/api/app/reference_charts.py.
 *
 * Seat lists are 6-max (no UTG1/LJ -- full-ring, no chart), and the hero
 * seat drops BB in an unopened pot (BB is never first to act). Picking a
 * covered seat with no chart yet (e.g. HJ defending) still just shows the
 * endpoint's 404 message -- see docs/reference-chart-coverage.md.
 *
 * Not here: board card picker (out of scope until Stage 5).
 */

type Situation = "unopened" | "vs-raise";

export function SpotBuilder() {
  // "BTN" + "unopened" is a supported spot, so a first submit is a 200.
  const [position, setPosition] = useState<Position>("BTN");
  const [effectiveStackBb, setEffectiveStackBb] = useState(100);
  const [situation, setSituation] = useState<Situation>("unopened");
  const [raiser, setRaiser] = useState<Position>("CO");
  // Fetch, the editable copy of the chart's range, and save -- shared with
  // the other chart entry paths (lib/useReferenceChart.ts).
  const { outcome, saveState, editedRange, setEditedRange, load, save } = useReferenceChart();

  // BB is never first to act, so it's not a valid hero seat in an unopened
  // pot. The seat list narrows with the situation, and switching to
  // "unopened" while BB is selected snaps the seat back to BTN (handled in
  // selectSituation) so the form never submits a spot the schema rejects.
  const heroPositions =
    situation === "unopened" ? OPENABLE_POSITIONS : SIX_MAX_POSITIONS;

  function selectSituation(next: Situation) {
    setSituation(next);
    if (next === "unopened" && !OPENABLE_POSITIONS.includes(position)) {
      setPosition("BTN");
    }
  }

  const stackIsValid = Number.isFinite(effectiveStackBb) && effectiveStackBb > 0;

  function buildSpot(): Spot {
    // Shared with the Stage 3 text parser (lib/spot.ts) -- both entry paths
    // converge on the same two Spot shapes rather than each assembling one.
    return situation === "vs-raise"
      ? buildVsRaiseSpot(position, raiser, effectiveStackBb)
      : buildOpenSpot(position, effectiveStackBb);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!stackIsValid) return;
    await load(buildSpot());
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
              {heroPositions.map((p) => (
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
              onChange={() => selectSituation("unopened")}
            />
            First to act &mdash; unopened pot (opening range)
          </label>

          <label className="spot-builder__field spot-builder__field--radio">
            <input
              type="radio"
              name="situation"
              checked={situation === "vs-raise"}
              onChange={() => selectSituation("vs-raise")}
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
                {OPENABLE_POSITIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>

        <button type="submit" className="btn-primary" disabled={outcome.kind === "loading" || !stackIsValid}>
          Get reference strategy
        </button>
      </form>

      <div className="spot-builder__status" role="status" aria-live="polite">
        {outcome.kind === "idle" && (
          <p>Build a spot and submit to see its reference range.</p>
        )}
        {outcome.kind === "loading" && (
          <p>
            <span className="spot-builder__spinner" aria-hidden="true" />
            Loading reference strategy&hellip;
          </p>
        )}

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
              Check your connection and try again. The server may also be
              waking up &mdash; give it a minute.
            </p>
            {import.meta.env.DEV && (
              <p>
                Dev: is <code>apps/api</code> running? Start it with{" "}
                <code>cd apps/api &amp;&amp; uvicorn app.main:app --reload</code>.
              </p>
            )}
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
          <p className="spot-builder__hint">
            Adjust the range below before saving &mdash; brush weight, click, or
            drag, same as any range grid.
          </p>
          <RangeGrid value={editedRange} onChange={setEditedRange} />
          <div className="spot-builder__save">
            <button
              type="button"
              className="btn-secondary"
              onClick={save}
              disabled={saveState.kind === "saving"}
            >
              {saveState.kind === "saving" ? "Saving…" : "Save this spot"}
            </button>
            <button
              type="button"
              className="spot-builder__reset btn-ghost"
              onClick={() => setEditedRange(outcome.data.ranges[position] ?? {})}
            >
              Reset to chart
            </button>
            {saveState.kind === "saved" && (
              <span className="spot-builder__save-status spot-builder__save-status--ok">
                Saved.
              </span>
            )}
            {saveState.kind === "error" && (
              <span className="spot-builder__save-status spot-builder__save-status--error">
                Couldn&rsquo;t save that spot &mdash; try again in a moment.
              </span>
            )}
            {saveState.kind === "not-signed-in" && (
              <span className="spot-builder__save-status spot-builder__save-status--warn">
                Sign in to save spots.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
