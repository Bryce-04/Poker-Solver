import { useEffect } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { Spot } from "@poker-solver/schema";
import { SolvePage } from "../../SolvePage";
import { fetchPreflopRanges, fetchReferenceStrategy, narrowRanges, solveSpot } from "../../../lib/api";
import type { SolvePrefill } from "../../../lib/solvePrefill";
import { SolveBadgeContext } from "../../../lib/mobileShell";

// The phone Solve flow (docs/mobile-redesign.md §4) end to end, over the real
// useSolveSetup: jsdom has no matchMedia, so SolvePage renders the phone
// layout. The API is mocked; everything else is real.

vi.mock("../../../lib/api", () => ({
  solveSpot: vi.fn(),
  fetchReferenceStrategy: vi.fn(),
  narrowRanges: vi.fn(),
  fetchPreflopRanges: vi.fn(),
}));
const mockSolve = vi.mocked(solveSpot);
const mockReference = vi.mocked(fetchReferenceStrategy);
const mockNarrow = vi.mocked(narrowRanges);
const mockPreflopRanges = vi.mocked(fetchPreflopRanges);

type User = ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  mockSolve.mockReset();
  mockReference.mockReset();
  mockNarrow.mockReset();
  mockPreflopRanges.mockReset();
  // No chart unless a test says so: auto-loaded ranges stay empty.
  mockReference.mockResolvedValue({ kind: "no-match" });
  mockPreflopRanges.mockResolvedValue({ kind: "unsupported", reason: "Not charted." });
});

/** The router's current ?query, read back by tests. */
let currentSearch = "";
function SearchSpy() {
  const { search } = useLocation();
  useEffect(() => {
    currentSearch = search;
  }, [search]);
  return null;
}

function renderSolve(props: { prefill?: SolvePrefill; savedSpot?: Spot } = {}) {
  return render(
    <MemoryRouter initialEntries={["/solve"]}>
      <SolvePage {...props} />
      <SearchSpy />
    </MemoryRouter>,
  );
}

const next = () => screen.getByRole("button", { name: /^next:/i });
const primary = (name: RegExp) => screen.getByRole("button", { name });

/** BTN completes the big blind and BB checks: a limped pot, 2.5bb / 99bb. */
async function limp(user: User) {
  await user.click(screen.getByRole("button", { name: "Call 1bb" }));
  await user.click(screen.getByRole("button", { name: "Check" }));
}

async function typeBoard(user: User, text: string) {
  const input = screen.getByLabelText(/or type it/i);
  await user.clear(input);
  await user.type(input, text);
}

/** Tap a hand in the chart and set its weight in the hand sheet. */
async function setHand(user: User, hand: string, weight = "100%") {
  await user.click(screen.getByRole("gridcell", { name: new RegExp(`^${hand}`) }));
  const sheet = screen.getByRole("dialog");
  await user.click(within(sheet).getByRole("button", { name: weight }));
  await user.click(within(sheet).getByRole("button", { name: "Done" }));
}

async function pickPlayer(user: User, position: string) {
  await user.click(screen.getByRole("button", { name: new RegExp(`^${position} · acts`) }));
}

/** Hand, board and ranges filled in: BB KJo vs BTN AA on Ks Qh 9d. Ends on Ready. */
async function reachReady(user: User) {
  await limp(user);
  await user.click(next());
  await typeBoard(user, "Ks Qh 9d");
  await user.click(next());
  await setHand(user, "KJo");
  await pickPlayer(user, "BTN");
  await setHand(user, "AA");
  await user.click(next());
}

function solved(overrides: Record<string, unknown> = {}) {
  return {
    kind: "solved" as const,
    data: {
      source: "live_solve" as const,
      iterations: 8000,
      position: "BB" as const,
      strategy: { KJo: { check: 0.05, all_in: 0.95 } },
      bucketed_actions: [],
      exploitability_pct: 0.44,
      ...overrides,
    },
  };
}

describe("phone Solve -- step 1, the hand", () => {
  it("picks two seats, never the same one, and says who acts first", async () => {
    const user = userEvent.setup();
    renderSolve();
    expect(screen.getByRole("heading", { name: /who.s in the hand/i })).toBeInTheDocument();
    const player1 = screen.getByRole("group", { name: "Player 1" });
    const player2 = screen.getByRole("group", { name: "Player 2" });
    expect(within(player1).getByRole("button", { name: "BB" })).toHaveAttribute("aria-pressed", "true");
    expect(within(player1).getByRole("button", { name: "BTN" })).toBeDisabled();
    expect(screen.getByText("BB acts first after the flop. BTN acts last.")).toBeInTheDocument();

    await user.click(within(player2).getByRole("button", { name: "SB" }));
    expect(screen.getByText("SB acts first after the flop. BB acts last.")).toBeInTheDocument();
  });

  it("can't go on until preflop is finished, then shows the pot and stacks", async () => {
    const user = userEvent.setup();
    renderSolve();
    expect(screen.getByText("BTN to act · facing 1bb")).toBeInTheDocument();
    expect(primary(/finish preflop first/i)).toBeDisabled();

    await limp(user);
    expect(screen.getByText(/preflop done · pot 2\.5bb · stacks 99bb/i)).toBeInTheDocument();
    expect(next()).toHaveAccessibleName("Next: the board");
    expect(next()).toBeEnabled();
  });

  it("raises, 3-bets and 4-bets from the raise sheet with real sizes", async () => {
    const user = userEvent.setup();
    renderSolve();

    await user.click(screen.getByRole("button", { name: "Raise…" }));
    let sheet = screen.getByRole("dialog", { name: "BTN raises to…" });
    await user.click(within(sheet).getByRole("button", { name: /^3bb/ }));
    await user.click(within(sheet).getByRole("button", { name: "Raise to 3bb" }));

    await user.click(screen.getByRole("button", { name: "3-bet…" }));
    sheet = screen.getByRole("dialog", { name: "BB 3-bets to…" });
    // 3×, 3.5× and 4× the raise, plus All-in.
    expect(within(sheet).getByRole("button", { name: "9bb 3× the raise" })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "10.5bb 3.5× the raise" })).toHaveAttribute("aria-pressed", "true");
    expect(within(sheet).getByRole("button", { name: "12bb 4× the raise" })).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Smaller" }));
    expect(within(sheet).getByText("10bb")).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: /^9bb/ }));
    await user.click(within(sheet).getByRole("button", { name: "3-bet to 9bb" }));

    await user.click(screen.getByRole("button", { name: "4-bet…" }));
    sheet = screen.getByRole("dialog", { name: "BTN 4-bets to…" });
    await user.click(within(sheet).getByRole("button", { name: /^27bb/ }));
    await user.click(within(sheet).getByRole("button", { name: "4-bet to 27bb" }));
    await user.click(screen.getByRole("button", { name: "Call 18bb" }));

    const rows = within(screen.getByRole("list", { name: "Before the flop" })).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      "BTN raises to 3bbpot 4.5bb",
      "BB raises to 9bbpot 12.5bb",
      "BTN raises to 27bbpot 36.5bb",
      "BB callspot 54.5bb",
      expect.stringMatching(/preflop done · pot 54\.5bb · stacks 73bb/i),
    ]);
  });

  it("ends the hand on a fold, and Undo takes it back", async () => {
    const user = userEvent.setup();
    renderSolve();
    await user.click(screen.getByRole("button", { name: "Fold" }));
    expect(screen.getByText(/someone folded, so there.s nothing left to solve/i)).toBeInTheDocument();
    expect(primary(/^someone folded$/i)).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Undo last action" }));
    expect(screen.getByText("BTN to act · facing 1bb")).toBeInTheDocument();
  });

  it("sets a starting stack from the chips or the custom sheet", async () => {
    const user = userEvent.setup();
    renderSolve();
    const stacks = screen.getByRole("group", { name: "Starting stack" });
    await user.click(within(stacks).getByRole("button", { name: "40bb" }));
    expect(within(stacks).getByRole("button", { name: "40bb" })).toHaveAttribute("aria-pressed", "true");

    await user.click(within(stacks).getByRole("button", { name: "Custom" }));
    const sheet = screen.getByRole("dialog", { name: "Starting stack" });
    await user.clear(within(sheet).getByLabelText("Big blinds"));
    await user.type(within(sheet).getByLabelText("Big blinds"), "75");
    await user.click(within(sheet).getByRole("button", { name: "Use 75bb" }));
    expect(within(stacks).getByRole("button", { name: "75bb" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("phone Solve -- step 2, the board", () => {
  it("picks cards rank first, then suit, moving through the flop", async () => {
    const user = userEvent.setup();
    renderSolve();
    await limp(user);
    await user.click(next());
    expect(currentSearch).toBe("?step=board");
    expect(primary(/pick at least 3 cards/i)).toBeDisabled();

    expect(screen.getByRole("button", { name: "Pick the 2nd flop card" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Pick the 1st flop card" }));
    let sheet = screen.getByRole("dialog", { name: "Pick the 1st flop card" });
    expect(within(sheet).getByRole("button", { name: /spades/i })).toBeDisabled(); // no rank yet
    await user.click(within(sheet).getByRole("button", { name: "K" }));
    await user.click(within(sheet).getByRole("button", { name: /spades/i }));

    sheet = screen.getByRole("dialog", { name: "Pick the 2nd flop card" });
    await user.click(within(sheet).getByRole("button", { name: "K" }));
    expect(within(sheet).getByRole("button", { name: /spades/i })).toBeDisabled(); // Ks is taken
    await user.click(within(sheet).getByRole("button", { name: /hearts/i }));
    sheet = screen.getByRole("dialog", { name: "Pick the 3rd flop card" });
    await user.click(within(sheet).getByRole("button", { name: "9" }));
    await user.click(within(sheet).getByRole("button", { name: /diamonds/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/or type it/i)).toHaveValue("Ks Kh 9d");
    expect(screen.getByText("Solving the flop")).toBeInTheDocument();
    expect(screen.getByText("Pot 2.5bb · Stacks 99bb · BB acts first")).toBeInTheDocument();
    expect(next()).toHaveAccessibleName("Next: the ranges");
  });

  it("fills the slots from typed cards, and can remove a card", async () => {
    const user = userEvent.setup();
    renderSolve();
    await limp(user);
    await user.click(next());
    await typeBoard(user, "Qs 5c");
    expect(screen.getByRole("button", { name: /flop: queen of spades/i })).toBeInTheDocument();
    expect(screen.getByText("Pick 1 more for the flop")).toBeInTheDocument();
    // The pot preflop left, not the 0 "entering preflop".
    expect(screen.getByText("Pot 2.5bb · Stacks 99bb · BB acts first")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /flop: queen of spades/i }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove this card" }));
    expect(screen.getByLabelText(/or type it/i)).toHaveValue("5c");
  });

  it("sends you back for the flop action before the turn can be solved", async () => {
    const user = userEvent.setup();
    renderSolve();
    await limp(user);
    await user.click(next());
    await typeBoard(user, "Ks Qh 9d 4c");
    expect(primary(/finish the flop action first/i)).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Enter the flop action" }));
    expect(currentSearch).toBe("?step=hand");
    const flop = screen.getByRole("list", { name: "On the flop" });
    await user.click(within(flop).getByRole("button", { name: "Check" }));
    await user.click(within(flop).getByRole("button", { name: "Check" }));
    expect(next()).toBeEnabled();
    await user.click(next());
    expect(screen.getByText("Solving the turn")).toBeInTheDocument();
  });
});

describe("phone Solve -- step 3, the ranges", () => {
  async function reachRanges(user: User) {
    await limp(user);
    await user.click(next());
    await typeBoard(user, "Ks Qh 9d");
    await user.click(next());
  }

  it("loads typical ranges once preflop closes, at the starting stack", async () => {
    const user = userEvent.setup();
    renderSolve();
    await user.click(within(screen.getByRole("group", { name: "Starting stack" })).getByRole("button", { name: "150bb" }));
    await limp(user);
    expect(mockReference).toHaveBeenCalledWith(
      expect.objectContaining({ positions_in_hand: ["BTN"], effective_stack_bb: 150 }),
    );
  });

  it("loads both ranges from a raised preflop line", async () => {
    mockPreflopRanges.mockResolvedValue({
      kind: "ok",
      data: {
        source: "reference_chart",
        line: "single_raised",
        description: "BTN opens, BB calls",
        chart_source: "approximate",
        ranges: { BB: { KK: 1 }, BTN: { AA: 1, QQ: 1 } },
      },
    });
    const user = userEvent.setup();
    renderSolve();
    await user.click(screen.getByRole("button", { name: "Raise…" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Raise to 2.5bb" }));
    await user.click(screen.getByRole("button", { name: "Call 1.5bb" }));
    await user.click(next());
    await typeBoard(user, "Ks Qh 9d");
    await user.click(next());

    expect(mockPreflopRanges).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: [
          { position: "BTN", street: "preflop", action: "raise", size_bb: 2.5 },
          { position: "BB", street: "preflop", action: "call" },
        ],
      }),
    );
    expect(await screen.findByText(/from the preflop action: btn opens, bb calls/i)).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "KK" })).toHaveAttribute("aria-pressed", "true");
    await pickPlayer(user, "BTN");
    expect(screen.getByRole("gridcell", { name: "QQ" })).toHaveAttribute("aria-pressed", "true");
    expect(next()).toBeEnabled();
  });

  it("sets a hand's weight from the hand sheet", async () => {
    const user = userEvent.setup();
    renderSolve();
    await reachRanges(user);
    expect(primary(/add hands to bb and btn.s range/i)).toBeDisabled();

    await user.click(screen.getByRole("gridcell", { name: "AKo" }));
    const sheet = screen.getByRole("dialog", { name: /AKo/ });
    expect(within(sheet).getByText("offsuit · 12 combos")).toBeInTheDocument();
    expect(within(sheet).getByText("How often does BB have this hand here?")).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "25%" }));
    expect(within(sheet).getByRole("button", { name: "25%" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(sheet).getByRole("button", { name: "Done" }));

    expect(screen.getByRole("gridcell", { name: "AKo, 25%" })).toBeInTheDocument();
    expect(screen.getByText(/combos · 0\.2%/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^BB · acts first/ })).toHaveTextContent("0.2% of hands");
  });

  it("explains plainly when no chart covers a seat", async () => {
    const user = userEvent.setup();
    renderSolve();
    await reachRanges(user);
    expect(
      await screen.findByText(/no reference chart covers bb opening, or defending vs btn/i),
    ).toBeInTheDocument();
  });

  it("shows the server's reason when the preflop line isn't charted", async () => {
    mockPreflopRanges.mockResolvedValue({
      kind: "unsupported",
      reason: "3-bet / 4-bet charts only cover about 100bb (80-120bb) so far.",
    });
    const user = userEvent.setup();
    renderSolve();
    await user.click(screen.getByRole("button", { name: "Raise…" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Raise to 2.5bb" }));
    await user.click(screen.getByRole("button", { name: "Call 1.5bb" }));
    await user.click(next());
    await typeBoard(user, "Ks Qh 9d");
    await user.click(next());
    // The preflop line failed, so each seat falls back to its typical range.
    expect(await screen.findByText(/only cover about 100bb/)).toBeInTheDocument();
  });

  it("keeps a range with its seat when the other seat changes", async () => {
    const user = userEvent.setup();
    renderSolve();
    await reachRanges(user);
    await setHand(user, "KJo");
    await user.click(within(screen.getByRole("navigation", { name: "Steps" })).getByRole("button", { name: "Hand" }));
    await user.click(within(screen.getByRole("group", { name: "Player 2" })).getByRole("button", { name: "CO" }));
    await user.click(next());
    await user.click(next());
    expect(screen.getByRole("button", { name: /^BB · acts first/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("gridcell", { name: "KJo" })).toHaveAttribute("aria-pressed", "true");
  });

  it("paints with the chosen brush in Paint mode", async () => {
    const user = userEvent.setup();
    renderSolve();
    await reachRanges(user);
    await user.click(screen.getByRole("button", { name: "Paint" }));
    expect(screen.getByText(/the page won.t scroll while paint is on/i)).toBeInTheDocument();
    await user.click(within(screen.getByRole("group", { name: "Brush" })).getByRole("button", { name: "50%" }));
    await user.click(screen.getByRole("gridcell", { name: "KJo" }));
    expect(screen.getByRole("gridcell", { name: "KJo, 50%" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("narrows both ranges by the flop's action on a turn, and can undo it", async () => {
    mockNarrow.mockResolvedValue({
      kind: "narrowed",
      data: {
        ranges: { BB: { KJo: 0.5 }, BTN: { AA: 0.5 } },
        line_probability: { BB: 0.9, BTN: 0.4 },
        bucketed_actions: [],
      },
    });
    const user = userEvent.setup();
    renderSolve();
    await limp(user);
    await user.click(next());
    await typeBoard(user, "Ks Qh 9d 4c");
    await user.click(screen.getByRole("button", { name: "Enter the flop action" }));
    const flop = screen.getByRole("list", { name: "On the flop" });
    await user.click(within(flop).getByRole("button", { name: "Check" }));
    await user.click(within(flop).getByRole("button", { name: "Check" }));
    await user.click(next());
    await user.click(next());
    await setHand(user, "KJo");
    await pickPlayer(user, "BTN");
    await setHand(user, "AA");

    await user.click(screen.getByRole("button", { name: "Narrow by the flop action" }));
    expect(mockNarrow).toHaveBeenCalledWith(
      expect.objectContaining({ current_street: "flop", board: ["Ks", "Qh", "9d"] }),
    );
    expect(await screen.findByText(/narrowed by the flop action/i)).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "AA, 50%" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo narrowing" }));
    expect(screen.getByRole("gridcell", { name: "AA" })).toBeInTheDocument();
  });
});

describe("phone Solve -- step 4, ready and solving", () => {
  it("summarizes the setup and solves the expected Spot", async () => {
    mockSolve.mockResolvedValue(solved());
    const user = userEvent.setup();
    renderSolve();
    await reachReady(user);

    expect(currentSearch).toBe("?step=ready");
    expect(screen.getByText(/BB acts first on the flop, so the solver works out BB.s best mix/)).toBeInTheDocument();
    expect(screen.getByText("BB vs BTN · BTN limped, BB checked")).toBeInTheDocument();
    expect(screen.getByText("2.5bb · 99bb")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "K of spades" })).toBeInTheDocument();

    await user.click(primary(/^solve bb.s flop$/i));
    expect(mockSolve).toHaveBeenCalledWith(
      expect.objectContaining({
        positions_in_hand: ["BB", "BTN"],
        effective_stack_bb: 99,
        pot_bb: 2.5,
        board: ["Ks", "Qh", "9d"],
        current_street: "flop",
        actions: [],
        ranges: { BB: { KJo: 1 }, BTN: { AA: 1 } },
      }),
    );
    expect(await screen.findByRole("heading", { name: /^solved in \d+ seconds?$/i })).toBeInTheDocument();
    expect(screen.getByText("Very accurate: within 0.4% of the pot of perfect play.")).toBeInTheDocument();

    await user.click(primary(/see the result/i));
    expect(currentSearch).toBe("?step=result");
    expect(screen.getByRole("gridcell", { name: /^KJo: Check 5%, All-in 95%$/i })).toBeInTheDocument();
  });

  it("marks the Solve tab while solving and until the result is seen", async () => {
    mockSolve.mockResolvedValue(solved());
    const setBadge = vi.fn();
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/solve"]}>
        <SolveBadgeContext.Provider value={setBadge}>
          <SolvePage />
        </SolveBadgeContext.Provider>
      </MemoryRouter>,
    );
    await reachReady(user);
    await user.click(primary(/^solve bb.s flop$/i));
    expect(setBadge).toHaveBeenCalledWith("solving");
    await screen.findByRole("heading", { name: /^solved in/i });
    expect(setBadge).toHaveBeenLastCalledWith("new result");
    await user.click(primary(/see the result/i));
    expect(setBadge).toHaveBeenLastCalledWith(null);
  });

  it("jumps back to a step from its Edit link or the progress bar", async () => {
    const user = userEvent.setup();
    renderSolve();
    await reachReady(user);
    await user.click(screen.getByRole("button", { name: "Edit the board" }));
    expect(currentSearch).toBe("?step=board");
    await user.click(within(screen.getByRole("navigation", { name: "Steps" })).getByRole("button", { name: "Hand" }));
    expect(currentSearch).toBe("?step=hand");
    // Later steps aren't buttons.
    expect(within(screen.getByRole("navigation", { name: "Steps" })).queryByRole("button", { name: "Solve" })).toBeNull();
  });

  it("shows a running solve, and Cancel drops its result", async () => {
    let finish: (value: ReturnType<typeof solved>) => void = () => {};
    mockSolve.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    renderSolve();
    await reachReady(user);
    await user.click(primary(/^solve bb.s flop$/i));

    expect(screen.getByRole("progressbar", { name: "Solving" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Solving BB’s flop…" })).toBeInTheDocument();
    await user.click(primary(/^cancel$/i));
    expect(screen.getByRole("heading", { name: "Ready to solve" })).toBeInTheDocument();

    finish(solved());
    await Promise.resolve();
    expect(screen.queryByRole("heading", { name: /solved in/i })).not.toBeInTheDocument();
  });

  it("says why a solve failed, with Try again", async () => {
    mockSolve.mockResolvedValueOnce({ kind: "rejected", reason: "ranges is missing an entry for: BTN" });
    mockSolve.mockResolvedValueOnce({ kind: "network-error" });
    mockSolve.mockResolvedValueOnce({ kind: "error", status: 500 });
    const user = userEvent.setup();
    renderSolve();
    await reachReady(user);

    await user.click(primary(/^solve bb.s flop$/i));
    expect(await screen.findByText(/ranges is missing an entry for: btn/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/couldn.t reach the server/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/http 500/i)).toBeInTheDocument();
  });

});

describe("phone Solve -- a pasted hand history", () => {
  const HH = `PokerStars Hand #3:  Hold'em No Limit ($0.50/$1.00 USD) - 2024/01/01 12:00:00 ET
Table 'Atlas' 6-max Seat #1 is the button
Seat 1: Dave ($100 in chips)
Seat 2: Eve ($100 in chips)
Seat 3: Hero ($100 in chips)
Seat 4: Alice ($100 in chips)
Seat 5: Grace ($100 in chips)
Seat 6: Frank ($100 in chips)
Eve: posts small blind $0.50
Hero: posts big blind $1
*** HOLE CARDS ***
Dealt to Hero [7h 7s]
Alice: folds
Grace: folds
Frank: folds
Dave: raises $2 to $3
Eve: folds
Hero: calls $2
*** FLOP *** [2h 7d Jc]
Hero: checks
`;

  it("fills every step and lands on Ready, solving BTN after BB's check", async () => {
    mockSolve.mockResolvedValue(solved({ position: "BTN" }));
    const user = userEvent.setup();
    renderSolve();
    await user.click(screen.getByRole("button", { name: /or paste a hand history instead/i }));
    const sheet = screen.getByRole("dialog", { name: "Paste a hand history" });
    // fireEvent, not user.type: "[7h 7s]" collides with userEvent's key syntax.
    fireEvent.change(within(sheet).getByLabelText("Hand history"), { target: { value: HH } });
    await user.click(within(sheet).getByRole("button", { name: "Read hand" }));

    expect(currentSearch).toBe("?step=ready");
    expect(screen.getByText("BB vs BTN · from a hand history")).toBeInTheDocument();
    expect(screen.getByText("6.5bb · 97bb")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "J of clubs" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit the hand" }));
    expect(screen.getByRole("checkbox", { name: /bb already checked/i })).toBeChecked();
  });

  it("shows the parser's reason when it can't read the hand", async () => {
    const user = userEvent.setup();
    renderSolve();
    await user.click(screen.getByRole("button", { name: /or paste a hand history instead/i }));
    const sheet = screen.getByRole("dialog", { name: "Paste a hand history" });
    await user.type(within(sheet).getByLabelText("Hand history"), "not a real hand history");
    await user.click(within(sheet).getByRole("button", { name: "Read hand" }));
    expect(within(sheet).getByRole("alert")).toHaveTextContent(/table size and button seat/i);
    expect(currentSearch).toBe("");
  });
});

describe("phone Solve -- arriving from another screen", () => {
  it("starts on the hand with Ranges' seats, range and stack", () => {
    renderSolve({ prefill: { hero: "BB", villain: "CO", heroRange: { AA: 1, KK: 1 }, startingStackBb: 40 } });
    expect(screen.getByRole("heading", { name: /who.s in the hand/i })).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Player 1" })).getByRole("button", { name: "BB" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(screen.getByRole("group", { name: "Player 2" })).getByRole("button", { name: "CO" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(screen.getByRole("group", { name: "Starting stack" })).getByRole("button", { name: "40bb" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("opens a complete saved setup on Ready", () => {
    renderSolve({
      savedSpot: {
        name: "BB vs BTN on Ks Qh 9d",
        positions_in_hand: ["BB", "BTN"],
        effective_stack_bb: 100,
        pot_bb: 5.5,
        board: ["Ks", "Qh", "9d"],
        current_street: "flop",
        actions: [
          { position: "BTN", street: "preflop", action: "raise", size_bb: 2.5 },
          { position: "BB", street: "preflop", action: "call" },
        ],
        ranges: { BB: { KJo: 1 }, BTN: { AA: 1 } },
      },
    });
    expect(screen.getByRole("heading", { name: "Ready to solve" })).toBeInTheDocument();
    expect(screen.getByText("BB vs BTN · BTN raised, BB called")).toBeInTheDocument();
  });
});
