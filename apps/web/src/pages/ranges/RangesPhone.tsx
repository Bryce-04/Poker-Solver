import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { Position, Spot } from "@poker-solver/schema";
import { ActionBar } from "../../components/mobile/ActionBar";
import { BottomSheet } from "../../components/mobile/BottomSheet";
import { ChipGroup } from "../../components/mobile/ChipGroup";
import { RangeEditor } from "../../components/mobile/RangeEditor";
import { SegmentedControl } from "../../components/SegmentedControl/SegmentedControl";
import { useAuth } from "../../lib/auth";
import { useOpenAccountSheet } from "../../lib/mobileShell";
import { EXAMPLE_HAND_HISTORY, parseHandHistory } from "../../lib/parseHandHistory";
import { parseSpotText } from "../../lib/parseSpotText";
import { SIX_MAX_POSITIONS } from "../../lib/positions";
import { indexRange, totalCombos } from "../../lib/rangeCombos";
import {
  TOTAL_COMBOS,
  TYPE_EXAMPLES,
  describeSpot,
  pickSpot,
  useChartAutoLoad,
  useOpenedChart,
  type Situation,
} from "../../lib/rangesSpot";
import { prefillFromChartSpot } from "../../lib/solvePrefill";
import { useReferenceChart, type ChartMatch } from "../../lib/useReferenceChart";
import type { RangesMode } from "../RangesPage";
import { ChartProblem } from "./ChartProblem";
import "./RangesPhone.css";

const MODES = [
  { value: "pick", label: "Pick" },
  { value: "type", label: "Type it" },
  { value: "paste", label: "Hand history" },
] as const;

const STACKS = [
  { value: "40", label: "40bb" },
  { value: "100", label: "100bb" },
] as const;

function readPosition(raw: string | null): Position | null {
  return SIX_MAX_POSITIONS.find((p) => p === raw) ?? null;
}

/**
 * Ranges on phones and tablets (docs/mobile-redesign.md §5): describe a spot
 * (Pick, Type it, or a hand history) and its standard chart follows, with no
 * "get chart" button. Edit it with the same range editor as Solve, save it to
 * the Library, or solve a flop from it. The same spot logic as desktop's
 * RangesWorkspace (lib/rangesSpot.ts, lib/useReferenceChart.ts).
 *
 * Pick's choices and the typed phrase are kept in the URL, so leaving the tab
 * and coming back (the tab bar returns to the URL it was left on) finds them
 * as they were. A pasted hand history is too long for that and starts over.
 */
export function RangesPhone({
  mode,
  onModeChange,
  initialSpot,
}: {
  mode: RangesMode;
  onModeChange: (mode: RangesMode) => void;
  /** A saved chart opened from the Library. */
  initialSpot?: Spot;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const chart = useReferenceChart();
  const { opened, defaults } = useOpenedChart(initialSpot);

  // Pick, from the URL (or where an opened chart starts).
  const seat = readPosition(params.get("seat")) ?? defaults.seat;
  const situationChoice: Situation =
    params.get("before") === "raise" ? "defend" : params.get("before") === "none" ? "open" : defaults.situation;
  const raiserChoice = readPosition(params.get("raiser")) ?? defaults.raiser;
  const stackBb = params.get("stack") === "40" ? 40 : params.get("stack") === "100" ? 100 : defaults.stackBb;
  const picked = pickSpot(seat, situationChoice, raiserChoice, stackBb);

  /** Write Pick's choices (all four, so the URL alone describes the spot).
   * Replaces the entry: a seat change isn't a step to go Back through. */
  function setPick(next: Partial<{ seat: Position; situation: Situation; raiser: Position; stack: number }>) {
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        out.set("seat", next.seat ?? seat);
        out.set("before", (next.situation ?? situationChoice) === "defend" ? "raise" : "none");
        out.set("raiser", next.raiser ?? raiserChoice);
        out.set("stack", String(next.stack ?? stackBb));
        return out;
      },
      { replace: true, state: location.state },
    );
  }

  // Type it, from the URL too.
  const typed = params.get("text") ?? "";
  function setTyped(text: string) {
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        if (text) out.set("text", text);
        else out.delete("text");
        return out;
      },
      { replace: true, state: location.state },
    );
  }
  const typedParse = typed.trim() === "" ? null : parseSpotText(typed);

  // Hand history.
  const [pasted, setPasted] = useState("");
  const [pastedSpot, setPastedSpot] = useState<Spot | null>(null);
  const [pasteError, setPasteError] = useState<string | null>(null);
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

  const spot: Spot | null =
    mode === "pick" ? picked.spot : mode === "type" ? (typedParse?.kind === "parsed" ? typedParse.spot : null) : pastedSpot;
  useChartAutoLoad(spot, chart, opened);

  const { outcome } = chart;
  // Keep the last chart up while the next one loads.
  const match: ChartMatch | undefined =
    outcome.kind === "match" ? outcome : outcome.kind === "loading" ? outcome.previous : undefined;
  const loading = outcome.kind === "loading";

  const auth = useAuth();
  const openAccountSheet = useOpenAccountSheet();
  const [saveOpen, setSaveOpen] = useState(false);

  const blocker = loading
    ? "Loading the chart…"
    : match
      ? null
      : mode === "paste" && !pastedSpot
        ? "Read a hand first"
        : mode === "type" && typedParse?.kind !== "parsed"
          ? "Type a spot first"
          : "No chart for this spot";

  return (
    <div className="m-step">
      <SegmentedControl label="How to describe the spot" options={MODES} value={mode} onChange={onModeChange} stretch />

      {mode === "pick" && (
        <PickControls
          seat={seat}
          situation={picked.situation}
          raisers={picked.raisers}
          raiser={picked.raiser}
          stackBb={stackBb}
          onPick={setPick}
        />
      )}

      {mode === "type" && (
        <section className="m-section">
          <label className="m-field">
            Type the spot in plain words
            <input
              type="text"
              value={typed}
              placeholder={TYPE_EXAMPLES[0]}
              onChange={(e) => setTyped(e.target.value)}
              autoCapitalize="none"
            />
          </label>
          <span className="m-note m-note--small">We understand two kinds of phrase for now. Try one:</span>
          <div className="m-pills" role="group" aria-label="Examples">
            {TYPE_EXAMPLES.map((example) => (
              <button key={example} type="button" className="m-pill" onClick={() => setTyped(example)}>
                {example}
              </button>
            ))}
          </div>
          {typedParse?.kind === "unrecognized" && (
            <p className="m-note">Not one we understand yet. Try a phrasing like the examples.</p>
          )}
        </section>
      )}

      {mode === "paste" && (
        <section className="m-section">
          <label className="m-field">
            Paste a hand history
            <textarea
              rows={7}
              value={pasted}
              placeholder={EXAMPLE_HAND_HISTORY}
              onChange={(e) => setPasted(e.target.value)}
              spellCheck={false}
            />
          </label>
          <span className="m-note m-note--small">
            PokerStars format, 6-max. Paste up to your own decision: we&rsquo;ll find your seat and what happened
            before you.
          </span>
          <div className="m-ranges-page__row">
            <button type="button" className="m-btn m-btn--secondary" disabled={pasted.trim() === ""} onClick={readHand}>
              Read hand
            </button>
            <button type="button" className="m-btn m-btn--ghost" onClick={() => setPasted(EXAMPLE_HAND_HISTORY)}>
              Use an example
            </button>
          </div>
          {pasteError && (
            <p className="m-error" role="alert">
              Couldn&rsquo;t read this hand: {pasteError}
            </p>
          )}
        </section>
      )}

      {match ? (
        <ChartSection match={match} loading={loading} chart={chart} />
      ) : loading ? (
        <p className="m-note" role="status">
          Loading the chart&hellip;
        </p>
      ) : outcome.kind === "idle" ? (
        <p className="m-note">
          {mode === "paste"
            ? "Paste a hand and tap Read hand to see the chart for your decision."
            : "Type a spot, or tap an example, to see its chart."}
        </p>
      ) : (
        <ChartProblem outcome={outcome} />
      )}

      {chart.saveState.kind === "saved" && !saveOpen && (
        <p className="m-note" role="status">
          Saved to your Library.
        </p>
      )}

      <ActionBar
        backLabel="Save"
        onBack={() => {
          if (auth.status !== "signed-in") openAccountSheet?.();
          else setSaveOpen(true);
        }}
        backDisabled={!match || loading}
        primaryLabel="Solve a flop from here"
        disabledReason={blocker}
        onPrimary={() =>
          match && navigate("/solve", { state: { prefill: prefillFromChartSpot(match.spot, chart.editedRange) } })
        }
      />

      {saveOpen && match && (
        <SaveSheet
          match={match}
          openedName={opened && JSON.stringify(match.spot) === opened.key ? opened.name : null}
          chart={chart}
          onClose={() => setSaveOpen(false)}
        />
      )}
    </div>
  );
}

function PickControls({
  seat,
  situation,
  raisers,
  raiser,
  stackBb,
  onPick,
}: {
  seat: Position;
  situation: Situation;
  raisers: Position[];
  raiser: Position;
  stackBb: number;
  onPick: (next: Partial<{ seat: Position; situation: Situation; raiser: Position; stack: number }>) => void;
}) {
  return (
    <>
      <section className="m-section">
        <span className="m-label">Your seat</span>
        <ChipGroup
          label="Your seat"
          options={SIX_MAX_POSITIONS.map((p) => ({ value: p, label: p }))}
          value={seat}
          onChange={(p) => onPick({ seat: p })}
        />
      </section>

      <section className="m-section">
        <span className="m-label">Before you</span>
        <SegmentedControl
          label="Before you"
          options={[
            { value: "open", label: "Nobody raised", disabled: seat === "BB" },
            { value: "defend", label: "Facing a raise", disabled: seat === "UTG" },
          ]}
          value={situation}
          onChange={(s) => onPick({ situation: s })}
          stretch
        />
      </section>

      {situation === "defend" && (
        <section className="m-section">
          <span className="m-label">Who raised?</span>
          <ChipGroup
            label="Who raised"
            options={raisers.map((p) => ({ value: p, label: p }))}
            value={raiser}
            onChange={(p) => onPick({ raiser: p })}
            columns={Math.max(raisers.length, 3)}
          />
        </section>
      )}

      <section className="m-ranges-page__stack">
        <span className="m-label">Stack</span>
        <SegmentedControl
          label="Stack"
          options={STACKS}
          value={String(stackBb) as "40" | "100"}
          onChange={(v) => onPick({ stack: Number(v) })}
          stretch
        />
      </section>
    </>
  );
}

/** The chart: what spot it is, then the range editor. */
function ChartSection({
  match,
  loading,
  chart,
}: {
  match: ChartMatch;
  loading: boolean;
  chart: ReturnType<typeof useReferenceChart>;
}) {
  const { title, subline } = describeSpot(match.spot);
  const hero = match.spot.positions_in_hand[0];
  const combos = useMemo(() => totalCombos(indexRange(chart.editedRange)), [chart.editedRange]);
  const pct = ((combos / TOTAL_COMBOS) * 100).toFixed(1);

  return (
    <section className="m-section m-ranges-page__chart" aria-label="Chart" aria-busy={loading || undefined} data-loading={loading || undefined}>
      <div>
        <h2 className="m-ranges-page__title">{title}</h2>
        <p className="m-step__lede">{subline}</p>
        <p className="m-note m-note--small m-ranges-page__standard">Standard chart: a starting point, not a live solve.</p>
      </div>
      <RangeEditor
        range={chart.editedRange}
        onChange={chart.setEditedRange}
        question={`How often does ${hero} play this hand here?`}
        action={{ label: "Reset to the chart", onClick: chart.resetToChart, disabled: !chart.edited }}
        summary={
          <span className="m-ranges__count">
            {pct}% of all hands · {Math.round(combos)} combos{chart.edited && " · edited"}
          </span>
        }
      />
    </section>
  );
}

/** Save the chart (as edited) to the Library, under a name. */
function SaveSheet({
  match,
  openedName,
  chart,
  onClose,
}: {
  match: ChartMatch;
  openedName: string | null;
  chart: ReturnType<typeof useReferenceChart>;
  onClose: () => void;
}) {
  const { title } = describeSpot(match.spot);
  const [name, setName] = useState(
    openedName ?? `${title}${chart.edited ? " (my version)" : ""} · ${match.spot.effective_stack_bb}bb`,
  );
  const { saveState } = chart;
  // Close once a save started here succeeds (the page then says so). Not on
  // an earlier save's "saved", or reopening the sheet would close it at once.
  const [submitted, setSubmitted] = useState(false);
  const saved = submitted && saveState.kind === "saved";
  useEffect(() => {
    if (saved) onClose();
  }, [saved, onClose]);

  function save() {
    setSubmitted(true);
    void chart.save(name);
  }

  return (
    <BottomSheet open onClose={onClose} title="Save to Library">
      <form
        className="m-section"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="m-field">
          Name
          <input type="text" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {saveState.kind === "error" && (
          <p className="m-error" role="alert">
            Couldn&rsquo;t save that spot. Try again in a moment.
          </p>
        )}
        <button type="submit" className="m-btn m-btn--primary" disabled={saveState.kind === "saving" || !name.trim()}>
          {saveState.kind === "saving" ? "Saving…" : "Save"}
        </button>
      </form>
    </BottomSheet>
  );
}
