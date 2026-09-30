import { useState } from "react";
import type { FormEvent } from "react";
import type { HandRange, Spot } from "@poker-solver/schema";
import {
  fetchReferenceStrategy,
  saveSpot,
  type ReferenceStrategyResponse,
  type SpotValidationIssue,
} from "../lib/api";
import { parseHandHistory } from "../lib/parseHandHistory";
import { RangeGrid } from "../components/RangeGrid/RangeGrid";
import "../components/SpotBuilder/SpotBuilder.css";

// Stage 4 MVP -- same outcome-rendering shape as TypeInPage (Stage 3),
// duplicated rather than shared for the same reason that page gives:
// "duplicate it once; don't over-engineer a stretch item." The one real
// difference from TypeInPage is `unrecognized` carrying a `reason` --
// see lib/parseHandHistory.ts for why a multi-line paste can be specific
// about what didn't parse where a short typed phrase can't.
type Outcome =
  | { kind: "idle" }
  | { kind: "unrecognized"; reason: string }
  | { kind: "loading" }
  | { kind: "match"; data: ReferenceStrategyResponse; spot: Spot }
  | { kind: "no-match" }
  | { kind: "invalid"; issues: SpotValidationIssue[] }
  | { kind: "network-error" }
  | { kind: "error"; status: number };

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error" };

const EXAMPLE_HH = `PokerStars Hand #1:  Hold'em No Limit ($0.50/$1.00 USD) - 2024/01/01 12:00:00 ET
Table 'Atlas' 6-max Seat #4 is the button
Seat 1: Alice ($100 in chips)
Seat 2: Bob ($100 in chips)
Seat 3: Carol ($100 in chips)
Seat 4: Hero ($100 in chips)
Seat 5: Eve ($100 in chips)
Seat 6: Frank ($100 in chips)
Eve: posts small blind $0.50
Frank: posts big blind $1
*** HOLE CARDS ***
Dealt to Hero [Ah Kh]
Alice: folds
Bob: folds
Carol: folds
Hero: raises $2 to $3`;

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
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [editedRange, setEditedRange] = useState<HandRange>({});

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaveState({ kind: "idle" });

    const parsed = parseHandHistory(text);
    if (parsed.kind === "unrecognized") {
      setOutcome({ kind: "unrecognized", reason: parsed.reason });
      return;
    }

    setOutcome({ kind: "loading" });
    const result = await fetchReferenceStrategy(parsed.spot);
    switch (result.kind) {
      case "match":
        setOutcome({ kind: "match", data: result.data, spot: parsed.spot });
        setEditedRange(result.data.ranges[parsed.spot.positions_in_hand[0]] ?? {});
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
    const toSave: Spot = { ...spot, ranges: { [spot.positions_in_hand[0]]: editedRange } };
    const result = await saveSpot(toSave);
    setSaveState(result.kind === "saved" ? { kind: "saved" } : { kind: "error" });
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
          Stage 4 MVP &mdash; one format (a PokerStars-style export), a full
          6-handed 6-max table, and hands that reduce to an unopened pot or
          Hero facing a single raise. Paste up to Hero&rsquo;s own decision.{" "}
          <button
            type="button"
            className="spot-builder__reset"
            onClick={() => setText(EXAMPLE_HH)}
          >
            Use example
          </button>
        </p>
        <button type="submit" disabled={outcome.kind === "loading" || text.trim() === ""}>
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
          <p className="spot-builder__hint">
            Adjust the range below before saving &mdash; brush weight, click, or
            drag, same as any range grid.
          </p>
          <RangeGrid value={editedRange} onChange={setEditedRange} />
          <div className="spot-builder__save">
            <button
              type="button"
              onClick={() => handleSave(outcome.spot)}
              disabled={saveState.kind === "saving"}
            >
              {saveState.kind === "saving" ? "Saving…" : "Save this spot"}
            </button>
            <button
              type="button"
              className="spot-builder__reset"
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
          </div>
        </div>
      )}
    </div>
  );
}
