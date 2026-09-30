import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImportPage } from "./ImportPage";
import { fetchReferenceStrategy, saveSpot } from "../lib/api";

vi.mock("../lib/api", () => ({
  fetchReferenceStrategy: vi.fn(),
  saveSpot: vi.fn(),
}));
const mockFetch = vi.mocked(fetchReferenceStrategy);
const mockSave = vi.mocked(saveSpot);

beforeEach(() => {
  mockFetch.mockReset();
  mockSave.mockReset();
});

const matchResponse = {
  kind: "match" as const,
  data: {
    source: "reference_chart" as const,
    chart_key: "btn_open_100bb",
    chart_description: "BTN opening range, ~100bb effective",
    chart_source: "test",
    ranges: { BTN: { AA: 1 } },
  },
};

describe("ImportPage", () => {
  it("fills the textarea with a working example via 'Use example'", async () => {
    const user = userEvent.setup();
    render(<ImportPage />);

    await user.click(screen.getByRole("button", { name: /use example/i }));

    const textarea = screen.getByLabelText(/paste a hand history/i) as HTMLTextAreaElement;
    expect(textarea.value).toContain("6-max");
  });

  it("shows a specific reason when a pasted hand can't be parsed", async () => {
    const user = userEvent.setup();
    render(<ImportPage />);

    await user.type(screen.getByLabelText(/paste a hand history/i), "not a hand history");
    await user.click(screen.getByRole("button", { name: /parse/i }));

    expect(await screen.findByText(/couldn.t parse this hand/i)).toBeInTheDocument();
    expect(screen.getByText(/table size and button seat/i)).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("parses the example hand, shows an editable matched range, and saves the edited version", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(matchResponse);
    mockSave.mockResolvedValue({ kind: "saved", spot: {} as never });

    render(<ImportPage />);
    await user.click(screen.getByRole("button", { name: /use example/i }));
    await user.click(screen.getByRole("button", { name: /parse/i }));

    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({ positions_in_hand: ["BTN"], effective_stack_bb: 100 }),
    );
    await screen.findByText(/BTN opening range/);

    await user.click(screen.getByRole("gridcell", { name: "KK" }));
    await user.click(screen.getByRole("button", { name: /^save this spot$/i }));

    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ ranges: { BTN: { AA: 1, KK: 1 } } }),
    );
    expect(await screen.findByText(/^saved\.$/i)).toBeInTheDocument();
  });

  it("disables submit until there's text to parse", () => {
    render(<ImportPage />);
    expect(screen.getByRole("button", { name: /parse/i })).toBeDisabled();
  });
});
