import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrategyGrid } from "./StrategyGrid";

const strategy = {
  KQs: { check: 0.5, bet_medium: 0.5 },
  AA: { check: 1 },
};

describe("StrategyGrid suit view", () => {
  it("shows a hand's suits when tapped, using per-suit strategies where they differ", async () => {
    const user = userEvent.setup();
    render(
      <StrategyGrid
        strategy={strategy}
        comboStrategy={{
          KhQh: { check: 0.1, bet_medium: 0.9 },
          KsQs: { check: 0.8, bet_medium: 0.2 },
          KdQd: { check: 0.8, bet_medium: 0.2 },
          KcQc: { check: 0.8, bet_medium: 0.2 },
        }}
      />,
    );
    await user.click(screen.getByRole("gridcell", { name: /^KQs:/ }));

    const suits = screen.getByRole("group", { name: "KQs by suit" });
    expect(within(suits).getAllByRole("img")).toHaveLength(4);
    expect(within(suits).getByRole("img", { name: "KhQh: Check 10%, Bet Medium (75%) 90%" })).toBeInTheDocument();
    expect(within(suits).getByRole("img", { name: /^KsQs: Check 80%/ })).toBeInTheDocument();
    expect(screen.getByText(/suits play differently/i)).toBeInTheDocument();
  });

  it("falls back to the hand's own strategy for every suit when none differ", async () => {
    const user = userEvent.setup();
    render(<StrategyGrid strategy={strategy} />);
    await user.click(screen.getByRole("gridcell", { name: /^AA:/ }));

    const suits = screen.getByRole("group", { name: "AA by suit" });
    expect(within(suits).getAllByRole("img")).toHaveLength(6);
    expect(within(suits).getAllByRole("img", { name: /: Check 100%$/ })).toHaveLength(6);
    expect(screen.getByText(/every suit of this hand plays the same/i)).toBeInTheDocument();
  });

  it("greys out suit combos that hold a board card", async () => {
    const user = userEvent.setup();
    render(<StrategyGrid strategy={strategy} deadCards={["Ah"]} />);
    await user.click(screen.getByRole("gridcell", { name: /^AA:/ }));

    const suits = screen.getByRole("group", { name: "AA by suit" });
    // Aces of every suit but hearts remain: C(3,2) = 3 live combos of 6.
    expect(within(suits).getAllByRole("img", { name: /on the board/ })).toHaveLength(3);
  });
});

describe("StrategyGrid with the solved range", () => {
  it("fades a hand that is barely in the range, and says how much of the range it is", async () => {
    const user = userEvent.setup();
    render(
      <StrategyGrid
        strategy={{ AA: { check: 1 }, KK: { all_in: 1 } }}
        range={{ AA: 1, KK: 0.05 }}
      />,
    );
    const aa = screen.getByRole("gridcell", { name: /^AA:/ });
    const kk = screen.getByRole("gridcell", { name: /^KK:/ });
    expect(Number(aa.style.opacity)).toBeCloseTo(1);
    expect(Number(kk.style.opacity)).toBeLessThan(0.4);

    await user.click(kk);
    expect(screen.getByText(/5% as much of the range as its heaviest hand/)).toBeInTheDocument();
  });

  it("shows suit combos that are not in the range as not in the range", async () => {
    const user = userEvent.setup();
    // Only the spade combo of 65s is in the range -- the other three suits
    // must not be drawn as if they played the hand's strategy.
    render(
      <StrategyGrid strategy={{ "65s": { all_in: 1 } }} range={{ "6s5s": 0.013 }} />,
    );
    await user.click(screen.getByRole("gridcell", { name: /^65s:/ }));

    const suits = screen.getByRole("group", { name: "65s by suit" });
    expect(within(suits).getAllByRole("img", { name: /not in the range/ })).toHaveLength(3);
    expect(within(suits).getByRole("img", { name: /^6s5s: All-in 100%/ })).toBeInTheDocument();
  });
});
