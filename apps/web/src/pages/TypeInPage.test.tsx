import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TypeInPage } from "./TypeInPage";
import { fetchReferenceStrategy, saveSpot } from "../lib/api";
import { useAuth } from "../lib/auth";

// Same conventions as SpotBuilder.test.tsx: mock the api chokepoint and the
// auth hook, not the transport/Supabase client underneath either.
vi.mock("../lib/api", () => ({ fetchReferenceStrategy: vi.fn(), saveSpot: vi.fn() }));
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

async function typeAndGetMatch(user: ReturnType<typeof userEvent.setup>) {
  mockFetch.mockResolvedValueOnce({
    kind: "match",
    data: {
      source: "reference_chart",
      chart_key: "btn_open_100bb",
      chart_description: "BTN opening range, ~100bb effective",
      chart_source: "test",
      ranges: { BTN: { AA: 1 } },
    },
  });
  await user.type(screen.getByLabelText(/describe the spot/i), "BTN opens 100bb");
  await user.click(screen.getByRole("button", { name: /parse .* get reference strategy/i }));
  await screen.findByText(/BTN opening range/);
}

describe("TypeInPage", () => {
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
