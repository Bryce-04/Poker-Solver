import { useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageHeader } from "../../components/PageHeader/PageHeader";
import { PAGE_HEADERS } from "../../lib/navigation";
import type { CoachConversationSummary } from "../../lib/api";
import { CoachAvatar, MessageList } from "./CoachCards";
import { Composer } from "./Composer";
import { STARTERS, whenText } from "./coachText";
import { NEW_CONVERSATION, type CoachData } from "./useCoach";
import "../../components/SpotBuilder/SpotBuilder.css";
import "./CoachPage.css";

function previewText(c: CoachConversationSummary): string {
  if (c.status === "working") return "Thinking…";
  if (c.status === "waiting_for_solver") return "Waiting for the solver…";
  return c.preview ?? "";
}

/**
 * The desktop Coach (docs/coach.md §8): saved conversations on the left, the
 * open conversation in a column that scrolls on its own, and the message box
 * pinned under it. Phones get CoachPhone; both run on the same useCoach data
 * (CoachPage picks the layout).
 */
export function CoachWorkspace({ coach, conversationId }: { coach: CoachData; conversationId: string | undefined }) {
  const navigate = useNavigate();
  const { list, thread, status, busy, usage, notice, pending, send, retry } = coach;
  const header = PAGE_HEADERS["/coach"];

  const [draftFor, setDraftFor] = useState<{ id: string | undefined; text: string }>({ id: undefined, text: "" });
  const draft = draftFor.id === conversationId ? draftFor.text : "";
  const setDraft = (text: string) => setDraftFor({ id: conversationId, text });
  const [focusKey, setFocusKey] = useState(0);
  const [pasteKey, setPasteKey] = useState(0);
  const [query, setQuery] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  // Keep the newest message in view as the conversation grows.
  const messageCount = thread.kind === "ok" ? thread.messages.length : 0;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messageCount, pending, conversationId]);

  function fill(text: string) {
    setDraft(text);
    setFocusKey((k) => k + 1);
  }

  const conversations = list.kind === "ok" ? list.conversations : [];
  const q = query.trim().toLowerCase();
  const shown = q
    ? conversations.filter((c) => `${c.title ?? ""} ${c.preview ?? ""}`.toLowerCase().includes(q))
    : conversations;

  const newButton = (
    <button type="button" className="btn-primary" onClick={() => navigate(`/coach/${NEW_CONVERSATION}`)}>
      New conversation
    </button>
  );

  if (coach.auth.status === "signed-out") {
    return (
      <div className="coach-page">
        <PageHeader title={header.title} description={header.description} />
        <div className="coach-page__message">
          <p className="coach-page__message-title">Sign in to use the Coach.</p>
          <p>
            Your conversations are saved to your account, and only you can see them. Use Sign in at the
            bottom left.
          </p>
        </div>
      </div>
    );
  }

  const empty = thread.kind === "empty" || (thread.kind === "ok" && thread.messages.length === 0 && !pending);

  return (
    <div className="coach-page">
      <PageHeader title={header.title} description={header.description} actions={newButton} />
      <div className="coach-page__columns">
        <aside className="coach-page__list" aria-label="Saved conversations">
          <input
            type="search"
            className="coach-page__search"
            placeholder="Search conversations"
            aria-label="Search conversations"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <h2 className="section-label coach-page__list-label">Saved conversations</h2>
          {list.kind === "loading" ? (
            <p className="coach-page__list-status" role="status">
              Loading&hellip;
            </p>
          ) : list.kind === "error" ? (
            <p className="coach-page__list-status">Couldn&rsquo;t load your conversations.</p>
          ) : shown.length === 0 ? (
            <p className="coach-page__list-status">{q ? "No conversations match." : "No conversations yet."}</p>
          ) : (
            <ul className="coach-page__items">
              {shown.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/coach/${c.id}`}
                    className="coach-page__item"
                    aria-current={c.id === conversationId ? "page" : undefined}
                  >
                    <span className="coach-page__item-title">{c.title ?? "New conversation"}</span>
                    <span className="coach-page__item-preview">{previewText(c)}</span>
                    <span className="coach-page__item-time">{whenText(c.updated_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="coach-page__chat" aria-label="Conversation">
          <div className="coach-page__scroll" ref={scroller}>
            <div className="coach-page__thread">
              {thread.kind === "loading" ? (
                <p className="coach-page__list-status" role="status">
                  Loading the conversation&hellip;
                </p>
              ) : thread.kind === "not-found" ? (
                <div className="coach-page__message">
                  <p className="coach-page__message-title">That conversation isn&rsquo;t here.</p>
                  <p>It may have been deleted. Start a new one instead.</p>
                </div>
              ) : thread.kind === "error" ? (
                <div className="coach-page__message">
                  <p className="coach-page__message-title">Couldn&rsquo;t load the conversation.</p>
                  <p>Check your connection and try again.</p>
                </div>
              ) : empty ? (
                <div className="coach-empty">
                  <span className="coach-empty__icon">
                    <CoachAvatar />
                  </span>
                  <h2 className="coach-empty__title">What spot are you studying?</h2>
                  <p className="coach-empty__body">
                    Tell me your cards, your position, the board and what happened. I&rsquo;ll build the
                    spot, run the solver, and explain what it does and why.
                  </p>
                  <div className="coach-empty__starters">
                    {STARTERS.map((s) => (
                      <button key={s} type="button" className="coach-empty__starter" onClick={() => (s.startsWith("Paste") ? setPasteKey((k) => k + 1) : fill(s))}>
                        &ldquo;{s}&rdquo;
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                thread.kind === "ok" && (
                  <MessageList
                    messages={thread.messages}
                    status={status ?? "idle"}
                    pending={pending}
                    busy={busy}
                    onSend={(text) => send(text)}
                    onRetry={retry}
                    onEdit={() => fill("Correction: ")}
                  />
                )
              )}
              {notice && (
                <p className="coach-page__notice" role="alert">
                  {notice}
                </p>
              )}
            </div>
          </div>
          <Composer value={draft} onChange={setDraft} onSend={send} busy={busy} usage={usage} autoFocusKey={focusKey} pasteKey={pasteKey} />
        </section>
      </div>
    </div>
  );
}
