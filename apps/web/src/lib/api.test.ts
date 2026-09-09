import type { Spot } from '@poker-solver/schema'
import { afterEach, beforeEach, vi } from 'vitest'
import { fetchReferenceStrategy } from './api'

// Minimal Spot -- fetchReferenceStrategy only JSON-serialises it, so the
// exact shape doesn't matter here, only that a Spot goes in.
const spot = { positions_in_hand: ['UTG'], effective_stack_bb: 100 } as unknown as Spot

const okBody = {
  source: 'reference_chart',
  chart_key: 'utg_open_100bb',
  chart_description: 'UTG opening range',
  chart_source: 'methodology',
  ranges: { UTG: { AA: 1 } },
}

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response)
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchReferenceStrategy', () => {
  it('returns the parsed body on a 200', async () => {
    vi.stubGlobal('fetch', mockFetch(200, okBody))
    await expect(fetchReferenceStrategy(spot)).resolves.toEqual(okBody)
  })

  it('POSTs the spot as JSON to /spots/reference-strategy', async () => {
    const fetchMock = mockFetch(200, okBody)
    vi.stubGlobal('fetch', fetchMock)

    await fetchReferenceStrategy(spot)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/spots\/reference-strategy$/)
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body)).toEqual(spot)
  })

  it('returns null on a 404 (no matching reference chart yet)', async () => {
    vi.stubGlobal('fetch', mockFetch(404, { detail: 'no match' }))
    await expect(fetchReferenceStrategy(spot)).resolves.toBeNull()
  })

  it('throws on any other non-2xx response', async () => {
    vi.stubGlobal('fetch', mockFetch(500, { detail: 'boom' }))
    await expect(fetchReferenceStrategy(spot)).rejects.toThrow(/500/)
  })
})
