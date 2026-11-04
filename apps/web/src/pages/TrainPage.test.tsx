import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TrainPage } from "./TrainPage";
import { LESSONS, readProgress } from "../lib/lessons";
import { askCoach } from "../lib/api";
import { useAuth } from "../lib/auth";

vi.mock("../lib/api", () => ({ askCoach: vi.fn() }));
vi.mock("../lib/auth", () => ({ useAuth: vi.fn() }));
const mockAsk = vi.mocked(askCoach);
const mockUseAuth = vi.mocked(useAuth);

function renderTrain(path = "/train") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TrainPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  mockAsk.mockReset();
  mockUseAuth.mockReset();
  mockUseAuth.mockReturnValue({ status: "signed-in", email: "a@b.c" });
});

describe("Train hub", () => {
  it("lists every lesson, links to the full-screen Drill, and shows what is coming", () => {
    renderTrain();
    for (const lesson of LESSONS) {
      expect(screen.getByRole("button", { name: new RegExp(lesson.title, "i") })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: /^drill/i }).getAttribute("href")).toBe("/drill");
    expect(screen.getByText(/ranked play/i)).toBeInTheDocument();
    expect(screen.getByText(/playing different opponents/i)).toBeInTheDocument();
  });

  it("opens a lesson straight from ?lesson=", () => {
    renderTrain("/train?lesson=positions");
    expect(screen.getByRole("heading", { name: /six seats, one button/i })).toBeInTheDocument();
  });
});

describe("Opening-hands lesson", () => {
  async function toFirstHand(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /^next$/i })); // the one reading card
  }

  it("shows the hand's two cards and grades a fold and a raise from the range data", async () => {
    const user = userEvent.setup();
    renderTrain("/train?lesson=opening-hands");
    await toFirstHand(user);

    // First hand is AQo from UTG: a raise.
    expect(screen.getByRole("img", { name: /^A of spades$/i })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /^Q of hearts$/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^fold$/i }));
    expect(screen.getByText(/not quite/i)).toBeInTheDocument();
    expect(screen.getByText(/AQo is in the UTG opening range/i)).toBeInTheDocument();
    expect(screen.getByText(/answer:/i).parentElement).toHaveTextContent(/raise to 2.5bb/i);
  });

  it("is on the hub as its own lesson", () => {
    renderTrain();
    expect(screen.getByRole("button", { name: /which hands to open/i })).toBeInTheDocument();
  });
});

describe("Continuation-bet lesson", () => {
  it("shows the flop and your hand, and grades against the solver's frequency", async () => {
    const user = userEvent.setup();
    renderTrain("/train?lesson=continuation-bets");
    await user.click(screen.getByRole("button", { name: /^next$/i }));

    expect(screen.getByLabelText(/the flop/i).querySelectorAll('[role="img"]')).toHaveLength(3);
    expect(screen.getByLabelText(/your hand/i).querySelectorAll('[role="img"]')).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: /^bet$/i }));
    expect(screen.getByText(/the solver bets this hand \d+% of the time/i)).toBeInTheDocument();
  });
});

describe("Lesson player", () => {
  async function toFirstQuiz(user: ReturnType<typeof userEvent.setup>) {
    // Positions has three reading cards, then the questions.
    for (let i = 0; i < 3; i++) await user.click(screen.getByRole("button", { name: /^next$/i }));
  }

  it("grades an answer, explains it, and shows the right answer after a miss", async () => {
    const user = userEvent.setup();
    renderTrain("/train?lesson=positions");
    await toFirstQuiz(user);

    await user.click(screen.getByRole("button", { name: /^the button$/i }));
    expect(screen.getByText(/not quite/i)).toBeInTheDocument();
    expect(screen.getByText(/the button acts last after the flop/i)).toBeInTheDocument();
    expect(screen.getByText(/answer:/i).parentElement).toHaveTextContent(/the small blind/i);
    // Locked once answered.
    expect(screen.getByRole("button", { name: /^the small blind$/i })).toBeDisabled();
  });

  it("finishes, tells you the score and remembers it", async () => {
    const user = userEvent.setup();
    renderTrain("/train?lesson=positions");
    await toFirstQuiz(user);

    // Answer the three questions: right, wrong, right.
    await user.click(screen.getByRole("button", { name: /^the small blind$/i }));
    expect(screen.getByText(/^right\.$/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^next$/i }));

    await user.click(screen.getByRole("button", { name: /^the small blind$/i })); // wrong preflop
    await user.click(screen.getByRole("button", { name: /^next$/i }));

    await user.click(screen.getByRole("button", { name: /it acts last after the flop/i }));
    await user.click(screen.getByRole("button", { name: /^finish$/i }));

    expect(screen.getByText(/you got 2 of 3 questions right/i)).toBeInTheDocument();
    expect(readProgress().positions).toEqual({ done: true, correct: 2, total: 3 });

    await user.click(screen.getByRole("button", { name: /back to lessons/i }));
    expect(screen.getByText(/done, 2\/3 right/i)).toBeInTheDocument();
  });

  it("goes back to the hub from any step", async () => {
    const user = userEvent.setup();
    renderTrain("/train?lesson=pot-odds");
    await user.click(screen.getByRole("button", { name: /all lessons/i }));
    expect(screen.getByRole("heading", { name: /^lessons$/i })).toBeInTheDocument();
  });
});

describe("Ask the coach", () => {
  async function toFirstAnswer(user: ReturnType<typeof userEvent.setup>) {
    renderTrain("/train?lesson=opening-hands");
    await user.click(screen.getByRole("button", { name: /^next$/i }));
    await user.click(screen.getByRole("button", { name: /^fold$/i })); // wrong: AQo from UTG is a raise
  }

  it("only appears after you answer, and sends the facts the lesson computed", async () => {
    mockAsk.mockResolvedValue({ kind: "answer", data: { answer: "AQo is strong enough to open.", source: "ai", reason: null } });
    const user = userEvent.setup();
    renderTrain("/train?lesson=opening-hands");
    await user.click(screen.getByRole("button", { name: /^next$/i }));
    expect(screen.queryByText(/ask the coach/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^fold$/i }));
    await user.click(screen.getByRole("button", { name: /why isn.t the other choice better/i }));

    expect(await screen.findByText("AQo is strong enough to open.")).toBeInTheDocument();
    const [question, context] = mockAsk.mock.calls[0];
    expect(question).toBe("Why isn't the other choice better?");
    expect(context).toMatchObject({
      lesson_title: "Which hands to open",
      picked: "Fold",
      correct: "Raise to 2.5bb",
      hand: ["As", "Qh"],
      board: [],
    });
    expect(context.explanation).toMatch(/AQo is in the UTG opening range/);
  });

  it("lets you type your own question", async () => {
    mockAsk.mockResolvedValue({ kind: "answer", data: { answer: "Because of position.", source: "ai", reason: null } });
    const user = userEvent.setup();
    await toFirstAnswer(user);
    await user.type(screen.getByLabelText(/your question for the coach/i), "Why UTG?");
    await user.click(screen.getByRole("button", { name: /^ask$/i }));
    expect(mockAsk.mock.calls[0][0]).toBe("Why UTG?");
    expect(await screen.findByText("Because of position.")).toBeInTheDocument();
  });

  it("says when it is showing the app's own explanation instead of the AI", async () => {
    mockAsk.mockResolvedValue({ kind: "answer", data: { answer: "Built-in explanation.", source: "fallback", reason: "rate_limited" } });
    const user = userEvent.setup();
    await toFirstAnswer(user);
    await user.click(screen.getByRole("button", { name: /explain this in simpler words/i }));
    expect(await screen.findByText("Built-in explanation.")).toBeInTheDocument();
    expect(screen.getByText(/asked a lot of questions this hour/i)).toBeInTheDocument();
  });

  it("reports a network failure without losing the lesson", async () => {
    mockAsk.mockResolvedValue({ kind: "network-error" });
    const user = userEvent.setup();
    await toFirstAnswer(user);
    await user.click(screen.getByRole("button", { name: /what should i look for next time/i }));
    expect(await screen.findByText(/couldn.t reach the server/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^next$/i })).toBeInTheDocument();
  });

  it("asks you to sign in instead of calling the API when signed out", async () => {
    mockUseAuth.mockReturnValue({ status: "signed-out", email: null });
    const user = userEvent.setup();
    await toFirstAnswer(user);
    expect(screen.getByText(/sign in to ask the ai coach/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /explain this in simpler words/i })).not.toBeInTheDocument();
    expect(mockAsk).not.toHaveBeenCalled();
  });
});
