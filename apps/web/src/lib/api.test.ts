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

// CapacitorHttp.request resolves to { status, data, headers, url } -- data
// already parsed for a JSON response. Mocked at the module level since
// fetchReferenceStrategy calls CapacitorHttp directly (see lib/api.ts),
// not the global fetch.
const requestMock = vi.fn()
vi.mock('@capacitor/core', () => ({
  CapacitorHttp: { request: (...args: unknown[]) => requestMock(...args) },
}))

function mockResponse(status: number, data: unknown) {
  requestMock.mockResolvedValue({ status, data, headers: {}, url: '' })
}

beforeEach(() => {
  requestMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchReferenceStrategy', () => {
  it('POSTs the spot as JSON to /spots/reference-strategy', async () => {
    mockResponse(200, matchBody)

    await fetchReferenceStrategy(spot)

    expect(requestMock).toHaveBeenCalledTimes(1)
    const [options] = requestMock.mock.calls[0]
    expect(options.url).toMatch(/\/spots\/reference-strategy$/)
    expect(options.method).toBe('POST')
    expect(options.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(options.data).toEqual(spot)
  })

  it('classifies a 2xx as { kind: "match" } carrying the response body', async () => {
    mockResponse(200, matchBody)
    await expect(fetchReferenceStrategy(spot)).resolves.toEqual({
      kind: 'match',
      data: matchBody,
    })
  })

  it('classifies a 404 as { kind: "no-match" }', async () => {
    mockResponse(404, { detail: 'nothing covers this spot yet' })
    await expect(fetchReferenceStrategy(spot)).resolves.toEqual({ kind: 'no-match' })
  })

  it('classifies a 422 as { kind: "invalid" } with the parsed validation issues', async () => {
    const detail = [
      { loc: ['body', 'effective_stack_bb'], msg: 'field required', type: 'missing' },
    ]
    mockResponse(422, { detail })
    await expect(fetchReferenceStrategy(spot)).resolves.toEqual({
      kind: 'invalid',
      issues: detail,
    })
  })

  it('yields { kind: "invalid", issues: [] } when a 422 body is not the expected shape', async () => {
    mockResponse(422, { detail: 'just a string' })
    await expect(fetchReferenceStrategy(spot)).resolves.toEqual({
      kind: 'invalid',
      issues: [],
    })
  })

  it('classifies any other non-2xx as { kind: "error" } with the status', async () => {
    mockResponse(500, { detail: 'boom' })
    await expect(fetchReferenceStrategy(spot)).resolves.toEqual({ kind: 'error', status: 500 })
  })

  it('classifies a request rejection as { kind: "network-error" } and never throws', async () => {
    requestMock.mockRejectedValue(new Error('network unreachable'))
    await expect(fetchReferenceStrategy(spot)).resolves.toEqual({ kind: 'network-error' })
  })

  it('parses a JSON-string response body the same as an already-parsed one', async () => {
    mockResponse(200, JSON.stringify(matchBody))
    await expect(fetchReferenceStrategy(spot)).resolves.toEqual({
      kind: 'match',
      data: matchBody,
    })
  })
})
