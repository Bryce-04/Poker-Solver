import { render, screen } from "@testing-library/react";
import type { Spot } from "@poker-solver/schema";
import { SavedSpotsPage } from "./SavedSpotsPage";
import { listSpots } from "../lib/api";
import { useAuth } from "../lib/auth";

vi.mock("../lib/api", () => ({ listSpots: vi.fn() }));
const mockList = vi.mocked(listSpots);

// No <AuthProvider> wraps this render, so useAuth() falls back to its
// context default ("loading") unless a test opts into a real mock -- the
// existing tests below don't care about auth state, only the new
// signed-out one does.
vi.mock("../lib/auth", () => ({ useAuth: vi.fn() }));
const mockUseAuth = vi.mocked(useAuth);

beforeEach(() => {
  mockList.mockReset();
  mockUseAuth.mockReset();
  mockUseAuth.mockReturnValue({ status: "loading", email: null });
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

  it("shows a signed-out notice, without hiding the (unfiltered) list underneath", async () => {
    mockUseAuth.mockReturnValue({ status: "signed-out", email: null });
    mockList.mockResolvedValue({ kind: "ok", spots: [unopenedSpot] });
    render(<SavedSpotsPage />);

    expect(screen.getByText(/not signed in/i)).toBeInTheDocument();
    expect(await screen.findByText(/BTN.*100bb, unopened pot/)).toBeInTheDocument();
  });
});
