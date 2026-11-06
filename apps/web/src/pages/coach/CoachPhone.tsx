import { useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Spot } from "@poker-solver/schema";
import { BottomSheet } from "../../components/mobile/BottomSheet";
import { RankSuitPicker } from "../../components/mobile/RankSuitPicker";
import { TopBarActions } from "../../components/mobile/TopBarActions";
import { TopBarTitle } from "../../components/mobile/TopBarTitle";
import { SegmentedControl } from "../../components/SegmentedControl/SegmentedControl";
import type { CoachUsage } from "../../lib/api";
import { CoachBadgeContext, PageActiveContext, useOpenAccountSheet } from "../../lib/mobileShell";
import { CoachAvatar, MessageList } from "./CoachCards";
import {
  LOW_USAGE,
  MAX_TEXT,
  STARTERS,
  cardsText,
  readHistory,
  whenText,
  withHistory,
  type AttachedHistory,
} from "./coachText";
import { NEW_CONVERSATION, type CoachData } from "./useCoach";
import "./CoachPage.css";
import "./CoachPhone.css";

/** `/coach/saved`: the phone's list of saved conversations (docs/coach.md §9). */
export const SAVED = "saved";

/** The phone shows three starters (the mockup) and the paste one. */
const PHONE_STARTERS = STARTERS.slice(0, 3);

/**
 * The Coach on phones (docs/coach.md §9, docs/coach/mockup/phone-*.html):
 *
 * - `/coach` is the empty state, with a history button in the top bar that
 *   opens `/coach/saved`, the saved conversations.
 * - A conversation has the top bar's back arrow (to the saved list) and its
 *   title, and a message bar fixed above the tab bar.
 *
 * Kept mounted while another tab shows (App's CoachKeepAlive), so a turn keeps
 * polling and the Coach tab gets a dot while it answers or when an answer
 * hasn't been seen yet.
 */
export function CoachPhone({
  coach,
  conversationId,
  view,
}: {
  coach: CoachData;
  conversationId: string | undefined;
  view: "chat" | "saved";
}) {
  const navigate = useNavigate();
  const openAccount = useOpenAccountSheet();
  const active = useContext(PageActiveContext);
  const setBadge = useContext(CoachBadgeContext);
  const { thread, status, busy, usage, notice, pending, send, retry } = coach;

  const [draftFor, setDraftFor] = useState<{ id: string | undefined; text: string }>({ id: undefined, text: "" });
  const draft = draftFor.id === conversationId ? draftFor.text : "";
  const setDraft = (text: string) => setDraftFor({ id: conversationId, text });
  const [pasteKey, setPasteKey] = useState(0);

  // The last message seen while the Coach tab was showing: anything newer that
  // arrives while you're elsewhere puts a dot on the tab.
  const lastSeq = thread.kind === "ok" ? (thread.messages.at(-1)?.seq ?? 0) : 0;
  const [seen, setSeen] = useState({ id: conversationId, seq: lastSeq });
  if (active && (seen.id !== conversationId || seen.seq !== lastSeq)) setSeen({ id: conversationId, seq: lastSeq });
  const unseen = seen.id === conversationId && lastSeq > seen.seq;
  const badge = busy ? "answering" : unseen ? "new answer" : null;
  useEffect(() => {
    setBadge?.(badge);
  }, [badge, setBadge]);
  useEffect(() => () => setBadge?.(null), [setBadge]);

  // Keep the newest message in view as the conversation grows.
  const messageCount = thread.kind === "ok" ? thread.messages.length : 0;
  useLayoutEffect(() => {
    if (active && view === "chat") window.scrollTo(0, document.documentElement.scrollHeight);
  }, [active, view, messageCount, pending, conversationId]);

  if (coach.auth.status === "signed-out") {
    return (
      <div className="m-coach">
        <div className="m-coach__message">
          <p className="m-coach__message-title">Sign in to use the Coach.</p>
          <p>Your conversations are saved to your account, and only you can see them.</p>
          {openAccount && (
            <button type="button" className="m-btn m-btn--primary" onClick={openAccount}>
              Sign in
            </button>
          )}
        </div>
      </div>
    );
  }

  if (view === "saved") {
    return <SavedList coach={coach} onBack={() => navigate("/coach")} />;
  }

  const inConversation = conversationId !== undefined && conversationId !== NEW_CONVERSATION;
  const title = thread.kind === "ok" ? (thread.title ?? "New conversation") : "Conversation";
  const empty = thread.kind === "empty" || (thread.kind === "ok" && thread.messages.length === 0 && !pending);

  return (
    <div className="m-coach">
      {inConversation ? (
        <TopBarTitle title={title} backLabel="Back to saved conversations" onBack={() => navigate(`/coach/${SAVED}`)} />
      ) : (
        <TopBarActions>
          <button
            type="button"
            className="icon-button"
            aria-label="Saved conversations"
            onClick={() => navigate(`/coach/${SAVED}`)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          </button>
        </TopBarActions>
      )}

      {thread.kind === "loading" ? (
        <p className="m-note" role="status">
          Loading the conversation&hellip;
        </p>
      ) : thread.kind === "not-found" ? (
        <div className="m-coach__message">
          <p className="m-coach__message-title">That conversation isn&rsquo;t here.</p>
          <p>It may have been deleted. Start a new one instead.</p>
        </div>
      ) : thread.kind === "error" ? (
        <div className="m-coach__message">
          <p className="m-coach__message-title">Couldn&rsquo;t load the conversation.</p>
          <p>Check your connection and try again.</p>
        </div>
      ) : empty ? (
        <div className="m-coach-empty">
          <span className="m-coach-empty__icon">
            <CoachAvatar />
          </span>
          <h2 className="m-coach-empty__title">What spot are you studying?</h2>
          <p className="m-coach-empty__body">
            Tell me your cards, your position, the board and what happened. I&rsquo;ll run the solver and explain
            what it does and why.
          </p>
          <span className="m-label">Try one</span>
          {PHONE_STARTERS.map((s) => (
            <button key={s} type="button" className="m-coach-empty__starter" onClick={() => setDraft(s)}>
              &ldquo;{s}&rdquo;
            </button>
          ))}
          <button type="button" className="m-link m-coach-empty__paste" onClick={() => setPasteKey((k) => k + 1)}>
            Or paste a hand history
          </button>
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
            onEdit={() => setDraft("Correction: ")}
            compact
          />
        )
      )}
      {notice && (
        <p className="m-coach__notice" role="alert">
          {notice}
        </p>
      )}

      <div className="m-coach__spacer" aria-hidden="true" />
      <PhoneComposer
        value={draft}
        onChange={setDraft}
        onSend={send}
        busy={busy}
        usage={usage}
        followUp={!empty}
        pasteKey={pasteKey}
      />
    </div>
  );
}

function SavedList({ coach, onBack }: { coach: CoachData; onBack: () => void }) {
  const [query, setQuery] = useState("");
  const conversations = coach.list.kind === "ok" ? coach.list.conversations : [];
  const q = query.trim().toLowerCase();
  const shown = q
    ? conversations.filter((c) => `${c.title ?? ""} ${c.preview ?? ""}`.toLowerCase().includes(q))
    : conversations;
  return (
    <div className="m-coach">
      <TopBarTitle title="Saved conversations" backLabel="Back to the Coach" onBack={onBack} />
      <Link to="/coach" className="m-btn m-btn--primary m-coach-saved__new">
        New conversation
      </Link>
      <input
        type="search"
        className="m-coach-saved__search"
        placeholder="Search conversations"
        aria-label="Search conversations"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {coach.list.kind === "loading" ? (
        <p className="m-note" role="status">
          Loading&hellip;
        </p>
      ) : coach.list.kind === "error" ? (
        <p className="m-note">Couldn&rsquo;t load your conversations.</p>
      ) : shown.length === 0 ? (
        <p className="m-note">{q ? "No conversations match." : "No conversations yet."}</p>
      ) : (
        <ul className="m-coach-saved__items">
          {shown.map((c) => (
            <li key={c.id}>
              <Link to={`/coach/${c.id}`} className="m-coach-saved__item">
                <span className="m-coach-saved__title">{c.title ?? "New conversation"}</span>
                <span className="m-coach-saved__preview">
                  {c.status === "working"
                    ? "Thinking…"
                    : c.status === "waiting_for_solver"
                      ? "Waiting for the solver…"
                      : (c.preview ?? "")}
                </span>
                <span className="m-coach-saved__time">{whenText(c.updated_at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The phone message bar (docs/coach.md §9): the cards button, the text box and
 * a round send button, fixed above the tab bar, with the disclosure and the
 * hourly usage under it. The cards button opens the Add cards sheet; a pasted
 * hand history comes from the empty screen's link or the sheet's.
 */
function PhoneComposer({
  value,
  onChange,
  onSend,
  busy,
  usage,
  followUp,
  pasteKey,
}: {
  value: string;
  onChange: (next: string) => void;
  onSend: (text: string, attachedSpot?: Spot) => Promise<boolean>;
  busy: boolean;
  usage: CoachUsage | null;
  followUp: boolean;
  pasteKey: number;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const [sheet, setSheet] = useState<null | "cards" | "paste">(null);
  const [which, setWhich] = useState<"hand" | "board">("hand");
  const [picked, setPicked] = useState<string[]>([]);
  const [pasteText, setPasteText] = useState("");
  const [pasteProblem, setPasteProblem] = useState<string | null>(null);
  const [attached, setAttached] = useState<AttachedHistory | null>(null);
  const [geminiNote, setGeminiNote] = useState(false);

  const [seenPasteKey, setSeenPasteKey] = useState(pasteKey);
  if (pasteKey !== seenPasteKey) {
    setSeenPasteKey(pasteKey);
    if (pasteKey) setSheet("paste");
  }

  async function submit() {
    if (busy) return;
    const text = withHistory(value, attached);
    if (!text) return;
    if (await onSend(text, attached?.spot)) {
      onChange("");
      setAttached(null);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // On a phone keyboard, Enter is a new line; the send button sends.
    if (e.key === "Enter" && !e.shiftKey && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  }

  function closeCards() {
    setSheet(null);
    setPicked([]);
  }

  function insertCards() {
    if (picked.length > 0) {
      const phrase = `${which === "hand" ? "my hand" : "board"}: ${cardsText(picked)}`;
      onChange(value.trim() ? `${value.trimEnd()} ${phrase}` : phrase);
    }
    closeCards();
  }

  function attachPasted() {
    const read = readHistory(pasteText);
    if ("problem" in read) {
      setPasteProblem(read.problem);
      return;
    }
    setAttached(read.attached);
    setSheet(null);
    setPasteText("");
    setPasteProblem(null);
  }

  const max = which === "hand" ? 2 : 5;
  const left = usage ? Math.max(0, usage.limit - usage.used) : null;
  const low = left !== null && left <= LOW_USAGE;

  return (
    <div className="m-coach-composer">
      {usage?.all_users_exhausted ? (
        <p className="m-coach-composer__warning" role="status">
          The Coach has answered as many questions as it can for everyone today. Try again later.
        </p>
      ) : (
        low && (
          <p className="m-coach-composer__warning" role="status">
            {left === 0
              ? "No messages left this hour. The limit frees up as the hour passes."
              : `${left} message${left === 1 ? "" : "s"} left this hour. The limit frees up as the hour passes.`}
          </p>
        )
      )}
      {attached && (
        <div className="m-coach-composer__attached">
          <span>Hand history: {attached.summary}</span>
          <button type="button" className="m-link" onClick={() => setAttached(null)} aria-label="Remove the hand history">
            Remove
          </button>
        </div>
      )}
      <div className="m-coach-composer__bar">
        <button
          type="button"
          className="m-coach-composer__cards"
          aria-label="Add cards"
          onClick={() => setSheet("cards")}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="5" y="3" width="14" height="18" rx="2" />
            <path d="M12 9v6M9 12h6" />
          </svg>
        </button>
        <label className="visually-hidden" htmlFor="coach-phone-message">
          Your message
        </label>
        <textarea
          id="coach-phone-message"
          ref={box}
          className="m-coach-composer__input"
          rows={1}
          maxLength={MAX_TEXT}
          placeholder={followUp ? "Ask a follow-up..." : "Describe your spot..."}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="m-coach-composer__send"
          onClick={submit}
          disabled={busy || (!value.trim() && !attached)}
          aria-label="Send"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </div>
      <p className="m-coach-composer__footer">
        Study tool, for after you play · Processed by{" "}
        <button type="button" className="coach-link" onClick={() => setGeminiNote((v) => !v)} aria-expanded={geminiNote}>
          Google Gemini
        </button>
        {left !== null && !low && ` · ${left} messages left this hour`}
      </p>
      {geminiNote && (
        <p className="m-coach-composer__footer">
          Google Gemini reads your messages. On the free tier Google may use them to improve its products, so
          don&rsquo;t include personal information. Deleting a conversation deletes our copy only.
        </p>
      )}

      <BottomSheet open={sheet === "cards"} onClose={closeCards} title="Add cards">
        <SegmentedControl
          label="Which cards"
          stretch
          options={[
            { value: "hand", label: "My hand" },
            { value: "board", label: "Board" },
          ]}
          value={which}
          onChange={(v) => {
            setWhich(v);
            setPicked([]);
          }}
        />
        {picked.length > 0 && (
          <p className="m-coach-cards__picked" aria-live="polite">
            {which === "hand" ? "Your hand" : "Board"}: {cardsText(picked)}{" "}
            <button type="button" className="m-link" onClick={() => setPicked([])}>
              Clear
            </button>
          </p>
        )}
        <RankSuitPicker
          key={which}
          labels={false}
          clearAfterPick
          taken={new Set(picked)}
          onPick={(card) => setPicked((prev) => (prev.length >= max ? prev : [...prev, card]))}
        />
        <p className="m-note">Adds the cards to your message as text, like &ldquo;my hand: A♥ Q♦&rdquo;.</p>
        <button type="button" className="m-btn m-btn--primary" onClick={insertCards}>
          Done
        </button>
        <button type="button" className="m-link m-coach-cards__paste" onClick={() => setSheet("paste")}>
          Paste a hand history instead
        </button>
      </BottomSheet>

      <BottomSheet open={sheet === "paste"} onClose={() => setSheet(null)} title="Paste a hand history">
        <p className="m-note">
          The app reads the hand and the Coach looks at its last decision. Say which player you were if it
          isn&rsquo;t clear from the history.
        </p>
        <textarea
          className="m-coach-paste__input"
          rows={8}
          value={pasteText}
          onChange={(e) => {
            setPasteText(e.target.value);
            setPasteProblem(null);
          }}
          aria-label="Hand history"
        />
        {pasteProblem && (
          <p className="m-coach-paste__problem" role="alert">
            {pasteProblem}
          </p>
        )}
        <button type="button" className="m-btn m-btn--primary" onClick={attachPasted} disabled={!pasteText.trim()}>
          Attach hand
        </button>
      </BottomSheet>
    </div>
  );
}
