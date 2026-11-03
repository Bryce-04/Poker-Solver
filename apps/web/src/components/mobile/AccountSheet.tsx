import { useAuth } from "../../lib/auth";
import { signOut, useSignInForm } from "../../lib/useSignInForm";
import { SegmentedControl } from "../SegmentedControl/SegmentedControl";
import { BottomSheet } from "./BottomSheet";
import "./mobile.css";
import "./AccountSheet.css";

const MODES = [
  { value: "sign-in", label: "Sign in" },
  { value: "sign-up", label: "Create account" },
] as const;

/**
 * The phone account sheet (docs/mobile-redesign.md §3.3), opened from the top
 * bar's account button, the signed-out Library, and a signed-out Save.
 * Signed out: Sign in | Create account, email and password, and a note that
 * nothing else needs an account. Signed in: the email and Sign out. A
 * successful sign-in closes it.
 */
export function AccountSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const auth = useAuth();
  const form = useSignInForm(onClose);
  const signingUp = form.mode === "sign-up";
  const signedIn = auth.status === "signed-in";

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={signedIn ? "Account" : signingUp ? "Create an account" : "Sign in"}
    >
      {signedIn ? (
        <div className="account-sheet">
          <p className="account-sheet__signed-in">
            Signed in as <strong>{auth.email ?? "unknown"}</strong>
          </p>
          <button type="button" className="m-btn m-btn--ghost" onClick={signOut}>
            Sign out
          </button>
        </div>
      ) : (
        <form className="account-sheet" onSubmit={form.submit}>
          <SegmentedControl
            label="Sign in or create an account"
            options={MODES}
            value={form.mode}
            onChange={form.setMode}
            stretch
          />
          <label className="account-sheet__field">
            Email
            <input
              type="email"
              value={form.email}
              onChange={(e) => form.setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </label>
          <label className="account-sheet__field">
            Password
            <input
              type="password"
              value={form.password}
              onChange={(e) => form.setPassword(e.target.value)}
              placeholder="At least 6 characters"
              autoComplete={signingUp ? "new-password" : "current-password"}
              minLength={6}
              required
            />
          </label>
          {form.submitState.kind === "error" && (
            <p className="account-sheet__message account-sheet__message--error" role="alert">
              {form.submitState.message}
            </p>
          )}
          {form.submitState.kind === "check-email" && (
            <p className="account-sheet__message" role="status">
              Check your email to confirm your address, then sign in.
            </p>
          )}
          <button
            type="submit"
            className="m-btn m-btn--primary"
            disabled={form.submitState.kind === "submitting"}
          >
            {signingUp ? "Create account" : "Sign in"}
          </button>
          <p className="account-sheet__note">You can use Solve, Ranges and the Drill without an account.</p>
        </form>
      )}
    </BottomSheet>
  );
}
