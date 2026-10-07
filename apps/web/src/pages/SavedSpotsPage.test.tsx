import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Spot } from "@poker-solver/schema";
import { SavedSpotsPage } from "./SavedSpotsPage";
import { deleteSolve, listSolves, listSpots } from "../lib/api";
import type { SavedSolve } from "../lib/api";
import { useAuth } from "../lib/auth";

vi.mock("../lib/api", () => ({ listSpots: vi.fn(), listSolves: vi.fn(), deleteSolve: vi.fn() }));
const mockList = vi.mocked(listSpots);
const mockListSolves = vi.mocked(listSolves);
const mockDeleteSolve = vi.mocked(deleteSolve);

// Signed in by default -- the page only fetches once signed in, since
// GET /spots requires it. The auth-specific tests at the bottom override it.
vi.mock("../lib/auth", () => ({ useAuth: vi.fn() }));
const mockUseAuth = vi.mocked(useAuth);

beforeEach(() => {
  mockListSolves.mockReset();
  mockListSolves.mockResolvedValue({ kind: "ok", solves: [] });
  mockDeleteSolve.mockReset();
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

describe("SavedSpotsPage", () => {
  it("lists saved spots with a human-readable summary", async () => {
    mockList.mockResolvedValue({ kind: "ok", spots: [unopenedSpot, vsRaiseSpot] });
    render(<SavedSpotsPage />);

    expect(await screen.findByText(/BTN.*100bb, unopened pot/)).toBeInTheDocument();
    expect(screen.getByText(/BB.*40bb, facing a raise from CO/)).toBeInTheDocument();
  });

  it("shows a specific empty state, not a blank list", async () => {
    mockList.mockResolvedValue({ kind: "ok", spots: [] });
    render(<SavedSpotsPage />);

    expect(await screen.findByText(/no saved spots yet/i)).toBeInTheDocument();
  });

  it("distinguishes an unreachable API from an unexpected response", async () => {
    mockList.mockResolvedValue({ kind: "network-error" });
    const { unmount } = render(<SavedSpotsPage />);
    expect(await screen.findByText(/couldn.t reach the api/i)).toBeInTheDocument();
    unmount();

    mockList.mockResolvedValue({ kind: "error", status: 500 });
    render(<SavedSpotsPage />);
    expect(await screen.findByText(/unexpected api response/i)).toBeInTheDocument();
    expect(screen.getByText(/500/)).toBeInTheDocument();
  });

  it("shows only a signed-out notice, without calling the API", () => {
    mockUseAuth.mockReturnValue({ status: "signed-out", email: null });
    render(<SavedSpotsPage />);

    expect(screen.getByText(/not signed in/i)).toBeInTheDocument();
    expect(mockList).not.toHaveBeenCalled();
  });

  it("waits for auth to resolve before fetching", () => {
    mockUseAuth.mockReturnValue({ status: "loading", email: null });
    render(<SavedSpotsPage />);

    expect(screen.getByText(/loading saved spots/i)).toBeInTheDocument();
    expect(mockList).not.toHaveBeenCalled();
  });

  it("fetches once the user signs in on this screen, and again on an account switch", async () => {
    mockUseAuth.mockReturnValue({ status: "signed-out", email: null });
    mockList.mockResolvedValue({ kind: "ok", spots: [unopenedSpot] });
    const { rerender } = render(<SavedSpotsPage />);
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

const savedSolve: SavedSolve = {
  id: "solve-1",
  created_at: "2026-01-02T12:00:00Z",
  label: null,
  spot: {
    positions_in_hand: ["BB", "BTN"],
    effective_stack_bb: 99,
    pot_bb: 2.5,
    board: ["Ks", "Qh", "9d"],
    current_street: "flop",
  } as unknown as Spot,
  result: {
    source: "live_solve",
    iterations: 100,
    position: "BB",
    strategy: { AA: { check: 0.25, bet_small: 0.75 } },
    bucketed_actions: [],
  },
};

describe("SavedSpotsPage -- saved solves", () => {
  beforeEach(() => {
    mockList.mockResolvedValue({ kind: "ok", spots: [] });
  });

  it("lists saved solves and opens one into the strategy chart", async () => {
    const user = userEvent.setup();
    mockListSolves.mockResolvedValue({ kind: "ok", solves: [savedSolve] });
    render(<SavedSpotsPage />);

    expect(await screen.findByText("BB vs BTN · flop Ks Qh 9d · pot 2.5bb")).toBeInTheDocument();
    expect(screen.queryByRole("grid", { name: /solved strategy/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^view$/i }));
    expect(screen.getByRole("grid", { name: /solved strategy/i })).toBeInTheDocument();
    expect(screen.getByText(/BB to act.*Check 25%, Bet Small \(25%\) 75%/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^hide$/i }));
    expect(screen.queryByRole("grid", { name: /solved strategy/i })).not.toBeInTheDocument();
  });

  it("shows a specific empty state when there are no saved solves", async () => {
    render(<SavedSpotsPage />);
    expect(await screen.findByText(/no saved solves yet/i)).toBeInTheDocument();
  });

  it("deletes a solve only after a confirmation click, then removes it from the list", async () => {
    const user = userEvent.setup();
    mockListSolves.mockResolvedValue({ kind: "ok", solves: [savedSolve] });
    mockDeleteSolve.mockResolvedValue({ kind: "deleted" });
    render(<SavedSpotsPage />);
    await screen.findByText(/BB vs BTN/);

    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(mockDeleteSolve).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /confirm delete/i }));

    expect(mockDeleteSolve).toHaveBeenCalledWith("solve-1");
    expect(await screen.findByText(/no saved solves yet/i)).toBeInTheDocument();
  });

  it("keeps the solve and says so when deleting fails", async () => {
    const user = userEvent.setup();
    mockListSolves.mockResolvedValue({ kind: "ok", solves: [savedSolve] });
    mockDeleteSolve.mockResolvedValue({ kind: "network-error" });
    render(<SavedSpotsPage />);
    await screen.findByText(/BB vs BTN/);

    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    await user.click(screen.getByRole("button", { name: /confirm delete/i }));

    expect(await screen.findByText(/couldn.t delete that solve/i)).toBeInTheDocument();
    expect(screen.getByText(/BB vs BTN/)).toBeInTheDocument();
  });

  it("does not request solves while signed out", () => {
    mockUseAuth.mockReturnValue({ status: "signed-out", email: null });
    render(<SavedSpotsPage />);
    expect(mockListSolves).not.toHaveBeenCalled();
  });
});
