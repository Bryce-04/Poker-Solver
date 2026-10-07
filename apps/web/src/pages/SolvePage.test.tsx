import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SolvePage } from "./SolvePage";
import { fetchReferenceStrategy, solveSpot } from "../lib/api";

vi.mock("../lib/api", () => ({
  solveSpot: vi.fn(),
  fetchReferenceStrategy: vi.fn(),
}));
const mockSolve = vi.mocked(solveSpot);
const mockFetchReference = vi.mocked(fetchReferenceStrategy);

beforeEach(() => {
  mockSolve.mockReset();
  mockFetchReference.mockReset();
});

// Three grids are on the page by default (CardPicker, then OOP's and IP's
// RangeGrid) -- scope to the two RangeGrids specifically by their own
// aria-label, rather than an index that'd silently break if the DOM order
// ever changes.
function rangeGrids() {
  return screen.getAllByRole("grid", { name: /starting hand range/i });
}

async function pickBoard(user: ReturnType<typeof userEvent.setup>, labels: RegExp[]) {
  for (const label of labels) {
    await user.click(screen.getByRole("gridcell", { name: label }));
  }
}

/** Default BB(OOP)/BTN(IP) heads-up preflop, closed the cheapest way: IP
 * completes the small blind, OOP checks behind -- leaves pot/stack at the
 * blinds-only 2bb/99bb, which is all most tests need. */
async function closePreflopByChecking(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^call/i }));
  await user.click(screen.getByRole("button", { name: /^check$/i }));
}

async function fillMinimalForm(user: ReturnType<typeof userEvent.setup>) {
  await closePreflopByChecking(user);
  await pickBoard(user, [/king of spades/i, /queen of hearts/i, /9 of diamonds/i]);
  await user.click(within(rangeGrids()[0]).getByRole("gridcell", { name: "KJo" }));
  await user.click(within(rangeGrids()[1]).getByRole("gridcell", { name: "AA" }));
}

describe("SolvePage -- click-through mode (the default)", () => {
  it("works out who is in/out of position from the two seats, in either pick order", async () => {
    const user = userEvent.setup();
    render(<SolvePage />);

    await user.selectOptions(screen.getByLabelText(/^player 2$/i), "UTG"); // BB + UTG
    expect(screen.getByText(/BB is out of position/i)).toBeInTheDocument();
    expect(screen.getByText(/UTG is in position/i)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/^player 1$/i), "BTN"); // BTN + UTG
    await user.selectOptions(screen.getByLabelText(/^player 2$/i), "SB"); // BTN + SB
    expect(screen.getByText(/SB is out of position/i)).toBeInTheDocument();
  });

  it("disables the seat the other player already picked", () => {
    render(<SolvePage />);
    const player1 = screen.getByLabelText(/^player 1$/i);
    expect(within(player1).getByRole("option", { name: "BTN" })).toBeDisabled();
    expect(within(player1).getByRole("option", { name: "UTG" })).not.toBeDisabled();
  });

  it("keeps a range with its seat when the other seat changes", async () => {
    const user = userEvent.setup();
    render(<SolvePage />);
    await user.click(within(rangeGrids()[0]).getByRole("gridcell", { name: "KJo" })); // BB (OOP)

    await user.selectOptions(screen.getByLabelText(/^player 2$/i), "UTG");
    // BB is still out of position, so its range is still first and still has KJo.
    expect(within(rangeGrids()[0]).getByRole("gridcell", { name: "KJo" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("Back and Forward step through the hand's actions, across streets", async () => {
    const user = userEvent.setup();
    render(<SolvePage />);
    const back = () => screen.getByRole("button", { name: /back one action/i });
    const forward = () => screen.getByRole("button", { name: /forward one action/i });
    expect(back()).toBeDisabled();
    expect(forward()).toBeDisabled();

    await closePreflopByChecking(user); // BTN calls, BB checks
    expect(screen.getByText("BB checks")).toBeInTheDocument();

    await user.click(back());
    expect(screen.queryByText("BB checks")).not.toBeInTheDocument();
    expect(screen.getByText("BTN calls")).toBeInTheDocument();
    expect(forward()).not.toBeDisabled();

    await user.click(back());
    expect(screen.queryByText("BTN calls")).not.toBeInTheDocument();
    expect(back()).toBeDisabled();

    await user.click(forward());
    await user.click(forward());
    expect(screen.getByText("BTN calls")).toBeInTheDocument();
    expect(screen.getByText("BB checks")).toBeInTheDocument();
    expect(forward()).toBeDisabled();
  });

  it("a new action after Back clears Forward; a street's own Undo feeds Forward", async () => {
    const user = userEvent.setup();
    render(<SolvePage />);
    const forward = () => screen.getByRole("button", { name: /forward one action/i });

    await closePreflopByChecking(user);
    await user.click(screen.getByRole("button", { name: /undo last action/i }));
    expect(forward()).not.toBeDisabled();

    await user.click(screen.getByRole("button", { name: /^check$/i })); // a fresh action
    expect(forward()).toBeDisabled();
  });

  it("Reset clears Forward history", async () => {
    const user = userEvent.setup();
    render(<SolvePage />);
    await closePreflopByChecking(user);
    await user.click(screen.getByRole("button", { name: /back one action/i }));
    await user.click(screen.getByRole("button", { name: /^reset$/i }));
    expect(screen.getByRole("button", { name: /forward one action/i })).toBeDisabled();
  });

  it("Reset clears the board, ranges, and preflop action back to a blank page", async () => {
    const user = userEvent.setup();
    render(<SolvePage />);
    await fillMinimalForm(user);
    expect(screen.getByRole("button", { name: /^solve$/i })).not.toBeDisabled();

    await user.click(screen.getByRole("button", { name: /^reset$/i }));

    expect(screen.getByRole("button", { name: /^solve$/i })).toBeDisabled();
    expect(screen.getByText(/pick at least 3 board cards/i)).toBeInTheDocument();
    expect(screen.getByText(/add hands to bb.s range/i)).toBeInTheDocument();
    expect(screen.queryByText(/preflop action is closed/i)).not.toBeInTheDocument();
  });

  it("lists exactly what's missing while Solve is disabled", async () => {
    const user = userEvent.setup();
    render(<SolvePage />);

    expect(screen.getByText(/pick at least 3 board cards/i)).toBeInTheDocument();
    expect(screen.getByText(/add hands to bb.s range/i)).toBeInTheDocument();
    expect(screen.getByText(/add hands to btn.s range/i)).toBeInTheDocument();

    await fillMinimalForm(user);
    expect(screen.queryByText(/pick at least 3 board cards/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/add hands to/i)).not.toBeInTheDocument();
  });

  it("disables submit until preflop closes, a board is picked, and both ranges are filled", async () => {
    const user = userEvent.setup();
    render(<SolvePage />);
    expect(screen.getByRole("button", { name: /^solve$/i })).toBeDisabled();

    await fillMinimalForm(user);
    expect(screen.getByRole("button", { name: /^solve$/i })).not.toBeDisabled();
  });

  it("computes pot and effective stack from blinds alone when preflop is just checked through", async () => {
    const user = userEvent.setup();
    render(<SolvePage />);
    await fillMinimalForm(user);

    expect(screen.getByText(/pot entering the flop: 2.5bb/i)).toBeInTheDocument();
    expect(screen.getByText(/effective stack: 99bb/i)).toBeInTheDocument();
  });

  it("supports a preflop 3-bet and 4-bet before closing, with real escalating sizes", async () => {
    const user = userEvent.setup();
    render(<SolvePage />);
    const sizeInput = () => screen.getByLabelText(/to \(bb\)/i);

    await user.clear(sizeInput());
    await user.type(sizeInput(), "3");
    await user.click(screen.getByRole("button", { name: /^raise$/i })); // BTN opens to 3

    await user.clear(sizeInput());
    await user.type(sizeInput(), "9");
    await user.click(screen.getByRole("button", { name: /^raise$/i })); // BB 3-bets to 9

    await user.clear(sizeInput());
    await user.type(sizeInput(), "21");
    await user.click(screen.getByRole("button", { name: /^raise$/i })); // BTN 4-bets to 21

    await user.click(screen.getByRole("button", { name: /^call/i })); // BB calls

    expect(screen.getByText("BTN raises to 3bb")).toBeInTheDocument();
    expect(screen.getByText("BB raises to 9bb")).toBeInTheDocument();
    expect(screen.getByText("BTN raises to 21bb")).toBeInTheDocument();
    expect(screen.getByText("BB calls")).toBeInTheDocument();
    expect(screen.getByText(/preflop action is closed/i)).toBeInTheDocument();

    // Matches handBuilder.test.ts's own closed-form check of this exact
    // sequence: both matched at 21bb, pot = 21 + 21 + 0.5 dead SB = 42.5, stack = 100 - 21.
    await pickBoard(user, [/king of spades/i, /queen of hearts/i, /9 of diamonds/i]);
    expect(screen.getByText(/pot entering the flop: 42.5bb/i)).toBeInTheDocument();
    expect(screen.getByText(/effective stack: 79bb/i)).toBeInTheDocument();
  });

  it("ends the hand on a preflop fold and disables solving", async () => {
    const user = userEvent.setup();
    render(<SolvePage />);

    await user.click(screen.getByRole("button", { name: /^fold$/i }));
    expect(screen.getByText(/folds -- the hand ends here/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^solve$/i })).toBeDisabled();
  });

  it("blocks the flop section until preflop closes", async () => {
    const user = userEvent.setup();
    render(<SolvePage />);

    await pickBoard(user, [/king of spades/i, /queen of hearts/i, /9 of diamonds/i]);
    expect(screen.getByText(/finish the preflop's action/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^solve$/i })).toBeDisabled();
  });

  it("carries pot/stack through flop and turn action to reach a river decision", async () => {
    const user = userEvent.setup();
    render(<SolvePage />);

    await closePreflopByChecking(user);
    await pickBoard(user, [/king of spades/i, /queen of hearts/i, /9 of diamonds/i]);
    await user.click(screen.getByRole("button", { name: /^check$/i })); // OOP checks the flop
    await user.click(screen.getByRole("button", { name: /^check$/i })); // IP checks back, flop closes

    await user.click(screen.getByRole("gridcell", { name: /4 of clubs/i })); // turn card
    await user.click(screen.getByRole("button", { name: /^bet$/i })); // OOP bets the turn (default size)
    await user.click(screen.getByRole("button", { name: /^call/i })); // IP calls, turn closes

    await user.click(screen.getByRole("gridcell", { name: /2 of spades/i })); // river card
    expect(screen.getByRole("heading", { name: /^river$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^check$/i })).toBeInTheDocument();
  });

  it("submits the expected Spot shape and renders the returned strategy", async () => {
    mockSolve.mockResolvedValue({
      kind: "solved",
      data: {
        source: "live_solve",
        iterations: 8000,
        position: "BTN",
        strategy: { AA: { check: 0.05, all_in: 0.95 } },
        bucketed_actions: [],
      },
    });
    const user = userEvent.setup();
    render(<SolvePage />);

    await fillMinimalForm(user);
    await user.click(screen.getByRole("button", { name: /^solve$/i }));

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

    expect(await screen.findByText(/BTN.s strategy/i)).toBeInTheDocument();
    expect(
      screen.getByRole("gridcell", { name: /^AA: Check 5%, All-in 95%$/i }),
    ).toBeInTheDocument();
  });

  it("submits a seeded bet as a real action, not just a check", async () => {
    mockSolve.mockResolvedValue({
      kind: "solved",
      data: { source: "live_solve", iterations: 4000, position: "BTN", strategy: {}, bucketed_actions: [] },
    });
    const user = userEvent.setup();
    render(<SolvePage />);

    await closePreflopByChecking(user);
    await pickBoard(user, [/king of spades/i, /queen of hearts/i, /9 of diamonds/i]);
    await user.click(screen.getByRole("button", { name: /^bet$/i })); // OOP bets the flop
    await user.click(within(rangeGrids()[0]).getByRole("gridcell", { name: "KJo" }));
    await user.click(within(rangeGrids()[1]).getByRole("gridcell", { name: "AA" }));
    await user.click(screen.getByRole("button", { name: /^solve$/i }));

    expect(mockSolve).toHaveBeenCalledWith(
      expect.objectContaining({
        current_street: "flop",
        actions: [{ position: "BB", street: "flop", action: "bet", size_bb: 3 }],
      }),
    );
  });

  it("shows how close to equilibrium the solve got, when the backend reports it", async () => {
    mockSolve.mockResolvedValue({
      kind: "solved",
      data: {
        source: "live_solve",
        iterations: 175,
        exploitability_pct: 0.44,
        position: "BTN",
        strategy: {},
        bucketed_actions: [],
      },
    });
    const user = userEvent.setup();
    render(<SolvePage />);
    await fillMinimalForm(user);
    await user.click(screen.getByRole("button", { name: /^solve$/i }));

    expect(await screen.findByText(/within 0\.44% of the pot/i)).toBeInTheDocument();
  });

  it("says so when the server's time limit cut the solve short", async () => {
    mockSolve.mockResolvedValue({
      kind: "solved",
      data: {
        source: "live_solve",
        iterations: 90,
        exploitability_pct: 2.4,
        converged: false,
        position: "BTN",
        strategy: {},
        bucketed_actions: [],
      },
    });
    const user = userEvent.setup();
    render(<SolvePage />);
    await fillMinimalForm(user);
    await user.click(screen.getByRole("button", { name: /^solve$/i }));

    expect(await screen.findByText(/hit its time limit/i)).toBeInTheDocument();
  });

  it("explains a busy solver instead of showing a generic error", async () => {
    mockSolve.mockResolvedValue({ kind: "busy" });
    const user = userEvent.setup();
    render(<SolvePage />);
    await fillMinimalForm(user);
    await user.click(screen.getByRole("button", { name: /^solve$/i }));

    expect(await screen.findByText(/the solver is busy/i)).toBeInTheDocument();
  });

  it("omits the precision line for an older backend that doesn't report it", async () => {
    mockSolve.mockResolvedValue({
      kind: "solved",
      data: { source: "live_solve", iterations: 4000, position: "BTN", strategy: {}, bucketed_actions: [] },
    });
    const user = userEvent.setup();
    render(<SolvePage />);
    await fillMinimalForm(user);
    await user.click(screen.getByRole("button", { name: /^solve$/i }));

    expect(await screen.findByText(/BTN.s strategy/i)).toBeInTheDocument();
    expect(screen.queryByText(/of the pot of a\s+true equilibrium/i)).not.toBeInTheDocument();
  });

  it("displays any bucketing notes the backend returns", async () => {
    mockSolve.mockResolvedValue({
      kind: "solved",
      data: {
        source: "live_solve",
        iterations: 4000,
        position: "BTN",
        strategy: {},
        bucketed_actions: ["BB's 2bb bet -> bucketed to 75% pot (bet_medium)"],
      },
    });
    const user = userEvent.setup();
    render(<SolvePage />);
    await fillMinimalForm(user);
    await user.click(screen.getByRole("button", { name: /^solve$/i }));

    expect(await screen.findByText(/bucketed to 75% pot/i)).toBeInTheDocument();
  });

  it("submits the same Spot shape via the typed-board mode", async () => {
    mockSolve.mockResolvedValue({
      kind: "solved",
      data: { source: "live_solve", iterations: 8000, position: "BTN", strategy: {}, bucketed_actions: [] },
    });
    const user = userEvent.setup();
    render(<SolvePage />);

    await closePreflopByChecking(user);
    await user.click(screen.getByRole("radio", { name: /type it/i }));
    await user.type(screen.getByLabelText(/^board$/i), "Ks Qh 9d");
    await user.click(within(rangeGrids()[0]).getByRole("gridcell", { name: "KJo" }));
    await user.click(within(rangeGrids()[1]).getByRole("gridcell", { name: "AA" }));
    await user.click(screen.getByRole("button", { name: /^solve$/i }));

    expect(mockSolve).toHaveBeenCalledWith(expect.objectContaining({ board: ["Ks", "Qh", "9d"] }));
  });

  it("uses the starting stack, not a fixed default, for reference-chart lookups", async () => {
    mockFetchReference.mockResolvedValue({ kind: "no-match" });
    const user = userEvent.setup();
    render(<SolvePage />);

    await user.clear(screen.getByLabelText(/starting stack/i));
    await user.type(screen.getByLabelText(/starting stack/i), "150");
    await user.click(screen.getByRole("button", { name: /load btn.s typical range/i }));

    expect(mockFetchReference).toHaveBeenCalledWith(
      expect.objectContaining({ positions_in_hand: ["BTN"], effective_stack_bb: 150 }),
    );
  });

  it("shows the backend's own message for a rejected (but well-formed) spot", async () => {
    mockSolve.mockResolvedValue({
      kind: "rejected",
      reason: "ranges is missing an entry for: BTN",
    });
    const user = userEvent.setup();
    render(<SolvePage />);

    await fillMinimalForm(user);
    await user.click(screen.getByRole("button", { name: /^solve$/i }));

    expect(await screen.findByText(/ranges is missing an entry for: btn/i)).toBeInTheDocument();
  });

  it("distinguishes a network error from an unexpected response", async () => {
    const user = userEvent.setup();
    render(<SolvePage />);
    await fillMinimalForm(user);
    const submit = screen.getByRole("button", { name: /^solve$/i });

    mockSolve.mockResolvedValueOnce({ kind: "network-error" });
    await user.click(submit);
    expect(await screen.findByText(/couldn.t reach the api/i)).toBeInTheDocument();

    mockSolve.mockResolvedValueOnce({ kind: "error", status: 500 });
    await user.click(submit);
    expect(await screen.findByText(/http 500/i)).toBeInTheDocument();
  });

  it("loads a position's opening range from the reference chart", async () => {
    mockFetchReference.mockResolvedValue({
      kind: "match",
      data: {
        source: "reference_chart",
        chart_key: "btn_open_100bb",
        chart_description: "BTN opening range",
        chart_source: "test",
        ranges: { BTN: { AA: 1, KQs: 1 } },
      },
    });
    const user = userEvent.setup();
    render(<SolvePage />);

    // Default in-position seat is BTN; default starting stack is 100bb.
    await user.click(screen.getByRole("button", { name: /load btn.s typical range/i }));

    expect(mockFetchReference).toHaveBeenCalledWith(
      expect.objectContaining({ positions_in_hand: ["BTN"], effective_stack_bb: 100 }),
    );
    // The loaded range lands in BTN's own grid (the second RangeGrid).
    expect(
      within(rangeGrids()[1]).getByRole("gridcell", { name: "AA" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("falls back to the defend-vs-raise chart when a position has no opening chart", async () => {
    // BB can never open, so the first (open-chart) lookup always misses --
    // the second lookup should be the defend chart, treating BTN (the
    // default in-position seat) as the raiser.
    mockFetchReference.mockResolvedValueOnce({ kind: "no-match" });
    mockFetchReference.mockResolvedValueOnce({
      kind: "match",
      data: {
        source: "reference_chart",
        chart_key: "bb_defend_vs_btn_open_100bb",
        chart_description: "BB defending vs a BTN open",
        chart_source: "test",
        ranges: { BB: { AA: 1 } },
      },
    });
    const user = userEvent.setup();
    render(<SolvePage />);

    await user.click(screen.getByRole("button", { name: /load bb.s typical range/i }));

    expect(mockFetchReference).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ positions_in_hand: ["BB"], actions: [] }),
    );
    expect(mockFetchReference).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        positions_in_hand: ["BB"],
        actions: [{ position: "BTN", street: "preflop", action: "raise" }],
      }),
    );
    expect(
      within(rangeGrids()[0]).getByRole("gridcell", { name: "AA" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("explains plainly when neither an opening nor a defend chart covers a position", async () => {
    mockFetchReference.mockResolvedValue({ kind: "no-match" });
    const user = userEvent.setup();
    render(<SolvePage />);

    await user.click(screen.getByRole("button", { name: /load bb.s typical range/i }));

    expect(
      await screen.findByText(/no reference chart covers bb opening, or defending vs btn/i),
    ).toBeInTheDocument();
  });
});

describe("SolvePage -- paste-a-hand-history mode", () => {
  async function switchToPasteMode(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("radio", { name: /from a hand history/i }));
  }

  it("fills positions/board/pot/stack from a pasted hand history, leaving ranges untouched", async () => {
    const hh = `PokerStars Hand #3:  Hold'em No Limit ($0.50/$1.00 USD) - 2024/01/01 12:00:00 ET
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
    const user = userEvent.setup();
    render(<SolvePage />);
    await switchToPasteMode(user);

    // fireEvent.change, not user.type -- the hand history's "[7h 7s]"
    // brackets collide with userEvent's special-key syntax (e.g. "{enter}"),
    // and this is pasting a block of text, not simulating keystrokes anyway.
    fireEvent.change(screen.getByLabelText(/paste a hand history/i), { target: { value: hh } });
    await user.click(screen.getByRole("button", { name: /^load from hand history$/i }));

    expect(screen.getByLabelText(/^player 1$/i)).toHaveValue("BB");
    expect(screen.getByLabelText(/^player 2$/i)).toHaveValue("BTN");
    expect(screen.getByText(/BB is out of position/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^pot \(bb\)$/i)).toHaveValue(6.5);
    expect(screen.getByLabelText(/^effective stack \(bb\)$/i)).toHaveValue(97);
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(
      screen.getByRole("gridcell", { name: /jack of clubs/i }),
    ).toHaveAttribute("aria-pressed", "true");

    // Ranges are deliberately left alone -- a hand history doesn't reveal
    // villain's actual cards. ("pressed" isn't a role-querying option RTL
    // supports for "gridcell", so check the attribute directly.)
    for (const grid of rangeGrids()) {
      const pressedCells = within(grid)
        .getAllByRole("gridcell")
        .filter((cell) => cell.getAttribute("aria-pressed") === "true");
      expect(pressedCells).toHaveLength(0);
    }
  });

  it("shows the parser's reason when a hand history can't be loaded", async () => {
    const user = userEvent.setup();
    render(<SolvePage />);
    await switchToPasteMode(user);

    await user.type(screen.getByLabelText(/paste a hand history/i), "not a real hand history");
    await user.click(screen.getByRole("button", { name: /^load from hand history$/i }));

    expect(await screen.findByText(/table size and button seat/i)).toBeInTheDocument();
  });

  it("disables submit until a hand history has actually been loaded", async () => {
    const user = userEvent.setup();
    render(<SolvePage />);
    await switchToPasteMode(user);
    expect(screen.getByRole("button", { name: /^solve$/i })).toBeDisabled();
  });

  it("seeds an opening check from OOP when the checkbox is ticked, and solves from pasted pot/stack", async () => {
    mockSolve.mockResolvedValue({
      kind: "solved",
      data: { source: "live_solve", iterations: 8000, position: "BTN", strategy: {}, bucketed_actions: [] },
    });
    const user = userEvent.setup();
    render(<SolvePage />);
    await switchToPasteMode(user);

    fireEvent.change(screen.getByLabelText(/paste a hand history/i), {
      target: {
        value: `PokerStars Hand #3:  Hold'em No Limit ($0.50/$1.00 USD) - 2024/01/01 12:00:00 ET
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
`,
      },
    });
    await user.click(screen.getByRole("button", { name: /^load from hand history$/i }));
    await user.click(within(rangeGrids()[0]).getByRole("gridcell", { name: "KJo" }));
    await user.click(within(rangeGrids()[1]).getByRole("gridcell", { name: "AA" }));
    await user.click(screen.getByRole("button", { name: /^solve$/i }));

    expect(mockSolve).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: [{ position: "BB", street: "flop", action: "check" }],
      }),
    );
  });
});
