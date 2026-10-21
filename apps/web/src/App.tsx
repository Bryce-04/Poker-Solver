import { useState } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { AuthStatus } from "./components/AuthStatus/AuthStatus";
import { ErrorBoundary } from "./components/ErrorBoundary/ErrorBoundary";
import { PageHeader } from "./components/PageHeader/PageHeader";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { AuthProvider } from "./lib/auth";
import { NAV_ITEMS, PAGE_HEADERS } from "./lib/navigation";
import { readSavedSpot, readSolvePrefill } from "./lib/solvePrefill";
import { useIsDesktop } from "./lib/useIsDesktop";
import { LibraryPage } from "./pages/LibraryPage";
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

/** Desktop: the bar at the top of the content area (docs/desktop-redesign.md
 * §4), unless the page renders its own to hold page actions. */
function ShellPageHeader() {
  const header = PAGE_HEADERS[useLocation().pathname];
  if (!header || header.ownHeader) return null;
  return <PageHeader title={header.title} description={header.description} />;
}

/**
 * /solve (optionally seeded from route state, lib/solvePrefill.ts: Ranges'
 * "solve from here", or a spot opened from the Library), kept mounted once
 * visited. The Solve page holds the whole setup (hand, board, ranges, result)
 * in its own state, so rendering it as an ordinary route threw a half-built
 * spot away whenever you tapped another tab. Here it stays mounted but hidden
 * (`display: none`) off /solve, and the state survives. Arriving WITH route
 * state starts a fresh instance, keyed by that navigation, so the seed still
 * applies; a plain nav click returns to the one you left. Start over / Reset
 * still clear it.
 */
function SolveKeepAlive() {
  const location = useLocation();
  const active = location.pathname === "/solve";
  const prefill = readSolvePrefill(location.state);
  const savedSpot = readSavedSpot(location.state);
  const [instance, setInstance] = useState<{ key: string; prefill: typeof prefill; savedSpot: typeof savedSpot } | null>(null);
  if (active && (instance === null || ((prefill || savedSpot) && instance.key !== location.key))) {
    setInstance({ key: location.key, prefill, savedSpot });
  }
  if (instance === null) return null;
  return (
    <div style={{ display: active ? "contents" : "none" }}>
      <SolvePage key={instance.key} prefill={instance.prefill} savedSpot={instance.savedSpot} />
    </div>
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
  const workspace = PAGE_HEADERS[useLocation().pathname]?.workspace === true;
  const mainClass = !isDesktop
    ? undefined
    : workspace
      ? "app-shell__main app-shell__main--workspace"
      : "app-shell__main app-shell__main--narrow";
  return (
    <div className={isDesktop ? "app-shell" : "app"}>
      {isDesktop ? <Sidebar /> : <MobileHeader />}
      <div className={isDesktop ? "app-shell__content" : undefined}>
        {isDesktop && <ShellPageHeader />}
        <main className={mainClass}>
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Navigate to="/solve" replace />} />
              <Route path="/solve" element={null} />
              <Route path="/ranges" element={<RangesPage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/saved" element={<Navigate to="/library" replace />} />
              <Route path="/type-in" element={<Navigate to="/ranges?mode=type" replace />} />
              <Route path="/import" element={<Navigate to="/ranges?mode=paste" replace />} />
            </Routes>
            <SolveKeepAlive />
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
