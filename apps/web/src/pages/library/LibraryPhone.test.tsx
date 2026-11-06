import { useEffect } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { Spot } from "@poker-solver/schema";
import { LibraryPage } from "../LibraryPage";
import { deleteConversation, deleteSpot, listConversations, listSpots, renameSpot, saveSpot } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { AccountSheetContext } from "../../lib/mobileShell";

// The phone Library (docs/mobile-redesign.md §6) through LibraryPage: jsdom has
// no matchMedia, so it renders the phone layout. Ports what SavedSpotsPage's
// tests covered (list, empty, errors, auth) and adds the new cards and sheet.

vi.mock("../../lib/api", () => ({
  listSpots: vi.fn(),
  renameSpot: vi.fn(),
  deleteSpot: vi.fn(),
  saveSpot: vi.fn(),
  // The Coach's conversations (docs/coach.md §10): none, unless a test says otherwise.
  listConversations: vi.fn(async () => ({ kind: "ok", conversations: [] })),
  renameConversation: vi.fn(),
  deleteConversation: vi.fn(),
}));
const mockList = vi.mocked(listSpots);
const mockRename = vi.mocked(renameSpot);
const mockDelete = vi.mocked(deleteSpot);
const mockSave = vi.mocked(saveSpot);
vi.mock("../../lib/auth", () => ({ useAuth: vi.fn() }));
const mockAuth = vi.mocked(useAuth);

const chart = {
  id: "c1",
  name: "BTN open · standard",
  positions_in_hand: ["BTN"],
  effective_stack_bb: 100,
  current_street: "preflop",
  actions: [],
  ranges: { BTN: { AA: 1, KK: 1 } },
  created_at: "2026-10-07T12:00:00Z",
} as unknown as Spot;

const unnamedDefend = {
  id: "c2",
  positions_in_hand: ["BB"],
  effective_stack_bb: 40,
  current_street: "preflop",
  actions: [{ position: "CO", street: "preflop", action: "raise" }],
} as unknown as Spot;

const setup = {
  id: "s1",
  name: "BB vs BTN on Q♠ 5♣ 2♣",
  positions_in_hand: ["BB", "BTN"],
  effective_stack_bb: 97.5,
  pot_bb: 5.5,
  board: ["Qs", "5c", "2c"],
  current_street: "flop",
  actions: [],
  ranges: { BB: { KJo: 1 }, BTN: { AA: 1 } },
  created_at: "2026-10-19T12:00:00Z",
} as unknown as Spot;

beforeEach(() => {
  mockList.mockReset();
  vi.mocked(listConversations).mockResolvedValue({ kind: "ok", conversations: [] });
  mockRename.mockReset();
  mockDelete.mockReset();
  mockSave.mockReset();
  mockAuth.mockReturnValue({ status: "signed-in", email: "hero@example.com" });
  mockList.mockResolvedValue({ kind: "ok", spots: [chart, unnamedDefend, setup] });
});

/** Where the router is, read back by tests. */
let where = { pathname: "", state: null as unknown };
function LocationSpy() {
  const location = useLocation();
  useEffect(() => {
    where = { pathname: location.pathname, state: location.state };
  }, [location]);
  return null;
}

function Page({ onAccount = () => {} }: { onAccount?: () => void }) {
  return (
    <MemoryRouter initialEntries={["/library"]}>
      <AccountSheetContext.Provider value={onAccount}>
        <Routes>
          <Route path="/library" element={<LibraryPage />} />
          <Route path="*" element={null} />
        </Routes>
        <LocationSpy />
      </AccountSheetContext.Provider>
    </MemoryRouter>
  );
}

const card = (name: RegExp) => screen.getByRole("button", { name });

describe("phone Library -- the list", () => {
  it("lists saved spots as cards, by name or a readable summary", async () => {
    render(<Page />);
    expect(await screen.findByRole("button", { name: /BTN open · standard/ })).toHaveTextContent("PreflopBTN · 100bb · Oct 7");
    expect(card(/BB.*40bb, facing a raise from CO/)).toBeInTheDocument();
    expect(card(/BB vs BTN on Q/)).toHaveTextContent("PostflopBB vs BTN · 97.5bb · Oct 19");
    expect(screen.getByText("Only you can see your saved spots and conversations.")).toBeInTheDocument();
  });

  it("searches and filters", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await screen.findByRole("button", { name: /BTN open/ });
    await user.click(screen.getByRole("button", { name: "Postflop" }));
    expect(screen.queryByRole("button", { name: /BTN open/ })).not.toBeInTheDocument();
    expect(card(/BB vs BTN on Q/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "All" }));
    await user.type(screen.getByLabelText(/search by name/i), "CO");
    expect(card(/facing a raise from CO/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /BTN open/ })).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText(/search by name/i));
    await user.type(screen.getByLabelText(/search by name/i), "zzz");
    expect(screen.getByText("Nothing matches that search.")).toBeInTheDocument();
  });

  it("shows a specific empty state, not a blank list", async () => {
    mockList.mockResolvedValue({ kind: "ok", spots: [] });
    render(<Page />);
    expect(await screen.findByRole("heading", { name: "Nothing saved yet" })).toBeInTheDocument();
    expect(screen.getByText(/Save a chart from Ranges or a setup from Solve, or ask the Coach/)).toBeInTheDocument();
  });

  it("distinguishes an unreachable server from an unexpected response", async () => {
    mockList.mockResolvedValueOnce({ kind: "network-error" });
    const { unmount } = render(<Page />);
    expect(await screen.findByText(/couldn.t reach the server/i)).toBeInTheDocument();
    unmount();

    mockList.mockResolvedValueOnce({ kind: "error", status: 500 });
    render(<Page />);
    expect(await screen.findByText(/HTTP 500/)).toBeInTheDocument();
  });
});

describe("phone Library -- signing in", () => {
  it("signed out: says where saved spots live and opens the account sheet, without calling the API", async () => {
    mockAuth.mockReturnValue({ status: "signed-out", email: null });
    const onAccount = vi.fn();
    const user = userEvent.setup();
    render(<Page onAccount={onAccount} />);
    expect(screen.getByRole("heading", { name: "Your saved spots live here" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onAccount).toHaveBeenCalled();
    expect(mockList).not.toHaveBeenCalled();
  });

  it("waits for auth to resolve before fetching", () => {
    mockAuth.mockReturnValue({ status: "loading", email: null });
    render(<Page />);
    expect(screen.getByText(/loading your spots/i)).toBeInTheDocument();
    expect(mockList).not.toHaveBeenCalled();
  });

  it("fetches once signed in, and again on an account switch", async () => {
    mockAuth.mockReturnValue({ status: "signed-out", email: null });
    mockList.mockResolvedValue({ kind: "ok", spots: [chart] });
    const { rerender } = render(<Page />);
    expect(mockList).not.toHaveBeenCalled();

    mockAuth.mockReturnValue({ status: "signed-in", email: "hero@example.com" });
    rerender(<Page />);
    expect(await screen.findByRole("button", { name: /BTN open/ })).toBeInTheDocument();

    mockList.mockResolvedValue({ kind: "ok", spots: [unnamedDefend] });
    mockAuth.mockReturnValue({ status: "signed-in", email: "villain@example.com" });
    rerender(<Page />);
    expect(await screen.findByRole("button", { name: /facing a raise from CO/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /BTN open/ })).not.toBeInTheDocument();
    expect(mockList).toHaveBeenCalledTimes(2);
  });
});

describe("phone Library -- a spot's sheet", () => {
  it("previews a chart and opens it in Ranges", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(await screen.findByRole("button", { name: /BTN open/ }));
    const sheet = screen.getByRole("dialog", { name: /BTN open · standard/ });
    expect(within(sheet).getByText("0.9% of hands")).toBeInTheDocument();
    expect(within(sheet).getByText("12 combos")).toBeInTheDocument();

    await user.click(within(sheet).getByRole("button", { name: "Open in Ranges" }));
    expect(where.pathname).toBe("/ranges");
    expect(where.state).toEqual({ spot: chart });
  });

  it("previews a setup's board and opens it in Solve", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(await screen.findByRole("button", { name: /BB vs BTN on Q/ }));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByRole("img", { name: "Q of spades" })).toBeInTheDocument();
    expect(within(sheet).getByText(/saved setup only/i)).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Open in Solve" }));
    expect(where.pathname).toBe("/solve");
  });

  it("renames a spot", async () => {
    mockRename.mockResolvedValue({ kind: "renamed", spot: { ...chart, name: "BTN wide" } });
    const user = userEvent.setup();
    render(<Page />);
    await user.click(await screen.findByRole("button", { name: /BTN open/ }));
    await user.click(screen.getByRole("button", { name: "Rename" }));
    await user.clear(screen.getByLabelText("New name"));
    await user.type(screen.getByLabelText("New name"), "BTN wide");
    await user.click(screen.getByRole("button", { name: "Save name" }));
    expect(mockRename).toHaveBeenCalledWith("c1", "BTN wide");
    expect(screen.getByRole("dialog", { name: /BTN wide/ })).toBeInTheDocument();
    expect(card(/BTN wide/)).toBeInTheDocument();
  });

  it("duplicates a spot and shows the copy", async () => {
    mockSave.mockResolvedValue({ kind: "saved", spot: { ...chart, id: "c9", name: "BTN open · standard (copy)" } });
    const user = userEvent.setup();
    render(<Page />);
    await user.click(await screen.findByRole("button", { name: /BTN open/ }));
    await user.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ name: "BTN open · standard (copy)" }));
    expect(await screen.findByRole("dialog", { name: /\(copy\)/ })).toBeInTheDocument();
  });

  it("deletes only after confirming", async () => {
    mockDelete.mockResolvedValue({ kind: "deleted" });
    const user = userEvent.setup();
    render(<Page />);
    await user.click(await screen.findByRole("button", { name: /BTN open/ }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(mockDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: /delete BTN open/i })).toHaveTextContent(/can.t be undone/);
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    expect(mockDelete).toHaveBeenCalledWith("c1");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /BTN open/ })).not.toBeInTheDocument();
  });

  it("says why an action failed", async () => {
    mockDelete.mockResolvedValue({ kind: "network-error" });
    const user = userEvent.setup();
    render(<Page />);
    await user.click(await screen.findByRole("button", { name: /BTN open/ }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(/couldn.t delete it/i);
  });
});

// --- Coach conversations in the Library (docs/coach.md §10) ---------------------

describe("phone Library -- Coach conversations", () => {
  const conversation = {
    id: "conv-1",
    title: "KK in a three-way pot",
    preview: "I can't solve this one exactly",
    updated_at: "2026-10-30T09:41:00Z",
    status: "idle",
  } as const;

  beforeEach(() => {
    vi.mocked(listConversations).mockResolvedValue({ kind: "ok", conversations: [{ ...conversation }] });
  });

  it("shows a conversation card, and its sheet opens it in the Coach", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(await screen.findByRole("button", { name: /KK in a three-way pot.*Conversation/ }));
    const sheet = screen.getByRole("dialog");
    expect(sheet).toHaveTextContent("I can't solve this one exactly");
    expect(within(sheet).queryByRole("button", { name: "Duplicate" })).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Open in Coach" }));
    expect(where.pathname).toBe("/coach/conv-1");
  });

  it("the Chats filter (Conversations, shortened for a phone) shows only conversations", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await screen.findByRole("button", { name: /KK in a three-way pot/ });
    await user.click(screen.getByRole("button", { name: "Chats" }));
    expect(screen.queryByRole("button", { name: /BTN open · standard/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /KK in a three-way pot/ })).toBeInTheDocument();
  });

  it("deletes a conversation only after confirming", async () => {
    const user = userEvent.setup();
    vi.mocked(deleteConversation).mockResolvedValue({ kind: "deleted" });
    render(<Page />);
    await user.click(await screen.findByRole("button", { name: /KK in a three-way pot/ }));
    const sheet = screen.getByRole("dialog");
    await user.click(within(sheet).getByRole("button", { name: "Delete" }));
    expect(deleteConversation).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    expect(deleteConversation).toHaveBeenCalledWith("conv-1");
    expect(screen.queryByRole("button", { name: /KK in a three-way pot/ })).not.toBeInTheDocument();
  });
});
