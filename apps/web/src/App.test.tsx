import type { ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
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

  it('titles the phone top bar after the current tab', () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: 'Solve' })).toBeInTheDocument()
  })

  it('sends the default route to Solve', () => {
    render(<App />)
    expect(window.location.pathname).toBe('/solve')
    expect(screen.getByRole('group', { name: 'Player 1' })).toBeInTheDocument()
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
    // Pick mode by default: the seat chips.
    expect(screen.getByRole('group', { name: 'Your seat' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^type it$/i }))
    expect(window.location.search).toBe('?mode=type')
    expect(screen.getByLabelText(/type the spot/i)).toBeInTheDocument()

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
    expect(screen.getByRole('group', { name: 'Player 1' })).toBeInTheDocument()
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

  describe('phone shell (docs/mobile-redesign.md §3)', () => {
    it('opens the account sheet from the top bar, and closes it with Esc', async () => {
      const user = userEvent.setup()
      render(<App />)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /^sign in$/i }))
      const sheet = screen.getByRole('dialog', { name: 'Sign in' })
      expect(within(sheet).getByLabelText(/email/i)).toHaveAttribute('autocomplete', 'email')
      expect(within(sheet).getByText(/without an account/i)).toBeInTheDocument()
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('opens the account sheet from the signed-out Library', async () => {
      const user = userEvent.setup()
      render(<App />)
      await user.click(screen.getByRole('link', { name: /^library$/i }))
      await user.click(within(screen.getByRole('main')).getByRole('button', { name: /^sign in$/i }))
      expect(screen.getByRole('dialog', { name: 'Sign in' })).toBeInTheDocument()
    })

    it('has no inline sign-in form or tagline any more', () => {
      render(<App />)
      expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/manual hand builder/i)).not.toBeInTheDocument()
    })

    it('returns each tab to where it was left', async () => {
      const user = userEvent.setup()
      render(<App />)
      await user.click(screen.getByRole('link', { name: /^ranges$/i }))
      await user.click(screen.getByRole('button', { name: /^type it$/i }))
      await user.click(screen.getByRole('link', { name: /^library$/i }))
      expect(screen.getByRole('link', { name: /^ranges$/i })).toHaveAttribute('href', '/ranges?mode=type')
      await user.click(screen.getByRole('link', { name: /^ranges$/i }))
      expect(window.location.search).toBe('?mode=type')
    })

    it('keeps the Solve setup across a tab switch', async () => {
      const user = userEvent.setup()
      render(<App />)
      const player1 = () => within(screen.getByRole('group', { name: 'Player 1' }))
      await user.click(player1().getByRole('button', { name: 'UTG' }))
      await user.click(screen.getByRole('link', { name: /^library$/i }))
      // Hidden, not unmounted, and its Start over is out of the top bar.
      expect(screen.queryByRole('button', { name: /start over/i })).not.toBeInTheDocument()
      await user.click(screen.getByRole('link', { name: /^solve$/i }))
      expect(player1().getByRole('button', { name: 'UTG' })).toHaveAttribute('aria-pressed', 'true')
      await user.click(screen.getByRole('button', { name: /start over/i }))
      expect(player1().getByRole('button', { name: 'BB' })).toHaveAttribute('aria-pressed', 'true')
    })

    it('renders Solve and titles the tab at "/solve/" too (trailing slash)', () => {
      window.history.pushState({}, '', '/solve/')
      render(<App />)
      expect(screen.getByRole('heading', { level: 1, name: 'Solve' })).toBeInTheDocument()
      expect(screen.getByRole('group', { name: 'Player 1' })).toBeVisible()
    })

    it('Start over in the top bar clears Solve and goes back to step 1', async () => {
      const user = userEvent.setup()
      render(<App />)
      await user.click(screen.getByRole('button', { name: 'Call 1bb' }))
      await user.click(screen.getByRole('button', { name: 'Check' }))
      await user.click(screen.getByRole('button', { name: 'Next: the board' }))
      expect(window.location.search).toBe('?step=board')
      await user.click(screen.getByRole('button', { name: 'Start over' }))
      expect(window.location.search).toBe('?step=hand')
      expect(screen.getByText('BTN to act · facing 1bb')).toBeInTheDocument()
    })

    it("goes back to the last tab from the Drill's X", async () => {
      const user = userEvent.setup()
      render(<App />)
      await user.click(screen.getByRole('link', { name: /^ranges$/i }))
      await user.click(screen.getByRole('link', { name: /^drill$/i }))
      await user.click(screen.getByRole('link', { name: /exit the drill/i }))
      expect(window.location.pathname).toBe('/ranges')
    })
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

    it('starts Solve blank after leaving it, as before the phone keep-alive', async () => {
      const user = userEvent.setup()
      render(<App />)
      await user.click(screen.getByRole('button', { name: 'BTN raises…' }))
      await user.click(screen.getByRole('button', { name: '2.5bb' }))
      expect(screen.getByRole('button', { name: 'BB calls 1.5bb' })).toBeInTheDocument()
      const nav = screen.getByRole('navigation', { name: 'Main' })
      await user.click(within(nav).getByRole('link', { name: /^library/i }))
      await user.click(within(nav).getByRole('link', { name: /^solve/i }))
      expect(screen.queryByRole('button', { name: 'BB calls 1.5bb' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'BTN raises…' })).toBeInTheDocument()
    })

    it('renders Solve at "/solve/" too (trailing slash)', () => {
      window.history.pushState({}, '', '/solve/')
      render(<App />)
      expect(screen.getByRole('button', { name: 'BTN raises…' })).toBeInTheDocument()
    })

    it('has no phone top bar, tab bar or account sheet', () => {
      const { container } = render(<App />)
      expect(container.querySelector('.top-bar, .tab-bar')).toBeNull()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.getAllByRole('navigation', { name: 'Main' })).toHaveLength(1)
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
