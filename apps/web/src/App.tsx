import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { AuthStatus } from "./components/AuthStatus/AuthStatus";
import { AuthProvider } from "./lib/auth";
import { BuilderPage } from "./pages/BuilderPage";
import { SavedSpotsPage } from "./pages/SavedSpotsPage";
import { TypeInPage } from "./pages/TypeInPage";
import { ImportPage } from "./pages/ImportPage";
import "./App.css";

// react-router-dom v7's NavLink doesn't auto-apply an "active" class (that
// was a v5 default) -- it hands back isActive via a render-prop instead.
function navLinkClassName({ isActive }: { isActive: boolean }) {
  return isActive ? "active" : undefined;
}

/**
 * Stage 2 app shell -- now the router shell too. BrowserRouter lives here
 * (not in main.tsx) so App.test.tsx's `render(<App />)` keeps working with
 * no extra wrapper. Four screens: Builder (Stage 2), Saved, Type in
 * (Stage 3), Import (Stage 4 hand-history paste). See docs/plan.md.
 */
function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
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
              <NavLink to="/import" className={navLinkClassName}>
                Import
              </NavLink>
            </nav>
            <AuthStatus />
          </header>
          <main>
            <Routes>
              <Route path="/" element={<BuilderPage />} />
              <Route path="/saved" element={<SavedSpotsPage />} />
              <Route path="/type-in" element={<TypeInPage />} />
              <Route path="/import" element={<ImportPage />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
