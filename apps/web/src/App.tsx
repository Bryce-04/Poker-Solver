import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useMatch } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary/ErrorBoundary";
import { AccountSheet } from "./components/mobile/AccountSheet";
import { TabBar } from "./components/mobile/TabBar";
import { TopBar } from "./components/mobile/TopBar";
import { PageHeader } from "./components/PageHeader/PageHeader";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { AuthProvider } from "./lib/auth";
import { AccountSheetContext, PageActiveContext, SolveBadgeContext, TopBarSlotContext } from "./lib/mobileShell";
import { NAV_ITEMS, PAGE_HEADERS, type NavId } from "./lib/navigation";
import { readSavedSpot, readSolvePrefill, type SolvePrefill } from "./lib/solvePrefill";
import { useIsDesktop } from "./lib/useIsDesktop";
import { LibraryPage } from "./pages/LibraryPage";
import { RangesPage } from "./pages/RangesPage";
import { SolvePage } from "./pages/SolvePage";
import { DrillPage } from "./pages/DrillPage";
import type { Spot } from "@poker-solver/schema";
import "./components/mobile/mobile.css";
import "./App.css";

/** Which nav destination a path belongs to, if any. A trailing slash
 * ("/solve/") is the same page, as it is to the router. */
function tabFor(pathname: string): NavId | undefined {
  const path = pathname.replace(/\/+$/, "") || "/";
  return NAV_ITEMS.find((item) => item.to === path)?.id;
}

/** Desktop: the bar at the top of the content area (docs/desktop-redesign.md
 * §4), unless the page renders its own to hold page actions. */
function ShellPageHeader() {
  const header = PAGE_HEADERS[useLocation().pathname];
  if (!header || header.ownHeader) return null;
  return <PageHeader title={header.title} description={header.description} />;
}

type SolveInstance = { key: string; prefill?: SolvePrefill; savedSpot?: Spot };

/**
 * Solve, kept mounted on phones while another tab is showing, so leaving
 * Solve mid-setup and coming back finds the setup as you left it
 * (docs/mobile-redesign.md §3.2), and a running solve keeps running (§4.4).
 * It's hidden, not unmounted, and its top-bar actions are switched off.
 *
 * Arriving with route state (lib/solvePrefill.ts: Ranges' "solve from here",
 * a spot opened from the Library) starts a fresh setup from it. The setup
 * hook reads that state when it mounts, so the instance is keyed by the
 * arrival.
 *
 * **Desktop is unchanged:** Solve unmounts when you leave it and starts
 * blank when you come back, as it always has (the "away" key below).
 */
function SolveKeepAlive() {
  const location = useLocation();
  const isDesktop = useIsDesktop();
  // The router's matching, so "/solve/" counts too, the same as <Route>.
  const onSolve = useMatch("/solve") !== null;
  const prefill = onSolve ? readSolvePrefill(location.state) : undefined;
  const savedSpot = onSolve ? readSavedSpot(location.state) : undefined;
  const seedKey = prefill || savedSpot ? location.key : null;

  const [instance, setInstance] = useState<SolveInstance>(() => ({
    key: seedKey ?? "blank",
    prefill,
    savedSpot,
  }));
  let current = instance;
  if (seedKey && seedKey !== instance.key) current = { key: seedKey, prefill, savedSpot };
  else if (isDesktop && !onSolve && instance.key !== "away") current = { key: "away" };
  if (current !== instance) setInstance(current);

  if (isDesktop && !onSolve) return null;
  return (
    <PageActiveContext.Provider value={onSolve}>
      <div style={{ display: onSolve ? "contents" : "none" }}>
        <SolvePage key={current.key} prefill={current.prefill} savedSpot={current.savedSpot} />
      </div>
    </PageActiveContext.Provider>
  );
}

/**
 * Where each phone tab was last left (path + query), the tab used last, and
 * each tab's scroll position (docs/mobile-redesign.md §3.2): the tab bar
 * links to those paths, "/" (where the Drill's X goes) returns to the last
 * tab, and switching tabs puts each one back where it was scrolled to.
 */
function useTabMemory(enabled: boolean) {
  const { pathname, search } = useLocation();
  const tab = tabFor(pathname);
  const [memory, setMemory] = useState<{ paths: Partial<Record<NavId, string>>; lastTab: NavId }>({
    paths: {},
    lastTab: "solve",
  });
  const scrolls = useRef<Partial<Record<NavId, number>>>({});

  // Updated during render as the location changes (no effect round trip).
  const path = pathname + search;
  if (tab && tab !== "drill" && (memory.paths[tab] !== path || memory.lastTab !== tab)) {
    setMemory({ paths: { ...memory.paths, [tab]: path }, lastTab: tab });
  }
  const { paths, lastTab } = memory;

  // Record the scroll position as it changes; reading it once the next tab has
  // rendered would get a value already clamped to that page's height.
  useEffect(() => {
    if (!enabled || !tab) return;
    function onScroll() {
      scrolls.current[tab!] = window.scrollY;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [enabled, tab]);

  useLayoutEffect(() => {
    if (!enabled || !tab || tab === "drill") return;
    window.scrollTo(0, scrolls.current[tab] ?? 0);
  }, [enabled, tab]);

  return { paths, lastPath: paths[lastTab] ?? "/solve" };
}

/**
 * The app shell around every page but the Drill.
 *
 * Four destinations (docs/desktop-redesign.md §3): Solve, Ranges, Library,
 * Drill. The old routes redirect so links and bookmarks keep working.
 *
 * Phones and tablets (< 1024px; docs/mobile-redesign.md §3): a sticky top bar
 * (page title, the page's actions, the account button), the page in a column
 * at most 560px wide, a fixed bottom tab bar, and the account sheet. Desktop
 * (>= 1024px): a left sidebar and a page header bar.
 *
 * The <main> stays at the same place in the tree in both layouts, so
 * resizing across the breakpoint doesn't remount the page and lose a
 * half-built spot.
 */
function Shell() {
  const isDesktop = useIsDesktop();
  const { pathname } = useLocation();
  const { paths, lastPath } = useTabMemory(!isDesktop);
  const [topBarSlot, setTopBarSlot] = useState<HTMLElement | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [solveBadge, setSolveBadge] = useState<string | null>(null);

  const workspace = PAGE_HEADERS[pathname]?.workspace === true;
  const tab = tabFor(pathname);
  const title = NAV_ITEMS.find((item) => item.id === tab)?.label ?? "Poker Solver";
  const mainClass = !isDesktop
    ? "app__main"
    : workspace
      ? "app-shell__main app-shell__main--workspace"
      : "app-shell__main app-shell__main--narrow";

  return (
    <AccountSheetContext.Provider value={isDesktop ? null : () => setAccountOpen(true)}>
      <SolveBadgeContext.Provider value={isDesktop ? null : setSolveBadge}>
      <TopBarSlotContext.Provider value={isDesktop ? null : topBarSlot}>
        <div className={isDesktop ? "app-shell" : "app"}>
          {isDesktop ? (
            <Sidebar />
          ) : (
            <TopBar title={title} actionsRef={setTopBarSlot} onAccount={() => setAccountOpen(true)} />
          )}
          <div className={isDesktop ? "app-shell__content" : "app__content"}>
            {isDesktop && <ShellPageHeader />}
            <main className={mainClass}>
              <ErrorBoundary>
                <Routes>
                  <Route path="/" element={<Navigate to={isDesktop ? "/solve" : lastPath} replace />} />
                  {/* Rendered by SolveKeepAlive below, so it can outlive a tab switch. */}
                  <Route path="/solve" element={null} />
                  <Route path="/ranges" element={<RangesPage />} />
                  <Route path="/library" element={<LibraryPage />} />
                  {/* The Drill renders outside the shell (App, below). */}
                  <Route path="/drill" element={null} />
                  <Route path="/saved" element={<Navigate to="/library" replace />} />
                  <Route path="/type-in" element={<Navigate to="/ranges?mode=type" replace />} />
                  <Route path="/import" element={<Navigate to="/ranges?mode=paste" replace />} />
                </Routes>
                <SolveKeepAlive />
              </ErrorBoundary>
            </main>
          </div>
          {!isDesktop && <TabBar paths={paths} badges={solveBadge ? { solve: solveBadge } : undefined} />}
          {!isDesktop && <AccountSheet open={accountOpen} onClose={() => setAccountOpen(false)} />}
        </div>
      </TopBarSlotContext.Provider>
      </SolveBadgeContext.Provider>
    </AccountSheetContext.Provider>
  );
}

const SHOWN: CSSProperties = { display: "contents" };
const HIDDEN: CSSProperties = { display: "none" };

/**
 * The Drill is a full-screen "game": no shell around it, and its own exit
 * button back to the app. On phones the shell stays mounted (hidden) under
 * it, so the tabs keep their state and the Drill's X ("/") goes back to the
 * last tab. On desktop the shell unmounts as it always has.
 */
function AppRoutes() {
  const onDrill = useMatch("/drill") !== null;
  const isDesktop = useIsDesktop();
  return (
    <>
      {(!onDrill || !isDesktop) && (
        <div style={onDrill ? HIDDEN : SHOWN}>
          <Shell />
        </div>
      )}
      {onDrill && <DrillPage />}
    </>
  );
}

/**
 * The router root. BrowserRouter lives in App (not main.tsx) so
 * App.test.tsx's `render(<App />)` keeps working with no extra wrapper.
 */
function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
