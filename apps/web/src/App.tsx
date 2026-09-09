import { SpotBuilder } from "./components/SpotBuilder/SpotBuilder";
import "./App.css";

/**
 * Stage 2 app shell -- deliberately minimal. Mounts the SpotBuilder (which
 * renders RangeGrid for its results). Multi-page routing is still an open
 * Stage 2 ticket; right now there's one screen, so this just frames it.
 * See docs/plan.md.
 */
function App() {
  return (
    <div className="app">
      <header className="app__header">
        <div className="app__title">
          <img className="app__logo" src="/favicon.svg" alt="" />
          <h1>Poker Solver</h1>
        </div>
        <p className="app__tagline">
          Manual hand builder &mdash; output is a reference chart, not a live
          solve.
        </p>
      </header>
      <main>
        <SpotBuilder />
      </main>
    </div>
  );
}

export default App;
