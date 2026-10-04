import { getCell, setCell, updateState } from './state.js'
import type { CellState, ChannelId } from './types.js'

/** 게시 요청 뒤 결과를 모르는 칸을, 사람이 채널에서 확인한 대로 확정한다. */
export async function resolveUnknown(
  root: string,
  id: string,
  channel: ChannelId,
  how: { postUrl: string } | { notPublished: true },
  now: () => Date = () => new Date(),
): Promise<CellState> {
  if ('postUrl' in how && !/^https?:\/\//i.test(how.postUrl)) {
    throw new Error(`게시물 주소는 http(s) 로 시작해야 합니다: ${how.postUrl}`)
  }
  return updateState(root, (s) => {
    const cell = getCell(s, id, channel)
    if (cell?.status !== 'unknown') {
      throw new Error(`${id} 의 ${channel} 칸은 결과 불명(unknown) 상태가 아닙니다 (현재: ${cell?.status ?? '기록 없음'}).`)
    }
    if ('postUrl' in how) {
      return setCell(s, id, channel, { status: 'published', hash: cell.hash, postUrl: how.postUrl }, now())
    }
    return setCell(s, id, channel, { status: 'approved', hash: cell.hash }, now())
  })
}
