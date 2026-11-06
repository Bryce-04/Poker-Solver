import { useEffect } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { Spot } from "@poker-solver/schema";
import { RangesPage } from "../RangesPage";
import { fetchReferenceStrategy, saveSpot } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { AccountSheetContext } from "../../lib/mobileShell";
import { EXAMPLE_HAND_HISTORY } from "../../lib/parseHandHistory";

// The phone Ranges page (docs/mobile-redesign.md §5) through RangesPage: jsdom
// has no matchMedia, so it renders the phone layout. The API and auth are
// mocked; the spot logic and chart loading are real.

vi.mock("../../lib/api", () => ({ fetchReferenceStrategy: vi.fn(), saveSpot: vi.fn() }));
const mockFetch = vi.mocked(fetchReferenceStrategy);
const mockSave = vi.mocked(saveSpot);
vi.mock("../../lib/auth", () => ({ useAuth: vi.fn() }));
const mockAuth = vi.mocked(useAuth);

function chart(hero: string, range: Record<string, number>) {
  return {
    kind: "match" as const,
    data: {
      source: "reference_chart" as const,
      chart_key: "x",
      chart_description: "x",
      chart_source: "test",
      ranges: { [hero]: range },
    },
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  mockSave.mockReset();
  mockAuth.mockReturnValue({ status: "signed-in", email: "hero@example.com" });
  mockFetch.mockImplementation(async (spot) => chart(spot.positions_in_hand[0], { AA: 1, KK: 1 }));
});

/** Where the router is, read back by tests. */
let where = { pathname: "", search: "", state: null as unknown };
function LocationSpy() {
  const location = useLocation();
  useEffect(() => {
    where = { pathname: location.pathname, search: location.search, state: location.state };
  }, [location]);
  return null;
}

function renderAt(url: string, { onAccount = () => {}, state }: { onAccount?: () => void; state?: unknown } = {}) {
  const [pathname, query] = url.split("?");
  return render(
    <MemoryRouter initialEntries={[{ pathname, search: query ? `?${query}` : "", state }]}>
      <AccountSheetContext.Provider value={onAccount}>
        <Routes>
          <Route path="/ranges" element={<RangesPage />} />
          <Route path="/solve" element={null} />
        </Routes>
        <LocationSpy />
      </AccountSheetContext.Provider>
    </MemoryRouter>,
  );
}

const group = (name: string) => within(screen.getByRole("group", { name }));
/** The action bar's main button, whatever it says right now. */
const primary = () => screen.getByRole("button", { name: /solve a flop from here|loading|first|no chart/i });

describe("phone Ranges -- Pick", () => {
  it("loads the chart for the default spot with no button to press", async () => {
    renderAt("/ranges");
    expect(screen.getByRole("button", { name: "Pick" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("heading", { name: "BTN opening range" })).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({ positions_in_hand: ["BTN"], current_street: "preflop", actions: [] }),
    );
    expect(screen.getByText(/standard chart: a starting point/i)).toBeInTheDocument();
    expect(screen.getByText("0.9% of all hands · 12 combos")).toBeInTheDocument();
  });

  it("follows the seat, a raise and the stack, and keeps them in the URL", async () => {
    const user = userEvent.setup();
    renderAt("/ranges");
    await screen.findByRole("heading", { name: "BTN opening range" });

    await user.click(group("Your seat").getByRole("button", { name: "BB" }));
    // BB is never first in: "Nobody raised" is off and the raiser picker shows.
    expect(group("Before you").getByRole("button", { name: "Nobody raised" })).toBeDisabled();
    await user.click(group("Who raised").getByRole("button", { name: "CO" }));
    await user.click(group("Stack").getByRole("button", { name: "40bb" }));

    expect(await screen.findByRole("heading", { name: "BB vs a CO raise" })).toBeInTheDocument();
    // The chart is fetched after a short debounce, so wait for the call for the new stack
    // (the heading above is already there from the raiser change).
    await waitFor(() =>
      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.objectContaining({
          // A chart spot names only your own seat; the raiser is in the actions.
          positions_in_hand: ["BB"],
          effective_stack_bb: 40,
          actions: [{ position: "CO", street: "preflop", action: "raise" }],
        }),
      ),
    );
    // The URL keeps the choice, not what BB forces it to, so going back to a
    // seat that can open restores "Nobody raised", as on desktop.
    expect(where.search).toBe("?seat=BB&before=none&raiser=CO&stack=40");
  });

  it("starts from the URL, as the tab bar returns to it", async () => {
    renderAt("/ranges?seat=CO&before=raise&raiser=HJ&stack=100");
    expect(await screen.findByRole("heading", { name: "CO vs a HJ raise" })).toBeInTheDocument();
    expect(group("Your seat").getByRole("button", { name: "CO" })).toHaveAttribute("aria-pressed", "true");
  });

  it("says plainly when no chart covers the spot, or the server can't be reached", async () => {
    mockFetch.mockResolvedValueOnce({ kind: "no-match" });
    const { unmount } = renderAt("/ranges");
    expect(await screen.findByText(/no standard chart for this spot yet/i)).toBeInTheDocument();
    expect(primary()).toHaveTextContent("No chart for this spot");
    unmount();

    mockFetch.mockResolvedValueOnce({ kind: "network-error" });
    renderAt("/ranges");
    expect(await screen.findByText(/couldn.t reach the server/i)).toBeInTheDocument();
  });
});

describe("phone Ranges -- editing and saving", () => {
  async function addQueens(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("gridcell", { name: "QQ" }));
    const sheet = screen.getByRole("dialog", { name: /QQ/ });
    await user.click(within(sheet).getByRole("button", { name: "100%" }));
    await user.click(within(sheet).getByRole("button", { name: "Done" }));
  }

  it("edits a hand from its sheet, marks the range edited, and resets it", async () => {
    const user = userEvent.setup();
    renderAt("/ranges");
    await screen.findByRole("heading", { name: "BTN opening range" });
    expect(screen.getByRole("button", { name: "Reset to the chart" })).toBeDisabled();

    await user.click(screen.getByRole("gridcell", { name: "QQ" }));
    expect(screen.getByText("How often does BTN play this hand here?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await addQueens(user);
    expect(screen.getByText("1.4% of all hands · 18 combos · edited")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset to the chart" }));
    expect(screen.getByRole("gridcell", { name: "QQ" })).toHaveAttribute("aria-pressed", "false");
  });

  it("saves the edited range under a name", async () => {
    mockSave.mockResolvedValue({ kind: "saved", spot: {} as Spot });
    const user = userEvent.setup();
    renderAt("/ranges");
    await screen.findByRole("heading", { name: "BTN opening range" });
    await addQueens(user);

    await user.click(screen.getByRole("button", { name: "Save" }));
    const sheet = screen.getByRole("dialog", { name: "Save to Library" });
    expect(within(sheet).getByLabelText("Name")).toHaveValue("BTN opening range (my version) · 100bb");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));

    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "BTN opening range (my version) · 100bb",
        ranges: { BTN: { AA: 1, KK: 1, QQ: 1 } },
      }),
    );
    expect(await screen.findByText("Saved to your Library.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks a signed-out user to sign in instead of saving", async () => {
    mockAuth.mockReturnValue({ status: "signed-out", email: null });
    const onAccount = vi.fn();
    const user = userEvent.setup();
    renderAt("/ranges", { onAccount });
    await screen.findByRole("heading", { name: "BTN opening range" });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onAccount).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("solves a flop from here with this range", async () => {
    const user = userEvent.setup();
    renderAt("/ranges");
    await screen.findByRole("heading", { name: "BTN opening range" });
    await user.click(primary());
    expect(where.pathname).toBe("/solve");
    expect(where.state).toMatchObject({ prefill: { hero: "BTN", heroRange: { AA: 1, KK: 1 }, startingStackBb: 100 } });
  });
});

describe("phone Ranges -- Type it and Hand history", () => {
  it("reads a typed phrase or an example, kept in the URL", async () => {
    const user = userEvent.setup();
    renderAt("/ranges?mode=type");
    expect(screen.getByRole("button", { name: "Type it" })).toHaveAttribute("aria-pressed", "true");
    expect(primary()).toHaveTextContent("Type a spot first");

    await user.type(screen.getByLabelText(/type the spot/i), "hello");
    expect(screen.getByText(/not one we understand yet/i)).toBeInTheDocument();

    await user.click(group("Examples").getByRole("button", { name: "BB defends CO open, 100bb" }));
    expect(await screen.findByRole("heading", { name: "BB vs a CO raise" })).toBeInTheDocument();
    expect(where.search).toBe("?mode=type&text=BB+defends+CO+open%2C+100bb");
  });

  it("reads a hand history into its chart", async () => {
    const user = userEvent.setup();
    renderAt("/ranges?mode=paste");
    expect(primary()).toHaveTextContent("Read a hand first");
    await user.click(screen.getByRole("button", { name: "Use an example" }));
    expect(screen.getByLabelText(/paste a hand history/i)).toHaveValue(EXAMPLE_HAND_HISTORY);
    await user.click(screen.getByRole("button", { name: "Read hand" }));
    expect(await screen.findByRole("heading", { name: /opening range|raise/ })).toBeInTheDocument();
  });

  it("says why a hand history can't be read", async () => {
    const user = userEvent.setup();
    renderAt("/ranges?mode=paste");
    fireEvent.change(screen.getByLabelText(/paste a hand history/i), { target: { value: "not a hand" } });
    await user.click(screen.getByRole("button", { name: "Read hand" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn.t read this hand/i);
  });

  it("keeps Pick's choices when switching mode", async () => {
    const user = userEvent.setup();
    renderAt("/ranges?seat=CO&before=none&raiser=HJ&stack=100");
    await user.click(screen.getByRole("button", { name: "Type it" }));
    expect(where.search).toBe("?seat=CO&before=none&raiser=HJ&stack=100&mode=type");
    await user.click(screen.getByRole("button", { name: "Pick" }));
    expect(group("Your seat").getByRole("button", { name: "CO" })).toHaveAttribute("aria-pressed", "true");
  });

  it("treats an unknown mode as Pick", () => {
    renderAt("/ranges?mode=nonsense");
    expect(screen.getByRole("button", { name: "Pick" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("phone Ranges -- a chart opened from the Library", () => {
  it("shows the saved range, not the standard one", async () => {
    renderAt("/ranges", {
      state: {
        spot: {
          name: "CO open · tight",
          positions_in_hand: ["CO"],
          effective_stack_bb: 100,
          current_street: "preflop",
          actions: [],
          ranges: { CO: { AA: 1 } },
        },
      },
    });
    expect(await screen.findByRole("heading", { name: "CO opening range" })).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "KK" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("0.5% of all hands · 6 combos · edited")).toBeInTheDocument();
  });
});
