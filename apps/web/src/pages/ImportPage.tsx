import { useState } from "react";
import type { FormEvent } from "react";
import { EXAMPLE_HAND_HISTORY as EXAMPLE_HH, parseHandHistory } from "../lib/parseHandHistory";
import { useReferenceChart, type ChartOutcome } from "../lib/useReferenceChart";
import { RangeGrid } from "../components/RangeGrid/RangeGrid";
import "../components/SpotBuilder/SpotBuilder.css";

// Stage 4 MVP -- same outcome-rendering shape as TypeInPage (Stage 3),
// duplicated rather than shared for the same reason that page gives:
// "duplicate it once; don't over-engineer a stretch item." The one real
// difference from TypeInPage is `unrecognized` carrying a `reason` --
// see lib/parseHandHistory.ts for why a multi-line paste can be specific
// about what didn't parse where a short typed phrase can't.
type Outcome = ChartOutcome | { kind: "unrecognized"; reason: string };

/**
 * Stage 4's hand-history import -- a small, rule-based parser
 * (lib/parseHandHistory.ts) for one format (a PokerStars-style export)
 * and the same two situations the button builder and Stage 3 both
 * support. Paste up to (and optionally including) Hero's own decision
 * line; anything the parser can't reduce to one of those two shapes
 * comes back with a specific reason, not a generic failure.
 */
export function ImportPage() {
  const [text, setText] = useState("");
  // Fetch, the editable copy of the chart's range, and save come from
  // lib/useReferenceChart.ts; a parse failure is this page's own state.
  const chart = useReferenceChart();
  const { saveState, editedRange, setEditedRange } = chart;
  const [unrecognizedReason, setUnrecognizedReason] = useState<string | null>(null);
  const outcome: Outcome =
    unrecognizedReason !== null ? { kind: "unrecognized", reason: unrecognizedReason } : chart.outcome;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseHandHistory(text);
    if (parsed.kind === "unrecognized") {
      chart.clear();
      setUnrecognizedReason(parsed.reason);
      return;
    }
    setUnrecognizedReason(null);
    await chart.load(parsed.spot);
  }

  return (
    <div className="spot-builder">
      <form className="spot-builder__form" onSubmit={handleSubmit}>
        <label className="spot-builder__field">
          Paste a hand history
          <textarea
            className="spot-builder__hh-input"
            rows={10}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={EXAMPLE_HH}
          />
        </label>
        <p className="spot-builder__hint">
          PokerStars format, 6-max. Paste up to your own decision. We&rsquo;ll
          work out your seat and what happened before you.{" "}
          <button
            type="button"
            className="spot-builder__reset btn-ghost"
            onClick={() => setText(EXAMPLE_HH)}
          >
            Use example
          </button>
        </p>
        <button type="submit" className="btn-primary" disabled={outcome.kind === "loading" || text.trim() === ""}>
          Parse &amp; get reference strategy
        </button>
      </form>

      <div className="spot-builder__status" role="status" aria-live="polite">
        {outcome.kind === "idle" && (
          <p>Paste a hand history in the box above and submit.</p>
        )}

        {outcome.kind === "unrecognized" && (
          <div className="spot-builder__status-block spot-builder__status-block--error">
            <p className="spot-builder__status-title">Couldn&rsquo;t parse this hand.</p>
            <p>{outcome.reason}</p>
          </div>
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
            <p>Same reference-chart coverage as the Builder tab.</p>
          </div>
        )}

        {outcome.kind === "invalid" && (
          <div className="spot-builder__status-block spot-builder__status-block--error">
            <p className="spot-builder__status-title">Invalid spot.</p>
            <p>The server rejected the parsed spot:</p>
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
              onClick={chart.save}
              disabled={saveState.kind === "saving"}
            >
              {saveState.kind === "saving" ? "Saving…" : "Save this spot"}
            </button>
            <button
              type="button"
              className="spot-builder__reset btn-ghost"
              onClick={() =>
                setEditedRange(outcome.data.ranges[outcome.spot.positions_in_hand[0]] ?? {})
              }
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
