import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, vi } from 'vitest'
import App from './App'
import { listSpots } from './lib/api'

// SavedSpotsPage calls listSpots() on mount -- mock the api module directly
// (same convention as SpotBuilder.test.tsx) rather than the transport
// underneath it, so this test doesn't care whether that's fetch or
// CapacitorHttp. Stubs the real current state: a 404 until the backend
// lane ships POST/GET /spots.
vi.mock('./lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/api')>()),
  listSpots: vi.fn(),
}))
const mockListSpots = vi.mocked(listSpots)

// Shell-level smoke test only. Behavioural tests for SpotBuilder and
// RangeGrid belong with those components (their owners) -- this just proves
// the app mounts and wires the builder in without throwing.
describe('<App />', () => {
  beforeEach(() => {
    mockListSpots.mockReset()
    mockListSpots.mockResolvedValue({ kind: 'error', status: 404 })
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
