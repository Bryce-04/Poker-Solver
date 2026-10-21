import type { ReactNode } from 'react'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, vi } from 'vitest'
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
// the app mounts, routes, and redirects without throwing.
describe('<App />', () => {
  beforeEach(() => {
    mockListSpots.mockReset()
    mockListSpots.mockResolvedValue({ kind: 'ok', spots: [] })
    window.history.pushState({}, '', '/')
  })

  it('renders the shell heading', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /poker solver/i })).toBeInTheDocument()
  })

  it('sends the default route to Solve', () => {
    render(<App />)
    expect(window.location.pathname).toBe('/solve')
    expect(screen.getByLabelText(/^player 1$/i)).toBeInTheDocument()
  })

  it('has exactly the four nav destinations', () => {
    render(<App />)
    const links = screen.getAllByRole('link').map((link) => link.textContent)
    expect(links).toEqual(['Solve', 'Ranges', 'Library', 'Drill'])
  })

  it('navigates to Ranges (all three modes), Library and Solve without throwing', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('link', { name: /^ranges$/i }))
    // Pick mode by default: the button builder's position control.
    expect(screen.getByLabelText(/your position/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^type it$/i }))
    expect(window.location.search).toBe('?mode=type')
    expect(screen.getByText(/describe the spot/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^hand history$/i }))
    expect(window.location.search).toBe('?mode=paste')
    expect(screen.getByLabelText(/paste a hand history/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^pick$/i }))
    expect(window.location.search).toBe('')

    // Signed out (see the auth mock above), so Library shows its sign-in
    // notice rather than fetching -- GET /spots requires sign-in.
    await user.click(screen.getByRole('link', { name: /^library$/i }))
    expect(await screen.findByText(/not signed in/i)).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: /^solve$/i }))
    expect(screen.getByLabelText(/^player 1$/i)).toBeInTheDocument()
  })

  it('keeps a half-built Solve spot when you switch tabs and come back', async () => {
    const user = userEvent.setup()
    render(<App />)
    const seat = screen.getByLabelText(/^player 1$/i) as HTMLSelectElement
    await user.selectOptions(seat, 'CO')
    expect(seat.value).toBe('CO')

    await user.click(screen.getByRole('link', { name: /^ranges$/i }))
    await user.click(screen.getByRole('link', { name: /^solve$/i }))

    // The same page instance, not a fresh one reset to the default seat.
    expect((screen.getByLabelText(/^player 1$/i) as HTMLSelectElement).value).toBe('CO')
  })

  it('still starts a fresh Solve when another screen hands it a prefill', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.selectOptions(screen.getByLabelText(/^player 1$/i), 'CO')
    await user.click(screen.getByRole('link', { name: /^ranges$/i }))

    // What navigate('/solve', { state: { prefill } }) leaves in history.
    const prefill = { hero: 'BTN', villain: 'BB', heroRange: { AA: 1 }, startingStackBb: 100 }
    act(() => {
      window.history.pushState({ usr: { prefill }, key: 'prefill-nav', idx: 5 }, '', '/solve')
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
    })

    expect((await screen.findByLabelText(/^player 1$/i) as HTMLSelectElement).value).toBe('BTN')
  })

  it.each([
    ['/saved', '/library', ''],
    ['/type-in', '/ranges', '?mode=type'],
    ['/import', '/ranges', '?mode=paste'],
  ])('redirects the old %s route', (from, pathname, search) => {
    window.history.pushState({}, '', from)
    render(<App />)
    expect(window.location.pathname).toBe(pathname)
    expect(window.location.search).toBe(search)
  })

  describe('at desktop width', () => {
    beforeEach(() => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query === '(min-width: 1024px)',
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
    })
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('swaps the top header for the sidebar and a page header', () => {
      render(<App />)
      const nav = screen.getByRole('navigation', { name: 'Main' })
      expect(within(nav).getByRole('link', { name: /solve.*best play after the flop/i })).toHaveAttribute(
        'aria-current',
        'page',
      )
      expect(within(nav).getAllByRole('link')).toHaveLength(4)
      expect(screen.getByRole('heading', { level: 1, name: 'Solve' })).toBeInTheDocument()
      // The phone header (and its tagline) isn't rendered at all.
      expect(screen.queryByText(/manual hand builder/i)).not.toBeInTheDocument()
    })

    it('opens the sign-in form from the sidebar', async () => {
      const user = userEvent.setup()
      render(<App />)
      expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /^sign in$/i }))
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    })
  })
})
