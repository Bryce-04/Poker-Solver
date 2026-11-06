import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Spot } from "@poker-solver/schema";
import {
  deleteConversation,
  deleteSpot,
  listConversations,
  listSpots,
  renameConversation,
  renameSpot,
  saveSpot,
  type CoachConversationSummary,
} from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { onSheetEntry } from "../../lib/mobileShell";
import { boardText, displayName, spotKind } from "../../lib/spotText";

export type ListState =
  | { kind: "loading" }
  | { kind: "ok"; spots: Spot[] }
  | { kind: "network-error" }
  | { kind: "error"; status: number };

export type LibraryFilter = "all" | "preflop" | "postflop" | "conversations";

export const LIBRARY_FILTERS = [
  { value: "all", label: "All" },
  { value: "preflop", label: "Preflop" },
  { value: "postflop", label: "Postflop" },
  { value: "conversations", label: "Conversations" },
] as const;

/** The Coach's conversations, beside the spots (docs/coach.md §10). Loaded on
 * their own: if they fail, the Library still shows the spots. */
export type ConversationsState =
  | { kind: "loading" }
  | { kind: "ok"; conversations: CoachConversationSummary[] }
  | { kind: "error" };

/** One row of the Library: a saved spot or a Coach conversation, newest first. */
export type LibraryItem =
  | { type: "spot"; key: string; date: string | null; spot: Spot }
  | { type: "conversation"; key: string; date: string; conversation: CoachConversationSummary };

/** "Conversation", or a spot's kind, for a row's pill. */
export type ItemKind = "preflop" | "postflop" | "conversation";

export function itemKind(item: LibraryItem): ItemKind {
  return item.type === "conversation" ? "conversation" : spotKind(item.spot);
}

export function itemName(item: LibraryItem): string {
  return item.type === "conversation" ? (item.conversation.title ?? "New conversation") : displayName(item.spot);
}

/** Interleaves conversations (newest first) into the spots without moving any spot. */
function mergeNewestFirst(spots: LibraryItem[], conversations: LibraryItem[]): LibraryItem[] {
  const out: LibraryItem[] = [];
  let next = 0;
  for (const spot of spots) {
    while (next < conversations.length && spot.date !== null && (conversations[next].date ?? "") > spot.date) {
      out.push(conversations[next++]);
    }
    out.push(spot);
  }
  return [...out, ...conversations.slice(next)];
}

function conversationMatches(c: CoachConversationSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || `${c.title ?? ""} ${c.preview ?? ""}`.toLowerCase().includes(q);
}

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
 * saved spots and Coach conversations (docs/coach.md §10), search and the
 * All / Preflop / Postflop / Conversations filter, and open / rename /
 * duplicate / delete (a conversation opens in the Coach, and has no
 * duplicate). Each layout keeps its own selection and
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

  const [conversationsFor, setConversationsFor] = useState<{ account: string; state: ConversationsState } | null>(null);
  const conversationsState: ConversationsState =
    conversationsFor !== null && conversationsFor.account === signedInAs ? conversationsFor.state : { kind: "loading" };

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
    listConversations().then((result) => {
      if (cancelled) return;
      setConversationsFor({
        account: signedInAs,
        state: result?.kind === "ok" ? { kind: "ok", conversations: result.conversations } : { kind: "error" },
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

  function updateConversations(change: (list: CoachConversationSummary[]) => CoachConversationSummary[]) {
    setConversationsFor((prev) =>
      prev && prev.state.kind === "ok"
        ? { ...prev, state: { kind: "ok", conversations: change(prev.state.conversations) } }
        : prev,
    );
  }

  const spots = state.kind === "ok" ? state.spots : [];
  const visible = spots.filter((s) => (filter === "all" || spotKind(s) === filter) && matches(s, query));
  const conversations = conversationsState.kind === "ok" ? conversationsState.conversations : [];

  /** What the list shows: the filter's spots and conversations, newest first.
   * The spots keep the server's order (newest saved first); each conversation
   * goes in before the first spot older than it. */
  const spotItems = (filter === "conversations" ? [] : visible).map(
    (spot): LibraryItem => ({ type: "spot", key: `spot:${spot.id ?? displayName(spot)}`, date: spot.created_at ?? null, spot }),
  );
  const conversationItems = (filter === "all" || filter === "conversations" ? conversations : [])
    .filter((c) => conversationMatches(c, query))
    .map((c): LibraryItem => ({ type: "conversation", key: `conversation:${c.id}`, date: c.updated_at, conversation: c }))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const items = mergeNewestFirst(spotItems, conversationItems);

  /** A preflop chart opens in Ranges, a setup with a board in Solve. From a
   * phone sheet, that replaces the sheet's history entry. */
  function open(spot: Spot) {
    navigate(spotKind(spot) === "preflop" ? "/ranges" : "/solve", { state: { spot }, replace: onSheetEntry() });
  }

  /** A conversation opens in the Coach. */
  function openConversation(c: CoachConversationSummary) {
    navigate(`/coach/${c.id}`, { replace: onSheetEntry() });
  }

  async function renameConversationTo(c: CoachConversationSummary, title: string): Promise<LibraryResult> {
    setBusy(true);
    const result = await renameConversation(c.id, title.trim());
    setBusy(false);
    if (result.kind === "renamed") {
      updateConversations((list) => list.map((x) => (x.id === c.id ? result.conversation : x)));
      return { ok: true };
    }
    if (result.kind === "not-found") {
      updateConversations((list) => list.filter((x) => x.id !== c.id));
      return { ok: false, notice: "That conversation was already deleted." };
    }
    return { ok: false, notice: "Couldn't rename it. Check your connection and try again." };
  }

  async function removeConversation(c: CoachConversationSummary): Promise<LibraryResult> {
    setBusy(true);
    const result = await deleteConversation(c.id);
    setBusy(false);
    if (result.kind === "deleted" || result.kind === "not-found") {
      updateConversations((list) => list.filter((x) => x.id !== c.id));
      return { ok: true };
    }
    return { ok: false, notice: "Couldn't delete it. Check your connection and try again." };
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

  return {
    auth,
    state,
    spots,
    visible,
    conversationsState,
    conversations,
    items,
    query,
    setQuery,
    filter,
    setFilter,
    busy,
    open,
    rename,
    remove,
    duplicate,
    openConversation,
    renameConversation: renameConversationTo,
    removeConversation,
  };
}

export type LibraryData = ReturnType<typeof useLibrary>;
