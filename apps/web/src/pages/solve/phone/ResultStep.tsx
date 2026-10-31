import { useMemo, useState } from "react";
import type { Position } from "@poker-solver/schema";
import { BottomSheet } from "../../../components/mobile/BottomSheet";
import { TopBarActions } from "../../../components/mobile/TopBarActions";
import { TopBarTitle } from "../../../components/mobile/TopBarTitle";
import { StrategyGrid } from "../../../components/StrategyGrid/StrategyGrid";
import { saveSpot } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { useOpenAccountSheet } from "../../../lib/mobileShell";
import { comboWeights, handMass, indexRange } from "../../../lib/rangeCombos";
import { ACTION_COLOR_VAR, overallMix } from "../../../lib/strategySummary";
import { accuracyOf, actionLabel, aggressionLine, bb, exploreOptions, headline, type ExploreOption } from "../solveText";
import { FrequencyBar, HandPanel } from "../StrategyResult";
import type { SolveSetup } from "../useSolveSetup";

const SUIT_SYMBOL: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
const SUIT_NAME: Record<string, string> = { s: "spades", h: "hearts", d: "diamonds", c: "clubs" };

type SaveState = "idle" | "saving" | "saved" | "error" | "not-signed-in";

/**
 * The solve's result on phones (docs/mobile-redesign.md §4.5): the board and
 * how accurate the solve is, a sentence and the range's mix, the strategy
 * chart (tap a hand for its sheet: the same panel desktop shows beside the
 * chart), and "Keep exploring". The top bar gets a back arrow to the setup and
 * a Save spot button. Every number and sentence comes from the same functions
 * desktop's StrategyResult uses.
 */
export function ResultStep({
  s,
  onBack,
  onExplore,
}: {
  s: SolveSetup;
  /** Back to the Ready step. */
  onBack: () => void;
  onExplore: (option: ExploreOption) => void;
}) {
  const solved = s.lastSolved;
  if (!solved) {
    return (
      <div className="m-section">
        <h1 className="m-step__title">No result yet</h1>
        <p className="m-step__lede">Solve a spot first.</p>
        <button type="button" className="m-btn m-btn--secondary" onClick={onBack}>
          Back to setup
        </button>
      </div>
    );
  }
  return <Result s={s} solved={solved} onBack={onBack} onExplore={onExplore} />;
}

function Result({
  s,
  solved,
  onBack,
  onExplore,
}: {
  s: SolveSetup;
  solved: NonNullable<SolveSetup["lastSolved"]>;
  onBack: () => void;
  onExplore: (option: ExploreOption) => void;
}) {
  const { data, range, spot } = solved;
  const player = data.position;
  const [oop, ip] = spot.positions_in_hand as [Position, Position];
  const opponent = player === oop ? ip : oop;
  // Always set on a solved spot; the schema type just marks it optional.
  const street = spot.current_street ?? s.currentStreet;
  const board = spot.board ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const index = useMemo(() => indexRange(range), [range]);
  const mass = useMemo(() => handMass(index), [index]);
  const mix = useMemo(() => overallMix(data.strategy, mass), [data.strategy, mass]);
  const accuracy = accuracyOf(data.exploitability_pct, data.converged);
  const options =
    s.setupMode === "click" && s.outcome.kind !== "loading"
      ? exploreOptions(s.currentStreet, s.handSummary.targetState, s.streets[s.currentStreet], s.oopPosition, s.ipPosition)
      : [];
  const empty = Object.keys(data.strategy).length === 0;

  return (
    <>
      <TopBarTitle title={`${player}'s ${street} strategy`} backLabel="Back to setup" onBack={onBack} />
      <SaveButton s={s} />

      <div className="m-result__strip">
        <span className="m-result__cards">
          {board.map((card) => (
            <span
              key={card}
              className="m-mini-card m-mini-card--small"
              data-red={card[1] === "h" || card[1] === "d" || undefined}
              role="img"
              aria-label={`${card[0]} of ${SUIT_NAME[card[1]]}`}
            >
              <span>{card[0]}</span>
              <span>{SUIT_SYMBOL[card[1]]}</span>
            </span>
          ))}
        </span>
        <span className="m-result__spot">
          {oop} vs {ip} · pot {bb(spot.pot_bb ?? 0)}
        </span>
        <span className="m-result__accuracy" data-tier={accuracy.tier}>
          {accuracy.tier === "very" && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
              <path d="M5 12l5 5 9-10" />
            </svg>
          )}
          {accuracy.tier === "very" ? "Very accurate" : accuracy.tier === "accurate" ? "Accurate" : "Rough"}
        </span>
      </div>

      {empty ? (
        <p className="m-note">No hand in that range got enough data to report a strategy. Try a narrower range or board.</p>
      ) : (
        <>
          <section className="m-card m-result__summary" aria-label="Summary">
            <p className="m-result__headline">{headline(player, street, mix)}</p>
            <p className="m-result__line">{aggressionLine(data.strategy, mass, mix)}</p>
            <FrequencyBar mix={mix} />
            <ul className="m-result__legend">
              {mix.map(([action, share]) => (
                <li key={action}>
                  <span className="m-result__swatch" style={{ background: `var(${ACTION_COLOR_VAR[action]})` }} aria-hidden="true" />
                  {actionLabel(action)}
                  <span className="m-result__share">{Math.round(share * 100)}%</span>
                </li>
              ))}
            </ul>
          </section>

          <div className="m-result__grid">
            <StrategyGrid
              strategy={data.strategy}
              comboStrategy={data.combo_strategy}
              deadCards={board}
              range={range}
              selected={selected}
              onSelect={setSelected}
              showDetail={false}
              showLegend={false}
            />
          </div>
          <p className="m-note m-note--small">
            Each square is a starting hand, colored by how often {player} takes each action. Faded squares are
            hands {player} rarely has here. Tap one for details.
          </p>
        </>
      )}

      {options.length > 0 && (
        <section className="m-section" aria-label="Keep exploring">
          <span className="m-label">Keep exploring</span>
          <div className="m-pills">
            {options.map((option) => (
              <button key={option.label} type="button" className="m-pill" onClick={() => onExplore(option)}>
                {option.label}
              </button>
            ))}
          </div>
        </section>
      )}

      <details className="m-details">
        <summary>About this solve</summary>
        <p className="m-note m-note--small">
          {data.iterations.toLocaleString()} rounds of training.
          {data.exploitability_pct !== undefined &&
            ` A perfect opponent could gain at most ${data.exploitability_pct.toFixed(1)}% of the pot against this strategy.`}
          {data.converged === false && " The server's time limit cut it short, so treat close percentages loosely."}
        </p>
        {data.bucketed_actions.length > 0 && (
          <ul className="m-note m-note--small">
            {data.bucketed_actions.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        )}
      </details>

      {selected && (
        <BottomSheet open onClose={() => setSelected(null)} title={<span className="m-hand__name">{selected}</span>}>
          <div className="m-hand-sheet">
            <HandPanel
              hand={selected}
              showHand={false}
              mix={data.strategy[selected]}
              combos={mass[selected] ?? 0}
              player={player}
              opponent={opponent}
              comboStrategy={data.combo_strategy ?? {}}
              category={data.hand_categories?.[selected]}
              reasons={data.hand_reasons?.[selected]}
              deadCards={board}
              comboWeight={comboWeights(index, selected)}
            />
          </div>
        </BottomSheet>
      )}
    </>
  );
}

/** The top bar's Save spot: saves the setup (not the result), as desktop does.
 * Signed out, it opens the account sheet. */
function SaveButton({ s }: { s: SolveSetup }) {
  const auth = useAuth();
  const openAccountSheet = useOpenAccountSheet();
  const [state, setState] = useState<SaveState>("idle");

  async function save() {
    if (auth.status !== "signed-in") {
      setState("not-signed-in");
      openAccountSheet?.();
      return;
    }
    setState("saving");
    const result = await saveSpot(s.setupAsSpot());
    setState(result.kind === "saved" ? "saved" : "error");
  }

  const message =
    state === "saved"
      ? "Saved to your Library."
      : state === "error"
        ? "Couldn't save. Try again."
        : state === "not-signed-in"
          ? "Sign in to save spots."
          : null;

  return (
    <>
      <TopBarActions>
        <button
          type="button"
          className="icon-button"
          aria-label={state === "saved" ? "Saved" : "Save spot"}
          onClick={() => void save()}
          disabled={state === "saving" || state === "saved"}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill={state === "saved" ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 3h12v18l-6-4-6 4V3z" />
          </svg>
        </button>
      </TopBarActions>
      {message && (
        <p className="m-note m-result__saved" role="status">
          {message}
        </p>
      )}
    </>
  );
}
