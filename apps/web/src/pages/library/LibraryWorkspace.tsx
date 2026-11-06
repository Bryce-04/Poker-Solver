import { useState } from "react";
import { Link } from "react-router-dom";
import type { Spot } from "@poker-solver/schema";
import { PageHeader } from "../../components/PageHeader/PageHeader";
import { SegmentedControl } from "../../components/SegmentedControl/SegmentedControl";
import { MiniRange } from "../../components/MiniRange/MiniRange";
import { PlayingCard } from "../../components/PlayingCard/PlayingCard";
import { PAGE_HEADERS } from "../../lib/navigation";
import { indexRange, totalCombos } from "../../lib/rangeCombos";
import { boardText, displayName, shortSavedAt, spotKind } from "../../lib/spotText";
import type { CoachConversationSummary } from "../../lib/api";
import { LIBRARY_FILTERS as FILTERS, itemKind, itemName, useLibrary, type ItemKind, type LibraryItem } from "./useLibrary";
import "../../components/SpotBuilder/SpotBuilder.css";
import "./LibraryWorkspace.css";

type PanelMode = { kind: "view" } | { kind: "rename"; draft: string } | { kind: "confirm-delete" };

const TOTAL_COMBOS = 1326;

/**
 * Desktop Library (docs/desktop-redesign.md §6.4, docs/coach.md §10): the
 * signed-in user's saved spots and Coach conversations as a searchable,
 * filterable table, a preview of the selected one, and open / rename /
 * duplicate / delete. Opening hands a spot to Ranges (a preflop chart) or Solve
 * (a setup with a board) as route state; a conversation opens in the Coach.
 * The data and actions are useLibrary's, shared with the phone page.
 */
export function LibraryWorkspace() {
  const library = useLibrary();
  const { auth, state, spots, conversations, conversationsState, items, query, setQuery, filter, setFilter, busy, open } =
    library;

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelMode>({ kind: "view" });
  const [notice, setNotice] = useState<string | null>(null);

  const selected = items.find((i) => i.key === selectedKey) ?? items[0];

  function selectItem(item: LibraryItem, mode: PanelMode = { kind: "view" }) {
    setSelectedKey(item.key);
    setPanel(mode);
    setNotice(null);
  }

  function select(spot: Spot, mode: PanelMode = { kind: "view" }) {
    selectItem({ type: "spot", key: `spot:${spot.id ?? displayName(spot)}`, date: null, spot }, mode);
  }

  async function rename(spot: Spot, name: string) {
    const result = await library.rename(spot, name);
    if (result.ok) setPanel({ kind: "view" });
    else setNotice(result.notice);
  }

  async function remove(spot: Spot) {
    const result = await library.remove(spot);
    if (result.ok) {
      setPanel({ kind: "view" });
      setSelectedKey(null);
    } else {
      setNotice(result.notice);
    }
  }

  async function renameConversation(c: CoachConversationSummary, title: string) {
    const result = await library.renameConversation(c, title);
    if (result.ok) setPanel({ kind: "view" });
    else setNotice(result.notice);
  }

  async function removeConversation(c: CoachConversationSummary) {
    const result = await library.removeConversation(c);
    if (result.ok) {
      setPanel({ kind: "view" });
      setSelectedKey(null);
    } else {
      setNotice(result.notice);
    }
  }

  async function duplicate(spot: Spot) {
    const result = await library.duplicate(spot);
    if (!result.ok) setNotice(result.notice);
    else if (result.spot) select(result.spot);
  }

  const header = PAGE_HEADERS["/library"];

  return (
    <div className="library">
      <PageHeader
        title={header.title}
        description={header.description}
        actions={
          <>
            <Link to="/ranges" className="btn-secondary">
              New preflop chart
            </Link>
            <Link to="/solve" className="btn-primary">
              New solve
            </Link>
          </>
        }
      />

      <div className="library__body">
        {auth.status === "signed-out" ? (
          <div className="library__message">
            <p className="library__message-title">Sign in to see your Library.</p>
            <p>
              Saved charts and setups belong to your account, and only you can see them. Use Sign in
              at the bottom left.
            </p>
          </div>
        ) : state.kind === "loading" ? (
          <p className="library__loading" role="status">
            <span className="spot-builder__spinner" aria-hidden="true" />
            Loading your spots&hellip;
          </p>
        ) : state.kind === "network-error" ? (
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
        ) : state.kind === "error" ? (
          <div className="spot-builder__status-block spot-builder__status-block--error" role="alert">
            <p className="spot-builder__status-title">Something went wrong.</p>
            <p>The request failed with HTTP {state.status}.</p>
          </div>
        ) : spots.length === 0 && conversations.length === 0 ? (
          <div className="library__message">
            <p className="library__message-title">Nothing saved yet.</p>
            <p>
              Save a chart from Ranges or a setup from Solve, or ask the Coach about a spot, and it&rsquo;ll
              show up here.
            </p>
          </div>
        ) : (
          <div className="library__columns">
            <div className="library__main">
              <div className="library__toolbar">
                <input
                  type="search"
                  className="library__search"
                  placeholder="Search by name, seat or board"
                  aria-label="Search by name, seat or board"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <SegmentedControl label="Show" options={FILTERS} value={filter} onChange={setFilter} />
              </div>

              <div className="library__table-wrap">
                <table className="library__table">
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Type</th>
                      <th scope="col">Players</th>
                      <th scope="col">Stack</th>
                      <th scope="col">Board</th>
                      <th scope="col">Saved</th>
                      <th scope="col">
                        <span className="library__sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const name = itemName(item);
                      const kind = itemKind(item);
                      const isSelected = item.key === selected?.key || undefined;
                      if (item.type === "conversation") {
                        const c = item.conversation;
                        return (
                          <tr key={item.key} data-selected={isSelected}>
                            <td>
                              <button type="button" className="library__name" onClick={() => selectItem(item)}>
                                {name}
                              </button>
                            </td>
                            <td>
                              <KindPill kind={kind} />
                            </td>
                            <td>—</td>
                            <td>—</td>
                            <td>—</td>
                            <td className="tabular-nums">{shortDate(c.updated_at)}</td>
                            <td>
                              <RowActions
                                name={name}
                                onOpen={() => library.openConversation(c)}
                                onRename={() => selectItem(item, { kind: "rename", draft: name })}
                                onDelete={() => selectItem(item, { kind: "confirm-delete" })}
                              />
                            </td>
                          </tr>
                        );
                      }
                      const spot = item.spot;
                      return (
                        <tr key={item.key} data-selected={isSelected}>
                          <td>
                            <button type="button" className="library__name" onClick={() => selectItem(item)}>
                              {name}
                            </button>
                          </td>
                          <td>
                            <KindPill kind={kind} />
                          </td>
                          <td>{spot.positions_in_hand.join(" vs ")}</td>
                          <td className="tabular-nums">{spot.effective_stack_bb}bb</td>
                          <td>{kind === "postflop" ? boardText(spot.board ?? []) : "—"}</td>
                          <td className="tabular-nums">{shortSavedAt(spot) ?? "—"}</td>
                          <td>
                            <RowActions
                              name={name}
                              onOpen={() => open(spot)}
                              onRename={() => selectItem(item, { kind: "rename", draft: name })}
                              onDelete={() => selectItem(item, { kind: "confirm-delete" })}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {items.length === 0 && <p className="library__no-results">Nothing matches that search.</p>}
              </div>
              {conversationsState.kind === "error" && (
                <p className="library__tip">Couldn&rsquo;t load your Coach conversations. Your spots are all here.</p>
              )}
              <p className="library__tip">
                Tip: save a chart from Ranges or a setup from Solve, and it shows up here. So do your Coach
                conversations.
              </p>
            </div>

            {selected?.type === "spot" && (
              <SpotPreview
                spot={selected.spot}
                panel={panel}
                busy={busy}
                notice={notice}
                onPanel={setPanel}
                onOpen={() => open(selected.spot)}
                onRename={(name) => void rename(selected.spot, name)}
                onDelete={() => void remove(selected.spot)}
                onDuplicate={() => void duplicate(selected.spot)}
              />
            )}
            {selected?.type === "conversation" && (
              <ConversationPreview
                conversation={selected.conversation}
                panel={panel}
                busy={busy}
                notice={notice}
                onPanel={setPanel}
                onOpen={() => library.openConversation(selected.conversation)}
                onRename={(title) => void renameConversation(selected.conversation, title)}
                onDelete={() => void removeConversation(selected.conversation)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const KIND_LABEL: Record<ItemKind, string> = { preflop: "Preflop", postflop: "Postflop", conversation: "Conversation" };

function KindPill({ kind, start = false }: { kind: ItemKind; start?: boolean }) {
  return (
    <span className={`library__pill${start ? " library__pill--start" : ""}`} data-kind={kind}>
      {KIND_LABEL[kind]}
    </span>
  );
}

/** "Nov 5, 9:41 AM": a conversation's last update. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function RowActions({
  name,
  onOpen,
  onRename,
  onDelete,
}: {
  name: string;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <span className="library__row-actions">
      <button type="button" className="library__open" onClick={onOpen}>
        Open
      </button>
      <button type="button" className="library__icon" aria-label={`Rename ${name}`} onClick={onRename}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 20h4L19 9l-4-4L4 16v4z" />
        </svg>
      </button>
      <button type="button" className="library__icon" aria-label={`Delete ${name}`} onClick={onDelete}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
        </svg>
      </button>
    </span>
  );
}

/** A Coach conversation (docs/coach.md §10): its title, latest Coach text,
 * Open in Coach, and Rename / Delete (no duplicate). */
function ConversationPreview({
  conversation,
  panel,
  busy,
  notice,
  onPanel,
  onOpen,
  onRename,
  onDelete,
}: {
  conversation: CoachConversationSummary;
  panel: PanelMode;
  busy: boolean;
  notice: string | null;
  onPanel: (panel: PanelMode) => void;
  onOpen: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const name = conversation.title ?? "New conversation";
  return (
    <aside className="library__preview" aria-label="Selected conversation">
      <KindPill kind="conversation" start />
      {panel.kind === "rename" ? (
        <form
          className="library__rename"
          onSubmit={(e) => {
            e.preventDefault();
            onRename(panel.draft);
          }}
        >
          <label className="section-label" htmlFor="library-rename">
            Rename
          </label>
          <input
            id="library-rename"
            type="text"
            maxLength={120}
            autoFocus
            value={panel.draft}
            onChange={(e) => onPanel({ kind: "rename", draft: e.target.value })}
          />
          <span className="library__preview-actions">
            <button type="submit" className="btn-secondary" disabled={busy || panel.draft.trim() === ""}>
              Save name
            </button>
            <button type="button" className="btn-ghost" onClick={() => onPanel({ kind: "view" })}>
              Cancel
            </button>
          </span>
        </form>
      ) : (
        <h2 className="library__preview-name">{name}</h2>
      )}
      <p className="library__preview-desc">Coach conversation · updated {shortDate(conversation.updated_at)}</p>
      {conversation.preview && <p className="library__preview-quote">&ldquo;{conversation.preview}&rdquo;</p>}

      <button type="button" className="btn-primary" onClick={onOpen}>
        Open in Coach
      </button>

      {panel.kind === "confirm-delete" ? (
        <div className="library__confirm" role="alertdialog" aria-label={`Delete ${name}?`}>
          <p>
            Delete &ldquo;{name}&rdquo; and all its messages? This can&rsquo;t be undone.
          </p>
          <span className="library__preview-actions">
            <button type="button" className="btn-danger" disabled={busy} onClick={onDelete}>
              Delete
            </button>
            <button type="button" className="btn-ghost" onClick={() => onPanel({ kind: "view" })}>
              Cancel
            </button>
          </span>
        </div>
      ) : (
        <span className="library__preview-actions library__preview-actions--spread">
          <button type="button" className="btn-ghost" onClick={() => onPanel({ kind: "rename", draft: name })}>
            Rename
          </button>
          <button type="button" className="btn-danger" onClick={() => onPanel({ kind: "confirm-delete" })}>
            Delete
          </button>
        </span>
      )}
      {notice && (
        <p className="spot-builder__field-error" role="alert">
          {notice}
        </p>
      )}
    </aside>
  );
}

function SpotPreview({
  spot,
  panel,
  busy,
  notice,
  onPanel,
  onOpen,
  onRename,
  onDelete,
  onDuplicate,
}: {
  spot: Spot;
  panel: PanelMode;
  busy: boolean;
  notice: string | null;
  onPanel: (panel: PanelMode) => void;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const name = displayName(spot);
  const kind = spotKind(spot);
  const saved = shortSavedAt(spot);
  const hero = spot.positions_in_hand[0];
  const range = spot.ranges?.[hero] ?? {};
  const combos = totalCombos(indexRange(range));
  const description =
    kind === "preflop"
      ? `${hero} chart · ${spot.effective_stack_bb}bb${saved ? ` · saved ${saved}` : ""}`
      : `${spot.positions_in_hand.join(" vs ")} · ${spot.current_street ?? "flop"} · pot ${spot.pot_bb ?? 0}bb${saved ? ` · saved ${saved}` : ""}`;

  return (
    <aside className="library__preview" aria-label="Selected spot">
      <KindPill kind={kind} start />

      {panel.kind === "rename" ? (
        <form
          className="library__rename"
          onSubmit={(e) => {
            e.preventDefault();
            onRename(panel.draft);
          }}
        >
          <label className="section-label" htmlFor="library-rename">
            Rename
          </label>
          <input
            id="library-rename"
            type="text"
            maxLength={120}
            autoFocus
            value={panel.draft}
            onChange={(e) => onPanel({ kind: "rename", draft: e.target.value })}
          />
          <span className="library__preview-actions">
            <button type="submit" className="btn-secondary" disabled={busy || panel.draft.trim() === ""}>
              Save name
            </button>
            <button type="button" className="btn-ghost" onClick={() => onPanel({ kind: "view" })}>
              Cancel
            </button>
          </span>
        </form>
      ) : (
        <h2 className="library__preview-name">{name}</h2>
      )}
      <p className="library__preview-desc">{description}</p>

      {kind === "preflop" ? (
        <div className="library__preview-range">
          <MiniRange range={range} />
          <span className="tabular-nums">
            {((combos / TOTAL_COMBOS) * 100).toFixed(1)}% of hands · {Math.round(combos)} combos
          </span>
        </div>
      ) : (
        <div className="library__preview-board">
          <span className="library__cards">
            {(spot.board ?? []).map((card) => (
              <PlayingCard key={card} card={card} />
            ))}
          </span>
          <p>
            This saves the setup: hand, board and ranges. Solve results aren&rsquo;t saved yet. Open it
            and press Solve to see the strategy again.
          </p>
        </div>
      )}

      <button type="button" className="btn-primary" onClick={onOpen}>
        {kind === "preflop" ? "Open in Ranges" : "Open in Solve"}
      </button>

      {panel.kind === "confirm-delete" ? (
        <div className="library__confirm" role="alertdialog" aria-label={`Delete ${name}?`}>
          <p>
            Delete &ldquo;{name}&rdquo;? This can&rsquo;t be undone.
          </p>
          <span className="library__preview-actions">
            <button type="button" className="btn-danger" disabled={busy} onClick={onDelete}>
              Delete
            </button>
            <button type="button" className="btn-ghost" onClick={() => onPanel({ kind: "view" })}>
              Cancel
            </button>
          </span>
        </div>
      ) : (
        <span className="library__preview-actions library__preview-actions--spread">
          <button type="button" className="btn-ghost" disabled={busy} onClick={onDuplicate}>
            Duplicate
          </button>
          <button type="button" className="btn-ghost" onClick={() => onPanel({ kind: "rename", draft: name })}>
            Rename
          </button>
          <button type="button" className="btn-danger" onClick={() => onPanel({ kind: "confirm-delete" })}>
            Delete
          </button>
        </span>
      )}
      {notice && (
        <p className="spot-builder__field-error" role="alert">
          {notice}
        </p>
      )}
    </aside>
  );
}
