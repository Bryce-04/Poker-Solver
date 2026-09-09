import { HAND_GRID, RANKS, handLabel } from './hands'

describe('handLabel', () => {
  it('names the diagonal as pairs', () => {
    expect(handLabel(0, 0)).toBe('AA')
    expect(handLabel(4, 4)).toBe('TT')
    expect(handLabel(12, 12)).toBe('22')
  })

  it('names cells above the diagonal as suited (higher rank first)', () => {
    expect(handLabel(0, 1)).toBe('AKs')
    expect(handLabel(1, 4)).toBe('KTs')
  })

  it('names cells below the diagonal as offsuit (higher rank first)', () => {
    expect(handLabel(1, 0)).toBe('AKo')
    expect(handLabel(4, 1)).toBe('KTo')
  })
})

describe('HAND_GRID', () => {
  it('is 13x13', () => {
    expect(HAND_GRID).toHaveLength(13)
    for (const row of HAND_GRID) expect(row).toHaveLength(13)
  })

  it('covers all 169 canonical hand classes with no duplicates', () => {
    const all = HAND_GRID.flat()
    expect(all).toHaveLength(169)
    expect(new Set(all).size).toBe(169)
  })

  it('has 13 pairs, 78 suited and 78 offsuit combos', () => {
    const all = HAND_GRID.flat()
    expect(all.filter((h) => h.length === 2)).toHaveLength(13)
    expect(all.filter((h) => h.endsWith('s'))).toHaveLength(78)
    expect(all.filter((h) => h.endsWith('o'))).toHaveLength(78)
  })

  it('orders ranks strongest-first', () => {
    expect(RANKS[0]).toBe('A')
    expect(RANKS[RANKS.length - 1]).toBe('2')
  })
})
