import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SolvePage } from "../SolvePage";
import { fetchPreflopRanges, fetchReferenceStrategy, narrowRanges, saveSpot, solveSpot } from "../../lib/api";
import { useAuth } from "../../lib/auth";

vi.mock("../../lib/api", () => ({
  solveSpot: vi.fn(),
  fetchReferenceStrategy: vi.fn(),
  narrowRanges: vi.fn(),
  fetchPreflopRanges: vi.fn(),
  saveSpot: vi.fn(),
}));
const mockSolve = vi.mocked(solveSpot);
const mockPreflop = vi.mocked(fetchPreflopRanges);
const mockReference = vi.mocked(fetchReferenceStrategy);
const mockSave = vi.mocked(saveSpot);
vi.mocked(narrowRanges);

vi.mock("../../lib/auth", () => ({ useAuth: vi.fn() }));
const mockUseAuth = vi.mocked(useAuth);

const SOLVED = {
  kind: "solved" as const,
  data: {
    source: "live_solve" as const,
    iterations: 400,
    exploitability_pct: 0.4,
    converged: true,
    position: "BB" as const,
    strategy: { AA: { check: 0.3, bet_small: 0.7 }, KK: { check: 1 } },
    combo_strategy: {},
    bucketed_actions: [],
  },
};

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(min-width: 1024px)",
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  mockSolve.mockReset();
  mockSolve.mockResolvedValue(SOLVED);
  mockPreflop.mockReset();
  mockPreflop.mockResolvedValue({
    kind: "ok",
    data: {
      source: "reference_chart",
      line: "single_raised",
      description: "BTN opens, BB calls",
      chart_source: "test",
      ranges: { BB: { AA: 1, KK: 1 }, BTN: { AA: 1, QQ: 1 } },
    },
  });
  mockReference.mockReset();
  mockSave.mockReset();
  mockUseAuth.mockReset();
  mockUseAuth.mockReturnValue({ status: "signed-in", email: "hero@example.com" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** BTN opens to 2.5bb, BB calls, flop Qs 5c 2c -- the mockup's spot. */
async function setUpTheMockupSpot(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "BTN raises…" }));
  await user.click(screen.getByRole("button", { name: "2.5bb" }));
  await user.click(screen.getByRole("button", { name: "BB calls 1.5bb" }));
  await user.click(screen.getAllByRole("button", { name: "Add the flop card" })[0]);
  for (const card of ["Queen of spades", "5 of clubs", "2 of clubs"]) {
    await user.click(screen.getByRole("gridcell", { name: card }));
  }
}

describe("SolveWorkspace (desktop Solve)", () => {
  it("logs the hand as a timeline with the running pot", async () => {
    const user = userEvent.setup();
    render(<SolvePage />);
    await user.click(screen.getByRole("button", { name: "BTN raises…" }));
    await user.click(screen.getByRole("button", { name: "2.5bb" }));
    expect(screen.getByText("BTN raises to 2.5bb")).toBeInTheDocument();
    expect(screen.getByText("pot 4bb")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "BB calls 1.5bb" }));
    expect(screen.getByText("pot 5.5bb")).toBeInTheDocument();
    expect(screen.getByText(/preflop is done/i)).toBeInTheDocument();
  });

  it("loads both ranges from the preflop line as soon as preflop closes", async () => {
    const user = userEvent.setup();
    render(<SolvePage />);
    await user.click(screen.getByRole("button", { name: "BTN raises…" }));
    await user.click(screen.getByRole("button", { name: "2.5bb" }));
    expect(mockPreflop).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "BB calls 1.5bb" }));

    await waitFor(() => expect(mockPreflop).toHaveBeenCalledTimes(1));
    expect(mockPreflop.mock.calls[0][0]).toMatchObject({ positions_in_hand: ["BB", "BTN"] });
    expect(await screen.findAllByText("From the preflop action: BTN opens, BB calls")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /BB.s range.*called the open/i })).toBeInTheDocument();
  });

  it("falls back to typical ranges when the preflop line can't be served", async () => {
    mockPreflop.mockResolvedValue({ kind: "unsupported", reason: "No chart for this line." });
    mockReference.mockImplementation(async (spot) => ({
      kind: "match",
      data: {
        source: "reference_chart",
        chart_key: "k",
        chart_description: "d",
        chart_source: "t",
        ranges: { [spot.positions_in_hand[0]]: { AA: 1 } },
      },
    }));
    const user = userEvent.setup();
    render(<SolvePage />);
    await user.click(screen.getByRole("button", { name: "BTN raises…" }));
    await user.click(screen.getByRole("button", { name: "2.5bb" }));
    await user.click(screen.getByRole("button", { name: "BB calls 1.5bb" }));
    expect(await screen.findByText("Typical BTN opening range")).toBeInTheDocument();
  });

  it("picks the board in the slot popover, or by typing", async () => {
    const user = userEvent.setup();
    render(<SolvePage />);
    await user.click(screen.getAllByRole("button", { name: "Add the flop card" })[0]);
    const picker = screen.getByRole("dialog", { name: /pick the flop card/i });
    await user.click(within(picker).getByRole("gridcell", { name: "Queen of spades" }));
    // Stays open for the rest of the flop.
    await user.click(screen.getByRole("gridcell", { name: "5 of clubs" }));
    await user.click(screen.getByRole("gridcell", { name: "2 of clubs" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/or type it/i)).toHaveValue("Qs 5c 2c");

    // Change one card from its slot.
    await user.click(screen.getByRole("button", { name: /flop card: 5 of clubs/i }));
    await user.click(screen.getByRole("gridcell", { name: "King of hearts" }));
    expect(screen.getByLabelText(/or type it/i)).toHaveValue("Qs Kh 2c");

    const typed = screen.getByLabelText(/or type it/i);
    await user.clear(typed);
    await user.type(typed, "Ah 7d 7c 2s");
    await user.tab();
    expect(screen.getByRole("button", { name: /turn card: 2 of spades/i })).toBeInTheDocument();
  });

  it("checks off what's ready and names the decision on the button", async () => {
    const user = userEvent.setup();
    render(<SolvePage />);
    const ready = screen.getByRole("region", { name: "Ready to solve" });
    expect(within(ready).getByRole("button", { name: "Solve" })).toBeDisabled();
    expect(ready).toHaveTextContent("Finish the preflop action");

    await setUpTheMockupSpot(user);
    await screen.findAllByText("From the preflop action: BTN opens, BB calls");
    expect(ready).toHaveTextContent("Hand set up: BB vs BTN, single-raised pot");
    expect(ready).toHaveTextContent("Flop picked: Q♠ 5♣ 2♣");
    expect(ready).toHaveTextContent("Both ranges loaded");
    expect(within(ready).getByRole("button", { name: "Solve BB's flop decision" })).toBeEnabled();
  });

  it("solves, then shows the strategy with its accuracy and a hand's details", async () => {
    const user = userEvent.setup();
    render(<SolvePage />);
    await setUpTheMockupSpot(user);
    await screen.findAllByText("From the preflop action: BTN opens, BB calls");
    await user.click(screen.getByRole("button", { name: "Solve BB's flop decision" }));

    expect(await screen.findByRole("tab", { name: "Strategy", selected: true })).toBeInTheDocument();
    expect(mockSolve.mock.calls[0][0]).toMatchObject({ current_street: "flop", pot_bb: 5.5, effective_stack_bb: 97.5 });
    // AA and KK each 6 combos: check (0.3 + 1) / 2 = 65%.
    expect(screen.getByText("BB checks 65% of the time on this flop.")).toBeInTheDocument();
    expect(screen.getByText("Very accurate")).toBeInTheDocument();
    expect(screen.getByText(/could gain at most 0.4% of the pot/)).toBeInTheDocument();
    expect(screen.getByText("BTN raised, BB called")).toBeInTheDocument();

    await user.click(screen.getByRole("gridcell", { name: /^AA:/ }));
    const panel = screen.getByRole("complementary", { name: "Selected hand" });
    expect(within(panel).getByText("AA")).toBeInTheDocument();
    expect(panel).toHaveTextContent("Usually bet small (25%), sometimes check.");

    await user.click(screen.getByRole("gridcell", { name: /^72o:/ }));
    expect(panel).toHaveTextContent(/isn.t in BB.s range/);
  });

  it("Keep exploring adds the action and solves again", async () => {
    const user = userEvent.setup();
    render(<SolvePage />);
    await setUpTheMockupSpot(user);
    await screen.findAllByText("From the preflop action: BTN opens, BB calls");
    await user.click(screen.getByRole("button", { name: "Solve BB's flop decision" }));
    await screen.findByText("Very accurate");

    mockSolve.mockResolvedValue({ ...SOLVED, data: { ...SOLVED.data, position: "BTN" } });
    await user.click(screen.getByRole("button", { name: /what does BTN do if BB checks/i }));
    await waitFor(() => expect(mockSolve).toHaveBeenCalledTimes(2));
    expect(mockSolve.mock.calls[1][0].actions).toEqual([{ position: "BB", street: "flop", action: "check" }]);
    // Weighted by BTN's range (AA and QQ; only AA has a strategy): bets small 70%.
    expect(await screen.findByText("BTN bets small (25%) 70% of the time on this flop.")).toBeInTheDocument();
  });

  it("Edit setup goes back with everything kept", async () => {
    const user = userEvent.setup();
    render(<SolvePage />);
    await setUpTheMockupSpot(user);
    await screen.findAllByText("From the preflop action: BTN opens, BB calls");
    await user.click(screen.getByRole("button", { name: "Solve BB's flop decision" }));
    await screen.findByText("Very accurate");

    await user.click(screen.getByRole("button", { name: "Edit setup" }));
    expect(screen.getByRole("tab", { name: "Ranges", selected: true })).toBeInTheDocument();
    expect(screen.getByLabelText(/or type it/i)).toHaveValue("Qs 5c 2c");
    expect(screen.getByText("BTN raises to 2.5bb")).toBeInTheDocument();
    // The last result is still a tab away.
    expect(screen.getByRole("tab", { name: "Strategy" })).toBeEnabled();
  });

  it("saves the setup (whole hand, both ranges) and starts over", async () => {
    const user = userEvent.setup();
    mockSave.mockImplementation(async (spot) => ({ kind: "saved", spot }));
    render(<SolvePage />);
    await setUpTheMockupSpot(user);
    await screen.findAllByText("From the preflop action: BTN opens, BB calls");

    await user.click(screen.getByRole("button", { name: "Save spot" }));
    expect(await screen.findByText("Saved to your Library.")).toBeInTheDocument();
    expect(mockSave.mock.calls[0][0]).toMatchObject({
      positions_in_hand: ["BB", "BTN"],
      effective_stack_bb: 100,
      pot_bb: 5.5,
      board: ["Qs", "5c", "2c"],
      current_street: "flop",
      actions: [
        { position: "BTN", street: "preflop", action: "raise", size_bb: 2.5 },
        { position: "BB", street: "preflop", action: "call" },
      ],
      ranges: { BB: { AA: 1, KK: 1 }, BTN: { AA: 1, QQ: 1 } },
    });

    await user.click(screen.getByRole("button", { name: "Start over" }));
    expect(screen.getByLabelText(/or type it/i)).toHaveValue("");
    expect(screen.queryByText("BTN raises to 2.5bb")).not.toBeInTheDocument();
  });

  it("asks a signed-out user to sign in instead of saving", async () => {
    mockUseAuth.mockReturnValue({ status: "signed-out", email: null });
    const user = userEvent.setup();
    render(<SolvePage />);
    await user.click(screen.getByRole("button", { name: "Save spot" }));
    expect(screen.getByText(/sign in .* to save spots/i)).toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();
  });
});

describe("SolveWorkspace -- opened from the Library", () => {
  it("rebuilds a clicked-through hand: actions, board and both ranges", async () => {
    const saved = {
      id: "s1",
      name: "BB vs BTN on Q♠ 5♣ 2♣",
      positions_in_hand: ["BB", "BTN"],
      effective_stack_bb: 100,
      pot_bb: 5.5,
      board: ["Qs", "5c", "2c"],
      current_street: "flop",
      actions: [
        { position: "BTN", street: "preflop", action: "raise", size_bb: 2.5 },
        { position: "BB", street: "preflop", action: "call" },
      ],
      ranges: { BB: { AA: 1 }, BTN: { KK: 1 } },
    } as const;
    render(<SolvePage savedSpot={structuredClone(saved) as never} />);
    expect(screen.getByText("BTN raises to 2.5bb")).toBeInTheDocument();
    expect(screen.getByLabelText(/or type it/i)).toHaveValue("Qs 5c 2c");
    expect(screen.getAllByText("From your Library")).toHaveLength(2);
    const ready = screen.getByRole("region", { name: "Ready to solve" });
    expect(ready).toHaveTextContent("Both ranges loaded");
    expect(within(ready).getByRole("button", { name: "Solve BB's flop decision" })).toBeEnabled();
    // Ranges came with it: nothing is auto-loaded over them.
    await new Promise((r) => setTimeout(r, 50));
    expect(mockPreflop).not.toHaveBeenCalled();
  });

  it("rebuilds a hand-history setup: pot, stack and the first player's check", () => {
    const saved = {
      id: "s2",
      positions_in_hand: ["BB", "BTN"],
      effective_stack_bb: 97.5,
      pot_bb: 5.5,
      board: ["Qs", "5c", "2c"],
      current_street: "flop",
      actions: [{ position: "BB", street: "flop", action: "check" }],
      ranges: { BB: { AA: 1 }, BTN: { KK: 1 } },
    } as const;
    render(<SolvePage savedSpot={structuredClone(saved) as never} />);
    expect(screen.getByRole("button", { name: "Hand history" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Pot (bb)")).toHaveValue(5.5);
    expect(screen.getByLabelText("Stacks (bb)")).toHaveValue(97.5);
    expect(screen.getByLabelText(/BB already checked/)).toBeChecked();
    expect(screen.getByRole("button", { name: "Solve BTN's flop decision" })).toBeEnabled();
  });

  it("names a fresh save after the board", async () => {
    const user = userEvent.setup();
    mockSave.mockImplementation(async (spot) => ({ kind: "saved", spot }));
    render(<SolvePage />);
    await setUpTheMockupSpot(user);
    await user.click(screen.getByRole("button", { name: "Save spot" }));
    await screen.findByText("Saved to your Library.");
    expect(mockSave.mock.calls[0][0].name).toBe("BB vs BTN on Q♠ 5♣ 2♣");
  });
});

describe("SolveWorkspace -- hand categories and Why?", () => {
  it("shows a hand's category and the rule-of-thumb reasons when the server sends them", async () => {
    mockSolve.mockResolvedValue({
      ...SOLVED,
      data: {
        ...SOLVED.data,
        hand_categories: { AA: "Overpair", KK: "Overpair" },
        hand_reasons: { AA: ["You have an overpair.", "Betting is the main play for value."] },
      },
    });
    const user = userEvent.setup();
    render(<SolvePage />);
    await setUpTheMockupSpot(user);
    await screen.findAllByText("From the preflop action: BTN opens, BB calls");
    await user.click(screen.getByRole("button", { name: "Solve BB's flop decision" }));
    await screen.findByText("Very accurate");

    await user.click(screen.getByRole("gridcell", { name: /^AA:/ }));
    const panel = screen.getByRole("complementary", { name: "Selected hand" });
    expect(within(panel).getByText("Overpair")).toBeInTheDocument();
    expect(within(panel).getByText("Why?")).toBeInTheDocument();
    expect(within(panel).getByText("Betting is the main play for value.")).toBeInTheDocument();
    expect(panel).toHaveTextContent(/rule of thumb/);

    // KK has a category but no reasons: no Why? section.
    await user.click(screen.getByRole("gridcell", { name: /^KK:/ }));
    expect(within(panel).getByText("Overpair")).toBeInTheDocument();
    expect(within(panel).queryByText("Why?")).not.toBeInTheDocument();
  });

  it("leaves both out for a backend that doesn't send them", async () => {
    const user = userEvent.setup();
    render(<SolvePage />);
    await setUpTheMockupSpot(user);
    await screen.findAllByText("From the preflop action: BTN opens, BB calls");
    await user.click(screen.getByRole("button", { name: "Solve BB's flop decision" }));
    await screen.findByText("Very accurate");
    await user.click(screen.getByRole("gridcell", { name: /^AA:/ }));
    expect(within(screen.getByRole("complementary", { name: "Selected hand" })).queryByText("Why?")).not.toBeInTheDocument();
  });
});
