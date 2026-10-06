import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

// Default value (no <AuthProvider> in the tree) is "loading" rather than
// throwing -- App.tsx always mounts the provider, but this keeps any
// component that calls useAuth() safe to render standalone in a test that
// doesn't need to exercise auth.
export type AuthState =
  | { status: "loading"; email: null }
  | { status: "signed-out"; email: null }
  | { status: "signed-in"; email: string | null };

const AuthContext = createContext<AuthState>({ status: "loading", email: null });

function sessionToState(session: Session | null): AuthState {
  return session
    ? { status: "signed-in", email: session.user.email ?? null }
    : { status: "signed-out", email: null };
}

/**
 * Wraps the app in Supabase session state. Mounted in App.tsx around
 * BrowserRouter (not lifted to main.tsx) -- see docs/decisions.md's
 * "BrowserRouter lives inside App.tsx" entry for why that nesting matters
 * to App.test.tsx.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading", email: null });

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setState(sessionToState(data.session));
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setState(sessionToState(session));
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

// lib/api.ts is a plain module, not a component, so it can't call
// useAuth(). Supabase's client caches the session locally, so calling this
// per-request is cheap -- it doesn't hit the network unless the token needs
// refreshing.
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
