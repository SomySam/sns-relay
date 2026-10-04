import { getCell, setCell, updateState } from './state.js'
import type { CellState, ChannelId } from './types.js'

function assertHttpUrl(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`발행 주소는 http(s) 주소여야 합니다: ${url}`)
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.hostname === '') {
    throw new Error(`발행 주소는 http(s) 주소여야 합니다: ${url}`)
  }
}

/** 사람이 직접 발행한 글(네이버)의 주소를 기록한다 — 수동 발행 대기(manual) 칸만. */
export async function markPublished(
  root: string,
  id: string,
  channel: ChannelId,
  url: string,
  now: () => Date = () => new Date(),
): Promise<CellState> {
  assertHttpUrl(url)
  return updateState(root, (s) => {
    const cell = getCell(s, id, channel)
    if (cell?.status !== 'manual') {
      throw new Error(
        `${id} 의 ${channel} 칸은 수동 발행 대기(manual)가 아닙니다 (현재: ${cell?.status ?? '기록 없음'}). 네이버는 먼저 sns-relay naver ${id} 로 결과물을 만드세요.`,
      )
    }
    return setCell(s, id, channel, { status: 'published', hash: cell.hash, postUrl: url }, now())
  })
}
