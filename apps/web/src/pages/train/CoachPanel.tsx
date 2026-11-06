import { useState } from "react";
import { askCoach, type CoachContext } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useOpenAccountSheet } from "../../lib/mobileShell";
import "../TrainPage.css";

const QUICK_QUESTIONS = [
  "Explain this in simpler words.",
  "Why isn't the other choice better?",
  "What should I look for next time?",
];

/** Said under every answer the model wrote, so what is AI-written is never mistaken for what is graded. */
export const AI_NOTE = "AI-written from the facts above. The solver and the charts, not the AI, decide what is right.";

const FALLBACK_NOTE: Record<string, string> = {
  not_configured: "The AI coach isn't switched on yet, so this is the app's own explanation.",
  rate_limited: "You've asked a lot of questions this hour, so this is the app's own explanation. Try again later.",
  unavailable: "The AI coach couldn't be reached just now, so this is the app's own explanation.",
};

type CoachState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "answer"; text: string; note: string | null; ai: boolean }
  | { kind: "error"; message: string };

/**
 * "Ask the coach" under an answered question. The coach (apps/api's /coach)
 * explains from the facts this question already computed from the solver or
 * range data; it never decides what's right. Needs sign-in, which spends the
 * shared free-tier quota only on real accounts.
 */
export function CoachPanel({ context }: { context: CoachContext }) {
  const auth = useAuth();
  const openAccountSheet = useOpenAccountSheet();
  const [text, setText] = useState("");
  const [state, setState] = useState<CoachState>({ kind: "idle" });

  async function ask(question: string) {
    const q = question.trim();
    if (!q) return;
    setState({ kind: "loading" });
    const result = await askCoach(q, context);
    if (result.kind === "answer") {
      const { answer, source, reason } = result.data;
      setState({
        kind: "answer",
        text: answer,
        note: source === "fallback" && reason ? (FALLBACK_NOTE[reason] ?? null) : null,
        ai: source === "ai",
      });
    } else if (result.kind === "signed-out") {
      setState({ kind: "error", message: "Sign in to ask the coach." });
    } else if (result.kind === "network-error") {
      setState({ kind: "error", message: "Couldn't reach the server. Check your connection and try again." });
    } else {
      setState({ kind: "error", message: "The coach hit a problem. Try again in a moment." });
    }
  }

  if (auth.status !== "signed-in") {
    return (
      <div className="train__coach">
        <p className="train__coach-title">Ask the coach</p>
        <p className="train__text">
          {auth.status === "loading" ? "Checking your sign-in…" : "Sign in to ask the AI coach follow-up questions about this answer."}
        </p>
        {auth.status === "signed-out" && openAccountSheet && (
          <button type="button" className="train__link" onClick={openAccountSheet}>
            Sign in
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="train__coach">
      <p className="train__coach-title">Ask the coach</p>
      <div className="train__chips">
        {QUICK_QUESTIONS.map((q) => (
          <button key={q} type="button" className="train__chip" disabled={state.kind === "loading"} onClick={() => ask(q)}>
            {q}
          </button>
        ))}
      </div>
      <form
        className="train__ask"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(text);
        }}
      >
        <input
          className="train__input"
          value={text}
          maxLength={300}
          placeholder="Ask your own question"
          aria-label="Your question for the coach"
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="train__chip" disabled={state.kind === "loading" || text.trim() === ""}>
          Ask
        </button>
      </form>
      <div role="status" aria-live="polite">
        {state.kind === "loading" && <p className="train__hint">The coach is thinking…</p>}
        {state.kind === "answer" && (
          <>
            <p className="train__text train__coach-answer">{state.text}</p>
            {state.note && <p className="train__hint">{state.note}</p>}
            {state.ai && <p className="train__hint">{AI_NOTE}</p>}
          </>
        )}
        {state.kind === "error" && <p className="train__hint">{state.message}</p>}
      </div>
    </div>
  );
}
