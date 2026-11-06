import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { CoachPage } from "./CoachPage";
import {
  createConversation,
  getCoachUsage,
  getConversation,
  listConversations,
  sendCoachMessage,
  type CoachConversation,
  type CoachMessage,
} from "../../lib/api";
import { useAuth } from "../../lib/auth";
import {
  AccountSheetContext,
  CoachBadgeContext,
  PageActiveContext,
  TopBarSlotContext,
  TopBarTitleContext,
  type TopBarTitleOverride,
} from "../../lib/mobileShell";

vi.mock("../../lib/api", () => ({
  createConversation: vi.fn(),
  getCoachUsage: vi.fn(),
  getConversation: vi.fn(),
  listConversations: vi.fn(),
  sendCoachMessage: vi.fn(),
}));
vi.mock("../../lib/auth", () => ({ useAuth: vi.fn() }));

const mockCreate = vi.mocked(createConversation);
const mockUsage = vi.mocked(getCoachUsage);
const mockGet = vi.mocked(getConversation);
const mockList = vi.mocked(listConversations);
const mockSend = vi.mocked(sendCoachMessage);
const mockUseAuth = vi.mocked(useAuth);

const SPOT_CARD = {
  spot: {
    positions_in_hand: ["BB", "BTN"],
    effective_stack_bb: 100,
    pot_bb: 5.5,
    board: ["Qs", "5c", "2c"],
    current_street: "flop",
    actions: [],
    ranges: {},
  },
  hero_position: "BTN",
  hero_hand: "AhQd",
  facts: [{ k: "You", v: "BTN (acts last)" }],
  assumptions: [],
};

function msg(seq: number, kind: string, payload: Record<string, unknown>): CoachMessage {
  return { seq, kind, payload, created_at: "2026-11-05T09:41:00Z" };
}

function conversation(messages: CoachMessage[], status: CoachConversation["status"] = "idle"): CoachConversation {
  return { id: "c1", title: "AQ on the button, Q-5-2 flop", status, messages };
}

let titles: (TopBarTitleOverride | null)[] = [];
let badges: (string | null)[] = [];
let openAccount: ReturnType<typeof vi.fn<() => void>>;

/** The phone shell's contexts, as App provides them. */
function Shell({ children, active = true }: { children: ReactNode; active?: boolean }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <AccountSheetContext.Provider value={openAccount}>
      <CoachBadgeContext.Provider value={(b) => badges.push(b)}>
        <TopBarTitleContext.Provider value={(t) => titles.push(t)}>
          <TopBarSlotContext.Provider value={slot}>
            <PageActiveContext.Provider value={active}>
              <div data-testid="top-bar" ref={setSlot} />
              {children}
            </PageActiveContext.Provider>
          </TopBarSlotContext.Provider>
        </TopBarTitleContext.Provider>
      </CoachBadgeContext.Provider>
    </AccountSheetContext.Provider>
  );
}

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function renderAt(path: string, active = true) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Shell active={active}>
        <Routes>
          <Route path="/coach" element={<CoachPage />} />
          <Route path="/coach/:conversationId" element={<CoachPage />} />
          <Route path="/solve" element={null} />
        </Routes>
        <Where />
      </Shell>
    </MemoryRouter>,
  );
}

const lastTitle = () => titles.at(-1);
const where = () => screen.getByTestId("where").textContent;

beforeEach(() => {
  vi.resetAllMocks();
  titles = [];
  badges = [];
  openAccount = vi.fn<() => void>();
  mockUseAuth.mockReturnValue({ status: "signed-in", email: "p@example.com" } as ReturnType<typeof useAuth>);
  mockList.mockResolvedValue({
    kind: "ok",
    conversations: [{ id: "c1", title: "AQ on the button, Q-5-2 flop", preview: "Bet small", updated_at: "2026-11-05T09:41:00Z", status: "idle" }],
  });
  mockUsage.mockResolvedValue({
    kind: "ok",
    usage: { used: 2, limit: 20, resets_at: "2026-11-05T10:41:00Z", all_users_exhausted: false },
  });
});

describe("CoachPhone", () => {
  it("opens on the empty state, not the most recent conversation", async () => {
    renderAt("/coach");
    expect(await screen.findByText("What spot are you studying?")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^“/ })).toHaveLength(3); // the mockup's three starters
    expect(where()).toBe("/coach");
    expect(mockGet).not.toHaveBeenCalled();
    expect(await screen.findByText(/18 messages left this hour/)).toBeInTheDocument();
  });

  it("a starter fills the box; the history button opens the saved conversations", async () => {
    const user = userEvent.setup();
    renderAt("/coach");
    await user.click(await screen.findByRole("button", { name: /Why does the solver check/ }));
    expect(screen.getByLabelText("Your message")).toHaveValue("Why does the solver check so many strong hands?");

    const topBar = screen.getByTestId("top-bar");
    await user.click(within(topBar).getByRole("button", { name: "Saved conversations" }));
    expect(where()).toBe("/coach/saved");
    expect(lastTitle()?.title).toBe("Saved conversations");
    expect(await screen.findByRole("link", { name: /AQ on the button, Q-5-2 flop/ })).toHaveAttribute("href", "/coach/c1");
  });

  it("the saved list searches, starts a new conversation, and goes back", async () => {
    const user = userEvent.setup();
    renderAt("/coach/saved");
    await screen.findByRole("link", { name: /AQ on the button/ });
    await user.type(screen.getByLabelText("Search conversations"), "zzz");
    expect(screen.getByText("No conversations match.")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "New conversation" }));
    expect(where()).toBe("/coach");
  });

  it("a conversation titles the top bar, with a way back to the saved list", async () => {
    mockGet.mockResolvedValue({ kind: "ok", conversation: conversation([msg(1, "user_text", { text: "hi" })]) });
    renderAt("/coach/c1");
    await screen.findByText("hi");
    await waitFor(() => expect(lastTitle()?.title).toBe("AQ on the button, Q-5-2 flop"));
    lastTitle()!.onBack();
    await waitFor(() => expect(where()).toBe("/coach/saved"));
  });

  it("shows the spot card as one row that opens", async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue({ kind: "ok", conversation: conversation([msg(1, "spot_card", SPOT_CARD)]) });
    renderAt("/coach/c1");
    const toggle = await screen.findByRole("button", { name: "The spot I understood" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("img", { name: "A of hearts" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open in Solve" })).toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByRole("img", { name: "A of hearts" })).toBeInTheDocument();
  });

  it("Enter is a new line on a phone; the send button sends", async () => {
    const user = userEvent.setup();
    mockCreate.mockResolvedValue({ kind: "created", id: "c9" });
    mockSend.mockResolvedValue({ kind: "sent", lastSeq: 1 });
    mockGet.mockResolvedValue({ kind: "ok", conversation: conversation([], "working") });
    renderAt("/coach");
    const box = await screen.findByLabelText("Your message");
    await user.type(box, "line one{Enter}line two");
    expect(box).toHaveValue("line one\nline two");
    expect(mockCreate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(mockSend).toHaveBeenCalledWith("c9", "line one\nline two", undefined);
    expect(where()).toBe("/coach/c9");
  });

  it("Add cards picks rank then suit, and adds them to the message", async () => {
    const user = userEvent.setup();
    renderAt("/coach");
    await user.click(await screen.findByRole("button", { name: "Add cards" }));
    const sheet = screen.getByRole("dialog", { name: "Add cards" });
    const rank = (r: string) => within(within(sheet).getByRole("group", { name: "Rank" })).getByRole("button", { name: r });
    const suit = (s: RegExp) => within(within(sheet).getByRole("group", { name: "Suit" })).getByRole("button", { name: s });
    await user.click(rank("A"));
    await user.click(suit(/hearts/i));
    await user.click(rank("Q"));
    await user.click(suit(/diamonds/i));
    expect(within(sheet).getByText(/Your hand: A♥ Q♦/)).toBeInTheDocument();
    await user.click(rank("K"));
    await user.click(suit(/spades/i)); // a third card for a hand is ignored
    expect(within(sheet).getByText(/Your hand: A♥ Q♦/)).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(screen.getByLabelText("Your message")).toHaveValue("my hand: A♥ Q♦");
  });

  it("pastes a hand history from the cards sheet's link", async () => {
    const user = userEvent.setup();
    renderAt("/coach");
    await user.click(await screen.findByRole("button", { name: "Add cards" }));
    await user.click(screen.getByRole("button", { name: "Paste a hand history instead" }));
    const sheet = await screen.findByRole("dialog", { name: "Paste a hand history" });
    await user.click(within(sheet).getByLabelText("Hand history"));
    await user.paste("not a hand history");
    await user.click(within(sheet).getByRole("button", { name: "Attach hand" }));
    expect(within(sheet).getByRole("alert")).toHaveTextContent(/send it as text/);
  });

  it("puts a dot on the Coach tab while it answers behind another tab, and when an answer is unseen", async () => {
    mockGet.mockResolvedValue({ kind: "ok", conversation: conversation([msg(1, "user_text", { text: "hi" })], "working") });
    const { unmount } = renderAt("/coach/c1", false);
    await waitFor(() => expect(badges.at(-1)).toBe("answering"));
    unmount();

    // Seen: on the Coach tab, a finished conversation has no dot.
    badges = [];
    mockGet.mockResolvedValue({ kind: "ok", conversation: conversation([msg(1, "user_text", { text: "hi" })]) });
    renderAt("/coach/c1", true);
    await screen.findByText("hi");
    expect(badges.filter(Boolean)).toEqual([]);
  });

  it("signed out, Sign in opens the account sheet", async () => {
    const user = userEvent.setup();
    mockUseAuth.mockReturnValue({ status: "signed-out" } as ReturnType<typeof useAuth>);
    renderAt("/coach");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(openAccount).toHaveBeenCalled();
    expect(mockList).not.toHaveBeenCalled();
  });
});
