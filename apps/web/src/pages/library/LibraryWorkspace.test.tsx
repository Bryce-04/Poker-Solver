import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { Spot } from "@poker-solver/schema";
import { LibraryPage } from "../LibraryPage";
import { deleteSpot, listSpots, renameSpot, saveSpot } from "../../lib/api";
import { useAuth } from "../../lib/auth";

vi.mock("../../lib/api", () => ({
  listSpots: vi.fn(),
  renameSpot: vi.fn(),
  deleteSpot: vi.fn(),
  saveSpot: vi.fn(),
}));
const mockList = vi.mocked(listSpots);
const mockRename = vi.mocked(renameSpot);
const mockDelete = vi.mocked(deleteSpot);
const mockSave = vi.mocked(saveSpot);

vi.mock("../../lib/auth", () => ({ useAuth: vi.fn() }));
const mockUseAuth = vi.mocked(useAuth);

const CHART: Spot = {
  id: "chart-1",
  name: "BTN open · standard",
  created_at: "2026-10-07T19:49:00Z",
  positions_in_hand: ["BTN"],
  effective_stack_bb: 100,
  current_street: "preflop",
  actions: [],
  board: [],
  ranges: { BTN: { AA: 1, KK: 1 } },
};
const SETUP: Spot = {
  id: "setup-1",
  created_at: "2026-10-19T01:41:00Z",
  positions_in_hand: ["BB", "BTN"],
  effective_stack_bb: 100,
  pot_bb: 5.5,
  current_street: "flop",
  board: ["Qs", "5c", "2c"],
  actions: [],
  ranges: {},
};

function Probe() {
  const { pathname, state } = useLocation();
  return <output data-testid="opened">{`${pathname} ${JSON.stringify(state)}`}</output>;
}

function renderLibrary() {
  return render(
    <MemoryRouter initialEntries={["/library"]}>
      <Routes>
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/ranges" element={<Probe />} />
        <Route path="/solve" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(min-width: 1024px)",
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  mockList.mockReset();
  mockList.mockResolvedValue({ kind: "ok", spots: [CHART, SETUP] });
  mockRename.mockReset();
  mockDelete.mockReset();
  mockSave.mockReset();
  mockUseAuth.mockReset();
  mockUseAuth.mockReturnValue({ status: "signed-in", email: "hero@example.com" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const preview = () => screen.getByRole("complementary", { name: "Selected spot" });

describe("LibraryWorkspace (desktop Library)", () => {
  it("lists spots in a table, falling back to a summary for unnamed ones", async () => {
    renderLibrary();
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent("BTN open · standard");
    expect(rows[1]).toHaveTextContent("Preflop");
    expect(rows[2]).toHaveTextContent("BB/BTN — 100bb, unopened pot");
    expect(rows[2]).toHaveTextContent("Postflop");
    expect(rows[2]).toHaveTextContent("BB vs BTN");
    expect(rows[2]).toHaveTextContent("Q♠ 5♣ 2♣");
    // The first row is previewed by default.
    expect(within(preview()).getByRole("heading", { name: "BTN open · standard" })).toBeInTheDocument();
    expect(preview()).toHaveTextContent("0.9% of hands · 12 combos");
  });

  it("filters by type and by search", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Postflop" }));
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByRole("table")).toHaveTextContent("Q♠ 5♣ 2♣");

    await user.click(screen.getByRole("button", { name: "All" }));
    await user.type(screen.getByRole("searchbox"), "standard");
    expect(screen.getAllByRole("row")).toHaveLength(2);
    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "nothing like this");
    expect(screen.getByText("No spots match that search.")).toBeInTheDocument();
  });

  it("opens a chart in Ranges and a setup in Solve, carrying the spot", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await screen.findByRole("table");
    await user.click(within(preview()).getByRole("button", { name: "Open in Ranges" }));
    expect(screen.getByTestId("opened")).toHaveTextContent('/ranges {"spot":{"id":"chart-1"');
  });

  it("opens a postflop setup in Solve from its row", async () => {
    const user = userEvent.setup();
    renderLibrary();
    const table = await screen.findByRole("table");
    await user.click(within(within(table).getAllByRole("row")[2]).getByRole("button", { name: "Open" }));
    expect(screen.getByTestId("opened")).toHaveTextContent('/solve {"spot":{"id":"setup-1"');
  });

  it("renames from the row's pencil", async () => {
    const user = userEvent.setup();
    mockRename.mockImplementation(async (id, name) => ({ kind: "renamed", spot: { ...CHART, id, name } }));
    renderLibrary();
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Rename BTN open · standard" }));
    const input = within(preview()).getByLabelText("Rename");
    await user.clear(input);
    await user.type(input, "My BTN open");
    await user.click(within(preview()).getByRole("button", { name: "Save name" }));

    expect(mockRename).toHaveBeenCalledWith("chart-1", "My BTN open");
    expect(await within(preview()).findByRole("heading", { name: "My BTN open" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveTextContent("My BTN open");
  });

  it("deletes only after confirming", async () => {
    const user = userEvent.setup();
    mockDelete.mockResolvedValue({ kind: "deleted" });
    renderLibrary();
    await screen.findByRole("table");
    await user.click(within(preview()).getByRole("button", { name: "Delete" }));
    expect(mockDelete).not.toHaveBeenCalled();
    const confirm = screen.getByRole("alertdialog", { name: /delete btn open/i });
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete BTN open · standard" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    expect(mockDelete).toHaveBeenCalledWith("chart-1");
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(2));
    expect(screen.getByRole("table")).not.toHaveTextContent("BTN open · standard");
  });

  it("duplicates as a new saved spot named '(copy)'", async () => {
    const user = userEvent.setup();
    mockSave.mockImplementation(async (spot) => ({ kind: "saved", spot: { ...spot, id: "copy-1" } }));
    renderLibrary();
    await screen.findByRole("table");
    await user.click(within(preview()).getByRole("button", { name: "Duplicate" }));
    expect(mockSave.mock.calls[0][0].name).toBe("BTN open · standard (copy)");
    expect(await within(preview()).findByRole("heading", { name: "BTN open · standard (copy)" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(4);
  });

  it("explains an empty Library and a signed-out one", async () => {
    mockList.mockResolvedValue({ kind: "ok", spots: [] });
    const { unmount } = renderLibrary();
    expect(await screen.findByText("No saved spots yet.")).toBeInTheDocument();
    unmount();

    mockUseAuth.mockReturnValue({ status: "signed-out", email: null });
    renderLibrary();
    expect(screen.getByText("Sign in to see your Library.")).toBeInTheDocument();
    expect(mockList).toHaveBeenCalledTimes(1);
  });
});
