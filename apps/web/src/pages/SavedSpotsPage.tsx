import { useEffect, useState } from "react";
import type { Spot } from "@poker-solver/schema";
import { listSpots } from "../lib/api";
import "../components/SpotBuilder/SpotBuilder.css";

// Mirrors SpotBuilder's Outcome pattern: the api result kinds plus loading,
// so every state (including "backend isn't live yet") gets an intentional
// treatment instead of a blank screen.
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
 * Lists spots saved via apps/api's POST/GET /spots. List-only in this MVP
 * (no editing/deleting) -- see the ♥-lane plan. Until the backend lane
 * ships these routes, listSpots() resolves to { kind: "error", status: 404 },
 * which renders as a normal, already-styled outcome below, not a crash.
 */
export function SavedSpotsPage() {
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
      <div className="spot-builder__status-block spot-builder__status-block--info">
        <p className="spot-builder__status-title">
          {state.status === 404
            ? "Saved spots aren't live yet."
            : "Unexpected API response."}
        </p>
        <p>
          {state.status === 404
            ? "The backend lane hasn't shipped POST/GET /spots yet -- this screen will populate once it does."
            : `The request failed with HTTP ${state.status}.`}
        </p>
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
