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
