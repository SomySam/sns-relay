import type { Problem } from '../types.js'

export function countChars(s: string): number {
  return [...s].length
}

const URL_PATTERN = /\bhttps?:\/\/|\bwww\./i

/** 모든 채널에 같은 검사: 빈 본문, 본문 속 주소(링크는 프로그램이 붙인다). */
export function commonProblems(body: string): Problem[] {
  const problems: Problem[] = []
  if (body.trim() === '') {
    problems.push({ level: 'error', message: '본문이 비어 있습니다.' })
  }
  if (URL_PATTERN.test(body)) {
    problems.push({ level: 'error', message: '본문에 주소(URL)를 쓰지 않습니다. 링크는 프로그램이 붙입니다.' })
  }
  return problems
}
