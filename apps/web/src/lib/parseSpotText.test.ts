import { parseSpotText } from './parseSpotText'

describe('parseSpotText', () => {
  it('parses "<position> opens <n>bb" into an unopened-pot Spot', () => {
    const result = parseSpotText('BTN opens 100bb')
    expect(result).toEqual({
      kind: 'parsed',
      spot: {
        positions_in_hand: ['BTN'],
        effective_stack_bb: 100,
        current_street: 'preflop',
        actions: [],
      },
    })
  })

  it('defaults the stack to 100bb when not specified', () => {
    const result = parseSpotText('UTG opens')
    expect(result.kind).toBe('parsed')
    expect(result.kind === 'parsed' && result.spot.effective_stack_bb).toBe(100)
  })

  it('parses "<position> defends <raiser> open, <n>bb" into a vs-raise Spot', () => {
    const result = parseSpotText('BB defends CO open, 100bb')
    expect(result).toEqual({
      kind: 'parsed',
      spot: {
        positions_in_hand: ['BB'],
        effective_stack_bb: 100,
        current_street: 'preflop',
        actions: [{ position: 'CO', street: 'preflop', action: 'raise' }],
      },
    })
  })

  it('accepts "vs" as an alternate phrasing for the vs-raise pattern', () => {
    const result = parseSpotText('SB vs BTN open')
    expect(result.kind).toBe('parsed')
    expect(result.kind === 'parsed' && result.spot.positions_in_hand).toEqual(['SB'])
  })

  it('is case-insensitive on positions and keywords', () => {
    const result = parseSpotText('btn OPENS 40bb')
    expect(result.kind).toBe('parsed')
    expect(result.kind === 'parsed' && result.spot.positions_in_hand).toEqual(['BTN'])
  })

  it('rejects an unrecognized position', () => {
    expect(parseSpotText('ZZ opens 100bb')).toEqual({ kind: 'unrecognized' })
  })

  it('rejects freeform text that matches neither pattern', () => {
    expect(parseSpotText('I raise from the button for 3x')).toEqual({ kind: 'unrecognized' })
  })

  it('rejects an empty string', () => {
    expect(parseSpotText('')).toEqual({ kind: 'unrecognized' })
  })
})
