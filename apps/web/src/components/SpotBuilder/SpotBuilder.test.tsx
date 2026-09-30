import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SpotBuilder } from "./SpotBuilder";
import { fetchReferenceStrategy, saveSpot } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  fetchReferenceStrategy: vi.fn(),
  saveSpot: vi.fn(),
}));
const mockFetch = vi.mocked(fetchReferenceStrategy);
const mockSave = vi.mocked(saveSpot);

const positionSelect = () =>
  screen.getByRole("combobox", { name: /your position/i }) as HTMLSelectElement;

beforeEach(() => {
  mockFetch.mockReset();
  mockSave.mockReset();
});

describe("SpotBuilder", () => {
  it("offers only 6-max openers as the hero seat in an unopened pot", () => {
    render(<SpotBuilder />);
    const opts = within(positionSelect())
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(opts).toEqual(["UTG", "HJ", "CO", "BTN", "SB"]);
    // Full-ring seats and BB (never first to act) are absent.
    expect(opts).not.toContain("UTG1");
    expect(opts).not.toContain("BB");
  });

  it("reveals the raiser seat only when facing a raise", async () => {
    const user = userEvent.setup();
    render(<SpotBuilder />);

    expect(screen.queryByRole("combobox", { name: /raise came from/i })).toBeNull();
    await user.click(screen.getByLabelText(/facing a single raise/i));
    expect(
      screen.getByRole("combobox", { name: /raise came from/i }),
    ).toBeInTheDocument();
  });

  it("snaps the hero seat off BB when switching back to an unopened pot", async () => {
    const user = userEvent.setup();
    render(<SpotBuilder />);

    await user.click(screen.getByLabelText(/facing a single raise/i));
    await user.selectOptions(positionSelect(), "BB");
    expect(positionSelect().value).toBe("BB");

    await user.click(screen.getByLabelText(/first to act/i));
    expect(positionSelect().value).toBe("BTN");
  });

  it("submits the assembled spot and shows the matched chart", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      kind: "match",
      data: {
        source: "reference_chart",
        chart_key: "btn_open_100bb",
        chart_description: "BTN opening range, ~100bb effective",
        chart_source: "test",
        ranges: { BTN: { AA: 1, AKs: 0.5 } },
      },
    });

    render(<SpotBuilder />);
    await user.click(screen.getByRole("button", { name: /get reference strategy/i }));

    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        positions_in_hand: ["BTN"],
        current_street: "preflop",
        actions: [],
      }),
    );
    expect(
      await screen.findByText(/BTN opening range, ~100bb effective/),
    ).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "AA" })).toBeInTheDocument();
  });

  it("shows the matched range editable, and saves the edited version, not the untouched chart", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      kind: "match",
      data: {
        source: "reference_chart",
        chart_key: "btn_open_100bb",
        chart_description: "BTN opening range, ~100bb effective",
        chart_source: "test",
        ranges: { BTN: { AA: 1 } },
      },
    });
    mockSave.mockResolvedValue({ kind: "saved", spot: {} as never });

    render(<SpotBuilder />);
    await user.click(screen.getByRole("button", { name: /get reference strategy/i }));
    await screen.findByText(/BTN opening range/);

    // The grid is editable now, not a static read-only display -- toggle a
    // hand the chart didn't include.
    await user.click(screen.getByRole("gridcell", { name: "KK" }));
    await user.click(screen.getByRole("button", { name: /^save this spot$/i }));

    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ ranges: { BTN: { AA: 1, KK: 1 } } }),
    );
    expect(await screen.findByText(/^saved\.$/i)).toBeInTheDocument();
  });

  it("resets an edited range back to the chart", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      kind: "match",
      data: {
        source: "reference_chart",
        chart_key: "btn_open_100bb",
        chart_description: "BTN opening range, ~100bb effective",
        chart_source: "test",
        ranges: { BTN: { AA: 1 } },
      },
    });

    render(<SpotBuilder />);
    await user.click(screen.getByRole("button", { name: /get reference strategy/i }));
    await screen.findByText(/BTN opening range/);

    await user.click(screen.getByRole("gridcell", { name: "AA" })); // toggle off
    expect(screen.getByRole("gridcell", { name: "AA" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await user.click(screen.getByRole("button", { name: /reset to chart/i }));
    expect(screen.getByRole("gridcell", { name: "AA" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("distinguishes a 404 no-match from an unreachable API", async () => {
    const user = userEvent.setup();
    render(<SpotBuilder />);
    const submit = screen.getByRole("button", { name: /get reference strategy/i });

    mockFetch.mockResolvedValueOnce({ kind: "no-match" });
    await user.click(submit);
    expect(
      await screen.findByText(/no reference chart for this spot yet/i),
    ).toBeInTheDocument();

    mockFetch.mockResolvedValueOnce({ kind: "network-error" });
    await user.click(submit);
    expect(await screen.findByText(/couldn.t reach the api/i)).toBeInTheDocument();
  });
});
