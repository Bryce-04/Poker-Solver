import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { CoachPage } from "./CoachPage";
import { POLL_MS } from "./useCoach";
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

let seq = 0;
function msg(kind: string, payload: Record<string, unknown>): CoachMessage {
  seq += 1;
  return { seq, kind, payload, created_at: "2026-11-05T09:41:00Z" };
}

const SPOT_CARD = {
  spot: {
    positions_in_hand: ["BB", "BTN"],
    effective_stack_bb: 100,
    pot_bb: 5.5,
    board: ["Qs", "5c", "2c"],
    current_street: "flop",
    actions: [
      { position: "BTN", street: "preflop", action: "raise", size_bb: 2.5 },
      { position: "BB", street: "preflop", action: "call" },
      { position: "BB", street: "flop", action: "check" },
    ],
    ranges: {},
  },
  hero_position: "BTN",
  hero_hand: "AhQd",
  facts: [
    { k: "You", v: "BTN (acts last)" },
    { k: "Opponent", v: "BB (checked)" },
    { k: "Pot", v: "5.5bb" },
    { k: "Stacks", v: "97.5bb" },
  ],
  assumptions: ["100bb stacks", "a 2.5bb open"],
};
const RESULT_CARD = {
  hero_hand: "AhQd",
  player: "BTN",
  whose: "hero",
  rows: [
    { action: "bet_small", label: "Bet small (1.38bb)", amount_bb: 1.38, freq: 0.55 },
    { action: "check", label: "Check", freq: 0.3 },
    { action: "bet_medium", label: "Bet medium (4.12bb)", amount_bb: 4.12, freq: 0.15 },
  ],
  range_rows: [{ action: "check", label: "Check", freq: 0.6 }],
  exploitability_pct: 0.3,
  converged: true,
  elapsed_s: 21.4,
  bucketed_actions: [],
  narrowed: [],
  notes: [],
};

function conversation(messages: CoachMessage[], status: CoachConversation["status"] = "idle"): CoachConversation {
  return { id: "c1", title: "AQ on the button, Q-5-2 flop", status, messages };
}

function Where() {
  const { pathname, state } = useLocation();
  return <output data-testid="where">{`${pathname} ${JSON.stringify(state)}`}</output>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/coach" element={<CoachPage />} />
        <Route path="/coach/:conversationId" element={<CoachPage />} />
        <Route path="/solve" element={<Where />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  seq = 0;
  // reset, not clear: a one-time answer a failed test never used must not leak into the next.
  vi.resetAllMocks();
  mockUseAuth.mockReturnValue({ status: "signed-in", email: "p@example.com" } as ReturnType<typeof useAuth>);
  mockList.mockResolvedValue({ kind: "ok", conversations: [] });
  mockUsage.mockResolvedValue({
    kind: "ok",
    usage: { used: 2, limit: 20, resets_at: "2026-11-05T10:41:00Z", all_users_exhausted: false },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CoachPage", () => {
  it("asks a signed-out user to sign in, and calls nothing", () => {
    mockUseAuth.mockReturnValue({ status: "signed-out" } as ReturnType<typeof useAuth>);
    renderAt("/coach");
    expect(screen.getByText("Sign in to use the Coach.")).toBeInTheDocument();
    expect(mockList).not.toHaveBeenCalled();
  });

  it("opens the most recent conversation from /coach", async () => {
    mockList.mockResolvedValue({
      kind: "ok",
      conversations: [{ id: "c1", title: "AQ on the button", preview: "Bet small", updated_at: "2026-11-05T09:41:00Z", status: "idle" }],
    });
    mockGet.mockResolvedValue({ kind: "ok", conversation: conversation([msg("user_text", { text: "hi" })]) });
    renderAt("/coach");
    await waitFor(() => expect(screen.getAllByTestId("where").at(-1)).toHaveTextContent("/coach/c1"));
    expect(await screen.findByText("hi")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /AQ on the button/ })).toHaveAttribute("aria-current", "page");
  });

  it("starts empty with starters that fill the box without sending", async () => {
    const user = userEvent.setup();
    renderAt("/coach");
    expect(await screen.findByText("What spot are you studying?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /BB here\. BTN raised/ }));
    expect(screen.getByLabelText("Your message")).toHaveValue("BB here. BTN raised to 2.5bb. Should I call with 7♠ 6♠?");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("shows how many messages are left this hour, and warns when few are", async () => {
    const { unmount } = renderAt("/coach/new");
    expect(await screen.findByText(/18 of 20 messages left this hour/)).toBeInTheDocument();
    unmount();
    mockUsage.mockResolvedValue({
      kind: "ok",
      usage: { used: 18, limit: 20, resets_at: "2026-11-05T10:41:00Z", all_users_exhausted: false },
    });
    renderAt("/coach/new");
    expect(await screen.findByText(/2 messages left this hour/)).toBeInTheDocument();
  });

  it("sends a first message: creates the conversation, then polls for the answer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockCreate.mockResolvedValue({ kind: "created", id: "c1" });
    mockSend.mockResolvedValue({ kind: "sent", lastSeq: 1 });
    const userText = msg("user_text", { text: "AQ on the button" });
    const reply = msg("coach_text", { paras: ["Bet small."], note: "The percentages come from the solver." });
    mockGet
      .mockResolvedValueOnce({ kind: "ok", conversation: conversation([userText], "working") })
      .mockResolvedValueOnce({ kind: "ok", conversation: conversation([reply], "idle") });

    renderAt("/coach/new");
    await screen.findByText("What spot are you studying?");
    await user.type(screen.getByLabelText("Your message"), "AQ on the button{Enter}");

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockSend).toHaveBeenCalledWith("c1", "AQ on the button", undefined);
    expect(screen.getByLabelText("Your message")).toHaveValue("");
    expect(await screen.findByText("AQ on the button")).toBeInTheDocument(); // shown before the server's copy
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(await screen.findByText("Bet small.")).toBeInTheDocument();
    expect(screen.getByText("The percentages come from the solver.")).toBeInTheDocument();
    expect(mockGet).toHaveBeenLastCalledWith("c1", 1); // only what's new
    expect(screen.getAllByText("AQ on the button")).toHaveLength(1);
  });

  it("Shift+Enter is a new line, not a send", async () => {
    const user = userEvent.setup();
    renderAt("/coach/new");
    await screen.findByText("What spot are you studying?");
    await user.type(screen.getByLabelText("Your message"), "line one{Shift>}{Enter}{/Shift}line two");
    expect(screen.getByLabelText("Your message")).toHaveValue("line one\nline two");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("renders every card from a finished conversation", async () => {
    mockGet.mockResolvedValue({
      kind: "ok",
      conversation: conversation([
        msg("user_text", { text: "AQ on the button, Q52, he checks" }),
        msg("coach_text", { paras: ["I'm assuming 100bb."] }),
        msg("spot_card", SPOT_CARD),
        msg("solving", { street: "flop", player: "BTN", started_at: 0 }),
        msg("result_card", RESULT_CARD),
        msg("coach_text", { paras: ["Bet small most of the time."] }),
        msg("general_advice", { paras: ["Be careful with flush draws."] }),
        msg("suggestions", { items: ["What if he bets?"] }),
      ]),
    });
    renderAt("/coach/c1");

    const spot = await screen.findByRole("region", { name: "The spot I understood" });
    expect(within(spot).getByRole("img", { name: "A of hearts" })).toBeInTheDocument();
    expect(within(spot).getByText("BTN (acts last)")).toBeInTheDocument();
    expect(within(spot).getByText("Assumed: 100bb stacks, a 2.5bb open")).toBeInTheDocument();

    const result = screen.getByRole("region", { name: "Solver result" });
    expect(within(result).getByText("Solver's play with A♥ Q♦")).toBeInTheDocument();
    expect(within(result).getByText("Very accurate · solved in 21s")).toBeInTheDocument();
    expect(within(result).getByText("Bet small (1.38bb)")).toBeInTheDocument();
    expect(within(result).getByText("55%")).toBeInTheDocument();

    expect(screen.getByText("General advice · not from the solver")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What if he bets?" })).toBeInTheDocument();
    // The solve finished, so its solving card is gone.
    expect(screen.queryByText(/Solving the BTN's flop decision/)).not.toBeInTheDocument();
  });

  it("shows a running solve, and says whose strategy an opponent's result is", async () => {
    mockGet.mockResolvedValueOnce({
      kind: "ok",
      conversation: conversation([msg("spot_card", SPOT_CARD), msg("solving", { street: "flop", player: "BTN", started_at: 0 })], "working"),
    });
    const { unmount } = renderAt("/coach/c1");
    expect(await screen.findByText("Solving the BTN's flop decision…")).toBeInTheDocument();
    expect(screen.getByText(/Usually 10–90 seconds/)).toBeInTheDocument();
    unmount();

    mockGet.mockResolvedValueOnce({
      kind: "ok",
      conversation: conversation([msg("result_card", { ...RESULT_CARD, whose: "villain", player: "BB", hero_hand: null })]),
    });
    renderAt("/coach/c1");
    expect(await screen.findByText("BB's play (it's their turn)")).toBeInTheDocument();
  });

  it("labels the charts' numbers as charts, not the solver", async () => {
    mockGet.mockResolvedValue({
      kind: "ok",
      conversation: conversation([
        msg("preflop_card", {
          hero_hand: "A5s",
          position: "UTG",
          situation: "Folded to you in UTG",
          rows: [{ action: "fold", label: "Fold", freq: 1 }],
          note: "From the app's reference charts (approximate, built from standard principles), not a solver run.",
        }),
      ]),
    });
    renderAt("/coach/c1");
    expect(await screen.findByText("The charts' play with A5s")).toBeInTheDocument();
    expect(screen.getByText(/not a solver run/)).toBeInTheDocument();
  });

  it("Edit starts a correction, and Open in Solve hands Solve the spot", async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue({ kind: "ok", conversation: conversation([msg("spot_card", SPOT_CARD)]) });
    renderAt("/coach/c1");
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Your message")).toHaveValue("Correction: ");
    await user.click(screen.getByRole("button", { name: "Open in Solve" }));
    const where = screen.getAllByTestId("where").at(-1)!;
    expect(where).toHaveTextContent(/^\/solve /);
    expect(JSON.parse(where.textContent!.replace("/solve ", ""))).toEqual({ spot: SPOT_CARD.spot });
  });

  it("a suggestion sends itself, and Try again resends the last message", async () => {
    const user = userEvent.setup();
    mockSend.mockResolvedValue({ kind: "sent", lastSeq: 9 });
    mockGet.mockResolvedValue({
      kind: "ok",
      conversation: conversation([
        msg("user_text", { text: "the first question" }),
        msg("suggestions", { items: ["What if he bets?"] }),
        msg("error", { kind: "gemini_busy", text: "The Coach is busy right now." }),
      ]),
    });
    renderAt("/coach/c1");
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    expect(mockSend).toHaveBeenLastCalledWith("c1", "the first question", undefined);
  });

  it("explains a busy Coach and the hourly limit instead of failing silently", async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue({ kind: "ok", conversation: conversation([msg("user_text", { text: "hi" })]) });
    mockSend.mockResolvedValueOnce({ kind: "busy" });
    renderAt("/coach/c1");
    await screen.findByText("hi");
    await user.type(screen.getByLabelText("Your message"), "again{Enter}");
    expect(await screen.findByText(/still answering/)).toBeInTheDocument();
    expect(screen.getByLabelText("Your message")).toHaveValue("again"); // kept, so it can be sent later

    mockSend.mockResolvedValueOnce({ kind: "limit", used: 20, limit: 20, allUsersExhausted: false });
    await user.type(screen.getByLabelText("Your message"), "{Enter}");
    expect(await screen.findByText("You've used all 20 messages for this hour. Try again in a little while.")).toBeInTheDocument();
  });

  it("attaches a pasted hand history as the spot the backend uses", async () => {
    const user = userEvent.setup();
    mockCreate.mockResolvedValue({ kind: "created", id: "c1" });
    mockSend.mockResolvedValue({ kind: "sent", lastSeq: 1 });
    mockGet.mockResolvedValue({ kind: "ok", conversation: conversation([], "working") });
    const history = [
      "PokerStars Hand #3:  Hold'em No Limit ($0.50/$1.00 USD) - 2024/01/01 12:00:00 ET",
      "Table 'Atlas' 6-max Seat #1 is the button",
      "Seat 1: Dave ($100 in chips)",
      "Seat 2: Eve ($100 in chips)",
      "Seat 3: Hero ($100 in chips)",
      "Seat 4: Alice ($100 in chips)",
      "Seat 5: Grace ($100 in chips)",
      "Seat 6: Frank ($100 in chips)",
      "Eve: posts small blind $0.50",
      "Hero: posts big blind $1",
      "*** HOLE CARDS ***",
      "Dealt to Hero [7h 7s]",
      "Alice: folds",
      "Grace: folds",
      "Frank: folds",
      "Dave: raises $2 to $3",
      "Eve: folds",
      "Hero: calls $2",
      "*** FLOP *** [2h 7d Jc]",
      "Hero: checks",
      "",
    ].join("\n");

    renderAt("/coach/new");
    await screen.findByText("What spot are you studying?");
    await user.click(screen.getByRole("button", { name: "Paste hand history" }));
    const dialog = screen.getByRole("dialog", { name: "Paste a hand history" });
    await user.click(within(dialog).getByLabelText("Hand history"));
    await user.paste(history);
    await user.click(within(dialog).getByRole("button", { name: "Attach hand" }));
    expect(screen.getByText("Hand history attached: BB vs BTN, 2♥ 7♦ J♣")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Your message"), "I was the BB. Was checking right?{Enter}");
    const [, text, attached] = mockSend.mock.calls[0];
    expect(text).toMatch(/^I was the BB\. Was checking right\?\n\nHand history:\nPokerStars Hand #3/);
    expect(attached).toMatchObject({
      positions_in_hand: ["BB", "BTN"],
      pot_bb: 6.5,
      board: ["2h", "7d", "Jc"],
      actions: [{ position: "BB", street: "flop", action: "check" }],
    });
  });

  it("filters the saved conversations by search", async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValue({
      kind: "ok",
      conversations: [
        { id: "c1", title: "AQ on the button", preview: "Bet small", updated_at: "2026-11-05T09:41:00Z", status: "idle" },
        { id: "c2", title: "KK in a three-way pot", preview: "I can't solve", updated_at: "2026-11-04T09:41:00Z", status: "idle" },
      ],
    });
    mockGet.mockResolvedValue({ kind: "ok", conversation: conversation([]) });
    renderAt("/coach/c1");
    await screen.findByRole("link", { name: /KK in a three-way pot/ });
    await user.type(screen.getByLabelText("Search conversations"), "three");
    expect(screen.queryByRole("link", { name: /AQ on the button/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /KK in a three-way pot/ })).toBeInTheDocument();
  });
});
