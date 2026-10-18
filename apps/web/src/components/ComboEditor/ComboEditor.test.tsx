import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { HandRange } from "@poker-solver/schema";
import { ComboEditor } from "./ComboEditor";

function Harness({
  hand,
  initial = {},
  deadCards,
}: {
  hand: string;
  initial?: HandRange;
  deadCards?: string[];
}) {
  const [value, setValue] = useState<HandRange>(initial);
  return (
    <>
      <ComboEditor hand={hand} value={value} onChange={setValue} deadCards={deadCards} />
      <output data-testid="dump">{JSON.stringify(value)}</output>
    </>
  );
}

const dump = () => JSON.parse(screen.getByTestId("dump").textContent || "{}");

describe("ComboEditor", () => {
  it("shows the right number of combos per hand type", () => {
    const { unmount } = render(<Harness hand="AKs" />);
    expect(screen.getAllByRole("button", { name: /^A.K./ })).toHaveLength(4);
    unmount();
    render(<Harness hand="AKo" />);
    expect(screen.getAllByRole("button", { name: /^A.K./ })).toHaveLength(12);
  });

  it("turning off one suit combo splits the hand type", async () => {
    const user = userEvent.setup();
    render(<Harness hand="AKs" initial={{ AKs: 1 }} />);
    await user.click(screen.getByRole("button", { name: "AhKh" }));
    expect(dump()).toEqual({ AsKs: 1, AdKd: 1, AcKc: 1 });
  });

  it("turning it back on collapses to the hand type again", async () => {
    const user = userEvent.setup();
    render(<Harness hand="AKs" initial={{ AsKs: 1, AdKd: 1, AcKc: 1 }} />);
    await user.click(screen.getByRole("button", { name: "AhKh" }));
    expect(dump()).toEqual({ AKs: 1 });
  });

  it("cannot toggle a combo that holds a board card", () => {
    render(<Harness hand="AKs" initial={{ AKs: 1 }} deadCards={["Ah"]} />);
    expect(screen.getByRole("button", { name: "AhKh, on the board" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "AsKs" })).toBeEnabled();
  });

  it("None clears the whole hand type and All fills it", async () => {
    const user = userEvent.setup();
    render(<Harness hand="QQ" initial={{ QQ: 1, AA: 1 }} />);
    await user.click(screen.getByRole("button", { name: "None" }));
    expect(dump()).toEqual({ AA: 1 });
    await user.click(screen.getByRole("button", { name: "All" }));
    expect(dump()).toEqual({ AA: 1, QQ: 1 });
  });
});
