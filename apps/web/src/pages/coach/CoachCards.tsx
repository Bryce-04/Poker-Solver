import { useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import type { Spot } from "@poker-solver/schema";
import { PlayingCard } from "../../components/PlayingCard/PlayingCard";
import type { CoachMessage, CoachStatus } from "../../lib/api";
import { ACTION_COLOR_VAR } from "../../lib/strategySummary";
import { accuracyOf } from "../solve/solveText";
import { handText } from "./coachText";

// The payloads apps/api stores for each message kind (docs/coach.md §3.1, plus
// the fields Phase 2-3 added: see docs/decisions.md). Every number on a card
// comes from these, which the backend built from tool results.
export interface SpotCardPayload {
  spot: Spot;
  hero_position?: string;
  hero_hand: string | null;
  facts: { k: string; v: string }[];
  assumptions: string[];
}
export interface ResultRow {
  action: string;
  label: string;
  amount_bb?: number;
  freq: number;
}
export interface ResultCardPayload {
  hero_hand: string | null;
  player: string;
  whose?: "hero" | "villain";
  rows: ResultRow[];
  range_rows?: ResultRow[] | null;
  exploitability_pct: number;
  converged: boolean;
  elapsed_s: number;
  bucketed_actions: string[];
  narrowed?: string[];
  notes?: string[];
}
export interface PreflopCardPayload {
  hero_hand: string | null;
  position: string;
  situation: string;
  rows: ResultRow[];
  source?: string;
  note?: string;
}

const BOLT = (
  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M14 2 4 14h6.5L9 22l11-13h-6.5L14 2z" fill="currentColor" />
  </svg>
);

export function CoachAvatar() {
  return <span className="coach-avatar">{BOLT}</span>;
}

export function UserBubble({ text, pending = false }: { text: string; pending?: boolean }) {
  return (
    <div className={`coach-user${pending ? " coach-user--pending" : ""}`}>
      <p className="coach-user__bubble">{text}</p>
    </div>
  );
}

export function CoachText({ paras, note, avatar }: { paras: string[]; note?: string; avatar: boolean }) {
  return (
    <div className="coach-row">
      <span className="coach-row__gutter">{avatar && <CoachAvatar />}</span>
      <div className="coach-text">
        {paras.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
        {note && <p className="coach-text__note">{note}</p>}
      </div>
    </div>
  );
}

/** A card in the Coach's column, indented under its avatar. */
function Indented({ children }: { children: React.ReactNode }) {
  return (
    <div className="coach-row">
      <span className="coach-row__gutter" />
      <div className="coach-row__body">{children}</div>
    </div>
  );
}

function Cards({ hand }: { hand: string }) {
  if (hand.length === 4) {
    return (
      <span className="coach-cards">
        <PlayingCard card={hand.slice(0, 2)} />
        <PlayingCard card={hand.slice(2)} />
      </span>
    );
  }
  return <span className="coach-spot__hand-type">{hand}</span>;
}

export function SpotCard({
  payload,
  onEdit,
  compact = false,
}: {
  payload: SpotCardPayload;
  onEdit: () => void;
  /** Phones (docs/coach.md §9): one row that opens to show the details. */
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(!compact);
  const half = Math.ceil(payload.facts.length / 2);
  return (
    <Indented>
      <section
        className={`coach-card coach-spot${compact ? " coach-spot--compact" : ""}`}
        aria-label="The spot I understood"
      >
        <header className="coach-card__header">
          {compact ? (
            <button
              type="button"
              className="coach-spot__toggle section-label"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              The spot I understood
            </button>
          ) : (
            <span className="section-label">The spot I understood</span>
          )}
          <span className="coach-card__actions">
            {open && (
              <button type="button" className="btn-ghost" onClick={onEdit}>
                Edit
              </button>
            )}
            {/* Opens it the way the Library opens a saved setup: Solve replays
                the hand and loads the ranges itself. */}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => navigate("/solve", { state: { spot: payload.spot } })}
            >
              Open in Solve
            </button>
          </span>
        </header>
        {open && (
        <>
        <div className="coach-spot__body">
          {payload.hero_hand && (
            <div className="coach-spot__group">
              <span className="coach-spot__label">Your hand</span>
              <Cards hand={payload.hero_hand} />
            </div>
          )}
          {payload.spot.board && payload.spot.board.length > 0 && (
            <div className="coach-spot__group">
              <span className="coach-spot__label">Board</span>
              <span className="coach-cards">
                {payload.spot.board.map((c) => (
                  <PlayingCard key={c} card={c} />
                ))}
              </span>
            </div>
          )}
          <dl className="coach-spot__facts">
            {[payload.facts.slice(0, half), payload.facts.slice(half)].map((col, i) => (
              <div className="coach-spot__fact-col" key={i}>
                {col.map((f) => (
                  <div key={f.k}>
                    <dt>{f.k}</dt>
                    <dd>{f.v}</dd>
                  </div>
                ))}
              </div>
            ))}
          </dl>
        </div>
        {payload.assumptions.length > 0 && (
          <p className="coach-spot__assumptions">Assumed: {payload.assumptions.join(", ")}</p>
        )}
        </>
        )}
      </section>
    </Indented>
  );
}

function barColor(action: string): string {
  const preflop: Record<string, string> = {
    raise: "--strategy-bet-mid",
    three_bet: "--strategy-bet-mid",
    four_bet: "--strategy-bet-big",
    continue: "--strategy-passive",
  };
  return `var(${ACTION_COLOR_VAR[action] ?? preflop[action] ?? "--strategy-passive"})`;
}

function Bars({ rows }: { rows: ResultRow[] }) {
  return (
    <ul className="coach-bars">
      {rows.map((r) => (
        <li key={r.action} className="coach-bars__row">
          <span className="coach-bars__label">{r.label}</span>
          <span className="coach-bars__track">
            <span
              className="coach-bars__fill"
              style={{ width: `${Math.round(r.freq * 100)}%`, background: barColor(r.action) } as CSSProperties}
            />
          </span>
          <span className="coach-bars__pct tabular-nums">{Math.round(r.freq * 100)}%</span>
        </li>
      ))}
    </ul>
  );
}

function AccuracyPill({ pct, converged, seconds }: { pct: number; converged: boolean; seconds: number }) {
  const { tier } = accuracyOf(pct, converged);
  const word = tier === "very" ? "Very accurate" : tier === "accurate" ? "Accurate" : "Rough";
  return (
    <span className={`coach-pill coach-pill--${tier}`}>
      {tier !== "rough" && (
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      )}
      {word}
      <span className="coach-pill__time"> · solved in {Math.round(seconds)}s</span>
    </span>
  );
}

export function ResultCard({ payload }: { payload: ResultCardPayload }) {
  const villain = payload.whose === "villain";
  const title = villain
    ? `${payload.player}'s play (it's their turn)`
    : payload.hero_hand && payload.range_rows !== null
      ? `Solver's play with ${handText(payload.hero_hand)}`
      : payload.hero_hand
        ? "Solver's play for your range"
        : "Solver's play";
  const notes = [
    ...(payload.narrowed?.length ? [`Ranges narrowed by the ${payload.narrowed.join(" and ")} action.`] : []),
    ...(payload.notes ?? []),
    ...payload.bucketed_actions,
  ];
  return (
    <Indented>
      <section className="coach-card coach-result" aria-label="Solver result">
        <header className="coach-result__header">
          <h3 className="coach-result__title">{title}</h3>
          <AccuracyPill pct={payload.exploitability_pct} converged={payload.converged} seconds={payload.elapsed_s} />
        </header>
        <Bars rows={payload.rows} />
        {payload.range_rows && payload.range_rows.length > 0 && (
          <details className="coach-result__range">
            <summary>How your whole range plays here</summary>
            <Bars rows={payload.range_rows} />
          </details>
        )}
        {notes.length > 0 && (
          <ul className="coach-result__notes">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </section>
    </Indented>
  );
}

export function PreflopCard({ payload }: { payload: PreflopCardPayload }) {
  return (
    <Indented>
      <section className="coach-card coach-result" aria-label="Chart play">
        <header className="coach-result__header">
          <h3 className="coach-result__title">
            {payload.hero_hand ? `The charts' play with ${handText(payload.hero_hand)}` : "The charts' play"}
          </h3>
          <span className="coach-pill coach-pill--chart">Reference chart</span>
        </header>
        <p className="coach-result__situation">{payload.situation}</p>
        <Bars rows={payload.rows} />
        {payload.note && <p className="coach-result__source">{payload.note}</p>}
      </section>
    </Indented>
  );
}

export function SolvingCard({ street, player, waiting }: { street: string; player: string; waiting: boolean }) {
  return (
    <Indented>
      <section className="coach-card coach-solving" aria-live="polite">
        <h3 className="coach-result__title">
          {waiting ? "Waiting for the solver…" : `Solving the ${player}'s ${street} decision…`}
        </h3>
        <span className="coach-solving__track">
          <span className="coach-solving__bar" />
        </span>
        <p className="coach-solving__hint">
          {waiting
            ? "Another spot is being solved first. Yours starts as soon as it's done."
            : "Usually 10–90 seconds. You can leave this page; the answer will be here when you come back."}
        </p>
      </section>
    </Indented>
  );
}

export function GeneralAdvice({ paras }: { paras: string[] }) {
  return (
    <Indented>
      <section className="coach-advice" aria-label="General advice, not from the solver">
        <span className="coach-advice__label">General advice · not from the solver</span>
        {paras.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </section>
    </Indented>
  );
}

export function Suggestions({
  items,
  disabled,
  onPick,
}: {
  items: string[];
  disabled: boolean;
  onPick: (item: string) => void;
}) {
  return (
    <Indented>
      <div className="coach-suggestions">
        {items.map((item) => (
          <button key={item} type="button" className="btn-secondary" disabled={disabled} onClick={() => onPick(item)}>
            {item}
          </button>
        ))}
      </div>
    </Indented>
  );
}

export function ErrorCard({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <Indented>
      <div className="coach-error" role="alert">
        <p>{text}</p>
        {onRetry && (
          <button type="button" className="btn-secondary" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    </Indented>
  );
}

/**
 * The conversation, one component per message kind. A solving card shows
 * only while its solve is still running (a later result or error replaces
 * it); Try again only on the last message.
 */
export function MessageList({
  messages,
  status,
  pending,
  busy,
  onSend,
  onRetry,
  onEdit,
  compact = false,
}: {
  messages: CoachMessage[];
  status: CoachStatus;
  pending: string | null;
  busy: boolean;
  onSend: (text: string) => void;
  onRetry: () => void;
  onEdit: () => void;
  /** Phones: compact spot cards (docs/coach.md §9). */
  compact?: boolean;
}) {
  const running = status === "working" || status === "waiting_for_solver";
  const lastIndex = messages.length - 1;
  return (
    <div className="coach-messages">
      {messages.map((m, i) => {
        const p = m.payload as Record<string, unknown>;
        const prevKind = messages[i - 1]?.kind;
        switch (m.kind) {
          case "user_text":
            return <UserBubble key={m.seq} text={String(p.text ?? "")} />;
          case "coach_text":
            return (
              <CoachText
                key={m.seq}
                paras={(p.paras as string[]) ?? []}
                note={p.note as string | undefined}
                avatar={prevKind !== "coach_text"}
              />
            );
          case "spot_card":
            return (
              <SpotCard key={m.seq} payload={p as unknown as SpotCardPayload} onEdit={onEdit} compact={compact} />
            );
          case "result_card":
            return <ResultCard key={m.seq} payload={p as unknown as ResultCardPayload} />;
          case "preflop_card":
            return <PreflopCard key={m.seq} payload={p as unknown as PreflopCardPayload} />;
          case "solving": {
            const finished = !running || messages.slice(i + 1).some((n) => n.kind === "result_card" || n.kind === "error");
            if (finished) return null;
            return (
              <SolvingCard
                key={m.seq}
                street={String(p.street ?? "")}
                player={String(p.player ?? "")}
                waiting={status === "waiting_for_solver"}
              />
            );
          }
          case "general_advice":
            return <GeneralAdvice key={m.seq} paras={(p.paras as string[]) ?? []} />;
          case "suggestions":
            return (
              <Suggestions key={m.seq} items={(p.items as string[]) ?? []} disabled={busy} onPick={onSend} />
            );
          case "error":
            return (
              <ErrorCard
                key={m.seq}
                text={String(p.text ?? "Something went wrong.")}
                onRetry={i === lastIndex && !busy ? onRetry : undefined}
              />
            );
          default:
            return null; // a kind this build doesn't know yet
        }
      })}
      {pending && <UserBubble text={pending} pending />}
      {running && !messages.slice(-1).some((m) => m.kind === "solving") && (
        <div className="coach-row coach-thinking" role="status">
          <span className="coach-row__gutter">
            <CoachAvatar />
          </span>
          <span className="coach-thinking__dots" aria-label="The Coach is thinking">
            <span />
            <span />
            <span />
          </span>
        </div>
      )}
    </div>
  );
}
