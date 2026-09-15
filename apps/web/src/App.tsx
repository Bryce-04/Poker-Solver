import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { BuilderPage } from "./pages/BuilderPage";
import { SavedSpotsPage } from "./pages/SavedSpotsPage";
import { TypeInPage } from "./pages/TypeInPage";
import "./App.css";

// react-router-dom v7's NavLink doesn't auto-apply an "active" class (that
// was a v5 default) -- it hands back isActive via a render-prop instead.
function navLinkClassName({ isActive }: { isActive: boolean }) {
  return isActive ? "active" : undefined;
}

/**
 * Stage 2 app shell -- now the router shell too. BrowserRouter lives here
 * (not in main.tsx) so App.test.tsx's `render(<App />)` keeps working with
 * no extra wrapper. Nav, routing, and the real visual pass were Stage 2
 * tickets; this makes the three lane deliverables (builder / saved /
 * type-in) reachable as separate screens. See docs/plan.md.
 */
function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <header className="app__header">
          <h1>Poker Solver</h1>
          <p className="app__tagline">
            Stage 2 &mdash; manual hand builder. Output is a reference chart, not a
            live solve.
          </p>
          <nav className="app__nav">
            <NavLink to="/" end className={navLinkClassName}>
              Builder
            </NavLink>
            <NavLink to="/saved" className={navLinkClassName}>
              Saved
            </NavLink>
            <NavLink to="/type-in" className={navLinkClassName}>
              Type in
            </NavLink>
          </nav>
        </header>
        <main>
          <Routes>
            <Route path="/" element={<BuilderPage />} />
            <Route path="/saved" element={<SavedSpotsPage />} />
            <Route path="/type-in" element={<TypeInPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
