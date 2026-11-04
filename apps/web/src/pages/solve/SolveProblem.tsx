import type { Outcome } from "./useSolveSetup";
import "../../components/SpotBuilder/SpotBuilder.css";

/** Why a solve didn't come back with a result, if it didn't. Shared by the
 * desktop workspace and the phone's Ready step, so both say the same thing. */
export function SolveProblem({ outcome }: { outcome: Outcome }) {
  switch (outcome.kind) {
    case "invalid":
      return (
        <div className="spot-builder__status-block spot-builder__status-block--error" role="alert">
          <p className="spot-builder__status-title">The server couldn&rsquo;t use this spot.</p>
          <ul className="spot-builder__issues">
            {outcome.issues.map((issue, i) => (
              <li key={i}>
                <code className="spot-builder__issue-loc">{issue.loc.join(" > ")}</code> &mdash; {issue.msg}
              </li>
            ))}
          </ul>
        </div>
      );
    case "rejected":
      return (
        <div className="spot-builder__status-block spot-builder__status-block--error" role="alert">
          <p className="spot-builder__status-title">Can&rsquo;t solve this spot yet.</p>
          <p>{outcome.reason}</p>
        </div>
      );
    case "busy":
      return (
        <div className="spot-builder__status-block spot-builder__status-block--error" role="alert">
          <p className="spot-builder__status-title">The solver is busy.</p>
          <p>Another solve is already running on the server. Try again in a minute.</p>
        </div>
      );
    case "network-error":
      return (
        <div className="spot-builder__status-block spot-builder__status-block--error" role="alert">
          <p className="spot-builder__status-title">Couldn&rsquo;t reach the server.</p>
          <p>Check your connection and try again. The server may also be waking up &mdash; give it a minute.</p>
          {import.meta.env.DEV && (
            <p>
              Dev: is <code>apps/api</code> running? Start it with{" "}
              <code>cd apps/api &amp;&amp; uvicorn app.main:app --reload</code>.
            </p>
          )}
        </div>
      );
    case "error":
      return (
        <div className="spot-builder__status-block spot-builder__status-block--error" role="alert">
          <p className="spot-builder__status-title">Something went wrong.</p>
          <p>The request failed with HTTP {outcome.status}.</p>
        </div>
      );
    default:
      return null;
  }
}
