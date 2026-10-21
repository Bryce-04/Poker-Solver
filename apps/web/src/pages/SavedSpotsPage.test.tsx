import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { Spot } from "@poker-solver/schema";
import { SavedSpotsPage } from "./SavedSpotsPage";
import { listSpots } from "../lib/api";
import { useAuth } from "../lib/auth";

vi.mock("../lib/api", () => ({ listSpots: vi.fn() }));
const mockList = vi.mocked(listSpots);

// Signed in by default -- the page only fetches once signed in, since
// GET /spots requires it. The auth-specific tests at the bottom override it.
vi.mock("../lib/auth", () => ({ useAuth: vi.fn() }));
const mockUseAuth = vi.mocked(useAuth);

beforeEach(() => {
  mockList.mockReset();
  mockUseAuth.mockReset();
  mockUseAuth.mockReturnValue({ status: "signed-in", email: "hero@example.com" });
});

const unopenedSpot = {
  positions_in_hand: ["BTN"],
  effective_stack_bb: 100,
  current_street: "preflop",
  actions: [],
} as unknown as Spot;

const vsRaiseSpot = {
  positions_in_hand: ["BB"],
  effective_stack_bb: 40,
  current_street: "preflop",
  actions: [{ position: "CO", street: "preflop", action: "raise" }],
  created_at: "2026-01-01T12:00:00Z",
} as unknown as Spot;

const flopSpot = {
  id: "s1",
  name: "BB vs BTN on Q♠ J♥ 7♥",
  positions_in_hand: ["BB", "BTN"],
  effective_stack_bb: 100,
  pot_bb: 5.5,
  board: ["Qs", "Jh", "7h"],
  current_street: "flop",
  actions: [],
} as unknown as Spot;

function ShowState() {
  const { pathname, state } = useLocation();
  return <p>{`at ${pathname} with ${(state as { spot?: Spot } | null)?.spot?.name ?? "nothing"}`}</p>;
}

describe("SavedSpotsPage", () => {
  it("shows a saved postflop spot's own name and its board, not a preflop-looking summary", async () => {
    mockList.mockResolvedValue({ kind: "ok", spots: [flopSpot] });
    render(<SavedSpotsPage />, { wrapper: MemoryRouter });

    expect(await screen.findByText("BB vs BTN on Q♠ J♥ 7♥")).toBeInTheDocument();
    expect(screen.getByText(/flop · Q♠ J♥ 7♥/)).toBeInTheDocument();
  });

  it("opens a postflop spot in Solve and a preflop one in Ranges, handing the spot over", async () => {
    mockList.mockResolvedValue({ kind: "ok", spots: [flopSpot, unopenedSpot] });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/library"]}>
        <Routes>
          <Route path="/library" element={<SavedSpotsPage />} />
          <Route path="*" element={<ShowState />} />
        </Routes>
      </MemoryRouter>,
    );

    const opens = await screen.findAllByRole("button", { name: /^open$/i });
    expect(opens).toHaveLength(2);
    await user.click(opens[0]);
    expect(screen.getByText("at /solve with BB vs BTN on Q♠ J♥ 7♥")).toBeInTheDocument();
  });

  it("lists saved spots with a human-readable summary", async () => {
    mockList.mockResolvedValue({ kind: "ok", spots: [unopenedSpot, vsRaiseSpot] });
    render(<SavedSpotsPage />, { wrapper: MemoryRouter });

    expect(await screen.findByText(/BTN.*100bb, unopened pot/)).toBeInTheDocument();
    expect(screen.getByText(/BB.*40bb, facing a raise from CO/)).toBeInTheDocument();
  });

  it("shows a specific empty state, not a blank list", async () => {
    mockList.mockResolvedValue({ kind: "ok", spots: [] });
    render(<SavedSpotsPage />, { wrapper: MemoryRouter });

    expect(await screen.findByText(/no saved spots yet/i)).toBeInTheDocument();
  });

  it("distinguishes an unreachable API from an unexpected response", async () => {
    mockList.mockResolvedValue({ kind: "network-error" });
    const { unmount } = render(<SavedSpotsPage />, { wrapper: MemoryRouter });
    expect(await screen.findByText(/couldn.t reach the api/i)).toBeInTheDocument();
    unmount();

    mockList.mockResolvedValue({ kind: "error", status: 500 });
    render(<SavedSpotsPage />, { wrapper: MemoryRouter });
    expect(await screen.findByText(/unexpected api response/i)).toBeInTheDocument();
    expect(screen.getByText(/500/)).toBeInTheDocument();
  });

  it("shows only a signed-out notice, without calling the API", () => {
    mockUseAuth.mockReturnValue({ status: "signed-out", email: null });
    render(<SavedSpotsPage />, { wrapper: MemoryRouter });

    expect(screen.getByText(/not signed in/i)).toBeInTheDocument();
    expect(mockList).not.toHaveBeenCalled();
  });

  it("waits for auth to resolve before fetching", () => {
    mockUseAuth.mockReturnValue({ status: "loading", email: null });
    render(<SavedSpotsPage />, { wrapper: MemoryRouter });

    expect(screen.getByText(/loading saved spots/i)).toBeInTheDocument();
    expect(mockList).not.toHaveBeenCalled();
  });

  it("fetches once the user signs in on this screen, and again on an account switch", async () => {
    mockUseAuth.mockReturnValue({ status: "signed-out", email: null });
    mockList.mockResolvedValue({ kind: "ok", spots: [unopenedSpot] });
    const { rerender } = render(<SavedSpotsPage />, { wrapper: MemoryRouter });
    expect(mockList).not.toHaveBeenCalled();

    mockUseAuth.mockReturnValue({ status: "signed-in", email: "hero@example.com" });
    rerender(<SavedSpotsPage />);
    expect(await screen.findByText(/BTN.*100bb, unopened pot/)).toBeInTheDocument();
    expect(mockList).toHaveBeenCalledTimes(1);

    mockList.mockResolvedValue({ kind: "ok", spots: [vsRaiseSpot] });
    mockUseAuth.mockReturnValue({ status: "signed-in", email: "villain@example.com" });
    rerender(<SavedSpotsPage />);
    expect(await screen.findByText(/BB.*40bb, facing a raise from CO/)).toBeInTheDocument();
    expect(mockList).toHaveBeenCalledTimes(2);
  });
});
