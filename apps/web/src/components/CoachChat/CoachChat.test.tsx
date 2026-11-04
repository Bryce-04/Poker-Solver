import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoachChatOutcome, CoachContext } from "../../lib/api";
import { streamCoach } from "../../lib/api";
import { CoachChat, coachFailureText } from "./CoachChat";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  streamCoach: vi.fn(),
}));
let mockAuth: { status: string; email: string | null } = { status: "signed-in", email: "a@b.c" };
vi.mock("../../lib/auth", () => ({ useAuth: () => mockAuth }));

const chat = vi.mocked(streamCoach);
const CONTEXT: CoachContext = {
  lesson_title: "Poker Drill",
  prompt: "You are BB.",
  board: ["Ks", "7h", "2d"],
  hand: ["Ah", "Kh"],
  picked: "Check",
  correct: "Bet 1.8bb (33%) (the solver's most frequent action)",
  explanation: "The solver's mix for this exact hand: Bet 1.8bb (33%): 80%, Check: 20%.",
};
const SUGGESTIONS = ["Was Check really a mistake?", "Explain it like I'm new to poker."];

/** A coach that streams `pieces`, then finishes with `outcome`. */
function answers(pieces: string[], outcome: CoachChatOutcome = { kind: "done", fallback: null }) {
  chat.mockImplementationOnce(async (_ctx, _msgs, onDelta) => {
    pieces.forEach(onDelta);
    return outcome;
  });
}

describe("CoachChat", () => {
  beforeEach(() => {
    chat.mockReset();
    mockAuth = { status: "signed-in", email: "a@b.c" };
  });

  it("asks nothing until the button is pressed, then shows the streamed explanation", async () => {
    answers(["You hold ", "top pair."]);
    const user = userEvent.setup();
    render(<CoachChat context={CONTEXT} suggestions={SUGGESTIONS} />);
    expect(chat).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /ask the coach to explain/i }));
    expect(await screen.findByText("You hold top pair.")).toBeInTheDocument();
    expect(chat.mock.calls[0][0]).toEqual(CONTEXT);
    expect(chat.mock.calls[0][1]).toEqual([]); // no history: the first explanation
    expect(screen.getByText(/the solver, not the AI, decides/i)).toBeInTheDocument();
  });

  it("shows words as they arrive, before the answer is finished", async () => {
    let push!: (t: string) => void;
    let finish!: (o: CoachChatOutcome) => void;
    chat.mockImplementationOnce(
      (_c, _m, onDelta) =>
        new Promise<CoachChatOutcome>((resolve) => {
          push = onDelta;
          finish = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<CoachChat context={CONTEXT} suggestions={SUGGESTIONS} />);
    await user.click(screen.getByRole("button", { name: /ask the coach to explain/i }));
    expect(screen.getByText("Thinking…")).toBeInTheDocument();
    push("Top pair, ");
    expect(await screen.findByText("Top pair,")).toBeInTheDocument();
    finish({ kind: "done", fallback: null });
    await waitFor(() => expect(screen.getByRole("textbox")).toBeEnabled());
  });

  it("offers suggested questions once answered, and sends one with the history", async () => {
    answers(["First answer."]);
    answers(["Because the range is weak."]);
    const user = userEvent.setup();
    render(<CoachChat context={CONTEXT} suggestions={SUGGESTIONS} />);
    await user.click(screen.getByRole("button", { name: /ask the coach to explain/i }));
    await user.click(await screen.findByRole("button", { name: SUGGESTIONS[0] }));
    expect(await screen.findByText("Because the range is weak.")).toBeInTheDocument();
    expect(chat.mock.calls[1][1]).toEqual([
      { role: "assistant", content: "First answer." },
      { role: "user", content: SUGGESTIONS[0] },
    ]);
    // The question you asked stays in the transcript, and its chip is gone.
    expect(screen.getAllByText(SUGGESTIONS[0])).toHaveLength(1);
    expect(screen.queryByRole("button", { name: SUGGESTIONS[0] })).toBeNull();
  });

  it("sends a typed question, including Space and Enter, and clears the box", async () => {
    answers(["First."]);
    answers(["Second."]);
    const user = userEvent.setup();
    render(<CoachChat context={CONTEXT} suggestions={[]} />);
    await user.click(screen.getByRole("button", { name: /ask the coach to explain/i }));
    const box = await screen.findByRole("textbox", { name: /ask the coach a question/i });
    await user.type(box, "why not bet bigger{Enter}");
    expect(await screen.findByText("Second.")).toBeInTheDocument();
    expect(chat.mock.calls[1][1].at(-1)).toEqual({ role: "user", content: "why not bet bigger" });
    expect(box).toHaveValue("");
  });

  it("won't send an empty question", async () => {
    answers(["First."]);
    const user = userEvent.setup();
    render(<CoachChat context={CONTEXT} suggestions={[]} />);
    await user.click(screen.getByRole("button", { name: /ask the coach to explain/i }));
    await screen.findByText("First.");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("on a failed first answer shows the reason and lets you try again", async () => {
    answers([], { kind: "network-error" });
    answers(["Second time works."]);
    const user = userEvent.setup();
    render(<CoachChat context={CONTEXT} suggestions={[]} />);
    await user.click(screen.getByRole("button", { name: /ask the coach to explain/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t reach the server/i);
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByText("Second time works.")).toBeInTheDocument();
  });

  it("on a failed follow-up keeps the transcript and gives the question back to re-send", async () => {
    answers(["First."]);
    answers([], { kind: "interrupted" });
    const user = userEvent.setup();
    render(<CoachChat context={CONTEXT} suggestions={[]} />);
    await user.click(screen.getByRole("button", { name: /ask the coach to explain/i }));
    const box = await screen.findByRole("textbox");
    await user.type(box, "and now?{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(/stopped partway/i);
    expect(screen.getByText("First.")).toBeInTheDocument();
    expect(box).toHaveValue("and now?");
  });

  it("shows the app's own explanation with a note, never the 'AI-written' line, when the coach can't answer", async () => {
    answers(["The solver's mix for this exact hand."], { kind: "done", fallback: "rate_limited" });
    const user = userEvent.setup();
    render(<CoachChat context={CONTEXT} suggestions={SUGGESTIONS} />);
    await user.click(screen.getByRole("button", { name: /ask the coach to explain/i }));
    expect(await screen.findByText("The solver's mix for this exact hand.")).toBeInTheDocument();
    expect(screen.getByText(/asked a lot of questions this hour/i)).toBeInTheDocument();
    expect(screen.queryByText(/ai-written/i)).toBeNull();
    // ...and you can still ask something; the history sent leaves the note out.
    answers(["Real answer."]);
    await user.click(screen.getByRole("button", { name: SUGGESTIONS[0] }));
    expect(await screen.findByText("Real answer.")).toBeInTheDocument();
    expect(chat.mock.calls[1][1][0]).toEqual({ role: "assistant", content: "The solver's mix for this exact hand." });
  });

  it("stops accepting questions at the server's limit", async () => {
    answers(["a0"]);
    const user = userEvent.setup();
    render(<CoachChat context={CONTEXT} suggestions={[]} />);
    await user.click(screen.getByRole("button", { name: /ask the coach to explain/i }));
    await screen.findByText("a0");
    for (let i = 1; i <= 6; i++) {
      answers([`a${i}`]);
      await user.type(screen.getByRole("textbox"), `q${i}{Enter}`);
      await screen.findByText(`a${i}`);
    }
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText(/that.s the limit for this hand/i)).toBeInTheDocument();
  });

  it("doesn't call the server when signed out, and says to sign in", () => {
    mockAuth = { status: "signed-out", email: null };
    render(<CoachChat context={CONTEXT} suggestions={SUGGESTIONS} />);
    expect(screen.getByText(/sign in to ask the ai coach/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(chat).not.toHaveBeenCalled();
  });

  it("words every failure", () => {
    expect(coachFailureText({ kind: "signed-out" })).toMatch(/sign in/i);
    expect(coachFailureText({ kind: "interrupted" })).toMatch(/partway/i);
    expect(coachFailureText({ kind: "network-error" })).toMatch(/connection/i);
    expect(coachFailureText({ kind: "error", status: 500 })).toMatch(/500/);
  });
});
