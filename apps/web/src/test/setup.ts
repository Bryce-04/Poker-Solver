// Runs before every test file (see vite.config.ts `test.setupFiles`).
// Adds jest-dom matchers (toBeInTheDocument, toBeDisabled, ...) to expect.
import '@testing-library/jest-dom/vitest'

// jsdom doesn't implement scrolling; the phone shell and Solve steps scroll
// to the top on navigation. A no-op keeps its "not implemented" noise out.
window.scrollTo = (() => {}) as typeof window.scrollTo
