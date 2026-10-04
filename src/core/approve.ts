import { hasErrors } from './channels/index.js'
import { loadConfig } from './config.js'
import { readDrafts } from './draft-files.js'
import { hashDraft, serializeDraft } from './drafts.js'
import { writeFileAtomic } from './fs.js'
import { getCell, setCell, updateState } from './state.js'
import type { CellStatus, ChannelId, Problem } from './types.js'

export interface ApproveResult {
  channel: ChannelId
  approved: boolean
  problems: Problem[]
}

/** 이미 게시했거나(published) 결과를 확인 중이거나(unknown) 조건 미달로 멈춘(skipped) 칸 — manual 은 발행 전이라 재승인할 수 있다. */
const LOCKED: CellStatus[] = ['published', 'unknown', 'skipped']

export async function approveDrafts(
  root: string,
  id: string,
  channels?: ChannelId[],
  now: () => Date = () => new Date(),
): Promise<ApproveResult[]> {
  const config = await loadConfig(root)
  const targets = channels ?? config.channels
  for (const channel of targets) {
    if (!config.channels.includes(channel)) {
      throw new Error(`${channel} 는 config.json 의 channels 에 없습니다.`)
    }
  }

  const { views } = await readDrafts(root, id, now)
  return updateState(root, async (state) => {
    const results: ApproveResult[] = []
    for (const view of views) {
      if (!targets.includes(view.channel)) continue
      const cell = getCell(state, id, view.channel)
      if (cell && LOCKED.includes(cell.status)) {
        results.push({
          channel: view.channel,
          approved: false,
          problems: [{ level: 'error', message: `이미 ${cell.status} 상태라 다시 승인하지 않습니다.` }],
        })
        continue
      }
      if (!view.draft || hasErrors(view.problems)) {
        results.push({ channel: view.channel, approved: false, problems: view.problems })
        continue
      }
      if (cell?.status === 'manual' && cell.hash === hashDraft(view.draft)) {
        // 이미 네이버용으로 내보낸 같은 내용 — 칸을 되돌리면 발행 기록(mark)이 막힌다.
        results.push({
          channel: view.channel,
          approved: true,
          problems: [
            ...view.problems,
            {
              level: 'warn',
              message: `이미 네이버용으로 내보낸 초안입니다(수동 발행 대기). 발행했다면 sns-relay mark naver ${id} --url <주소> 로 기록하세요.`,
            },
          ],
        })
        continue
      }
      const draft = { ...view.draft, approved: true }
      await writeFileAtomic(view.path, serializeDraft(draft))
      setCell(state, id, view.channel, { status: 'approved', hash: hashDraft(draft) }, now())
      results.push({ channel: view.channel, approved: true, problems: view.problems })
    }
    return results
  })
}
