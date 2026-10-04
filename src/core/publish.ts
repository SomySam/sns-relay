import { getChannel, hasErrors } from './channels/index.js'
import { loadConfig, type Config } from './config.js'
import { readDrafts } from './draft-files.js'
import { hashDraft } from './drafts.js'
import { loadEnv } from './env.js'
import { getCell, loadState, setCell, updateState } from './state.js'
import type { Channel, ChannelDraft, ChannelId, Problem, PublishOutcome } from './types.js'

export interface PublishReport {
  channel: ChannelId
  outcome: 'published' | 'unknown' | 'failed' | 'dry-run' | 'blocked'
  postUrl?: string
  reason?: string
  /** false 면 게시 요청은 나갔지만 결과를 상태에 기록하지 못했다. */
  recorded?: false
  /** dry-run 에서 게시 전 확인(precheck) 결과 */
  checks?: Problem[]
  preview?: { body: string; link: string; image: string | null; images?: string[] }
}

export interface PublishOptions {
  channels?: ChannelId[]
  dryRun?: boolean
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
  progress?: (channel: ChannelId, message: string) => void
  /** MCP 확인 토큰을 만들 때의 초안 해시 — 다르면 그 채널은 게시하지 않는다(미리보기와 다른 글이 올라가지 않게). */
  expectedHashes?: Partial<Record<ChannelId, string>>
}

export function publishableChannels(config: Config): ChannelId[] {
  return config.channels.filter((c) => getChannel(c).publish !== undefined)
}

class PublishRaceError extends Error {}
const RACE_MESSAGE = '다른 작업이 이 칸을 먼저 바꿨습니다(동시에 게시 중일 수 있음). sns-relay status 로 확인하세요.'

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function publishArticle(root: string, id: string, opts: PublishOptions = {}): Promise<PublishReport[]> {
  const now = opts.now ?? (() => new Date())
  const config = await loadConfig(root)
  const targets = opts.channels ?? publishableChannels(config)
  for (const channel of targets) {
    if (!config.channels.includes(channel)) throw new Error(`${channel} 는 config.json 의 channels 에 없습니다.`)
  }

  const { article, views } = await readDrafts(root, id, now)
  const state = await loadState(root)
  const env = loadEnv(root)
  const reports: PublishReport[] = []

  for (const view of views) {
    if (!targets.includes(view.channel)) continue
    const channelId = view.channel
    const channel = getChannel(channelId)
    const cell = getCell(state, id, channelId)
    const block = (reason: string) => reports.push({ channel: channelId, outcome: 'blocked', reason })

    if (cell?.status === 'published') {
      block(`이미 게시됨: ${cell.postUrl ?? cell.postId ?? '주소 없음'}`)
      continue
    }
    if (cell?.status === 'unknown') {
      block('게시 결과를 확인 중입니다. 채널에서 확인한 뒤 sns-relay resolve 로 기록하세요.')
      continue
    }
    if (!channel.publish && channel.mode === 'manual') {
      block(`네이버는 자동 게시를 하지 않습니다. sns-relay naver ${id} 로 붙여 넣기용 결과물을 만들어 직접 발행하세요.`)
      continue
    }
    if (!view.draft || !view.approved) {
      block('승인되지 않았습니다. 오너 확인 뒤 sns-relay approve 로 먼저 승인하세요.')
      continue
    }
    if (hasErrors(view.problems)) {
      block('검증 오류가 있습니다. sns-relay drafts 로 확인하세요.')
      continue
    }
    if (!channel.publish) {
      block('이 채널의 자동 게시는 아직 지원하지 않습니다.')
      continue
    }

    if (opts.expectedHashes) {
      const expected = opts.expectedHashes[channelId]
      if (!view.draft || expected === undefined || hashDraft(view.draft) !== expected) {
        block('미리보기 뒤에 초안이 바뀌었습니다. 다시 미리보기(dry-run) 하세요.')
        continue
      }
    }

    const draft = view.draft
    const checks = channel.precheck ? await runPrecheck(channel, draft) : undefined
    if (opts.dryRun) {
      reports.push({
        channel: channelId,
        outcome: 'dry-run',
        preview: { body: draft.body, link: draft.link, image: draft.image, ...(draft.images ? { images: draft.images } : {}) },
        ...(checks ? { checks } : {}),
      })
      continue
    }

    const hash = hashDraft(draft)
    let sent = false
    let ourUnknownAt: string | undefined
    let outcome: PublishOutcome
    if (checks && hasErrors(checks)) {
      outcome = {
        status: 'failed',
        reason: `게시 전 확인에서 막혔습니다: ${checks.filter((p) => p.level === 'error').map((p) => p.message).join(' / ')}`,
      }
    } else {
      try {
        outcome = await channel.publish(draft, article, {
          env,
          sleep: opts.sleep ?? realSleep,
          progress: (message) => opts.progress?.(channelId, message),
          onBeforePublish: async () => {
            await updateState(root, (s) => {
              const current = getCell(s, id, channelId)
              const stillApproved =
                current !== undefined && (current.status === 'approved' || current.status === 'failed') && current.hash === hash
              if (!stillApproved) throw new PublishRaceError(RACE_MESSAGE)
              ourUnknownAt = setCell(s, id, channelId, { status: 'unknown', hash, reason: '게시 요청을 보냈지만 결과를 기록하지 못했습니다.' }, now()).updatedAt
            })
            sent = true
          },
        })
      } catch (e) {
        if (e instanceof PublishRaceError) {
          block(RACE_MESSAGE)
          continue
        }
        let message = e instanceof Error ? e.message : String(e)
        for (const v of Object.values(env)) if (v) message = message.split(v).join('***')
        outcome = sent
          ? { status: 'unknown', reason: `게시 중 예상치 못한 오류: ${message}. 채널에서 확인한 뒤 sns-relay resolve 로 기록하세요.` }
          : { status: 'failed', reason: `게시 전 예상치 못한 오류: ${message}` }
      }
    }

    let allowed = false
    let recordError: string | undefined
    try {
      allowed = await updateState(root, (s) => {
        const current = getCell(s, id, channelId)
        const ok = sent
          ? current?.status === 'unknown' && current.hash === hash && current.updatedAt === ourUnknownAt
          : current !== undefined && (current.status === 'approved' || current.status === 'failed') && current.hash === hash
        if (!ok) return false
        if (outcome.status === 'published') {
          setCell(s, id, channelId, { status: 'published', hash, postId: outcome.postId, postUrl: outcome.postUrl, reason: outcome.note }, now())
        } else {
          setCell(s, id, channelId, { status: outcome.status, hash, reason: outcome.reason }, now())
        }
        return true
      })
    } catch (e) {
      recordError = e instanceof Error ? e.message : String(e)
    }
    if (recordError !== undefined) {
      const note = `상태 기록에 실패했습니다: ${recordError}. sns-relay status 로 확인하세요.`
      reports.push(
        outcome.status === 'published'
          ? { channel: channelId, outcome: 'published', postUrl: outcome.postUrl, reason: `게시됐지만 ${note}`, recorded: false }
          : { channel: channelId, outcome: outcome.status, reason: `${outcome.reason} (${note})`, recorded: false },
      )
    } else if (!allowed) {
      if (outcome.status === 'published') {
        reports.push({
          channel: channelId,
          outcome: 'published',
          postUrl: outcome.postUrl,
          reason: '게시됐지만 그사이 다른 작업이 칸을 바꿔 결과를 기록하지 않았습니다. sns-relay status 로 확인하세요.',
          recorded: false,
        })
      } else if (sent) {
        reports.push({
          channel: channelId,
          outcome: outcome.status,
          reason: `${outcome.reason} (게시 요청은 보냈지만, 그사이 다른 작업이 칸을 바꿔 결과를 기록하지 않았습니다. sns-relay status 로 확인하세요.)`,
          recorded: false,
        })
      } else {
        reports.push({ channel: channelId, outcome: 'blocked', reason: RACE_MESSAGE })
      }
    } else {
      reports.push(
        outcome.status === 'published'
          ? { channel: channelId, outcome: 'published', postUrl: outcome.postUrl, reason: outcome.note }
          : { channel: channelId, outcome: outcome.status, reason: outcome.reason },
      )
    }
  }
  return reports
}

async function runPrecheck(channel: Channel, draft: ChannelDraft): Promise<Problem[]> {
  try {
    return await channel.precheck!(draft)
  } catch (e) {
    return [{ level: 'error', message: `게시 전 확인 중 오류: ${e instanceof Error ? e.message : String(e)}` }]
  }
}
