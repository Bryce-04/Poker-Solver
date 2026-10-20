import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { AuthStatus } from "./components/AuthStatus/AuthStatus";
import { ErrorBoundary } from "./components/ErrorBoundary/ErrorBoundary";
import { PageHeader } from "./components/PageHeader/PageHeader";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { AuthProvider } from "./lib/auth";
import { NAV_ITEMS, PAGE_HEADERS } from "./lib/navigation";
import { readSolvePrefill } from "./lib/solvePrefill";
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

/** Desktop: the bar at the top of the content area (docs/desktop-redesign.md
 * §4), unless the page renders its own to hold page actions. */
function ShellPageHeader() {
  const header = PAGE_HEADERS[useLocation().pathname];
  if (!header || header.ownHeader) return null;
  return <PageHeader title={header.title} description={header.description} />;
}

/** /solve, optionally seeded from another screen's "solve from here"
 * (route state; see lib/solvePrefill.ts). */
function SolveRoute() {
  return <SolvePage prefill={readSolvePrefill(useLocation().state)} />;
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
        {/* Pages not yet laid out for desktop (Library) still sit in their
            phone-width column until their own phase. */}
        <main className={mainClass}>
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Navigate to="/solve" replace />} />
              <Route path="/solve" element={<SolveRoute />} />
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
