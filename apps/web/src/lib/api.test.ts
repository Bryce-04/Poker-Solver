import type { Spot } from '@poker-solver/schema'
import { afterEach, beforeEach, vi } from 'vitest'
import { fetchReferenceStrategy } from './api'

// Minimal Spot -- fetchReferenceStrategy only JSON-serialises it, so the
// exact shape doesn't matter here, only that a Spot goes in.
const spot = { positions_in_hand: ['UTG'], effective_stack_bb: 100 } as unknown as Spot

const matchBody = {
  source: 'reference_chart',
  chart_key: 'utg_open_100bb',
  chart_description: 'UTG opening range',
  chart_source: 'methodology',
  ranges: { UTG: { AA: 1 } },
}

function mockResponse(status: number, body: unknown) {
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
  it('POSTs the spot as JSON to /spots/reference-strategy', async () => {
    const fetchMock = mockResponse(200, matchBody)
    vi.stubGlobal('fetch', fetchMock)

    await fetchReferenceStrategy(spot)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/spots\/reference-strategy$/)
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body)).toEqual(spot)
  })

  it('classifies a 2xx as { kind: "match" } carrying the response body', async () => {
    vi.stubGlobal('fetch', mockResponse(200, matchBody))
    await expect(fetchReferenceStrategy(spot)).resolves.toEqual({
      kind: 'match',
      data: matchBody,
    })
  })

  it('classifies a 404 as { kind: "no-match" }', async () => {
    vi.stubGlobal('fetch', mockResponse(404, { detail: 'nothing covers this spot yet' }))
    await expect(fetchReferenceStrategy(spot)).resolves.toEqual({ kind: 'no-match' })
  })

  it('classifies a 422 as { kind: "invalid" } with the parsed validation issues', async () => {
    const detail = [
      { loc: ['body', 'effective_stack_bb'], msg: 'field required', type: 'missing' },
    ]
    vi.stubGlobal('fetch', mockResponse(422, { detail }))
    await expect(fetchReferenceStrategy(spot)).resolves.toEqual({
      kind: 'invalid',
      issues: detail,
    })
  })

  it('yields { kind: "invalid", issues: [] } when a 422 body is not the expected shape', async () => {
    vi.stubGlobal('fetch', mockResponse(422, { detail: 'just a string' }))
    await expect(fetchReferenceStrategy(spot)).resolves.toEqual({
      kind: 'invalid',
      issues: [],
    })
  })

  it('classifies any other non-2xx as { kind: "error" } with the status', async () => {
    vi.stubGlobal('fetch', mockResponse(500, { detail: 'boom' }))
    await expect(fetchReferenceStrategy(spot)).resolves.toEqual({ kind: 'error', status: 500 })
  })

  it('classifies a fetch() rejection as { kind: "network-error" } and never throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(fetchReferenceStrategy(spot)).resolves.toEqual({ kind: 'network-error' })
  })
})
