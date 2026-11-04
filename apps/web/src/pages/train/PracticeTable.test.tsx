import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PracticeTable } from "./PracticeTable";
import { TrainPage } from "../TrainPage";
import { actionLabel, dealHand, mulberry32, type PracticeFilter } from "../../lib/practiceTable";
import { askCoach } from "../../lib/api";
import { useAuth } from "../../lib/auth";

vi.mock("../../lib/api", () => ({ askCoach: vi.fn(), fetchProgress: vi.fn(), putProgress: vi.fn() }));
vi.mock("../../lib/auth", () => ({ useAuth: vi.fn() }));
const mockAsk = vi.mocked(askCoach);
const mockUseAuth = vi.mocked(useAuth);

beforeEach(() => {
  window.localStorage.clear();
  mockAsk.mockReset();
  mockUseAuth.mockReset();
  mockUseAuth.mockReturnValue({ status: "signed-in", email: "a@b.c" });
});

const SEED = 4242;

function renderTable(filter: PracticeFilter = "all", onFilter = vi.fn(), onExit = vi.fn()) {
  render(<PracticeTable filter={filter} onFilter={onFilter} onExit={onExit} seed={SEED} />);
  return { onFilter, onExit };
}

/** The first hand this seed deals, worked out the way the component does. */
const firstHand = (filter: PracticeFilter = "all") => dealHand(mulberry32(SEED), filter);

describe("the table", () => {
  it("shows six seats with you marked, the pot, your two cards and the choices", () => {
    renderTable();
    const { node } = firstHand();
    const table = screen.getByRole("group", { name: /the table/i });
    for (const seat of ["UTG", "HJ", "CO", "BTN", "SB", "BB"]) {
      expect(within(table).getByLabelText(new RegExp(`^${seat}(, you)?`))).toBeInTheDocument();
    }
    expect(within(table).getByLabelText(new RegExp(`^${node.seat}, you`))).toBeInTheDocument();
    expect(within(table).getByLabelText(/^pot$/i)).toBeInTheDocument();
    expect(within(screen.getByLabelText(/your hand/i)).getAllByRole("img")).toHaveLength(2);
    for (const action of node.options) {
      expect(screen.getByRole("button", { name: actionLabel(node, action) })).toBeInTheDocument();
    }
  });

  it("puts the blinds and anything the bots raised on the table", () => {
    renderTable();
    const { node } = firstHand();
    const table = screen.getByRole("group", { name: /the table/i });
    const total = Object.values(node.table.bets).reduce((a, b) => a + b, 0);
    expect(within(table).getByLabelText(/^pot$/i)).toHaveTextContent(`${Number.isInteger(total) ? total : total.toFixed(1)}bb`);
  });
});

describe("answering", () => {
  it("a right answer says so, counts it, and offers the next hand", async () => {
    const user = userEvent.setup();
    renderTable();
    const { node } = firstHand();
    await user.click(screen.getByRole("button", { name: actionLabel(node, node.correct) }));
    expect(screen.getByText(/^right\.$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/session score/i)).toHaveTextContent("1 of 1 right");
    expect(screen.getByText(/approximate reference ranges/i)).toBeInTheDocument();
    // The choices are gone until the next hand.
    expect(screen.queryByRole("button", { name: /^fold$/i })).not.toBeInTheDocument();
  });

  it("a wrong answer shows what the chart says and why", async () => {
    const user = userEvent.setup();
    renderTable();
    const { node } = firstHand();
    const wrong = node.options.find((a) => a !== node.correct)!;
    await user.click(screen.getByRole("button", { name: actionLabel(node, wrong) }));
    expect(screen.getByText(/not quite/i)).toBeInTheDocument();
    expect(screen.getByText(/the chart says/i).parentElement).toHaveTextContent(actionLabel(node, node.correct));
    expect(screen.getByLabelText(/session score/i)).toHaveTextContent("0 of 1 right");
  });

  it("deals a new hand and keeps the session score", async () => {
    const user = userEvent.setup();
    renderTable();
    const { node } = firstHand();
    await user.click(screen.getByRole("button", { name: actionLabel(node, node.correct) }));
    if (screen.queryByRole("button", { name: /^next hand$/i })) {
      await user.click(screen.getByRole("button", { name: /^next hand$/i }));
    } else {
      await user.click(screen.getByRole("button", { name: /^continue/i })); // a 3-bet or 4-bet to face
    }
    expect(screen.queryByText(/^right\.$/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/session score/i)).toHaveTextContent("1 of 1 right");
  });

  it("offers the coach after an answer, with the hand as the chart sees it", async () => {
    mockAsk.mockResolvedValue({ kind: "answer", data: { answer: "Because of position.", source: "ai", reason: null } });
    const user = userEvent.setup();
    renderTable();
    const { node } = firstHand();
    await user.click(screen.getByRole("button", { name: actionLabel(node, node.correct) }));
    await user.click(screen.getByRole("button", { name: /explain this in simpler words/i }));
    expect(await screen.findByText("Because of position.")).toBeInTheDocument();
    const context = mockAsk.mock.calls[0][1];
    expect(context.lesson_title).toBe("Practice table (preflop)");
    expect(context.correct).toBe(actionLabel(node, node.correct));
    expect(context.explanation).toBe(node.explanation);
    expect(context.hand).toHaveLength(2);
    expect(context.board).toEqual([]);
  });
});

describe("filters and leaving", () => {
  it("switching what to practice deals that kind of hand and tells the page", async () => {
    const user = userEvent.setup();
    const { onFilter } = renderTable("all");
    await user.click(screen.getByRole("button", { name: /^defending$/i }));
    expect(onFilter).toHaveBeenCalledWith("defend");
    expect(screen.getByText(/raised to 2.5bb and the rest folded/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^opening$/i }));
    expect(screen.getByText(/everyone has folded to you/i)).toBeInTheDocument();
  });

  it("goes back", async () => {
    const user = userEvent.setup();
    const { onExit } = renderTable();
    await user.click(screen.getByRole("button", { name: /← back/i }));
    expect(onExit).toHaveBeenCalled();
  });
});

describe("from the Train tab", () => {
  function renderTrain(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <TrainPage />
      </MemoryRouter>,
    );
  }

  it("the hub offers the table, and Back returns to the hub", async () => {
    const user = userEvent.setup();
    renderTrain("/train");
    await user.click(screen.getByRole("button", { name: /6-max practice table/i }));
    expect(screen.getByRole("group", { name: /the table/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /← back/i }));
    expect(screen.getByRole("heading", { name: /^lessons$/i })).toBeInTheDocument();
  });

  it("opens straight into a drill from the URL", () => {
    renderTrain("/train?practice=defend");
    expect(screen.getByRole("button", { name: /^defending$/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("ignores a practice value it doesn't know", () => {
    renderTrain("/train?practice=nonsense");
    expect(screen.getByRole("heading", { name: /^lessons$/i })).toBeInTheDocument();
  });

  it("the opening-hands lesson ends with a way into the table for that skill, and the others don't", async () => {
    const user = userEvent.setup();
    const { unmount } = renderTrain("/train?lesson=opening-hands");
    await user.click(screen.getByRole("button", { name: /^next$/i })); // reading card
    // Answer all ten hands (fold is right or wrong, it doesn't matter here).
    for (let i = 0; i < 10; i++) {
      const buttons = screen.getAllByRole("button", { name: /^(fold|raise to 2.5bb)$/i });
      await user.click(buttons[0]);
      const next = screen.queryByRole("button", { name: /^next$/i }) ?? screen.getByRole("button", { name: /^finish$/i });
      await user.click(next);
      // The reading card between the two sets of hands.
      const readNext = screen.queryByRole("heading", { name: /later seats open wider/i });
      if (readNext) await user.click(screen.getByRole("button", { name: /^next$/i }));
    }
    await user.click(await screen.findByRole("button", { name: /practice this at the table/i }));
    expect(screen.getByRole("button", { name: /^opening$/i })).toHaveAttribute("aria-pressed", "true");
    unmount();

    renderTrain("/train?lesson=positions");
    for (let i = 0; i < 3; i++) await user.click(screen.getByRole("button", { name: /^next$/i }));
    for (let i = 0; i < 3; i++) {
      await user.click(screen.getAllByRole("button", { name: /.+/ }).find((b) => b.classList.contains("train__choice"))!);
      await user.click(screen.queryByRole("button", { name: /^next$/i }) ?? screen.getByRole("button", { name: /^finish$/i }));
    }
    expect(screen.queryByRole("button", { name: /practice this at the table/i })).not.toBeInTheDocument();
  });
});
