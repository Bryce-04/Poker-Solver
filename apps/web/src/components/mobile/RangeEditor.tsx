import { useState } from "react";
import type { ReactNode } from "react";
import type { HandRange } from "@poker-solver/schema";
import { RangeGrid } from "../RangeGrid/RangeGrid";
import { SegmentedControl } from "../SegmentedControl/SegmentedControl";
import { indexRange, isPartial, labelCombos, labelWeight, setLabelWeight } from "../../lib/rangeCombos";
import { BottomSheet } from "./BottomSheet";
import { ChipGroup } from "./ChipGroup";
import "./mobile.css";
import "./RangeEditor.css";

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

export interface RangeEditorProps {
  range: HandRange;
  onChange: (next: HandRange) => void;
  /** Board cards, greyed out in the suit view. */
  deadCards?: readonly string[];
  /** The hand sheet's question, for a hand: "How often does BB have this hand here?" */
  question: string;
  /** The round button beside the mode switch: reload the ranges (Solve) or
   * reset to the chart (Ranges). */
  action: { label: string; onClick: () => void; disabled?: boolean };
  /** Messages between the controls and the chart (a load that failed). */
  notices?: ReactNode;
  /** The line under the chart. */
  summary: ReactNode;
}

/**
 * The phone range editor (docs/mobile-redesign.md §4.3, reused by §5): Tap to
 * edit | Paint, a brush row in Paint mode, the 13×13 chart, and a hand sheet
 * that sets one hand's weight. Shared by Solve's ranges step and the Ranges
 * tab.
 */
export function RangeEditor({ range, onChange, deadCards = [], question, action, notices, summary }: RangeEditorProps) {
  const [mode, setMode] = useState<"tap" | "paint">("tap");
  const [brush, setBrush] = useState("1");
  const [hand, setHand] = useState<string | null>(null);

  return (
    <>
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
          aria-label={action.label}
          onClick={action.onClick}
          disabled={action.disabled}
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

      {notices}

      <RangeGrid
        value={range}
        onChange={onChange}
        deadCards={deadCards}
        mode={mode}
        brush={Number(brush)}
        onCellTap={setHand}
        showSummary={false}
      />

      <div className="m-ranges__summary">{summary}</div>

      {hand && (
        <HandSheet hand={hand} question={question} range={range} onChange={onChange} onClose={() => setHand(null)} />
      )}
    </>
  );
}

/** The "Always / Sometimes" key for the chart's fill. */
export function RangeLegend() {
  return (
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
  );
}

function handKind(hand: string): string {
  const combos = labelCombos(hand).length;
  if (hand.length === 2) return `pair · ${combos} combos`;
  return `${hand.endsWith("s") ? "suited" : "offsuit"} · ${combos} combos`;
}

/** One hand's weight in the range. Applies as you tap. */
function HandSheet({
  hand,
  question,
  range,
  onChange,
  onClose,
}: {
  hand: string;
  question: string;
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
      <p className="m-hand__question">{question}</p>
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
