import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Spot } from "@poker-solver/schema";
import { PageHeader } from "../../components/PageHeader/PageHeader";
import { SegmentedControl } from "../../components/SegmentedControl/SegmentedControl";
import { MiniRange } from "../../components/MiniRange/MiniRange";
import { PlayingCard } from "../../components/PlayingCard/PlayingCard";
import { deleteSpot, listSpots, renameSpot, saveSpot } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { PAGE_HEADERS } from "../../lib/navigation";
import { indexRange, totalCombos } from "../../lib/rangeCombos";
import { boardText, displayName, shortSavedAt, spotKind } from "../../lib/spotText";
import "../../components/SpotBuilder/SpotBuilder.css";
import "./LibraryWorkspace.css";

type ListState =
  | { kind: "loading" }
  | { kind: "ok"; spots: Spot[] }
  | { kind: "network-error" }
  | { kind: "error"; status: number };

type Filter = "all" | "preflop" | "postflop";

type PanelMode = { kind: "view" } | { kind: "rename"; draft: string } | { kind: "confirm-delete" };

const FILTERS = [
  { value: "all", label: "All" },
  { value: "preflop", label: "Preflop" },
  { value: "postflop", label: "Postflop" },
] as const;

const TOTAL_COMBOS = 1326;

function matches(spot: Spot, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const board = spot.board ?? [];
  return [displayName(spot), spot.positions_in_hand.join(" "), board.join(" "), boardText(board)]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

/**
 * Desktop Library (docs/desktop-redesign.md §6.4): the signed-in user's saved
 * spots as a searchable, filterable table, a preview of the selected one, and
 * open / rename / duplicate / delete. Opening hands the spot to Ranges (a
 * preflop chart) or Solve (a setup with a board) as route state. Phones keep
 * the original list (SavedSpotsPage), unchanged.
 */
export function LibraryWorkspace() {
  const auth = useAuth();
  const navigate = useNavigate();
  const signedInAs = auth.status === "signed-in" ? (auth.email ?? "") : null;
  // Tagged with the account it was fetched for, as SavedSpotsPage does, so a
  // previous account's list never shows for a new one.
  const [fetched, setFetched] = useState<{ account: string; state: ListState } | null>(null);
  const state: ListState =
    fetched !== null && fetched.account === signedInAs ? fetched.state : { kind: "loading" };

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelMode>({ kind: "view" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (signedInAs === null) return;
    let cancelled = false;
    listSpots().then((result) => {
      if (cancelled) return;
      setFetched({
        account: signedInAs,
        state: result.kind === "ok" ? { kind: "ok", spots: result.spots } : result,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [signedInAs]);

  function updateSpots(change: (spots: Spot[]) => Spot[]) {
    setFetched((prev) =>
      prev && prev.state.kind === "ok" ? { ...prev, state: { kind: "ok", spots: change(prev.state.spots) } } : prev,
    );
  }

  const spots = state.kind === "ok" ? state.spots : [];
  const visible = spots.filter((s) => (filter === "all" || spotKind(s) === filter) && matches(s, query));
  const selected = visible.find((s) => s.id === selectedId) ?? visible[0];

  function select(spot: Spot, mode: PanelMode = { kind: "view" }) {
    setSelectedId(spot.id ?? null);
    setPanel(mode);
    setNotice(null);
  }

  function open(spot: Spot) {
    navigate(spotKind(spot) === "preflop" ? "/ranges" : "/solve", { state: { spot } });
  }

  async function rename(spot: Spot, name: string) {
    if (!spot.id) return;
    setBusy(true);
    const result = await renameSpot(spot.id, name);
    setBusy(false);
    if (result.kind === "renamed") {
      updateSpots((list) => list.map((s) => (s.id === spot.id ? result.spot : s)));
      setPanel({ kind: "view" });
    } else if (result.kind === "not-found") {
      updateSpots((list) => list.filter((s) => s.id !== spot.id));
      setNotice("That spot was already deleted.");
    } else if (result.kind === "invalid") {
      setNotice("Names can be 1 to 120 characters.");
    } else {
      setNotice("Couldn't rename it. Check your connection and try again.");
    }
  }

  async function remove(spot: Spot) {
    if (!spot.id) return;
    setBusy(true);
    const result = await deleteSpot(spot.id);
    setBusy(false);
    if (result.kind === "deleted" || result.kind === "not-found") {
      updateSpots((list) => list.filter((s) => s.id !== spot.id));
      setPanel({ kind: "view" });
      setSelectedId(null);
    } else {
      setNotice("Couldn't delete it. Check your connection and try again.");
    }
  }

  async function duplicate(spot: Spot) {
    setBusy(true);
    // The server assigns the copy its own id, owner and date.
    const result = await saveSpot({ ...spot, name: `${displayName(spot)} (copy)`.slice(0, 120) });
    setBusy(false);
    if (result.kind === "saved") {
      updateSpots((list) => [result.spot, ...list]);
      select(result.spot);
    } else {
      setNotice("Couldn't duplicate it. Check your connection and try again.");
    }
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
        ) : spots.length === 0 ? (
          <div className="library__message">
            <p className="library__message-title">No saved spots yet.</p>
            <p>Save a chart from Ranges or a setup from Solve and it&rsquo;ll show up here.</p>
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
                    {visible.map((spot) => {
                      const name = displayName(spot);
                      const kind = spotKind(spot);
                      return (
                        <tr key={spot.id ?? name} data-selected={spot === selected || undefined}>
                          <td>
                            <button type="button" className="library__name" onClick={() => select(spot)}>
                              {name}
                            </button>
                          </td>
                          <td>
                            <span className="library__pill" data-kind={kind}>
                              {kind === "preflop" ? "Preflop" : "Postflop"}
                            </span>
                          </td>
                          <td>{spot.positions_in_hand.join(" vs ")}</td>
                          <td className="tabular-nums">{spot.effective_stack_bb}bb</td>
                          <td>{kind === "postflop" ? boardText(spot.board ?? []) : "—"}</td>
                          <td className="tabular-nums">{shortSavedAt(spot) ?? "—"}</td>
                          <td>
                            <span className="library__row-actions">
                              <button type="button" className="library__open" onClick={() => open(spot)}>
                                Open
                              </button>
                              <button
                                type="button"
                                className="library__icon"
                                aria-label={`Rename ${name}`}
                                onClick={() => select(spot, { kind: "rename", draft: name })}
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
                                  <path d="M4 20h4L19 9l-4-4L4 16v4z" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                className="library__icon"
                                aria-label={`Delete ${name}`}
                                onClick={() => select(spot, { kind: "confirm-delete" })}
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
                                  <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
                                </svg>
                              </button>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {visible.length === 0 && <p className="library__no-results">No spots match that search.</p>}
              </div>
              <p className="library__tip">Tip: save a chart from Ranges or a setup from Solve, and it shows up here.</p>
            </div>

            {selected && (
              <SpotPreview
                spot={selected}
                panel={panel}
                busy={busy}
                notice={notice}
                onPanel={setPanel}
                onOpen={() => open(selected)}
                onRename={(name) => void rename(selected, name)}
                onDelete={() => void remove(selected)}
                onDuplicate={() => void duplicate(selected)}
              />
            )}
          </div>
        )}
      </div>
    </div>
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
      <span className="library__pill library__pill--start" data-kind={kind}>
        {kind === "preflop" ? "Preflop" : "Postflop"}
      </span>

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
