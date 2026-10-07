import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CardPicker } from "./CardPicker";

function Harness({ initial = [] as string[], max }: { initial?: string[]; max?: number }) {
  const [value, setValue] = useState(initial);
  return <CardPicker value={value} onChange={setValue} max={max} />;
}

describe("CardPicker", () => {
  it("renders all 52 cards", () => {
    render(<CardPicker value={[]} onChange={vi.fn()} />);
    expect(screen.getAllByRole("gridcell")).toHaveLength(52);
  });

  it("calls onChange with the card added when an unselected cell is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<CardPicker value={["Ks"]} onChange={onChange} />);

    await user.click(screen.getByRole("gridcell", { name: /queen of hearts/i }));
    expect(onChange).toHaveBeenCalledWith(["Ks", "Qh"]);
  });

  it("calls onChange with the card removed when a selected cell is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<CardPicker value={["Ks", "Qh"]} onChange={onChange} />);

    await user.click(screen.getByRole("gridcell", { name: /king of spades/i }));
    expect(onChange).toHaveBeenCalledWith(["Qh"]);
  });

  it("marks selected cells with aria-pressed", () => {
    render(<CardPicker value={["Ks"]} onChange={vi.fn()} />);
    expect(screen.getByRole("gridcell", { name: /king of spades/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("gridcell", { name: /queen of hearts/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("disables unselected cells once max is reached, but keeps selected ones clickable", async () => {
    const user = userEvent.setup();
    render(<Harness initial={["Ks", "Qh", "9d"]} max={3} />);

    const unselected = screen.getByRole("gridcell", { name: /ace of clubs/i });
    expect(unselected).toBeDisabled();

    const selected = screen.getByRole("gridcell", { name: /king of spades/i });
    expect(selected).not.toBeDisabled();
    await user.click(selected);
    expect(screen.getByRole("gridcell", { name: /king of spades/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
