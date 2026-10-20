import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Position, Spot } from "@poker-solver/schema";
import { SegmentedControl } from "../components/SegmentedControl/SegmentedControl";
import { RangeGrid } from "../components/RangeGrid/RangeGrid";
import { SIX_MAX_POSITIONS } from "../lib/positions";
import { buildOpenSpot, buildVsRaiseSpot } from "../lib/spot";
import { parseSpotText } from "../lib/parseSpotText";
import { EXAMPLE_HAND_HISTORY, parseHandHistory } from "../lib/parseHandHistory";
import { useReferenceChart, type ChartMatch } from "../lib/useReferenceChart";
import { indexRange, totalCombos } from "../lib/rangeCombos";
import { prefillFromChartSpot } from "../lib/solvePrefill";
import type { RangesMode } from "./RangesPage";
import "../components/SpotBuilder/SpotBuilder.css";
import "./RangesWorkspace.css";

type Situation = "open" | "defend";

const MODES = [
  { value: "pick", label: "Pick" },
  { value: "type", label: "Type it" },
  { value: "paste", label: "Hand history" },
] as const;

const SEAT_OPTIONS = SIX_MAX_POSITIONS.map((p) => ({ value: p, label: p }));

const STACK_OPTIONS = [
  { value: "40", label: "40bb" },
  { value: "100", label: "100bb" },
] as const;

const TYPE_EXAMPLES = ["BTN opens 100bb", "BB defends CO open, 100bb", "CO opens 40bb"];

const TOTAL_COMBOS = 1326;

// How long Pick / Type it wait after the last change before fetching, so
// clicking through seats or typing doesn't fire a request per keystroke.
const AUTO_LOAD_MS = 250;

/** The seats that act before `seat` preflop, so could have raised first. */
function earlierSeats(seat: Position): Position[] {
  return SIX_MAX_POSITIONS.slice(0, SIX_MAX_POSITIONS.indexOf(seat));
}

/** The raiser in a chart spot (open, or facing one raise). */
function raiserOf(spot: Spot): Position | undefined {
  return (spot.actions ?? []).find((a) => a.action === "raise")?.position;
}

/** A chart spot in words: the canvas title and the line under it. */
function describeSpot(spot: Spot): { title: string; subline: string } {
  const hero = spot.positions_in_hand[0];
  const raiser = raiserOf(spot);
  const stack = `about ${spot.effective_stack_bb}bb`;
  return raiser
    ? {
        title: `${hero} vs a ${raiser} raise`,
        subline: `${raiser} raised and it's on you · ${stack} · 6-max. Green hands continue (call or 3-bet); the rest fold.`,
      }
    : { title: `${hero} opening range`, subline: `Nobody has raised yet · ${stack} · 6-max` };
}

/**
 * Desktop Ranges (docs/desktop-redesign.md §6.3): describe the spot in the
 * left rail -- Pick, Type it, or Hand history -- and the chart on the right
 * follows. There's no "get chart" button: Pick and Type it fetch on every
 * change (debounced, stale responses dropped by useReferenceChart), and a
 * pasted hand loads on "Read hand". All three converge on the same Spot
 * via lib/spot.ts, and the same chart panel.
 *
 * Phones don't render this: RangesPage shows them the original three pages,
 * unchanged.
 */
export function RangesWorkspace({
  mode,
  onModeChange,
}: {
  mode: RangesMode;
  onModeChange: (mode: RangesMode) => void;
}) {
  const navigate = useNavigate();
  const chart = useReferenceChart();
  const { load, clear } = chart;

  // Pick
  const [seat, setSeat] = useState<Position>("BTN");
  const [situationChoice, setSituationChoice] = useState<Situation>("open");
  const [raiserChoice, setRaiserChoice] = useState<Position>("CO");
  const [stackBb, setStackBb] = useState(100);
  // Type it
  const [typed, setTyped] = useState("");
  // Hand history
  const [pasted, setPasted] = useState("");
  const [pastedSpot, setPastedSpot] = useState<Spot | null>(null);
  const [pasteError, setPasteError] = useState<string | null>(null);

  // The impossible combinations are derived away rather than stored: BB is
  // never first in, UTG never faces an earlier raise, and the raiser must
  // act before the seat. Going back to a seat restores the earlier choice.
  const situation: Situation = seat === "BB" ? "defend" : seat === "UTG" ? "open" : situationChoice;
  const raisers = earlierSeats(seat);
  const raiser = raisers.includes(raiserChoice) ? raiserChoice : raisers[raisers.length - 1];

  const typedParse = typed.trim() === "" ? null : parseSpotText(typed);

  const spot: Spot | null =
    mode === "pick"
      ? situation === "defend"
        ? buildVsRaiseSpot(seat, raiser, stackBb)
        : buildOpenSpot(seat, stackBb)
      : mode === "type"
        ? typedParse?.kind === "parsed"
          ? typedParse.spot
          : null
        : pastedSpot;

  // Fetch whenever the described spot changes. Keyed on the spot's content,
  // since a fresh object is built every render.
  const spotKey = spot ? JSON.stringify(spot) : null;
  useEffect(() => {
    if (spotKey === null) {
      clear();
      return;
    }
    const timer = setTimeout(() => load(JSON.parse(spotKey) as Spot), AUTO_LOAD_MS);
    return () => clearTimeout(timer);
  }, [spotKey, load, clear]);

  function readHand() {
    const parsed = parseHandHistory(pasted);
    if (parsed.kind === "unrecognized") {
      setPasteError(parsed.reason);
      setPastedSpot(null);
      return;
    }
    setPasteError(null);
    setPastedSpot(parsed.spot);
  }

  const { outcome } = chart;
  // Keep the last chart up (dimmed) while the next one loads.
  const match: ChartMatch | undefined =
    outcome.kind === "match" ? outcome : outcome.kind === "loading" ? outcome.previous : undefined;
  const loading = outcome.kind === "loading";

  return (
    <div className="ranges-workspace">
      <aside className="ranges-workspace__rail" aria-label="Describe the spot">
        <div className="ranges-workspace__group">
          <h2 className="ranges-workspace__rail-title">Describe the spot</h2>
          <SegmentedControl
            label="How to describe the spot"
            options={MODES}
            value={mode}
            onChange={onModeChange}
          />
        </div>

        {mode === "pick" && (
          <PickControls
            seat={seat}
            onSeat={setSeat}
            situation={situation}
            onSituation={setSituationChoice}
            raisers={raisers}
            raiser={raiser}
            onRaiser={setRaiserChoice}
            stackBb={stackBb}
            onStack={setStackBb}
          />
        )}

        {mode === "type" && (
          <div className="ranges-workspace__group">
            <label className="ranges-workspace__field-label" htmlFor="ranges-typed">
              Type the spot in plain words
            </label>
            <input
              id="ranges-typed"
              type="text"
              value={typed}
              placeholder={TYPE_EXAMPLES[0]}
              onChange={(e) => setTyped(e.target.value)}
            />
            <span className="ranges-workspace__hint">For now we understand two kinds of phrase. Try one:</span>
            <div className="ranges-workspace__chips">
              {TYPE_EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  className="ranges-workspace__chip"
                  onClick={() => setTyped(example)}
                >
                  {example}
                </button>
              ))}
            </div>
            {typedParse?.kind === "parsed" && (
              <p className="ranges-workspace__understood">
                Understood: {describeSpot(typedParse.spot).title}, about{" "}
                {typedParse.spot.effective_stack_bb}bb
              </p>
            )}
            {typedParse?.kind === "unrecognized" && (
              <p className="ranges-workspace__hint">
                Not one we understand yet. Try a phrasing like the examples above.
              </p>
            )}
          </div>
        )}

        {mode === "paste" && (
          <div className="ranges-workspace__group">
            <label className="ranges-workspace__field-label" htmlFor="ranges-hh">
              Paste a hand history
            </label>
            <textarea
              id="ranges-hh"
              className="ranges-workspace__hh"
              rows={9}
              value={pasted}
              placeholder={EXAMPLE_HAND_HISTORY}
              onChange={(e) => setPasted(e.target.value)}
            />
            <span className="ranges-workspace__hint">
              PokerStars format, 6-max. Paste up to your own decision. We&rsquo;ll work out your
              seat and what happened before you.
            </span>
            <div className="ranges-workspace__actions">
              <button type="button" className="btn-secondary" disabled={pasted.trim() === ""} onClick={readHand}>
                Read hand
              </button>
              <button type="button" className="btn-ghost" onClick={() => setPasted(EXAMPLE_HAND_HISTORY)}>
                Use an example
              </button>
            </div>
            {pasteError && (
              <p className="spot-builder__field-error" role="alert">
                Couldn&rsquo;t read this hand: {pasteError}
              </p>
            )}
          </div>
        )}

        <p className="ranges-workspace__rail-foot">
          {mode === "paste"
            ? "The chart on the right shows the decision the hand stops at."
            : "The chart on the right updates as soon as you change the spot."}
        </p>
      </aside>

      <section className="ranges-workspace__canvas" aria-label="Chart">
        {match ? (
          <ChartPanel
            match={match}
            loading={loading}
            chart={chart}
            onSolve={() =>
              navigate("/solve", { state: { prefill: prefillFromChartSpot(match.spot, chart.editedRange) } })
            }
          />
        ) : (
          <CanvasMessage mode={mode} outcome={outcome} />
        )}
      </section>
    </div>
  );
}

function PickControls(props: {
  seat: Position;
  onSeat: (seat: Position) => void;
  situation: Situation;
  onSituation: (situation: Situation) => void;
  raisers: Position[];
  raiser: Position;
  onRaiser: (raiser: Position) => void;
  stackBb: number;
  onStack: (stackBb: number) => void;
}) {
  const { seat, situation, raisers } = props;
  const choices: { value: Situation; title: string; sub: string; disabled: boolean }[] = [
    {
      value: "open",
      title: "Nobody has raised yet",
      sub: "You're first in. Which hands should you raise?",
      disabled: seat === "BB",
    },
    {
      value: "defend",
      title: "Someone raised before you",
      sub: "Which hands should continue against a single raise?",
      disabled: seat === "UTG",
    },
  ];

  return (
    <div className="ranges-workspace__pick">
      <div className="ranges-workspace__group">
        <span className="section-label" aria-hidden="true">
          Your seat
        </span>
        <SegmentedControl label="Your seat" options={SEAT_OPTIONS} value={seat} onChange={props.onSeat} stretch />
      </div>

      <div className="ranges-workspace__group" role="group" aria-label="What happened before you">
        <span className="section-label" aria-hidden="true">
          What happened before you
        </span>
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            className="ranges-workspace__choice"
            aria-pressed={situation === choice.value}
            disabled={choice.disabled}
            onClick={() => props.onSituation(choice.value)}
          >
            <span className="ranges-workspace__choice-title">{choice.title}</span>
            <span className="ranges-workspace__choice-sub">{choice.sub}</span>
          </button>
        ))}
      </div>

      {situation === "defend" && (
        <div className="ranges-workspace__group">
          <span className="section-label" aria-hidden="true">
            Who raised?
          </span>
          <SegmentedControl
            label="Who raised"
            options={raisers.map((p) => ({ value: p, label: p }))}
            value={props.raiser}
            onChange={props.onRaiser}
            stretch
          />
        </div>
      )}

      <div className="ranges-workspace__group">
        <span className="section-label" aria-hidden="true">
          Stack size
        </span>
        <SegmentedControl
          label="Stack size"
          options={STACK_OPTIONS}
          value={String(props.stackBb) as "40" | "100"}
          onChange={(value) => props.onStack(Number(value))}
        />
        <span className="ranges-workspace__hint">Charts are available for about 40bb and 100bb.</span>
      </div>
    </div>
  );
}

function ChartPanel({
  match,
  loading,
  chart,
  onSolve,
}: {
  match: ChartMatch;
  loading: boolean;
  chart: ReturnType<typeof useReferenceChart>;
  onSolve: () => void;
}) {
  const { title, subline } = describeSpot(match.spot);
  const combos = useMemo(() => totalCombos(indexRange(chart.editedRange)), [chart.editedRange]);
  const pct = ((combos / TOTAL_COMBOS) * 100).toFixed(1);
  const { saveState } = chart;

  return (
    <div className="ranges-workspace__panel" aria-busy={loading || undefined} data-loading={loading || undefined}>
      <div className="ranges-workspace__panel-head">
        <div>
          <h2 className="ranges-workspace__title">{title}</h2>
          <p className="ranges-workspace__subline">{subline}</p>
        </div>
        <span className="ranges-workspace__pill">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16h.01" />
          </svg>
          Standard chart: a starting point, not a live solve
        </span>
      </div>

      <div className="ranges-workspace__body">
        <div className="ranges-workspace__grid">
          <RangeGrid
            value={chart.editedRange}
            onChange={chart.setEditedRange}
            reset={{ label: "Reset to chart", onClick: chart.resetToChart }}
            showSummary={false}
          />
          <p className="ranges-workspace__caption">
            Pairs run down the middle. Suited hands are above them and offsuit hands below. Click or
            drag to add or remove hands.
          </p>
        </div>

        <div className="ranges-workspace__side">
          <div className="ranges-workspace__card">
            <span className="section-label">This range</span>
            <span className="ranges-workspace__stat tabular-nums">{pct}%</span>
            <span className="ranges-workspace__stat-sub tabular-nums">
              of all starting hands · {Math.round(combos)} combos
            </span>
            {chart.edited && <span className="ranges-workspace__edited">Edited from the standard chart</span>}
          </div>

          <div className="ranges-workspace__card ranges-workspace__card--actions">
            <button
              type="button"
              className="btn-primary"
              onClick={chart.save}
              disabled={loading || saveState.kind === "saving"}
            >
              {saveState.kind === "saving" ? "Saving…" : "Save to Library"}
            </button>
            {saveState.kind === "saved" && <p className="ranges-workspace__save-ok">Saved to your Library.</p>}
            {saveState.kind === "error" && (
              <p className="spot-builder__field-error">Couldn&rsquo;t save that spot. Try again in a moment.</p>
            )}
            {saveState.kind === "not-signed-in" && (
              <p className="ranges-workspace__hint">Sign in (bottom left) to save spots to your Library.</p>
            )}
            <button type="button" className="btn-secondary ranges-workspace__solve" onClick={onSolve} disabled={loading}>
              Solve a flop from here
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The canvas before there's a chart to show: an explainer, a loading line,
 * or why there's no chart. */
function CanvasMessage({ mode, outcome }: { mode: RangesMode; outcome: ReturnType<typeof useReferenceChart>["outcome"] }) {
  switch (outcome.kind) {
    case "loading":
      return (
        <p className="ranges-workspace__empty" role="status">
          <span className="spot-builder__spinner" aria-hidden="true" />
          Loading the chart&hellip;
        </p>
      );
    case "no-match":
      return (
        <div className="spot-builder__status-block spot-builder__status-block--info" role="status">
          <p className="spot-builder__status-title">No standard chart for this spot yet.</p>
          <p>The built-in charts (6-max) currently cover:</p>
          <ul>
            <li>Opening ranges (nobody has raised): UTG, HJ, CO, BTN, SB.</li>
            <li>
              Facing one raise: BB vs any of UTG/HJ/CO/BTN/SB; BTN vs HJ or CO; SB vs CO or BTN.
            </li>
            <li>Stacks of about 40bb (30&ndash;50) or 100bb (80&ndash;120).</li>
            <li>Preflop only: one raise, no re-raised (3-bet) pots yet.</li>
          </ul>
        </div>
      );
    case "invalid":
      return (
        <div className="spot-builder__status-block spot-builder__status-block--error" role="alert">
          <p className="spot-builder__status-title">The server couldn&rsquo;t use that spot.</p>
          <ul className="spot-builder__issues">
            {outcome.issues.map((issue, idx) => (
              <li key={idx}>
                <code className="spot-builder__issue-loc">{issue.loc.join(" > ")}</code> &mdash; {issue.msg}
              </li>
            ))}
          </ul>
        </div>
      );
    case "network-error":
      return (
        <div className="spot-builder__status-block spot-builder__status-block--error" role="alert">
          <p className="spot-builder__status-title">Couldn&rsquo;t reach the server.</p>
          <p>Check your connection and try again. The server may also be waking up &mdash; give it a minute.</p>
          {import.meta.env.DEV && (
            <p>
              Dev: is <code>apps/api</code> running? Start it with{" "}
              <code>cd apps/api &amp;&amp; uvicorn app.main:app --reload</code>.
            </p>
          )}
        </div>
      );
    case "error":
      return (
        <div className="spot-builder__status-block spot-builder__status-block--error" role="alert">
          <p className="spot-builder__status-title">Something went wrong.</p>
          <p>The request failed with HTTP {outcome.status}.</p>
        </div>
      );
    default:
      return (
        <div className="ranges-workspace__empty">
          <p className="ranges-workspace__empty-title">
            {mode === "paste" ? "Paste a hand to see your chart" : "Describe a spot to see its chart"}
          </p>
          <p>
            A preflop chart is the standard list of hands to play from a seat: green squares are
            hands you play, grey ones you fold. It&rsquo;s a starting point you can edit and save as
            your own.
          </p>
          <p>
            {mode === "paste"
              ? "Paste a hand history on the left and press Read hand. We'll find your seat and what happened before you."
              : "Type a spot on the left, or click one of the examples."}
          </p>
        </div>
      );
  }
}
