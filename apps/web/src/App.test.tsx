import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, vi } from 'vitest'
import App from './App'

// Shell-level smoke test only. Behavioural tests for SpotBuilder and
// RangeGrid belong with those components (their owners) -- this just proves
// the app mounts and wires the builder in without throwing.
describe('<App />', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // SavedSpotsPage calls listSpots() on mount -- stub a 404 (the real
    // state until the backend lane ships POST/GET /spots) so this test
    // doesn't depend on a running apps/api.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) } as Response),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the shell heading', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /poker solver/i })).toBeInTheDocument()
  })

  it('mounts the spot builder on the default route (position control is present)', () => {
    render(<App />)
    expect(screen.getAllByRole('combobox').length).toBeGreaterThanOrEqual(1)
  })

  it('navigates to the saved-spots and type-in routes without throwing', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('link', { name: /saved/i }))
    expect(await screen.findByText(/saved spots aren.t live yet/i)).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: /type in/i }))
    expect(screen.getByText(/describe the spot/i)).toBeInTheDocument()
  })
})
