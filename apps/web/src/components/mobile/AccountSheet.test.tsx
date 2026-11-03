import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountSheet } from "./AccountSheet";
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
  vi.clearAllMocks();
  mockUseAuth.mockReturnValue({ status: "signed-out", email: null });
});

/** The form's submit: the last button with that name (the segmented control's
 * tab of the same name comes first). */
async function submit(user: ReturnType<typeof userEvent.setup>, name: string) {
  const buttons = screen.getAllByRole("button", { name });
  await user.click(buttons[buttons.length - 1]);
}

async function fillIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Email"), "hero@example.com");
  await user.type(screen.getByLabelText("Password"), "hunter22");
}

describe("AccountSheet", () => {
  it("signs in and closes", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mockSignIn.mockResolvedValue({ data: { session: {} }, error: null } as never);
    render(<AccountSheet open onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "Sign in" })).toBeInTheDocument();
    await fillIn(user);
    await submit(user, "Sign in");
    expect(mockSignIn).toHaveBeenCalledWith({ email: "hero@example.com", password: "hunter22" });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the error and stays open when sign-in fails", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mockSignIn.mockResolvedValue({ data: {}, error: { message: "Invalid login credentials" } } as never);
    render(<AccountSheet open onClose={onClose} />);
    await fillIn(user);
    await submit(user, "Sign in");
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid login credentials");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("creates an account, and says to check email when confirmation is needed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mockSignUp.mockResolvedValue({ data: { session: null }, error: null } as never);
    render(<AccountSheet open onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByRole("dialog", { name: "Create an account" })).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "new-password");
    await fillIn(user);
    await submit(user, "Create account");
    expect(mockSignUp).toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(/check your email/i);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("signed in: shows the email and signs out", async () => {
    const user = userEvent.setup();
    mockUseAuth.mockReturnValue({ status: "signed-in", email: "hero@example.com" });
    mockSignOut.mockResolvedValue({ error: null } as never);
    render(<AccountSheet open onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Account" })).toHaveTextContent("hero@example.com");
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });
});
