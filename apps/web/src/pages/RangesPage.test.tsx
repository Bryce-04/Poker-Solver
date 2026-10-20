import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RangesPage } from "./RangesPage";

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <RangesPage />
    </MemoryRouter>,
  );
}

describe("RangesPage (interim)", () => {
  it("treats no mode, or an unknown one, as Pick", () => {
    for (const url of ["/ranges", "/ranges?mode=nonsense"]) {
      const { unmount } = renderAt(url);
      expect(screen.getByRole("button", { name: "Pick" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByLabelText(/your position/i)).toBeInTheDocument();
      unmount();
    }
  });

  it("opens straight into Type it or Hand history from ?mode=", () => {
    const { unmount } = renderAt("/ranges?mode=type");
    expect(screen.getByRole("button", { name: "Type it" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/describe the spot/i)).toBeInTheDocument();
    unmount();

    renderAt("/ranges?mode=paste");
    expect(screen.getByRole("button", { name: "Hand history" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText(/paste a hand history/i)).toBeInTheDocument();
  });
});
