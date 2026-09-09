import { useState } from "react";
import type { FormEvent } from "react";
import type { ActionType, BettingAction, Position, Spot } from "@poker-solver/schema";
import { ACTION_TYPES, POSITIONS } from "../../lib/positions";
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
 * Position + effective stack + an ordered action-sequence editor assemble a
 * Spot client-side; it's POSTed to apps/api's /spots/reference-strategy and
 * the matched range is shown read-only via RangeGrid. Every outcome the
 * endpoint can produce (match / 404 no-match / 422 invalid / unreachable)
 * gets its own message.
 *
 * The action editor is deliberately general (any position, any ActionType,
 * optional size). Only a few shapes actually resolve to a reference chart
 * today -- see apps/api/app/reference_charts.py; the "no reference chart"
 * block enumerates the current coverage. Everything else is a plain 404.
 *
 * Not here: board card picker (out of scope until Stage 5 -- postflop
 * reference charts / live solving). Visual polish is a separate shared
 * ticket; this file is functional baseline styling only.
 */

// BettingAction has no id of its own; each editor row carries a stable key
// for React that buildSpot() strips before the Spot leaves the component.
type ActionRow = { _key: string } & BettingAction;

let rowSeq = 0;
const nextKey = () => `a${rowSeq++}`;

function newActionRow(): ActionRow {
  return {
    _key: nextKey(),
    position: "BTN",
    street: "preflop",
    // Defend charts want exactly one preflop raise, so it's the useful default.
    action: "raise",
    size_bb: null,
  };
}

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
  // "BTN" is a supported open hero, so a first submit from defaults is a 200.
  const [position, setPosition] = useState<Position>("BTN");
  const [effectiveStackBb, setEffectiveStackBb] = useState(100);
  const [actionRows, setActionRows] = useState<ActionRow[]>([]);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });

  const stackIsValid = Number.isFinite(effectiveStackBb) && effectiveStackBb > 0;

  function updateRow(key: string, patch: Partial<BettingAction>) {
    setActionRows((rows) => rows.map((r) => (r._key === key ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setActionRows((rows) => [...rows, newActionRow()]);
  }
  function removeRow(key: string) {
    setActionRows((rows) => rows.filter((r) => r._key !== key));
  }
  function moveRow(index: number, dir: -1 | 1) {
    setActionRows((rows) => {
      const next = index + dir;
      if (next < 0 || next >= rows.length) return rows;
      const copy = rows.slice();
      [copy[index], copy[next]] = [copy[next], copy[index]];
      return copy;
    });
  }

  function buildSpot(): Spot {
    const actions: BettingAction[] = actionRows.map((row) => {
      const entry: BettingAction = {
        position: row.position,
        street: "preflop", // fixed for Stage 2; the UI renders it as static text
        action: row.action,
      };
      if (row.size_bb != null && Number.isFinite(row.size_bb)) {
        entry.size_bb = row.size_bb;
      }
      return entry;
    });

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
            Position
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
          <h2 className="spot-builder__legend">Action sequence</h2>

          {actionRows.length === 0 && (
            <p className="spot-builder__hint">
              No prior action &mdash; this is an unopened pot (open charts).
            </p>
          )}

          <ol className="spot-builder__actions">
            {actionRows.map((row, i) => (
              <li key={row._key} className="spot-builder__action-row">
                <span className="spot-builder__action-street">Preflop</span>

                <label className="spot-builder__action-field">
                  Position
                  <select
                    value={row.position}
                    onChange={(e) =>
                      updateRow(row._key, { position: e.target.value as Position })
                    }
                  >
                    {POSITIONS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="spot-builder__action-field">
                  Action
                  <select
                    value={row.action}
                    onChange={(e) =>
                      updateRow(row._key, { action: e.target.value as ActionType })
                    }
                  >
                    {ACTION_TYPES.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="spot-builder__action-field">
                  Size (bb)
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={row.size_bb ?? ""}
                    onChange={(e) =>
                      updateRow(row._key, {
                        size_bb: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </label>

                <div className="spot-builder__row-controls">
                  <button
                    type="button"
                    className="spot-builder__icon-button"
                    onClick={() => moveRow(i, -1)}
                    disabled={i === 0}
                    aria-label="Move action earlier"
                  >
                    &uarr;
                  </button>
                  <button
                    type="button"
                    className="spot-builder__icon-button"
                    onClick={() => moveRow(i, 1)}
                    disabled={i === actionRows.length - 1}
                    aria-label="Move action later"
                  >
                    &darr;
                  </button>
                  <button
                    type="button"
                    className="spot-builder__icon-button"
                    onClick={() => removeRow(row._key)}
                    aria-label="Remove action"
                  >
                    &times;
                  </button>
                </div>
              </li>
            ))}
          </ol>

          <button
            type="button"
            className="spot-builder__add-row"
            onClick={addRow}
          >
            Add action
          </button>
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
            <p>The built-in reference charts currently cover:</p>
            <ul>
              <li>Unopened-pot opens from UTG, CO, BTN, or SB (no prior action).</li>
              <li>
                Defending a single raise: BB vs BTN, BTN vs CO, SB vs BTN, BB vs CO.
              </li>
              <li>Effective stack ~40bb (30&ndash;50) or ~100bb (80&ndash;120).</li>
              <li>Preflop only.</li>
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
