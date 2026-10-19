import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DrillPage } from "./DrillPage";

describe("DrillPage", () => {
  it("deals a card and shows the board and hand", () => {
    render(<DrillPage />);
    expect(screen.getByText(/Card 1 of 15/)).toBeTruthy();
    expect(screen.getByText("Board")).toBeTruthy();
    expect(screen.getByText("Your hand")).toBeTruthy();
  });

  it("grades an answer, shows the solver's mix, and advances", () => {
    render(<DrillPage />);
    // Left is always legal: check or fold.
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByRole("status").textContent).toMatch(/solver plays/);
    fireEvent.click(screen.getByRole("button", { name: /next card/i }));
    expect(screen.getByText(/Card 2 of 15/)).toBeTruthy();
  });

  it("finishes with a score summary", () => {
    render(<DrillPage />);
    for (let i = 0; i < 15; i++) {
      fireEvent.keyDown(window, { key: "ArrowLeft" });
      fireEvent.click(screen.getByRole("button", { name: /next card|see results/i }));
    }
    expect(screen.getByRole("button", { name: /play again/i })).toBeTruthy();
  });
});
