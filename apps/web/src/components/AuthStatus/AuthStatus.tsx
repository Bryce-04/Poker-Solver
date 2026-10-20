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
 *
 * `variant="sidebar"` is the desktop shell's account row
 * (docs/desktop-redesign.md §4): an initial avatar, the email truncated, and
 * a ghost "Sign out"; signed out, a "Sign in" button that opens the same
 * form, stacked.
 */
export function AuthStatus({ variant = "header" }: { variant?: "header" | "sidebar" }) {
  const auth = useAuth();
  const [formOpen, setFormOpen] = useState(false);
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

  if (auth.status === "signed-in" && variant === "sidebar") {
    const accountEmail = auth.email ?? "unknown";
    return (
      <div className="sidebar-account">
        <span className="sidebar-account__avatar" aria-hidden="true">
          {accountEmail.charAt(0).toUpperCase()}
        </span>
        <span className="sidebar-account__email" title={accountEmail}>
          {accountEmail}
        </span>
        <button type="button" className="sidebar-account__signout btn-ghost" onClick={handleSignOut}>
          Sign out
        </button>
      </div>
    );
  }

  if (auth.status === "signed-in") {
    return (
      <div className="auth-status">
        <span className="auth-status__email">Signed in as {auth.email ?? "unknown"}</span>
        <button type="button" className="auth-status__signout btn-ghost" onClick={handleSignOut}>
          Sign out
        </button>
      </div>
    );
  }

  if (variant === "sidebar" && !formOpen) {
    return (
      <button type="button" className="sidebar-account__signin btn-primary" onClick={() => setFormOpen(true)}>
        Sign in
      </button>
    );
  }

  return (
    <form
      className={`auth-status auth-status--form${variant === "sidebar" ? " auth-status--stacked" : ""}`}
      onSubmit={handleSubmit}
    >
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
      <button type="submit" className="btn-primary" disabled={submitState.kind === "submitting"}>
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
