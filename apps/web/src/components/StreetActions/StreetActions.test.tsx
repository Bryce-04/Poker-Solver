import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StreetActions } from "./StreetActions";
import type { BuilderAction } from "../../lib/handBuilder";
import type { StreetContext } from "../../lib/handBuilder";

const FLOP_CTX: StreetContext = {
  oopPosition: "BB",
  ipPosition: "BTN",
  potBeforeBb: 6.5,
  stackBeforeBb: 97,
  firstToAct: "BB",
};

function Harness({ ctx = FLOP_CTX, disabled }: { ctx?: StreetContext; disabled?: boolean }) {
  const [actions, setActions] = useState<BuilderAction[]>([]);
  return (
    <StreetActions street="flop" ctx={ctx} actions={actions} onChange={setActions} disabled={disabled} />
  );
}

describe("StreetActions", () => {
  it("offers check and an opening bet on a fresh street", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: /^check$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^bet$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^fold$/i })).not.toBeInTheDocument();
  });

  it("logs a check and passes the turn to the other player", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /^check$/i }));
    expect(screen.getByText("BB checks")).toBeInTheDocument();
    expect(screen.getByText(/BTN to act/)).toBeInTheDocument();
  });

  it("offers fold/call/raise once facing a bet", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /^check$/i }));
    await user.click(screen.getByRole("button", { name: /^bet$/i })); // BTN bets the default size
    expect(screen.getByRole("button", { name: /^fold$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^call/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^raise$/i })).toBeInTheDocument();
  });

  it("closes the street on check-check, offering no further actions", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /^check$/i }));
    await user.click(screen.getByRole("button", { name: /^check$/i }));
    expect(screen.getByText(/action is closed/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^check$/i })).not.toBeInTheDocument();
  });

  it("ends the hand on a fold", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /^bet$/i }));
    await user.click(screen.getByRole("button", { name: /^fold$/i }));
    expect(screen.getByText(/folds -- the hand ends here/i)).toBeInTheDocument();
  });

  it("undo removes the last logged action", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /^check$/i }));
    await user.click(screen.getByRole("button", { name: /^check$/i }));
    await user.click(screen.getByRole("button", { name: /undo last action/i }));
    expect(screen.queryByText(/action is closed/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^check$/i })).toBeInTheDocument();
  });

  it("renders nothing actionable when disabled", () => {
    render(<Harness disabled />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
