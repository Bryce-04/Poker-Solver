import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  COACH_MAX_MESSAGES,
  streamCoach,
  type CoachChatMessage,
  type CoachContext,
} from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { COACH_FALLBACK_NOTE } from "../../lib/coach";

/** Everything that can go wrong with a chat turn that isn't answered by the app's own text. */
export type CoachChatFailure =
  | { kind: "signed-out" }
  | { kind: "interrupted" }
  | { kind: "network-error" }
  | { kind: "error"; status: number };

/** A finished turn. `note` says the app's own explanation was shown instead of an AI answer. */
type Turn = CoachChatMessage & { note?: string };

/** The line shown for each way asking the coach can fail. */
export function coachFailureText(failure: CoachChatFailure): string {
  switch (failure.kind) {
    case "signed-out":
      return "Sign in to use the AI coach.";
    case "interrupted":
      return "The coach stopped partway. Try again.";
    case "network-error":
      return "Couldn't reach the server. Check your connection and try again.";
    case "error":
      return `Something went wrong (${failure.status}). Try again.`;
  }
}

/**
 * The AI coach under a graded Drill answer: it explains the hand, streaming the
 * words in as they're written, then you can ask follow-ups (typed, or one of the
 * suggested questions). It only words what the solver computed; the note under
 * the first answer says so. Remount it (React `key`) per hand so each starts fresh.
 */
export function CoachChat({
  context,
  suggestions = [],
}: {
  context: CoachContext;
  suggestions?: string[];
}) {
  const auth = useAuth();
  /** Finished turns. Always opens with the coach's first answer, which the server needs. */
  const [messages, setMessages] = useState<Turn[]>([]);
  /** The question being answered right now, shown before its answer arrives. */
  const [asking, setAsking] = useState<string | null>(null);
  /** The answer so far while it streams. Null when nothing is in flight. */
  const [streaming, setStreaming] = useState<string | null>(null);
  const [failure, setFailure] = useState<CoachChatFailure | null>(null);
  const [draft, setDraft] = useState("");
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    // New words arrive below the fold on a phone; keep them in view.
    if (typeof end.current?.scrollIntoView === "function") {
      end.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [streaming, asking, messages.length]);

  const busy = streaming !== null;
  const started = messages.length > 0;
  const canAsk = messages.length + 1 <= COACH_MAX_MESSAGES;

  async function send(question: string | null) {
    const history: Turn[] = question ? [...messages, { role: "user", content: question }] : [];
    const controller = new AbortController();
    abort.current = controller;
    setFailure(null);
    setAsking(question);
    setStreaming("");
    let text = "";
    const outcome = await streamCoach(
      context,
      history.map(({ role, content }) => ({ role, content })), // the server doesn't want our notes

      (delta) => {
        text += delta;
        setStreaming(text);
      },
      controller.signal,
    );
    if (controller.signal.aborted) return;
    setStreaming(null);
    setAsking(null);
    if (outcome.kind === "done") {
      const note = outcome.fallback ? COACH_FALLBACK_NOTE[outcome.fallback] : undefined;
      setMessages([...history, { role: "assistant", content: text, note }]);
    } else {
      setFailure(outcome);
      if (question) setDraft(question); // give the question back so it can be re-sent
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const question = draft.trim();
    if (!question || busy || !canAsk) return;
    setDraft("");
    void send(question);
  }

  if (auth.status === "signed-out" || failure?.kind === "signed-out") {
    return (
      <section className="coach" aria-label="AI coach">
        <p className="coach__msg">Sign in to ask the AI coach why.</p>
      </section>
    );
  }

  const asked = new Set(messages.filter((m) => m.role === "user").map((m) => m.content));
  const chips = suggestions.filter((q) => !asked.has(q));
  return (
    <section className="coach" aria-label="AI coach" aria-busy={busy}>
      {!started && !busy && (
        <button type="button" className="coach__ask" onClick={() => void send(null)}>
          {failure ? "Try again" : "Ask the coach to explain"}
        </button>
      )}

      {(started || busy) && <p className="coach__title">Coach</p>}
      {messages.map((m, i) =>
        m.role === "assistant" ? (
          <div key={i}>
            <p className="coach__text">{m.content}</p>
            {m.note && <p className="coach__note">{m.note}</p>}
          </div>
        ) : (
          <p key={i} className="coach__you">
            {m.content}
          </p>
        ),
      )}
      {asking && <p className="coach__you">{asking}</p>}
      {busy && (
        <p className="coach__text" aria-live="off">
          {streaming || <span className="coach__thinking">Thinking…</span>}
        </p>
      )}

      {failure && (
        <p className="coach__msg" role="alert">
          {coachFailureText(failure)}
        </p>
      )}

      {started && messages.some((m) => m.role === "assistant" && !m.note) && (
        <p className="coach__note">
          AI-written from the solver&rsquo;s numbers above. The solver, not the AI, decides what is
          right.
        </p>
      )}

      {started && canAsk && (
        <>
          {!busy && chips.length > 0 && (
            <div className="coach__chips">
              {chips.map((q) => (
                <button key={q} type="button" className="coach__chip" onClick={() => void send(q)}>
                  {q}
                </button>
              ))}
            </div>
          )}
          <form className="coach__form" onSubmit={submit}>
            <input
              className="coach__input"
              type="text"
              value={draft}
              maxLength={300}
              placeholder="Ask a follow-up…"
              aria-label="Ask the coach a question"
              disabled={busy}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="submit" className="coach__send" disabled={busy || !draft.trim()}>
              Send
            </button>
          </form>
        </>
      )}
      {started && !canAsk && (
        <p className="coach__msg">That&rsquo;s the limit for this hand. Play the next one to keep going.</p>
      )}
      <div ref={end} />
    </section>
  );
}
