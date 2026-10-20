import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { AuthStatus } from "./components/AuthStatus/AuthStatus";
import { ErrorBoundary } from "./components/ErrorBoundary/ErrorBoundary";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { AuthProvider } from "./lib/auth";
import { NAV_ITEMS, PAGE_HEADERS } from "./lib/navigation";
import { useIsDesktop } from "./lib/useIsDesktop";
import { SavedSpotsPage } from "./pages/SavedSpotsPage";
import { RangesPage } from "./pages/RangesPage";
import { SolvePage } from "./pages/SolvePage";
import { DrillPage } from "./pages/DrillPage";
import "./App.css";

// react-router-dom v7's NavLink doesn't auto-apply an "active" class (that
// was a v5 default) -- it hands back isActive via a render-prop instead.
function navLinkClassName({ isActive }: { isActive: boolean }) {
  return isActive ? "active" : undefined;
}

/** Phones (< 1024px): the original top header, nav as one row of links. */
function MobileHeader() {
  return (
    <header className="app__header">
      <div className="app__title">
        <img className="app__logo" src="/favicon.svg" alt="" />
        <h1>Poker Solver</h1>
      </div>
      <p className="app__tagline">
        Manual hand builder, preflop reference charts, and a postflop
        solver.
      </p>
      <nav className="app__nav">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.id} to={item.to} className={navLinkClassName}>
            {item.label}
          </NavLink>
        ))}
      </nav>
      <AuthStatus />
    </header>
  );
}

/** Desktop: the bar at the top of the content area -- page title and a
 * one-line description (docs/desktop-redesign.md §4). */
function PageHeader() {
  const header = PAGE_HEADERS[useLocation().pathname];
  if (!header) return null;
  return (
    <header className="page-header">
      <div>
        <h1 className="page-header__title">{header.title}</h1>
        <p className="page-header__description">{header.description}</p>
      </div>
    </header>
  );
}

/**
 * The router shell. BrowserRouter lives in App (not main.tsx) so
 * App.test.tsx's `render(<App />)` keeps working with no extra wrapper.
 *
 * Four destinations (docs/desktop-redesign.md §3): Solve, Ranges (Builder,
 * Type in and Import merged), Library (was Saved), Drill. The old routes
 * redirect so links and bookmarks keep working.
 *
 * At >= 1024px the header becomes a left sidebar and pages get a header
 * bar. The <main> stays at the same place in the tree in both layouts, so
 * resizing across the breakpoint doesn't remount the page and lose a
 * half-built spot.
 */
function Shell() {
  const isDesktop = useIsDesktop();
  return (
    <div className={isDesktop ? "app-shell" : "app"}>
      {isDesktop ? <Sidebar /> : <MobileHeader />}
      <div className={isDesktop ? "app-shell__content" : undefined}>
        {isDesktop && <PageHeader />}
        {/* Interim: the pages are still their phone-width single column
            until each one's own phase (3-5) lays it out for desktop. */}
        <main className={isDesktop ? "app-shell__main app-shell__main--narrow" : undefined}>
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Navigate to="/solve" replace />} />
              <Route path="/solve" element={<SolvePage />} />
              <Route path="/ranges" element={<RangesPage />} />
              <Route path="/library" element={<SavedSpotsPage />} />
              <Route path="/saved" element={<Navigate to="/library" replace />} />
              <Route path="/type-in" element={<Navigate to="/ranges?mode=type" replace />} />
              <Route path="/import" element={<Navigate to="/ranges?mode=paste" replace />} />
            </Routes>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* The Drill is a full-screen "game": no header or nav around it,
              and its own exit button back to the app. */}
          <Route path="/drill" element={<DrillPage />} />
          <Route path="*" element={<Shell />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
