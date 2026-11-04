import { useState } from "react";
import type { Position } from "@poker-solver/schema";
import { ActionBar } from "../../../components/mobile/ActionBar";
import { BottomSheet } from "../../../components/mobile/BottomSheet";
import { ChipGroup } from "../../../components/mobile/ChipGroup";
import type { BuilderAction } from "../../../lib/handBuilder";
import { parseHandHistoryToPostflopSetup } from "../../../lib/parseHandHistory";
import { SIX_MAX_POSITIONS } from "../../../lib/positions";
import { bb, describeAction, runningPots, streetBlocks, type StreetBlock } from "../solveText";
import type { SolveSetup } from "../useSolveSetup";
import { handBlocker, raiseNames, sizePresets, splitAction, wagerFacts } from "./phoneSteps";

const STACKS = [40, 60, 100, 150, 200] as const;

const STREET_HEADING = {
  preflop: "Before the flop",
  flop: "On the flop",
  turn: "On the turn",
  river: "On the river",
} as const;

/**
 * Step 1, "Who's in the hand?" (docs/mobile-redesign.md §4.1): the two seats,
 * the starting stack, and what happened before the flop (plus any earlier
 * postflop street, once its cards are on the board), entered with big
 * buttons. A pasted hand history takes the place of all of that.
 */
export function HandStep({
  s,
  onNext,
  onPasted,
}: {
  s: SolveSetup;
  onNext: () => void;
  /** A hand history was read: everything is filled in, go to Ready. */
  onPasted: () => void;
}) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [stackOpen, setStackOpen] = useState(false);
  const blocker = handBlocker(s);

  return (
    <>
      <h1 className="m-step__title">Who&rsquo;s in the hand?</h1>

      {s.setupMode === "paste" ? (
        <PastedHand s={s} onPasteAgain={() => setPasteOpen(true)} />
      ) : (
        <>
          <section className="m-section">
            <span className="m-label" id="solve-player-1">
              Player 1
            </span>
            <SeatChips label="Player 1" value={s.seatA} taken={s.seatB} onChange={(p) => pickSeat(s, "A", p)} />
            <span className="m-label m-section__gap" id="solve-player-2">
              Player 2
            </span>
            <SeatChips label="Player 2" value={s.seatB} taken={s.seatA} onChange={(p) => pickSeat(s, "B", p)} />
            <p className="m-note">
              {s.oopPosition} acts first after the flop. {s.ipPosition} acts last.
            </p>
          </section>

          <section className="m-section">
            <span className="m-label">Starting stack</span>
            <ChipGroup
              label="Starting stack"
              options={[
                ...STACKS.map((n) => ({ value: String(n), label: `${n}bb` })),
                {
                  value: "custom",
                  label: (STACKS as readonly number[]).includes(s.startingStackBb) ? "Custom" : bb(s.startingStackBb),
                },
              ]}
              value={(STACKS as readonly number[]).includes(s.startingStackBb) ? String(s.startingStackBb) : "custom"}
              onChange={(v) => {
                if (v === "custom") setStackOpen(true);
                else {
                  s.setStartingStackBb(Number(v));
                  s.setRedoStack([]);
                }
              }}
              columns={3}
            />
          </section>

          <HandActions s={s} />
        </>
      )}

      {s.setupMode === "click" && (
        <button type="button" className="m-link" onClick={() => setPasteOpen(true)}>
          Or paste a hand history instead
        </button>
      )}

      <ActionBar
        primaryLabel="Next: the board"
        onPrimary={onNext}
        disabledReason={blocker}
        onBack={() => {}}
        backDisabled
      />

      <PasteSheet
        s={s}
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        onLoaded={() => {
          setPasteOpen(false);
          onPasted();
        }}
      />
      {stackOpen && <StackSheet s={s} onClose={() => setStackOpen(false)} />}
    </>
  );
}

function pickSeat(s: SolveSetup, which: "A" | "B", position: Position) {
  if (which === "A") s.setSeatA(position);
  else s.setSeatB(position);
  s.setRedoStack([]);
}

function SeatChips({
  label,
  value,
  taken,
  onChange,
}: {
  label: string;
  value: Position;
  taken: Position;
  onChange: (p: Position) => void;
}) {
  return (
    <ChipGroup
      label={label}
      options={SIX_MAX_POSITIONS.map((p) => ({ value: p, label: p, disabled: p === taken }))}
      value={value}
      onChange={onChange}
    />
  );
}

/** The action so far, street by street, with the live street's buttons. */
function HandActions({ s }: { s: SolveSetup }) {
  const blocks = streetBlocks(s.oopPosition, s.ipPosition, s.startingStackBb, s.streets, s.handSummary.targetStreet);
  // The street being solved isn't entered here: its decision is what the
  // solver works out. Any action already logged on it still shows, so it
  // can be seen (and undone).
  const solving = s.handSummary.targetStreet !== "preflop" && s.handSummary.blockedReason === null;
  const shown = blocks.filter((block, i) => !(solving && i === blocks.length - 1 && block.actions.length === 0));

  return (
    <section className="m-section">
      {shown.map((block, i) => (
        <StreetCard
          key={block.street}
          s={s}
          block={block}
          readOnly={solving && i === blocks.length - 1}
          heading={STREET_HEADING[block.street]}
        />
      ))}
      {s.hasActions && (
        <button type="button" className="m-btn m-btn--ghost m-btn--inline" onClick={s.goBack}>
          Undo last action
        </button>
      )}
    </section>
  );
}

function StreetCard({
  s,
  block,
  heading,
  readOnly,
}: {
  s: SolveSetup;
  block: StreetBlock;
  heading: string;
  readOnly: boolean;
}) {
  const [raiseOpen, setRaiseOpen] = useState(false);
  const { state, street } = block;
  const pots = runningPots(block);
  const live = !readOnly && !state.isTerminal && !state.folded;
  const names = raiseNames(block);
  const { highest } = wagerFacts(block);
  const streetName = street === "preflop" ? "Preflop" : street.charAt(0).toUpperCase() + street.slice(1);

  function add(action: BuilderAction) {
    s.setStreetActions(street, [...block.actions, action]);
  }

  return (
    <>
      <span className="m-label">{heading}</span>
      <ol className="m-actions" aria-label={heading}>
        {block.actions.map((a, i) => {
          const [who, rest] = splitAction(describeAction(a), a.position);
          return (
            <li key={i} className="m-actions__row">
              <span>
                <strong>{who}</strong> {rest}
              </span>
              <span className="m-actions__pot">pot {bb(pots[i])}</span>
            </li>
          );
        })}
        {live && (
          <li className="m-actions__turn">
            <span className="m-actions__actor">
              {state.toAct} to act{state.facingBet && ` · facing ${bb(highest)}`}
            </span>
            <span className="m-actions__buttons">
              {state.facingBet ? (
                <>
                  <button type="button" className="m-btn m-btn--secondary" onClick={() => add({ position: state.toAct, action: "fold" })}>
                    Fold
                  </button>
                  <button type="button" className="m-btn m-btn--secondary" onClick={() => add({ position: state.toAct, action: "call" })}>
                    Call {bb(state.toCallBb)}
                  </button>
                </>
              ) : (
                <button type="button" className="m-btn m-btn--secondary" onClick={() => add({ position: state.toAct, action: "check" })}>
                  Check
                </button>
              )}
              <button type="button" className="m-btn m-btn--secondary" onClick={() => setRaiseOpen(true)}>
                {names.button}
              </button>
              <button type="button" className="m-btn m-btn--secondary" onClick={() => add({ position: state.toAct, action: "all_in" })}>
                All-in
              </button>
            </span>
          </li>
        )}
        {!readOnly && state.isTerminal && !state.folded && (
          <li className="m-actions__done">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
              <path d="M5 12l5 5 9-10" />
            </svg>
            {streetName} done · pot {bb(state.potAfterBb)} · stacks {bb(state.stackAfterBb)}
          </li>
        )}
        {state.folded && (
          <li className="m-actions__folded">Someone folded, so there&rsquo;s nothing left to solve. Undo to change it.</li>
        )}
      </ol>
      {raiseOpen && (
        <RaiseSheet
          block={block}
          onClose={() => setRaiseOpen(false)}
          onRaise={(action) => {
            add(action);
            setRaiseOpen(false);
          }}
        />
      )}
    </>
  );
}

/**
 * Pick a bet or raise size (§4.1): three presets plus All-in, a −/+ stepper
 * in 0.5bb steps around the amount, then Cancel or the confirm button.
 */
function RaiseSheet({
  block,
  onClose,
  onRaise,
}: {
  block: StreetBlock;
  onClose: () => void;
  onRaise: (action: BuilderAction) => void;
}) {
  const presets = sizePresets(block);
  const { highest, maxTo } = wagerFacts(block);
  const names = raiseNames(block);
  const player = block.state.toAct;
  // The size picked, or "all-in". Starts on the middle preset each time the
  // sheet opens (it's only mounted while open).
  const [size, setSize] = useState<number | "all-in">(() => presets[1]?.toBb ?? presets[0]?.toBb ?? "all-in");
  const allIn = size === "all-in";
  const step = 0.5;
  const min = Math.ceil((highest + 0.01) / step) * step;

  function nudge(delta: number) {
    const from = allIn ? maxTo : size;
    const next = Math.round((from + delta) / step) * step;
    if (next >= maxTo) setSize("all-in");
    else setSize(Math.max(min, next));
  }

  return (
    <BottomSheet open onClose={onClose} title={`${player} ${names.title}`}>
      <div className="m-raise__presets" role="group" aria-label="Sizes">
        {presets.map((p) => (
          <button
            key={p.toBb}
            type="button"
            className="m-chip m-raise__preset"
            aria-pressed={size === p.toBb}
            onClick={() => setSize(p.toBb)}
          >
            <span>{bb(p.toBb)}</span> <span className="m-raise__sub">{p.sub}</span>
          </button>
        ))}
        <button type="button" className="m-chip m-raise__preset" aria-pressed={allIn} onClick={() => setSize("all-in")}>
          <span>All-in</span> <span className="m-raise__sub">{bb(maxTo)}</span>
        </button>
      </div>
      <div className="m-raise__stepper">
        <button type="button" className="icon-button m-raise__step" aria-label="Smaller" onClick={() => nudge(-step)} disabled={!allIn && size <= min}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="M5 12h14" />
          </svg>
        </button>
        <span className="m-raise__amount" aria-live="polite">
          {allIn ? "All-in" : bb(size)}
        </span>
        <button type="button" className="icon-button m-raise__step" aria-label="Bigger" onClick={() => nudge(step)} disabled={allIn}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
      <div className="m-sheet__buttons">
        <button type="button" className="m-btn m-btn--secondary m-sheet__cancel" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="m-btn m-btn--primary m-sheet__confirm"
          onClick={() =>
            onRaise(
              allIn
                ? { position: player, action: "all_in" }
                : { position: player, action: block.state.aggressiveLabel, toBb: size },
            )
          }
        >
          {allIn ? "All-in" : `${names.confirm} ${bb(size)}`}
        </button>
      </div>
    </BottomSheet>
  );
}

/** A starting stack that isn't one of the chips. */
function StackSheet({ s, onClose }: { s: SolveSetup; onClose: () => void }) {
  const [text, setText] = useState(String(s.startingStackBb));
  const value = Number(text);
  const valid = Number.isFinite(value) && value > 1 && value <= 1000;
  return (
    <BottomSheet open onClose={onClose} title="Starting stack">
      <form
        className="m-sheet__form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          s.setStartingStackBb(value);
          s.setRedoStack([]);
          onClose();
        }}
      >
        <label className="m-field">
          Big blinds
          <input type="number" inputMode="decimal" min={1} step="any" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <button type="submit" className="m-btn m-btn--primary" disabled={!valid}>
          Use {valid ? bb(value) : "this stack"}
        </button>
      </form>
    </BottomSheet>
  );
}

/** Paste a hand history (§4.1): it fills every step, then jumps to Ready. */
function PasteSheet({
  s,
  open,
  onClose,
  onLoaded,
}: {
  s: SolveSetup;
  open: boolean;
  onClose: () => void;
  onLoaded: () => void;
}) {
  function read() {
    const ok = parseHandHistoryToPostflopSetup(s.handHistoryText).kind !== "unrecognized";
    s.loadFromHandHistory();
    if (ok) {
      s.setSetupMode("paste");
      onLoaded();
    }
  }
  return (
    <BottomSheet open={open} onClose={onClose} title="Paste a hand history">
      <p className="m-note">
        It fills in the seats, board, pot and stacks from what happened. The ranges load on their own.
      </p>
      <label className="m-field">
        Hand history
        <textarea
          rows={8}
          value={s.handHistoryText}
          onChange={(e) => s.setHandHistoryText(e.target.value)}
          spellCheck={false}
        />
      </label>
      {s.handHistoryError && (
        <p className="m-error" role="alert">
          {s.handHistoryError}
        </p>
      )}
      <button type="button" className="m-btn m-btn--primary" onClick={read} disabled={!s.handHistoryText.trim()}>
        Read hand
      </button>
    </BottomSheet>
  );
}

/** Step 1 after a hand history was read: what it says, and the one choice
 * left (whether the first player already checked). */
function PastedHand({ s, onPasteAgain }: { s: SolveSetup; onPasteAgain: () => void }) {
  return (
    <section className="m-section">
      <div className="m-card m-card--padded">
        <span className="m-card__title">
          From a hand history: {s.oopPosition} vs {s.ipPosition}
        </span>
        <span className="m-note">
          Pot {bb(s.pastedPotBb)} · Stacks {bb(s.pastedStackBb)} · {s.oopPosition} acts first
        </span>
      </div>
      <label className="m-check">
        <input
          type="checkbox"
          checked={s.oopAlreadyChecked}
          onChange={(e) => s.setOopAlreadyChecked(e.target.checked)}
        />
        {s.oopPosition} already checked: solve {s.ipPosition}&rsquo;s decision
      </label>
      <button type="button" className="m-link" onClick={onPasteAgain}>
        Paste a different hand
      </button>
      <button type="button" className="m-link" onClick={() => s.setSetupMode("click")}>
        Tap through the hand instead
      </button>
    </section>
  );
}
