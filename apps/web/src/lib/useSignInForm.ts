import { useState } from "react";
import type { FormEvent } from "react";
import { supabase } from "./supabase";

export type SignInMode = "sign-in" | "sign-up";

export type SignInSubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string }
  /** Signed up, but the project wants the address confirmed before a session. */
  | { kind: "check-email" };

/**
 * Email/password sign-in and sign-up against Supabase: the form state and the
 * submit. Shared by the desktop sidebar's form (components/AuthStatus) and the
 * phone account sheet (components/mobile/AccountSheet), so both behave the same.
 * `onSignedIn` runs after a successful submit.
 */
export function useSignInForm(onSignedIn?: () => void) {
  const [mode, setModeState] = useState<SignInMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitState, setSubmitState] = useState<SignInSubmitState>({ kind: "idle" });

  function setMode(next: SignInMode) {
    setModeState(next);
    setSubmitState({ kind: "idle" });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitState({ kind: "submitting" });
    const { data, error } =
      mode === "sign-in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    if (error) {
      setSubmitState({ kind: "error", message: error.message });
      return;
    }
    setPassword("");
    if (mode === "sign-up" && !data?.session) {
      setSubmitState({ kind: "check-email" });
      return;
    }
    setSubmitState({ kind: "idle" });
    onSignedIn?.();
  }

  return { mode, setMode, email, setEmail, password, setPassword, submitState, submit };
}

export async function signOut() {
  await supabase.auth.signOut();
}
