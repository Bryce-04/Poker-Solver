import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TrainPage } from "./TrainPage";
import { LESSONS, readProgress } from "../lib/lessons";

function renderTrain(path = "/train") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TrainPage />
    </MemoryRouter>,
  );
}

beforeEach(() => window.localStorage.clear());

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
