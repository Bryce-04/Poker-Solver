import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { HandRange } from "@poker-solver/schema";
import { RangeGrid } from "./RangeGrid";

// A thin stateful host so tests can drive the controlled component and read
// back what it committed, the way SpotBuilder (or a future range editor)
// would.
function Harness({
  initial = {},
  readOnly = false,
}: {
  initial?: HandRange;
  readOnly?: boolean;
}) {
  const [value, setValue] = useState<HandRange>(initial);
  return (
    <>
      <RangeGrid value={value} onChange={setValue} readOnly={readOnly} />
      <output data-testid="dump">{JSON.stringify(value)}</output>
    </>
  );
}

const dump = () => JSON.parse(screen.getByTestId("dump").textContent || "{}");

describe("RangeGrid", () => {
  it("renders all 169 hand-class cells", () => {
    render(<Harness />);
    expect(screen.getAllByRole("gridcell")).toHaveLength(169);
  });

  it("click toggles a cell in and back out at the active brush weight", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const aa = screen.getByRole("gridcell", { name: "AA" });

    await user.click(aa);
    expect(dump()).toEqual({ AA: 1 });

    await user.click(aa);
    expect(dump()).toEqual({});
  });

  it("paints with the selected brush weight", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "50%" }));
    await user.click(screen.getByRole("gridcell", { name: "AKs" }));

    expect(dump()).toEqual({ AKs: 0.5 });
    // Partial weight is announced and shown.
    expect(screen.getByRole("gridcell", { name: "AKs, 50%" })).toBeInTheDocument();
  });

  it("Clear empties the range", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ AA: 1, KK: 1 }} />);

    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(dump()).toEqual({});
  });

  it("supports arrow-key navigation and Space to toggle", () => {
    render(<Harness />);
    const aa = screen.getByRole("gridcell", { name: "AA" });
    aa.focus();

    fireEvent.keyDown(aa, { key: "ArrowRight" });
    const aks = screen.getByRole("gridcell", { name: "AKs" });
    expect(aks).toHaveFocus();

    fireEvent.keyDown(aks, { key: " " });
    expect(dump()).toEqual({ AKs: 1 });
  });

  it("reports weighted combo counts", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("gridcell", { name: "AA" })); // pair = 6
    await user.click(screen.getByRole("gridcell", { name: "AKs" })); // suited = 4

    expect(screen.getByText(/10 combos/)).toBeInTheDocument();
  });

  describe("read-only", () => {
    it("hides the brush controls and ignores clicks", async () => {
      const user = userEvent.setup();
      render(<Harness initial={{ AA: 1 }} readOnly />);

      expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
      // Cells are static (not buttons) and don't commit changes.
      expect(screen.queryByRole("button", { name: "AA" })).not.toBeInTheDocument();

      await user.click(screen.getByRole("gridcell", { name: "AA" }));
      expect(dump()).toEqual({ AA: 1 });
    });
  });
});
