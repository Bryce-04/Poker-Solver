import { useAuth } from "../../lib/auth";
import "./mobile.css";
import "./TopBar.css";

export interface TopBarProps {
  title: string;
  /** Receives the element pages render their actions into (TopBarActions). */
  actionsRef: (element: HTMLElement | null) => void;
  onAccount: () => void;
  /** A back arrow before the title (a page's TopBarTitle). */
  back?: { label: string; onClick: () => void } | null;
}

/**
 * The phone top bar (docs/mobile-redesign.md §3.1): sticky, 56px plus the
 * status bar's height, which it covers with a solid background so content
 * never scrolls under the status bar (§2). The page title on the left; on the
 * right the page's own actions, then the account button: the user's initial
 * when signed in, a person outline when not.
 */
export function TopBar({ title, actionsRef, onAccount, back }: TopBarProps) {
  const auth = useAuth();
  const signedIn = auth.status === "signed-in";
  const initial = signedIn ? (auth.email ?? "?").charAt(0).toUpperCase() : null;

  return (
    <header className="top-bar">
      <div className="top-bar__inner" data-back={back ? true : undefined}>
        {back && (
          <button type="button" className="icon-button top-bar__back" aria-label={back.label} onClick={back.onClick}>
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
        )}
        <h1 className="top-bar__title">{title}</h1>
        <div className="top-bar__actions" ref={actionsRef} />
        <button
          type="button"
          className="icon-button"
          aria-label={signedIn ? "Account" : "Sign in"}
          onClick={onAccount}
        >
          {initial ? (
            <span className="top-bar__avatar" aria-hidden="true">
              {initial}
            </span>
          ) : (
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
            </svg>
          )}
        </button>
      </div>
    </header>
  );
}
