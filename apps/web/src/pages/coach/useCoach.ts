import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Spot } from "@poker-solver/schema";
import {
  createConversation,
  getCoachUsage,
  getConversation,
  listConversations,
  sendCoachMessage,
  type CoachConversationSummary,
  type CoachMessage,
  type CoachStatus,
  type CoachUsage,
} from "../../lib/api";
import { useAuth } from "../../lib/auth";

/** How often to ask for new messages while a turn runs (docs/coach.md §7). */
export const POLL_MS = 1500;

export const NEW_CONVERSATION = "new";

export type ListState =
  | { kind: "loading" }
  | { kind: "ok"; conversations: CoachConversationSummary[] }
  | { kind: "error" };

export type ThreadState =
  | { kind: "empty" }
  | { kind: "loading" }
  | { kind: "ok"; title: string | null; status: CoachStatus; messages: CoachMessage[] }
  | { kind: "not-found" }
  | { kind: "error" };

export function isBusy(status: CoachStatus | undefined): boolean {
  return status === "working" || status === "waiting_for_solver";
}

/** State that belongs to one conversation: anything tagged with another id reads as unset. */
type Keyed<T> = { id: string; value: T } | null;

function forRoute<T>(keyed: Keyed<T>, id: string | undefined): T | undefined {
  return keyed !== null && keyed.id === id ? keyed.value : undefined;
}

function lastSeqOf(thread: ThreadState | undefined): number {
  return thread?.kind === "ok" ? (thread.messages.at(-1)?.seq ?? 0) : 0;
}

/**
 * The Coach page's data: the conversation list, the open conversation (by
 * route id; `/coach` opens the most recent, `/coach/new` an empty one),
 * sending, and polling while a turn runs. Polling pauses while the browser
 * tab is hidden and picks up from the last message seen.
 *
 * Per-conversation state (the thread, a notice, the message being sent) is
 * tagged with its conversation's id, so switching conversations never shows
 * the previous one's: an untagged value reads as loading or unset.
 */
export function useCoach(routeId: string | undefined) {
  const auth = useAuth();
  const navigate = useNavigate();
  const account = auth.status === "signed-in" ? (auth.email ?? "") : null;
  const signedIn = account !== null;

  const [listFor, setListFor] = useState<{ account: string; state: ListState } | null>(null);
  const [usage, setUsage] = useState<CoachUsage | null>(null);
  const [threadFor, setThreadFor] = useState<Keyed<ThreadState>>(null);
  const [noticeFor, setNoticeFor] = useState<Keyed<string>>(null);
  const [pendingFor, setPendingFor] = useState<Keyed<string>>(null);
  const [sending, setSending] = useState(false);

  const list: ListState = useMemo(
    () => (listFor !== null && listFor.account === account ? listFor.state : { kind: "loading" }),
    [listFor, account],
  );
  const thread: ThreadState = useMemo(
    () => forRoute(threadFor, routeId) ?? (routeId === NEW_CONVERSATION ? { kind: "empty" } : { kind: "loading" }),
    [threadFor, routeId],
  );
  const notice = forRoute(noticeFor, routeId) ?? null;
  const pending = forRoute(pendingFor, routeId) ?? null;
  const status = thread.kind === "ok" ? thread.status : undefined;

  // Read inside callbacks that outlive a render (polling, send).
  const latest = useRef({ routeId, thread });
  useEffect(() => {
    latest.current = { routeId, thread };
  });

  const refreshList = useCallback(() => {
    if (account === null) return;
    listConversations().then((result) =>
      setListFor({
        account,
        state: result.kind === "ok" ? { kind: "ok", conversations: result.conversations } : { kind: "error" },
      }),
    );
  }, [account]);

  const refreshUsage = useCallback(() => {
    getCoachUsage().then((result) => {
      if (result.kind === "ok") setUsage(result.usage);
    });
  }, []);

  // The list and the usage line, once signed in.
  useEffect(() => {
    if (account === null) return;
    let cancelled = false;
    listConversations().then((result) => {
      if (!cancelled)
        setListFor({
          account,
          state: result.kind === "ok" ? { kind: "ok", conversations: result.conversations } : { kind: "error" },
        });
    });
    getCoachUsage().then((result) => {
      if (!cancelled && result.kind === "ok") setUsage(result.usage);
    });
    return () => {
      cancelled = true;
    };
  }, [account]);

  // `/coach` with no id: open the most recent conversation, or start empty.
  useEffect(() => {
    if (!signedIn || routeId !== undefined || list.kind !== "ok") return;
    const recent = list.conversations[0];
    navigate(`/coach/${recent ? recent.id : NEW_CONVERSATION}`, { replace: true });
  }, [signedIn, routeId, list, navigate]);

  // Load the open conversation, unless this route already has it (send()
  // just created it: a reload could land before the message is stored, read
  // "idle", and never poll for the answer).
  const haveThread = forRoute(threadFor, routeId) !== undefined;
  useEffect(() => {
    if (!signedIn || routeId === undefined || routeId === NEW_CONVERSATION || haveThread) return;
    let cancelled = false;
    getConversation(routeId, 0).then((result) => {
      if (cancelled) return;
      if (result.kind === "ok") {
        const { title, status, messages } = result.conversation;
        setThreadFor({ id: routeId, value: { kind: "ok", title, status, messages } });
      } else {
        setThreadFor({ id: routeId, value: { kind: result.kind === "not-found" ? "not-found" : "error" } });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn, routeId, haveThread]);

  // Poll while a turn runs; stop when it's idle or errored, then refresh the
  // list (its preview and title) and the usage line.
  useEffect(() => {
    if (!routeId || routeId === NEW_CONVERSATION || !isBusy(status)) return;
    const id = routeId;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      if (stopped) return;
      if (document.hidden) {
        timer = setTimeout(poll, POLL_MS);
        return;
      }
      const after = lastSeqOf(latest.current.routeId === id ? latest.current.thread : undefined);
      const result = await getConversation(id, after);
      if (stopped) return;
      if (result.kind === "ok") {
        const { conversation } = result;
        setThreadFor((prev) => {
          const current = forRoute(prev, id);
          if (current?.kind !== "ok") return prev;
          const known = lastSeqOf(current);
          const fresh = conversation.messages.filter((m) => m.seq > known);
          return {
            id,
            value: { kind: "ok", title: conversation.title, status: conversation.status, messages: [...current.messages, ...fresh] },
          };
        });
        if (conversation.messages.some((m) => m.kind === "user_text") || !isBusy(conversation.status)) {
          setPendingFor((prev) => (prev?.id === id ? null : prev));
        }
        if (!isBusy(conversation.status)) {
          refreshList();
          refreshUsage();
          return;
        }
      }
      timer = setTimeout(poll, POLL_MS);
    }

    timer = setTimeout(poll, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        poll();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [routeId, status, refreshList, refreshUsage]);

  /** Sends a message, starting a conversation first if this is a new one. */
  const send = useCallback(
    async (text: string, attachedSpot?: Spot): Promise<boolean> => {
      const trimmed = text.trim();
      if (!trimmed || sending || isBusy(status)) return false;
      setSending(true);
      let id = routeId;
      const say = (message: string) => setNoticeFor({ id: id ?? "", value: message });
      setNoticeFor(null);
      try {
        if (!id || id === NEW_CONVERSATION) {
          const created = await createConversation();
          if (created.kind !== "created") {
            say("Couldn't start a conversation. Check your connection and try again.");
            return false;
          }
          id = created.id;
          setThreadFor({ id, value: { kind: "ok", title: null, status: "idle", messages: [] } });
          navigate(`/coach/${id}`, { replace: true });
        }
        const conversationId = id;
        const result = await sendCoachMessage(conversationId, trimmed, attachedSpot);
        switch (result.kind) {
          case "sent":
            setPendingFor({ id: conversationId, value: trimmed });
            setThreadFor((prev) => {
              const current = forRoute(prev, conversationId);
              return current?.kind === "ok" ? { id: conversationId, value: { ...current, status: "working" } } : prev;
            });
            refreshList();
            return true;
          case "busy":
            say("The Coach is still answering. Wait for it to finish, then send this.");
            return false;
          case "limit":
            say(
              result.allUsersExhausted
                ? "The Coach has answered as many questions as it can for everyone today. Try again later."
                : `You've used all ${result.limit} messages for this hour. Try again in a little while.`,
            );
            refreshUsage();
            return false;
          case "invalid":
            say("That message couldn't be sent. If you attached a hand history, try sending it as text.");
            return false;
          default:
            say("Couldn't reach the Coach. Check your connection and try again.");
            return false;
        }
      } finally {
        setSending(false);
      }
    },
    [routeId, sending, status, navigate, refreshList, refreshUsage],
  );

  /** "Try again" on an error: resends the last thing the user wrote. */
  const retry = useCallback(() => {
    if (thread.kind !== "ok") return;
    const last = [...thread.messages].reverse().find((m) => m.kind === "user_text");
    const text = last ? String(last.payload.text ?? "") : "";
    if (text) send(text);
  }, [thread, send]);

  return {
    auth,
    signedIn,
    list,
    thread,
    status,
    busy: isBusy(status) || sending,
    usage,
    notice,
    pending,
    send,
    retry,
  };
}
