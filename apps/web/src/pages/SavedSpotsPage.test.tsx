import { render, screen } from "@testing-library/react";
import type { Spot } from "@poker-solver/schema";
import { SavedSpotsPage } from "./SavedSpotsPage";
import { listSpots } from "../lib/api";

vi.mock("../lib/api", () => ({ listSpots: vi.fn() }));
const mockList = vi.mocked(listSpots);

beforeEach(() => {
  mockList.mockReset();
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
});
