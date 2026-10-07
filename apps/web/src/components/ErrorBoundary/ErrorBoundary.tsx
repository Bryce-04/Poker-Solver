import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import "./ErrorBoundary.css";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches a rendering exception anywhere below it and shows a recoverable
 * message instead of letting React unmount the whole tree to a blank
 * screen -- confirmed as the actual cause of a reported bug (2026-10-07,
 * docs/decisions.md): SolvePage read a response field (bucketed_actions)
 * that an older deployed backend didn't send yet, threw mid-render on a
 * real phone after a ~60s solve, and with no error boundary anywhere in
 * the app, the whole screen went black with no way to recover short of
 * force-closing. That specific crash is fixed at the source (lib/api.ts
 * normalizes the response), but this exists so the *next* unexpected
 * response shape degrades to a visible, dismissable error instead of
 * repeating the same failure mode silently.
 *
 * Must be a class component -- getDerivedStateFromError/componentDidCatch
 * have no hook equivalent yet.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console -- the one place this app
    // deliberately logs to the console: there's no error-reporting
    // service wired up, and this is strictly better than the silent
    // blank screen it replaces.
    console.error("Unhandled error in app:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary" role="alert">
          <p className="error-boundary__title">Something went wrong.</p>
          <p>{this.state.error.message}</p>
          <button
            type="button"
            className="error-boundary__reset"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
