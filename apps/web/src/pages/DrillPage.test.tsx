import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { DrillPage } from "./DrillPage";

function open() {
  return render(
    <MemoryRouter initialEntries={["/drill"]}>
      <DrillPage />
    </MemoryRouter>,
  );
}

function play() {
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
}

// The first passive button is always Fold or Check, which every spot offers.
function answerFirst() {
  fireEvent.click(screen.getByRole("button", { name: /^(fold|check)/i }));
}

describe("DrillPage", () => {
  beforeEach(() => localStorage.clear());

  it("opens on a start screen with an exit button", () => {
    open();
    expect(screen.getByRole("heading", { name: "Poker Drill" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /exit the drill/i }).getAttribute("href")).toBe("/");
  });

  it("deals a card that says who you are, with the board and hand", () => {
    open();
    play();
    expect(screen.getByText("You")).toBeTruthy();
    expect(screen.getByText("Pot")).toBeTruthy();
    expect(screen.getByText("Board")).toBeTruthy();
    expect(screen.getByText("Your hand")).toBeTruthy();
    expect(screen.getByText(/1 \/ 15/)).toBeTruthy();
  });

  it("grades an answer, shows the solver's mix, and advances", () => {
    open();
    play();
    answerFirst();
    expect(screen.getByRole("status").textContent).toMatch(/best move|acceptable|miss/i);
    expect(screen.getByText(/of the time with this hand/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /next hand/i }));
    expect(screen.getByText(/2 \/ 15/)).toBeTruthy();
  });

  it("tucks the why behind a tap, and opens it in place", () => {
    const { container } = open();
    play();
    answerFirst();
    const why = container.querySelector("details.why") as HTMLDetailsElement;
    expect(why).toBeTruthy();
    expect(why.open).toBe(false);
    const summary = screen.getByText(/^why /i);
    fireEvent.click(summary);
    // jsdom doesn't toggle <details> on a click, so open it the way a browser would.
    why.open = true;
    expect(screen.getByText("equity")).toBeTruthy();
    expect(screen.getByText(/rule-of-thumb summary/i)).toBeTruthy();
    // Still on the same screen: the verdict and the next button are right there.
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByRole("button", { name: /next hand|see results/i })).toBeTruthy();
  });

  it("starts each hand's why collapsed again", () => {
    const { container } = open();
    play();
    answerFirst();
    (container.querySelector("details.why") as HTMLDetailsElement).open = true;
    fireEvent.click(screen.getByRole("button", { name: /next hand/i }));
    answerFirst();
    expect((container.querySelector("details.why") as HTMLDetailsElement).open).toBe(false);
  });

  it("finishes with a score summary and remembers the best score", () => {
    open();
    play();
    for (let i = 0; i < 15; i++) {
      answerFirst();
      fireEvent.click(screen.getByRole("button", { name: /next hand|see results/i }));
    }
    expect(screen.getByRole("button", { name: /play again/i })).toBeTruthy();
    expect(localStorage.getItem("drill.bestScore")).not.toBeNull();
  });
});

describe("DrillPage settings", () => {
  beforeEach(() => localStorage.clear());

  function openPage() {
    return render(
      <MemoryRouter initialEntries={["/drill"]}>
        <DrillPage />
      </MemoryRouter>,
    );
  }

  it("has no swipe zones, just buttons for every legal action", () => {
    openPage();
    play();
    expect(screen.queryByText(/swipe/i)).toBeNull();
    expect(screen.getAllByRole("button", { name: /bb|%|check|fold|call|all-in/i }).length).toBeGreaterThan(2);
  });

  it("opens settings from the cog, recolors the scene, and closes", () => {
    const { container } = openPage();
    const game = container.querySelector(".game")!;
    expect(game.getAttribute("data-theme")).toBe("purple");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /ocean/i }));
    expect(game.getAttribute("data-theme")).toBe("ocean");
    expect(localStorage.getItem("drill.theme")).toBe("ocean");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the sheet on Escape", () => {
    openPage();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("switches bet sizes between bb-first and percent-first, and remembers it", () => {
    openPage();
    play();
    // bb-first (default): a bet button leads with a bb amount.
    expect(screen.getAllByRole("button").some((b) => /^\d+(\.\d)?bb/.test(b.textContent ?? ""))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("radio", { name: /75%\s*4\.1bb/ }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(localStorage.getItem("drill.betDisplay")).toBe("pct");
    expect(screen.getAllByRole("button").some((b) => /^\d+%/.test(b.textContent ?? ""))).toBe(true);
  });

  it("keeps haptics off until switched on in settings, and remembers it", () => {
    openPage();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const toggle = screen.getByRole("switch", { name: /haptics/i }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    expect(localStorage.getItem("drill.haptics")).toBe("on");
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(localStorage.getItem("drill.haptics")).toBe("off");
  });

  it("remembers the color next time, and ignores a bad stored value", () => {
    localStorage.setItem("drill.theme", "midnight");
    const first = openPage();
    expect(first.container.querySelector(".game")!.getAttribute("data-theme")).toBe("midnight");
    first.unmount();
    localStorage.setItem("drill.theme", "hotpink");
    const again = openPage();
    expect(again.container.querySelector(".game")!.getAttribute("data-theme")).toBe("purple");
  });
});
