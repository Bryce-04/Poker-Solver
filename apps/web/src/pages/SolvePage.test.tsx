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

// Two RangeGrids are on the page (OOP's, then IP's, in DOM order) -- scope
// to the right one via the rendered <grid> elements rather than an
// ambiguous getByRole("gridcell", { name }) across both.
function grids() {
  return screen.getAllByRole("grid");
}

async function fillMinimalForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^board$/i), "Ks Qh 9d 4c 2s");
  await user.click(within(grids()[0]).getByRole("gridcell", { name: "KJo" }));
  await user.click(within(grids()[1]).getByRole("gridcell", { name: "AA" }));
}

describe("SolvePage", () => {
  it("disables submit until both ranges and the board are filled in", async () => {
    const user = userEvent.setup();
    render(<SolvePage />);
    expect(screen.getByRole("button", { name: /^solve$/i })).toBeDisabled();

    await fillMinimalForm(user);
    expect(screen.getByRole("button", { name: /^solve$/i })).not.toBeDisabled();
  });

  it("shows a board validation error without submitting", async () => {
    const user = userEvent.setup();
    render(<SolvePage />);

    await user.type(screen.getByLabelText(/^board$/i), "Ks Qh");
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
