import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrategyGrid } from "./StrategyGrid";

describe("StrategyGrid", () => {
  it("renders all 169 hands", () => {
    render(<StrategyGrid strategy={{}} />);
    expect(screen.getAllByRole("gridcell")).toHaveLength(169);
  });

  it("builds a gradient covering every present action, in a fixed order", () => {
    render(<StrategyGrid strategy={{ AA: { check: 0.05, all_in: 0.95 } }} />);
    const cell = screen.getByRole("gridcell", { name: /^AA:/i });
    const background = (cell as HTMLElement).style.background;
    expect(background).toContain("var(--strategy-passive)");
    expect(background).toContain("var(--strategy-allin)");
    // check (passive) comes before all_in in the fixed left-to-right order.
    expect(background.indexOf("--strategy-passive")).toBeLessThan(
      background.indexOf("--strategy-allin"),
    );
  });

  it("renders a hand absent from the strategy as a flat neutral cell", () => {
    render(<StrategyGrid strategy={{ AA: { check: 1 } }} />);
    const cell = screen.getByRole("gridcell", { name: /^72o: no data/i });
    expect((cell as HTMLElement).style.background).toBe("var(--range-empty)");
  });

  it("shows the exact breakdown for a hand when it's clicked", async () => {
    const user = userEvent.setup();
    render(<StrategyGrid strategy={{ AA: { check: 0.05, all_in: 0.95 } }} />);

    expect(screen.getByText(/tap a hand/i)).toBeInTheDocument();

    await user.click(screen.getByRole("gridcell", { name: /^AA:/i }));

    expect(screen.getByText(/AA: Check 5%, All-in 95%/i)).toBeInTheDocument();
  });

  it("only lists actions actually present in the legend", () => {
    render(<StrategyGrid strategy={{ AA: { fold: 0.3, call: 0.7 } }} />);
    expect(screen.getByText("Fold")).toBeInTheDocument();
    expect(screen.getByText("Call")).toBeInTheDocument();
    expect(screen.queryByText("Check")).not.toBeInTheDocument();
    expect(screen.queryByText("All-in")).not.toBeInTheDocument();
  });

  it("shows no legend at all for an empty strategy", () => {
    render(<StrategyGrid strategy={{}} />);
    expect(screen.queryByText("Fold")).not.toBeInTheDocument();
  });
});
