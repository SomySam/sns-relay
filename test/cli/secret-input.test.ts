import { describe, expect, it } from 'vitest'
import { applySecretInput } from '../../src/cli/secret-input.js'

const feed = (...chunks: string[]) => {
  const state = { value: '' }
  let r: ReturnType<typeof applySecretInput> = 'continue'
  for (const c of chunks) {
    r = applySecretInput(state, c)
    if (r !== 'continue') break
  }
  return { state, r }
}

describe('applySecretInput', () => {
  it('일반 입력', () => {
    const { state, r } = feed('ab', 'c')
    expect(r).toBe('continue')
    expect(state.value).toBe('abc')
  })
  it('백스페이스는 한 글자를 지운다', () => {
    expect(feed('abc\u007f\b', 'd').state.value).toBe('ad')
  })
  it('붙여넣기 표식을 떼고 끝의 \r 로 enter', () => {
    const { state, r } = feed('\x1b[200~TOKEN123\x1b[201~\r')
    expect(r).toBe('enter')
    expect(state.value).toBe('TOKEN123')
  })
  it('Ctrl+C·Ctrl+D 는 취소', () => {
    expect(feed('ab\u0003').r).toBe('cancel')
    expect(feed('ab\u0004').r).toBe('cancel')
  })
  it('방향키 같은 ESC 시퀀스는 무시', () => {
    expect(feed('a\x1b[Ab').state.value).toBe('ab')
  })
  it('enter 뒤의 글자는 받지 않는다', () => {
    const { state, r } = feed('abc\rdef')
    expect(r).toBe('enter')
    expect(state.value).toBe('abc')
  })
})
