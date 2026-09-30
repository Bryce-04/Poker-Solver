import { useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import "./AuthStatus.css";

type Mode = "sign-in" | "sign-up";

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string };

/**
 * Minimal email/password sign-in, rendered in App.tsx's header. Email +
 * password only (no magic link) -- see docs/plan.md's Stage 6 note: magic
 * link needs a redirect URL configured in the team's Supabase dashboard
 * plus native deep-link handling this Capacitor app doesn't have yet.
 *
 * One form serves both sign-in and sign-up (toggled), rather than two
 * screens, per the "don't overbuild this" scope.
 */
export function AuthStatus() {
  const auth = useAuth();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitState({ kind: "submitting" });
    const { error } =
      mode === "sign-in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    if (error) {
      setSubmitState({ kind: "error", message: error.message });
      return;
    }
    setSubmitState({ kind: "idle" });
    setPassword("");
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  // Avoid a signed-out-form flash while the initial getSession() call is
  // still in flight.
  if (auth.status === "loading") return null;

  if (auth.status === "signed-in") {
    return (
      <div className="auth-status">
        <span className="auth-status__email">Signed in as {auth.email ?? "unknown"}</span>
        <button type="button" className="auth-status__signout" onClick={handleSignOut}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <form className="auth-status auth-status--form" onSubmit={handleSubmit}>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        aria-label="Email"
        autoComplete="email"
        required
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        aria-label="Password"
        autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
        minLength={6}
        required
      />
      <button type="submit" disabled={submitState.kind === "submitting"}>
        {mode === "sign-in" ? "Sign in" : "Sign up"}
      </button>
      <button
        type="button"
        className="auth-status__toggle"
        onClick={() => {
          setMode(mode === "sign-in" ? "sign-up" : "sign-in");
          setSubmitState({ kind: "idle" });
        }}
      >
        {mode === "sign-in" ? "Sign up instead" : "Sign in instead"}
      </button>
      {submitState.kind === "error" && (
        <span className="auth-status__error">{submitState.message}</span>
      )}
    </form>
  );
}
