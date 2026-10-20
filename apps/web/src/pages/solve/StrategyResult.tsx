import { useMemo, useState } from "react";
import type { HandRange, Position, Street } from "@poker-solver/schema";
import type { LiveSolveResponse } from "../../lib/api";
import { StrategyGrid, SuitStrategy } from "../../components/StrategyGrid/StrategyGrid";
import { ACTION_COLOR_VAR, ACTION_ORDER, overallMix } from "../../lib/strategySummary";
import { comboWeights, handMass, indexRange } from "../../lib/rangeCombos";
import { actionLabel, aggressionLine, handAdvice, headline } from "./solveText";

/**
 * The Strategy tab (docs/desktop-redesign.md §6.2): a sentence first, then
 * the whole range's mix as one stacked bar, the enlarged StrategyGrid, and
 * a panel for the clicked hand -- its mix as bars, a plain-English line of
 * advice, and the suit view.
 */
export function StrategyResult({
  data,
  range,
  street,
  opponent,
  deadCards,
}: {
  data: LiveSolveResponse;
  range: HandRange;
  street: Street;
  opponent: Position;
  deadCards: readonly string[];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const index = useMemo(() => indexRange(range), [range]);
  const mass = useMemo(() => handMass(index), [index]);
  const mix = useMemo(() => overallMix(data.strategy, mass), [data.strategy, mass]);
  const player = data.position;

  if (Object.keys(data.strategy).length === 0) {
    return (
      <p className="solve-workspace__empty">
        No hand in that range got enough data to report a strategy. Try a narrower range or board.
      </p>
    );
  }

  return (
    <div className="strategy-result">
      <section className="strategy-result__headline" aria-label="Summary">
        <p className="strategy-result__sentence">{headline(player, street, mix)}</p>
        <p className="strategy-result__line">
          {aggressionLine(data.strategy, mass, mix)} Click any square to see one hand.
        </p>
        <FrequencyBar mix={mix} />
        <ul className="strategy-result__legend">
          {mix.map(([action, share]) => (
            <li key={action}>
              <span className="strategy-result__swatch" style={{ background: `var(${ACTION_COLOR_VAR[action]})` }} aria-hidden="true" />
              {actionLabel(action)}
              <span className="strategy-result__share tabular-nums">{Math.round(share * 100)}%</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="strategy-result__body">
        <div className="strategy-result__grid">
          <StrategyGrid
            strategy={data.strategy}
            comboStrategy={data.combo_strategy}
            deadCards={deadCards}
            range={range}
            selected={selected}
            onSelect={setSelected}
            showDetail={false}
            showLegend={false}
          />
          <p className="strategy-result__caption">
            Each square is a starting hand. Its colors show how often {player} takes each action with
            it. Faded squares are hands {player} rarely has here. Click any square for details.
          </p>
        </div>
        <HandPanel
          hand={selected}
          mix={selected ? data.strategy[selected] : undefined}
          combos={selected ? (mass[selected] ?? 0) : 0}
          player={player}
          opponent={opponent}
          comboStrategy={data.combo_strategy ?? {}}
          deadCards={deadCards}
          comboWeight={selected ? comboWeights(index, selected) : undefined}
        />
      </div>
    </div>
  );
}

/** The range's overall mix as one 34px stacked bar, labelled where it fits. */
function FrequencyBar({ mix }: { mix: [string, number][] }) {
  return (
    <div
      className="strategy-result__bar"
      role="img"
      aria-label={mix.map(([a, p]) => `${actionLabel(a)} ${Math.round(p * 100)}%`).join(", ")}
    >
      {mix.map(([action, share]) => (
        <span
          key={action}
          className="strategy-result__segment"
          style={{ width: `${share * 100}%`, background: `var(${ACTION_COLOR_VAR[action]})` }}
        >
          {share >= 0.12 ? `${actionLabel(action).replace(/ \(.*\)$/, "")} ${Math.round(share * 100)}%` : ""}
        </span>
      ))}
    </div>
  );
}

function HandPanel({
  hand,
  mix,
  combos,
  player,
  opponent,
  comboStrategy,
  deadCards,
  comboWeight,
}: {
  hand: string | null;
  mix: Record<string, number> | undefined;
  combos: number;
  player: Position;
  opponent: Position;
  comboStrategy: Record<string, Record<string, number>>;
  deadCards: readonly string[];
  comboWeight: Record<string, number> | undefined;
}) {
  if (!hand) {
    return (
      <aside className="hand-panel" aria-label="Selected hand">
        <p className="hand-panel__prompt">Click a square on the chart to see what {player} does with that hand.</p>
      </aside>
    );
  }
  const inRange = mix !== undefined && combos > 0;
  // Actions it essentially never takes with this hand (< 0.5%) are left out.
  const rows = mix ? ACTION_ORDER.filter((a) => (mix[a] ?? 0) >= 0.005).map((a) => [a, mix[a]] as const) : [];

  return (
    <aside className="hand-panel" aria-label="Selected hand">
      <div>
        <p className="hand-panel__hand">{hand}</p>
        {inRange && (
          <p className="hand-panel__combos tabular-nums">
            {Math.round(combos * 10) / 10} combos in {player}&rsquo;s range
          </p>
        )}
      </div>
      {inRange ? (
        <>
          <div className="hand-panel__rows">
            {rows.map(([action, share]) => (
              <div key={action} className="hand-panel__row">
                <span className="hand-panel__row-head">
                  <span>{actionLabel(action)}</span>
                  <span className="tabular-nums">{Math.round(share * 100)}%</span>
                </span>
                <span className="hand-panel__track">
                  <span
                    className="hand-panel__fill"
                    style={{ width: `${share * 100}%`, background: `var(${ACTION_COLOR_VAR[action]})` }}
                  />
                </span>
              </div>
            ))}
          </div>
          <p className="hand-panel__advice">{handAdvice(mix, opponent)}</p>
          <SuitStrategy
            hand={hand}
            handMix={mix}
            comboStrategy={comboStrategy}
            deadCards={deadCards}
            comboWeight={comboWeight}
          />
        </>
      ) : (
        <p className="hand-panel__out">
          {player} doesn&rsquo;t get here with this hand: it isn&rsquo;t in {player}&rsquo;s range at this
          point, so there&rsquo;s no strategy for it.
        </p>
      )}
    </aside>
  );
}
