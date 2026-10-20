import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { SegmentedControl } from "./SegmentedControl";

type Mode = "pick" | "type" | "paste";

const OPTIONS = [
  { value: "pick", label: "Pick" },
  { value: "type", label: "Type it" },
  { value: "paste", label: "Hand history", disabled: true },
] as const;

function Harness() {
  const [mode, setMode] = useState<Mode>("pick");
  return (
    <>
      <SegmentedControl label="Entry mode" options={OPTIONS} value={mode} onChange={setMode} />
      <output data-testid="mode">{mode}</output>
    </>
  );
}

describe("SegmentedControl", () => {
  it("marks only the current option as pressed, inside a labelled group", () => {
    render(<Harness />);
    expect(screen.getByRole("group", { name: "Entry mode" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pick" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Type it" })).toHaveAttribute("aria-pressed", "false");
  });

  it("switches on click and ignores disabled options", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Type it" }));
    expect(screen.getByTestId("mode")).toHaveTextContent("type");
    expect(screen.getByRole("button", { name: "Type it" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Hand history" }));
    expect(screen.getByTestId("mode")).toHaveTextContent("type");
  });
});
