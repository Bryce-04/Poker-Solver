import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Unlike VITE_API_BASE_URL (lib/api.ts), there's no sane localhost fallback
// for a hosted auth provider -- warn loudly instead of silently building a
// client that will fail every call. See apps/web/.env.example.
//
// createClient() validates its URL argument immediately (throws on an
// empty string), so an unset env var still needs *a* well-formed URL here
// -- this placeholder domain resolves to nothing, so calls against it fail
// as ordinary network errors (already-handled outcomes) instead of a
// module-load crash that takes down the whole app.
if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set (see apps/web/.env.example) " +
      "-- sign-in will not work until apps/web/.env.local has real values.",
  );
}

export const supabase = createClient(
  supabaseUrl || "https://placeholder.invalid",
  supabaseAnonKey || "placeholder-anon-key",
);
