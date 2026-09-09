import { render, screen } from '@testing-library/react'
import App from './App'

// Shell-level smoke test only. Behavioural tests for SpotBuilder and
// RangeGrid belong with those components (their owners) -- this just proves
// the app mounts and wires the builder in without throwing.
describe('<App />', () => {
  it('renders the shell heading', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /poker solver/i })).toBeInTheDocument()
  })

  it('mounts the spot builder (position control is present)', () => {
    render(<App />)
    expect(screen.getAllByRole('combobox').length).toBeGreaterThanOrEqual(1)
  })
})
