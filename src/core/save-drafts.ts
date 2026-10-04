import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { loadConfig } from './config.js'
import { draftPath } from './draft-files.js'
import { hashDraft, parseDraft, serializeDraft } from './drafts.js'
import { writeFileAtomic } from './fs.js'
import { getCell, loadState } from './state.js'
import type { CellStatus, ChannelDraft, ChannelId } from './types.js'
import { requireArticle } from './workspace.js'

export interface DraftInput {
  channel: ChannelId
  body: string
  /** 네이버만 */
  title?: string
  /** 네이버만 */
  tags?: string[]
}

export interface SaveDraftResult {
  channel: ChannelId
  saved: boolean
  reason?: string
}

/**
 * 게시했거나 결과를 확인 중이거나 건너뛴 칸 — 초안은 기록이라 고치지 않는다.
 * manual(네이버 내보낸 뒤 수동 발행 대기)은 일부러 뺐다: 오너가 올리기 전에 고칠 수 있어야 하고,
 * 고치면 승인이 풀려 다시 승인하기 전에는 내보내기가 거절된다.
 */
const LOCKED: CellStatus[] = ['published', 'unknown', 'skipped']

/**
 * 파일을 직접 쓸 수 없는 입구(MCP)를 위해 초안 본문(네이버는 제목·태그도)만 바꾼다.
 * frontmatter 의 channel·link·image 는 그대로 두고, 내용이 바뀌면 approved 를 false 로 쓴다.
 */
export async function saveDrafts(root: string, id: string, inputs: DraftInput[]): Promise<SaveDraftResult[]> {
  const config = await loadConfig(root)
  await requireArticle(root, id)
  const state = await loadState(root)
  const seen = new Set<ChannelId>()
  const results: SaveDraftResult[] = []

  for (const input of inputs) {
    const { channel } = input
    const skip = (reason: string) => results.push({ channel, saved: false, reason })
    if (seen.has(channel)) {
      skip('같은 채널이 두 번 들어왔습니다.')
      continue
    }
    seen.add(channel)
    if (!config.channels.includes(channel)) {
      skip(`${channel} 는 config.json 의 channels 에 없습니다.`)
      continue
    }
    const status = getCell(state, id, channel)?.status
    if (status && LOCKED.includes(status)) {
      skip(`이미 ${status} 상태라 고치지 않습니다.`)
      continue
    }
    if (channel !== 'naver' && (input.title !== undefined || input.tags !== undefined)) {
      skip('title·tags 는 네이버 초안만 가질 수 있습니다.')
      continue
    }
    // parseDraft 와 같은 방식으로 다듬어야 저장 뒤 해시가 같다.
    const body = input.body.replace(/\r\n?/g, '\n').replace(/^\n+/, '').replace(/\s+$/, '')
    if (body.trim() === '') {
      skip('본문이 비어 있습니다.')
      continue
    }
    const path = draftPath(root, id, channel)
    if (!existsSync(path)) {
      skip('초안 파일이 없습니다. 먼저 fetch_article 로 글을 가져오세요.')
      continue
    }
    let current: ChannelDraft
    try {
      current = parseDraft(await readFile(path, 'utf8'), channel)
    } catch (e) {
      skip((e as Error).message)
      continue
    }
    const next: ChannelDraft = {
      ...current,
      body,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
    }
    if (hashDraft(next) === hashDraft(current)) {
      results.push({ channel, saved: true, reason: '내용이 같아 그대로 둡니다.' })
      continue
    }
    await writeFileAtomic(path, serializeDraft({ ...next, approved: false }))
    results.push({ channel, saved: true })
  }
  return results
}
