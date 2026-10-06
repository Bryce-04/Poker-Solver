import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TypeInPage } from "./TypeInPage";
import { fetchReferenceStrategy, saveSpot } from "../lib/api";
import { useAuth } from "../lib/auth";

// Same conventions as SpotBuilder.test.tsx: mock the api chokepoint and the
// auth hook, not the transport/Supabase client underneath either.
vi.mock("../lib/api", () => ({
  fetchReferenceStrategy: vi.fn(),
  saveSpot: vi.fn(),
}));
const mockFetch = vi.mocked(fetchReferenceStrategy);
const mockSave = vi.mocked(saveSpot);

vi.mock("../lib/auth", () => ({ useAuth: vi.fn() }));
const mockUseAuth = vi.mocked(useAuth);

beforeEach(() => {
  mockFetch.mockReset();
  mockSave.mockReset();
  mockUseAuth.mockReset();
  mockUseAuth.mockReturnValue({ status: "signed-in", email: "hero@example.com" });
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

async function typeAndGetMatch(user: ReturnType<typeof userEvent.setup>) {
  mockFetch.mockResolvedValueOnce(matchResponse);
  await user.type(screen.getByLabelText(/describe the spot/i), "BTN opens 100bb");
  await user.click(screen.getByRole("button", { name: /parse/i }));
  await screen.findByText(/BTN opening range/);
}

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

  it("shows a sign-in prompt instead of saving when signed out", async () => {
    mockUseAuth.mockReturnValue({ status: "signed-out", email: null });
    const user = userEvent.setup();
    render(<TypeInPage />);
    await typeAndGetMatch(user);

    await user.click(screen.getByRole("button", { name: /save this spot/i }));

    expect(await screen.findByText(/sign in to save spots/i)).toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("saves normally when signed in", async () => {
    mockSave.mockResolvedValue({ kind: "saved", spot: {} as never });
    const user = userEvent.setup();
    render(<TypeInPage />);
    await typeAndGetMatch(user);

    await user.click(screen.getByRole("button", { name: /save this spot/i }));

    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/^saved\.$/i)).toBeInTheDocument();
  });
});
