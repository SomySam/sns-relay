import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { readDrafts } from './draft-files.js'
import { getCell, loadState } from './state.js'
import type { ChannelId } from './types.js'

export interface StatusCell {
  channel: ChannelId
  label: string
  detail?: string
}

export async function listArticleIds(root: string): Promise<string[]> {
  const work = join(root, 'work')
  if (!existsSync(work)) return []
  const entries = await readdir(work, { withFileTypes: true })
  return entries
    .filter((e) => e.isDirectory() && existsSync(join(work, e.name, 'article.json')))
    .map((e) => e.name)
    .sort()
}

export async function articleStatus(root: string, id: string): Promise<{ id: string; title: string; cells: StatusCell[] }> {
  const { article, views } = await readDrafts(root, id)
  const state = await loadState(root)
  const cells = views.map((view): StatusCell => {
    const cell = getCell(state, id, view.channel)
    switch (cell?.status) {
      case 'published':
        return { channel: view.channel, label: '게시됨', detail: cell.postUrl ?? cell.postId }
      case 'unknown':
        return { channel: view.channel, label: '결과 불명', detail: cell.reason }
      case 'failed':
        return { channel: view.channel, label: '실패', detail: cell.reason }
      case 'manual':
        return { channel: view.channel, label: '수동 발행 대기' }
      case 'skipped':
        return { channel: view.channel, label: '건너뜀', detail: cell.reason }
      default:
        return { channel: view.channel, label: view.approved ? '승인됨' : '미승인' }
    }
  })
  return { id, title: article.title, cells }
}
