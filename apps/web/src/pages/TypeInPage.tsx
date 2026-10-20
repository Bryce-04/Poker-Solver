import { useState } from "react";
import type { FormEvent } from "react";
import { parseSpotText } from "../lib/parseSpotText";
import { useReferenceChart, type ChartOutcome } from "../lib/useReferenceChart";
import { RangeGrid } from "../components/RangeGrid/RangeGrid";
import "../components/SpotBuilder/SpotBuilder.css";

// Stage 3 MVP -- reuses SpotBuilder's outcome-rendering shape and CSS
// rather than a shared component, per the ♥-lane plan ("duplicate it once;
// don't over-engineer a stretch item").
type Outcome = ChartOutcome | { kind: "unrecognized" };

const EXAMPLES = ["BTN opens 100bb", "BB defends CO open, 100bb"];

/**
 * Stage 3's plain-language spot entry -- a small, rule-based parser
 * (lib/parseSpotText.ts) for the same two situations the button builder
 * supports. Freeform text is out of scope for this MVP; see docs/plan.md.
 */
export function TypeInPage() {
  const [text, setText] = useState("");
  // Same pattern as SpotBuilder: fetch, the editable copy of the chart's
  // range, and save come from lib/useReferenceChart.ts. A parse failure is
  // this page's own state, shown in place of the chart's.
  const chart = useReferenceChart();
  const { saveState, editedRange, setEditedRange } = chart;
  const [unrecognized, setUnrecognized] = useState(false);
  const outcome: Outcome = unrecognized ? { kind: "unrecognized" } : chart.outcome;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseSpotText(text);
    if (parsed.kind === "unrecognized") {
      chart.clear();
      setUnrecognized(true);
      return;
    }
    setUnrecognized(false);
    await chart.load(parsed.spot);
  }

  return (
    <div className="spot-builder">
      <form className="spot-builder__form" onSubmit={handleSubmit}>
        <label className="spot-builder__field">
          Describe the spot
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={EXAMPLES[0]}
          />
        </label>
        <p className="spot-builder__hint">
          Two phrasings are recognized for now, e.g.{" "}
          <code className="spot-builder__issue-loc">{EXAMPLES[0]}</code> or{" "}
          <code className="spot-builder__issue-loc">{EXAMPLES[1]}</code>.
        </p>
        <button type="submit" className="btn-primary" disabled={outcome.kind === "loading" || text.trim() === ""}>
          Parse &amp; get reference strategy
        </button>
      </form>

      <div className="spot-builder__status" role="status" aria-live="polite">
        {outcome.kind === "idle" && (
          <p>Type a spot in one of the two supported phrasings.</p>
        )}

        {outcome.kind === "unrecognized" && (
          <div className="spot-builder__status-block spot-builder__status-block--error">
            <p className="spot-builder__status-title">
              Didn&rsquo;t recognize that phrasing.
            </p>
            <p>Try one of:</p>
            <ul>
              {EXAMPLES.map((example) => (
                <li key={example}>
                  <code className="spot-builder__issue-loc">{example}</code>
                </li>
              ))}
            </ul>
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
              onClick={() => chart.save()}
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
