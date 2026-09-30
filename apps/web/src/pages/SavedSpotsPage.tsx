import { useEffect, useState } from "react";
import type { Spot } from "@poker-solver/schema";
import { listSpots } from "../lib/api";
import { useAuth } from "../lib/auth";
import "../components/SpotBuilder/SpotBuilder.css";

// Mirrors SpotBuilder's Outcome pattern: the api result kinds plus loading,
// so every reachable state gets an intentional treatment instead of a
// blank screen.
type ListState =
  | { kind: "loading" }
  | { kind: "ok"; spots: Spot[] }
  | { kind: "network-error" }
  | { kind: "error"; status: number };

function summarize(spot: Spot): string {
  const positions = spot.positions_in_hand.join("/");
  const raise = (spot.actions ?? []).find((a) => a.action === "raise");
  const situation = raise
    ? `facing a raise from ${raise.position}`
    : "unopened pot";
  return `${positions} — ${spot.effective_stack_bb}bb, ${situation}`;
}

function formatSavedAt(spot: Spot): string | null {
  if (!spot.created_at) return null;
  const date = new Date(spot.created_at);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

/**
 * Lists spots saved via apps/api's POST/GET /spots (live -- see
 * docs/decisions.md). List-only in this MVP (no editing/deleting). Saved
 * spots aren't scoped per-user yet -- there's no auth (Stage 6) -- so this
 * lists every spot anyone has saved, not just "yours."
 */
export function SavedSpotsPage() {
  const auth = useAuth();
  const [state, setState] = useState<ListState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    // Initial state is already { kind: "loading" } -- no need to set it
    // again here (this effect only ever runs once, on mount).
    listSpots().then((result) => {
      if (cancelled) return;
      switch (result.kind) {
        case "ok":
          setState({ kind: "ok", spots: result.spots });
          return;
        case "network-error":
          setState({ kind: "network-error" });
          return;
        case "error":
          setState({ kind: "error", status: result.status });
          return;
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      {auth.status === "signed-out" && (
        <div className="spot-builder__status-block spot-builder__status-block--info">
          <p className="spot-builder__status-title">Not signed in.</p>
          {/* apps/api doesn't filter GET /spots per-user yet (backend lane's
              job, see docs/decisions.md's 2026-09-30 entry) -- this list may
              still show everyone's spots until that lands. */}
          <p>Sign in to save your own spots.</p>
        </div>
      )}
      <SavedSpotsList state={state} />
    </>
  );
}

function SavedSpotsList({ state }: { state: ListState }) {
  if (state.kind === "loading") {
    return (
      <p>
        <span className="spot-builder__spinner" aria-hidden="true" />
        Loading saved spots&hellip;
      </p>
    );
  }

  if (state.kind === "network-error") {
    return (
      <div className="spot-builder__status-block spot-builder__status-block--error">
        <p className="spot-builder__status-title">Couldn&rsquo;t reach the API.</p>
        <p>
          Is <code>apps/api</code> running? Start it with{" "}
          <code>cd apps/api &amp;&amp; uvicorn app.main:app --reload</code>.
        </p>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="spot-builder__status-block spot-builder__status-block--error">
        <p className="spot-builder__status-title">Unexpected API response.</p>
        <p>The request failed with HTTP {state.status}.</p>
      </div>
    );
  }

  if (state.spots.length === 0) {
    return (
      <div className="spot-builder__status-block spot-builder__status-block--info">
        <p className="spot-builder__status-title">No saved spots yet.</p>
        <p>Build a spot and save it from the builder to see it here.</p>
      </div>
    );
  }

  return (
    <ul className="spot-builder__actions">
      {state.spots.map((spot) => (
        <li key={spot.id ?? summarize(spot)} className="spot-builder__action-row">
          <div>
            <p>{summarize(spot)}</p>
            {formatSavedAt(spot) && (
              <p className="spot-builder__hint">Saved {formatSavedAt(spot)}</p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
