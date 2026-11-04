import { useState } from "react";
import type { HandRange, Position } from "@poker-solver/schema";
import { ActionBar } from "../../../components/mobile/ActionBar";
import { BottomSheet } from "../../../components/mobile/BottomSheet";
import { ChipGroup } from "../../../components/mobile/ChipGroup";
import { RangeGrid } from "../../../components/RangeGrid/RangeGrid";
import { SegmentedControl } from "../../../components/SegmentedControl/SegmentedControl";
import { indexRange, isPartial, labelCombos, labelWeight, setLabelWeight } from "../../../lib/rangeCombos";
import type { SolveSetup } from "../useSolveSetup";
import { rangeCombos, rangePercent, rangesBlocker } from "./phoneSteps";

const BRUSHES = [
  { value: "1", label: "100%" },
  { value: "0.75", label: "75%" },
  { value: "0.5", label: "50%" },
  { value: "0.25", label: "25%" },
  { value: "0", label: "Erase" },
] as const;

const WEIGHTS = [
  { value: "0", label: "0%" },
  { value: "0.25", label: "25%" },
  { value: "0.5", label: "50%" },
  { value: "0.75", label: "75%" },
  { value: "1", label: "100%" },
] as const;

/**
 * Step 3, "Which hands could they have?" (docs/mobile-redesign.md §4.3): each
 * player's range on the 13×13 chart, loaded on their own from the preflop
 * action. Tap a hand to set how often it's there, or switch to Paint and drag.
 */
export function RangesStep({ s, onBack, onNext }: { s: SolveSetup; onBack: () => void; onNext: () => void }) {
  const [player, setPlayer] = useState<Position>(s.oopPosition);
  const [mode, setMode] = useState<"tap" | "paint">("tap");
  const [brush, setBrush] = useState("1");
  const [hand, setHand] = useState<string | null>(null);
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

      <div className="m-ranges__modes">
        <SegmentedControl
          label="Edit mode"
          options={[
            { value: "tap", label: "Tap to edit" },
            { value: "paint", label: "Paint" },
          ]}
          value={mode}
          onChange={setMode}
          stretch
        />
        <button
          type="button"
          className="icon-button m-ranges__reload"
          aria-label={s.canUsePreflopLine ? "Reload from the preflop action" : "Reload typical ranges"}
          onClick={() => void s.autoLoadRanges()}
          disabled={loading}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" />
          </svg>
        </button>
      </div>

      {mode === "paint" && (
        <div className="m-section m-section--tight">
          <ChipGroup label="Brush" options={BRUSHES} value={brush} onChange={setBrush} />
          <p className="m-note m-note--small">Drag across the chart to paint. The page won&rsquo;t scroll while Paint is on.</p>
        </div>
      )}

      {problems.map((problem) => (
        <p key={problem} className="m-error" role="alert">
          {problem}
        </p>
      ))}

      <RangeGrid
        value={range}
        onChange={(next) => s.setRangeFor(active, next)}
        deadCards={s.board.kind === "ok" ? s.board.cards : []}
        mode={mode}
        brush={Number(brush)}
        onCellTap={setHand}
        showSummary={false}
      />

      <div className="m-ranges__summary">
        <span className="m-ranges__count">
          <strong>{rangeCombos(range)}</strong> combos · {rangePercent(range)}%
        </span>
        <span className="m-ranges__legend" aria-hidden="true">
          <span className="m-ranges__key">
            <span className="m-ranges__swatch" />
            Always
          </span>
          <span className="m-ranges__key">
            <span className="m-ranges__swatch m-ranges__swatch--half" />
            Sometimes
          </span>
        </span>
      </div>

      <Narrowing s={s} />

      <ActionBar
        primaryLabel="Next: review & solve"
        onPrimary={onNext}
        disabledReason={loading ? "Loading the ranges…" : rangesBlocker(s)}
        onBack={onBack}
      />

      {hand && (
        <HandSheet
          hand={hand}
          player={active}
          range={range}
          onChange={(next) => s.setRangeFor(active, next)}
          onClose={() => setHand(null)}
        />
      )}
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

function handKind(hand: string): string {
  const combos = labelCombos(hand).length;
  if (hand.length === 2) return `pair · ${combos} combos`;
  return `${hand.endsWith("s") ? "suited" : "offsuit"} · ${combos} combos`;
}

/** One hand's weight in a player's range (§4.3). Applies as you tap. */
function HandSheet({
  hand,
  player,
  range,
  onChange,
  onClose,
}: {
  hand: string;
  player: Position;
  range: HandRange;
  onChange: (next: HandRange) => void;
  onClose: () => void;
}) {
  const index = indexRange(range);
  const partial = isPartial(index, hand);
  const weight = labelWeight(index, hand);
  const pressed = partial ? null : (WEIGHTS.find((w) => Math.abs(Number(w.value) - weight) < 0.001)?.value ?? null);

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={
        <span className="m-hand__title">
          <span className="m-hand__name">{hand}</span>
          <span className="m-hand__kind">{handKind(hand)}</span>
        </span>
      }
    >
      <p className="m-hand__question">How often does {player} have this hand here?</p>
      <ChipGroup
        label="How often"
        options={WEIGHTS}
        value={pressed}
        onChange={(v) => onChange(setLabelWeight(range, hand, Number(v)))}
      />
      {partial && <p className="m-note m-note--small">Only some suits are in right now. Picking a weight sets every suit.</p>}
      {!partial && pressed === null && weight > 0 && (
        <p className="m-note m-note--small">Right now: {Math.round(weight * 100)}%.</p>
      )}
      <p className="m-note m-note--small">
        0% = never, 100% = every time. In-between means the player sometimes plays it another way (for example,
        re-raises instead of calling).
      </p>
      <button type="button" className="m-btn m-btn--primary" onClick={onClose}>
        Done
      </button>
    </BottomSheet>
  );
}
