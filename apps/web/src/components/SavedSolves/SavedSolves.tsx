import { useEffect, useState } from "react";
import { deleteSolve, listSolves } from "../../lib/api";
import type { SavedSolve } from "../../lib/api";
import { describeSpot, formatMix, overallMix } from "../../lib/strategySummary";
import { StrategyGrid } from "../StrategyGrid/StrategyGrid";
import "../SpotBuilder/SpotBuilder.css";

type ListState =
  | { kind: "loading" }
  | { kind: "ok"; solves: SavedSolve[] }
  | { kind: "network-error" }
  | { kind: "error"; status: number };

function formatSavedAt(solve: SavedSolve): string | null {
  const date = new Date(solve.created_at);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

/**
 * The signed-in user's saved solves (apps/api's /solves): a list that opens
 * read-only into the same strategy chart the Solve tab shows, plus delete.
 * Rendered by SavedSpotsPage, so the caller has already checked sign-in; this
 * refetches when `account` changes so switching accounts never shows the
 * previous account's solves.
 */
export function SavedSolves({ account }: { account: string }) {
  const [fetched, setFetched] = useState<{ account: string; state: ListState } | null>(null);
  const state: ListState =
    fetched !== null && fetched.account === account ? fetched.state : { kind: "loading" };
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listSolves().then((result) => {
      if (cancelled) return;
      if (result.kind === "ok") {
        setFetched({ account, state: { kind: "ok", solves: result.solves } });
      } else if (result.kind === "network-error") {
        setFetched({ account, state: { kind: "network-error" } });
      } else {
        setFetched({ account, state: { kind: "error", status: result.status } });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [account]);

  async function handleDelete(id: string) {
    setDeleteError(false);
    const result = await deleteSolve(id);
    if (result.kind !== "deleted") {
      setDeleteError(true);
      return;
    }
    setConfirmingId(null);
    setOpenId((current) => (current === id ? null : current));
    setFetched((prev) =>
      prev !== null && prev.state.kind === "ok"
        ? {
            account: prev.account,
            state: { kind: "ok", solves: prev.state.solves.filter((s) => s.id !== id) },
          }
        : prev,
    );
  }

  return (
    <section className="saved-solves">
      <h2 className="spot-builder__legend">Saved solves</h2>

      {state.kind === "loading" && (
        <p>
          <span className="spot-builder__spinner" aria-hidden="true" />
          Loading saved solves&hellip;
        </p>
      )}

      {state.kind === "network-error" && (
        <div className="spot-builder__status-block spot-builder__status-block--error">
          <p className="spot-builder__status-title">Couldn&rsquo;t load saved solves.</p>
          <p>Check your connection and try again.</p>
        </div>
      )}

      {state.kind === "error" && (
        <div className="spot-builder__status-block spot-builder__status-block--error">
          <p className="spot-builder__status-title">Couldn&rsquo;t load saved solves.</p>
          <p>The request failed with HTTP {state.status}.</p>
        </div>
      )}

      {state.kind === "ok" && state.solves.length === 0 && (
        <div className="spot-builder__status-block spot-builder__status-block--info">
          <p className="spot-builder__status-title">No saved solves yet.</p>
          <p>Run a solve on the Solve tab and press &ldquo;Save this solve&rdquo; to keep it here.</p>
        </div>
      )}

      {state.kind === "ok" && state.solves.length > 0 && (
        <ul className="spot-builder__actions">
          {state.solves.map((solve) => {
            const open = openId === solve.id;
            return (
              <li key={solve.id} className="spot-builder__action-row">
                <div>
                  <p>{solve.label ?? describeSpot(solve.spot)}</p>
                  {solve.label && <p className="spot-builder__hint">{describeSpot(solve.spot)}</p>}
                  {formatSavedAt(solve) && (
                    <p className="spot-builder__hint">Saved {formatSavedAt(solve)}</p>
                  )}
                  <div className="solve-page__actions">
                    <button
                      type="button"
                      className="spot-builder__reset"
                      aria-expanded={open}
                      onClick={() => setOpenId(open ? null : solve.id)}
                    >
                      {open ? "Hide" : "View"}
                    </button>
                    {confirmingId === solve.id ? (
                      <>
                        <button
                          type="button"
                          className="spot-builder__reset"
                          onClick={() => handleDelete(solve.id)}
                        >
                          Confirm delete
                        </button>
                        <button
                          type="button"
                          className="spot-builder__reset"
                          onClick={() => setConfirmingId(null)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="spot-builder__reset"
                        onClick={() => setConfirmingId(solve.id)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                  {deleteError && confirmingId === solve.id && (
                    <p className="spot-builder__field-error">
                      Couldn&rsquo;t delete that solve &mdash; try again in a moment.
                    </p>
                  )}
                  {open && (
                    <div className="spot-builder__result">
                      {Object.keys(solve.result.strategy).length > 0 && (
                        <p className="solve-page__headline">
                          {solve.result.position} to act. Averaged over the hands in this
                          range: {formatMix(overallMix(solve.result.strategy))}.
                        </p>
                      )}
                      <StrategyGrid strategy={solve.result.strategy} />
                      {solve.result.exploitability_pct !== undefined && (
                        <p className="spot-builder__hint">
                          Within {solve.result.exploitability_pct.toFixed(2)}% of the pot of a
                          true equilibrium.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
