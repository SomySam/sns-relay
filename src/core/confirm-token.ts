import { createHash } from 'node:crypto'
import { readDrafts } from './draft-files.js'
import { hashDraft } from './drafts.js'
import { getCell, loadState } from './state.js'
import type { ChannelId } from './types.js'

/**
 * MCP 게시의 확인 토큰 — dry-run 때와 실제 게시 때 같은 값이어야 게시가 열린다.
 * 대상 채널, 각 칸의 승인 해시(승인 안 됐으면 null), 칸 상태와 갱신 시각으로 만든다.
 * 초안이 바뀌거나 상태가 바뀌면(예: 게시됨) 값이 달라져, 같은 토큰으로 두 번 게시할 수 없다.
 */
export async function publishConfirm(
  root: string,
  id: string,
  channels: ChannelId[],
  now: () => Date = () => new Date(),
): Promise<{ token: string; hashes: Partial<Record<ChannelId, string>> }> {
  // readDrafts 는 내용이 바뀐 승인을 내리면서 파일·상태를 쓸 수 있다 — publishArticle 이 하는 것과 같다.
  const { views } = await readDrafts(root, id, now)
  const state = await loadState(root)
  const hashes: Partial<Record<ChannelId, string>> = {}
  const entries = [...new Set(channels)].sort().map((channel) => {
    const view = views.find((v) => v.channel === channel)
    const hash = view?.approved && view.draft ? hashDraft(view.draft) : null
    if (hash !== null) hashes[channel] = hash
    const cell = getCell(state, id, channel)
    return [channel, hash, cell?.status ?? null, cell?.updatedAt ?? null]
  })
  const token = createHash('sha256').update(JSON.stringify([id, entries])).digest('hex').slice(0, 12)
  return { token, hashes }
}

export async function publishConfirmToken(
  root: string,
  id: string,
  channels: ChannelId[],
  now: () => Date = () => new Date(),
): Promise<string> {
  return (await publishConfirm(root, id, channels, now)).token
}
