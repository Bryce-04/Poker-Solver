import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChipGroup } from "./ChipGroup";
import { ActionBar } from "./ActionBar";

const SEATS = [
  { value: "UTG", label: "UTG" },
  { value: "BTN", label: "BTN" },
  { value: "BB", label: "BB", disabled: true },
] as const;

describe("ChipGroup", () => {
  it("presses the chosen chip and reports taps", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ChipGroup label="Player 1" options={SEATS} value="BTN" onChange={onChange} />);
    expect(screen.getByRole("group", { name: "Player 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "BTN" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "UTG" })).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: "UTG" }));
    expect(onChange).toHaveBeenCalledWith("UTG");
  });

  it("can't pick a disabled chip", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ChipGroup label="Player 2" options={SEATS} value={null} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "BB" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("ActionBar", () => {
  it("runs the primary action and Back", async () => {
    const user = userEvent.setup();
    const onPrimary = vi.fn();
    const onBack = vi.fn();
    render(<ActionBar primaryLabel="Next: the board" onPrimary={onPrimary} onBack={onBack} />);
    await user.click(screen.getByRole("button", { name: "Next: the board" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onPrimary).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("says why a disabled primary can't run", () => {
    render(
      <ActionBar
        primaryLabel="Next: the board"
        onPrimary={() => {}}
        disabledReason="Finish preflop first"
        onBack={() => {}}
        backDisabled
      />,
    );
    expect(screen.getByRole("button", { name: "Finish preflop first" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Next: the board" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
  });

  it("leaves Back out when there's none", () => {
    render(<ActionBar primaryLabel="Solve" onPrimary={() => {}} />);
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });
});
