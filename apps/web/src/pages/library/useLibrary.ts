import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Spot } from "@poker-solver/schema";
import { deleteSpot, listSpots, renameSpot, saveSpot } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { onSheetEntry } from "../../lib/mobileShell";
import { boardText, displayName, spotKind } from "../../lib/spotText";

export type ListState =
  | { kind: "loading" }
  | { kind: "ok"; spots: Spot[] }
  | { kind: "network-error" }
  | { kind: "error"; status: number };

export type LibraryFilter = "all" | "preflop" | "postflop";

export const LIBRARY_FILTERS = [
  { value: "all", label: "All" },
  { value: "preflop", label: "Preflop" },
  { value: "postflop", label: "Postflop" },
] as const;

/** What an action did: done (with the spot it produced, if any), or the
 * message to show instead. */
export type LibraryResult = { ok: true; spot?: Spot } | { ok: false; notice: string };

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
 * The Library's data and actions, shared by the desktop workspace
 * (LibraryWorkspace) and the phone page (LibraryPhone): the signed-in user's
 * saved spots, search and the All / Preflop / Postflop filter, and open /
 * rename / duplicate / delete. Each layout keeps its own selection and
 * panels; the actions say what happened so the layout can react.
 */
export function useLibrary() {
  const auth = useAuth();
  const navigate = useNavigate();
  const signedInAs = auth.status === "signed-in" ? (auth.email ?? "") : null;
  // Tagged with the account it was fetched for, so a previous account's list
  // never shows for a new one: a result for another account reads as loading.
  const [fetched, setFetched] = useState<{ account: string; state: ListState } | null>(null);
  const state: ListState =
    fetched !== null && fetched.account === signedInAs ? fetched.state : { kind: "loading" };

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [busy, setBusy] = useState(false);

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

  /** A preflop chart opens in Ranges, a setup with a board in Solve. From a
   * phone sheet, that replaces the sheet's history entry. */
  function open(spot: Spot) {
    navigate(spotKind(spot) === "preflop" ? "/ranges" : "/solve", { state: { spot }, replace: onSheetEntry() });
  }

  async function rename(spot: Spot, name: string): Promise<LibraryResult> {
    if (!spot.id) return { ok: false, notice: "This spot can't be renamed." };
    setBusy(true);
    const result = await renameSpot(spot.id, name);
    setBusy(false);
    if (result.kind === "renamed") {
      updateSpots((list) => list.map((s) => (s.id === spot.id ? result.spot : s)));
      return { ok: true, spot: result.spot };
    }
    if (result.kind === "not-found") {
      updateSpots((list) => list.filter((s) => s.id !== spot.id));
      return { ok: false, notice: "That spot was already deleted." };
    }
    if (result.kind === "invalid") return { ok: false, notice: "Names can be 1 to 120 characters." };
    return { ok: false, notice: "Couldn't rename it. Check your connection and try again." };
  }

  async function remove(spot: Spot): Promise<LibraryResult> {
    if (!spot.id) return { ok: false, notice: "This spot can't be deleted." };
    setBusy(true);
    const result = await deleteSpot(spot.id);
    setBusy(false);
    if (result.kind === "deleted" || result.kind === "not-found") {
      updateSpots((list) => list.filter((s) => s.id !== spot.id));
      return { ok: true };
    }
    return { ok: false, notice: "Couldn't delete it. Check your connection and try again." };
  }

  async function duplicate(spot: Spot): Promise<LibraryResult> {
    setBusy(true);
    // The server assigns the copy its own id, owner and date.
    const result = await saveSpot({ ...spot, name: `${displayName(spot)} (copy)`.slice(0, 120) });
    setBusy(false);
    if (result.kind === "saved") {
      updateSpots((list) => [result.spot, ...list]);
      return { ok: true, spot: result.spot };
    }
    return { ok: false, notice: "Couldn't duplicate it. Check your connection and try again." };
  }

  return { auth, state, spots, visible, query, setQuery, filter, setFilter, busy, open, rename, remove, duplicate };
}
