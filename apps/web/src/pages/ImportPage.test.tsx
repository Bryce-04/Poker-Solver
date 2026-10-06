import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImportPage } from "./ImportPage";
import { fetchReferenceStrategy, saveSpot } from "../lib/api";
import { useAuth } from "../lib/auth";

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

async function useExampleAndGetMatch(user: ReturnType<typeof userEvent.setup>) {
  mockFetch.mockResolvedValueOnce(matchResponse);
  await user.click(screen.getByRole("button", { name: /use example/i }));
  await user.click(screen.getByRole("button", { name: /parse/i }));
  await screen.findByText(/BTN opening range/);
}

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

  it("shows a sign-in prompt instead of saving when signed out", async () => {
    mockUseAuth.mockReturnValue({ status: "signed-out", email: null });
    const user = userEvent.setup();
    render(<ImportPage />);
    await useExampleAndGetMatch(user);

    await user.click(screen.getByRole("button", { name: /^save this spot$/i }));

    expect(await screen.findByText(/sign in to save spots/i)).toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("saves normally when signed in", async () => {
    mockSave.mockResolvedValue({ kind: "saved", spot: {} as never });
    const user = userEvent.setup();
    render(<ImportPage />);
    await useExampleAndGetMatch(user);

    await user.click(screen.getByRole("button", { name: /^save this spot$/i }));

    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/^saved\.$/i)).toBeInTheDocument();
  });
});
