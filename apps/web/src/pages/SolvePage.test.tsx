import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SolvePage } from "./SolvePage";
import { solveSpot } from "../lib/api";

vi.mock("../lib/api", () => ({
  solveSpot: vi.fn(),
}));
const mockSolve = vi.mocked(solveSpot);

beforeEach(() => {
  mockSolve.mockReset();
});

// Three grids are on the page by default (CardPicker, then OOP's and IP's
// RangeGrid) -- scope to the two RangeGrids specifically by their own
// aria-label, rather than an index that'd silently break if the DOM order
// ever changes.
function rangeGrids() {
  return screen.getAllByRole("grid", { name: /starting hand range/i });
}

const RIVER_CARD_LABELS = [
  /king of spades/i,
  /queen of hearts/i,
  /9 of diamonds/i,
  /4 of clubs/i,
  /2 of spades/i,
];

async function pickBoard(user: ReturnType<typeof userEvent.setup>, labels: RegExp[]) {
  for (const label of labels) {
    await user.click(screen.getByRole("gridcell", { name: label }));
  }
}

async function fillMinimalForm(user: ReturnType<typeof userEvent.setup>) {
  await pickBoard(user, RIVER_CARD_LABELS);
  await user.click(within(rangeGrids()[0]).getByRole("gridcell", { name: "KJo" }));
  await user.click(within(rangeGrids()[1]).getByRole("gridcell", { name: "AA" }));
}

describe("SolvePage", () => {
  it("disables submit until both ranges and the board are filled in", async () => {
    const user = userEvent.setup();
    render(<SolvePage />);
    expect(screen.getByRole("button", { name: /^solve$/i })).toBeDisabled();

    await fillMinimalForm(user);
    expect(screen.getByRole("button", { name: /^solve$/i })).not.toBeDisabled();
  });

  it("shows a board validation error until enough cards are picked", async () => {
    const user = userEvent.setup();
    render(<SolvePage />);

    await pickBoard(user, [/king of spades/i, /queen of hearts/i]);
    expect(await screen.findByText(/3 \(flop\)/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^solve$/i })).toBeDisabled();
  });

  it("submits the expected Spot shape and renders the returned strategy", async () => {
    mockSolve.mockResolvedValue({
      kind: "solved",
      data: {
        source: "live_solve",
        iterations: 8000,
        position: "BTN",
        strategy: { AA: { check: 0.05, all_in: 0.95 } },
      },
    });
    const user = userEvent.setup();
    render(<SolvePage />);

    await fillMinimalForm(user);
    await user.click(screen.getByRole("button", { name: /^solve$/i }));

    expect(mockSolve).toHaveBeenCalledWith(
      expect.objectContaining({
        positions_in_hand: ["BB", "BTN"],
        board: ["Ks", "Qh", "9d", "4c", "2s"],
        current_street: "river",
        actions: [],
        ranges: { BB: { KJo: 1 }, BTN: { AA: 1 } },
      }),
    );

    expect(await screen.findByText(/BTN.s strategy/i)).toBeInTheDocument();
    // "AA" also appears as a range-grid cell label -- scope to the results
    // table specifically.
    const table = within(screen.getByRole("table"));
    expect(table.getByText("AA")).toBeInTheDocument();
    expect(table.getByText("95%")).toBeInTheDocument();
    expect(table.getByText("5%")).toBeInTheDocument();
  });

  it("submits the same Spot shape via the typed-board mode", async () => {
    mockSolve.mockResolvedValue({
      kind: "solved",
      data: { source: "live_solve", iterations: 8000, position: "BTN", strategy: {} },
    });
    const user = userEvent.setup();
    render(<SolvePage />);

    await user.click(screen.getByRole("radio", { name: /type it/i }));
    await user.type(screen.getByLabelText(/^board$/i), "Ks Qh 9d 4c 2s");
    await user.click(within(rangeGrids()[0]).getByRole("gridcell", { name: "KJo" }));
    await user.click(within(rangeGrids()[1]).getByRole("gridcell", { name: "AA" }));
    await user.click(screen.getByRole("button", { name: /^solve$/i }));

    expect(mockSolve).toHaveBeenCalledWith(
      expect.objectContaining({ board: ["Ks", "Qh", "9d", "4c", "2s"] }),
    );
  });

  it("keeps each board mode's own input when switching back and forth", async () => {
    const user = userEvent.setup();
    render(<SolvePage />);

    await pickBoard(user, [/king of spades/i, /queen of hearts/i, /9 of diamonds/i]);
    await user.click(screen.getByRole("radio", { name: /type it/i }));
    await user.type(screen.getByLabelText(/^board$/i), "7s 7h 7d");
    await user.click(screen.getByRole("radio", { name: /pick cards/i }));

    // The three picked cards are still selected, untouched by the detour
    // through text mode.
    expect(screen.getByRole("gridcell", { name: /king of spades/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("seeds an opening check from OOP when the checkbox is ticked", async () => {
    mockSolve.mockResolvedValue({
      kind: "solved",
      data: { source: "live_solve", iterations: 8000, position: "BTN", strategy: {} },
    });
    const user = userEvent.setup();
    render(<SolvePage />);

    await fillMinimalForm(user);
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /^solve$/i }));

    expect(mockSolve).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: [{ position: "BB", street: "river", action: "check" }],
      }),
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
});
