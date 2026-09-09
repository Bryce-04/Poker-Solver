import { SpotBuilder } from "./components/SpotBuilder/SpotBuilder";
import "./App.css";

/**
 * Stage 2 app shell -- deliberately minimal. Mounts the SpotBuilder (which
 * renders RangeGrid for its results). Nav, routing, and the real visual
 * pass are still open Stage 2 tickets; this just makes the scaffold
 * reachable in the browser so work on it is visible as it happens.
 * See docs/plan.md.
 */
function App() {
  return (
    <div className="app">
      <header className="app__header">
        <h1>Poker Solver</h1>
        <p className="app__tagline">
          Stage 2 &mdash; manual hand builder. Output is a reference chart, not a
          live solve.
        </p>
      </header>
      <main>
        <SpotBuilder />
      </main>
    </div>
  );
}

export default App;
