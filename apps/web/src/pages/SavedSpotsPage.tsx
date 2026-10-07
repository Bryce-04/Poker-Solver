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
 * Lists the signed-in user's spots, saved via apps/api's POST/GET /spots
 * (live -- see docs/decisions.md). List-only in this MVP (no editing/
 * deleting). GET /spots requires sign-in and only returns the caller's own
 * spots, so this only fetches once signed in -- and refetches when the
 * signed-in account changes, so signing in on this screen (or switching
 * accounts) shows the right list without a reload.
 */
export function SavedSpotsPage() {
  const auth = useAuth();
  const signedInAs = auth.status === "signed-in" ? (auth.email ?? "") : null;
  // Each fetch result is tagged with the account it was fetched for, so a
  // result from a previous account reads as "loading" until the new fetch
  // lands -- derived during render rather than reset inside the effect.
  const [fetched, setFetched] = useState<{ account: string; state: ListState } | null>(null);
  const state: ListState =
    fetched !== null && fetched.account === signedInAs ? fetched.state : { kind: "loading" };

  useEffect(() => {
    if (signedInAs === null) return;
    let cancelled = false;
    listSpots().then((result) => {
      if (cancelled) return;
      switch (result.kind) {
        case "ok":
          setFetched({ account: signedInAs, state: { kind: "ok", spots: result.spots } });
          return;
        case "network-error":
          setFetched({ account: signedInAs, state: { kind: "network-error" } });
          return;
        case "error":
          setFetched({ account: signedInAs, state: { kind: "error", status: result.status } });
          return;
      }
    });
    return () => {
      cancelled = true;
    };
  }, [signedInAs]);

  if (auth.status === "signed-out") {
    return (
      <div className="spot-builder__status-block spot-builder__status-block--info">
        <p className="spot-builder__status-title">Not signed in.</p>
        <p>Sign in to see and save your own spots.</p>
      </div>
    );
  }

  // Auth still resolving, or a fetch in flight -- both read as loading.
  return <SavedSpotsList state={state} />;
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
