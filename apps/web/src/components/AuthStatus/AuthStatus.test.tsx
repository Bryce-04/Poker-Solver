import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthStatus } from "./AuthStatus";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabase";

vi.mock("../../lib/auth", () => ({ useAuth: vi.fn() }));
const mockUseAuth = vi.mocked(useAuth);

vi.mock("../../lib/supabase", () => ({
  supabase: {
    auth: { signInWithPassword: vi.fn(), signUp: vi.fn(), signOut: vi.fn() },
  },
}));
const mockSignIn = vi.mocked(supabase.auth.signInWithPassword);
const mockSignUp = vi.mocked(supabase.auth.signUp);
const mockSignOut = vi.mocked(supabase.auth.signOut);

beforeEach(() => {
  mockUseAuth.mockReset();
  mockSignIn.mockReset();
  mockSignUp.mockReset();
  mockSignOut.mockReset();
});

describe("AuthStatus", () => {
  it("renders nothing while loading", () => {
    mockUseAuth.mockReturnValue({ status: "loading", email: null });
    const { container } = render(<AuthStatus />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows signed-in state with a sign-out button", async () => {
    mockUseAuth.mockReturnValue({ status: "signed-in", email: "hero@example.com" });
    mockSignOut.mockResolvedValue({ error: null } as never);
    const user = userEvent.setup();
    render(<AuthStatus />);

    expect(screen.getByText(/signed in as hero@example.com/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /sign out/i }));
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it("submits sign-in with the entered credentials", async () => {
    mockUseAuth.mockReturnValue({ status: "signed-out", email: null });
    mockSignIn.mockResolvedValue({ error: null } as never);
    const user = userEvent.setup();
    render(<AuthStatus />);

    await user.type(screen.getByLabelText(/email/i), "hero@example.com");
    await user.type(screen.getByLabelText(/password/i), "hunter2x");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(mockSignIn).toHaveBeenCalledWith({
      email: "hero@example.com",
      password: "hunter2x",
    });
  });

  it("shows the Supabase error message on a failed sign-in", async () => {
    mockUseAuth.mockReturnValue({ status: "signed-out", email: null });
    mockSignIn.mockResolvedValue({
      error: { message: "Invalid login credentials" },
    } as never);
    const user = userEvent.setup();
    render(<AuthStatus />);

    await user.type(screen.getByLabelText(/email/i), "hero@example.com");
    await user.type(screen.getByLabelText(/password/i), "wrongpass");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByText(/invalid login credentials/i)).toBeInTheDocument();
  });

  it("toggles to sign-up and calls signUp instead", async () => {
    mockUseAuth.mockReturnValue({ status: "signed-out", email: null });
    mockSignUp.mockResolvedValue({ error: null } as never);
    const user = userEvent.setup();
    render(<AuthStatus />);

    await user.click(screen.getByRole("button", { name: /sign up instead/i }));
    await user.type(screen.getByLabelText(/email/i), "new@example.com");
    await user.type(screen.getByLabelText(/password/i), "hunter2x");
    await user.click(screen.getByRole("button", { name: /^sign up$/i }));

    expect(mockSignUp).toHaveBeenCalledWith({
      email: "new@example.com",
      password: "hunter2x",
    });
  });
});
