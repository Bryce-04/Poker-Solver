import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TrainPage } from "./TrainPage";
import { LESSONS } from "../lib/lessons";
import { readProgress } from "../lib/progress";
import { askCoach, fetchProgress, putProgress } from "../lib/api";
import { useAuth } from "../lib/auth";

vi.mock("../lib/api", () => ({ askCoach: vi.fn(), fetchProgress: vi.fn(), putProgress: vi.fn() }));
vi.mock("../lib/auth", () => ({ useAuth: vi.fn() }));
const mockAsk = vi.mocked(askCoach);
const mockFetchProgress = vi.mocked(fetchProgress);
const mockPutProgress = vi.mocked(putProgress);
const ACCOUNT_KEY = "poker-solver.train.progress.v1:a@b.c";
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
  mockFetchProgress.mockReset();
  mockFetchProgress.mockResolvedValue({ kind: "ok", lessons: {} });
  mockPutProgress.mockReset();
  mockPutProgress.mockResolvedValue({ kind: "saved", stored: { done: true, correct: 0, total: 0, at: 0 } });
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

describe("Up next", () => {
  it("points a new learner at the first lesson and opens it", async () => {
    const user = userEvent.setup();
    renderTrain();
    expect(screen.getByText(/start with positions and the button/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^start$/i }));
    expect(screen.getByRole("heading", { name: /six seats, one button/i })).toBeInTheDocument();
  });

  it("moves on after a lesson is finished", () => {
    window.localStorage.setItem(
      ACCOUNT_KEY,
      JSON.stringify({ positions: { done: true, correct: 3, total: 3 } }),
    );
    renderTrain();
    expect(screen.getByText(/next lesson: pot odds and equity/i)).toBeInTheDocument();
  });

  it("sends someone who has finished everything strongly to the Drill", () => {
    window.localStorage.setItem(
      ACCOUNT_KEY,
      JSON.stringify(Object.fromEntries(LESSONS.map((l) => [l.id, { done: true, correct: 9, total: 10 }]))),
    );
    renderTrain();
    expect(screen.getByRole("link", { name: /open the drill/i }).getAttribute("href")).toBe("/drill");
  });
});

describe("Progress follows the account", () => {
  it("shows what the server has once synced, on a device that has none", async () => {
    mockFetchProgress.mockResolvedValue({
      kind: "ok",
      lessons: { positions: { done: true, correct: 3, total: 3, at: 5 } },
    });
    renderTrain();
    expect(await screen.findByText(/next lesson: pot odds and equity/i)).toBeInTheDocument();
    expect(screen.getByText(/done, 3\/3 right/i)).toBeInTheDocument();
  });

  it("does not call the server, or show another account's progress, when signed out", () => {
    mockUseAuth.mockReturnValue({ status: "signed-out", email: null });
    window.localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ positions: { done: true, correct: 3, total: 3, at: 5 } }));
    renderTrain();
    expect(mockFetchProgress).not.toHaveBeenCalled();
    expect(screen.getByText(/start with positions and the button/i)).toBeInTheDocument();
  });

  it("keeps a finished lesson on this device when the upload fails", async () => {
    mockPutProgress.mockResolvedValue({ kind: "network-error" });
    const user = userEvent.setup();
    renderTrain("/train?lesson=pot-odds");
    for (let i = 0; i < 2; i++) await user.click(screen.getByRole("button", { name: /^next$/i }));
    for (const name of [/^25%$/i, /^about 35%$/i, /^yes, narrowly$/i]) {
      await user.click(screen.getByRole("button", { name }));
      await user.click(screen.getByRole("button", { name: /^(next|finish)$/i }));
    }
    expect(screen.getByText(/you got 3 of 3/i)).toBeInTheDocument();
    expect(readProgress("a@b.c")["pot-odds"]).toMatchObject({ done: true, correct: 3 });
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
    expect(readProgress("a@b.c").positions).toMatchObject({ done: true, correct: 2, total: 3 });
    // Signed in, so the attempt also goes to the account.
    expect(mockPutProgress).toHaveBeenCalledWith("positions", expect.objectContaining({ done: true, correct: 2, total: 3 }));

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
