import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChipGroup } from "./ChipGroup";
import { ActionBar } from "./ActionBar";
import { StepProgress } from "./StepProgress";
import { TabBar } from "./TabBar";
import { MemoryRouter } from "react-router-dom";

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

describe("StepProgress", () => {
  const STEPS = [
    { id: "hand", label: "Hand" },
    { id: "board", label: "Board" },
    { id: "ranges", label: "Ranges" },
  ] as const;

  it("lets you tap back to an earlier step, not ahead", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<StepProgress steps={STEPS} current="board" onPick={onPick} />);
    await user.click(screen.getByRole("button", { name: "Hand" }));
    expect(onPick).toHaveBeenCalledWith("hand");
    expect(screen.getByText("Board")).toHaveAttribute("aria-current", "step");
    expect(screen.queryByRole("button", { name: "Ranges" })).not.toBeInTheDocument();
  });
});

describe("TabBar", () => {
  it("links each tab to where it was left, with a badge when asked", () => {
    render(
      <MemoryRouter>
        <TabBar paths={{ ranges: "/ranges?mode=type" }} badges={{ solve: "solving" }} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: /^ranges$/i })).toHaveAttribute("href", "/ranges?mode=type");
    expect(screen.getByRole("link", { name: "Solve (solving)" })).toBeInTheDocument();
  });
});
