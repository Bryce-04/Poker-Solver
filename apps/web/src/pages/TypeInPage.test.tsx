import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TypeInPage } from "./TypeInPage";
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

describe("TypeInPage", () => {
  it("shows the two supported examples when a phrase isn't recognized", async () => {
    const user = userEvent.setup();
    render(<TypeInPage />);

    await user.type(screen.getByLabelText(/describe the spot/i), "I raise from the button");
    await user.click(screen.getByRole("button", { name: /parse/i }));

    expect(
      await screen.findByText(/didn.t recognize that phrasing/i),
    ).toBeInTheDocument();
    // The example shows up both in the hint and the error block's list.
    expect(screen.getAllByText("BTN opens 100bb").length).toBeGreaterThanOrEqual(1);
    // A phrase that doesn't parse never calls the API.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("parses a recognized phrase, shows an editable matched range, and saves the edited version", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(matchResponse);
    mockSave.mockResolvedValue({ kind: "saved", spot: {} as never });

    render(<TypeInPage />);
    await user.type(screen.getByLabelText(/describe the spot/i), "BTN opens 100bb");
    await user.click(screen.getByRole("button", { name: /parse/i }));

    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({ positions_in_hand: ["BTN"] }),
    );
    await screen.findByText(/BTN opening range/);

    await user.click(screen.getByRole("gridcell", { name: "KK" }));
    await user.click(screen.getByRole("button", { name: /^save this spot$/i }));

    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ ranges: { BTN: { AA: 1, KK: 1 } } }),
    );
    expect(await screen.findByText(/^saved\.$/i)).toBeInTheDocument();
  });

  it("distinguishes a 404 no-match from an unreachable API", async () => {
    const user = userEvent.setup();
    render(<TypeInPage />);
    const input = screen.getByLabelText(/describe the spot/i);
    const submit = screen.getByRole("button", { name: /parse/i });

    mockFetch.mockResolvedValueOnce({ kind: "no-match" });
    await user.type(input, "UTG opens");
    await user.click(submit);
    expect(
      await screen.findByText(/no reference chart for this spot yet/i),
    ).toBeInTheDocument();

    mockFetch.mockResolvedValueOnce({ kind: "network-error" });
    await user.click(submit);
    expect(await screen.findByText(/couldn.t reach the api/i)).toBeInTheDocument();
  });

  it("disables submit until there's text to parse", () => {
    render(<TypeInPage />);
    expect(screen.getByRole("button", { name: /parse/i })).toBeDisabled();
  });
});
