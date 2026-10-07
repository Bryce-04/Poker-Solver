import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, vi } from 'vitest'
import App from './App'
import { listSpots } from './lib/api'

// SavedSpotsPage calls listSpots() on mount -- mock the api module directly
// (same convention as SpotBuilder.test.tsx) rather than the transport
// underneath it, so this test doesn't care whether that's fetch or
// CapacitorHttp. POST/GET /spots is live (see docs/decisions.md); stub an
// empty list rather than the old 404 "not shipped yet" placeholder.
vi.mock('./lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/api')>()),
  listSpots: vi.fn(),
}))
const mockListSpots = vi.mocked(listSpots)

// Mock the whole auth module rather than just supabase underneath it --
// this is a shell-level smoke test, not an auth test (see auth.test.tsx /
// AuthStatus.test.tsx for that), so a fixed signed-out state keeps it
// hermetic and independent of Supabase client internals.
vi.mock('./lib/auth', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ status: 'signed-out' as const, email: null }),
  getAccessToken: vi.fn().mockResolvedValue(null),
}))

// Shell-level smoke test only. Behavioural tests for SpotBuilder and
// RangeGrid belong with those components (their owners) -- this just proves
// the app mounts and wires the builder in without throwing.
describe('<App />', () => {
  beforeEach(() => {
    mockListSpots.mockReset()
    mockListSpots.mockResolvedValue({ kind: 'ok', spots: [] })
  })

  it('renders the shell heading', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /poker solver/i })).toBeInTheDocument()
  })

  it('mounts the spot builder on the default route (position control is present)', () => {
    render(<App />)
    expect(screen.getAllByRole('combobox').length).toBeGreaterThanOrEqual(1)
  })

  it('navigates to the saved-spots, type-in, and import routes without throwing', async () => {
    const user = userEvent.setup()
    render(<App />)

    // Signed out (see the auth mock above), so Saved shows its sign-in
    // notice rather than fetching -- GET /spots requires sign-in.
    await user.click(screen.getByRole('link', { name: /saved/i }))
    expect(await screen.findByText(/not signed in/i)).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: /type in/i }))
    expect(screen.getByText(/describe the spot/i)).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: /^import$/i }))
    expect(screen.getByLabelText(/paste a hand history/i)).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: /^solve$/i }))
    expect(screen.getByLabelText(/^player 1$/i)).toBeInTheDocument()
  })
})
