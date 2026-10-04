/**
 * 비밀 입력 한 덩어리(chunk)를 처리한다. state.value 를 바꾸고 다음에 할 일을 돌려준다.
 * Enter → 'enter', Ctrl+C·Ctrl+D → 'cancel'. 붙여넣기 표식·방향키 같은 ESC 시퀀스와 제어 문자는 무시한다.
 */
export function applySecretInput(state: { value: string }, chunk: string): 'continue' | 'enter' | 'cancel' {
  const text = chunk.replace(/\x1b\[20[01]~/g, '')
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (ch === '\r' || ch === '\n') return 'enter'
    if (ch === '\u0003' || ch === '\u0004') return 'cancel'
    if (ch === '\u007f' || ch === '\b') {
      state.value = state.value.slice(0, -1)
      continue
    }
    if (ch === '\x1b') {
      if (text[i + 1] === '[') {
        let j = i + 2
        while (j < text.length && !/[A-Za-z~]/.test(text[j]!)) j++
        i = j
      }
      continue
    }
    if (ch < ' ') continue
    state.value += ch
  }
  return 'continue'
}
