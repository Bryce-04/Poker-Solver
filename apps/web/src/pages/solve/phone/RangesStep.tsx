import { useState } from "react";
import type { Position } from "@poker-solver/schema";
import { ActionBar } from "../../../components/mobile/ActionBar";
import { RangeEditor, RangeLegend } from "../../../components/mobile/RangeEditor";
import { SegmentedControl } from "../../../components/SegmentedControl/SegmentedControl";
import type { SolveSetup } from "../useSolveSetup";
import { rangeCombos, rangePercent, rangesBlocker } from "./phoneSteps";

/**
 * Step 3, "Which hands could they have?" (docs/mobile-redesign.md §4.3): each
 * player's range on the 13×13 chart, loaded on their own from the preflop
 * action. Tap a hand to set how often it's there, or switch to Paint and drag.
 */
export function RangesStep({ s, onBack, onNext }: { s: SolveSetup; onBack: () => void; onNext: () => void }) {
  const [player, setPlayer] = useState<Position>(s.oopPosition);
  // The seats can change on step 1 after a player was picked here.
  const active = player === s.ipPosition ? s.ipPosition : s.oopPosition;
  const range = s.ranges[active] ?? {};
  const loaded = s.loadedRanges[active];
  const loading = s.preflopLoad.kind === "loading" || s.chartStates[active]?.kind === "loading";
  // Why a load didn't work: the preflop line (then each seat fell back to
  // its typical range), and/or that seat's typical range.
  const chartState = s.chartStates[active];
  const problems = [
    s.preflopLoad.kind === "unavailable" ? s.preflopLoad.reason : null,
    chartState?.kind === "unavailable" ? chartState.reason : null,
  ].filter((m): m is string => m !== null);

  return (
    <>
      <div>
        <h1 className="m-step__title">Which hands could they have?</h1>
        <p className="m-step__lede">
          {loading ? "Loading the ranges… " : loaded ? `${loaded.source}. ` : ""}
          Tap a hand to change it, or switch to Paint to drag.
        </p>
      </div>

      <SegmentedControl
        label="Whose range"
        options={[
          { value: s.oopPosition, label: `${s.oopPosition} · acts first`, detail: `${rangePercent(s.ranges[s.oopPosition] ?? {})}% of hands` },
          { value: s.ipPosition, label: `${s.ipPosition} · acts last`, detail: `${rangePercent(s.ranges[s.ipPosition] ?? {})}% of hands` },
        ]}
        value={active}
        onChange={setPlayer}
        stretch
      />

      <RangeEditor
        range={range}
        onChange={(next) => s.setRangeFor(active, next)}
        deadCards={s.board.kind === "ok" ? s.board.cards : []}
        question={`How often does ${active} have this hand here?`}
        action={{
          label: s.canUsePreflopLine ? "Reload from the preflop action" : "Reload typical ranges",
          onClick: () => void s.autoLoadRanges(),
          disabled: loading,
        }}
        notices={problems.map((problem) => (
          <p key={problem} className="m-error" role="alert">
            {problem}
          </p>
        ))}
        summary={
          <>
            <span className="m-ranges__count">
              <strong>{rangeCombos(range)}</strong> combos · {rangePercent(range)}%
            </span>
            <RangeLegend />
          </>
        }
      />

      <Narrowing s={s} />

      <ActionBar
        primaryLabel="Next: review & solve"
        onPrimary={onNext}
        disabledReason={loading ? "Loading the ranges…" : rangesBlocker(s)}
        onBack={onBack}
      />
    </>
  );
}

/** "Narrow by the flop action": only once there's an earlier postflop street. */
function Narrowing({ s }: { s: SolveSetup }) {
  if (s.narrowStreets.length === 0 && s.narrowState.kind === "idle") return null;
  const label = `Narrow by the ${s.narrowStreets.join(" and ")} action`;
  return (
    <div className="m-section m-section--tight">
      {s.narrowState.kind === "done" ? (
        <>
          <p className="m-note">
            Narrowed by {s.narrowState.streets} action.{s.narrowState.trimmedNote}
          </p>
          {s.rangesBeforeNarrow && (
            <button type="button" className="m-btn m-btn--ghost m-btn--inline" onClick={s.undoNarrowing}>
              Undo narrowing
            </button>
          )}
        </>
      ) : (
        <button
          type="button"
          className="m-btn m-btn--secondary"
          onClick={() => void s.narrowByEarlierStreets()}
          disabled={s.narrowState.kind === "loading" || s.narrowStreets.length === 0}
        >
          {s.narrowState.kind === "loading" ? `Narrowing by the ${s.narrowState.street}…` : label}
        </button>
      )}
      {s.narrowState.kind === "failed" && (
        <p className="m-error" role="alert">
          {s.narrowState.reason}
        </p>
      )}
    </div>
  );
}
