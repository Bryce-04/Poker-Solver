import { useState } from "react";
import type { FormEvent } from "react";
import type { Spot } from "@poker-solver/schema";
import {
  fetchReferenceStrategy,
  saveSpot,
  type ReferenceStrategyResponse,
  type SpotValidationIssue,
} from "../lib/api";
import { parseSpotText } from "../lib/parseSpotText";
import { RangeGrid } from "../components/RangeGrid/RangeGrid";
import "../components/SpotBuilder/SpotBuilder.css";

// Stage 3 MVP -- reuses SpotBuilder's outcome-rendering shape and CSS
// rather than a shared component, per the ♥-lane plan ("duplicate it once;
// don't over-engineer a stretch item").
type Outcome =
  | { kind: "idle" }
  | { kind: "unrecognized" }
  | { kind: "loading" }
  | { kind: "match"; data: ReferenceStrategyResponse; spot: Spot }
  | { kind: "no-match" }
  | { kind: "invalid"; issues: SpotValidationIssue[] }
  | { kind: "network-error" }
  | { kind: "error"; status: number };

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error" };

const EXAMPLES = ["BTN opens 100bb", "BB defends CO open, 100bb"];

/**
 * Stage 3's plain-language spot entry -- a small, rule-based parser
 * (lib/parseSpotText.ts) for the same two situations the button builder
 * supports. Freeform text is out of scope for this MVP; see docs/plan.md.
 */
export function TypeInPage() {
  const [text, setText] = useState("");
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaveState({ kind: "idle" });

    const parsed = parseSpotText(text);
    if (parsed.kind === "unrecognized") {
      setOutcome({ kind: "unrecognized" });
      return;
    }

    setOutcome({ kind: "loading" });
    const result = await fetchReferenceStrategy(parsed.spot);
    switch (result.kind) {
      case "match":
        setOutcome({ kind: "match", data: result.data, spot: parsed.spot });
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

  async function handleSave(spot: Spot) {
    setSaveState({ kind: "saving" });
    const result = await saveSpot(spot);
    setSaveState(result.kind === "saved" ? { kind: "saved" } : { kind: "error" });
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
          Stage 3 MVP &mdash; only two phrasings are recognized, e.g.{" "}
          <code className="spot-builder__issue-loc">{EXAMPLES[0]}</code> or{" "}
          <code className="spot-builder__issue-loc">{EXAMPLES[1]}</code>.
        </p>
        <button type="submit" disabled={outcome.kind === "loading" || text.trim() === ""}>
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
          <div className="spot-builder__save">
            <button
              type="button"
              onClick={() => handleSave(outcome.spot)}
              disabled={saveState.kind === "saving"}
            >
              {saveState.kind === "saving" ? "Saving…" : "Save this spot"}
            </button>
            {saveState.kind === "saved" && (
              <span className="spot-builder__save-status spot-builder__save-status--ok">
                Saved.
              </span>
            )}
            {saveState.kind === "error" && (
              <span className="spot-builder__save-status spot-builder__save-status--error">
                Couldn&rsquo;t save &mdash; saved spots aren&rsquo;t live yet.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
