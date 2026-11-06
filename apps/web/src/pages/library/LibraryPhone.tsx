import { useState } from "react";
import type { Spot } from "@poker-solver/schema";
import { BottomSheet } from "../../components/mobile/BottomSheet";
import { MiniRange } from "../../components/MiniRange/MiniRange";
import { SegmentedControl } from "../../components/SegmentedControl/SegmentedControl";
import { useOpenAccountSheet } from "../../lib/mobileShell";
import { indexRange, totalCombos } from "../../lib/rangeCombos";
import { TOTAL_COMBOS } from "../../lib/rangesSpot";
import { displayName, shortSavedAt, spotKind } from "../../lib/spotText";
import type { CoachConversationSummary } from "../../lib/api";
import { LIBRARY_FILTERS, itemKind, itemName, useLibrary, type ItemKind, type LibraryData } from "./useLibrary";
import "../../components/SpotBuilder/SpotBuilder.css";
import "./LibraryPhone.css";

const SUIT_SYMBOL: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
const SUIT_NAME: Record<string, string> = { s: "spades", h: "hearts", d: "diamonds", c: "clubs" };

type SheetMode = { kind: "view" } | { kind: "rename"; draft: string } | { kind: "confirm-delete" };

/** The day a spot was saved, "Oct 7" (the card has no room for the time). */
function savedDay(spot: Spot): string | null {
  if (!spot.created_at) return null;
  const date = new Date(spot.created_at);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "BTN · 100bb · Oct 7" / "BB vs BTN · 97.5bb · Oct 19". */
function metaLine(spot: Spot): string {
  const kind = spotKind(spot);
  const who = kind === "preflop" ? spot.positions_in_hand[0] : spot.positions_in_hand.join(" vs ");
  const saved = savedDay(spot);
  return [who, `${spot.effective_stack_bb}bb`, saved].filter(Boolean).join(" · ");
}

const KIND_LABEL: Record<ItemKind, string> = { preflop: "Preflop", postflop: "Postflop", conversation: "Conversation" };

/** The filter, with "Chats" for "Conversations": four labels share a phone's width. */
const PHONE_FILTERS = LIBRARY_FILTERS.map((f) => (f.value === "conversations" ? { ...f, label: "Chats" } : f));

function TypePill({ kind }: { kind: ItemKind }) {
  return (
    <span className="m-lib__pill" data-kind={kind}>
      {KIND_LABEL[kind]}
    </span>
  );
}

/** "Coach · Nov 5": a conversation's card line. */
function conversationMeta(c: CoachConversationSummary): string {
  const date = new Date(c.updated_at);
  const day = Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return ["Coach", day].filter(Boolean).join(" · ");
}

/**
 * The Library on phones and tablets (docs/mobile-redesign.md §6, docs/coach.md
 * §10): search, an All / Preflop / Postflop / Conversations filter, and the
 * saved spots and Coach conversations as cards. Tapping a spot opens its
 * sheet: a preview, Open (in Ranges or Solve), and Duplicate / Rename /
 * Delete; a conversation's sheet has Open in Coach, Rename and Delete. The
 * data and actions are useLibrary's, as desktop's.
 */
export function LibraryPhone() {
  const library = useLibrary();
  const { auth, state, spots, conversations, conversationsState, items, query, setQuery, filter, setFilter } = library;
  const openAccountSheet = useOpenAccountSheet();
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = spots.find((s) => s.id === openId) ?? null;
  const [openConversationId, setOpenConversationId] = useState<string | null>(null);
  const openedConversation = conversations.find((c) => c.id === openConversationId) ?? null;

  if (auth.status === "signed-out") {
    return (
      <div className="m-lib__empty">
        <span className="m-lib__empty-icon" aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
            <path d="M6 3h12v18l-6-4-6 4V3z" />
          </svg>
        </span>
        <h1 className="m-step__title">Your saved spots live here</h1>
        <p className="m-lib__empty-text">Sign in to save charts and solves and open them on any device.</p>
        {openAccountSheet && (
          <button type="button" className="m-btn m-btn--primary m-lib__empty-button" onClick={openAccountSheet}>
            Sign in
          </button>
        )}
      </div>
    );
  }

  if (state.kind === "loading") {
    return (
      <p className="m-note" role="status">
        <span className="spot-builder__spinner" aria-hidden="true" />
        Loading your spots&hellip;
      </p>
    );
  }

  if (state.kind === "network-error" || state.kind === "error") {
    return (
      <div className="spot-builder__status-block spot-builder__status-block--error" role="alert">
        <p className="spot-builder__status-title">
          {state.kind === "network-error" ? "Couldn’t reach the server." : "Something went wrong."}
        </p>
        <p>
          {state.kind === "network-error"
            ? "Check your connection and try again. The server may also be waking up — give it a minute."
            : `The request failed with HTTP ${state.status}.`}
        </p>
      </div>
    );
  }

  if (spots.length === 0 && conversations.length === 0) {
    return (
      <div className="m-lib__empty">
        <h1 className="m-step__title">Nothing saved yet</h1>
        <p className="m-lib__empty-text">Save a chart from Ranges or a setup from Solve, or ask the Coach about a spot.</p>
      </div>
    );
  }

  return (
    <div className="m-step">
      <input
        type="search"
        className="m-lib__search"
        placeholder="Search by name, seat or board"
        aria-label="Search by name, seat or board"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <SegmentedControl label="Show" options={PHONE_FILTERS} value={filter} onChange={setFilter} stretch />

      {items.length === 0 ? (
        <p className="m-note">Nothing matches that search.</p>
      ) : (
        <ul className="m-lib__list">
          {items.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                className="m-lib__card"
                onClick={() =>
                  item.type === "conversation"
                    ? setOpenConversationId(item.conversation.id)
                    : setOpenId(item.spot.id ?? null)
                }
              >
                <span className="m-lib__card-text">
                  <span className="m-lib__name">{itemName(item)}</span>
                  <span className="m-lib__meta">
                    <TypePill kind={itemKind(item)} />
                    {item.type === "conversation" ? conversationMeta(item.conversation) : metaLine(item.spot)}
                  </span>
                </span>
                <svg className="m-lib__chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      {conversationsState.kind === "error" && (
        <p className="m-note m-note--small">Couldn&rsquo;t load your Coach conversations. Your spots are all here.</p>
      )}
      <p className="m-note m-note--small m-lib__foot">Only you can see your saved spots and conversations.</p>

      {opened && (
        <SpotSheet
          key={opened.id}
          spot={opened}
          library={library}
          onClose={() => setOpenId(null)}
          onShow={(spot) => setOpenId(spot.id ?? null)}
        />
      )}
      {openedConversation && (
        <ConversationSheet
          key={openedConversation.id}
          conversation={openedConversation}
          library={library}
          onClose={() => setOpenConversationId(null)}
        />
      )}
    </div>
  );
}

/** One spot (§6): what it is, Open, and Duplicate / Rename / Delete. */
function SpotSheet({
  spot,
  library,
  onClose,
  onShow,
}: {
  spot: Spot;
  library: LibraryData;
  onClose: () => void;
  /** Show another spot in the sheet (a fresh duplicate). */
  onShow: (spot: Spot) => void;
}) {
  const [mode, setMode] = useState<SheetMode>({ kind: "view" });
  const [notice, setNotice] = useState<string | null>(null);
  const kind = spotKind(spot);
  const name = displayName(spot);
  const saved = shortSavedAt(spot);
  const hero = spot.positions_in_hand[0];
  const range = spot.ranges?.[hero] ?? {};
  const combos = totalCombos(indexRange(range));
  const description =
    kind === "preflop"
      ? `${hero} chart · ${spot.effective_stack_bb}bb${saved ? ` · saved ${saved}` : ""}`
      : `${spot.positions_in_hand.join(" vs ")} · ${spot.current_street ?? "flop"} · pot ${spot.pot_bb ?? 0}bb${saved ? ` · saved ${saved}` : ""}`;

  async function rename(draft: string) {
    const result = await library.rename(spot, draft);
    if (result.ok) setMode({ kind: "view" });
    else setNotice(result.notice);
  }

  async function remove() {
    const result = await library.remove(spot);
    if (result.ok) onClose();
    else setNotice(result.notice);
  }

  async function duplicate() {
    const result = await library.duplicate(spot);
    if (!result.ok) setNotice(result.notice);
    else if (result.spot) onShow(result.spot);
  }

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={
        <span className="m-lib__sheet-title">
          <TypePill kind={kind} />
          <span>{name}</span>
        </span>
      }
    >
      <p className="m-note">{description}</p>

      {kind === "preflop" ? (
        <div className="m-lib__preview">
          <span className="m-lib__mini">
            <MiniRange range={range} />
          </span>
          <span className="m-lib__share">
            <span>{((combos / TOTAL_COMBOS) * 100).toFixed(1)}% of hands</span>
            <span className="m-note m-note--small">{Math.round(combos)} combos</span>
          </span>
        </div>
      ) : (
        <div className="m-section m-section--tight">
          <span className="m-lib__cards">
            {(spot.board ?? []).map((card) => (
              <span
                key={card}
                className="m-mini-card"
                data-red={card[1] === "h" || card[1] === "d" || undefined}
                role="img"
                aria-label={`${card[0]} of ${SUIT_NAME[card[1]]}`}
              >
                <span>{card[0]}</span>
                <span>{SUIT_SYMBOL[card[1]]}</span>
              </span>
            ))}
          </span>
          <p className="m-note">Saved setup only. Open it and tap Solve to see the strategy again.</p>
        </div>
      )}

      {mode.kind === "rename" ? (
        <form
          className="m-section"
          onSubmit={(e) => {
            e.preventDefault();
            void rename(mode.draft);
          }}
        >
          <label className="m-field">
            New name
            <input
              type="text"
              maxLength={120}
              value={mode.draft}
              onChange={(e) => setMode({ kind: "rename", draft: e.target.value })}
            />
          </label>
          <div className="m-lib__actions">
            <button type="submit" className="m-btn m-btn--primary" disabled={library.busy || mode.draft.trim() === ""}>
              Save name
            </button>
            <button type="button" className="m-btn m-btn--secondary" onClick={() => setMode({ kind: "view" })}>
              Cancel
            </button>
          </div>
        </form>
      ) : mode.kind === "confirm-delete" ? (
        <div className="m-section" role="alertdialog" aria-label={`Delete ${name}?`}>
          <p className="m-note">Delete &ldquo;{name}&rdquo;? This can&rsquo;t be undone.</p>
          <div className="m-lib__actions">
            <button type="button" className="m-btn m-lib__danger" disabled={library.busy} onClick={() => void remove()}>
              Delete
            </button>
            <button type="button" className="m-btn m-btn--secondary" onClick={() => setMode({ kind: "view" })}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <button type="button" className="m-btn m-btn--primary" onClick={() => library.open(spot)}>
            {kind === "preflop" ? "Open in Ranges" : "Open in Solve"}
          </button>
          <div className="m-lib__actions">
            <button type="button" className="m-btn m-btn--secondary" disabled={library.busy} onClick={() => void duplicate()}>
              Duplicate
            </button>
            <button type="button" className="m-btn m-btn--secondary" onClick={() => setMode({ kind: "rename", draft: name })}>
              Rename
            </button>
            <button type="button" className="m-btn m-lib__danger" onClick={() => setMode({ kind: "confirm-delete" })}>
              Delete
            </button>
          </div>
        </>
      )}

      {notice && (
        <p className="m-error" role="alert">
          {notice}
        </p>
      )}
    </BottomSheet>
  );
}

/** One Coach conversation (docs/coach.md §10): Open in Coach, Rename, Delete. */
function ConversationSheet({
  conversation,
  library,
  onClose,
}: {
  conversation: CoachConversationSummary;
  library: LibraryData;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<SheetMode>({ kind: "view" });
  const [notice, setNotice] = useState<string | null>(null);
  const name = conversation.title ?? "New conversation";

  async function rename(draft: string) {
    const result = await library.renameConversation(conversation, draft);
    if (result.ok) setMode({ kind: "view" });
    else setNotice(result.notice);
  }

  async function remove() {
    const result = await library.removeConversation(conversation);
    if (result.ok) onClose();
    else setNotice(result.notice);
  }

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={
        <span className="m-lib__sheet-title">
          <TypePill kind="conversation" />
          <span>{name}</span>
        </span>
      }
    >
      <p className="m-note">{conversationMeta(conversation)}</p>
      {conversation.preview && <p className="m-lib__quote">&ldquo;{conversation.preview}&rdquo;</p>}

      {mode.kind === "rename" ? (
        <form
          className="m-section"
          onSubmit={(e) => {
            e.preventDefault();
            void rename(mode.draft);
          }}
        >
          <label className="m-field">
            New name
            <input
              type="text"
              maxLength={120}
              value={mode.draft}
              onChange={(e) => setMode({ kind: "rename", draft: e.target.value })}
            />
          </label>
          <div className="m-lib__actions">
            <button type="submit" className="m-btn m-btn--primary" disabled={library.busy || mode.draft.trim() === ""}>
              Save name
            </button>
            <button type="button" className="m-btn m-btn--secondary" onClick={() => setMode({ kind: "view" })}>
              Cancel
            </button>
          </div>
        </form>
      ) : mode.kind === "confirm-delete" ? (
        <div className="m-section" role="alertdialog" aria-label={`Delete ${name}?`}>
          <p className="m-note">Delete &ldquo;{name}&rdquo; and all its messages? This can&rsquo;t be undone.</p>
          <div className="m-lib__actions">
            <button type="button" className="m-btn m-lib__danger" disabled={library.busy} onClick={() => void remove()}>
              Delete
            </button>
            <button type="button" className="m-btn m-btn--secondary" onClick={() => setMode({ kind: "view" })}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <button type="button" className="m-btn m-btn--primary" onClick={() => library.openConversation(conversation)}>
            Open in Coach
          </button>
          <div className="m-lib__actions">
            <button type="button" className="m-btn m-btn--secondary" onClick={() => setMode({ kind: "rename", draft: name })}>
              Rename
            </button>
            <button type="button" className="m-btn m-lib__danger" onClick={() => setMode({ kind: "confirm-delete" })}>
              Delete
            </button>
          </div>
        </>
      )}

      {notice && (
        <p className="m-error" role="alert">
          {notice}
        </p>
      )}
    </BottomSheet>
  );
}
