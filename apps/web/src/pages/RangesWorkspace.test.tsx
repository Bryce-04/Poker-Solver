import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { Spot } from "@poker-solver/schema";
import { RangesPage } from "./RangesPage";
import { fetchReferenceStrategy, saveSpot, type ReferenceStrategyResult } from "../lib/api";
import { useAuth } from "../lib/auth";
import { EXAMPLE_HAND_HISTORY } from "../lib/parseHandHistory";

vi.mock("../lib/api", () => ({
  fetchReferenceStrategy: vi.fn(),
  saveSpot: vi.fn(),
}));
const mockFetch = vi.mocked(fetchReferenceStrategy);
const mockSave = vi.mocked(saveSpot);

vi.mock("../lib/auth", () => ({ useAuth: vi.fn() }));
const mockUseAuth = vi.mocked(useAuth);

/** A chart for whichever seat the spot is about: AA and KK, nothing else. */
function chartFor(spot: Spot): ReferenceStrategyResult {
  const hero = spot.positions_in_hand[0];
  return {
    kind: "match",
    data: {
      source: "reference_chart",
      chart_key: `${hero}_test`,
      chart_description: `${hero} test chart`,
      chart_source: "test",
      ranges: { [hero]: { AA: 1, KK: 1 } },
    },
  };
}

function SolveProbe() {
  return <output data-testid="solve-state">{JSON.stringify(useLocation().state)}</output>;
}

function renderRanges(url = "/ranges") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/ranges" element={<RangesPage />} />
        <Route path="/solve" element={<SolveProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

const lastFetchedSpot = () => mockFetch.mock.calls.at(-1)?.[0] as Spot;

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(min-width: 1024px)",
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (spot) => chartFor(spot));
  mockSave.mockReset();
  mockUseAuth.mockReset();
  mockUseAuth.mockReturnValue({ status: "signed-in", email: "hero@example.com" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RangesWorkspace (desktop Ranges)", () => {
  it("loads the default spot's chart with no button press", async () => {
    renderRanges();
    expect(await screen.findByRole("heading", { name: "BTN opening range" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /get reference strategy/i })).not.toBeInTheDocument();
    expect(lastFetchedSpot()).toMatchObject({ positions_in_hand: ["BTN"], actions: [], effective_stack_bb: 100 });
    // AA + KK: 12 of 1326 combos.
    expect(screen.getByText("0.9%")).toBeInTheDocument();
  });

  it("refetches when the seat or stack changes", async () => {
    const user = userEvent.setup();
    renderRanges();
    await screen.findByRole("heading", { name: "BTN opening range" });

    await user.click(screen.getByRole("button", { name: "CO" }));
    expect(await screen.findByRole("heading", { name: "CO opening range" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "40bb" }));
    await waitFor(() => expect(lastFetchedSpot()).toMatchObject({ positions_in_hand: ["CO"], effective_stack_bb: 40 }));
  });

  it("BB can't open: it faces a raise from a seat that acts before it", async () => {
    const user = userEvent.setup();
    renderRanges();
    await screen.findByRole("heading", { name: "BTN opening range" });

    await user.click(screen.getByRole("button", { name: "BB" }));
    expect(screen.getByRole("button", { name: /nobody has raised yet/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /someone raised before you/i })).toHaveAttribute("aria-pressed", "true");
    const raisers = screen.getByRole("group", { name: "Who raised" });
    expect(raisers).toHaveTextContent("UTGHJCOBTNSB");
    expect(await screen.findByRole("heading", { name: "BB vs a CO raise" })).toBeInTheDocument();
    expect(lastFetchedSpot().actions).toEqual([{ position: "CO", street: "preflop", action: "raise" }]);
  });

  it("UTG can't face an earlier raise", async () => {
    const user = userEvent.setup();
    renderRanges();
    await user.click(screen.getByRole("button", { name: "UTG" }));
    expect(screen.getByRole("button", { name: /someone raised before you/i })).toBeDisabled();
  });

  it("ignores a slow response for a spot that's no longer selected", async () => {
    const user = userEvent.setup();
    let releaseSlow: (result: ReferenceStrategyResult) => void = () => {};
    mockFetch.mockImplementation(async (spot) => {
      if (spot.positions_in_hand[0] === "HJ") {
        return new Promise<ReferenceStrategyResult>((resolve) => (releaseSlow = resolve));
      }
      return chartFor(spot);
    });
    renderRanges();
    await screen.findByRole("heading", { name: "BTN opening range" });

    await user.click(screen.getByRole("button", { name: "HJ" }));
    await waitFor(() => expect(lastFetchedSpot().positions_in_hand).toEqual(["HJ"]));
    await user.click(screen.getByRole("button", { name: "SB" }));
    expect(await screen.findByRole("heading", { name: "SB opening range" })).toBeInTheDocument();

    releaseSlow(chartFor({ ...lastFetchedSpot(), positions_in_hand: ["HJ"] }));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole("heading", { name: "SB opening range" })).toBeInTheDocument();
  });

  it("shows when the chart has been edited, and resets it", async () => {
    const user = userEvent.setup();
    renderRanges();
    await screen.findByRole("heading", { name: "BTN opening range" });
    expect(screen.queryByText(/edited from the standard chart/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("gridcell", { name: "QQ" }));
    expect(screen.getByText(/edited from the standard chart/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset to chart" }));
    expect(screen.queryByText(/edited from the standard chart/i)).not.toBeInTheDocument();
  });

  it("Type it: an example chip fills the box and loads its chart", async () => {
    const user = userEvent.setup();
    renderRanges("/ranges?mode=type");
    expect(screen.getByText(/describe a spot to see its chart/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "BB defends CO open, 100bb" }));
    expect(screen.getByLabelText(/type the spot in plain words/i)).toHaveValue("BB defends CO open, 100bb");
    expect(screen.getByText(/understood: bb vs a co raise, about 100bb/i)).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "BB vs a CO raise" })).toBeInTheDocument();
  });

  it("Type it: says so when a phrase isn't understood, and fetches nothing", async () => {
    const user = userEvent.setup();
    renderRanges("/ranges?mode=type");
    await user.type(screen.getByLabelText(/type the spot in plain words/i), "play every hand");
    expect(screen.getByText(/not one we understand yet/i)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 350));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("Hand history: reads the example hand into its chart", async () => {
    const user = userEvent.setup();
    renderRanges("/ranges?mode=paste");
    expect(screen.getByRole("button", { name: "Read hand" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Use an example" }));
    expect(screen.getByLabelText(/paste a hand history/i)).toHaveValue(EXAMPLE_HAND_HISTORY);
    await user.click(screen.getByRole("button", { name: "Read hand" }));
    expect(await screen.findByRole("heading", { name: "BTN opening range" })).toBeInTheDocument();
  });

  it("Hand history: explains a hand it can't read", async () => {
    const user = userEvent.setup();
    renderRanges("/ranges?mode=paste");
    await user.type(screen.getByLabelText(/paste a hand history/i), "not a hand");
    await user.click(screen.getByRole("button", { name: "Read hand" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn.t read this hand/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("saves the range as edited", async () => {
    const user = userEvent.setup();
    mockSave.mockImplementation(async (spot) => ({ kind: "saved", spot }));
    renderRanges();
    await screen.findByRole("heading", { name: "BTN opening range" });

    await user.click(screen.getByRole("gridcell", { name: "QQ" }));
    await user.click(screen.getByRole("button", { name: "Save to Library" }));
    expect(await screen.findByText(/saved to your library/i)).toBeInTheDocument();
    expect(mockSave.mock.calls[0][0].ranges).toEqual({ BTN: { AA: 1, KK: 1, QQ: 1 } });
  });

  it("asks a signed-out user to sign in instead of saving", async () => {
    const user = userEvent.setup();
    mockUseAuth.mockReturnValue({ status: "signed-out", email: null });
    renderRanges();
    await screen.findByRole("heading", { name: "BTN opening range" });
    await user.click(screen.getByRole("button", { name: "Save to Library" }));
    expect(screen.getByText(/sign in .* to save spots/i)).toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("Solve a flop from here: opens Solve with this seat, its opponent and the range", async () => {
    const user = userEvent.setup();
    renderRanges();
    await user.click(screen.getByRole("button", { name: "BB" }));
    await screen.findByRole("heading", { name: "BB vs a CO raise" });

    await user.click(screen.getByRole("button", { name: /solve a flop from here/i }));
    const state = JSON.parse(screen.getByTestId("solve-state").textContent ?? "null");
    expect(state).toEqual({
      prefill: { hero: "BB", villain: "CO", heroRange: { AA: 1, KK: 1 }, startingStackBb: 100 },
    });
  });

  it("explains why there's no chart for an uncovered spot", async () => {
    mockFetch.mockResolvedValue({ kind: "no-match" });
    renderRanges();
    expect(await screen.findByText(/no standard chart for this spot yet/i)).toBeInTheDocument();
  });
});
