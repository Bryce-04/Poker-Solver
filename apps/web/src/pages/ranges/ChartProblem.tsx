import type { ChartOutcome } from "../../lib/useReferenceChart";
import "../../components/SpotBuilder/SpotBuilder.css";

/**
 * Why there's no chart to show: no standard chart covers the spot, or the
 * request failed. Shared by the desktop Ranges canvas and the phone Ranges
 * page; nothing for any other outcome.
 */
export function ChartProblem({ outcome }: { outcome: ChartOutcome }) {
  switch (outcome.kind) {
    case "no-match":
      return (
        <div className="spot-builder__status-block spot-builder__status-block--info" role="status">
          <p className="spot-builder__status-title">No standard chart for this spot yet.</p>
          <p>The built-in charts (6-max) currently cover:</p>
          <ul>
            <li>Opening ranges (nobody has raised): UTG, HJ, CO, BTN, SB.</li>
            <li>
              Facing one raise: BB vs any of UTG/HJ/CO/BTN/SB; BTN vs HJ or CO; SB vs CO or BTN.
            </li>
            <li>Stacks of about 40bb (30&ndash;50) or 100bb (80&ndash;120).</li>
            <li>Preflop only: one raise, no re-raised (3-bet) pots yet.</li>
          </ul>
        </div>
      );
    case "invalid":
      return (
        <div className="spot-builder__status-block spot-builder__status-block--error" role="alert">
          <p className="spot-builder__status-title">The server couldn&rsquo;t use that spot.</p>
          <ul className="spot-builder__issues">
            {outcome.issues.map((issue, idx) => (
              <li key={idx}>
                <code className="spot-builder__issue-loc">{issue.loc.join(" > ")}</code> &mdash; {issue.msg}
              </li>
            ))}
          </ul>
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
