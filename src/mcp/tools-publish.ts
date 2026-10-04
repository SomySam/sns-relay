import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { approveDrafts } from '../core/approve.js'
import { assertValidId } from '../core/article-id.js'
import { publishConfirm } from '../core/confirm-token.js'
import { publishArticle, type PublishReport } from '../core/publish.js'
import { CHANNEL_IDS } from '../core/types.js'
import { runTool } from './result.js'
import type { ServerOptions } from './server.js'

const OUTCOME_LABEL: Record<PublishReport['outcome'], string> = {
  published: '✔ 게시됨',
  unknown: '? 결과 불명',
  failed: '✖ 실패',
  'dry-run': '미리보기',
  blocked: '- 건너뜀',
}

function reportLine(r: PublishReport): string {
  const tail = r.postUrl ?? r.reason ?? ''
  const checks = (r.checks ?? []).map((p) => ` [${p.level}] ${p.message}`).join('')
  const unrecorded = r.recorded === false ? ' (결과를 상태에 기록하지 못함 — status 로 확인)' : ''
  return `${r.channel} ${OUTCOME_LABEL[r.outcome]} ${tail}${checks}${unrecorded}`.trimEnd()
}

export function registerPublishTools(server: McpServer, opts: ServerOptions): void {
  const { root } = opts
  const channels = z.array(z.enum(CHANNEL_IDS)).min(1)

  server.registerTool(
    'approve',
    {
      title: '초안 승인',
      description:
        '오너가 채팅에서 명시적으로 승인한 채널만 승인한다. 승인 여부를 추측하지 말고, "좋아요"처럼 모호하면 어느 채널인지 되묻는다. 검증 오류가 있는 초안은 승인되지 않는다.',
      inputSchema: z.object({
        id: z.string().describe('작업 이름'),
        channels: channels.describe('오너가 승인한 채널만 빠짐없이'),
      }),
    },
    ({ id, channels: targets }) =>
      runTool(root, async () => {
        const results = await approveDrafts(root, assertValidId(id), targets, opts.now)
        const summary = results
          .map((r) => (r.approved ? `${r.channel} 승인` : `${r.channel} 승인 안 됨: ${r.problems.map((p) => p.message).join(' / ')}`))
          .join('\n')
        return { summary, data: { results } }
      }),
  )

  server.registerTool(
    'publish',
    {
      title: '게시',
      description: [
        '승인된 초안을 게시한다. 반드시 두 번에 나눠 부른다.',
        '1) dry_run: true — 미리보기와 게시 전 확인 결과, confirm_token 을 받는다. 이 내용을 오너에게 보여 준다.',
        '2) 오너가 채팅에서 "올려"처럼 명시적으로 게시를 허락한 뒤에만 dry_run: false 와 같은 channels, confirm_token 으로 부른다.',
        '한 번에 한 채널을 권한다. 응답이 없거나 끊겨도 다시 게시하지 말고, 1~2분 뒤 status 로 확인한다. "결과 불명"이 계속되면 오너가 채널에서 직접 확인한 뒤에만 resolve_unknown 으로 기록한다.',
        '사진 여러 장(캐러셀)은 준비에 몇 분 걸릴 수 있다. 응답이 늦거나 status 가 아직 승인됨으로 보여도 다시 게시하지 말고 몇 분 뒤 status 로 확인한다.',
        '게시는 되돌릴 수 없다. ✖ 실패는 사유를 오너에게 전하고, 원인을 고친 뒤 dry_run 부터 다시 한다.',
      ].join('\n'),
      inputSchema: z.object({
        id: z.string().describe('작업 이름'),
        channels: channels.describe('게시할 채널 (threads, instagram, facebook)'),
        dry_run: z.boolean().describe('true 면 미리보기만, false 면 실제 게시'),
        confirm_token: z.string().optional().describe('dry_run: true 가 돌려준 값. 실제 게시에 필요'),
      }),
    },
    ({ id, channels: targets, dry_run, confirm_token }) =>
      runTool(root, async () => {
        const safeId = assertValidId(id)
        if (dry_run) {
          const reports = await publishArticle(root, safeId, { channels: targets, dryRun: true, now: opts.now })
          const ready =
            reports.length === new Set(targets).size &&
            reports.every((r) => r.outcome === 'dry-run' && !(r.checks ?? []).some((p) => p.level === 'error'))
          const token = ready ? (await publishConfirm(root, safeId, targets, opts.now)).token : null
          const summary = [
            ...reports.map(reportLine),
            token
              ? `확인 토큰: ${token} — 오너에게 미리보기를 보여 주고, 명시적으로 허락받은 뒤 dry_run: false 와 이 토큰으로 게시하세요.`
              : '게시할 수 없는 채널이 있어 확인 토큰을 주지 않습니다. 위 이유를 해결하거나 그 채널을 빼고 다시 dry_run 하세요.',
          ].join('\n')
          return { summary, data: { reports, confirm_token: token } }
        }

        if (!confirm_token) {
          throw new Error('실제 게시에는 confirm_token 이 필요합니다. 먼저 dry_run: true 로 확인하고, 돌려받은 confirm_token 을 넣으세요.')
        }
        const { token, hashes } = await publishConfirm(root, safeId, targets, opts.now)
        if (confirm_token !== token) {
          throw new Error('확인 토큰이 맞지 않습니다. dry-run 뒤에 초안·승인·상태가 바뀌었거나 채널이 다릅니다. 다시 dry_run 하세요.')
        }
        const reports = await publishArticle(root, safeId, { channels: targets, now: opts.now, sleep: opts.sleep, expectedHashes: hashes })
        return { summary: reports.map(reportLine).join('\n'), data: { reports } }
      }),
  )
}
