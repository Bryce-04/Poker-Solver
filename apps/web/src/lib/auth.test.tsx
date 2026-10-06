import { act, render, screen } from "@testing-library/react";
import { AuthProvider, getAccessToken, useAuth } from "./auth";
import { supabase } from "./supabase";

// Mock the Supabase client itself (not a higher-level module) -- this file
// is what owns turning its session shape into AuthState, so that's the
// boundary worth testing against.
vi.mock("./supabase", () => ({
  supabase: { auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));
const mockGetSession = vi.mocked(supabase.auth.getSession);
const mockOnAuthStateChange = vi.mocked(supabase.auth.onAuthStateChange);

type ChangeCallback = (event: string, session: unknown) => void;
let authChangeCallback: ChangeCallback | undefined;
const unsubscribe = vi.fn();

function Probe() {
  const auth = useAuth();
  return <p>{auth.status}{auth.email ? `:${auth.email}` : ""}</p>;
}

beforeEach(() => {
  mockGetSession.mockReset();
  mockOnAuthStateChange.mockReset();
  unsubscribe.mockReset();
  mockOnAuthStateChange.mockImplementation(((cb: ChangeCallback) => {
    authChangeCallback = cb;
    return { data: { subscription: { unsubscribe } } };
  }) as never);
});

describe("AuthProvider / useAuth", () => {
  it("resolves to signed-out when there is no session", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } } as never);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("signed-out")).toBeInTheDocument();
  });

  it("resolves to signed-in with the session's user email", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { email: "hero@example.com" }, access_token: "tok" } },
    } as never);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("signed-in:hero@example.com")).toBeInTheDocument();
  });

  it("updates state when onAuthStateChange fires", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } } as never);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("signed-out");

    act(() => {
      authChangeCallback?.("SIGNED_IN", {
        user: { email: "new@example.com" },
        access_token: "tok",
      });
    });

    expect(await screen.findByText("signed-in:new@example.com")).toBeInTheDocument();
  });

  it("unsubscribes on unmount", () => {
    mockGetSession.mockResolvedValue({ data: { session: null } } as never);
    const { unmount } = render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe("getAccessToken", () => {
  it("returns the session's access token", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "tok", user: {} } },
    } as never);
    await expect(getAccessToken()).resolves.toBe("tok");
  });

  it("returns null when there is no session", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } } as never);
    await expect(getAccessToken()).resolves.toBeNull();
  });
});
