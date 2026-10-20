import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { HandRange, Position } from "@poker-solver/schema";
import { PageHeader } from "../../components/PageHeader/PageHeader";
import { SegmentedControl } from "../../components/SegmentedControl/SegmentedControl";
import { RangeGrid } from "../../components/RangeGrid/RangeGrid";
import { MiniRange } from "../../components/MiniRange/MiniRange";
import { PlayingCard } from "../../components/PlayingCard/PlayingCard";
import { SIX_MAX_POSITIONS } from "../../lib/positions";
import { PAGE_HEADERS } from "../../lib/navigation";
import { saveSpot } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { sameRange } from "../../lib/useReferenceChart";
import { indexRange, totalCombos } from "../../lib/rangeCombos";
import type { Outcome, SolveSetup } from "./useSolveSetup";
import { ActionTimeline } from "./ActionTimeline";
import { BoardSlots } from "./BoardSlots";
import { StrategyResult } from "./StrategyResult";
import {
  accuracyOf,
  bb,
  describePreflop,
  exploreOptions,
  potType,
  preflopRole,
  rangeNote,
  type ExploreOption,
} from "./solveText";
import "../../components/SpotBuilder/SpotBuilder.css";
import "./SolveWorkspace.css";

type Solved = NonNullable<SolveSetup["lastSolved"]>;
type SaveState = "idle" | "saving" | "saved" | "error" | "not-signed-in";

const SETUP_MODES = [
  { value: "click", label: "Click through" },
  { value: "paste", label: "Hand history" },
] as const;

const TOTAL_COMBOS = 1326;
const GLYPH: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
const cardText = (card: string) => `${card[0]}${GLYPH[card[1]] ?? card[1]}`;

/**
 * Desktop Solve (docs/desktop-redesign.md §6.1 / §6.2), at >= 1024px. A rail
 * on the left -- the hand, the board, "ready to solve" while setting up; the
 * spot, its accuracy and "keep exploring" once solved -- and a canvas with
 * Ranges and Strategy tabs. All state is SolvePage's useSolveSetup (shared
 * with the phone layout); this file only adds view state and a few
 * desktop-only conveniences: ranges auto-load once preflop closes, and
 * "Save spot" stores the setup.
 */
export function SolveWorkspace({ setup: s }: { setup: SolveSetup }) {
  const auth = useAuth();
  const [view, setView] = useState<"setup" | "result">("setup");
  const [tab, setTab] = useState<"ranges" | "strategy">("ranges");
  const [activeSide, setActiveSide] = useState<"oop" | "ip">("oop");
  const [openSlot, setOpenSlot] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const { lastSolved } = s;

  // The board here is the picked-card list (BoardSlots' typing box writes it
  // too). A board typed on the phone layout shows as-is until it's edited.
  const boardCards = s.boardMode === "pick" ? s.pickedCards : s.board.kind === "ok" ? s.board.cards : [];
  function setBoardCards(cards: string[]) {
    s.setPickedCards(cards);
    s.setBoardMode("pick");
  }

  /** Solve, and open the result when there is one. */
  async function runSolve(next?: Parameters<SolveSetup["solve"]>[0]) {
    if (await s.solve(next)) {
      setView("result");
      setTab("strategy");
    }
  }

  // Ranges load themselves once preflop has closed (§6.1): both from the
  // preflop line when both are empty, or a typical range for a lone empty
  // one (e.g. arriving from Ranges with one player's chart). Once per setup.
  const oopEmpty = Object.keys(s.oopRange).length === 0;
  const ipEmpty = Object.keys(s.ipRange).length === 0;
  const autoKey =
    s.preflopClosed && (oopEmpty || ipEmpty)
      ? JSON.stringify([s.oopPosition, s.ipPosition, s.startingStackBb, s.streets.preflop, s.setupMode, oopEmpty, ipEmpty])
      : null;
  const autoTried = useRef<string | null>(null);
  const autoLoad = useEffectEvent(() => {
    if (oopEmpty && ipEmpty) void s.autoLoadRanges();
    else {
      const [seat, other] = oopEmpty ? [s.oopPosition, s.ipPosition] : [s.ipPosition, s.oopPosition];
      void s.loadReferenceRange(seat, other, (r) => s.setRangeFor(seat, r), (st) => s.setChartStateFor(seat, st));
    }
  });
  useEffect(() => {
    if (autoKey === null || autoTried.current === autoKey) return;
    autoTried.current = autoKey;
    autoLoad();
  }, [autoKey]);

  function startOver() {
    s.resetAll();
    setView("setup");
    setTab("ranges");
    setOpenSlot(null);
    setSaveState("idle");
    autoTried.current = null;
  }

  async function saveSetup() {
    if (auth.status !== "signed-in") {
      setSaveState("not-signed-in");
      return;
    }
    setSaveState("saving");
    const result = await saveSpot(s.setupAsSpot());
    setSaveState(result.kind === "saved" ? "saved" : "error");
  }

  function explore(option: ExploreOption) {
    const street = s.currentStreet;
    const next = { ...s.streets, [street]: [...s.streets[street], option.action] };
    s.setStreetActions(street, next[street]);
    if (option.dealsNext) {
      setView("setup");
      setTab("ranges");
      setOpenSlot(boardCards.length);
    } else {
      void runSolve(next);
    }
  }

  const header = PAGE_HEADERS["/solve"];
  const showResult = view === "result" && lastSolved !== null;
  const description = showResult
    ? `${s.oopPosition} vs ${s.ipPosition} · ${s.setupMode === "click" ? potType(s.streets.preflop) : "from a hand history"} · ${lastSolved.spot.current_street}`
    : header.description;

  return (
    <div className="solve-workspace">
      <PageHeader
        title={header.title}
        description={description}
        actions={
          <>
            {saveState === "saved" && <span className="solve-workspace__save-note">Saved to your Library.</span>}
            {saveState === "error" && <span className="solve-workspace__save-note solve-workspace__save-note--error">Couldn&rsquo;t save. Try again.</span>}
            {saveState === "not-signed-in" && <span className="solve-workspace__save-note">Sign in (bottom left) to save spots.</span>}
            <button type="button" className="btn-ghost" onClick={startOver}>
              Start over
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={saveSetup}
              disabled={saveState === "saving" || !s.positionsAreValid}
            >
              {saveState === "saving" ? "Saving…" : "Save spot"}
            </button>
          </>
        }
      />

      <div className="solve-workspace__panes">
        {showResult ? (
          <ResultRail
            s={s}
            solved={lastSolved}
            onEdit={() => {
              setView("setup");
              setTab("ranges");
            }}
            onExplore={explore}
          />
        ) : (
          <SetupRail
            s={s}
            boardCards={boardCards}
            onBoardCards={setBoardCards}
            onSolve={() => void runSolve()}
            openSlot={openSlot}
            onOpenSlot={setOpenSlot}
          />
        )}

        <section className="solve-workspace__canvas" aria-label="Ranges and strategy">
          <div className="solve-workspace__tabs" role="tablist" aria-label="View">
            <button
              type="button"
              role="tab"
              className="solve-workspace__tab"
              aria-selected={tab === "ranges"}
              onClick={() => setTab("ranges")}
            >
              Ranges
            </button>
            <button
              type="button"
              role="tab"
              className="solve-workspace__tab"
              aria-selected={tab === "strategy"}
              disabled={lastSolved === null}
              onClick={() => setTab("strategy")}
            >
              {lastSolved === null ? "Strategy · solve first" : "Strategy"}
            </button>
          </div>

          {tab === "strategy" && lastSolved ? (
            <div className="solve-workspace__strategy" data-loading={s.outcome.kind === "loading" || undefined}>
              {s.outcome.kind === "loading" && (
                <p className="solve-workspace__solving" role="status">
                  <span className="spot-builder__spinner" aria-hidden="true" />
                  Solving the new spot&hellip;
                </p>
              )}
              <StrategyResult
                data={lastSolved.data}
                range={lastSolved.range}
                street={lastSolved.spot.current_street ?? "flop"}
                opponent={lastSolved.data.position === s.oopPosition ? s.ipPosition : s.oopPosition}
                deadCards={lastSolved.spot.board ?? []}
              />
            </div>
          ) : (
            <RangesPanel s={s} activeSide={activeSide} onActiveSide={setActiveSide} />
          )}
        </section>
      </div>
    </div>
  );
}

function Badge({ n }: { n: number }) {
  return (
    <span className="solve-workspace__badge" aria-hidden="true">
      {n}
    </span>
  );
}

function SetupRail({
  s,
  boardCards,
  onBoardCards,
  onSolve,
  openSlot,
  onOpenSlot,
}: {
  s: SolveSetup;
  boardCards: string[];
  onBoardCards: (cards: string[]) => void;
  onSolve: () => void;
  openSlot: number | null;
  onOpenSlot: (slot: number | null) => void;
}) {
  const otherSeats = (exclude: Position) => SIX_MAX_POSITIONS.filter((p) => p !== exclude);

  return (
    <aside className="solve-workspace__rail" aria-label="Spot setup">
      <section className="solve-workspace__section">
        <div className="solve-workspace__section-head">
          <h2 className="solve-workspace__section-title">
            <Badge n={1} />
            The hand
          </h2>
          <SegmentedControl
            label="How to enter the hand"
            options={SETUP_MODES}
            value={s.setupMode}
            onChange={s.setSetupMode}
          />
        </div>

        <div className="solve-workspace__seats">
          <label className="solve-workspace__field">
            Acts first
            <select
              value={s.oopPosition}
              onChange={(e) => {
                s.setSeatA(e.target.value as Position);
                s.setSeatB(s.ipPosition);
                s.setRedoStack([]);
              }}
            >
              {otherSeats(s.ipPosition).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="solve-workspace__field">
            Acts last
            <select
              value={s.ipPosition}
              onChange={(e) => {
                s.setSeatA(s.oopPosition);
                s.setSeatB(e.target.value as Position);
                s.setRedoStack([]);
              }}
            >
              {otherSeats(s.oopPosition).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          {s.setupMode === "click" ? (
            <label className="solve-workspace__field">
              Stack (bb)
              <input
                type="number"
                min={0}
                step="any"
                value={s.startingStackBb}
                onChange={(e) => {
                  s.setStartingStackBb(Number(e.target.value));
                  s.setRedoStack([]);
                }}
              />
            </label>
          ) : (
            <span />
          )}
        </div>
        <p className="solve-workspace__hint">
          Seats sort themselves: whoever acts first after the flop goes on the left.
        </p>

        {s.setupMode === "click" ? (
          <ActionTimeline setup={s} />
        ) : (
          <div className="solve-workspace__paste">
            <label className="solve-workspace__field" htmlFor="solve-hh">
              Paste a PokerStars-style hand history. We&rsquo;ll fill in the players, board, pot and
              stacks from it.
            </label>
            <textarea
              id="solve-hh"
              className="solve-workspace__hh"
              rows={8}
              value={s.handHistoryText}
              onChange={(e) => s.setHandHistoryText(e.target.value)}
              placeholder="Paste up to the decision you want to look at"
            />
            <button
              type="button"
              className="btn-secondary solve-workspace__align-start"
              disabled={s.handHistoryText.trim() === ""}
              onClick={s.loadFromHandHistory}
            >
              Read hand history
            </button>
            {s.handHistoryError && <p className="spot-builder__field-error">{s.handHistoryError}</p>}
            {s.pasteLoaded && (
              <>
                <div className="solve-workspace__seats solve-workspace__seats--two">
                  <label className="solve-workspace__field">
                    Pot (bb)
                    <input type="number" min={0} step="any" value={s.pastedPotBb} onChange={(e) => s.setPastedPotBb(Number(e.target.value))} />
                  </label>
                  <label className="solve-workspace__field">
                    Stacks (bb)
                    <input type="number" min={0} step="any" value={s.pastedStackBb} onChange={(e) => s.setPastedStackBb(Number(e.target.value))} />
                  </label>
                </div>
                <label className="solve-workspace__check">
                  <input
                    type="checkbox"
                    checked={s.oopAlreadyChecked}
                    onChange={(e) => s.setOopAlreadyChecked(e.target.checked)}
                  />
                  {s.oopPosition} already checked: solve {s.ipPosition}&rsquo;s decision
                </label>
              </>
            )}
          </div>
        )}
      </section>

      <section className="solve-workspace__section">
        <h2 className="solve-workspace__section-title">
          <Badge n={2} />
          The board
        </h2>
        <BoardSlots cards={boardCards} onChange={onBoardCards} openSlot={openSlot} onOpenSlot={onOpenSlot} />
      </section>

      <ReadyCard s={s} onSolve={onSolve} />
    </aside>
  );
}

function Check({ ok }: { ok: boolean }) {
  return ok ? (
    <svg className="solve-workspace__check-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
      <path d="M5 12l5 5 9-10" />
    </svg>
  ) : (
    <span className="solve-workspace__check-empty" aria-hidden="true" />
  );
}

function ReadyCard({ s, onSolve }: { s: SolveSetup; onSolve: () => void }) {
  const click = s.setupMode === "click";
  const handOk = click ? s.preflopClosed && s.handSummary.blockedReason === null : s.pasteLoaded;
  const handText = handOk
    ? click
      ? `Hand set up: ${s.oopPosition} vs ${s.ipPosition}, ${potType(s.streets.preflop)}`
      : `Hand read: ${s.oopPosition} vs ${s.ipPosition}`
    : click
      ? s.handSummary.blockedReason && s.boardLength >= 3
        ? s.handSummary.blockedReason
        : "Finish the preflop action"
      : "Read a hand history";
  const boardOk = s.board.kind === "ok";
  const street = s.board.kind === "ok" ? ["Flop", "Turn", "River"][s.board.cards.length - 3] : "";
  const boardText = boardOk
    ? `${street} picked: ${s.board.kind === "ok" ? s.board.cards.map(cardText).join(" ") : ""}`
    : s.boardLength < 3
      ? "Pick the flop (3 cards)"
      : "Fix the board";
  const missingRange = [
    Object.keys(s.oopRange).length === 0 ? s.oopPosition : null,
    Object.keys(s.ipRange).length === 0 ? s.ipPosition : null,
  ].filter(Boolean);
  const rangesText = s.rangesAreValid
    ? "Both ranges loaded"
    : `Add hands to ${missingRange.join(" and ")}'s range`;
  const solving = s.outcome.kind === "loading";
  const label =
    s.canSubmit && s.currentStreet !== "preflop"
      ? `Solve ${s.decisionPosition}'s ${s.currentStreet} decision`
      : "Solve";

  return (
    <section className="solve-workspace__ready" aria-label="Ready to solve">
      <h2 className="solve-workspace__section-title">
        <Badge n={3} />
        Ready to solve
      </h2>
      <ul className="solve-workspace__checklist">
        <li data-ok={handOk || undefined}>
          <Check ok={handOk} />
          {handText}
        </li>
        <li data-ok={boardOk || undefined}>
          <Check ok={boardOk} />
          {boardText}
        </li>
        <li data-ok={s.rangesAreValid || undefined}>
          <Check ok={s.rangesAreValid} />
          {rangesText}
        </li>
      </ul>
      <button
        type="button"
        className="btn-primary solve-workspace__solve"
        disabled={!s.canSubmit || solving}
        onClick={onSolve}
      >
        {solving ? (
          <>
            <span className="spot-builder__spinner" aria-hidden="true" />
            Solving&hellip;
          </>
        ) : (
          label
        )}
      </button>
      <p className="solve-workspace__ready-foot">Usually 10–90 seconds. This is a real solve, not a lookup.</p>
      <SolveProblem outcome={s.outcome} />
    </section>
  );
}

/** Why a solve didn't come back with a result, if it didn't. */
function SolveProblem({ outcome }: { outcome: Outcome }) {
  switch (outcome.kind) {
    case "invalid":
      return (
        <div className="spot-builder__status-block spot-builder__status-block--error" role="alert">
          <p className="spot-builder__status-title">The server couldn&rsquo;t use this spot.</p>
          <ul className="spot-builder__issues">
            {outcome.issues.map((issue, i) => (
              <li key={i}>
                <code className="spot-builder__issue-loc">{issue.loc.join(" > ")}</code> &mdash; {issue.msg}
              </li>
            ))}
          </ul>
        </div>
      );
    case "rejected":
      return (
        <div className="spot-builder__status-block spot-builder__status-block--error" role="alert">
          <p className="spot-builder__status-title">Can&rsquo;t solve this spot yet.</p>
          <p>{outcome.reason}</p>
        </div>
      );
    case "busy":
      return (
        <div className="spot-builder__status-block spot-builder__status-block--error" role="alert">
          <p className="spot-builder__status-title">The solver is busy.</p>
          <p>Another solve is already running on the server. Try again in a minute.</p>
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
      return null;
  }
}

function ResultRail({
  s,
  solved,
  onEdit,
  onExplore,
}: {
  s: SolveSetup;
  solved: Solved;
  onEdit: () => void;
  onExplore: (option: ExploreOption) => void;
}) {
  const { spot, data, elapsedMs } = solved;
  const accuracy = accuracyOf(data.exploitability_pct, data.converged);
  const toAct = data.position;
  const options =
    s.setupMode === "click" && s.outcome.kind !== "loading"
      ? exploreOptions(s.currentStreet, s.handSummary.targetState, s.streets[s.currentStreet], s.oopPosition, s.ipPosition)
      : [];

  return (
    <aside className="solve-workspace__rail" aria-label="Spot summary">
      <section className="solve-workspace__card">
        <div className="solve-workspace__card-head">
          <h2 className="solve-workspace__section-title">The spot</h2>
          <button type="button" className="solve-workspace__link" onClick={onEdit}>
            Edit setup
          </button>
        </div>
        <div className="solve-workspace__mini-board">
          {(spot.board ?? []).map((card) => (
            <PlayingCard key={card} card={card} />
          ))}
        </div>
        <dl className="solve-workspace__facts">
          <div>
            <dt>Preflop</dt>
            <dd>{s.setupMode === "click" ? describePreflop(s.streets.preflop) || "No action" : "From a hand history"}</dd>
          </div>
          <div>
            <dt>To act</dt>
            <dd>
              {toAct} ({toAct === s.oopPosition ? "acts first" : "acts last"})
            </dd>
          </div>
          <div>
            <dt>Pot</dt>
            <dd className="tabular-nums">{bb(spot.pot_bb ?? 0)}</dd>
          </div>
          <div>
            <dt>Stacks</dt>
            <dd className="tabular-nums">{bb(spot.effective_stack_bb)}</dd>
          </div>
        </dl>
      </section>

      <section className="solve-workspace__accuracy" data-tier={accuracy.tier} aria-label="Accuracy">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          {accuracy.tier === "rough" ? <path d="M12 8v5M12 16h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6A2 2 0 0 0 22 18L13.7 3.9a2 2 0 0 0-3.4 0z" /> : <path d="M5 12l5 5 9-10" />}
        </svg>
        <div>
          <p className="solve-workspace__accuracy-title">{accuracy.title}</p>
          <p className="solve-workspace__accuracy-body">
            Solved in {Math.max(1, Math.round(elapsedMs / 1000))} second{Math.round(elapsedMs / 1000) === 1 ? "" : "s"}.
            {data.exploitability_pct !== undefined &&
              ` A perfect opponent could gain at most ${data.exploitability_pct.toFixed(1)}% of the pot against this strategy.`}
          </p>
          {data.bucketed_actions.length > 0 && (
            <ul className="solve-workspace__bucketed">
              {data.bucketed_actions.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <SolveProblem outcome={s.outcome} />

      {options.length > 0 && (
        <section className="solve-workspace__explore" aria-label="Keep exploring">
          <span className="section-label">Keep exploring</span>
          {options.map((option) => (
            <button key={option.label} type="button" className="btn-secondary solve-workspace__explore-btn" onClick={() => onExplore(option)}>
              {option.label}
              <span aria-hidden="true">→</span>
            </button>
          ))}
          <p className="solve-workspace__hint">
            Each one adds that action to the hand, then solves again or asks for the next card.
          </p>
        </section>
      )}
    </aside>
  );
}

function RangesPanel({
  s,
  activeSide,
  onActiveSide,
}: {
  s: SolveSetup;
  activeSide: "oop" | "ip";
  onActiveSide: (side: "oop" | "ip") => void;
}) {
  const players = (["oop", "ip"] as const).map((side) => {
    const position = side === "oop" ? s.oopPosition : s.ipPosition;
    const range = side === "oop" ? s.oopRange : s.ipRange;
    const role = s.setupMode === "click" ? preflopRole(position, s.streets.preflop) : "";
    return { side, position, range, role };
  });
  const active = players.find((p) => p.side === activeSide) ?? players[0];
  const loaded = s.loadedRanges[active.position];
  const note = rangeNote(active.position, active.role, active.range);
  const combos = totalCombos(indexRange(active.range));
  const narrowNeedsStreet = s.narrowStreets.length === 0;
  const anyLoaded = players.some((p) => s.loadedRanges[p.position]);
  const loadingRanges =
    s.preflopLoad.kind === "loading" || players.some((p) => s.chartStates[p.position]?.kind === "loading");

  return (
    <div className="solve-workspace__ranges">
      <div className="solve-workspace__strip">
        <p>
          <strong>Ranges are the hands each player could have by now.</strong>{" "}
          {anyLoaded
            ? "We've loaded a standard starting point from the preflop action. Click or drag on the chart to adjust it."
            : "Finish the preflop action and we'll load a standard starting point for both players. Or paint them yourself."}
        </p>
        <div className="solve-workspace__strip-actions">
          <button
            type="button"
            className="btn-secondary"
            disabled={!s.preflopClosed || loadingRanges}
            title={s.preflopClosed ? undefined : "Finish the preflop action first"}
            onClick={() => void s.autoLoadRanges()}
          >
            {loadingRanges ? "Loading…" : s.canUsePreflopLine ? "Reload from preflop action" : "Load typical ranges"}
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={narrowNeedsStreet || s.narrowState.kind === "loading" || !s.rangesAreValid}
            title={narrowNeedsStreet ? "Available once a flop or turn action is recorded" : undefined}
            onClick={() => void s.narrowByEarlierStreets()}
          >
            {s.narrowState.kind === "loading" ? `Narrowing by the ${s.narrowState.street}…` : "Narrow by earlier action"}
          </button>
          {s.rangesBeforeNarrow && s.narrowState.kind === "done" && (
            <button type="button" className="btn-ghost" onClick={s.undoNarrowing}>
              Undo narrowing
            </button>
          )}
        </div>
        <RangesStatus s={s} positions={players.map((p) => p.position)} />
      </div>

      <div className="solve-workspace__ranges-body">
        <div className="solve-workspace__big-grid">
          <div className="solve-workspace__ptabs">
            {players.map((p) => (
              <button
                key={p.side}
                type="button"
                className="solve-workspace__ptab"
                aria-pressed={p.side === activeSide}
                onClick={() => onActiveSide(p.side)}
              >
                <span className="solve-workspace__ptab-name">{p.position}&rsquo;s range</span>
                <span className="solve-workspace__ptab-sub">
                  {p.side === "oop" ? "Acts first" : "Acts last"}
                  {p.role && ` · ${p.role}`}
                </span>
              </button>
            ))}
          </div>
          <RangeGrid
            value={active.range}
            onChange={(r) => s.setRangeFor(active.position, r)}
            deadCards={s.board.kind === "ok" ? s.board.cards : []}
            reset={loaded ? { label: "Reset", onClick: () => s.setRangeFor(active.position, loaded.range) } : undefined}
            showSummary={false}
          />
          <div className="solve-workspace__grid-foot">
            <span className="tabular-nums">
              <strong>{Math.round(combos)}</strong> combos · {((combos / TOTAL_COMBOS) * 100).toFixed(1)}% of all hands
            </span>
            <span className="solve-workspace__legend">
              <span><i className="solve-workspace__key solve-workspace__key--always" aria-hidden="true" />Always</span>
              <span><i className="solve-workspace__key solve-workspace__key--some" aria-hidden="true" />Sometimes (fill = how often)</span>
              <span><i className="solve-workspace__key solve-workspace__key--never" aria-hidden="true" />Never</span>
            </span>
          </div>
          {note && <p className="solve-workspace__hint">{note}</p>}
        </div>

        <div className="solve-workspace__both">
          <span className="section-label">Both players</span>
          {players.map((p) => (
            <button
              key={p.side}
              type="button"
              className="solve-workspace__ptab solve-workspace__player-card"
              aria-pressed={p.side === activeSide}
              aria-label={`Show ${p.position}'s range`}
              onClick={() => onActiveSide(p.side)}
            >
              <span className="solve-workspace__player-head">
                <span className="solve-workspace__ptab-name">{p.position}</span>
                <span className="tabular-nums">{((totalCombos(indexRange(p.range)) / TOTAL_COMBOS) * 100).toFixed(1)}%</span>
              </span>
              <MiniRange range={p.range} />
              <span className="solve-workspace__ptab-sub">{rangeSource(s.loadedRanges[p.position], p.range)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function rangeSource(loaded: { range: HandRange; source: string } | undefined, range: HandRange): string {
  if (Object.keys(range).length === 0) return "No hands yet";
  if (!loaded) return "Built by hand";
  return sameRange(loaded.range, range) ? loaded.source : `${loaded.source}, edited`;
}

function RangesStatus({ s, positions }: { s: SolveSetup; positions: Position[] }) {
  const notes: { text: string; error: boolean }[] = [];
  if (s.preflopLoad.kind === "unavailable") notes.push({ text: s.preflopLoad.reason, error: true });
  for (const p of positions) {
    const st = s.chartStates[p];
    if (st?.kind === "unavailable") notes.push({ text: st.reason, error: true });
  }
  if (s.narrowState.kind === "done") {
    notes.push({
      text: `Narrowed by ${s.narrowState.streets}.${s.narrowState.trimmedNote} Hands with only some suits left show a dot: use Suits to see which.`,
      error: false,
    });
  }
  if (s.narrowState.kind === "failed") notes.push({ text: s.narrowState.reason, error: true });
  if (notes.length === 0) return null;
  return (
    <div className="solve-workspace__strip-notes">
      {notes.map((n, i) => (
        <p key={i} className={n.error ? "spot-builder__field-error" : "solve-workspace__hint"} role={n.error ? "alert" : "status"}>
          {n.text}
        </p>
      ))}
    </div>
  );
}
