import { StrictMode, useState } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BottomSheet } from "./BottomSheet";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Pick a card">
        <button type="button">First</button>
        <button type="button">Last</button>
      </BottomSheet>
    </>
  );
}

beforeEach(() => {
  window.history.replaceState({ idx: 0 }, "", "/");
});

describe("BottomSheet", () => {
  it("is a labelled dialog that takes focus and hands it back on close", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Pick a card" });
    expect(dialog).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("closes on Esc", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps Tab inside the sheet", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.click(screen.getByRole("button", { name: "Last" }));
    await user.tab();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Last" })).toHaveFocus();
  });

  it("pushes a history entry, so Back closes the sheet instead of leaving the page", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    // The entry keeps the router's own state alongside the sheet marker.
    expect(window.history.state).toMatchObject({ idx: 0, bottomSheet: true });

    // What the Android back button / browser back does: pop to the entry below.
    act(() => {
      window.history.replaceState({ idx: 0 }, "");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("goes back over its history entry when closed another way", async () => {
    const user = userEvent.setup();
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.keyboard("{Escape}");
    // A tick later, so a sheet opening right away could take the entry over.
    await waitFor(() => expect(back).toHaveBeenCalledTimes(1));
    back.mockRestore();
  });

  it("reuses the entry when a sheet reopens at once, instead of Back then push", async () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const push = vi.spyOn(window.history, "pushState");
    const { rerender } = render(
      <BottomSheet open onClose={() => {}} title="One">
        <p>one</p>
      </BottomSheet>,
    );
    expect(push).toHaveBeenCalledTimes(1);
    // Close and reopen in one go, as the card picker does moving to the next card.
    rerender(
      <BottomSheet open={false} onClose={() => {}} title="One">
        <p>one</p>
      </BottomSheet>,
    );
    rerender(
      <BottomSheet open onClose={() => {}} title="Two">
        <p>two</p>
      </BottomSheet>,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(push).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
    expect(window.history.state).toMatchObject({ bottomSheet: true });
    back.mockRestore();
    push.mockRestore();
  });
});

describe("BottomSheet under StrictMode (development)", () => {
  it("stays open: the mount-unmount-mount doesn't read as Back", async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    // Give any queued history traversal time to land.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByRole("dialog", { name: "Pick a card" })).toBeInTheDocument();
    expect(window.history.state).toMatchObject({ bottomSheet: true });
  });
});
