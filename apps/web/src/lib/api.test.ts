import type { Spot } from '@poker-solver/schema'
import { afterEach, beforeEach, vi } from 'vitest'
import { fetchReferenceStrategy, listSpots, saveSpot, solveSpot } from './api'
import { getAccessToken } from './auth'

// authHeaders() (api.ts) calls this directly -- mock it rather than the
// Supabase client underneath, since this is api.ts's boundary, not auth's.
vi.mock('./auth', () => ({ getAccessToken: vi.fn() }))
const mockGetAccessToken = vi.mocked(getAccessToken)

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
  mockGetAccessToken.mockReset()
  mockGetAccessToken.mockResolvedValue(null)
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

describe('saveSpot', () => {
  it('POSTs the spot to /spots', async () => {
    mockResponse(200, spot)

    await saveSpot(spot)

    expect(requestMock).toHaveBeenCalledTimes(1)
    const [options] = requestMock.mock.calls[0]
    expect(options.url).toMatch(/\/spots$/)
    expect(options.method).toBe('POST')
    expect(options.data).toEqual(spot)
  })

  it('classifies a 2xx as { kind: "saved" } carrying the saved spot', async () => {
    mockResponse(200, spot)
    await expect(saveSpot(spot)).resolves.toEqual({ kind: 'saved', spot })
  })

  it('classifies a 404 (route not shipped yet) as { kind: "error", status: 404 }', async () => {
    mockResponse(404, { detail: 'not found' })
    await expect(saveSpot(spot)).resolves.toEqual({ kind: 'error', status: 404 })
  })

  it('classifies a 422 as { kind: "invalid" } with the parsed validation issues', async () => {
    const detail = [{ loc: ['body', 'effective_stack_bb'], msg: 'field required', type: 'missing' }]
    mockResponse(422, { detail })
    await expect(saveSpot(spot)).resolves.toEqual({ kind: 'invalid', issues: detail })
  })

  it('classifies a request rejection as { kind: "network-error" } and never throws', async () => {
    requestMock.mockRejectedValue(new Error('network unreachable'))
    await expect(saveSpot(spot)).resolves.toEqual({ kind: 'network-error' })
  })

  it('omits the Authorization header when there is no session', async () => {
    mockResponse(200, spot)
    await saveSpot(spot)
    const [options] = requestMock.mock.calls[0]
    expect(options.headers.Authorization).toBeUndefined()
  })

  it('attaches Authorization: Bearer <token> when a session exists', async () => {
    mockGetAccessToken.mockResolvedValue('the-jwt')
    mockResponse(200, spot)
    await saveSpot(spot)
    const [options] = requestMock.mock.calls[0]
    expect(options.headers.Authorization).toBe('Bearer the-jwt')
  })
})

describe('listSpots', () => {
  it('GETs /spots', async () => {
    mockResponse(200, [spot])

    await listSpots()

    expect(requestMock).toHaveBeenCalledTimes(1)
    const [options] = requestMock.mock.calls[0]
    expect(options.url).toMatch(/\/spots$/)
    expect(options.method).toBe('GET')
  })

  it('classifies a 2xx as { kind: "ok" } carrying the spot list', async () => {
    mockResponse(200, [spot])
    await expect(listSpots()).resolves.toEqual({ kind: 'ok', spots: [spot] })
  })

  it('classifies a 404 (route not shipped yet) as { kind: "error", status: 404 }', async () => {
    mockResponse(404, { detail: 'not found' })
    await expect(listSpots()).resolves.toEqual({ kind: 'error', status: 404 })
  })

  it('classifies a request rejection as { kind: "network-error" } and never throws', async () => {
    requestMock.mockRejectedValue(new Error('network unreachable'))
    await expect(listSpots()).resolves.toEqual({ kind: 'network-error' })
  })

  it('attaches Authorization: Bearer <token> when a session exists', async () => {
    mockGetAccessToken.mockResolvedValue('the-jwt')
    mockResponse(200, [spot])
    await listSpots()
    const [options] = requestMock.mock.calls[0]
    expect(options.headers.Authorization).toBe('Bearer the-jwt')
  })
})

describe('solveSpot', () => {
  const solveBody = {
    source: 'live_solve',
    iterations: 8000,
    position: 'BTN',
    strategy: { AA: { check: 0.0, all_in: 1.0 } },
  }

  it('POSTs the spot to /spots/solve with a long read timeout', async () => {
    mockResponse(200, solveBody)

    await solveSpot(spot)

    expect(requestMock).toHaveBeenCalledTimes(1)
    const [options] = requestMock.mock.calls[0]
    expect(options.url).toMatch(/\/spots\/solve$/)
    expect(options.method).toBe('POST')
    expect(options.data).toEqual(spot)
    // A real solve measured at 60s+ on the deployed host -- CapacitorHttp's
    // native default is shorter than that, so this needs an explicit
    // override (regression: see docs/decisions.md's 2026-10-07 "BUG"
    // entry and the already-written fix-solve-client-timeout branch this
    // restores).
    expect(options.connectTimeout).toBe(20_000)
    expect(options.readTimeout).toBe(150_000)
  })

  it('classifies a 2xx as { kind: "solved" } carrying the response body', async () => {
    mockResponse(200, solveBody)
    await expect(solveSpot(spot)).resolves.toEqual({
      kind: 'solved',
      data: { ...solveBody, bucketed_actions: [] },
    })
  })

  it('normalizes a missing bucketed_actions to an empty array -- a deployed backend older than the web build is a real, recurring state (Render and the web app deploy separately), not a hypothetical', async () => {
    // solveBody above already omits bucketed_actions, matching exactly
    // what the live API was still sending when this was a real bug: the
    // field didn't exist yet, and SolvePage.tsx called
    // `.bucketed_actions.length` with no null-check, throwing mid-render
    // with no error boundary to catch it -- the whole screen went blank.
    mockResponse(200, solveBody)
    const result = await solveSpot(spot)
    expect(result.kind).toBe('solved')
    if (result.kind === 'solved') {
      expect(result.data.bucketed_actions).toEqual([])
    }
  })

  it('passes a real bucketed_actions array through unchanged once the backend sends one', async () => {
    const notes = ["BB's 10bb bet -> bucketed to 25% pot (bet_small)"]
    mockResponse(200, { ...solveBody, bucketed_actions: notes })
    const result = await solveSpot(spot)
    expect(result.kind).toBe('solved')
    if (result.kind === 'solved') {
      expect(result.data.bucketed_actions).toEqual(notes)
    }
  })

  it('classifies a 422 with an array detail as { kind: "invalid" }', async () => {
    const detail = [{ loc: ['body', 'pot_bb'], msg: 'field required', type: 'missing' }]
    mockResponse(422, { detail })
    await expect(solveSpot(spot)).resolves.toEqual({ kind: 'invalid', issues: detail })
  })

  it('classifies a 422 with a string detail as { kind: "rejected" } with the reason', async () => {
    mockResponse(422, { detail: 'ranges is missing an entry for: BTN' })
    await expect(solveSpot(spot)).resolves.toEqual({
      kind: 'rejected',
      reason: 'ranges is missing an entry for: BTN',
    })
  })

  it('classifies any other non-2xx as { kind: "error" } with the status', async () => {
    mockResponse(500, { detail: 'boom' })
    await expect(solveSpot(spot)).resolves.toEqual({ kind: 'error', status: 500 })
  })

  it('classifies a 503 as { kind: "busy" } -- the server runs one solve at a time', async () => {
    mockResponse(503, { detail: 'Another solve is already running' })
    await expect(solveSpot(spot)).resolves.toEqual({ kind: 'busy' })
  })

  it('classifies a request rejection as { kind: "network-error" } and never throws', async () => {
    requestMock.mockRejectedValue(new Error('network unreachable'))
    await expect(solveSpot(spot)).resolves.toEqual({ kind: 'network-error' })
  })
})
