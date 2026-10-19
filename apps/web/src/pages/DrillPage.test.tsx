import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { DrillPage } from "./DrillPage";

function open() {
  render(
    <MemoryRouter initialEntries={["/drill"]}>
      <DrillPage />
    </MemoryRouter>,
  );
}

function play() {
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
}

describe("DrillPage", () => {
  beforeEach(() => localStorage.clear());

  it("opens on a start screen with an exit button", () => {
    open();
    expect(screen.getByRole("heading", { name: "Swipe Drill" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /exit the drill/i }).getAttribute("href")).toBe("/");
  });

  it("deals a card that says who you are, with the board and hand", () => {
    open();
    play();
    expect(screen.getByText("You")).toBeTruthy();
    expect(screen.getByText("Board")).toBeTruthy();
    expect(screen.getByText("Your hand")).toBeTruthy();
    expect(screen.getByText(/1 \/ 15/)).toBeTruthy();
  });

  it("grades an answer, shows the solver's mix, and advances", () => {
    open();
    play();
    // Left is always legal: check or fold.
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByRole("status").textContent).toMatch(/best move|acceptable|miss/i);
    expect(screen.getByText(/of the time with this hand/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /next hand/i }));
    expect(screen.getByText(/2 \/ 15/)).toBeTruthy();
  });

  it("finishes with a score summary and remembers the best score", () => {
    open();
    play();
    for (let i = 0; i < 15; i++) {
      fireEvent.keyDown(window, { key: "ArrowLeft" });
      fireEvent.click(screen.getByRole("button", { name: /next hand|see results/i }));
    }
    expect(screen.getByRole("button", { name: /play again/i })).toBeTruthy();
    expect(localStorage.getItem("drill.bestScore")).not.toBeNull();
  });
});
